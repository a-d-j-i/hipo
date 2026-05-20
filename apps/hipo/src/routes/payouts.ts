import { badRequest, json, type Router } from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import {
  type AppCtx,
  type AppState,
  requireAuth,
} from "../middleware/session.ts";
import {
  doCreateLenderPayout,
  doDeleteLenderPayout,
  doLenderBalances,
  doListPayouts,
} from "../payouts/operations.ts";
import type { CreateLenderPayoutInput } from "../payouts/types.ts";

function ctxOf(c: AppCtx): Ctx {
  return { db: c.state.db, user: c.state.user };
}

function parseId(c: AppCtx): number {
  const raw = c.params.id;
  if (!raw) throw badRequest("id is required");
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) throw badRequest("invalid id");
  return id;
}

export function registerPayoutRoutes(app: Router<AppState>) {
  // /balances declared before /:id so it doesn't get matched as an id.
  app.get("/api/payouts/balances", requireAuth, async (c) =>
    json(await doLenderBalances(ctxOf(c))),
  );

  app.get("/api/payouts", requireAuth, async (c) =>
    json(await doListPayouts(ctxOf(c))),
  );

  app.post("/api/payouts", requireAuth, async (c) => {
    const body = (await c.req.json()) as CreateLenderPayoutInput;
    return json(await doCreateLenderPayout(ctxOf(c), body));
  });

  app.delete("/api/payouts/:id", requireAuth, async (c) => {
    await doDeleteLenderPayout(ctxOf(c), { id: parseId(c) });
    return json(null);
  });
}
