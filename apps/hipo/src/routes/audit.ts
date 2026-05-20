import { json, type Router } from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import { doListAuditLog } from "@hipo/audit";
import {
  type AppCtx,
  type AppState,
  requireAdmin,
} from "../middleware/session.ts";

function ctxOf(c: AppCtx): Ctx {
  return { db: c.state.db, user: c.state.user };
}

function intQuery(c: AppCtx, name: string, fallback: number): number {
  const raw = c.url.searchParams.get(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function registerAuditRoutes(app: Router<AppState>) {
  app.get("/api/audit", requireAdmin, async (c) => {
    const entityType = c.url.searchParams.get("entity_type");
    const userIdRaw = c.url.searchParams.get("user_id");
    const userId =
      userIdRaw === null || userIdRaw === ""
        ? null
        : Number.parseInt(userIdRaw, 10);
    return json(
      await doListAuditLog(ctxOf(c), {
        entityType,
        userId: userId !== null && Number.isFinite(userId) ? userId : null,
        limit: intQuery(c, "limit", 50),
        offset: intQuery(c, "offset", 0),
      }),
    );
  });
}
