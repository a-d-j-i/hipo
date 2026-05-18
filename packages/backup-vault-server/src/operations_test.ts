// Operations tests for the vault package. Uses an in-memory libsql DB.
// The minimal schema below creates only the tables the vault operations
// actually touch: users (FK target), audit_log, vault_pats, vault_blobs.

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { splitStatements } from "@hipo/sqlite";
import { vaultMigrations } from "./migrations.ts";
import type { Ctx, User } from "@hipo/auth";
import { requireAuth } from "@hipo/auth";
import {
  do_getVaultBlob,
  do_listVaultPats,
  do_mintVaultPat,
  do_putVaultBlob,
  do_revokeVaultPat,
} from "./operations.ts";

// Minimum schema to support vault operations: auth tables are FKs;
// audit_log records every mutation; vault tables hold the data.
const BOOTSTRAP_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    deleted_at INTEGER
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    payload TEXT
  );
`;

type Setup = {
  ctx: Ctx;
  path: string;
  client: ReturnType<typeof createClient>;
  loginAs(user: User): void;
  createUser(username?: string): Promise<User>;
};

async function freshDb(): Promise<Setup> {
  const path = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${path}` });
  await client.execute("PRAGMA foreign_keys = ON");

  for (const stmt of splitStatements(BOOTSTRAP_SQL)) {
    if (stmt.trim()) await client.execute(stmt);
  }
  for (const m of vaultMigrations) {
    for (const stmt of splitStatements(m.sql)) {
      if (stmt.trim()) await client.execute(stmt);
    }
  }

  const db = drizzle(client);
  const ctx: Ctx = { db, user: null };

  let nextId = 1;
  const createUser = async (username = "testuser"): Promise<User> => {
    const id = nextId++;
    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, role, created_at)
            VALUES (?, ?, 'x', 'admin', unixepoch())`,
      args: [id, username],
    });
    return {
      id,
      username,
      role: "admin" as const,
      created_at: Math.floor(Date.now() / 1000),
    };
  };

  const loginAs = (user: User) => {
    ctx.user = user;
  };

  return { ctx, path, client, loginAs, createUser };
}

async function cleanup(s: Setup) {
  try {
    s.client.close();
  } catch {
    /* already closed */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    await Deno.remove(s.path + suffix).catch(() => {});
  }
}

// Suppress unused import lint.
void requireAuth;

// ---------------------------------------------------------------------------
// PAT management
// ---------------------------------------------------------------------------

Deno.test("vault: mint → list shows the PAT", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin");
    s.loginAs(admin);
    const minted = await do_mintVaultPat(s.ctx, { label: "my-backup" });
    assertExists(minted.token);
    assertEquals(typeof minted.token_hash, "string");
    assertEquals(minted.label, "my-backup");
    assertEquals(typeof minted.created_at, "number");

    const list = await do_listVaultPats(s.ctx);
    assertEquals(list.length, 1);
    assertEquals(list[0].token_hash, minted.token_hash);
    assertEquals(list[0].label, "my-backup");
    assertEquals(list[0].last_used_at, null);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: mint without label stores null label", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin2");
    s.loginAs(admin);
    const minted = await do_mintVaultPat(s.ctx, {});
    assertEquals(minted.label, null);
    const list = await do_listVaultPats(s.ctx);
    assertEquals(list[0].label, null);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: revoke → list empty", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin3");
    s.loginAs(admin);
    const minted = await do_mintVaultPat(s.ctx, {});
    await do_revokeVaultPat(s.ctx, { token_hash: minted.token_hash });
    const list = await do_listVaultPats(s.ctx);
    assertEquals(list.length, 0);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: revoke wrong hash rejects", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin4");
    s.loginAs(admin);
    await assertRejects(
      () => do_revokeVaultPat(s.ctx, { token_hash: "deadbeef" }),
      Error,
    );
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: user A cannot revoke user B's PAT", async () => {
  const s = await freshDb();
  try {
    const userA = await s.createUser("userA");
    const userB = await s.createUser("userB");
    // A mints a PAT.
    s.loginAs(userA);
    const minted = await do_mintVaultPat(s.ctx, { label: "A-pat" });
    // B tries to revoke A's PAT — should fail (PAT not found for B).
    s.loginAs(userB);
    await assertRejects(
      () => do_revokeVaultPat(s.ctx, { token_hash: minted.token_hash }),
      Error,
    );
  } finally {
    await cleanup(s);
  }
});

// ---------------------------------------------------------------------------
// Blob put / get
// ---------------------------------------------------------------------------

Deno.test("vault: put → get round-trip", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin5");
    s.loginAs(admin);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const put = await do_putVaultBlob(s.ctx, { blob_id: "backup.bin", bytes: data });
    assertEquals(put.size_bytes, 5);
    assertEquals(typeof put.updated_at, "number");

    const got = await do_getVaultBlob(s.ctx, { blob_id: "backup.bin" });
    assertExists(got);
    // Compare as Uint8Array regardless of whether the driver returns Buffer
    // or Uint8Array — the customType normalises on read but assertEquals is
    // strict about constructor type across Deno/Node.
    assertEquals(Array.from(got.bytes), Array.from(data));
    assertEquals(got.size_bytes, 5);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: get non-existent blob returns null", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin6");
    s.loginAs(admin);
    const got = await do_getVaultBlob(s.ctx, { blob_id: "missing.bin" });
    assertEquals(got, null);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: put overwrites previous blob", async () => {
  const s = await freshDb();
  try {
    const admin = await s.createUser("admin7");
    s.loginAs(admin);
    await do_putVaultBlob(s.ctx, {
      blob_id: "backup.bin",
      bytes: new Uint8Array([1, 2]),
    });
    await do_putVaultBlob(s.ctx, {
      blob_id: "backup.bin",
      bytes: new Uint8Array([9, 8, 7]),
    });
    const got = await do_getVaultBlob(s.ctx, { blob_id: "backup.bin" });
    assertExists(got);
    assertEquals(Array.from(got.bytes), [9, 8, 7]);
    assertEquals(got.size_bytes, 3);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: user A blob is not visible to user B", async () => {
  const s = await freshDb();
  try {
    const userA = await s.createUser("blobuserA");
    const userB = await s.createUser("blobuserB");
    s.loginAs(userA);
    await do_putVaultBlob(s.ctx, {
      blob_id: "backup.bin",
      bytes: new Uint8Array([1, 2, 3]),
    });
    // B should not see A's blob.
    s.loginAs(userB);
    const got = await do_getVaultBlob(s.ctx, { blob_id: "backup.bin" });
    assertEquals(got, null);
  } finally {
    await cleanup(s);
  }
});

Deno.test("vault: operations require auth", async () => {
  const s = await freshDb();
  try {
    // No user set.
    await assertRejects(() => do_mintVaultPat(s.ctx, {}));
    await assertRejects(() => do_listVaultPats(s.ctx));
    await assertRejects(() =>
      do_putVaultBlob(s.ctx, { blob_id: "x", bytes: new Uint8Array([1]) }),
    );
    await assertRejects(() => do_getVaultBlob(s.ctx, { blob_id: "x" }));
  } finally {
    await cleanup(s);
  }
});
