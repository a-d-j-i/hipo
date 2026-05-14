import type { User as PublicUserType } from "@hipo/shared";
import type { Db } from "../db/client.ts";
import type { User as DbUser } from "../db/schema.ts";
import { forbidden, unauthorized } from "../errors.ts";

export type { AuthStatus } from "@hipo/shared";
export type PublicUser = PublicUserType;

/**
 * Per-request context handed to every do_* operation.
 * `user` is the authenticated user from the session middleware, or null.
 */
export type Ctx = {
  db: Db;
  user: PublicUser | null;
};

export function publicUser(u: DbUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    created_at: u.createdAt,
  };
}

export function requireAuth(ctx: Ctx): PublicUser {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): PublicUser {
  const me = requireAuth(ctx);
  if (me.role !== "admin") throw forbidden();
  return me;
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
