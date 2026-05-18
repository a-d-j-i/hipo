// In-page Worker entry. Opens an OPFS-backed SQLite DB, builds the
// framework Router with hipo's full route surface, listens for
// requests on a MessageChannel port and dispatches via the router.
//
// Loaded by the main thread (via `new Worker(...)`) at startup when
// `VITE_INPAGE_BACKEND=1`. Same source as apps/backend/src/server.ts
// minus Deno.serve + static SPA fallback (the SW handles non-/api
// fetches).

/// <reference lib="webworker" />

import { openDb } from "@hipo/sqlite/client-browser";
import { binaryFormat } from "@hipo/sqlite/binary-format-browser";
import { gzipped } from "@hipo/backup";
import { Router, serveOnPort } from "@hipo/server";
import {
  type AppState,
  sessionMiddleware,
} from "@hipo/backend/middleware-session";
import { registerAllRoutes } from "@hipo/backend/routes";
import { migrations } from "@hipo/backend/migrations";

async function main(): Promise<void> {
  const { db, local } = await openDb({
    databasePath: "hipo.sqlite3",
    migrations,
  });
  // Same "binary-gzip" envelope as the Deno shape so backups
  // round-trip between shapes.
  const backupFormat = gzipped(binaryFormat({ local }));

  const app = new Router<AppState>();

  // Security headers: not strictly needed for in-page (no cross-origin
  // surface), but the same middleware that runs on Deno runs here so
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

  // Listen for the MessageChannel port from the main thread.
  self.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.kind === "api-port" && e.ports[0]) {
      serveOnPort(e.ports[0], app as unknown as Router<object>);
      (self as unknown as Worker).postMessage({ kind: "ready" });
      // eslint-disable-next-line no-console
      console.log("[in-page worker] api port wired");
    }
  });

  // Tell the main thread we're loaded (before the port arrives).
  (self as unknown as Worker).postMessage({ kind: "loaded" });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[in-page worker] fatal:", e);
});
