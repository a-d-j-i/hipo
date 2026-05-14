import { type Context, Hono } from "hono";
import type { Ctx } from "../auth/types.ts";
import { doListAuditLog } from "../audit/operations.ts";
import { type AppEnv, requireAdmin } from "../middleware/session.ts";

function ctxOf(c: Context<AppEnv>): Ctx {
  return { db: c.var.db, user: c.var.user };
}

function intParam(c: Context<AppEnv>, name: string, fallback: number): number {
  const raw = c.req.query(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.use("*", requireAdmin);

auditRoutes.get("/", async (c) => {
  const entityType = c.req.query("entity_type") ?? null;
  const userIdRaw = c.req.query("user_id");
  const userId =
    userIdRaw === undefined || userIdRaw === ""
      ? null
      : Number.parseInt(userIdRaw, 10);
  return c.json(
    await doListAuditLog(ctxOf(c), {
      entityType,
      userId: userId !== null && Number.isFinite(userId) ? userId : null,
      limit: intParam(c, "limit", 50),
      offset: intParam(c, "offset", 0),
    }),
  );
});
