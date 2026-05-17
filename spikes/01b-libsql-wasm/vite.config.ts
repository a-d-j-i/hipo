import { defineConfig } from "vite";

// libsql-wasm doesn't ship a Vite plugin, so we set COOP/COEP manually.
// These headers put the page in a cross-origin isolated context, which
// libsql-wasm (and SQLite-WASM in general) needs for SharedArrayBuffer +
// OPFS sync access handle mode.
const coiHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    headers: coiHeaders,
  },
  preview: {
    port: 5174,
    headers: coiHeaders,
  },
  build: {
    // @libsql/client-wasm uses top-level await, so we need a target that
    // supports it. ESBuild defaults too low without this.
    target: "es2022",
  },
  optimizeDeps: {
    exclude: ["@libsql/client-wasm"],
  },
  worker: {
    format: "es",
  },
});
