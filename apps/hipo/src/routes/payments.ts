import { badRequest, json, type Router } from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import {
  type AppCtx,
  type AppState,
  requireAuth,
} from "../middleware/session.ts";
import {
  doCreateDebtorPayment,
  doDeleteDebtorPayment,
  doListLoanPayments,
} from "../payments/operations.ts";
import type { CreateDebtorPaymentInput } from "../payments/types.ts";

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

export function registerPaymentRoutes(app: Router<AppState>) {
  app.get("/api/payments", requireAuth, async (c) => {
    const raw = c.url.searchParams.get("loan_id");
    if (!raw) throw badRequest("loan_id query param is required");
    const loanId = Number.parseInt(raw, 10);
    if (!Number.isFinite(loanId)) throw badRequest("invalid loan_id");
    return json(await doListLoanPayments(ctxOf(c), { loanId }));
  });

  app.post("/api/payments", requireAuth, async (c) => {
    const body = (await c.req.json()) as CreateDebtorPaymentInput;
    return json(await doCreateDebtorPayment(ctxOf(c), body));
  });

  app.delete("/api/payments/:id", requireAuth, async (c) => {
    await doDeleteDebtorPayment(ctxOf(c), { id: parseId(c) });
    return json(null);
  });
}
