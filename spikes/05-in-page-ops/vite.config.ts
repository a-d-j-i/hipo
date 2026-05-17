import { defineConfig } from "vite";
import sqlocal from "sqlocal/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Auth's operations.ts imports "./passwords.ts" (the @node-rs/argon2
// Node impl). For browser we need passwords.browser.ts. Vite's
// resolve.alias matches request specifiers, not absolute paths, so we
// intercept at resolveId. `enforce: "pre"` runs before Vite's
// built-in resolver so we beat the importer scan.
const swapPasswordsToBrowser = {
  name: "spike-05:passwords-browser-shim",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    if (
      source === "./passwords.ts" &&
      importer?.includes("/packages/auth/src/")
    ) {
      const target = resolve(
        here,
        "../../packages/auth/src/passwords.browser.ts",
      );
      // Helpful trace once the shim is verified to work.
      // eslint-disable-next-line no-console
      console.log("[spike-05] swap passwords.ts →", target);
      return target;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [
    // sqlocal()'s Vite plugin type drifts vs the Vite version in this
    // spike; runtime is fine, cast for type-check.
    sqlocal() as never,
    swapPasswordsToBrowser,
  ],
  // Workspace packages get pre-bundled by default, which would skip
  // our resolveId hook for their internal imports. Exclude them so
  // Vite walks each file fresh.
  optimizeDeps: {
    exclude: [
      "@hipo/sqlite",
      "@hipo/server",
      "@hipo/auth",
      "@hipo/audit",
      "@hipo/shared",
    ],
  },
  server: { port: 5178, strictPort: true },
  worker: { format: "es" },
});
