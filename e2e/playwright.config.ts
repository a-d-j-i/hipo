import { defineConfig } from "@playwright/test";

// Phase 12 smoke configuration for the Tauri shape. We only define
// the `tauri` project — `mode: 'tauri'` connects to the socket bridge
// embedded by `tauri-plugin-playwright` inside the running app. The
// app itself must be started separately with
// `npm run dev:e2e -w @hipo/desktop`; this config does NOT spawn it
// via `webServer` (that would start Vite without Tauri, and the
// playwright plugin needs the Rust socket, not the dev server).

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },

  projects: [
    {
      name: "tauri",
      use: {
        // @ts-expect-error — custom fixture option provided by createTauriTest
        mode: "tauri",
        trace: "off",
        screenshot: "off",
      },
    },
  ],
});
