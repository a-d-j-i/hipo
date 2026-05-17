// Auth type re-exports + auth-specific helpers.
// Ctx and the auth-guards live in @hipo/server (substrate); we
// re-export them here so existing imports work and so the auth
// package can document them as its public surface.

import type { User } from "@hipo/shared";
import type { UserRow } from "./schema.ts";

export type { AuthStatus, User } from "@hipo/shared";
export { type Ctx, requireAdmin, requireAuth } from "@hipo/server";

/** Map a raw DB row (camelCase, has passwordHash) to the public API shape. */
export function publicUser(u: UserRow): User {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    created_at: u.createdAt,
  };
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
