import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { writeAudit, type Tx } from "@hipo/audit";
import { type Ctx, nowSecs, requireAdmin, requireAuth } from "@hipo/auth";
import type { Db } from "@hipo/sqlite";
import {
  debtorPayments,
  loanLenders,
  loanPromoters,
  loans,
  parties,
} from "../db/schema.ts";
import { badRequest, notFound } from "@hipo/server";
import type {
  CreateLoanInput,
  LoanLenderInput,
  LoanPromoter,
  LoanPromoterInput,
  LoanStatus,
  Loan,
  LoanLender,
  UpdateLoanInput,
} from "./types.ts";
import {
  normalizeOpt,
  validateCurrencyCode,
  validateLenders,
  validateLoanComposition,
  validatePromoters,
} from "./validators.ts";

async function partyExists(
  db: Db | Tx,
  id: number,
  role: "debtor" | "lender" = "debtor",
): Promise<void> {
  const rows = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, id), isNull(parties.deletedAt)))
    .limit(1);
  if (rows.length === 0)
    throw notFound(`${role === "debtor" ? "party" : "lender"} ${id} not found`);
}

async function loanHasPayments(db: Db | Tx, loanId: number): Promise<boolean> {
  const rows = await db
    .select({ id: debtorPayments.id })
    .from(debtorPayments)
    .where(
      and(eq(debtorPayments.loanId, loanId), isNull(debtorPayments.deletedAt)),
    )
    .limit(1);
  return rows.length > 0;
}

async function fetchLenders(
  db: Db | Tx,
  loanId: number,
): Promise<LoanLender[]> {
  const rows = await db
    .select({
      lender_id: loanLenders.lenderId,
      lender_name: parties.name,
      amount_lent_cents: loanLenders.amountLentCents,
    })
    .from(loanLenders)
    .innerJoin(parties, eq(parties.id, loanLenders.lenderId))
    .where(eq(loanLenders.loanId, loanId))
    .orderBy(asc(parties.name));
  return rows;
}

async function fetchPromoters(
  db: Db | Tx,
  loanId: number,
): Promise<LoanPromoter[]> {
  const rows = await db
    .select({
      party_id: loanPromoters.partyId,
      party_name: parties.name,
      share_bps: loanPromoters.shareBps,
    })
    .from(loanPromoters)
    .innerJoin(parties, eq(parties.id, loanPromoters.partyId))
    .where(eq(loanPromoters.loanId, loanId))
    .orderBy(asc(parties.name));
  return rows;
}

async function fetchLoan(db: Db | Tx, id: number): Promise<Loan> {
  const rows = await db
    .select({
      id: loans.id,
      reference: loans.reference,
      debtor_id: loans.debtorId,
      debtor_name: parties.name,
      currency_code: loans.currencyCode,
      principal_cents: loans.principalCents,
      interest_cents: loans.interestCents,
      issued_at: loans.issuedAt,
      status: loans.status,
      notes: loans.notes,
      created_at: loans.createdAt,
      created_by: loans.createdBy,
    })
    .from(loans)
    .innerJoin(parties, eq(parties.id, loans.debtorId))
    .where(and(eq(loans.id, id), isNull(loans.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw notFound("loan not found");
  const head = rows[0];
  return {
    ...head,
    lenders: await fetchLenders(db, id),
    promoters: await fetchPromoters(db, id),
  };
}

async function insertLenders(
  tx: Tx,
  loanId: number,
  lenders: LoanLenderInput[],
): Promise<void> {
  for (const l of lenders) {
    await partyExists(tx, l.lenderId, "lender");
    await tx.insert(loanLenders).values({
      loanId,
      lenderId: l.lenderId,
      amountLentCents: l.amountLentCents,
    });
  }
}

async function insertPromoters(
  tx: Tx,
  loanId: number,
  promoters: LoanPromoterInput[],
): Promise<void> {
  for (const p of promoters) {
    await partyExists(tx, p.partyId, "lender");
    await tx.insert(loanPromoters).values({
      loanId,
      partyId: p.partyId,
      shareBps: p.shareBps,
    });
  }
}

// ---------- Reads ----------

export async function doListLoans(ctx: Ctx): Promise<Loan[]> {
  requireAuth(ctx);
  const heads = await ctx.db
    .select({
      id: loans.id,
      reference: loans.reference,
      debtor_id: loans.debtorId,
      debtor_name: parties.name,
      currency_code: loans.currencyCode,
      principal_cents: loans.principalCents,
      interest_cents: loans.interestCents,
      issued_at: loans.issuedAt,
      status: loans.status,
      notes: loans.notes,
      created_at: loans.createdAt,
      created_by: loans.createdBy,
    })
    .from(loans)
    .innerJoin(parties, eq(parties.id, loans.debtorId))
    .where(isNull(loans.deletedAt))
    .orderBy(desc(loans.issuedAt), desc(loans.id));

  if (heads.length === 0) return [];

  // Fetch all lenders for the page in one query, then group by loan_id.
  const ids = heads.map((h) => h.id);
  const lenderRows = await ctx.db
    .select({
      loan_id: loanLenders.loanId,
      lender_id: loanLenders.lenderId,
      lender_name: parties.name,
      amount_lent_cents: loanLenders.amountLentCents,
    })
    .from(loanLenders)
    .innerJoin(parties, eq(parties.id, loanLenders.lenderId))
    .where(inArray(loanLenders.loanId, ids))
    .orderBy(asc(parties.name));

  const promoterRows = await ctx.db
    .select({
      loan_id: loanPromoters.loanId,
      party_id: loanPromoters.partyId,
      party_name: parties.name,
      share_bps: loanPromoters.shareBps,
    })
    .from(loanPromoters)
    .innerJoin(parties, eq(parties.id, loanPromoters.partyId))
    .where(inArray(loanPromoters.loanId, ids))
    .orderBy(asc(parties.name));

  const lendersByLoan = new Map<number, LoanLender[]>();
  for (const r of lenderRows) {
    const arr = lendersByLoan.get(r.loan_id) ?? [];
    arr.push({
      lender_id: r.lender_id,
      lender_name: r.lender_name,
      amount_lent_cents: r.amount_lent_cents,
    });
    lendersByLoan.set(r.loan_id, arr);
  }
  const promotersByLoan = new Map<number, LoanPromoter[]>();
  for (const r of promoterRows) {
    const arr = promotersByLoan.get(r.loan_id) ?? [];
    arr.push({
      party_id: r.party_id,
      party_name: r.party_name,
      share_bps: r.share_bps,
    });
    promotersByLoan.set(r.loan_id, arr);
  }

  return heads.map((h) => ({
    ...h,
    lenders: lendersByLoan.get(h.id) ?? [],
    promoters: promotersByLoan.get(h.id) ?? [],
  }));
}

export async function doGetLoan(ctx: Ctx, args: { id: number }): Promise<Loan> {
  requireAuth(ctx);
  return await fetchLoan(ctx.db, args.id);
}

// ---------- Writes ----------

export async function doCreateLoan(
  ctx: Ctx,
  args: CreateLoanInput,
): Promise<Loan> {
  const me = requireAuth(ctx);
  const currencyCode = args.currencyCode.trim().toUpperCase();
  validateCurrencyCode(currencyCode);
  if (args.interestCents < 0) throw badRequest("interest must be >= 0");
  const principalCents = validateLenders(args.lenders);
  const promoters = args.promoters ?? [];
  validatePromoters(promoters);
  validateLoanComposition(args.lenders, promoters);
  const reference = normalizeOpt(args.reference);
  const notes = normalizeOpt(args.notes);
  const now = nowSecs();

  await partyExists(ctx.db, args.debtorId);

  return await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(loans)
      .values({
        reference,
        debtorId: args.debtorId,
        currencyCode,
        principalCents,
        interestCents: args.interestCents,
        issuedAt: args.issuedAt,
        status: "active",
        notes,
        createdAt: now,
        createdBy: me.id,
      })
      .returning({ id: loans.id });
    await insertLenders(tx, row.id, args.lenders);
    await insertPromoters(tx, row.id, promoters);
    const loan = await fetchLoan(tx, row.id);
    await writeAudit(tx, me.id, "loan.create", "loan", row.id, {
      after: loan,
    });
    return loan;
  });
}

export async function doUpdateLoan(
  ctx: Ctx,
  args: UpdateLoanInput,
): Promise<Loan> {
  const me = requireAuth(ctx);
  if (args.interestCents < 0) throw badRequest("interest must be >= 0");
  const reference = normalizeOpt(args.reference);
  const notes = normalizeOpt(args.notes);

  const before = await fetchLoan(ctx.db, args.id);

  return await ctx.db.transaction(async (tx) => {
    await tx
      .update(loans)
      .set({
        reference,
        interestCents: args.interestCents,
        issuedAt: args.issuedAt,
        status: args.status,
        notes,
      })
      .where(eq(loans.id, args.id));
    const after = await fetchLoan(tx, args.id);
    await writeAudit(tx, me.id, "loan.update", "loan", args.id, {
      before,
      after,
    });
    return after;
  });
}

export async function doSetLoanLenders(
  ctx: Ctx,
  args: { loanId: number; lenders: LoanLenderInput[] },
): Promise<Loan> {
  const me = requireAuth(ctx);
  const before = await fetchLoan(ctx.db, args.loanId);
  if (await loanHasPayments(ctx.db, args.loanId))
    throw badRequest("cannot change lenders: loan has payments");
  const newPrincipal = validateLenders(args.lenders);
  validateLoanComposition(args.lenders, beforePromotersAsInput(before));

  return await ctx.db.transaction(async (tx) => {
    await tx.delete(loanLenders).where(eq(loanLenders.loanId, args.loanId));
    await insertLenders(tx, args.loanId, args.lenders);
    await tx
      .update(loans)
      .set({ principalCents: newPrincipal })
      .where(eq(loans.id, args.loanId));
    const after = await fetchLoan(tx, args.loanId);
    await writeAudit(tx, me.id, "loan.set_lenders", "loan", args.loanId, {
      before: {
        principal_cents: before.principal_cents,
        lenders: before.lenders,
      },
      after: {
        principal_cents: after.principal_cents,
        lenders: after.lenders,
      },
    });
    return after;
  });
}

function beforePromotersAsInput(loan: Loan): LoanPromoterInput[] {
  return loan.promoters.map((p) => ({
    partyId: p.party_id,
    shareBps: p.share_bps,
  }));
}

export async function doSetLoanPromoters(
  ctx: Ctx,
  args: { loanId: number; promoters: LoanPromoterInput[] },
): Promise<Loan> {
  const me = requireAuth(ctx);
  const before = await fetchLoan(ctx.db, args.loanId);
  if (await loanHasPayments(ctx.db, args.loanId))
    throw badRequest("cannot change promoters: loan has payments");
  validatePromoters(args.promoters);
  validateLoanComposition(
    before.lenders.map((l) => ({
      lenderId: l.lender_id,
      amountLentCents: l.amount_lent_cents,
    })),
    args.promoters,
  );

  return await ctx.db.transaction(async (tx) => {
    await tx.delete(loanPromoters).where(eq(loanPromoters.loanId, args.loanId));
    await insertPromoters(tx, args.loanId, args.promoters);
    const after = await fetchLoan(tx, args.loanId);
    await writeAudit(tx, me.id, "loan.set_promoters", "loan", args.loanId, {
      before: { promoters: before.promoters },
      after: { promoters: after.promoters },
    });
    return after;
  });
}

export async function doDeleteLoan(
  ctx: Ctx,
  args: { id: number },
): Promise<void> {
  const me = requireAdmin(ctx);
  const before = await fetchLoan(ctx.db, args.id);
  if (await loanHasPayments(ctx.db, args.id))
    throw badRequest("cannot delete loan with payments: close it instead");

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(loans)
      .set({ deletedAt: nowSecs() })
      .where(eq(loans.id, args.id));
    await writeAudit(tx, me.id, "loan.delete", "loan", args.id, {
      before,
    });
  });
}

// Re-export for use by payments module (when it lands)
export { loanHasPayments };

// Silence unused-import warnings when the file is otherwise consumed by tests.
export type { LoanStatus };
