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
import { doCreateLoan } from "../loans/operations.ts";
import { doCreateDebtorPayment } from "../payments/operations.ts";
import {
  doCreateLenderPayout,
  doDeleteLenderPayout,
  doLenderBalances,
} from "./operations.ts";

type Fixture = {
  ctx: Ctx;
  setUser: (u: User | null) => void;
  admin: User;
  debtor: number;
  alice: number;
  bob: number;
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
  return {
    ctx,
    setUser,
    admin,
    debtor: debtor.id,
    alice: alice.id,
    bob: bob.id,
  };
}

async function loanWithSplit(
  f: Fixture,
  currency: string,
  aShare: number,
  bShare: number,
): Promise<number> {
  const loan = await doCreateLoan(f.ctx, {
    reference: null,
    debtorId: f.debtor,
    currencyCode: currency,
    interestCents: 0,
    issuedAt: 1700000000,
    notes: null,
    lenders: [
      { lenderId: f.alice, amountLentCents: aShare },
      { lenderId: f.bob, amountLentCents: bShare },
    ],
  });
  return loan.id;
}

Deno.test("create_payout_happy_path", async () => {
  const f = await freshFixture();
  const p = await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 5000,
    paidAt: 1700000200,
    notes: "first payout",
  });
  assertEquals(p.amount_cents, 5000);
  assertEquals(p.currency_code, "USD");
  assertEquals(p.lender_name, "Alice");
});

Deno.test("create_payout_validates_party_exists", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLenderPayout(f.ctx, {
        lenderId: 99_999,
        currencyCode: "USD",
        amountCents: 100,
        paidAt: 1,
        notes: null,
      }),
    AppError,
    "not found",
  );
});

Deno.test("create_payout_validates_currency_and_amount", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLenderPayout(f.ctx, {
        lenderId: f.alice,
        currencyCode: "us",
        amountCents: 100,
        paidAt: 1,
        notes: null,
      }),
    AppError,
    "currency_code",
  );
  await assertRejects(
    () =>
      doCreateLenderPayout(f.ctx, {
        lenderId: f.alice,
        currencyCode: "USD",
        amountCents: 0,
        paidAt: 1,
        notes: null,
      }),
    AppError,
    "> 0",
  );
});

Deno.test("delete_payout_admin_only", async () => {
  const f = await freshFixture();
  const p = await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 100,
    paidAt: 1,
    notes: null,
  });
  const carol = await doCreateUser(f.ctx, {
    username: "carol",
    password: "password123",
    role: "user",
  });
  f.setUser(carol);
  await assertRejects(
    () => doDeleteLenderPayout(f.ctx, { id: p.id }),
    AppError,
    "forbidden",
  );
  f.setUser(f.admin);
  await doDeleteLenderPayout(f.ctx, { id: p.id });
});

Deno.test("balances_simple_case", async () => {
  const f = await freshFixture();
  const loan = await loanWithSplit(f, "USD", 60_000, 40_000);
  await doCreateDebtorPayment(f.ctx, {
    loanId: loan,
    amountCents: 10_000,
    paidAt: 1700000100,
    notes: null,
  });
  const bals = await doLenderBalances(f.ctx);
  const alice = bals.find((b) => b.lender_name === "Alice")!;
  const bob = bals.find((b) => b.lender_name === "Bob")!;
  assertEquals(alice.received_cents, 6000);
  assertEquals(alice.paid_out_cents, 0);
  assertEquals(alice.outstanding_cents, 6000);
  assertEquals(bob.outstanding_cents, 4000);
});

Deno.test("balances_after_payout", async () => {
  const f = await freshFixture();
  const loan = await loanWithSplit(f, "USD", 60_000, 40_000);
  await doCreateDebtorPayment(f.ctx, {
    loanId: loan,
    amountCents: 10_000,
    paidAt: 1700000100,
    notes: null,
  });
  await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 5000,
    paidAt: 1700000200,
    notes: null,
  });
  const bals = await doLenderBalances(f.ctx);
  const alice = bals.find((b) => b.lender_name === "Alice")!;
  assertEquals(alice.received_cents, 6000);
  assertEquals(alice.paid_out_cents, 5000);
  assertEquals(alice.outstanding_cents, 1000);
});

Deno.test("balances_overdraft_is_negative", async () => {
  const f = await freshFixture();
  const loan = await loanWithSplit(f, "USD", 60_000, 40_000);
  await doCreateDebtorPayment(f.ctx, {
    loanId: loan,
    amountCents: 1000,
    paidAt: 1700000100,
    notes: null,
  });
  await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 5000,
    paidAt: 1700000200,
    notes: null,
  });
  const bals = await doLenderBalances(f.ctx);
  const alice = bals.find((b) => b.lender_name === "Alice")!;
  // 60% of 1000 = 600 received, 5000 paid → -4400 outstanding
  assertEquals(alice.received_cents, 600);
  assertEquals(alice.paid_out_cents, 5000);
  assertEquals(alice.outstanding_cents, -4400);
});

Deno.test("balances_split_across_currencies", async () => {
  const f = await freshFixture();
  const usd = await loanWithSplit(f, "USD", 60_000, 40_000);
  const ars = await loanWithSplit(f, "ARS", 80_000, 20_000);
  await doCreateDebtorPayment(f.ctx, {
    loanId: usd,
    amountCents: 10_000,
    paidAt: 1700000100,
    notes: null,
  });
  await doCreateDebtorPayment(f.ctx, {
    loanId: ars,
    amountCents: 10_000,
    paidAt: 1700000100,
    notes: null,
  });
  const bals = await doLenderBalances(f.ctx);
  const aliceUsd = bals.find(
    (b) => b.lender_name === "Alice" && b.currency_code === "USD",
  )!;
  const aliceArs = bals.find(
    (b) => b.lender_name === "Alice" && b.currency_code === "ARS",
  )!;
  assertEquals(aliceUsd.outstanding_cents, 6000);
  assertEquals(aliceArs.outstanding_cents, 8000);
});

Deno.test("balances_payout_only_lender_appears", async () => {
  // A lender with payouts but no payments still shows up (negative outstanding).
  const f = await freshFixture();
  await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 5000,
    paidAt: 1700000200,
    notes: null,
  });
  const bals = await doLenderBalances(f.ctx);
  const alice = bals.find((b) => b.lender_name === "Alice")!;
  assertEquals(alice.received_cents, 0);
  assertEquals(alice.paid_out_cents, 5000);
  assertEquals(alice.outstanding_cents, -5000);
});

Deno.test("audit_log_records_payout_mutations", async () => {
  const f = await freshFixture();
  const p = await doCreateLenderPayout(f.ctx, {
    lenderId: f.alice,
    currencyCode: "USD",
    amountCents: 100,
    paidAt: 1,
    notes: null,
  });
  await doDeleteLenderPayout(f.ctx, { id: p.id });
  const rows = await f.ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityType, "payout"))
    .orderBy(asc(auditLog.id));
  assertEquals(
    rows.map((r) => r.action),
    ["payout.create", "payout.delete"],
  );
});
