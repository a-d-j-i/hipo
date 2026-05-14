import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { auditLog } from "../db/schema.ts";
import { splitStatements } from "../db/client.ts";
import { migrations } from "../db/migrations.ts";
import { AppError } from "../errors.ts";
import { doCreateUser, doSetupFirstAdmin } from "../auth/operations.ts";
import type { Ctx, PublicUser } from "../auth/types.ts";
import { doCreateParty } from "../parties/operations.ts";
import {
  doCreateLoan,
  doDeleteLoan,
  doGetLoan,
  doListLoans,
  doSetLoanLenders,
  doUpdateLoan,
} from "./operations.ts";
import type { CreateLoanInput, PublicLoan } from "./types.ts";

type Fixture = {
  ctx: Ctx;
  setUser: (u: PublicUser | null) => void;
  admin: PublicUser;
  debtorId: number;
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
  const setUser = (u: PublicUser | null) => {
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
  const lenderA = await doCreateParty(ctx, {
    name: "Alice",
    externalRef: null,
    notes: null,
  });
  const lenderB = await doCreateParty(ctx, {
    name: "Bob",
    externalRef: null,
    notes: null,
  });
  return {
    ctx,
    setUser,
    admin,
    debtorId: debtor.id,
    lenderA: lenderA.id,
    lenderB: lenderB.id,
  };
}

function loanInput(f: Fixture): CreateLoanInput {
  return {
    reference: "LN-001",
    debtorId: f.debtorId,
    currencyCode: "USD",
    interestCents: 10_000,
    issuedAt: 1700000000,
    notes: null,
    lenders: [
      { lenderId: f.lenderA, amountLentCents: 60_000 },
      { lenderId: f.lenderB, amountLentCents: 40_000 },
    ],
  };
}

async function makeLoan(f: Fixture): Promise<PublicLoan> {
  return await doCreateLoan(f.ctx, loanInput(f));
}

Deno.test("create_list_get_loan", async () => {
  const f = await freshFixture();
  const loan = await makeLoan(f);
  assertEquals(loan.principal_cents, 100_000);
  assertEquals(loan.currency_code, "USD");
  assertEquals(loan.debtor_name, "Juan");
  assertEquals(loan.lenders.length, 2);

  const got = await doGetLoan(f.ctx, { id: loan.id });
  assertEquals(got.id, loan.id);

  const list = await doListLoans(f.ctx);
  assertEquals(list.length, 1);
  assertEquals(list[0].lenders.length, 2);
});

Deno.test("principal_is_derived_from_lenders", async () => {
  const f = await freshFixture();
  const loan = await doCreateLoan(f.ctx, {
    reference: null,
    debtorId: f.debtorId,
    currencyCode: "USD",
    interestCents: 0,
    issuedAt: 1,
    notes: null,
    lenders: [
      { lenderId: f.lenderA, amountLentCents: 70_000 },
      { lenderId: f.lenderB, amountLentCents: 30_000 },
    ],
  });
  assertEquals(loan.principal_cents, 100_000);
});

Deno.test("reject_zero_lender_amount_and_duplicates", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLoan(f.ctx, {
        reference: null,
        debtorId: f.debtorId,
        currencyCode: "USD",
        interestCents: 0,
        issuedAt: 1,
        notes: null,
        lenders: [{ lenderId: f.lenderA, amountLentCents: 0 }],
      }),
    AppError,
    "> 0",
  );

  await assertRejects(
    () =>
      doCreateLoan(f.ctx, {
        reference: null,
        debtorId: f.debtorId,
        currencyCode: "USD",
        interestCents: 0,
        issuedAt: 1,
        notes: null,
        lenders: [
          { lenderId: f.lenderA, amountLentCents: 50_000 },
          { lenderId: f.lenderA, amountLentCents: 50_000 },
        ],
      }),
    AppError,
    "more than once",
  );
});

Deno.test("reject_empty_lenders", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLoan(f.ctx, {
        reference: null,
        debtorId: f.debtorId,
        currencyCode: "USD",
        interestCents: 0,
        issuedAt: 1,
        notes: null,
        lenders: [],
      }),
    AppError,
    "at least one lender",
  );
});

Deno.test("reject_missing_party", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLoan(f.ctx, {
        reference: null,
        debtorId: 99_999,
        currencyCode: "USD",
        interestCents: 0,
        issuedAt: 1,
        notes: null,
        lenders: [{ lenderId: f.lenderA, amountLentCents: 100_000 }],
      }),
    AppError,
    "not found",
  );
});

Deno.test("reject_bad_currency", async () => {
  const f = await freshFixture();
  await assertRejects(
    () =>
      doCreateLoan(f.ctx, {
        reference: null,
        debtorId: f.debtorId,
        currencyCode: "us",
        interestCents: 0,
        issuedAt: 1,
        notes: null,
        lenders: [{ lenderId: f.lenderA, amountLentCents: 100_000 }],
      }),
    AppError,
    "currency_code",
  );
});

Deno.test("update_loan_soft_fields_only", async () => {
  const f = await freshFixture();
  const loan = await makeLoan(f);
  const updated = await doUpdateLoan(f.ctx, {
    id: loan.id,
    reference: "LN-001-v2",
    interestCents: 20_000,
    issuedAt: 1700000001,
    status: "closed",
    notes: "paid off",
  });
  assertEquals(updated.reference, "LN-001-v2");
  assertEquals(updated.interest_cents, 20_000);
  assertEquals(updated.status, "closed");
  // Immutable fields unchanged
  assertEquals(updated.principal_cents, loan.principal_cents);
  assertEquals(updated.debtor_id, loan.debtor_id);
  assertEquals(updated.currency_code, loan.currency_code);
});

Deno.test("set_loan_lenders_replaces_and_recomputes_principal", async () => {
  const f = await freshFixture();
  const loan = await makeLoan(f);
  assertEquals(loan.principal_cents, 100_000);
  const carol = await doCreateParty(f.ctx, {
    name: "Carol",
    externalRef: null,
    notes: null,
  });
  const after = await doSetLoanLenders(f.ctx, {
    loanId: loan.id,
    lenders: [
      { lenderId: f.lenderA, amountLentCents: 30_000 },
      { lenderId: carol.id, amountLentCents: 90_000 },
    ],
  });
  assertEquals(after.lenders.length, 2);
  assertEquals(after.principal_cents, 120_000);
  const names = after.lenders.map((l) => l.lender_name);
  assert(names.includes("Alice"));
  assert(names.includes("Carol"));
  assert(!names.includes("Bob"));
});

Deno.test("delete_loan_soft_deletes_admin_only", async () => {
  const f = await freshFixture();
  const loan = await makeLoan(f);
  const alice = await doCreateUser(f.ctx, {
    username: "alice",
    password: "password123",
    role: "user",
  });
  f.setUser(alice);
  await assertRejects(
    () => doDeleteLoan(f.ctx, { id: loan.id }),
    AppError,
    "forbidden",
  );
  f.setUser(f.admin);
  await doDeleteLoan(f.ctx, { id: loan.id });
  assertEquals((await doListLoans(f.ctx)).length, 0);
  await assertRejects(
    () => doGetLoan(f.ctx, { id: loan.id }),
    AppError,
    "not found",
  );
});

Deno.test("audit_log_records_loan_mutations", async () => {
  const f = await freshFixture();
  const loan = await makeLoan(f);
  await doUpdateLoan(f.ctx, {
    id: loan.id,
    reference: null,
    interestCents: 10_000,
    issuedAt: 1700000000,
    status: "active",
    notes: null,
  });
  await doSetLoanLenders(f.ctx, {
    loanId: loan.id,
    lenders: [
      { lenderId: f.lenderA, amountLentCents: 50_000 },
      { lenderId: f.lenderB, amountLentCents: 50_000 },
    ],
  });
  await doDeleteLoan(f.ctx, { id: loan.id });

  const rows = await f.ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityType, "loan"))
    .orderBy(asc(auditLog.id));
  assertEquals(
    rows.map((r) => r.action),
    ["loan.create", "loan.update", "loan.set_lenders", "loan.delete"],
  );
});
