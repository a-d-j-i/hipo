/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// @hipo/auth/operations.ts imports "./passwords.ts" (the @node-rs/argon2
// Node impl). The in-page Worker needs the hash-wasm browser impl.
// This shim intercepts the resolve and redirects to the browser variant.
// The proper conditional-exports fix is a deferred TODO (framework-level);
// keeping the same inline shim pattern as apps/frontend/vite.config.ts.
const swapPasswordsToBrowser = {
  name: "minimal:passwords-browser-shim",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (
      source === "./passwords.ts" &&
      importer?.includes("/packages/auth/src/")
    ) {
      return resolve(here, "../../packages/auth/src/passwords.browser.ts");
    }
    return null;
  },
};

export default defineConfig({
  plugins: [
    react(),
    // sqlocal's Vite plugin sets COOP/COEP in dev so SQLite-WASM's OPFS
    // sync-access-handle mode works (required by the in-page Worker).
    sqlocal() as never,
    swapPasswordsToBrowser,
  ],

  // Keep @hipo/* workspace packages out of Vite's dep optimizer so our
  // resolveId shim sees their imports unfiltered.
  optimizeDeps: {
    exclude: [
      "@hipo/sqlite",
      "@hipo/server",
      "@hipo/auth",
      "@hipo/audit",
      "@hipo/backup",
      "@hipo/backup-local",
    ],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },

  server: {
    port: 1430,
    strictPort: true,
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
  },
});
