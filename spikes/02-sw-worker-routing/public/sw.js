// Service worker: intercepts /api/* fetches and forwards to the dedicated
// Worker via a MessageChannel port supplied by the main thread.
// Plain JS so it can be served as a static asset from /public.

/* global self, clients */

const API_PREFIX = "/api/";
let apiPort = null;
let portReady;
const portReadyPromise = new Promise((resolve) => {
  portReady = resolve;
});

const pending = new Map(); // id → { resolve }

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Main thread sends us the port once the Worker is up.
self.addEventListener("message", (event) => {
  if (event.data?.kind === "api-port" && event.ports[0]) {
    apiPort = event.ports[0];
    apiPort.addEventListener("message", (e) => {
      const { id } = e.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(e.data);
    });
    apiPort.start();
    portReady();
    // eslint-disable-next-line no-console
    console.log("[sw] api port wired");
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(API_PREFIX)) return;
  event.respondWith(handleApi(event.request));
});

async function handleApi(request) {
  await portReadyPromise;
  if (!apiPort) {
    return new Response(
      JSON.stringify({ error: "api port not yet wired" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const id = crypto.randomUUID();
  const headers = {};
  request.headers.forEach((v, k) => (headers[k] = v));
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.text();

  const wire = {
    id,
    method: request.method,
    url: request.url,
    headers,
    body,
  };

  const responsePromise = new Promise((resolve) => {
    pending.set(id, { resolve });
  });
  apiPort.postMessage(wire);
  const wireResp = await responsePromise;
  return new Response(wireResp.body, {
    status: wireResp.status,
    statusText: wireResp.statusText,
    headers: wireResp.headers,
  });
}
