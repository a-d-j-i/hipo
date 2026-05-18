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
  // OPFS-backed SQLite. The boot sequence has two distinct phases now
  // (Phase 6):
  //   1. Register the SW + COI reload — always needed.
  //   2. Check whether OPFS has been bootstrapped on this device:
  //      - Not yet: render the Bootstrap page; the Worker is NOT
  //        spawned (it would race against the bootstrap UI for the
  //        OPFS sqlocal lock). User finishes new-install or restore,
  //        page reloads, takes the bootstrapped branch on next boot.
  //      - Already: spawn the Worker, then mount the full app.
  if (import.meta.env.VITE_INPAGE_BACKEND) {
    const { registerInPageSW, spawnInPageWorker } = await import(
      "./in-page-backend"
    );
    await registerInPageSW();

    const { isOpfsBootstrapped } = await import("./bootstrap/opfs-state");
    const bootstrapped = await isOpfsBootstrapped();

    if (!bootstrapped) {
      const { default: BootstrapApp } = await import("./BootstrapApp");
      ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <React.StrictMode>
          <BootstrapApp />
        </React.StrictMode>,
      );
      return;
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
