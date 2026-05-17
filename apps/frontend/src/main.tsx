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
  // OPFS-backed SQLite. After this returns, vanilla `fetch("/api/...")`
  // is served entirely in-browser. No Deno running.
  if (import.meta.env.VITE_INPAGE_BACKEND) {
    const { bootInPageBackend } = await import("./in-page-backend");
    await bootInPageBackend();
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
