import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { writeAudit } from "@hipo/audit";
import { type Ctx, nowSecs, requireAdmin, requireAuth } from "@hipo/auth";
import type { Db } from "@hipo/sqlite";
import {
  debtorPayments,
  debtorPaymentSplits,
  loanLenders,
  loans,
  parties,
} from "../db/schema.ts";
import type { Tx } from "@hipo/audit";
import { normalizeOpt } from "../loans/validators.ts";
import { badRequest, notFound } from "@hipo/server";
import { splitPayment } from "@hipo/shared";
import type {
  CreateDebtorPaymentInput,
  DebtorPayment,
  DebtorPaymentSplit,
} from "./types.ts";

async function fetchSplits(
  db: Db | Tx,
  paymentId: number,
): Promise<DebtorPaymentSplit[]> {
  return await db
    .select({
      lender_id: debtorPaymentSplits.lenderId,
      lender_name: parties.name,
      amount_cents: debtorPaymentSplits.amountCents,
    })
    .from(debtorPaymentSplits)
    .innerJoin(parties, eq(parties.id, debtorPaymentSplits.lenderId))
    .where(eq(debtorPaymentSplits.paymentId, paymentId))
    .orderBy(asc(parties.name));
}

async function fetchPayment(db: Db | Tx, id: number): Promise<DebtorPayment> {
  const rows = await db
    .select({
      id: debtorPayments.id,
      loan_id: debtorPayments.loanId,
      amount_cents: debtorPayments.amountCents,
      paid_at: debtorPayments.paidAt,
      notes: debtorPayments.notes,
      created_at: debtorPayments.createdAt,
      created_by: debtorPayments.createdBy,
    })
    .from(debtorPayments)
    .where(and(eq(debtorPayments.id, id), isNull(debtorPayments.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw notFound("payment not found");
  return { ...rows[0], splits: await fetchSplits(db, id) };
}

async function loanLenderShares(
  db: Db | Tx,
  loanId: number,
): Promise<Array<[number, number]>> {
  const rows = await db
    .select({
      lenderId: loanLenders.lenderId,
      amountLentCents: loanLenders.amountLentCents,
    })
    .from(loanLenders)
    .where(eq(loanLenders.loanId, loanId))
    .orderBy(asc(loanLenders.lenderId));
  return rows.map((r): [number, number] => [r.lenderId, r.amountLentCents]);
}

// ---------- Reads ----------

export async function doListLoanPayments(
  ctx: Ctx,
  args: { loanId: number },
): Promise<DebtorPayment[]> {
  requireAuth(ctx);
  const heads = await ctx.db
    .select({
      id: debtorPayments.id,
      loan_id: debtorPayments.loanId,
      amount_cents: debtorPayments.amountCents,
      paid_at: debtorPayments.paidAt,
      notes: debtorPayments.notes,
      created_at: debtorPayments.createdAt,
      created_by: debtorPayments.createdBy,
    })
    .from(debtorPayments)
    .where(
      and(
        eq(debtorPayments.loanId, args.loanId),
        isNull(debtorPayments.deletedAt),
      ),
    )
    .orderBy(desc(debtorPayments.paidAt), desc(debtorPayments.id));

  if (heads.length === 0) return [];

  // Batch fetch splits for all payments in one query, then group.
  const ids = heads.map((h) => h.id);
  const splitRows = await ctx.db
    .select({
      payment_id: debtorPaymentSplits.paymentId,
      lender_id: debtorPaymentSplits.lenderId,
      lender_name: parties.name,
      amount_cents: debtorPaymentSplits.amountCents,
    })
    .from(debtorPaymentSplits)
    .innerJoin(parties, eq(parties.id, debtorPaymentSplits.lenderId))
    .where(inArray(debtorPaymentSplits.paymentId, ids))
    .orderBy(asc(parties.name));

  const byPayment = new Map<number, DebtorPaymentSplit[]>();
  for (const r of splitRows) {
    const arr = byPayment.get(r.payment_id) ?? [];
    arr.push({
      lender_id: r.lender_id,
      lender_name: r.lender_name,
      amount_cents: r.amount_cents,
    });
    byPayment.set(r.payment_id, arr);
  }

  return heads.map((h) => ({ ...h, splits: byPayment.get(h.id) ?? [] }));
}

// ---------- Writes ----------

export async function doCreateDebtorPayment(
  ctx: Ctx,
  args: CreateDebtorPaymentInput,
): Promise<DebtorPayment> {
  const me = requireAuth(ctx);
  if (args.amountCents <= 0) throw badRequest("amount must be > 0");
  const notes = normalizeOpt(args.notes);
  const now = nowSecs();

  // Loan must exist, be active, and have lenders.
  const [loan] = await ctx.db
    .select({ status: loans.status })
    .from(loans)
    .where(and(eq(loans.id, args.loanId), isNull(loans.deletedAt)))
    .limit(1);
  if (!loan) throw notFound("loan not found");
  if (loan.status !== "active") throw badRequest("loan is not active");

  const shares = await loanLenderShares(ctx.db, args.loanId);
  if (shares.length === 0) throw badRequest("loan has no lenders");

  const split = splitPayment(args.amountCents, shares);

  return await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(debtorPayments)
      .values({
        loanId: args.loanId,
        amountCents: args.amountCents,
        paidAt: args.paidAt,
        notes,
        createdAt: now,
        createdBy: me.id,
      })
      .returning({ id: debtorPayments.id });
    for (const [lenderId, cents] of split) {
      if (cents > 0) {
        await tx.insert(debtorPaymentSplits).values({
          paymentId: row.id,
          lenderId,
          amountCents: cents,
        });
      }
    }
    const payment = await fetchPayment(tx, row.id);
    await writeAudit(tx, me.id, "payment.create", "payment", row.id, {
      after: payment,
    });
    return payment;
  });
}

export async function doDeleteDebtorPayment(
  ctx: Ctx,
  args: { id: number },
): Promise<void> {
  const me = requireAdmin(ctx);
  const before = await fetchPayment(ctx.db, args.id);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(debtorPayments)
      .set({ deletedAt: nowSecs() })
      .where(eq(debtorPayments.id, args.id));
    await writeAudit(tx, me.id, "payment.delete", "payment", args.id, {
      before,
    });
  });
}
