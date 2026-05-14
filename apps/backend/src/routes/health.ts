import { Hono } from "hono";
import type { AppEnv } from "../middleware/session.ts";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/healthz", (c) =>
  c.json({
    ok: true,
    user: c.var.user
      ? { id: c.var.user.id, username: c.var.user.username, role: c.var.user.role }
      : null,
  }),
);
