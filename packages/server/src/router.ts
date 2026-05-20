// Hand-rolled router replacing Hono. Web Standard Request/Response,
// path params, middleware chain, typed per-request state.
//
// Designed for two runtimes: in-page Worker (Spike 2) and a real
// HTTP server (`Deno.serve(router.fetch)`). Same code in both.

import { AppError } from "./errors.ts";

export type RouteContext<TState extends object = Record<string, unknown>> = {
  req: Request;
  params: Record<string, string>;
  url: URL;
  /** App-defined per-request state. Populated by middleware (e.g. session). */
  state: TState;
  /**
   * Headers the handler accumulates onto the final response. Lets
   * middleware (`use`) add security headers regardless of which
   * handler returned.
   */
  resHeaders: Headers;
};

export type Handler<TState extends object = Record<string, unknown>> = (
  c: RouteContext<TState>,
) => Promise<Response> | Response;

export type Middleware<TState extends object = Record<string, unknown>> = (
  c: RouteContext<TState>,
  next: () => Promise<Response>,
) => Promise<Response>;

type Route<TState extends object> = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  chain: Middleware<TState>[];
};

function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regex = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp("^" + regex + "/?$"), paramNames };
}

function wrapHandler<TState extends object>(
  h: Handler<TState>,
): Middleware<TState> {
  return async (c) => h(c);
}

function applyHeaders(res: Response, headers: Headers): Response {
  if (headers.entries().next().done) return res;
  const merged = new Headers(res.headers);
  // Set-Cookie can have multiple values for one key and must NOT be
  // comma-joined. Headers.forEach yields the comma-joined version for
  // multi-valued headers, which corrupts cookies. Handle set-cookie
  // separately via getSetCookie (Headers API since 2023).
  headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return;
    merged.set(k, v);
  });
  for (const sc of headers.getSetCookie?.() ?? []) {
    merged.append("set-cookie", sc);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}

export class Router<TState extends object = Record<string, unknown>> {
  private routes: Route<TState>[] = [];
  private globalMiddleware: Middleware<TState>[] = [];
  /** Final fallback when no route matches. */
  private notFoundHandler: Handler<TState> = () =>
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  /** Add a middleware that runs on every request, in registration order. */
  use(mw: Middleware<TState>): this {
    this.globalMiddleware.push(mw);
    return this;
  }

  /** Set the fallback handler used when no route matches (default: 404 JSON). */
  notFound(h: Handler<TState>): this {
    this.notFoundHandler = h;
    return this;
  }

  private add(
    method: string,
    path: string,
    chain: (Middleware<TState> | Handler<TState>)[],
  ): this {
    if (chain.length === 0) {
      throw new Error(`route ${method} ${path} has no handler`);
    }
    const compiled = compilePath(path);
    const last = chain.pop()!;
    const middlewares = chain as Middleware<TState>[];
    this.routes.push({
      method,
      pattern: compiled.pattern,
      paramNames: compiled.paramNames,
      chain: [...middlewares, wrapHandler(last as Handler<TState>)],
    });
    return this;
  }

  // Overloads so TS infers the right shape for the handler at the end of
  // `[...middlewares, handler]`. Without these, c's type collapses to
  // (Middleware | Handler) and arrow params lose their typing.
  get(path: string, handler: Handler<TState>): this;
  get(path: string, mw: Middleware<TState>, handler: Handler<TState>): this;
  get(
    path: string,
    mw1: Middleware<TState>,
    mw2: Middleware<TState>,
    handler: Handler<TState>,
  ): this;
  get(path: string, ...chain: (Middleware<TState> | Handler<TState>)[]): this {
    return this.add("GET", path, chain);
  }

  post(path: string, handler: Handler<TState>): this;
  post(path: string, mw: Middleware<TState>, handler: Handler<TState>): this;
  post(
    path: string,
    mw1: Middleware<TState>,
    mw2: Middleware<TState>,
    handler: Handler<TState>,
  ): this;
  post(path: string, ...chain: (Middleware<TState> | Handler<TState>)[]): this {
    return this.add("POST", path, chain);
  }

  put(path: string, handler: Handler<TState>): this;
  put(path: string, mw: Middleware<TState>, handler: Handler<TState>): this;
  put(
    path: string,
    mw1: Middleware<TState>,
    mw2: Middleware<TState>,
    handler: Handler<TState>,
  ): this;
  put(path: string, ...chain: (Middleware<TState> | Handler<TState>)[]): this {
    return this.add("PUT", path, chain);
  }

  patch(path: string, handler: Handler<TState>): this;
  patch(path: string, mw: Middleware<TState>, handler: Handler<TState>): this;
  patch(
    path: string,
    mw1: Middleware<TState>,
    mw2: Middleware<TState>,
    handler: Handler<TState>,
  ): this;
  patch(
    path: string,
    ...chain: (Middleware<TState> | Handler<TState>)[]
  ): this {
    return this.add("PATCH", path, chain);
  }

  delete(path: string, handler: Handler<TState>): this;
  delete(path: string, mw: Middleware<TState>, handler: Handler<TState>): this;
  delete(
    path: string,
    mw1: Middleware<TState>,
    mw2: Middleware<TState>,
    handler: Handler<TState>,
  ): this;
  delete(
    path: string,
    ...chain: (Middleware<TState> | Handler<TState>)[]
  ): this {
    return this.add("DELETE", path, chain);
  }

  /** Web Standard fetch — Deno.serve, in-page Worker, Cloudflare all work. */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const state = {} as TState;
    const resHeaders = new Headers();
    const c: RouteContext<TState> = { req, params: {}, url, state, resHeaders };

    let matched: Route<TState> | null = null;
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      r.paramNames.forEach(
        (n, i) => (c.params[n] = decodeURIComponent(m[i + 1])),
      );
      matched = r;
      break;
    }

    const handlerChain: Middleware<TState>[] = matched
      ? [...this.globalMiddleware, ...matched.chain]
      : [...this.globalMiddleware, wrapHandler(this.notFoundHandler)];

    const dispatch = async (i: number): Promise<Response> => {
      if (i >= handlerChain.length) {
        // Should be unreachable: chain always ends in a wrapped handler.
        return new Response(null, { status: 500 });
      }
      try {
        return await handlerChain[i](c, () => dispatch(i + 1));
      } catch (e) {
        if (e instanceof AppError) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: e.status,
            headers: { "content-type": "application/json" },
          });
        }
        // Unexpected errors get logged and become 500. App can override
        // by catching in its own middleware (run earlier in the chain).
        console.error("[router] unhandled error:", e);
        return new Response(
          JSON.stringify({ error: "internal server error" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
    };

    const res = await dispatch(0);
    return applyHeaders(res, resHeaders);
  };
}

// Small response helpers — Hono-replacement ergonomics without the framework.
export const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

export const text = (body: string, init?: ResponseInit) =>
  new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

export const empty = (status = 204) => new Response(null, { status });
