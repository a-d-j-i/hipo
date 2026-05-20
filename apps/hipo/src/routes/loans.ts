import { badRequest, json, type Router } from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import {
  type AppCtx,
  type AppState,
  requireAuth,
} from "../middleware/session.ts";
import {
  doCreateLoan,
  doDeleteLoan,
  doGetLoan,
  doListLoans,
  doSetLoanLenders,
  doSetLoanPromoters,
  doUpdateLoan,
} from "../loans/operations.ts";
import type {
  CreateLoanInput,
  LoanLenderInput,
  LoanPromoterInput,
  UpdateLoanInput,
} from "../loans/types.ts";

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

export function registerLoanRoutes(app: Router<AppState>) {
  app.get("/api/loans", requireAuth, async (c) =>
    json(await doListLoans(ctxOf(c))),
  );

  app.post("/api/loans", requireAuth, async (c) => {
    const body = (await c.req.json()) as CreateLoanInput;
    return json(await doCreateLoan(ctxOf(c), body));
  });

  app.get("/api/loans/:id", requireAuth, async (c) =>
    json(await doGetLoan(ctxOf(c), { id: parseId(c) })),
  );

  app.patch("/api/loans/:id", requireAuth, async (c) => {
    const body = (await c.req.json()) as Omit<UpdateLoanInput, "id">;
    return json(await doUpdateLoan(ctxOf(c), { id: parseId(c), ...body }));
  });

  app.put("/api/loans/:id/lenders", requireAuth, async (c) => {
    const body = (await c.req.json()) as { lenders: LoanLenderInput[] };
    return json(
      await doSetLoanLenders(ctxOf(c), {
        loanId: parseId(c),
        lenders: body.lenders,
      }),
    );
  });

  app.put("/api/loans/:id/promoters", requireAuth, async (c) => {
    const body = (await c.req.json()) as { promoters: LoanPromoterInput[] };
    return json(
      await doSetLoanPromoters(ctxOf(c), {
        loanId: parseId(c),
        promoters: body.promoters ?? [],
      }),
    );
  });

  app.delete("/api/loans/:id", requireAuth, async (c) => {
    await doDeleteLoan(ctxOf(c), { id: parseId(c) });
    return json(null);
  });
}
