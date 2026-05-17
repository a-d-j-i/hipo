// Generic Ctx for do_* operations. Apps shape this further by adding
// fields. The framework only requires `db`; auth (`user`) is added
// by @hipo/auth's session middleware.
//
// Migrated from @hipo/auth/types in Phase 1C.

import type { Db } from "@hipo/sqlite";
import type { User } from "@hipo/shared";
import { forbidden, unauthorized } from "./errors.ts";

export type Ctx = {
  db: Db;
  user: User | null;
};

export function requireAuth(ctx: Ctx): User {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): User {
  const me = requireAuth(ctx);
  if (me.role !== "admin") throw forbidden();
  return me;
}
