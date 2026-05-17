// Session middleware on the @hipo/server router. Provides:
//   - sessionMiddleware(db): populates AppState (db, session, user)
//   - requireLocalToken: optional X-Hipo-Token gate for Tauri sidecar
//   - requireAuth / requireAdmin: per-route guards
//   - createSession / revokeSession: pure helpers
//   - attachSessionCookie / clearSessionCookie: cookie helpers
//
// Phase 1C: rewritten from Hono to the framework router.

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
  // Also expose the session id via a custom (non-forbidden) response
  // header. The browser/SW intercepts Set-Cookie cleanly for real HTTP
  // responses (Deno shape), but synthetic SW responses (in-page shape)
  // don't propagate Set-Cookie to the cookie jar. The frontend's
  // httpRequest reads X-Hipo-Session and forwards it as X-Hipo-Token
  // on subsequent fetches — exact same session lookup either way.
  c.resHeaders.set("X-Hipo-Session", sessionId);
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
  c.resHeaders.set("X-Hipo-Session", "");
}

/**
 * Reads the session ID from either the Cookie header (Deno shape) or
 * the X-Hipo-Token header (in-page shape), looks up the session row +
 * user, attaches to state.
 *
 * Both transports point at the same sessions table — only the
 * delivery mechanism differs. See attachSessionCookie() for why.
 */
export function sessionMiddleware(db: Db): Middleware<AppState> {
  return async (c, next) => {
    c.state.db = db;
    c.state.session = null;
    c.state.user = null;

    const cookies = parseCookies(c.req.headers.get("cookie"));
    const cookie = cookies.get(SESSION_COOKIE);
    const headerToken =
      c.req.headers.get("x-hipo-token") ?? c.req.headers.get("X-Hipo-Token");
    const sessionId = cookie ?? headerToken ?? null;

    if (sessionId) {
      const now = Math.floor(Date.now() / 1000);
      const rows = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
        .limit(1);

      if (rows.length > 0 && rows[0].user.deletedAt === null) {
        c.state.session = rows[0].session;
        c.state.user = publicUser(rows[0].user);
        // Touch last_seen_at lazily; no need to await for the response.
        db
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(eq(sessions.id, sessionId))
          .then(() => {})
          .catch(() => {});
      } else if (cookie) {
        // Stale cookie — clear it. (No equivalent for X-Hipo-Token;
        // the frontend's httpRequest already resyncs from
        // X-Hipo-Session response headers on next auth response.)
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

// Pure-JS constant-time string compare. Avoids node:crypto so the
// module bundles into the in-page Worker; equivalent guarantees on
// short hex/base64 tokens (the actual call site is rare anyway —
// only when HIPO_AUTH_TOKEN is set, ie Tauri sidecar mode).
function safeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Localhost-only API token check, active when HIPO_AUTH_TOKEN is set. */
export const requireLocalToken: Middleware<AppState> = async (c, next) => {
  if (!config.authToken) return await next();
  if (!c.url.pathname.startsWith("/api/")) return await next();
  if (!safeTokenEqual(c.req.headers.get("X-Hipo-Token") ?? undefined, config.authToken))
    throw forbidden();
  return await next();
};
