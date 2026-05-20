import { badRequest, json, type Router } from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import {
  type AppCtx,
  type AppState,
  requireAuth,
} from "../middleware/session.ts";
import {
  doCreateParty,
  doDeleteParty,
  doGetParty,
  doListParties,
  doUpdateParty,
} from "../parties/operations.ts";
import type { PartyInput } from "../parties/types.ts";

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

export function registerPartyRoutes(app: Router<AppState>) {
  app.get("/api/parties", requireAuth, async (c) =>
    json(await doListParties(ctxOf(c))),
  );

  app.post("/api/parties", requireAuth, async (c) => {
    const body = (await c.req.json()) as PartyInput;
    return json(await doCreateParty(ctxOf(c), body));
  });

  app.get("/api/parties/:id", requireAuth, async (c) =>
    json(await doGetParty(ctxOf(c), { id: parseId(c) })),
  );

  app.patch("/api/parties/:id", requireAuth, async (c) => {
    const body = (await c.req.json()) as PartyInput;
    return json(await doUpdateParty(ctxOf(c), { id: parseId(c), ...body }));
  });

  app.delete("/api/parties/:id", requireAuth, async (c) => {
    await doDeleteParty(ctxOf(c), { id: parseId(c) });
    return json(null);
  });
}
