/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { hipoSw } from "@hipo/sw/vite";

// @ts-expect-error process is a nodejs global
const BASE_PATH = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base: BASE_PATH,

  plugins: [
    react(),
    // sqlocal's Vite plugin sets COOP/COEP in dev so SQLite-WASM's OPFS
    // sync-access-handle mode works (required by the in-page Worker).
    sqlocal() as never,
    hipoSw(),
  ],

  // Keep @hipo/* workspace packages out of Vite's dep optimizer so their
  // exports conditions (notably @hipo/auth/passwords#browser) resolve on
  // the source files directly without a pre-bundled copy intercepting.
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
