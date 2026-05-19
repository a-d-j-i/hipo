// Native-SQLite client for the Tauri shape (Phase 12).
//
// The Tauri Rust process owns a single rusqlite Connection (opened
// by `packages/tauri-shell` at app startup against
// `<app_data_dir>/<db_filename>`). Drizzle queries land here as
// `invoke("sql_exec" | "sql_query")` calls.
//
// Symmetric with `client-deno.ts` (libsql) and `client-browser.ts`
// (sqlocal+OPFS) — same `Db` type, same `runMigrations` runner,
// same schemas. The substrate difference is invisible to do_* ops.

import { drizzle } from "drizzle-orm/sqlite-proxy";
import { invoke } from "@tauri-apps/api/core";
import { runMigrations } from "./migrations-runner.ts";
import type { Db, Migration } from "./types.ts";

export type OpenDbTauriOptions = {
  /** Migrations to apply on open. */
  migrations: Migration[];
};

// Drizzle's sqlite-proxy callback signature. `method` selects how
// rows are shaped on the way back to Drizzle:
//   - `run`       : write/DDL; no rows
//   - `all`/values: array of column-positional rows
//   - `get`       : the first row (or [] if empty)
type ProxyMethod = "all" | "run" | "values" | "get";

async function proxy(
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): Promise<{ rows: unknown[] }> {
  if (method === "run") {
    await invoke<number>("sql_exec", { sql, params });
    return { rows: [] };
  }
  const rows = await invoke<unknown[][]>("sql_query", { sql, params });
  if (method === "get") {
    return { rows: rows[0] ?? [] };
  }
  return { rows };
}

/**
 * Construct a Drizzle handle that proxies every query into the
 * Tauri Rust SQLite connection, then apply migrations.
 *
 * The connection's lifetime is the Tauri process — there's nothing
 * for JS to close, so `close()` is a no-op kept for API symmetry
 * with `client-deno` / `client-browser`.
 */
export async function openDb(opts: OpenDbTauriOptions): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const db = drizzle(proxy, { logger: false }) as unknown as Db;
  await runMigrations(db, opts.migrations);
  return {
    db,
    close: async () => {
      // Connection lives in Rust; disposing the JS proxy doesn't
      // close the file. Exit happens on app termination.
    },
  };
}
