import { type Context, Hono } from "hono";
import type { Ctx } from "../auth/types.ts";
import { badRequest } from "../errors.ts";
import { type AppEnv, requireAuth } from "../middleware/session.ts";
import {
  doCreateParty,
  doDeleteParty,
  doGetParty,
  doListParties,
  doUpdateParty,
} from "../parties/operations.ts";
import type { PartyInput } from "../parties/types.ts";

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

export const partyRoutes = new Hono<AppEnv>();

// All party routes need a logged-in user.
partyRoutes.use("*", requireAuth);

partyRoutes.get("/", async (c) => c.json(await doListParties(ctxOf(c))));

partyRoutes.post("/", async (c) => {
  const body = await c.req.json<PartyInput>();
  return c.json(await doCreateParty(ctxOf(c), body));
});

partyRoutes.get("/:id", async (c) =>
  c.json(await doGetParty(ctxOf(c), { id: parseId(c) })),
);

partyRoutes.patch("/:id", async (c) => {
  const body = await c.req.json<PartyInput>();
  return c.json(await doUpdateParty(ctxOf(c), { id: parseId(c), ...body }));
});

partyRoutes.delete("/:id", async (c) => {
  await doDeleteParty(ctxOf(c), { id: parseId(c) });
  return c.json(null);
});
