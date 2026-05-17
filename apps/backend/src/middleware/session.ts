// Session middleware on the @hipo/server router. Provides:
//   - sessionMiddleware(db): populates AppState (db, session, user)
//   - requireLocalToken: optional X-Hipo-Token gate for Tauri sidecar
//   - requireAuth / requireAdmin: per-route guards
//   - createSession / revokeSession: pure helpers
//   - attachSessionCookie / clearSessionCookie: cookie helpers
//
// Phase 1C: rewritten from Hono to the framework router.

import { timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@hipo/sqlite";
import { sessions, type Session, users } from "@hipo/auth/schema";
import { publicUser, type User } from "@hipo/auth";
import {
  type Middleware,
  type RouteContext,
  parseCookies,
  serializeCookie,
  unauthorized,
  forbidden,
} from "@hipo/server";
import { config, SESSION_COOKIE } from "../config.ts";

export type AppState = {
  db: Db;
  session: Session | null;
  user: User | null;
};

export type AppCtx = RouteContext<AppState>;

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

export function attachSessionCookie(c: AppCtx, sessionId: string): void {
  c.resHeaders.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: c.url.protocol === "https:",
      sameSite: "Strict",
      path: "/",
      maxAge: config.sessionTtlDays * 86_400,
    }),
  );
}

export function clearSessionCookie(c: AppCtx): void {
  c.resHeaders.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 0,
    }),
  );
}

/** Reads the session cookie, looks up the session row + user, attaches to state. */
export function sessionMiddleware(db: Db): Middleware<AppState> {
  return async (c, next) => {
    c.state.db = db;
    c.state.session = null;
    c.state.user = null;

    const cookies = parseCookies(c.req.headers.get("cookie"));
    const cookie = cookies.get(SESSION_COOKIE);
    if (cookie) {
      const now = Math.floor(Date.now() / 1000);
      const rows = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, cookie), gt(sessions.expiresAt, now)))
        .limit(1);

      if (rows.length > 0 && rows[0].user.deletedAt === null) {
        c.state.session = rows[0].session;
        c.state.user = publicUser(rows[0].user);
        // Touch last_seen_at lazily; no need to await for the response.
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

    return await next();
  };
}

/** Hard guard: 401 if no authenticated user. */
export const requireAuth: Middleware<AppState> = async (c, next) => {
  if (!c.state.user) throw unauthorized();
  return await next();
};

/** Hard guard: 403 if not admin. */
export const requireAdmin: Middleware<AppState> = async (c, next) => {
  if (!c.state.user) throw unauthorized();
  if (c.state.user.role !== "admin") throw forbidden();
  return await next();
};

function safeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(provided), enc.encode(expected));
}

/** Localhost-only API token check, active when HIPO_AUTH_TOKEN is set. */
export const requireLocalToken: Middleware<AppState> = async (c, next) => {
  if (!config.authToken) return await next();
  if (!c.url.pathname.startsWith("/api/")) return await next();
  if (!safeTokenEqual(c.req.headers.get("X-Hipo-Token") ?? undefined, config.authToken))
    throw forbidden();
  return await next();
};
