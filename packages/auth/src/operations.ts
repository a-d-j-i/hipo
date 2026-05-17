import { and, asc, eq, isNull } from "drizzle-orm";
import { users } from "./schema.ts";
import { badRequest, conflict, notFound, tooManyRequests } from "@hipo/server";
import { writeAudit } from "@hipo/audit";
import { hashPassword, verifyPassword } from "./passwords.ts";
import {
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
} from "./rate-limit.ts";
import { validatePassword, validateUsername } from "./validators.ts";
import {
  type AuthStatus,
  type Ctx,
  nowSecs,
  publicUser,
  type User,
  requireAdmin,
  requireAuth,
} from "./types.ts";

async function activeUserCount(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.select().from(users).where(isNull(users.deletedAt));
  return rows.length;
}

async function findUserByUsername(ctx: Ctx, username: string) {
  const rows = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.username, username), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("UNIQUE") || msg.includes("constraint failed");
}

// ---------- Reads ----------

export async function doAuthStatus(ctx: Ctx): Promise<AuthStatus> {
  const count = await activeUserCount(ctx);
  return { needs_setup: count === 0, current_user: ctx.user };
}

export async function doCurrentUser(ctx: Ctx): Promise<User | null> {
  return ctx.user;
}

export async function doListUsers(ctx: Ctx): Promise<User[]> {
  requireAdmin(ctx);
  const rows = await ctx.db
    .select()
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(asc(users.username));
  return rows.map(publicUser);
}

// ---------- Writes ----------

export async function doSetupFirstAdmin(
  ctx: Ctx,
  args: { username: string; password: string },
): Promise<User> {
  validateUsername(args.username);
  validatePassword(args.password);
  if ((await activeUserCount(ctx)) > 0)
    throw badRequest("setup already completed");

  const trimmed = args.username.trim();
  const hash = await hashPassword(args.password);
  const now = nowSecs();

  return await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        username: trimmed,
        passwordHash: hash,
        role: "admin",
        createdAt: now,
      })
      .returning();
    const pub = publicUser(row);
    await writeAudit(tx, row.id, "user.setup_first_admin", "user", row.id, {
      after: pub,
    });
    return pub;
  });
}

export async function doLogin(
  ctx: Ctx,
  args: { username: string; password: string },
): Promise<User> {
  const trimmed = args.username.trim();
  if (isLoginLocked(trimmed))
    throw tooManyRequests("too many login attempts, try again later");
  const row = await findUserByUsername(ctx, trimmed);
  if (!row) {
    recordLoginFailure(trimmed);
    throw badRequest("wrong username or password");
  }
  try {
    await verifyPassword(args.password, row.passwordHash);
  } catch (err) {
    recordLoginFailure(trimmed);
    throw err;
  }
  clearLoginFailures(trimmed);
  return publicUser(row);
}

/** No-op at the operations layer; the route handler clears the session+cookie. */
export async function doLogout(_ctx: Ctx): Promise<void> {}

export async function doChangePassword(
  ctx: Ctx,
  args: { oldPassword: string; newPassword: string },
): Promise<void> {
  const me = requireAuth(ctx);
  validatePassword(args.newPassword);

  const [row] = await ctx.db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, me.id))
    .limit(1);
  if (!row) throw notFound("user not found");
  await verifyPassword(args.oldPassword, row.passwordHash);

  const newHash = await hashPassword(args.newPassword);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash })
      .where(eq(users.id, me.id));
    await writeAudit(tx, me.id, "user.change_password", "user", me.id, {});
  });
}

export async function doCreateUser(
  ctx: Ctx,
  args: { username: string; password: string; role: "admin" | "user" },
): Promise<User> {
  const me = requireAdmin(ctx);
  validateUsername(args.username);
  validatePassword(args.password);

  const trimmed = args.username.trim();
  const hash = await hashPassword(args.password);
  const now = nowSecs();

  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          username: trimmed,
          passwordHash: hash,
          role: args.role,
          createdAt: now,
        })
        .returning();
      const pub = publicUser(row);
      await writeAudit(tx, me.id, "user.create", "user", row.id, {
        after: pub,
      });
      return pub;
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw conflict("username already exists");
    throw err;
  }
}

export async function doDeleteUser(
  ctx: Ctx,
  args: { id: number },
): Promise<void> {
  const me = requireAdmin(ctx);
  if (me.id === args.id) throw badRequest("you cannot delete yourself");

  const [before] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.id, args.id), isNull(users.deletedAt)))
    .limit(1);
  if (!before) throw notFound("user not found");

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ deletedAt: nowSecs() })
      .where(eq(users.id, args.id));
    await writeAudit(tx, me.id, "user.delete", "user", args.id, {
      before: publicUser(before),
    });
  });
}

export async function doResetUserPassword(
  ctx: Ctx,
  args: { id: number; newPassword: string },
): Promise<void> {
  const me = requireAdmin(ctx);
  validatePassword(args.newPassword);

  const hash = await hashPassword(args.newPassword);
  await ctx.db.transaction(async (tx) => {
    const result = await tx
      .update(users)
      .set({ passwordHash: hash })
      .where(and(eq(users.id, args.id), isNull(users.deletedAt)));
    if (result.rowsAffected === 0) throw notFound("user not found");
    await writeAudit(tx, me.id, "user.password_reset", "user", args.id, {});
  });
}

export async function doChangeUserRole(
  ctx: Ctx,
  args: { id: number; role: "admin" | "user" },
): Promise<void> {
  const me = requireAdmin(ctx);
  if (me.id === args.id) throw badRequest("you cannot change your own role");

  const [before] = await ctx.db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, args.id), isNull(users.deletedAt)))
    .limit(1);
  if (!before) throw notFound("user not found");

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ role: args.role })
      .where(eq(users.id, args.id));
    await writeAudit(tx, me.id, "user.change_role", "user", args.id, {
      before: { role: before.role },
      after: { role: args.role },
    });
  });
}
