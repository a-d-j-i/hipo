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

  // In-page-backend shape: SW + Worker host the framework router and
  // a SQLite engine that varies by shape:
  //   - Browser / Pages: sqlocal + OPFS. Bootstrap UI gates the
  //     worker so the encrypted-backup ceremony can write the marker
  //     before the worker contends for sqlocal's OPFS lock. The
  //     ceremony is meaningful on browsers because OPFS can be wiped
  //     by browser data-clear or quota eviction.
  //   - Tauri (Phase 12): native SQLite in the Rust shell at
  //     <app_data_dir>/hipo.db. The DB is durable across reloads /
  //     reinstalls (Mechanism B per the plan), so there's no first-
  //     boot bootstrap to gate the worker behind. Spawn the worker
  //     immediately; let App.tsx's RequireSetup / RequireLogin
  //     guards route the user. Restore-from-backup on Tauri happens
  //     in Settings, not as a bootstrap-only path.
  if (import.meta.env.VITE_INPAGE_BACKEND) {
    const { registerInPageSW, spawnInPageWorker, detectShape } =
      await import("./in-page-backend");
    await registerInPageSW();

    // Acquire the single-tab Web Lock before touching OPFS. If another
    // tab already holds it, render the MultiTabBlock page (polls for
    // release, reloads automatically) and stop boot here. The lock
    // released held for the page lifetime; the browser releases it on
    // unload (we don't keep the returned `release` reference).
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

    if (detectShape() === "browser") {
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
    }

    await spawnInPageWorker();
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
