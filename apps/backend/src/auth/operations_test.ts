import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { asc } from "drizzle-orm";
import { auditLog } from "../db/schema.ts";
import { splitStatements } from "../db/client.ts";
import { migrations } from "../db/migrations.ts";
import { AppError } from "../errors.ts";
import {
  doChangePassword,
  doChangeUserRole,
  doCreateUser,
  doDeleteUser,
  doListUsers,
  doLogin,
  doResetUserPassword,
  doSetupFirstAdmin,
} from "./operations.ts";
import type { Ctx, User } from "./types.ts";

async function freshCtx(): Promise<{ ctx: Ctx; setUser: (u: User | null) => void }> {
  // libsql's node binding doesn't keep :memory: state across db.transaction()
  // (each tx opens a new connection that sees an empty in-memory DB).
  // Use a temp file instead; Deno cleans it up on process exit.
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
  return {
    ctx,
    setUser: (u) => {
      ctx.user = u;
    },
  };
}

Deno.test("setup_then_login: setup creates the admin, login succeeds", async () => {
  const { ctx } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  assertEquals(admin.role, "admin");
  assertEquals(admin.username, "root");

  const again = await doLogin(ctx, {
    username: "root",
    password: "password123",
  });
  assertEquals(again.id, admin.id);
});

Deno.test("setup_twice_blocked", async () => {
  const { ctx } = await freshCtx();
  await doSetupFirstAdmin(ctx, { username: "root", password: "password123" });
  await assertRejects(
    () =>
      doSetupFirstAdmin(ctx, { username: "other", password: "password123" }),
    AppError,
    "already",
  );
});

Deno.test("login_with_wrong_password", async () => {
  const { ctx } = await freshCtx();
  await doSetupFirstAdmin(ctx, { username: "root", password: "password123" });
  await assertRejects(
    () => doLogin(ctx, { username: "root", password: "wrong" }),
    AppError,
    "wrong",
  );
});

Deno.test("change_password_flow", async () => {
  const { ctx, setUser } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  await doChangePassword(ctx, {
    oldPassword: "password123",
    newPassword: "newnewnew",
  });
  setUser(null);
  await assertRejects(() =>
    doLogin(ctx, { username: "root", password: "password123" })
  );
  const back = await doLogin(ctx, {
    username: "root",
    password: "newnewnew",
  });
  assertEquals(back.id, admin.id);
});

Deno.test("admin_can_manage_users + self-guards", async () => {
  const { ctx, setUser } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  const alice = await doCreateUser(ctx, {
    username: "alice",
    password: "password123",
    role: "user",
  });
  assertEquals((await doListUsers(ctx)).length, 2);
  await doChangeUserRole(ctx, { id: alice.id, role: "admin" });

  await assertRejects(
    () => doChangeUserRole(ctx, { id: admin.id, role: "user" }),
    AppError,
    "your own",
  );
  await assertRejects(
    () => doDeleteUser(ctx, { id: admin.id }),
    AppError,
    "yourself",
  );
  await doDeleteUser(ctx, { id: alice.id });
  assertEquals((await doListUsers(ctx)).length, 1);
});

Deno.test("duplicate_username_rejected", async () => {
  const { ctx, setUser } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  await doCreateUser(ctx, {
    username: "alice",
    password: "password123",
    role: "user",
  });
  await assertRejects(
    () =>
      doCreateUser(ctx, {
        username: "alice",
        password: "password123",
        role: "user",
      }),
    AppError,
    "exists",
  );
});

Deno.test("user_cannot_list_users", async () => {
  const { ctx, setUser } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  const alice = await doCreateUser(ctx, {
    username: "alice",
    password: "password123",
    role: "user",
  });
  setUser(alice);
  await assertRejects(() => doListUsers(ctx), AppError, "forbidden");
});

Deno.test("audit_log_records_user_mutations", async () => {
  const { ctx, setUser } = await freshCtx();
  const admin = await doSetupFirstAdmin(ctx, {
    username: "root",
    password: "password123",
  });
  setUser(admin);
  const bob = await doCreateUser(ctx, {
    username: "bob",
    password: "password123",
    role: "user",
  });
  await doChangeUserRole(ctx, { id: bob.id, role: "admin" });
  await doResetUserPassword(ctx, { id: bob.id, newPassword: "newpasspass" });
  await doDeleteUser(ctx, { id: bob.id });

  const rows = await ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .orderBy(asc(auditLog.id));
  assertEquals(
    rows.map((r) => r.action),
    [
      "user.setup_first_admin",
      "user.create",
      "user.change_role",
      "user.password_reset",
      "user.delete",
    ],
  );
  assert(rows.length === 5);
});
