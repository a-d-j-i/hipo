// Drizzle SQLite-proxy driver for Workers running inside Tauri.
//
// `@tauri-apps/api/core` `invoke()` isn't reliably reachable from a
// Web Worker (the IPC primitives live on the main-thread `window`),
// so the Worker postMessages the SQL operation to its parent context
// (the main thread), which has `invoke()` and forwards the call to
// the Rust `sql_exec` / `sql_query` commands defined in
// `packages/tauri-shell/src/sql.rs`.
//
// On the main thread directly, use `client-tauri.ts` instead — no
// bridge needed there.
//
// Protocol (Worker ⇄ main thread):
//   Worker → main:  { kind: "sql.invoke", id, cmd, args: {sql, params} }
//   main → Worker:  { kind: "sql.result", id, ok: true,  result }
//                   { kind: "sql.result", id, ok: false, error: string }
// `id` is a monotonic counter scoped to this Worker; concurrent
// requests resolve out-of-order via the `pending` map.

import { drizzle } from "drizzle-orm/sqlite-proxy";
import { runMigrations } from "./migrations-runner.ts";
import type { Db, Migration } from "./types.ts";

export type OpenDbTauriBridgeOptions = {
  /** Migrations to apply on open. */
  migrations: Migration[];
};

type ProxyMethod = "all" | "run" | "values" | "get";
/**
 * Commands the bridge knows how to forward. Listed explicitly so a
 * typo in a caller becomes a type error instead of a runtime "unknown
 * command" from the Rust side. New backend commands need to be added
 * here AND to the `invoke_handler!` list in
 * `packages/tauri-shell/src/lib.rs`.
 */
export type BridgeCmd =
  | "sql_exec"
  | "sql_query"
  | "sql_backup_to_bytes"
  | "sql_restore_from_bytes";
type Pending = (r: { ok: boolean; result?: unknown; error?: string }) => void;

let nextId = 1;
const pending = new Map<number, Pending>();
let installed = false;

function installListener(): void {
  if (installed) return;
  installed = true;
  self.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.kind !== "sql.result") return;
    const id = e.data.id as number;
    const cb = pending.get(id);
    if (!cb) return;
    pending.delete(id);
    cb(e.data);
  });
}

/**
 * Generic Tauri-IPC bridge invoke from a Worker. The main thread's
 * SQL bridge handler (see `apps/frontend/src/in-page-backend.ts`)
 * forwards every `sql.invoke` it receives to `invoke(cmd, args)`,
 * regardless of command name — so this primitive is reusable by the
 * Tauri-side BinaryFormat (`binary-format-tauri.ts`) on top of the
 * built-in `sql_exec` / `sql_query` paths used by the proxy below.
 */
export function bridgeInvoke<T>(
  cmd: BridgeCmd,
  args: Record<string, unknown>,
): Promise<T> {
  installListener();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, (r) => {
      if (r.ok) resolve(r.result as T);
      else reject(new Error(r.error ?? "sql bridge: unknown error"));
    });
    (self as unknown as Worker).postMessage({
      kind: "sql.invoke",
      id,
      cmd,
      args,
    });
  });
}

async function proxy(
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): Promise<{ rows: unknown[] }> {
  if (method === "run") {
    await bridgeInvoke<number>("sql_exec", { sql, params });
    return { rows: [] };
  }
  const rows = await bridgeInvoke<unknown[][]>("sql_query", { sql, params });
  if (method === "get") {
    return { rows: rows[0] ?? [] };
  }
  return { rows };
}

/**
 * Construct a Drizzle handle whose driver postMessages every query
 * to the Worker's parent context, then apply migrations. The Rust
 * SQLite connection's lifetime is the Tauri process — `close()` is
 * a no-op kept for API symmetry with the other client modules.
 */
export async function openDb(opts: OpenDbTauriBridgeOptions): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const db = drizzle(proxy, { logger: false }) as unknown as Db;
  await runMigrations(db, opts.migrations);
  return {
    db,
    close: async () => {
      // Connection lives in Rust; nothing to close from JS.
    },
  };
}
