import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { sessions, type Session, users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { config, SESSION_COOKIE } from "../config.ts";
import { publicUser, type User } from "../auth/types.ts";

export type AppEnv = {
  Variables: {
    db: Db;
    session: Session | null;
    user: User | null;
  };
};

function randomSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: Db,
  userId: number,
  meta: { ip?: string; userAgent?: string },
): Promise<Session> {
  const id = randomSessionId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.sessionTtlDays * 86_400;
  const [row] = await db
    .insert(sessions)
    .values({
      id,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    .returning();
  return row;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function attachSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionTtlDays * 86_400,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Reads the session cookie, looks up the session row + user, attaches to ctx. */
export function sessionMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("db", db);
    c.set("session", null);
    c.set("user", null);

    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) {
      const now = Math.floor(Date.now() / 1000);
      const rows = await db
        .select({
          session: sessions,
          user: users,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, cookie), gt(sessions.expiresAt, now)))
        .limit(1);

      if (rows.length > 0 && rows[0].user.deletedAt === null) {
        c.set("session", rows[0].session);
        c.set("user", publicUser(rows[0].user));
        // Touch last_seen_at lazily; no need to await it for the response.
        db
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(eq(sessions.id, cookie))
          .then(() => {})
          .catch(() => {});
      } else {
        clearSessionCookie(c);
      }
    }

    await next();
  };
}

/** Hard guard: 401 if no authenticated user on the context. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "unauthorized" }, 401);
  await next();
};

/** Hard guard: 403 if the authenticated user is not an admin. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "unauthorized" }, 401);
  if (c.var.user.role !== "admin")
    return c.json({ error: "forbidden" }, 403);
  await next();
};

/** Optional localhost-only token check. Active when HIPO_AUTH_TOKEN is set. */
export const requireLocalToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!config.authToken) return next();
  if (c.req.header("X-Hipo-Token") !== config.authToken)
    return c.json({ error: "forbidden" }, 403);
  await next();
};
