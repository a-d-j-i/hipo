import { badRequest, json, type Router } from "@hipo/server";
import {
  type Ctx,
  doAuthStatus,
  doChangePassword,
  doChangeUserRole,
  doCreateUser,
  doCurrentUser,
  doDeleteUser,
  doListUsers,
  doLogin,
  doLogout,
  doResetUserPassword,
  doSetupFirstAdmin,
} from "@hipo/auth";
import {
  type AppCtx,
  type AppState,
  attachSessionCookie,
  clearSessionCookie,
  createSession,
  requireAdmin,
  requireAuth,
  revokeSession,
} from "../middleware/session.ts";

function ctxOf(c: AppCtx): Ctx {
  return { db: c.state.db, user: c.state.user };
}

function reqMeta(c: AppCtx) {
  return {
    ip:
      c.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: c.req.headers.get("user-agent") ?? undefined,
  };
}

function parseId(c: AppCtx): number {
  const raw = c.params.id;
  if (!raw) throw badRequest("id is required");
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) throw badRequest("invalid id");
  return id;
}

export function registerAuthRoutes(app: Router<AppState>) {
  app.get("/api/auth/status", async (c) => json(await doAuthStatus(ctxOf(c))));

  app.get("/api/auth/me", async (c) => json(await doCurrentUser(ctxOf(c))));

  app.post("/api/auth/setup", async (c) => {
    const body = (await c.req.json()) as { username: string; password: string };
    const user = await doSetupFirstAdmin(ctxOf(c), body);
    const session = await createSession(c.state.db, user.id, reqMeta(c));
    attachSessionCookie(c, session.id);
    return json(user);
  });

  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json()) as { username: string; password: string };
    const user = await doLogin(ctxOf(c), body);
    const session = await createSession(c.state.db, user.id, reqMeta(c));
    attachSessionCookie(c, session.id);
    return json(user);
  });

  app.post("/api/auth/logout", async (c) => {
    if (c.state.session) await revokeSession(c.state.db, c.state.session.id);
    await doLogout(ctxOf(c));
    clearSessionCookie(c);
    return json(null);
  });

  app.post("/api/auth/change_password", requireAuth, async (c) => {
    const body = (await c.req.json()) as {
      oldPassword: string;
      newPassword: string;
    };
    await doChangePassword(ctxOf(c), body);
    return json(null);
  });

  // ---- Admin: user management ----
  app.get("/api/users", requireAdmin, async (c) =>
    json(await doListUsers(ctxOf(c))),
  );

  app.post("/api/users", requireAdmin, async (c) => {
    const body = (await c.req.json()) as {
      username: string;
      password: string;
      role: "admin" | "user";
    };
    const user = await doCreateUser(ctxOf(c), body);
    return json(user);
  });

  app.delete("/api/users/:id", requireAdmin, async (c) => {
    await doDeleteUser(ctxOf(c), { id: parseId(c) });
    return json(null);
  });

  app.post("/api/users/:id/reset_password", requireAdmin, async (c) => {
    const body = (await c.req.json()) as { newPassword: string };
    await doResetUserPassword(ctxOf(c), {
      id: parseId(c),
      newPassword: body.newPassword,
    });
    return json(null);
  });

  app.post("/api/users/:id/role", requireAdmin, async (c) => {
    const body = (await c.req.json()) as { role: "admin" | "user" };
    await doChangeUserRole(ctxOf(c), {
      id: parseId(c),
      role: body.role,
    });
    return json(null);
  });
}
