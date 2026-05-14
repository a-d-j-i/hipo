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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
