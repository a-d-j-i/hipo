import { defineConfig } from "vite";
import sqlocal from "sqlocal/vite";

// GitHub Pages serves the repo at https://<user>.github.io/<repo>/.
// Vite needs `base` so all emitted asset paths include /<repo>/.
// Pass at build time: BASE_PATH=/your-repo-name/ npm run build
// (Defaults to "/" for local dev, which works at http://127.0.0.1:5176.)
// `process` is a Node global in Vite's config context — typed via the
// `globalThis` cast to avoid needing @types/node for this single use.
const base =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env
    ?.BASE_PATH ?? "/";

export default defineConfig({
  base,
  // sqlocal's Vite plugin sets COOP/COEP for the dev server. In production
  // those headers will be injected by our merged service worker — that's
  // the whole point of this spike.
  plugins: [sqlocal()],
  server: {
    port: 5176,
    strictPort: true,
  },
  worker: {
    format: "es",
  },
});
