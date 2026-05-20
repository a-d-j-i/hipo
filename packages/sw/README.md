# @hipo/sw

The merged Service Worker the in-page framework consumers register:

1. **COOP/COEP injection** on every same-origin response, so
   `crossOriginIsolated === true` on hosts that don't set those headers
   themselves (e.g. GitHub Pages).
2. **`/api/*` routing** — serialize the request, hand it to the dedicated
   Worker via a `MessageChannel` port (received from the main thread at
   boot), wait for the matching response, return it.

Wire format is kept in lockstep with `@hipo/server/worker-bridge`.

## Usage

```ts
// vite.config.ts
import { hipoSw } from "@hipo/sw/vite";

export default defineConfig({
  plugins: [hipoSw()],
});
```

The plugin serves `sw.js` from the package source in `vite dev` and emits
it at the build root for `vite build`. Consumers must register it from
the main thread at the configured `BASE_URL`:

```ts
const swUrl = `${import.meta.env.BASE_URL}sw.js`;
await navigator.serviceWorker.register(swUrl, {
  scope: import.meta.env.BASE_URL,
});
```
