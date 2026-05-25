// Main-thread boot for the Tauri shape.
//
// Background: in a release Tauri build on Linux (and macOS), the
// webview loads the bundled frontend from `tauri://localhost/`.
// WebKitGTK refuses `navigator.serviceWorker.register()` on any
// origin whose scheme isn't `http:` or `https:`, so the SW + Worker
// topology (`in-page-{backend,worker}.ts`) blows up at boot.
//
// Phase 12 already moved Tauri's SQL substrate off OPFS-WASM and
// onto rusqlite-via-IPC, so COOP/COEP + SAB + dedicated-worker
// isolation aren't structurally needed on the Tauri shape — they
// were just inherited from the browser topology. This module
// replaces them with a strictly simpler stack:
//
//   1. Open the DB via `@hipo/sqlite/client-tauri` (direct `invoke`
//      from the main thread — no Worker bridge).
//   2. Build the same `Router<AppState>` the in-page Worker builds,
//      with the same middleware + route surface.
//   3. Monkey-patch `window.fetch` so `/api/*` requests dispatch
//      directly into `app.fetch(req)`; everything else passes
//      through (Vite asset fetches in dev, `tauri://` asset reads
//      in prod).
//
// The browser/Pages shape keeps its SW + Worker topology untouched —
// OPFS still needs a Worker for sync-access-handles. See
// `main.tsx` for the shape-aware branch.

import { gzipped } from "@hipo/backup";
import { Router } from "@hipo/server";
import { openDb } from "@hipo/sqlite/client-tauri";
import { binaryFormat } from "@hipo/sqlite/binary-format-tauri";
import { type AppState, sessionMiddleware } from "hipo/middleware-session";
import { registerAllRoutes } from "hipo/routes";
import { migrations } from "hipo/migrations";

export async function bootInPageMainThread(): Promise<void> {
  console.log("[in-page main] opening rusqlite via Tauri invoke…");
  const { db } = await openDb({ migrations });

  const app = new Router<AppState>();

  // Mirror in-page-worker.ts's middleware so route handlers see the
  // same headers and session shape regardless of topology.
  app.use(async (_c, next) => {
    const res = await next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  });
  app.use(sessionMiddleware(db));

  registerAllRoutes(app, { backupFormat: gzipped(binaryFormat()) });

  const originalFetch = window.fetch.bind(window);
  const router = app as unknown as { fetch: (r: Request) => Promise<Response> };

  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
      window.location.origin,
    );
    if (!url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }
    // Reconstruct a Request that the router can dispatch. Using
    // `url.toString()` rather than the original `input` normalises
    // relative paths; `init` carries method/headers/body unchanged.
    const req = new Request(url.toString(), init as RequestInit | undefined);
    return router.fetch(req);
  };

  console.log("[in-page main] /api/* fetch interceptor installed");
}
