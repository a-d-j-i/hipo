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
    const { registerInPageSW, spawnInPageWorker, detectShape } = await import(
      "./in-page-backend"
    );
    await registerInPageSW();

    // Bootstrap UI is browser-shape only — it uses sqlocal directly
    // (helpers.ts → client-browser → SQLite-WASM). Gating on the
    // build-time `VITE_TARGET` literal (not runtime `detectShape()`)
    // lets Rollup prove the whole bootstrap branch is dead in the
    // Tauri bundle, so `BootstrapApp` / `helpers.ts` / sqlocal / the
    // ~600 KB SQLite-WASM blobs all tree-shake out. `detectShape()`
    // still runs as a runtime defence-in-depth check.
    if (import.meta.env.VITE_TARGET !== "tauri") {
      if (detectShape() !== "browser") {
        throw new Error(
          "Running inside Tauri but built for the hosted shape — " +
            "use VITE_TARGET=tauri.",
        );
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
    } else if (detectShape() !== "tauri") {
      throw new Error(
        "VITE_TARGET=tauri build but no __TAURI_INTERNALS__ detected — " +
          "open via the Tauri shell.",
      );
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
