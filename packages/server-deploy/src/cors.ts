import type { Middleware } from "@hipo/server";

export type CorsOptions = {
  allowedOrigins: ReadonlySet<string>;
  credentials?: boolean;
  /** Methods echoed in preflight responses. */
  methods?: string[];
  /** Headers echoed in preflight responses. Defaults include
   *  `content-type` + `x-hipo-token` for backwards-compat with the
   *  framework's existing session-transport header. */
  allowedHeaders?: string[];
};

/** Origin-allowlist CORS. Non-matching origins get no
 *  `Access-Control-Allow-Origin` (browser blocks). Preflights
 *  short-circuit with 204. */
export function cors(opts: CorsOptions): Middleware {
  const methods = (opts.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"]).join(", ");
  const allowedHeaders = (opts.allowedHeaders ?? ["content-type", "x-hipo-token"]).join(", ");

  return async (c, next) => {
    const origin = c.req.headers.get("origin");
    const allow = origin && opts.allowedOrigins.has(origin);

    if (allow) {
      c.resHeaders.set("Access-Control-Allow-Origin", origin);
      if (opts.credentials) {
        c.resHeaders.set("Access-Control-Allow-Credentials", "true");
      }
      c.resHeaders.set("Vary", "Origin");
    }

    if (c.req.method === "OPTIONS") {
      const headers = new Headers();
      if (allow) {
        headers.set("Access-Control-Allow-Origin", origin);
        if (opts.credentials) headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Access-Control-Allow-Methods", methods);
        headers.set("Access-Control-Allow-Headers", allowedHeaders);
        headers.set("Access-Control-Max-Age", "86400");
        headers.set("Vary", "Origin");
      }
      return new Response(null, { status: 204, headers });
    }

    return await next();
  };
}
