// /api/system/* routes. Substrate-level; deliberately unauthenticated
// (the status endpoint is what a fresh-install UI reads to decide
// whether to show the bootstrap flow or boot the app normally).

import { json, type Router } from "@hipo/server";
import type { AppState } from "../middleware/session.ts";
import { do_getSystemStatus } from "../system/operations.ts";

export function registerSystemRoutes(app: Router<AppState>) {
  app.get("/api/system/status", async (c) =>
    json(await do_getSystemStatus(c.state)),
  );
}
