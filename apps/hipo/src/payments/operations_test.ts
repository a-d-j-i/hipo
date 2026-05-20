import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { auditLog } from "../db/schema.ts";
import { splitStatements } from "../db/client.ts";
import { migrations } from "../db/migrations.ts";
import { AppError } from "@hipo/server";
import {
  type Ctx,
  doCreateUser,
  doSetupFirstAdmin,
  type User,
} from "@hipo/auth";
import { doCreateParty } from "../parties/operations.ts";
import {
  doCreateLoan,
  doDeleteLoan,
  doSetLoanLenders,
  doUpdateLoan,
} from "../loans/operations.ts";
import {
  doCreateDebtorPayment,
  doDeleteDebtorPayment,
  doListLoanPayments,
} from "./operations.ts";

type Fixture = {
  ctx: Ctx;
  setUser: (u: User | null) => void;
  admin: User;
  loanId: number;
  lenderA: number;
  lenderB: number;
};

async function freshFixture(): Promise<Fixture> {
  const tmpFile = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${tmpFile}` });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(
    `CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  );
  for (const m of migrations) {
    for (const stmt of splitStatements(m.sql)) {
      await client.execute(stmt);
    }
    await client.execute({
      sql: "INSERT INTO migrations (version) VALUES (?)",
      args: [m.version],
    });
  }
  const db = drizzle(client);
  const ctx: Ctx = { db, user: null };
  const setUser = (u: User | null) => {
    ctx.user = u;
  };
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  const debtor = await doCreateParty(ctx, {
    name: "Juan",
    externalRef: null,
    notes: null,
  });
  const alice = await doCreateParty(ctx, {
    name: "Alice",
    externalRef: null,
    notes: null,
  });
  const bob = await doCreateParty(ctx, {
    name: "Bob",
    externalRef: null,
    notes: null,
  });
  const loan = await doCreateLoan(ctx, {
    reference: null,
    debtorId: debtor.id,
    currencyCode: "USD",
    interestCents: 0,
    issuedAt: 1700000000,
    notes: null,
    lenders: [
      { lenderId: alice.id, amountLentCents: 60_000 },
      { lenderId: bob.id, amountLentCents: 40_000 },
    ],
  });
  return {
    ctx,
    setUser,
    admin,
    loanId: loan.id,
    lenderA: alice.id,
    lenderB: bob.id,
  };
}

Deno.test("create_payment_splits_correctly", async () => {
  const f = await freshFixture();
  // $50 payment → Alice 60% = 3000, Bob 40% = 2000
  const p = await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 5000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  assertEquals(p.amount_cents, 5000);
  assertEquals(p.splits.length, 2);
  const byName = new Map(p.splits.map((s) => [s.lender_name, s.amount_cents]));
  assertEquals(byName.get("Alice"), 3000);
  assertEquals(byName.get("Bob"), 2000);
  assertEquals(
    p.splits.reduce((s, x) => s + x.amount_cents, 0),
    5000,
  );
});

Deno.test("create_payment_rejects_zero_amount", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateDebtorPayment(f.ctx, {
        loanId: f.loanId,
        principalCents: 0,
        interestCents: 0,
        paidAt: 1700000100,
        notes: null,
      }),
    AppError,
    "> 0",
  );
});

Deno.test("create_payment_rejects_closed_loan", async () => {
  const f = await freshFixture();
  await doUpdateLoan(f.ctx, {
    id: f.loanId,
    reference: null,
    interestCents: 0,
    issuedAt: 1700000000,
    status: "closed",
    notes: null,
  });
  await assertRejects(
    () =>
      doCreateDebtorPayment(f.ctx, {
        loanId: f.loanId,
        principalCents: 1000,
        interestCents: 0,
        paidAt: 1700000100,
        notes: null,
      }),
    AppError,
    "not active",
  );
});

Deno.test("create_payment_rejects_missing_loan", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateDebtorPayment(f.ctx, {
        loanId: 99_999,
        principalCents: 1000,
        interestCents: 0,
        paidAt: 1700000100,
        notes: null,
      }),
    AppError,
    "loan not found",
  );
});

Deno.test("list_payments_orders_by_paid_at_desc", async () => {
  const f = await freshFixture();
  await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 1000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 2000,
    interestCents: 0,
    paidAt: 1700000300,
    notes: null,
  });
  await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 1500,
    interestCents: 0,
    paidAt: 1700000200,
    notes: null,
  });
  const list = await doListLoanPayments(f.ctx, { loanId: f.loanId });
  assertEquals(
    list.map((p) => p.paid_at),
    [1700000300, 1700000200, 1700000100],
  );
});

Deno.test("delete_payment_soft_deletes_admin_only", async () => {
  const f = await freshFixture();
  const p = await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 5000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  const alice = await doCreateUser(f.ctx, {
    username: "alice",
    password: "password123",
    role: "user",
  });
  f.setUser(alice);
  await assertRejects(
    () => doDeleteDebtorPayment(f.ctx, { id: p.id }),
    AppError,
    "forbidden",
  );
  f.setUser(f.admin);
  await doDeleteDebtorPayment(f.ctx, { id: p.id });
  assertEquals(
    (await doListLoanPayments(f.ctx, { loanId: f.loanId })).length,
    0,
  );
});

Deno.test("cannot_set_lenders_when_payments_exist", async () => {
  const f = await freshFixture();
  await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 5000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  await assertRejects(
    () =>
      doSetLoanLenders(f.ctx, {
        loanId: f.loanId,
        lenders: [{ lenderId: f.lenderA, amountLentCents: 100_000 }],
      }),
    AppError,
    "payments",
  );
});

Deno.test("cannot_delete_loan_when_payments_exist", async () => {
  const f = await freshFixture();
  await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 5000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  await assertRejects(
    () => doDeleteLoan(f.ctx, { id: f.loanId }),
    AppError,
    "payments",
  );
});

Deno.test("create_payment_with_promoter_off_the_top_of_interest", async () => {
  // 60/40 Alice/Bob lenders + a promoter taking 10% off the top of interest.
  const f = await freshFixture();
  const promoter = await doCreateParty(f.ctx, {
    name: "Promotora SA",
    externalRef: null,
    notes: null,
  });
  const loan = await doCreateLoan(f.ctx, {
    reference: "LN-P",
    debtorId: (
      await doCreateParty(f.ctx, {
        name: "Other Debtor",
        externalRef: null,
        notes: null,
      })
    ).id,
    currencyCode: "USD",
    interestCents: 1000,
    issuedAt: 1700000000,
    notes: null,
    lenders: [
      { lenderId: f.lenderA, amountLentCents: 60_000 },
      { lenderId: f.lenderB, amountLentCents: 40_000 },
    ],
    promoters: [{ partyId: promoter.id, shareBps: 1000 }],
  });
  const p = await doCreateDebtorPayment(f.ctx, {
    loanId: loan.id,
    principalCents: 10_000,
    interestCents: 1_000,
    paidAt: 1700000100,
    notes: null,
  });
  assertEquals(p.amount_cents, 11_000);
  // Promoter gets 100 (10% of 1000). Lenders split (10000 + 900) = 10900
  // by 60/40 → 6540 / 4360.
  const byParty = new Map(
    p.splits.map((s) => [s.lender_name, [s.amount_cents, s.kind] as const]),
  );
  assertEquals(byParty.get("Promotora SA"), [100, "promoter"]);
  assertEquals(byParty.get("Alice"), [6540, "lender"]);
  assertEquals(byParty.get("Bob"), [4360, "lender"]);
  assertEquals(
    p.splits.reduce((s, x) => s + x.amount_cents, 0),
    11_000,
  );
});

Deno.test("audit_log_records_payment_mutations", async () => {
  const f = await freshFixture();
  const p = await doCreateDebtorPayment(f.ctx, {
    loanId: f.loanId,
    principalCents: 5000,
    interestCents: 0,
    paidAt: 1700000100,
    notes: null,
  });
  await doDeleteDebtorPayment(f.ctx, { id: p.id });
  const rows = await f.ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityType, "payment"))
    .orderBy(asc(auditLog.id));
  assertEquals(
    rows.map((r) => r.action),
    ["payment.create", "payment.delete"],
  );
});
