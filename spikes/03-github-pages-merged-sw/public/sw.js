// Merged Service Worker — does two jobs in one artifact:
//
// 1. Injects COOP/COEP response headers on every same-origin response,
//    so the page becomes `crossOriginIsolated` even when the host
//    (GitHub Pages, plain nginx without config) doesn't set them.
//    This is the coi-serviceworker pattern, reimplemented here so we
//    own the fetch-event ordering. ~10 LOC of the SW.
//
// 2. Routes /api/* requests to a dedicated Worker via MessageChannel
//    (same protocol as spike 02).
//
// Build flag could disable either feature in the framework version
// (packages/sw exposes `coi` and `apiRoute` flags). For this spike
// both are always on.

/* global self, clients */

const API_PREFIX = "/api/";

// ── /api/* routing state ─────────────────────────────────────────────
let apiPort = null;
let portReady;
const portReadyPromise = new Promise((resolve) => {
  portReady = resolve;
});
const pending = new Map();

// ── SW lifecycle ─────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  // skipWaiting: don't wait for the old SW to finish before activating.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // claim: become controller of all open clients immediately.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.kind === "api-port" && event.ports[0]) {
    apiPort = event.ports[0];
    apiPort.addEventListener("message", (e) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      entry.resolve(e.data);
    });
    apiPort.start();
    portReady();
  }
});

// ── Fetch interception ───────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin (don't try to inject headers on third-party fetches).
  if (url.origin !== self.location.origin) return;

  // /api/* → route to Worker.
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(handleApi(event.request));
    return;
  }

  // Everything else → pass through, but rewrite headers to enable COI.
  event.respondWith(withCoiHeaders(event.request));
});

async function withCoiHeaders(request) {
  // For navigation requests with same-origin URL, we want COOP/COEP.
  // For static assets (JS/CSS/WASM), we need to be careful: the browser
  // requires the resource itself to either be served with the right CORP
  // header OR to come from a cross-origin-isolated context. Adding
  // COEP: require-corp means assets need CORP:same-origin. We rewrite
  // headers on the response to make this work.
  const response = await fetch(request);
  // Don't touch opaque responses (cross-origin, no-cors) — we'd break them.
  if (response.type === "opaque" || response.type === "opaqueredirect") {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // Tag own-origin resources as CORP:same-origin so they pass the COEP gate.
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleApi(request) {
  await portReadyPromise;
  if (!apiPort) {
    return new Response(JSON.stringify({ error: "api port not yet wired" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const id = crypto.randomUUID();
  const headers = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.text();
  const promise = new Promise((resolve) => {
    pending.set(id, { resolve });
  });
  apiPort.postMessage({
    id,
    method: request.method,
    url: request.url,
    headers,
    body,
  });
  const wire = await promise;
  return new Response(wire.body, {
    status: wire.status,
    statusText: wire.statusText,
    headers: wire.headers,
  });
}
