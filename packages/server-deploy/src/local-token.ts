import { type Middleware, forbidden } from "@hipo/server";

/** Constant-time compare. Safe for short ASCII secrets like a 256-bit
 *  hex token; not a substitute for HMAC if the inputs are user-derived. */
function safeTokenEqual(
  provided: string | undefined,
  expected: string,
): boolean {
  if (typeof provided !== "string") return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Gates `/api/*` requests behind an `X-Hipo-Token` header matching
 *  `expectedToken`. Used by the Tauri shell to prevent other processes
 *  on the machine from hitting the local sidecar. Pass `undefined` (or
 *  empty) to disable — e.g. browser dev where there's no shell. */
export function requireLocalToken(
  expectedToken: string | undefined,
): Middleware {
  return async (c, next) => {
    if (!expectedToken) return await next();
    if (!c.url.pathname.startsWith("/api/")) return await next();
    if (
      !safeTokenEqual(
        c.req.headers.get("X-Hipo-Token") ?? undefined,
        expectedToken,
      )
    ) {
      throw forbidden();
    }
    return await next();
  };
}
