/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sqlocal from "sqlocal/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const backendPort = process.env.HIPO_BACKEND_PORT || "8787";
// @ts-expect-error process is a nodejs global
const INPAGE_BACKEND = process.env.VITE_INPAGE_BACKEND === "1";
// @ts-expect-error process is a nodejs global
const TARGET_TAURI = process.env.VITE_TARGET === "tauri";

const here = dirname(fileURLToPath(import.meta.url));

// @hipo/auth/operations.ts imports "./passwords.ts" (the @node-rs/argon2
// Node impl). The in-page Worker needs the hash-wasm browser impl.
// Same shim spike-05 uses; framework-level conditional-exports fix is
// pending. Active for all builds because the in-page-worker module
// is always reachable when the in-page-backend flag is on.
const swapPasswordsToBrowser = {
  name: "hipo:passwords-browser-shim",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (
      source === "./passwords.ts" &&
      importer?.includes("/packages/auth/src/")
    ) {
      return resolve(
        here,
        "../../packages/auth/src/passwords.browser.ts",
      );
    }
    return null;
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    // sqlocal's Vite plugin sets COOP/COEP in dev (for OPFS sync-
    // access-handle mode) and configures pre-bundling for SQLite-WASM.
    // The Tauri shape doesn't load sqlocal at all (Phase 12 routes
    // through rusqlite via IPC), so excluding the plugin lets Rollup
    // tree-shake sqlocal's pre-bundled worker chunks out of the build.
    // Dev (browser) and prod (browser/Pages) keep it.
    ...(INPAGE_BACKEND && !TARGET_TAURI
      ? [sqlocal() as never, swapPasswordsToBrowser]
      : []),
    // The passwords-browser shim is still needed even in Tauri builds
    // because the in-page-worker pulls @hipo/auth via @hipo/backend.
    ...(INPAGE_BACKEND && TARGET_TAURI ? [swapPasswordsToBrowser] : []),
  ],

  // The in-page Worker is bundled by Vite as a separate Rollup pass —
  // top-level `plugins` don't reach it during `vite build`. Re-register
  // the passwords-browser shim here so the Worker chunk also swaps
  // `passwords.ts` → `passwords.browser.ts`. Without this the Worker
  // bundle resolves `@node-rs/argon2` (the Deno-only native binding)
  // and the build fails.
  worker: INPAGE_BACKEND
    ? {
        format: "es" as const,
        plugins: () => [swapPasswordsToBrowser],
      }
    : undefined,

  // Tauri target: alias sqlocal and its transitive WASM runtime to a
  // throwing stub. The browser-shape bootstrap UI and `client-browser`
  // remain in the source tree but should never execute on Tauri (the
  // VITE_TARGET conditionals in main.tsx + in-page-worker.ts gate them
  // out at runtime). Aliasing means Vite's worker / WASM emitter never
  // walks sqlocal's internals, dropping the ~600 KB gz of sqlite-wasm
  // assets from the Tauri build output.
  resolve: TARGET_TAURI
    ? {
        alias: [
          {
            find: /^sqlocal$/,
            replacement: resolve(here, "src/_empty-sqlocal-stub.ts"),
          },
          {
            find: /^sqlocal\/drizzle$/,
            replacement: resolve(here, "src/_empty-sqlocal-stub.ts"),
          },
          {
            find: /^@sqlite\.org\/sqlite-wasm$/,
            replacement: resolve(here, "src/_empty-sqlocal-stub.ts"),
          },
        ],
      }
    : undefined,

  // Keep @hipo/* workspace packages out of Vite's dep optimizer so our
  // resolveId shim sees their imports unfiltered. Only when in-page.
  optimizeDeps: INPAGE_BACKEND
    ? {
        exclude: [
          "@hipo/sqlite",
          "@hipo/server",
          "@hipo/auth",
          "@hipo/audit",
          "@hipo/shared",
          "@hipo/backend",
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
