// Merged Service Worker for hipo's in-page backend.
//
// Two responsibilities in one artifact (a page can only register one
// SW per scope, so they have to coexist here):
//
//   1. COOP/COEP injection on every same-origin response, so
//      `crossOriginIsolated === true` even on hosts that don't set
//      those headers (e.g. GitHub Pages).
//   2. /api/* routing: serialize the request, hand it to the
//      dedicated Worker via a MessageChannel port (received from the
//      main thread at boot), wait for the matching response, return it.
//
// Wire format is kept in lockstep with packages/server/worker-bridge.ts:
//   request:  { id, method, url, headers: [[k,v],...], body }
//   response: { id, status, statusText, headers: [[k,v],...], body }
//
// Headers as arrays so Set-Cookie (which can appear multiple times)
// round-trips cleanly.
//
// Source-of-truth design is in spike-02 / spike-03 README; this file
// is the production-bound version that hipo's frontend serves.

/* global self, clients */

const API_PREFIX = "/api/";

// ── /api/* routing state ─────────────────────────────────────────────
let apiPort = null;
let portReady;
const portReadyPromise = new Promise((resolve) => {
  portReady = resolve;
});
const pending = new Map(); // id → { resolve }

// ── SW lifecycle ─────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
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
    // eslint-disable-next-line no-console
    console.log("[sw] api port wired");
  }
});

// ── Fetch interception ───────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip cross-origin; we only inject COI / route APIs for our origin.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(handleApi(event.request));
    return;
  }

  // Everything else (HTML, JS, CSS, WASM) → pass through, but rewrite
  // headers to enable cross-origin isolation.
  event.respondWith(withCoiHeaders(event.request));
});

async function withCoiHeaders(request) {
  const response = await fetch(request);
  // Don't touch opaque responses — we'd corrupt them.
  if (response.type === "opaque" || response.type === "opaqueredirect") {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function headersToEntries(h) {
  const out = [];
  h.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return;
    out.push([k, v]);
  });
  // Some browsers (Safari < 17) don't expose getSetCookie on Headers
  // from a Request — set-cookie only matters on responses anyway, so
  // this is a no-op for the request leg.
  if (typeof h.getSetCookie === "function") {
    for (const sc of h.getSetCookie()) out.push(["set-cookie", sc]);
  }
  return out;
}

function entriesToHeaders(entries) {
  const h = new Headers();
  for (const [k, v] of entries) {
    if (k.toLowerCase() === "set-cookie") h.append("set-cookie", v);
    else h.set(k, v);
  }
  return h;
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
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.clone().text();

  const wire = {
    id,
    method: request.method,
    url: request.url,
    headers: headersToEntries(request.headers),
    body,
  };

  const responsePromise = new Promise((resolve) => {
    pending.set(id, { resolve });
  });
  apiPort.postMessage(wire);
  const replyWire = await responsePromise;
  return new Response(replyWire.body, {
    status: replyWire.status,
    statusText: replyWire.statusText,
    headers: entriesToHeaders(replyWire.headers),
  });
}
