import { and, asc, desc, eq, isNull, sql, sum } from "drizzle-orm";
import { writeAudit } from "../audit/write.ts";
import {
  type Ctx,
  nowSecs,
  requireAdmin,
  requireAuth,
} from "../auth/types.ts";
import type { Db } from "../db/client.ts";
import {
  debtorPayments,
  debtorPaymentSplits,
  lenderPayouts,
  loans,
  parties,
} from "../db/schema.ts";
import type { Tx } from "../audit/write.ts";
import {
  normalizeOpt,
  validateCurrencyCode,
} from "../loans/validators.ts";
import { badRequest, notFound } from "../errors.ts";
import type {
  CreateLenderPayoutInput,
  LenderBalance,
  LenderPayout,
} from "./types.ts";

async function fetchPayout(
  db: Db | Tx,
  id: number,
): Promise<LenderPayout> {
  const rows = await db
    .select({
      id: lenderPayouts.id,
      lender_id: lenderPayouts.lenderId,
      lender_name: parties.name,
      currency_code: lenderPayouts.currencyCode,
      amount_cents: lenderPayouts.amountCents,
      paid_at: lenderPayouts.paidAt,
      notes: lenderPayouts.notes,
      created_at: lenderPayouts.createdAt,
      created_by: lenderPayouts.createdBy,
    })
    .from(lenderPayouts)
    .innerJoin(parties, eq(parties.id, lenderPayouts.lenderId))
    .where(and(eq(lenderPayouts.id, id), isNull(lenderPayouts.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw notFound("payout not found");
  return rows[0];
}

// ---------- Reads ----------

export async function doListPayouts(ctx: Ctx): Promise<LenderPayout[]> {
  requireAuth(ctx);
  return await ctx.db
    .select({
      id: lenderPayouts.id,
      lender_id: lenderPayouts.lenderId,
      lender_name: parties.name,
      currency_code: lenderPayouts.currencyCode,
      amount_cents: lenderPayouts.amountCents,
      paid_at: lenderPayouts.paidAt,
      notes: lenderPayouts.notes,
      created_at: lenderPayouts.createdAt,
      created_by: lenderPayouts.createdBy,
    })
    .from(lenderPayouts)
    .innerJoin(parties, eq(parties.id, lenderPayouts.lenderId))
    .where(isNull(lenderPayouts.deletedAt))
    .orderBy(desc(lenderPayouts.paidAt), desc(lenderPayouts.id));
}

/**
 * Per-lender, per-currency balance: received (their share of debtor payments,
 * loan currency) minus paid_out (lender_payouts in that currency).
 * Outstanding is received - paid_out (can be negative on overpayment).
 *
 * Done as two grouped queries merged in TS — easier to read and type-check
 * than the Rust UNION ALL subquery; same shape.
 */
export async function doLenderBalances(
  ctx: Ctx,
): Promise<LenderBalance[]> {
  requireAuth(ctx);

  const received = await ctx.db
    .select({
      lender_id: debtorPaymentSplits.lenderId,
      currency_code: loans.currencyCode,
      cents: sum(debtorPaymentSplits.amountCents).as("cents"),
    })
    .from(debtorPaymentSplits)
    .innerJoin(
      debtorPayments,
      eq(debtorPayments.id, debtorPaymentSplits.paymentId),
    )
    .innerJoin(loans, eq(loans.id, debtorPayments.loanId))
    .where(
      and(isNull(debtorPayments.deletedAt), isNull(loans.deletedAt)),
    )
    .groupBy(debtorPaymentSplits.lenderId, loans.currencyCode);

  const paidOut = await ctx.db
    .select({
      lender_id: lenderPayouts.lenderId,
      currency_code: lenderPayouts.currencyCode,
      cents: sum(lenderPayouts.amountCents).as("cents"),
    })
    .from(lenderPayouts)
    .where(isNull(lenderPayouts.deletedAt))
    .groupBy(lenderPayouts.lenderId, lenderPayouts.currencyCode);

  // Merge by (lender_id, currency_code).
  type Cell = { received: number; paidOut: number };
  const byKey = new Map<string, Cell>();
  const keyOf = (lenderId: number, ccy: string) => `${lenderId}:${ccy}`;

  for (const r of received) {
    byKey.set(keyOf(r.lender_id, r.currency_code), {
      received: Number(r.cents ?? 0),
      paidOut: 0,
    });
  }
  for (const p of paidOut) {
    const k = keyOf(p.lender_id, p.currency_code);
    const cell = byKey.get(k);
    if (cell) cell.paidOut = Number(p.cents ?? 0);
    else byKey.set(k, { received: 0, paidOut: Number(p.cents ?? 0) });
  }

  if (byKey.size === 0) return [];

  // Resolve lender names — one query for all distinct ids in the result.
  const lenderIds = Array.from(
    new Set(Array.from(byKey.keys()).map((k) => Number(k.split(":")[0]))),
  );
  const nameRows = await ctx.db
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(sql`${parties.id} IN ${lenderIds}`);
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  const out: LenderBalance[] = [];
  for (const [k, cell] of byKey) {
    const [idStr, currency_code] = k.split(":");
    const lender_id = Number(idStr);
    out.push({
      lender_id,
      lender_name: nameById.get(lender_id) ?? "",
      currency_code,
      received_cents: cell.received,
      paid_out_cents: cell.paidOut,
      outstanding_cents: cell.received - cell.paidOut,
    });
  }
  // Match Rust ORDER BY p.name, t.currency_code
  out.sort(
    (a, b) =>
      a.lender_name.localeCompare(b.lender_name) ||
      a.currency_code.localeCompare(b.currency_code),
  );
  return out;
}

// ---------- Writes ----------

export async function doCreateLenderPayout(
  ctx: Ctx,
  args: CreateLenderPayoutInput,
): Promise<LenderPayout> {
  const me = requireAuth(ctx);
  const currencyCode = args.currencyCode.trim().toUpperCase();
  validateCurrencyCode(currencyCode);
  if (args.amountCents <= 0) throw badRequest("amount must be > 0");
  const notes = normalizeOpt(args.notes);
  const now = nowSecs();

  const [party] = await ctx.db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, args.lenderId), isNull(parties.deletedAt)))
    .limit(1);
  if (!party) throw notFound(`party ${args.lenderId} not found`);

  return await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(lenderPayouts)
      .values({
        lenderId: args.lenderId,
        currencyCode,
        amountCents: args.amountCents,
        paidAt: args.paidAt,
        notes,
        createdAt: now,
        createdBy: me.id,
      })
      .returning({ id: lenderPayouts.id });
    const payout = await fetchPayout(tx, row.id);
    await writeAudit(tx, me.id, "payout.create", "payout", row.id, {
      after: payout,
    });
    return payout;
  });
}

export async function doDeleteLenderPayout(
  ctx: Ctx,
  args: { id: number },
): Promise<void> {
  const me = requireAdmin(ctx);
  const before = await fetchPayout(ctx.db, args.id);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(lenderPayouts)
      .set({ deletedAt: nowSecs() })
      .where(eq(lenderPayouts.id, args.id));
    await writeAudit(tx, me.id, "payout.delete", "payout", args.id, {
      before,
    });
  });
}

// Silence unused-import warnings if Drizzle helpers aren't used elsewhere in file.
export { asc };
