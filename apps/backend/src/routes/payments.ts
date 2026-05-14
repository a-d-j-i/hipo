import { type Context, Hono } from "hono";
import type { Ctx } from "../auth/types.ts";
import { badRequest } from "../errors.ts";
import { type AppEnv, requireAuth } from "../middleware/session.ts";
import {
  doCreateDebtorPayment,
  doDeleteDebtorPayment,
  doListLoanPayments,
} from "../payments/operations.ts";
import type { CreateDebtorPaymentInput } from "../payments/types.ts";

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

export const paymentRoutes = new Hono<AppEnv>();

paymentRoutes.use("*", requireAuth);

paymentRoutes.get("/", async (c) => {
  const raw = c.req.query("loan_id");
  if (!raw) throw badRequest("loan_id query param is required");
  const loanId = Number.parseInt(raw, 10);
  if (!Number.isFinite(loanId)) throw badRequest("invalid loan_id");
  return c.json(await doListLoanPayments(ctxOf(c), { loanId }));
});

paymentRoutes.post("/", async (c) => {
  const body = await c.req.json<CreateDebtorPaymentInput>();
  return c.json(await doCreateDebtorPayment(ctxOf(c), body));
});

paymentRoutes.delete("/:id", async (c) => {
  await doDeleteDebtorPayment(ctxOf(c), { id: parseId(c) });
  return c.json(null);
});
