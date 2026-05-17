/// <reference lib="webworker" />
// Dedicated Web Worker. Hosts the router + Drizzle + sqlocal + SQLite-WASM.
// The main thread sends one end of a MessageChannel here; the SW sends API
// requests through it and we ship Responses back.

import { app } from "./routes.ts";

type WireRequest = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

type WireResponse = {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

let apiPort: MessagePort | null = null;

async function dispatch(msg: WireRequest, port: MessagePort) {
  const req = new Request(msg.url, {
    method: msg.method,
    headers: msg.headers,
    body: msg.body ?? undefined,
  });
  let resp: Response;
  try {
    resp = await app.fetch(req);
  } catch (e) {
    resp = new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const body = await resp.text();
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => (headers[k] = v));
  const wire: WireResponse = {
    id: msg.id,
    status: resp.status,
    statusText: resp.statusText,
    headers,
    body,
  };
  port.postMessage(wire);
}

self.addEventListener("message", (e: MessageEvent) => {
  if (e.data?.kind === "api-port" && e.ports[0]) {
    apiPort = e.ports[0];
    apiPort.addEventListener("message", (ev: MessageEvent<WireRequest>) => {
      void dispatch(ev.data, apiPort!);
    });
    apiPort.start();
    (self as unknown as Worker).postMessage({ kind: "ready" });
    // eslint-disable-next-line no-console
    console.log("[worker] api port wired");
  }
});

// Signal the main thread that we've loaded (before the port is wired).
(self as unknown as Worker).postMessage({ kind: "loaded" });
