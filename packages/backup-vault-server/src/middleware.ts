// vaultPatMiddleware — resolves ctx.user from a Bearer PAT token.
//
// Does NOT throw if the Authorization header is absent — this middleware
// composes with the session middleware so blob endpoints can be reached
// via either a session cookie (X-Hipo-Token / Cookie) or a vault PAT.
//
// If Authorization: Bearer <token> is present but the hash is not in
// vault_pats, the request is rejected with 401 so the caller knows the
// PAT is invalid rather than silently falling through as unauthenticated.

import { eq } from "drizzle-orm";
import type { Db } from "@hipo/sqlite";
import type { Middleware } from "@hipo/server";
import { unauthorized } from "@hipo/server";
import { users } from "@hipo/auth/schema";
import { publicUser, nowSecs } from "@hipo/auth";
import { vaultPats } from "./schema.ts";

// Reads the DB from the router's `c.state.db` (set by upstream session
// middleware), so callers don't have to pass it in. State-shape-agnostic;
// the consumer wires this onto any Router whose state has `db` + `user`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function vaultPatMiddleware(): Middleware<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: () => Promise<Response>) => {
    const authHeader = c.req.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      // No Bearer header — let the session middleware (already run)
      // handle auth. Continue without touching ctx.user.
      return await next();
    }

    const token = authHeader.slice(7).trim();
    if (!token) return await next();

    // Hash the token using Web Crypto, same as do_mintVaultPat.
    const encoded = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const tokenHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const db: Db = c.state.db;
    const rows = await db
      .select({ pat: vaultPats, user: users })
      .from(vaultPats)
      .innerJoin(users, eq(vaultPats.userId, users.id))
      .where(eq(vaultPats.tokenHash, tokenHash))
      .limit(1);

    if (rows.length === 0 || rows[0].user.deletedAt !== null) {
      throw unauthorized("invalid vault PAT");
    }

    // Set the user on state (overrides whatever the session middleware put).
    c.state.user = publicUser(rows[0].user);

    // Touch last_used_at lazily; no need to await.
    db
      .update(vaultPats)
      .set({ lastUsedAt: nowSecs() })
      .where(eq(vaultPats.tokenHash, tokenHash))
      .then(() => {})
      .catch(() => {});

    return await next();
  };
}
