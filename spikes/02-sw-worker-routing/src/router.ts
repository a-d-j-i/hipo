// Minimal Hono-replacement router. Web Standard Request/Response in/out,
// isomorphic (works on any runtime that ships the Fetch API). ~50 LOC.

export type RouteContext = {
  req: Request;
  params: Record<string, string>;
  url: URL;
};

export type Handler = (c: RouteContext) => Promise<Response> | Response;

type Route = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
};

export class Router {
  private routes: Route[] = [];
  private errorHandler: (e: unknown) => Response = (e) =>
    new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  private add(method: string, path: string, handler: Handler) {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:(\w+)/g, (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method, pattern, paramNames, handler });
    return this;
  }

  get(path: string, handler: Handler) {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: Handler) {
    return this.add("POST", path, handler);
  }
  put(path: string, handler: Handler) {
    return this.add("PUT", path, handler);
  }
  delete(path: string, handler: Handler) {
    return this.add("DELETE", path, handler);
  }

  onError(fn: (e: unknown) => Response) {
    this.errorHandler = fn;
    return this;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramNames.forEach(
        (n, i) => (params[n] = decodeURIComponent(m[i + 1])),
      );
      try {
        return await r.handler({ req, params, url });
      } catch (e) {
        return this.errorHandler(e);
      }
    }
    return new Response(
      JSON.stringify({ error: `${req.method} ${url.pathname} not found` }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
}

// Tiny response helpers (Hono-style without the framework).
export const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
