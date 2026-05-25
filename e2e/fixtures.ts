import { createTauriTest } from "@srsholmes/tauri-playwright";
import { resolve } from "node:path";

// Tauri-mode fixtures only. Browser mode would mock IPC and bypass the
// rusqlite engine — the whole point of Phase 12 is to verify that the
// rusqlite path works end-to-end, so we deliberately don't expose a
// browser-mode test fixture here.
export const { test, expect } = createTauriTest({
  // Required when browser mode is also wired (Vite dev URL); harmless
  // for Tauri-mode runs.
  devUrl: "http://localhost:1420",
  // Unix socket the Rust `tauri-plugin-playwright` listens on. Must
  // match whatever the plugin defaults to — keeping the conventional
  // path so the test runner connects without extra Rust config.
  mcpSocket: "/tmp/tauri-playwright.sock",
  // Where the Tauri binary lives. We start it externally via
  // `npm run dev:desktop:e2e`; the fixture uses this for screenshot
  // paths etc. Resolved relative to the repo root (the test runner's
  // CWD when launched via the root `test:e2e:tauri` script).
  tauriCwd: resolve(process.cwd(), "apps/hipo/tauri"),
});
