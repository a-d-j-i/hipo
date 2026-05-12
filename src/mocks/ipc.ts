import { mockIPC } from "@tauri-apps/api/mocks";
import type { AuditEntry } from "../bindings/AuditEntry";
import type { DebtorPayment } from "../bindings/DebtorPayment";
import type { DebtorPaymentSplit } from "../bindings/DebtorPaymentSplit";
import type { LenderBalance } from "../bindings/LenderBalance";
import type { LenderPayout } from "../bindings/LenderPayout";
import type { Loan } from "../bindings/Loan";
import type { LoanLender } from "../bindings/LoanLender";
import type { LoanLenderInput } from "../bindings/LoanLenderInput";
import type { LoanStatus } from "../bindings/LoanStatus";
import type { Party } from "../bindings/Party";
import type { Role } from "../bindings/Role";
import type { User } from "../bindings/User";

type DbUser = User & { passwordHash: string; deletedAt: number | null };

const users: DbUser[] = [
  {
    id: 1,
    username: "admin",
    role: "admin",
    created_at: 1700000000,
    passwordHash: "admin123",
    deletedAt: null,
  },
  {
    id: 2,
    username: "alice",
    role: "user",
    created_at: 1700000100,
    passwordHash: "alice123",
    deletedAt: null,
  },
];

const active = <T extends { deletedAt: number | null }>(arr: T[]): T[] =>
  arr.filter((x) => x.deletedAt === null);

const nowSecs = () => Math.floor(Date.now() / 1000);

let currentUser: User | null = null;
let nextId = 3;

type DbParty = Party & { deletedAt: number | null };

const parties: DbParty[] = [
  {
    id: 1,
    name: "Banco Galicia",
    external_ref: "CUIT-30-50000000-1",
    notes: null,
    created_at: 1700000000,
    created_by: 1,
    deletedAt: null,
  },
  {
    id: 2,
    name: "María González",
    external_ref: null,
    notes: "Lender on multiple loans",
    created_at: 1700000100,
    created_by: 1,
    deletedAt: null,
  },
  {
    id: 3,
    name: "Juan Pérez",
    external_ref: "DNI-12345678",
    notes: null,
    created_at: 1700000200,
    created_by: 1,
    deletedAt: null,
  },
];
let nextPartyId = 4;

const partyName = (id: number) => parties.find((p) => p.id === id)?.name ?? "?";

const expandLenders = (raw: LoanLenderInput[]): LoanLender[] =>
  raw.map((r) => ({
    lender_id: r.lenderId,
    lender_name: partyName(r.lenderId),
    amount_lent_cents: r.amountLentCents,
  }));

type DbLoan = Loan & { deletedAt: number | null };

const loans: DbLoan[] = [
  {
    id: 1,
    reference: "LN-2025-001",
    debtor_id: 3,
    debtor_name: "Juan Pérez",
    currency_code: "USD",
    principal_cents: 10_000_000, // $100,000
    interest_cents: 1_500_000, // $15,000 flat
    issued_at: 1700000000,
    status: "active",
    notes: "Primera hipoteca residencial",
    lenders: [
      { lender_id: 1, lender_name: "Banco Galicia", amount_lent_cents: 6_000_000 },
      { lender_id: 2, lender_name: "María González", amount_lent_cents: 4_000_000 },
    ],
    created_at: 1700000000,
    created_by: 1,
    deletedAt: null,
  },
];
let nextLoanId = 2;

// Largest-remainder split — mirrors Rust split_payment.
function splitPayment(
  amountCents: number,
  shares: { lenderId: number; amountLentCents: number }[],
): { lenderId: number; cents: number }[] {
  if (shares.length === 0 || amountCents === 0)
    return shares.map((s) => ({ lenderId: s.lenderId, cents: 0 }));
  const principal = shares.reduce((s, r) => s + r.amountLentCents, 0);
  if (principal <= 0) return shares.map((s) => ({ lenderId: s.lenderId, cents: 0 }));
  // Use BigInt to avoid precision issues for large amounts.
  const A = BigInt(amountCents);
  const P = BigInt(principal);
  const rows = shares.map((s) => {
    const numerator = A * BigInt(s.amountLentCents);
    return {
      lenderId: s.lenderId,
      floor: Number(numerator / P),
      remainder: numerator % P,
    };
  });
  const floorSum = rows.reduce((s, r) => s + r.floor, 0);
  const residual = amountCents - floorSum;
  const order = rows
    .map((_, i) => i)
    .sort((a, b) => {
      const cmp = rows[b].remainder > rows[a].remainder ? 1 : rows[b].remainder < rows[a].remainder ? -1 : 0;
      if (cmp !== 0) return cmp;
      return rows[a].lenderId - rows[b].lenderId;
    });
  for (let i = 0; i < residual; i++) rows[order[i]].floor += 1;
  return rows.map((r) => ({ lenderId: r.lenderId, cents: r.floor }));
}

type StoredPayment = DebtorPayment & { deletedAt: number | null };

const payments: StoredPayment[] = [];
let nextPaymentId = 1;

type DbPayout = LenderPayout & { deletedAt: number | null };

const lenderPayouts: DbPayout[] = [];
let nextPayoutId = 1;

const auditLog: AuditEntry[] = [];
let nextAuditId = 1;
function logAudit(
  action: string,
  entityType: string,
  entityId: number | null,
  payload: unknown,
): void {
  if (!currentUser) return;
  auditLog.push({
    id: nextAuditId++,
    at: Math.floor(Date.now() / 1000),
    user_id: currentUser.id,
    user_name: currentUser.username,
    action,
    entity_type: entityType,
    entity_id: entityId,
    payload: payload == null ? null : JSON.stringify(payload),
  });
}

const expandSplits = (
  loan: Loan,
  raw: { lenderId: number; cents: number }[],
): DebtorPaymentSplit[] =>
  raw
    .filter((r) => r.cents > 0)
    .map((r) => ({
      lender_id: r.lenderId,
      lender_name:
        loan.lenders.find((l) => l.lender_id === r.lenderId)?.lender_name ?? "?",
      amount_cents: r.cents,
    }));

const toUser = (u: DbUser): User => ({
  id: u.id,
  username: u.username,
  role: u.role,
  created_at: u.created_at,
});

const requireAuth = (): User => {
  if (!currentUser) throw "unauthenticated";
  return currentUser;
};

const requireAdmin = (): User => {
  const me = requireAuth();
  if (me.role !== "admin") throw "forbidden";
  return me;
};

mockIPC((cmd, raw) => {
  const args = (raw ?? {}) as Record<string, unknown>;

  switch (cmd) {
    case "auth_status":
      return {
        needs_setup: active(users).length === 0,
        current_user: currentUser,
      };

    case "setup_first_admin": {
      if (active(users).length > 0) throw "setup already completed";
      const u: DbUser = {
        id: nextId++,
        username: String(args.username),
        role: "admin",
        created_at: nowSecs(),
        passwordHash: String(args.password),
        deletedAt: null,
      };
      users.push(u);
      currentUser = toUser(u);
      logAudit("user.setup_first_admin", "user", u.id, { after: toUser(u) });
      return currentUser;
    }

    case "login": {
      const u = active(users).find((x) => x.username === args.username);
      if (!u || u.passwordHash !== args.password)
        throw "wrong username or password";
      currentUser = toUser(u);
      return currentUser;
    }

    case "logout":
      currentUser = null;
      return null;

    case "current_user":
      return currentUser;

    case "change_password": {
      const me = requireAuth();
      const u = active(users).find((x) => x.id === me.id)!;
      if (u.passwordHash !== args.oldPassword) throw "wrong username or password";
      u.passwordHash = String(args.newPassword);
      logAudit("user.change_password", "user", me.id, {});
      return null;
    }

    case "list_users":
      requireAdmin();
      return active(users).map(toUser);

    case "create_user": {
      requireAdmin();
      if (active(users).some((x) => x.username === args.username))
        throw "username already exists";
      const u: DbUser = {
        id: nextId++,
        username: String(args.username),
        role: args.role as Role,
        created_at: nowSecs(),
        passwordHash: String(args.password),
        deletedAt: null,
      };
      users.push(u);
      logAudit("user.create", "user", u.id, { after: toUser(u) });
      return toUser(u);
    }

    case "delete_user": {
      const me = requireAdmin();
      if (me.id === args.id) throw "you cannot delete yourself";
      const u = active(users).find((x) => x.id === args.id);
      if (!u) throw "user not found";
      const before = toUser(u);
      u.deletedAt = nowSecs();
      logAudit("user.delete", "user", before.id, { before });
      return null;
    }

    case "reset_user_password": {
      requireAdmin();
      const u = active(users).find((x) => x.id === args.id);
      if (!u) throw "user not found";
      u.passwordHash = String(args.newPassword);
      logAudit("user.password_reset", "user", u.id, {});
      return null;
    }

    case "change_user_role": {
      const me = requireAdmin();
      if (me.id === args.id) throw "you cannot change your own role";
      const u = active(users).find((x) => x.id === args.id);
      if (!u) throw "user not found";
      const beforeRole = u.role;
      u.role = args.role as Role;
      logAudit("user.change_role", "user", u.id, {
        before: { role: beforeRole },
        after: { role: u.role },
      });
      return null;
    }

    case "list_parties":
      requireAuth();
      return active(parties)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));

    case "get_party": {
      requireAuth();
      const p = active(parties).find((x) => x.id === args.id);
      if (!p) throw "party not found";
      return p;
    }

    case "create_party": {
      const me = requireAuth();
      const name = String(args.name ?? "").trim();
      if (!name) throw "name is required";
      const p: DbParty = {
        id: nextPartyId++,
        name,
        external_ref: (args.externalRef as string | null) || null,
        notes: (args.notes as string | null) || null,
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      parties.push(p);
      logAudit("party.create", "party", p.id, { after: p });
      return p;
    }

    case "update_party": {
      requireAuth();
      const p = active(parties).find((x) => x.id === args.id);
      if (!p) throw "party not found";
      const name = String(args.name ?? "").trim();
      if (!name) throw "name is required";
      const before = { ...p };
      p.name = name;
      p.external_ref = (args.externalRef as string | null) || null;
      p.notes = (args.notes as string | null) || null;
      logAudit("party.update", "party", p.id, { before, after: p });
      return p;
    }

    case "delete_party": {
      requireAdmin();
      const p = active(parties).find((x) => x.id === args.id);
      if (!p) throw "party not found";
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("party.delete", "party", before.id, { before });
      return null;
    }

    case "list_loans":
      requireAuth();
      return active(loans)
        .slice()
        .sort((a, b) => b.issued_at - a.issued_at);

    case "get_loan": {
      requireAuth();
      const l = active(loans).find((x) => x.id === args.id);
      if (!l) throw "loan not found";
      return l;
    }

    case "create_loan": {
      const me = requireAuth();
      const debtor = active(parties).find((p) => p.id === args.debtorId);
      if (!debtor) throw `party ${args.debtorId} not found`;
      const raw = args.lenders as LoanLenderInput[];
      if (!raw || raw.length === 0) throw "loan needs at least one lender";
      const seen = new Set<number>();
      for (const r of raw) {
        if (r.amountLentCents <= 0) throw "each lender amount must be > 0";
        if (seen.has(r.lenderId))
          throw `lender ${r.lenderId} appears more than once`;
        seen.add(r.lenderId);
      }
      const principal = raw.reduce((s, r) => s + r.amountLentCents, 0);
      const loan: DbLoan = {
        id: nextLoanId++,
        reference: (args.reference as string | null) || null,
        debtor_id: debtor.id,
        debtor_name: debtor.name,
        currency_code: String(args.currencyCode).toUpperCase(),
        principal_cents: principal,
        interest_cents: (args.interestCents as number) ?? 0,
        issued_at: args.issuedAt as number,
        status: "active",
        notes: (args.notes as string | null) || null,
        lenders: expandLenders(raw),
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      loans.push(loan);
      logAudit("loan.create", "loan", loan.id, { after: loan });
      return loan;
    }

    case "update_loan": {
      requireAuth();
      const l = active(loans).find((x) => x.id === args.id);
      if (!l) throw "loan not found";
      const before = { ...l };
      l.reference = (args.reference as string | null) || null;
      l.interest_cents = (args.interestCents as number) ?? 0;
      l.issued_at = args.issuedAt as number;
      l.status = args.status as LoanStatus;
      l.notes = (args.notes as string | null) || null;
      logAudit("loan.update", "loan", l.id, { before, after: l });
      return l;
    }

    case "set_loan_lenders": {
      requireAuth();
      const l = active(loans).find((x) => x.id === args.loanId);
      if (!l) throw "loan not found";
      if (active(payments).some((p) => p.loan_id === args.loanId))
        throw "cannot change lenders: loan has payments";
      const raw = args.lenders as LoanLenderInput[];
      if (!raw || raw.length === 0) throw "loan needs at least one lender";
      const seen = new Set<number>();
      for (const r of raw) {
        if (r.amountLentCents <= 0) throw "each lender amount must be > 0";
        if (seen.has(r.lenderId))
          throw `lender ${r.lenderId} appears more than once`;
        seen.add(r.lenderId);
      }
      const beforePrincipal = l.principal_cents;
      const beforeLenders = l.lenders;
      const newPrincipal = raw.reduce((s, r) => s + r.amountLentCents, 0);
      l.principal_cents = newPrincipal;
      l.lenders = expandLenders(raw);
      logAudit("loan.set_lenders", "loan", l.id, {
        before: { principal_cents: beforePrincipal, lenders: beforeLenders },
        after: { principal_cents: newPrincipal, lenders: l.lenders },
      });
      return l;
    }

    case "delete_loan": {
      requireAdmin();
      const l = active(loans).find((x) => x.id === args.id);
      if (!l) throw "loan not found";
      if (active(payments).some((p) => p.loan_id === args.id))
        throw "cannot delete loan with payments: close it instead";
      const before = { ...l };
      l.deletedAt = nowSecs();
      logAudit("loan.delete", "loan", before.id, { before });
      return null;
    }

    case "list_loan_payments":
      requireAuth();
      return active(payments)
        .filter((p) => p.loan_id === args.loanId)
        .sort((a, b) => b.paid_at - a.paid_at);

    case "create_debtor_payment": {
      const me = requireAuth();
      const loan = active(loans).find((l) => l.id === args.loanId);
      if (!loan) throw "loan not found";
      if (loan.status !== "active") throw "loan is not active";
      const amount = args.amountCents as number;
      if (amount <= 0) throw "amount must be > 0";
      const shares = loan.lenders.map((l) => ({
        lenderId: l.lender_id,
        amountLentCents: l.amount_lent_cents,
      }));
      const split = splitPayment(amount, shares);
      const payment: StoredPayment = {
        id: nextPaymentId++,
        loan_id: loan.id,
        amount_cents: amount,
        paid_at: args.paidAt as number,
        notes: (args.notes as string | null) || null,
        splits: expandSplits(loan, split),
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      payments.push(payment);
      logAudit("payment.create", "payment", payment.id, { after: payment });
      return payment;
    }

    case "delete_debtor_payment": {
      requireAdmin();
      const p = active(payments).find((x) => x.id === args.id);
      if (!p) throw "payment not found";
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("payment.delete", "payment", before.id, { before });
      return null;
    }

    case "list_payouts":
      requireAuth();
      return active(lenderPayouts)
        .slice()
        .sort((a, b) => b.paid_at - a.paid_at || b.id - a.id);

    case "create_lender_payout": {
      const me = requireAuth();
      const lender = active(parties).find((p) => p.id === args.lenderId);
      if (!lender) throw `party ${args.lenderId} not found`;
      const ccy = String(args.currencyCode).toUpperCase();
      if (ccy.length !== 3 || !/^[A-Z]{3}$/.test(ccy))
        throw "currency_code must be 3 uppercase letters (ISO 4217)";
      const amount = args.amountCents as number;
      if (amount <= 0) throw "amount must be > 0";
      const payout: DbPayout = {
        id: nextPayoutId++,
        lender_id: lender.id,
        lender_name: lender.name,
        currency_code: ccy,
        amount_cents: amount,
        paid_at: args.paidAt as number,
        notes: (args.notes as string | null) || null,
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      lenderPayouts.push(payout);
      logAudit("payout.create", "payout", payout.id, { after: payout });
      return payout;
    }

    case "delete_lender_payout": {
      requireAdmin();
      const p = active(lenderPayouts).find((x) => x.id === args.id);
      if (!p) throw "payout not found";
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("payout.delete", "payout", before.id, { before });
      return null;
    }

    case "lender_balances": {
      requireAuth();
      const totals = new Map<string, LenderBalance>();
      const upsert = (
        lenderId: number,
        ccy: string,
        rec: number,
        paid: number,
      ) => {
        const key = `${lenderId}-${ccy}`;
        const existing = totals.get(key);
        if (existing) {
          existing.received_cents += rec;
          existing.paid_out_cents += paid;
          existing.outstanding_cents =
            existing.received_cents - existing.paid_out_cents;
        } else {
          const name = parties.find((p) => p.id === lenderId)?.name ?? "?";
          totals.set(key, {
            lender_id: lenderId,
            lender_name: name,
            currency_code: ccy,
            received_cents: rec,
            paid_out_cents: paid,
            outstanding_cents: rec - paid,
          });
        }
      };
      for (const p of active(payments)) {
        const loan = active(loans).find((l) => l.id === p.loan_id);
        if (!loan) continue;
        for (const s of p.splits) {
          upsert(s.lender_id, loan.currency_code, s.amount_cents, 0);
        }
      }
      for (const po of active(lenderPayouts)) {
        upsert(po.lender_id, po.currency_code, 0, po.amount_cents);
      }
      return Array.from(totals.values()).sort((a, b) =>
        a.lender_name.localeCompare(b.lender_name) ||
        a.currency_code.localeCompare(b.currency_code),
      );
    }

    case "list_audit_log": {
      requireAdmin();
      let filtered = auditLog.slice().reverse(); // newest first
      if (args.entityType)
        filtered = filtered.filter((e) => e.entity_type === args.entityType);
      if (args.userId != null)
        filtered = filtered.filter((e) => e.user_id === args.userId);
      const limit = Math.min(Math.max((args.limit as number) ?? 50, 1), 500);
      const offset = Math.max((args.offset as number) ?? 0, 0);
      return filtered.slice(offset, offset + limit);
    }

    default:
      throw `unmocked command: ${cmd}`;
  }
});

// eslint-disable-next-line no-console
console.info(
  "[hipo] mockIPC active — backend is mocked. Seed users:",
  users.map((u) => ({ username: u.username, role: u.role, password: u.passwordHash })),
);
