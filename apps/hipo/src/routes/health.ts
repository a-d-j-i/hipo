import { json, type Router } from "@hipo/server";
import type { AppState } from "../middleware/session.ts";

export function registerHealthRoutes(app: Router<AppState>) {
  app.get("/api/healthz", (c) =>
    json({
      ok: true,
      user: c.state.user
        ? {
            id: c.state.user.id,
            username: c.state.user.username,
            role: c.state.user.role,
          }
        : null,
    }),
  );
}
