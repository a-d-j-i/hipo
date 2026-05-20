import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { auditLog } from "../db/schema.ts";
import { splitStatements } from "../db/client.ts";
import { migrations } from "../db/migrations.ts";
import { AppError } from "@hipo/server";
import { doCreateUser, doSetupFirstAdmin } from "../auth/operations.ts";
import type { Ctx, User } from "@hipo/auth";
import {
  doCreateParty,
  doDeleteParty,
  doGetParty,
  doListParties,
  doUpdateParty,
} from "./operations.ts";

async function freshCtx(): Promise<{
  ctx: Ctx;
  setUser: (u: User | null) => void;
  loginAsAdmin: () => Promise<User>;
}> {
  // libsql :memory: doesn't survive db.transaction() — use temp file.
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
  const loginAsAdmin = async () => {
    const admin = await doSetupFirstAdmin(ctx, {
      username: "root",
      password: "password123",
    });
    setUser(admin);
    return admin;
  };
  return { ctx, setUser, loginAsAdmin };
}

Deno.test("create_list_get_update_delete", async () => {
  const { ctx, loginAsAdmin } = await freshCtx();
  await loginAsAdmin();

  const created = await doCreateParty(ctx, {
    name: "Banco Galicia",
    externalRef: "CUIT-30-50000000-1",
    notes: null,
  });
  assertEquals(created.name, "Banco Galicia");
  assertEquals(created.external_ref, "CUIT-30-50000000-1");

  const got = await doGetParty(ctx, { id: created.id });
  assertEquals(got.id, created.id);

  const updated = await doUpdateParty(ctx, {
    id: created.id,
    name: "Banco Galicia SA",
    externalRef: null,
    notes: "changed",
  });
  assertEquals(updated.name, "Banco Galicia SA");
  assertEquals(updated.external_ref, null);
  assertEquals(updated.notes, "changed");

  assertEquals((await doListParties(ctx)).length, 1);

  await doDeleteParty(ctx, { id: created.id });
  await assertRejects(
    () => doGetParty(ctx, { id: created.id }),
    AppError,
    "not found",
  );
  assertEquals((await doListParties(ctx)).length, 0);
});

Deno.test("empty_optional_fields_become_null", async () => {
  const { ctx, loginAsAdmin } = await freshCtx();
  await loginAsAdmin();
  const p = await doCreateParty(ctx, {
    name: "Juan",
    externalRef: "   ",
    notes: "",
  });
  assertEquals(p.external_ref, null);
  assertEquals(p.notes, null);
});

Deno.test("validate_rejects_blank_name", async () => {
  const { ctx, loginAsAdmin } = await freshCtx();
  await loginAsAdmin();
  await assertRejects(
    () => doCreateParty(ctx, { name: "   ", externalRef: null, notes: null }),
    AppError,
    "name",
  );
});

Deno.test(
  "delete_requires_admin; non-admin can list/create/update",
  async () => {
    const { ctx, setUser, loginAsAdmin } = await freshCtx();
    const admin = await loginAsAdmin();
    const p = await doCreateParty(ctx, {
      name: "X",
      externalRef: null,
      notes: null,
    });
    const alice = await doCreateUser(ctx, {
      username: "alice",
      password: "password123",
      role: "user",
    });
    setUser(alice);
    await assertRejects(
      () => doDeleteParty(ctx, { id: p.id }),
      AppError,
      "forbidden",
    );
    // Non-admin can still list, create, update:
    await doListParties(ctx);
    const p2 = await doCreateParty(ctx, {
      name: "Y",
      externalRef: null,
      notes: null,
    });
    await doUpdateParty(ctx, {
      id: p2.id,
      name: "Y2",
      externalRef: null,
      notes: null,
    });
    // Sanity: admin can delete.
    setUser(admin);
    await doDeleteParty(ctx, { id: p.id });
  },
);

Deno.test("audit_log_records_party_mutations", async () => {
  const { ctx, loginAsAdmin } = await freshCtx();
  await loginAsAdmin();
  const p = await doCreateParty(ctx, {
    name: "X",
    externalRef: null,
    notes: null,
  });
  await doUpdateParty(ctx, {
    id: p.id,
    name: "X2",
    externalRef: null,
    notes: null,
  });
  await doDeleteParty(ctx, { id: p.id });

  const rows = await ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityType, "party"))
    .orderBy(asc(auditLog.id));
  assertEquals(
    rows.map((r) => r.action),
    ["party.create", "party.update", "party.delete"],
  );
});

Deno.test("unauthenticated_cannot_list", async () => {
  const { ctx } = await freshCtx();
  await assertRejects(() => doListParties(ctx), AppError, "unauthenticated");
});
