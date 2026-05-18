import type { Middleware } from "@hipo/server";

/** A sensible default CSP for a same-origin SPA + JSON API. Consumers
 *  override individual directives by passing `csp` to `securityHeaders`.
 *  antd's css-in-js needs `'unsafe-inline'` on `style-src`; scripts
 *  never need it. */
export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

export type SecurityHeadersOptions = {
  /** Full Content-Security-Policy value. Pass `null` to skip CSP. */
  csp?: string | null;
};

/** Blanket security headers on every response. CSP applied only to
 *  `text/html` responses (other content types ignore it anyway). */
export function securityHeaders(opts: SecurityHeadersOptions = {}): Middleware {
  const csp = opts.csp === undefined ? DEFAULT_CSP : opts.csp;
  return async (_c, next) => {
    const res = await next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Frame-Options", "DENY");
    if (csp !== null) {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.startsWith("text/html")) {
        res.headers.set("Content-Security-Policy", csp);
      }
    }
    return res;
  };
}
