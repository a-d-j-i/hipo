// Coverage for backup_target_state CRUD and the snapshot/restore
// round-trip through `do_getDbSnapshot` / `do_applyDbSnapshot`. Uses
// the Deno BinaryFormat factory — the same one wired into the Deno
// server at boot — to prove the substrate adapter pattern works.

import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { gzipped } from "@hipo/backup";
import { binaryFormat } from "@hipo/sqlite/binary-format-deno";
import { migrations } from "../db/migrations.ts";
import { splitStatements } from "../db/client.ts";
import { backupTargetState, parties } from "../db/schema.ts";
import {
  type Ctx,
  doCreateUser,
  doSetupFirstAdmin,
  type User,
} from "@hipo/auth";
import { doCreateParty } from "../parties/operations.ts";
import {
  do_applyDbSnapshot,
  do_configureTarget,
  do_getDbSnapshot,
  do_listBackupTargets,
  do_recordBackup,
  do_recordVerify,
} from "./operations.ts";

type Setup = {
  ctx: Ctx;
  path: string;
  client: ReturnType<typeof createClient>;
  loginAsAdmin(): Promise<User>;
  loginAsUser(): Promise<User>;
};

async function freshDb(): Promise<Setup> {
  const path = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${path}` });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(
    `CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  );
  for (const m of migrations) {
    for (const stmt of splitStatements(m.sql)) await client.execute(stmt);
    await client.execute({
      sql: "INSERT INTO migrations (version) VALUES (?)",
      args: [m.version],
    });
  }
  const db = drizzle(client);
  const ctx: Ctx = { db, user: null };

  const loginAsAdmin = async () => {
    const admin = await doSetupFirstAdmin(ctx, {
      username: "root",
      password: "password123",
    });
    ctx.user = admin;
    return admin;
  };
  const loginAsUser = async () => {
    // Setup admin first if needed, then create a plain user, then
    // switch ctx.user.
    if (!ctx.user) await loginAsAdmin();
    const u = await doCreateUser(ctx, {
      username: "alice",
      password: "password123",
      role: "user",
    });
    ctx.user = u;
    return u;
  };

  return { ctx, path, client, loginAsAdmin, loginAsUser };
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

// ---------------------------------------------------------------------------
// State CRUD
// ---------------------------------------------------------------------------

Deno.test("backup state: configure → list returns one row", async () => {
  const s = await freshDb();
  try {
    await s.loginAsAdmin();
    await do_configureTarget(s.ctx, { target_id: "local-download" });
    const rows = await do_listBackupTargets(s.ctx);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].target_id, "local-download");
    assertEquals(rows[0].last_backup_at, null);
    assertEquals(rows[0].last_verify_ok, null);
  } finally {
    await cleanup(s);
  }
});

Deno.test(
  "backup state: configure is idempotent (no duplicate row)",
  async () => {
    const s = await freshDb();
    try {
      await s.loginAsAdmin();
      await do_configureTarget(s.ctx, { target_id: "github" });
      await do_configureTarget(s.ctx, { target_id: "github" });
      const rows = await do_listBackupTargets(s.ctx);
      assertEquals(rows.length, 1);
    } finally {
      await cleanup(s);
    }
  },
);

Deno.test(
  "backup state: record-backup stamps last_backup_at + size",
  async () => {
    const s = await freshDb();
    try {
      await s.loginAsAdmin();
      const row = await do_recordBackup(s.ctx, {
        target_id: "local-download",
        size_bytes: 4096,
      });
      assertEquals(row.last_backup_size_bytes, 4096);
      assertEquals(typeof row.last_backup_at, "number");
    } finally {
      await cleanup(s);
    }
  },
);

Deno.test("backup state: record-verify flips last_verify_ok", async () => {
  const s = await freshDb();
  try {
    await s.loginAsAdmin();
    await do_recordBackup(s.ctx, { target_id: "github", size_bytes: 10 });
    const ok = await do_recordVerify(s.ctx, {
      target_id: "github",
      ok: true,
    });
    assertEquals(ok.last_verify_ok, true);
    const bad = await do_recordVerify(s.ctx, {
      target_id: "github",
      ok: false,
    });
    assertEquals(bad.last_verify_ok, false);
  } finally {
    await cleanup(s);
  }
});

Deno.test("backup state: record-verify on unknown target rejects", async () => {
  const s = await freshDb();
  try {
    await s.loginAsAdmin();
    await assertRejects(
      () => do_recordVerify(s.ctx, { target_id: "ghost", ok: true }),
      Error,
      "unknown target_id",
    );
  } finally {
    await cleanup(s);
  }
});

Deno.test(
  "backup state: list requires auth; mutating requires admin",
  async () => {
    const s = await freshDb();
    try {
      // No user → list fails (requireAuth)
      await assertRejects(() => do_listBackupTargets(s.ctx));
      // Plain user → list works, mutate fails
      await s.loginAsUser();
      await do_listBackupTargets(s.ctx);
      await assertRejects(() =>
        do_recordBackup(s.ctx, { target_id: "x", size_bytes: 0 }),
      );
      await assertRejects(() => do_configureTarget(s.ctx, { target_id: "x" }));
    } finally {
      await cleanup(s);
    }
  },
);

// ---------------------------------------------------------------------------
// Snapshot / restore round-trip
// ---------------------------------------------------------------------------

Deno.test("snapshot/restore: round-trip preserves rows", async () => {
  const s = await freshDb();
  try {
    await s.loginAsAdmin();
    // Insert a domain row so the snapshot has identifiable content.
    await doCreateParty(s.ctx, {
      name: "Acme Bank",
      externalRef: "20-30303030-7",
      notes: null,
    });

    const fmt = gzipped(binaryFormat({ client: s.client, dbPath: s.path }));

    const snap = await do_getDbSnapshot(s.ctx, fmt);
    // Snapshot is a non-empty base64 string.
    if (snap.bytes_b64.length < 100) throw new Error("snapshot too short");

    // Trash the live row, then restore from the snapshot.
    await s.ctx.db.run(sql.raw(`DELETE FROM parties`));

    // Restore over the same file; this CLOSES the libsql client, so
    // we need to reopen afterwards. (do_applyDbSnapshot intentionally
    // doesn't throw after the close so the response can land.)
    await do_applyDbSnapshot(s.ctx, fmt, { bytes_b64: snap.bytes_b64 });

    // Reopen and verify the row is back.
    const c2 = createClient({ url: `file:${s.path}` });
    await c2.execute("PRAGMA foreign_keys = ON");
    const rows = await c2.execute(`SELECT name FROM parties`);
    assertEquals(rows.rows.length, 1);
    assertEquals(rows.rows[0].name, "Acme Bank");
    c2.close();
  } finally {
    await cleanup(s);
  }
});

Deno.test("snapshot: requires admin", async () => {
  const s = await freshDb();
  try {
    const fmt = gzipped(binaryFormat({ client: s.client, dbPath: s.path }));
    // No user
    await assertRejects(() => do_getDbSnapshot(s.ctx, fmt));
    // Plain user
    await s.loginAsUser();
    await assertRejects(() => do_getDbSnapshot(s.ctx, fmt));
  } finally {
    await cleanup(s);
  }
});

// Suppress unused-import warning — schema is loaded to ensure the
// migration ran in freshDb above.
void backupTargetState;
void parties;
