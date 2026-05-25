// In-page Worker entry. Opens the DB (sqlocal+OPFS on browsers,
// Tauri-IPC bridge on Tauri per Phase 12), builds the framework
// Router with hipo's full route surface, and dispatches /api/*
// requests sent by the Service Worker over a MessageChannel port.
//
// Same source as apps/hipo/src/server.ts minus `Deno.serve` and
// the static-SPA fallback (the SW handles non-/api fetches).

/// <reference lib="webworker" />

import { gzipped, type BackupFormat } from "@hipo/backup";
import { Router, serveOnPort } from "@hipo/server";
import { type AppState, sessionMiddleware } from "hipo/middleware-session";
import { registerAllRoutes } from "hipo/routes";
import { migrations } from "hipo/migrations";
import type { Db } from "@hipo/sqlite";

type Shape = "tauri" | "browser";

function waitForMessage<T>(kind: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.kind === kind) {
        self.removeEventListener("message", onMsg);
        resolve(e.data as T);
      }
    };
    self.addEventListener("message", onMsg);
  });
}

async function openForShape(shape: Shape): Promise<{
  db: Db;
  backupFormat: BackupFormat | null;
}> {
  if (shape === "tauri") {
    // Tauri shape: rusqlite via the sql.invoke bridge on the main
    // thread (see in-page-backend.ts). Backups go through Rust
    // `VACUUM INTO` + file read; restores through atomic file
    // rename + reopen (see `binary-format-tauri.ts`).
    //
    // Note: hipo's production Tauri boot path now uses the main-
    // thread router topology in `in-page-mainthread.ts` (webkit2gtk
    // refuses to register a Service Worker over the `tauri://`
    // scheme used by Linux/macOS release builds). This Worker
    // branch is dead code for hipo's Tauri shape — kept for any
    // framework consumer that wants COI/SAB alongside rusqlite.
    const [{ openDb, bridgeInvoke }, { binaryFormat }] = await Promise.all([
      import("@hipo/sqlite/client-tauri-bridge"),
      import("@hipo/sqlite/binary-format-tauri"),
    ]);
    const opened = await openDb({ migrations });
    return { db: opened.db, backupFormat: gzipped(binaryFormat(bridgeInvoke)) };
  }
  // Browser / Pages shape — sqlocal + OPFS, with the binary backup
  // format wired against the live SQLocal handle.
  const [{ openDb }, { binaryFormat }] = await Promise.all([
    import("@hipo/sqlite/client-browser"),
    import("@hipo/sqlite/binary-format-browser"),
  ]);
  const opened = await openDb({
    databasePath: "hipo.sqlite3",
    migrations,
  });
  return {
    db: opened.db,
    backupFormat: gzipped(binaryFormat({ local: opened.local })),
  };
}

async function main(): Promise<void> {
  const { shape } = await waitForMessage<{ shape: Shape }>("config");

  const { db, backupFormat } = await openForShape(shape);

  const app = new Router<AppState>();

  // Security headers: not strictly needed for in-page (no cross-origin
  // surface) but the same middleware that runs on Deno runs here so
  // route handlers don't see two different worlds.
  app.use(async (_c, next) => {
    const res = await next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  });

  // No CORS — the SW lives at the same origin and only forwards
  // same-origin requests. No requireLocalToken — config.authToken is
  // undefined in browser, so it would be a no-op anyway.
  app.use(sessionMiddleware(db));

  registerAllRoutes(app, { backupFormat });

  // Install api-port listener before signalling db-ready so any
  // immediately-following api-port message dispatches correctly.
  self.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.kind === "api-port" && e.ports[0]) {
      serveOnPort(e.ports[0], app as unknown as Router<object>);
      (self as unknown as Worker).postMessage({ kind: "ready" });

      console.log("[in-page worker] api port wired");
    }
  });

  (self as unknown as Worker).postMessage({ kind: "db-ready" });
}

// Signal "loaded" before awaiting config so the main thread knows
// the Worker is alive (and can install the SQL bridge in Tauri mode
// before the Worker tries to run any query).
(self as unknown as Worker).postMessage({ kind: "loaded" });

main().catch((e) => {
  console.error("[in-page worker] fatal:", e);
});
