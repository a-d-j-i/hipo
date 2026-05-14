import type { User } from "@hipo/shared";
import type { Db } from "../db/client.ts";
import type { UserRow } from "../db/schema.ts";
import { forbidden, unauthorized } from "../errors.ts";

export type { AuthStatus, User } from "@hipo/shared";

/**
 * Per-request context handed to every do_* operation.
 * `user` is the authenticated user from the session middleware, or null.
 */
export type Ctx = {
  db: Db;
  user: User | null;
};

/** Map a raw DB row (camelCase, has passwordHash) to the public API shape. */
export function publicUser(u: UserRow): User {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    created_at: u.createdAt,
  };
}

export function requireAuth(ctx: Ctx): User {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): User {
  const me = requireAuth(ctx);
  if (me.role !== "admin") throw forbidden();
  return me;
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
