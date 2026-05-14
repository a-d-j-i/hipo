import type { Db } from "../db/client.ts";
import type { User as DbUser } from "../db/schema.ts";
import { forbidden, unauthorized } from "../errors.ts";

/** Public user shape exposed over the API. Matches src/bindings/User.ts. */
export type PublicUser = {
  id: number;
  username: string;
  role: "admin" | "user";
  created_at: number;
};

export type AuthStatus = {
  needs_setup: boolean;
  current_user: PublicUser | null;
};

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
