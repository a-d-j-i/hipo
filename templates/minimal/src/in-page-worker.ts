// In-page Worker entry for the minimal template.
//
// Opens an OPFS-backed SQLite DB via @hipo/sqlite, builds a framework
// Router with auth + backup routes, listens for requests on a
// MessageChannel port, dispatches via the router.
//
// Routes wired here (< 100 LOC route surface):
//   GET  /api/healthz                  — liveness
//   GET  /api/auth/status              — { needs_setup, current_user }
//   POST /api/auth/setup               — first-admin creation
//   POST /api/auth/login               — login + create session
//   POST /api/auth/logout              — revoke session
//   GET  /api/auth/me                  — current user or null
//   GET  /api/backup/snapshot          — gzipped binary snapshot (admin)
//   POST /api/backup/restore           — apply snapshot bytes (admin)

/// <reference lib="webworker" />

import { openDb } from "@hipo/sqlite/client-browser";
import { binaryFormat } from "@hipo/sqlite/binary-format-browser";
import { gzipped } from "@hipo/backup";
import { Router, serveOnPort, json, empty, parseCookies, serializeCookie, type Middleware, type RouteContext } from "@hipo/server";
import {
  doAuthStatus,
  doCurrentUser,
  doSetupFirstAdmin,
  doLogin,
  doLogout,
  type User,
  publicUser,
} from "@hipo/auth";
import { sessions, users } from "@hipo/auth/schema";
import { migrations } from "./migrations.ts";
import type { Db } from "@hipo/sqlite";
import { and, eq, gt } from "drizzle-orm";

// ── Session state attached per request ───────────────────────────────────

const SESSION_COOKIE = "minimal_session";
const SESSION_TTL_DAYS = 30;

type AppState = {
  db: Db;
  sessionId: string | null;
  user: User | null;
};

type AppCtx = RouteContext<AppState>;

function randomSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSession(db: Db, userId: number): Promise<string> {
  const id = randomSessionId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_DAYS * 86_400;
  await db.insert(sessions).values({
    id,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return id;
}

async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

function attachSession(c: AppCtx, sessionId: string): void {
  c.resHeaders.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 86_400,
    }),
  );
  // In-page shape: SW doesn't propagate Set-Cookie to the cookie jar.
  // Expose via X-Hipo-Session so the frontend can forward it as X-Hipo-Token.
  c.resHeaders.set("X-Hipo-Session", sessionId);
}

function clearSession(c: AppCtx): void {
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

// ── Session middleware ────────────────────────────────────────────────────

function sessionMiddleware(db: Db): Middleware<AppState> {
  return async (c, next) => {
    c.state.db = db;
    c.state.sessionId = null;
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
        c.state.sessionId = sessionId;
        c.state.user = publicUser(rows[0].user);
        // Lazy touch last_seen_at — fire and forget.
        db
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(eq(sessions.id, sessionId))
          .then(() => {})
          .catch(() => {});
      }
    }

    return await next();
  };
}

// ── base64 helpers for the snapshot wire format ───────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...(chunk as unknown as number[]));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { db, local } = await openDb({
    databasePath: "minimal.sqlite3",
    migrations,
  });

  const backupFormat = gzipped(binaryFormat({ local }));

  const app = new Router<AppState>();

  app.use(async (_c, next) => {
    const res = await next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  });

  app.use(sessionMiddleware(db));

  // ── Healthz ─────────────────────────────────────────────────────────
  app.get("/api/healthz", () => json({ ok: true }));

  // ── Auth ─────────────────────────────────────────────────────────────
  app.get("/api/auth/status", async (c) =>
    json(await doAuthStatus({ db, user: c.state.user })),
  );

  app.get("/api/auth/me", async (c) =>
    json(await doCurrentUser({ db, user: c.state.user })),
  );

  app.post("/api/auth/setup", async (c) => {
    const body = (await c.req.json()) as { username: string; password: string };
    const user = await doSetupFirstAdmin({ db, user: null }, body);
    const sid = await createSession(db, user.id);
    attachSession(c, sid);
    return json(user);
  });

  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json()) as { username: string; password: string };
    const user = await doLogin({ db, user: c.state.user }, body);
    const sid = await createSession(db, user.id);
    attachSession(c, sid);
    return json(user);
  });

  app.post("/api/auth/logout", async (c) => {
    if (c.state.sessionId) await revokeSession(db, c.state.sessionId);
    await doLogout({ db, user: c.state.user });
    clearSession(c);
    return json(null);
  });

  // ── Backup ───────────────────────────────────────────────────────────
  app.get("/api/backup/snapshot", async (c) => {
    if (!c.state.user || c.state.user.role !== "admin") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const bytes = await backupFormat.encode();
    return json({ bytes_b64: bytesToBase64(bytes) });
  });

  app.post("/api/backup/restore", async (c) => {
    if (!c.state.user || c.state.user.role !== "admin") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const body = (await c.req.json()) as { bytes_b64: string };
    const bytes = base64ToBytes(body.bytes_b64);
    await backupFormat.decode(bytes);
    return empty();
  });

  // ── MessageChannel port listener ─────────────────────────────────────
  self.addEventListener("message", (e: MessageEvent) => {
    if (e.data?.kind === "api-port" && e.ports[0]) {
      serveOnPort(e.ports[0], app as unknown as Router<object>);
      (self as unknown as Worker).postMessage({ kind: "ready" });
      console.log("[minimal worker] api port wired");
    }
  });

  (self as unknown as Worker).postMessage({ kind: "loaded" });
}

main().catch((e) => {
  console.error("[minimal worker] fatal:", e);
});
