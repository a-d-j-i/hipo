/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { hipoSw } from "@hipo/sw/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const backendPort = process.env.HIPO_BACKEND_PORT || "8787";
// @ts-expect-error process is a nodejs global
const INPAGE_BACKEND = process.env.VITE_INPAGE_BACKEND === "1";
// @ts-expect-error process is a nodejs global
const BASE_PATH = process.env.VITE_BASE_PATH || "/";

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: BASE_PATH,

  plugins: [
    react(),
    // sqlocal's Vite plugin sets COOP/COEP in dev so SQLite-WASM's OPFS
    // sync-access-handle mode works. Active only when running in-page;
    // dev with the Deno backend doesn't need it.
    ...(INPAGE_BACKEND ? [sqlocal() as never, hipoSw()] : []),
  ],

  // Keep @hipo/* workspace packages out of Vite's dep optimizer so their
  // exports conditions (notably @hipo/auth/passwords#browser) resolve on
  // the source files directly without a pre-bundled copy intercepting.
  optimizeDeps: INPAGE_BACKEND
    ? {
        exclude: [
          "@hipo/sqlite",
          "@hipo/server",
          "@hipo/auth",
          "@hipo/audit",
          "@hipo/shared",
          "hipo",
        ],
      }
    : undefined,

  build: {
    // Split heavy vendors into their own chunks so the antd bundle (the
    // dominant cost) can be cached separately from app code across deploys.
    // Route-level code-splitting in App.tsx (React.lazy) handles the rest.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // antd + everything antd's internal components reach for. The
          // extra patterns prevent a `vendor → antd → vendor` cycle by
          // keeping antd's transitive deps in the antd chunk.
          if (
            /node_modules\/(antd|@ant-design|rc-[^/]+|@rc-component|classnames|@ctrl\/tinycolor|@babel\/runtime|dayjs)/.test(
              id,
            )
          ) {
            return "antd";
          }
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          return "vendor";
        },
      },
    },
    // antd 5 with its rc-*/@rc-component/* transitive deps comes out to
    // ~1 MB minified (~310 KB gzipped). Anything below this is a chunk
    // we should split further.
    chunkSizeWarningLimit: 1100,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching the sibling desktop app (Rust + Tauri
      //    artifacts shouldn't trigger HMR).
      ignored: ["**/apps/desktop/**"],
    },
    // 4. proxy /api/* to the Deno backend so same-origin fetch works in
    //    browser dev. Configurable via HIPO_BACKEND_PORT (default 8787).
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: false,
      },
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
}));
