/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string;
  /** Auto-login (and auto-setup-on-first-launch) after the initial
   *  auth_status call.
   *  - `1` / any truthy value: use `admin/admin123` (also used as setup
   *    credentials on first launch).
   *  - `user:pass`: use those exact credentials.
   *  Failures are logged to the console. */
  readonly VITE_AUTO_LOGIN?: string;
  /** Force a specific locale on app start, bypassing the detector
   *  (localStorage / navigator). Value: "es" | "en". */
  readonly VITE_LOCALE?: string;
  /** Enable the in-page-backend topology (SW + Worker + SQLite). Set
   *  by `dev:inpage` and `build:inpage`. */
  readonly VITE_INPAGE_BACKEND?: string;
  /** Which deploy target the bundle is being built for. Determines
   *  which SQLite engine ships in the Worker bundle:
   *   - `"tauri"`: native SQLite via Tauri IPC (no SQLite-WASM).
   *   - unset (default): sqlocal + SQLite-WASM + OPFS (browser / Pages).
   *  Used as a build-time literal so Rollup tree-shakes the unused
   *  driver imports out of the bundle. */
  readonly VITE_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
