// Vite plugin that serves the merged Service Worker (sw.js) from
// @hipo/sw's source. Two surfaces, same source file:
//
//   - dev: a connect middleware responds to any request whose path ends
//     in `/sw.js` with the package's sw.js. We can't rely on `public/`
//     directory copying because the canonical file lives outside the
//     consumer.
//   - build: emit `sw.js` at the build root so it sits next to
//     `index.html` with the matching scope.
//
// Consumers register at `${import.meta.env.BASE_URL}sw.js`; Vite's
// `base` config rebases the URL in both dev and build.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const SW_SOURCE = fileURLToPath(new URL("./sw.js", import.meta.url));

export function hipoSw(): Plugin {
  return {
    name: "@hipo/sw",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.endsWith("/sw.js")) return next();
        const body = readFileSync(SW_SOURCE);
        res.setHeader("Content-Type", "application/javascript");
        // Allow registering at the site root if a consumer ever wants to;
        // most use cases register at BASE_URL so the default scope is fine.
        res.setHeader("Service-Worker-Allowed", "/");
        res.statusCode = 200;
        res.end(body);
      });
    },

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: readFileSync(SW_SOURCE, "utf8"),
      });
    },
  };
}
