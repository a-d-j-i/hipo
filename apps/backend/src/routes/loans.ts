import { type Context, Hono } from "hono";
import type { Ctx } from "../auth/types.ts";
import { badRequest } from "../errors.ts";
import {
  doCreateLoan,
  doDeleteLoan,
  doGetLoan,
  doListLoans,
  doSetLoanLenders,
  doUpdateLoan,
} from "../loans/operations.ts";
import type {
  CreateLoanInput,
  LoanLenderInput,
  UpdateLoanInput,
} from "../loans/types.ts";
import { type AppEnv, requireAuth } from "../middleware/session.ts";

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

export const loanRoutes = new Hono<AppEnv>();

loanRoutes.use("*", requireAuth);

loanRoutes.get("/", async (c) => c.json(await doListLoans(ctxOf(c))));

loanRoutes.post("/", async (c) => {
  const body = await c.req.json<CreateLoanInput>();
  return c.json(await doCreateLoan(ctxOf(c), body));
});

loanRoutes.get("/:id", async (c) =>
  c.json(await doGetLoan(ctxOf(c), { id: parseId(c) })),
);

loanRoutes.patch("/:id", async (c) => {
  const body = await c.req.json<Omit<UpdateLoanInput, "id">>();
  return c.json(await doUpdateLoan(ctxOf(c), { id: parseId(c), ...body }));
});

loanRoutes.put("/:id/lenders", async (c) => {
  const body = await c.req.json<{ lenders: LoanLenderInput[] }>();
  return c.json(
    await doSetLoanLenders(ctxOf(c), {
      loanId: parseId(c),
      lenders: body.lenders,
    }),
  );
});

loanRoutes.delete("/:id", async (c) => {
  await doDeleteLoan(ctxOf(c), { id: parseId(c) });
  return c.json(null);
});
