// Mock backend for `VITE_USE_MOCKS=1` dev mode. Stubs `window.fetch` for
// `/api/*` URLs so the React app can run end-to-end without booting the
// Deno backend. Originally this file used `mockIPC` from
// `@tauri-apps/api/mocks` (intercepting Tauri's `invoke()`), but since the
// frontend now talks to the backend over `fetch()`, we intercept that
// instead.
//
// All seed data + business logic mirrors what the real Deno backend would
// do; just enough fidelity that the UI can be exercised without paint
// glitches or fake error states.

import type {
  AuditEntry,
  DebtorPayment,
  DebtorPaymentSplit,
  LenderBalance,
  LenderPayout,
  Loan,
  LoanLender,
  LoanLenderInput,
  LoanStatus,
  Party,
  Role,
  User,
} from "@hipo/shared";
import { splitPayment } from "@hipo/shared";

// ---------- In-memory "database" ----------

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
let nextUserId = 3;

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
    principal_cents: 10_000_000,
    interest_cents: 1_500_000,
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
  raw: Array<[number, number]>,
): DebtorPaymentSplit[] =>
  raw
    .filter(([, cents]) => cents > 0)
    .map(([lenderId, cents]) => ({
      lender_id: lenderId,
      lender_name:
        loan.lenders.find((l) => l.lender_id === lenderId)?.lender_name ?? "?",
      amount_cents: cents,
    }));

const toUser = (u: DbUser): User => ({
  id: u.id,
  username: u.username,
  role: u.role,
  created_at: u.created_at,
});

// ---------- AppError equivalent ----------

class MockError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const badRequest = (msg: string) => new MockError(400, msg);
const unauthorized = (msg = "unauthorized") => new MockError(401, msg);
const forbidden = (msg = "forbidden") => new MockError(403, msg);
const notFound = (msg: string) => new MockError(404, msg);
const conflict = (msg: string) => new MockError(409, msg);

const requireAuth = (): User => {
  if (!currentUser) throw unauthorized();
  return currentUser;
};

const requireAdmin = (): User => {
  const me = requireAuth();
  if (me.role !== "admin") throw forbidden();
  return me;
};

// ---------- Route handlers ----------

type Body = Record<string, unknown> | undefined;
type Args = { match: RegExpMatchArray; query: URLSearchParams; body: Body };

type Handler = (args: Args) => unknown;

function asInt(s: string | undefined | null): number {
  if (!s) throw badRequest("id is required");
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) throw badRequest("invalid id");
  return n;
}

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  // ---- health ----
  {
    method: "GET",
    pattern: /^\/api\/healthz$/,
    handler: () => ({
      ok: true,
      user: currentUser
        ? { id: currentUser.id, username: currentUser.username, role: currentUser.role }
        : null,
    }),
  },

  // ---- auth ----
  {
    method: "GET",
    pattern: /^\/api\/auth\/status$/,
    handler: () => ({
      needs_setup: active(users).length === 0,
      current_user: currentUser,
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/auth\/me$/,
    handler: () => currentUser,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/setup$/,
    handler: ({ body }) => {
      if (active(users).length > 0) throw badRequest("setup already completed");
      const u: DbUser = {
        id: nextUserId++,
        username: String(body?.username ?? "").trim(),
        role: "admin",
        created_at: nowSecs(),
        passwordHash: String(body?.password ?? ""),
        deletedAt: null,
      };
      users.push(u);
      currentUser = toUser(u);
      logAudit("user.setup_first_admin", "user", u.id, { after: toUser(u) });
      return currentUser;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    handler: ({ body }) => {
      const u = active(users).find((x) => x.username === body?.username);
      if (!u || u.passwordHash !== body?.password)
        throw badRequest("wrong username or password");
      currentUser = toUser(u);
      return currentUser;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    handler: () => {
      currentUser = null;
      return null;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/change_password$/,
    handler: ({ body }) => {
      const me = requireAuth();
      const u = active(users).find((x) => x.id === me.id)!;
      if (u.passwordHash !== body?.oldPassword)
        throw badRequest("wrong username or password");
      u.passwordHash = String(body?.newPassword ?? "");
      logAudit("user.change_password", "user", me.id, {});
      return null;
    },
  },

  // ---- users ----
  {
    method: "GET",
    pattern: /^\/api\/users$/,
    handler: () => {
      requireAdmin();
      return active(users).map(toUser);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/users$/,
    handler: ({ body }) => {
      requireAdmin();
      if (active(users).some((x) => x.username === body?.username))
        throw conflict("username already exists");
      const u: DbUser = {
        id: nextUserId++,
        username: String(body?.username ?? "").trim(),
        role: body?.role as Role,
        created_at: nowSecs(),
        passwordHash: String(body?.password ?? ""),
        deletedAt: null,
      };
      users.push(u);
      logAudit("user.create", "user", u.id, { after: toUser(u) });
      return toUser(u);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/users\/(\d+)$/,
    handler: ({ match }) => {
      const me = requireAdmin();
      const id = asInt(match[1]);
      if (me.id === id) throw badRequest("you cannot delete yourself");
      const u = active(users).find((x) => x.id === id);
      if (!u) throw notFound("user not found");
      const before = toUser(u);
      u.deletedAt = nowSecs();
      logAudit("user.delete", "user", before.id, { before });
      return null;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/users\/(\d+)\/reset_password$/,
    handler: ({ match, body }) => {
      requireAdmin();
      const id = asInt(match[1]);
      const u = active(users).find((x) => x.id === id);
      if (!u) throw notFound("user not found");
      u.passwordHash = String(body?.newPassword ?? "");
      logAudit("user.password_reset", "user", u.id, {});
      return null;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/users\/(\d+)\/role$/,
    handler: ({ match, body }) => {
      const me = requireAdmin();
      const id = asInt(match[1]);
      if (me.id === id) throw badRequest("you cannot change your own role");
      const u = active(users).find((x) => x.id === id);
      if (!u) throw notFound("user not found");
      const beforeRole = u.role;
      u.role = body?.role as Role;
      logAudit("user.change_role", "user", u.id, {
        before: { role: beforeRole },
        after: { role: u.role },
      });
      return null;
    },
  },

  // ---- parties ----
  {
    method: "GET",
    pattern: /^\/api\/parties$/,
    handler: () => {
      requireAuth();
      return active(parties)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/parties$/,
    handler: ({ body }) => {
      const me = requireAuth();
      const name = String(body?.name ?? "").trim();
      if (!name) throw badRequest("name is required");
      const p: DbParty = {
        id: nextPartyId++,
        name,
        external_ref: (body?.externalRef as string | null) || null,
        notes: (body?.notes as string | null) || null,
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      parties.push(p);
      logAudit("party.create", "party", p.id, { after: p });
      return p;
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/parties\/(\d+)$/,
    handler: ({ match }) => {
      requireAuth();
      const id = asInt(match[1]);
      const p = active(parties).find((x) => x.id === id);
      if (!p) throw notFound("party not found");
      return p;
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/parties\/(\d+)$/,
    handler: ({ match, body }) => {
      requireAuth();
      const id = asInt(match[1]);
      const p = active(parties).find((x) => x.id === id);
      if (!p) throw notFound("party not found");
      const name = String(body?.name ?? "").trim();
      if (!name) throw badRequest("name is required");
      const before = { ...p };
      p.name = name;
      p.external_ref = (body?.externalRef as string | null) || null;
      p.notes = (body?.notes as string | null) || null;
      logAudit("party.update", "party", p.id, { before, after: p });
      return p;
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/parties\/(\d+)$/,
    handler: ({ match }) => {
      requireAdmin();
      const id = asInt(match[1]);
      const p = active(parties).find((x) => x.id === id);
      if (!p) throw notFound("party not found");
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("party.delete", "party", before.id, { before });
      return null;
    },
  },

  // ---- loans ----
  {
    method: "GET",
    pattern: /^\/api\/loans$/,
    handler: () => {
      requireAuth();
      return active(loans)
        .slice()
        .sort((a, b) => b.issued_at - a.issued_at);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/loans$/,
    handler: ({ body }) => {
      const me = requireAuth();
      const debtor = active(parties).find((p) => p.id === body?.debtorId);
      if (!debtor) throw notFound(`party ${body?.debtorId} not found`);
      const raw = body?.lenders as LoanLenderInput[] | undefined;
      if (!raw || raw.length === 0)
        throw badRequest("loan needs at least one lender");
      const seen = new Set<number>();
      for (const r of raw) {
        if (r.amountLentCents <= 0) throw badRequest("each lender amount must be > 0");
        if (seen.has(r.lenderId))
          throw badRequest(`lender ${r.lenderId} appears more than once`);
        seen.add(r.lenderId);
      }
      const principal = raw.reduce((s, r) => s + r.amountLentCents, 0);
      const loan: DbLoan = {
        id: nextLoanId++,
        reference: (body?.reference as string | null) || null,
        debtor_id: debtor.id,
        debtor_name: debtor.name,
        currency_code: String(body?.currencyCode ?? "").toUpperCase(),
        principal_cents: principal,
        interest_cents: (body?.interestCents as number) ?? 0,
        issued_at: body?.issuedAt as number,
        status: "active",
        notes: (body?.notes as string | null) || null,
        lenders: expandLenders(raw),
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      loans.push(loan);
      logAudit("loan.create", "loan", loan.id, { after: loan });
      return loan;
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/loans\/(\d+)$/,
    handler: ({ match }) => {
      requireAuth();
      const id = asInt(match[1]);
      const l = active(loans).find((x) => x.id === id);
      if (!l) throw notFound("loan not found");
      return l;
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/loans\/(\d+)$/,
    handler: ({ match, body }) => {
      requireAuth();
      const id = asInt(match[1]);
      const l = active(loans).find((x) => x.id === id);
      if (!l) throw notFound("loan not found");
      const before = { ...l };
      l.reference = (body?.reference as string | null) || null;
      l.interest_cents = (body?.interestCents as number) ?? 0;
      l.issued_at = body?.issuedAt as number;
      l.status = body?.status as LoanStatus;
      l.notes = (body?.notes as string | null) || null;
      logAudit("loan.update", "loan", l.id, { before, after: l });
      return l;
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/loans\/(\d+)\/lenders$/,
    handler: ({ match, body }) => {
      requireAuth();
      const loanId = asInt(match[1]);
      const l = active(loans).find((x) => x.id === loanId);
      if (!l) throw notFound("loan not found");
      if (active(payments).some((p) => p.loan_id === loanId))
        throw badRequest("cannot change lenders: loan has payments");
      const raw = body?.lenders as LoanLenderInput[] | undefined;
      if (!raw || raw.length === 0)
        throw badRequest("loan needs at least one lender");
      const seen = new Set<number>();
      for (const r of raw) {
        if (r.amountLentCents <= 0) throw badRequest("each lender amount must be > 0");
        if (seen.has(r.lenderId))
          throw badRequest(`lender ${r.lenderId} appears more than once`);
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
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/loans\/(\d+)$/,
    handler: ({ match }) => {
      requireAdmin();
      const id = asInt(match[1]);
      const l = active(loans).find((x) => x.id === id);
      if (!l) throw notFound("loan not found");
      if (active(payments).some((p) => p.loan_id === id))
        throw badRequest("cannot delete loan with payments: close it instead");
      const before = { ...l };
      l.deletedAt = nowSecs();
      logAudit("loan.delete", "loan", before.id, { before });
      return null;
    },
  },

  // ---- payments ----
  {
    method: "GET",
    pattern: /^\/api\/payments$/,
    handler: ({ query }) => {
      requireAuth();
      const loanId = asInt(query.get("loan_id"));
      return active(payments)
        .filter((p) => p.loan_id === loanId)
        .sort((a, b) => b.paid_at - a.paid_at);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/payments$/,
    handler: ({ body }) => {
      const me = requireAuth();
      const loan = active(loans).find((l) => l.id === body?.loanId);
      if (!loan) throw notFound("loan not found");
      if (loan.status !== "active") throw badRequest("loan is not active");
      const amount = body?.amountCents as number;
      if (amount <= 0) throw badRequest("amount must be > 0");
      const shares = loan.lenders.map((l): [number, number] => [
        l.lender_id,
        l.amount_lent_cents,
      ]);
      const split = splitPayment(amount, shares);
      const payment: StoredPayment = {
        id: nextPaymentId++,
        loan_id: loan.id,
        amount_cents: amount,
        paid_at: body?.paidAt as number,
        notes: (body?.notes as string | null) || null,
        splits: expandSplits(loan, split),
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      payments.push(payment);
      logAudit("payment.create", "payment", payment.id, { after: payment });
      return payment;
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/payments\/(\d+)$/,
    handler: ({ match }) => {
      requireAdmin();
      const id = asInt(match[1]);
      const p = active(payments).find((x) => x.id === id);
      if (!p) throw notFound("payment not found");
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("payment.delete", "payment", before.id, { before });
      return null;
    },
  },

  // ---- payouts ----
  // (declare /balances BEFORE /:id so the routing regex picks it first)
  {
    method: "GET",
    pattern: /^\/api\/payouts\/balances$/,
    handler: () => {
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
      return Array.from(totals.values()).sort(
        (a, b) =>
          a.lender_name.localeCompare(b.lender_name) ||
          a.currency_code.localeCompare(b.currency_code),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/payouts$/,
    handler: () => {
      requireAuth();
      return active(lenderPayouts)
        .slice()
        .sort((a, b) => b.paid_at - a.paid_at || b.id - a.id);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/payouts$/,
    handler: ({ body }) => {
      const me = requireAuth();
      const lender = active(parties).find((p) => p.id === body?.lenderId);
      if (!lender) throw notFound(`party ${body?.lenderId} not found`);
      const ccy = String(body?.currencyCode ?? "").toUpperCase();
      if (ccy.length !== 3 || !/^[A-Z]{3}$/.test(ccy))
        throw badRequest("currency_code must be 3 uppercase letters (ISO 4217)");
      const amount = body?.amountCents as number;
      if (amount <= 0) throw badRequest("amount must be > 0");
      const payout: DbPayout = {
        id: nextPayoutId++,
        lender_id: lender.id,
        lender_name: lender.name,
        currency_code: ccy,
        amount_cents: amount,
        paid_at: body?.paidAt as number,
        notes: (body?.notes as string | null) || null,
        created_at: nowSecs(),
        created_by: me.id,
        deletedAt: null,
      };
      lenderPayouts.push(payout);
      logAudit("payout.create", "payout", payout.id, { after: payout });
      return payout;
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/payouts\/(\d+)$/,
    handler: ({ match }) => {
      requireAdmin();
      const id = asInt(match[1]);
      const p = active(lenderPayouts).find((x) => x.id === id);
      if (!p) throw notFound("payout not found");
      const before = { ...p };
      p.deletedAt = nowSecs();
      logAudit("payout.delete", "payout", before.id, { before });
      return null;
    },
  },

  // ---- audit ----
  {
    method: "GET",
    pattern: /^\/api\/audit$/,
    handler: ({ query }) => {
      requireAdmin();
      const entityType = query.get("entity_type");
      const userIdRaw = query.get("user_id");
      let filtered = auditLog.slice().reverse(); // newest first
      if (entityType)
        filtered = filtered.filter((e) => e.entity_type === entityType);
      if (userIdRaw) {
        const uid = Number.parseInt(userIdRaw, 10);
        if (Number.isFinite(uid)) filtered = filtered.filter((e) => e.user_id === uid);
      }
      const limit = Math.min(
        Math.max(Number.parseInt(query.get("limit") ?? "50", 10) || 50, 1),
        500,
      );
      const offset = Math.max(
        Number.parseInt(query.get("offset") ?? "0", 10) || 0,
        0,
      );
      return filtered.slice(offset, offset + limit);
    },
  },
];

// ---------- Fetch interceptor ----------

function dispatch(
  method: string,
  url: URL,
  body: Body,
): { status: number; body: unknown } {
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = url.pathname.match(r.pattern);
    if (!match) continue;
    try {
      const result = r.handler({ match, query: url.searchParams, body });
      return { status: 200, body: result };
    } catch (err) {
      if (err instanceof MockError) {
        return { status: err.status, body: { error: err.message } };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 500, body: { error: msg } };
    }
  }
  return { status: 404, body: { error: `unhandled ${method} ${url.pathname}` } };
}

const originalFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
    window.location.origin,
  );

  // Pass-through for anything that isn't an API call.
  if (!url.pathname.startsWith("/api/")) {
    return originalFetch(input, init);
  }

  const method = (init?.method ?? "GET").toUpperCase();
  let body: Body;
  if (init?.body) {
    try {
      body = JSON.parse(String(init.body));
    } catch {
      body = undefined;
    }
  }

  const { status, body: respBody } = dispatch(method, url, body);
  // Match the real backend's response shape exactly so the frontend's
  // httpRequest helper handles success/error identically.
  return new Response(JSON.stringify(respBody), {
    status,
    headers: { "content-type": "application/json" },
  });
};

// eslint-disable-next-line no-console
console.info(
  "[hipo] mock backend active — fetch is stubbed. Seed users:",
  users.map((u) => ({
    username: u.username,
    role: u.role,
    password: u.passwordHash,
  })),
);
