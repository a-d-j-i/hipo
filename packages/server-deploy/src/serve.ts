// serve(opts) — Deno HTTP shell for the local-first framework.
//
// Builds a Router, attaches the framework's stock middleware chain
// (security headers, optional CORS, optional X-Hipo-Token gate), runs
// the consumer's `build(app)` callback to attach app-specific session
// middleware + routes, optionally registers a SPA static fallback,
// then calls Deno.serve with a parseable READY line so a wrapping
// shell (Tauri, supervisord, etc.) can read the actual port.

import { type Router as _RouterT, Router } from "@hipo/server";
import { securityHeaders, type SecurityHeadersOptions } from "./security.ts";
import { cors, type CorsOptions } from "./cors.ts";
import { requireLocalToken } from "./local-token.ts";
import { staticSpa } from "./static-spa.ts";

declare const Deno: {
  serve(
    opts: ServeOptions,
    handler: (req: Request) => Promise<Response>,
  ): {
    finished: Promise<void>;
  };
};

type ServeOptions = {
  port: number;
  hostname: string;
  onListen?: (info: { hostname: string; port: number }) => void;
};

export type ServeAppOptions<TState extends object> = {
  /** TCP port. 0 means "pick an ephemeral port" — the consumer reads
   *  the actual port from the `onListen` READY line. */
  port: number;
  /** Bind address. Default 127.0.0.1 (loopback-only, the safe choice
   *  for desktop sidecars). Set 0.0.0.0 for hosted shapes. */
  hostname?: string;
  /** CORS allowlist. Omit for same-origin-only deployments. */
  cors?: CorsOptions;
  /** X-Hipo-Token gate for `/api/*`. Pass the token if running under
   *  a Tauri/supervisor shell; pass undefined for browser dev. */
  localToken?: string;
  /** Security-headers options. Pass `{csp: null}` to skip CSP. */
  security?: SecurityHeadersOptions;
  /** Static SPA fallback dir. Omit if the consumer doesn't serve a SPA. */
  staticDir?: string;
  /** Prefix of the READY log line. Tauri shells parse `HIPO_READY` by
   *  default; override for a consumer that needs its own marker. */
  readyPrefix?: string;
  /** Consumer hook — attach session middleware, register routes, etc. */
  build(app: Router<TState>): void | Promise<void>;
};

/** Boots a Deno HTTP server with the framework's default middleware
 *  chain. Returns the underlying server handle for shutdown control. */
export async function serve<TState extends object>(
  opts: ServeAppOptions<TState>,
): Promise<{ finished: Promise<void> }> {
  const app = new Router<TState>();

  // Stock middleware order: security headers (always), CORS (optional),
  // local-token gate (optional), then consumer middleware + routes.
  app.use(securityHeaders(opts.security ?? {}) as never);
  if (opts.cors) app.use(cors(opts.cors) as never);
  if (opts.localToken) app.use(requireLocalToken(opts.localToken) as never);

  await opts.build(app);

  if (opts.staticDir) {
    app.notFound(staticSpa({ staticDir: opts.staticDir }) as never);
  }

  const readyPrefix = opts.readyPrefix ?? "HIPO_READY";
  const hostname = opts.hostname ?? "127.0.0.1";

  return Deno.serve(
    {
      hostname,
      port: opts.port,
      onListen: ({ hostname, port }) => {
        // Single, parseable line so a wrapping shell can read the
        // actual port even when port=0 (ephemeral binding).
         
        console.log(`${readyPrefix} hostname=${hostname} port=${port}`);
      },
    },
    app.fetch,
  );
}
