// SW ↔ Worker wire bridge.
//
// Topology (per the plan): Service Worker intercepts `/api/*`, forwards
// to a dedicated Web Worker via a MessageChannel, the Worker hosts the
// framework Router (with the consumer's routes + DB attached), router
// returns a Response, the Worker ships it back, SW reconstructs and
// hands it to the page.
//
// Wire format (kept small — `Request` and `Response` aren't structured-
// clonable, so we serialize the parts we need):
//
//   request:  { id, method, url, headers, body }
//   response: { id, status, statusText, headers, body }
//
// `headers` are arrays of [key, value] tuples so repeated headers
// (notably Set-Cookie) round-trip correctly.

import type { Router } from "./router.ts";

export type WireRequest = {
  id: string;
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string | null;
};

export type WireResponse = {
  id: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};

function headersToEntries(h: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // Headers.forEach merges multi-valued headers into a comma-joined
  // string except for Set-Cookie. getSetCookie() pulls those out
  // unmerged so each cookie round-trips as its own entry.
  h.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return;
    out.push([k, v]);
  });
  for (const sc of h.getSetCookie?.() ?? []) out.push(["set-cookie", sc]);
  return out;
}

function entriesToHeaders(entries: Array<[string, string]>): Headers {
  const h = new Headers();
  for (const [k, v] of entries) {
    if (k.toLowerCase() === "set-cookie") h.append("set-cookie", v);
    else h.set(k, v);
  }
  return h;
}

async function serializeRequest(req: Request, id: string): Promise<WireRequest> {
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? null
      : await req.clone().text();
  return {
    id,
    method: req.method,
    url: req.url,
    headers: headersToEntries(req.headers),
    body,
  };
}

async function serializeResponse(res: Response, id: string): Promise<WireResponse> {
  return {
    id,
    status: res.status,
    statusText: res.statusText,
    headers: headersToEntries(res.headers),
    body: await res.text(),
  };
}

function deserializeRequest(wire: WireRequest): Request {
  return new Request(wire.url, {
    method: wire.method,
    headers: entriesToHeaders(wire.headers),
    body: wire.body ?? undefined,
  });
}

function deserializeResponse(wire: WireResponse): Response {
  return new Response(wire.body, {
    status: wire.status,
    statusText: wire.statusText,
    headers: entriesToHeaders(wire.headers),
  });
}

/**
 * Worker side: receive `WireRequest`s on the port, dispatch through
 * the router, reply with `WireResponse`s. Errors during dispatch
 * become 500 responses (the router itself already converts
 * `AppError` to JSON; this catch is for unexpected throws).
 */
export function serveOnPort(
  port: MessagePort,
  app: Router<object>,
): void {
  port.addEventListener("message", async (ev: MessageEvent<WireRequest>) => {
    const wire = ev.data;
    let response: Response;
    try {
      const req = deserializeRequest(wire);
      // `app.fetch` is `(req: Request) => Promise<Response>` — the type
      // parameter on Router is structural; we don't constrain it here.
      response = await (app as unknown as { fetch: (r: Request) => Promise<Response> }).fetch(req);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[worker-bridge] dispatch error:", e);
      response = new Response(
        JSON.stringify({ error: "internal worker error" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    port.postMessage(await serializeResponse(response, wire.id));
  });
  port.start();
}

/**
 * SW side: serialize a Request, post it through the port, wait for the
 * matching response, return a Response.
 *
 * The caller owns request-id assignment and a pending-id map; this
 * function does one round-trip given a pre-allocated id.
 */
export async function dispatchOverPort(
  port: MessagePort,
  req: Request,
  id: string,
  awaitResponse: (id: string) => Promise<WireResponse>,
): Promise<Response> {
  const wire = await serializeRequest(req, id);
  port.postMessage(wire);
  const replyWire = await awaitResponse(id);
  return deserializeResponse(replyWire);
}
