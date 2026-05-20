// In-page Worker entry. Opens the DB (sqlocal+OPFS on browsers,
// Tauri-IPC bridge on Tauri per Phase 12), builds the framework
// Router with hipo's full route surface, and dispatches /api/*
// requests sent by the Service Worker over a MessageChannel port.
//
// Same source as apps/backend/src/server.ts minus `Deno.serve` and
// the static-SPA fallback (the SW handles non-/api fetches).

/// <reference lib="webworker" />

import { gzipped, type BackupFormat } from "@hipo/backup";
import { Router, serveOnPort } from "@hipo/server";
import {
  type AppState,
  sessionMiddleware,
} from "@hipo/backend/middleware-session";
import { registerAllRoutes } from "@hipo/backend/routes";
import { migrations } from "@hipo/backend/migrations";
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
  // `import.meta.env.VITE_TARGET` is replaced by Vite with a literal
  // string ("tauri" or undefined) at build time, so exactly one
  // branch survives tree-shaking in any given bundle:
  //   - VITE_TARGET=tauri: sqlocal + SQLite-WASM are dropped
  //     (~600 KB gz). Worker ships only the IPC bridge driver.
  //   - VITE_TARGET unset: @hipo/sqlite/client-tauri-bridge +
  //     binary-format-tauri are dropped from the Pages/browser
  //     bundle.
  // The `shape` check is the runtime defence-in-depth — it catches
  // mismatched configurations (Tauri build opened in a browser, or
  // hosted build inside a Tauri webview) with a clear error rather
  // than silent breakage.
  if (import.meta.env.VITE_TARGET === "tauri") {
    if (shape !== "tauri") {
      throw new Error(
        "VITE_TARGET=tauri build but no __TAURI_INTERNALS__ detected — " +
          "open via the Tauri shell, not a regular browser.",
      );
    }
    const [{ openDb }, { binaryFormat }] = await Promise.all([
      import("@hipo/sqlite/client-tauri-bridge"),
      import("@hipo/sqlite/binary-format-tauri"),
    ]);
    const opened = await openDb({ migrations });
    return { db: opened.db, backupFormat: gzipped(binaryFormat()) };
  }

  if (shape === "tauri") {
    throw new Error(
      "Running inside Tauri but this build targets the hosted shape — " +
        "use VITE_TARGET=tauri (or `npm run dev:desktop` / a Tauri build).",
    );
  }
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
      // eslint-disable-next-line no-console
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
  // eslint-disable-next-line no-console
  console.error("[in-page worker] fatal:", e);
});
