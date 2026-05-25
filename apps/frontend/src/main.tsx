import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import { extractAuthToken } from "./api/http";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

async function bootstrap() {
  // When the Tauri shell opens the webview, it includes the localhost auth
  // token in the URL fragment (#token=...). Extract it before React mounts so
  // every fetch picks it up, then clear it from the URL.
  extractAuthToken();

  if (import.meta.env.VITE_USE_MOCKS) {
    await import("./mocks/ipc");
  }

  // In-page-backend boot: two topologies depending on shape.
  //   - Tauri: main-thread router + direct `invoke()` SQL. The
  //     production webview loads from `tauri://localhost/` on
  //     Linux/macOS, and WebKitGTK refuses to register a Service
  //     Worker over a non-http(s) origin — so the SW + Worker stack
  //     is structurally unavailable. Phase 12's rusqlite-via-IPC
  //     already removed the OPFS/COI/SAB justifications for it, so
  //     we run the router on the main thread and monkey-patch
  //     `fetch` for `/api/*`. The Tauri DB lives in the Rust shell
  //     at <app_data_dir>/hipo.db (Mechanism B), durable across
  //     reloads/reinstalls — no first-boot bootstrap ceremony.
  //   - Browser / Pages: SW + Worker host the framework router and
  //     sqlocal+OPFS. Bootstrap UI gates the Worker so the
  //     encrypted-backup ceremony writes the marker before sqlocal
  //     contends for OPFS. The Web Lock + multi-tab modal apply here
  //     too — OPFS is single-writer, and a second tab corrupts the
  //     pool.
  if (import.meta.env.VITE_INPAGE_BACKEND) {
    const { detectShape } = await import("./in-page-backend");
    const shape = detectShape();

    if (shape === "tauri") {
      const { bootInPageMainThread } = await import("./in-page-mainthread");
      await bootInPageMainThread();
    } else {
      const { registerInPageSW, spawnInPageWorker } = await import(
        "./in-page-backend"
      );
      await registerInPageSW();

      // Acquire the single-tab Web Lock before touching OPFS. If
      // another tab already holds it, render the MultiTabBlock page
      // (polls for release, reloads automatically) and stop boot
      // here. The lock is held for the page lifetime; the browser
      // releases it on unload (we don't keep the returned `release`
      // reference).
      const { tryAcquireLock } = await import("@hipo/server");
      const lock = await tryAcquireLock();
      if (!lock.acquired) {
        const { default: MultiTabBlock } = await import("./MultiTabBlock");
        ReactDOM.createRoot(
          document.getElementById("root") as HTMLElement,
        ).render(
          <React.StrictMode>
            <MultiTabBlock />
          </React.StrictMode>,
        );
        return;
      }

      const { isOpfsBootstrapped } = await import("./bootstrap/opfs-state");
      const bootstrapped = await isOpfsBootstrapped();

      if (!bootstrapped) {
        const { default: BootstrapApp } = await import("./BootstrapApp");
        ReactDOM.createRoot(
          document.getElementById("root") as HTMLElement,
        ).render(
          <React.StrictMode>
            <BootstrapApp />
          </React.StrictMode>,
        );
        return;
      }

      await spawnInPageWorker();
    }
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Auto-check for updates once mounted, only inside the Tauri shell. Browser
  // dev mode never reaches this branch because the global isn't set.
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    // Delay slightly so the initial paint isn't competing with the network
    // call. Errors are swallowed inside checkForUpdates.
    setTimeout(() => {
      import("./api/updater")
        .then((m) => m.checkForUpdates({ silent: true }))
        .catch((e) => console.warn("[hipo] updater bootstrap:", e));
    }, 2000);
  }
}

bootstrap();
