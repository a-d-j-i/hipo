import { type Context, Hono } from "hono";
import type { Ctx } from "../auth/types.ts";
import { badRequest } from "../errors.ts";
import { type AppEnv, requireAuth } from "../middleware/session.ts";
import {
  doCreateLenderPayout,
  doDeleteLenderPayout,
  doLenderBalances,
  doListPayouts,
} from "../payouts/operations.ts";
import type { CreateLenderPayoutInput } from "../payouts/types.ts";

function ctxOf(c: Context<AppEnv>): Ctx {
  return { db: c.var.db, user: c.var.user };
}

function parseId(c: Context<AppEnv>): number {
  const raw = c.req.param("id");
  if (!raw) throw badRequest("id is required");
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) throw badRequest("invalid id");
  return id;
}

export const payoutRoutes = new Hono<AppEnv>();

payoutRoutes.use("*", requireAuth);

// Note: /balances must be declared before /:id so it doesn't get matched as
// a payout id.
payoutRoutes.get("/balances", async (c) =>
  c.json(await doLenderBalances(ctxOf(c))),
);

payoutRoutes.get("/", async (c) => c.json(await doListPayouts(ctxOf(c))));

payoutRoutes.post("/", async (c) => {
  const body = await c.req.json<CreateLenderPayoutInput>();
  return c.json(await doCreateLenderPayout(ctxOf(c), body));
});

payoutRoutes.delete("/:id", async (c) => {
  await doDeleteLenderPayout(ctxOf(c), { id: parseId(c) });
  return c.json(null);
});
