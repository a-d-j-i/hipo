import { type Context, Hono } from "hono";
import {
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
} from "../auth/operations.ts";
import type { Ctx } from "../auth/types.ts";
import { badRequest } from "../errors.ts";
import {
  type AppEnv,
  attachSessionCookie,
  clearSessionCookie,
  createSession,
  requireAdmin,
  requireAuth,
  revokeSession,
} from "../middleware/session.ts";

function ctxOf(c: Context<AppEnv>): Ctx {
  return { db: c.var.db, user: c.var.user };
}

function reqMeta(c: Context<AppEnv>) {
  return {
    ip: c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? undefined,
    userAgent: c.req.header("User-Agent") ?? undefined,
  };
}

function parseId(c: Context<AppEnv>): number {
  const raw = c.req.param("id");
  if (!raw) throw badRequest("id is required");
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) throw badRequest("invalid id");
  return id;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/status", async (c) =>
  c.json(await doAuthStatus(ctxOf(c))),
);

authRoutes.get("/me", async (c) =>
  c.json(await doCurrentUser(ctxOf(c))),
);

authRoutes.post("/setup", async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const user = await doSetupFirstAdmin(ctxOf(c), body);
  const session = await createSession(c.var.db, user.id, reqMeta(c));
  attachSessionCookie(c, session.id);
  return c.json(user);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const user = await doLogin(ctxOf(c), body);
  const session = await createSession(c.var.db, user.id, reqMeta(c));
  attachSessionCookie(c, session.id);
  return c.json(user);
});

authRoutes.post("/logout", async (c) => {
  if (c.var.session) await revokeSession(c.var.db, c.var.session.id);
  await doLogout(ctxOf(c));
  clearSessionCookie(c);
  return c.json(null);
});

authRoutes.post("/change_password", requireAuth, async (c) => {
  const body = await c.req.json<{ oldPassword: string; newPassword: string }>();
  await doChangePassword(ctxOf(c), body);
  return c.json(null);
});

// ---- Admin: user management ----

export const userRoutes = new Hono<AppEnv>();

userRoutes.get("/", requireAdmin, async (c) =>
  c.json(await doListUsers(ctxOf(c))),
);

userRoutes.post("/", requireAdmin, async (c) => {
  const body = await c.req.json<{
    username: string;
    password: string;
    role: "admin" | "user";
  }>();
  const user = await doCreateUser(ctxOf(c), body);
  return c.json(user);
});

userRoutes.delete("/:id", requireAdmin, async (c) => {
  await doDeleteUser(ctxOf(c), { id: parseId(c) });
  return c.json(null);
});

userRoutes.post("/:id/reset_password", requireAdmin, async (c) => {
  const body = await c.req.json<{ newPassword: string }>();
  await doResetUserPassword(ctxOf(c), {
    id: parseId(c),
    newPassword: body.newPassword,
  });
  return c.json(null);
});

userRoutes.post("/:id/role", requireAdmin, async (c) => {
  const body = await c.req.json<{ role: "admin" | "user" }>();
  await doChangeUserRole(ctxOf(c), {
    id: parseId(c),
    role: body.role,
  });
  return c.json(null);
});
