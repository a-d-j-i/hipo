// Unit tests for /api/system/status. Calls `do_getSystemStatus`
// directly against an in-memory libsql DB. Browser-shape coverage
// lives on the frontend (Phase 6 manual smoke + future Playwright
// milestone).

import { assert, assertEquals } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { STATUS_SCHEMA_VERSION } from "@hipo/server";
import { splitStatements } from "../db/client.ts";
import { migrations } from "../db/migrations.ts";
import { backupTargetState } from "../db/schema.ts";
import type { Ctx } from "@hipo/auth";
import { do_getSystemStatus } from "./operations.ts";

async function freshCtx(): Promise<Ctx> {
  const tmp = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${tmp}` });
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
  return { db: drizzle(client), user: null };
}

Deno.test("system.status: schema version + framework version present", async () => {
  const ctx = await freshCtx();
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.status_schema_version, STATUS_SCHEMA_VERSION);
  assert(typeof s.framework_version === "string");
});

Deno.test("system.status: Deno runtime reports shape=server + libsql-local", async () => {
  const ctx = await freshCtx();
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.shape, "server");
  assertEquals(s.storage.backend, "libsql-local");
});

Deno.test("system.status: server shape clears cleared_by_browser_data_clear", async () => {
  const ctx = await freshCtx();
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.risk_flags.cleared_by_browser_data_clear, false);
});

Deno.test("system.status: empty target table flags no_backup_configured", async () => {
  const ctx = await freshCtx();
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.backups.targets.length, 0);
  assertEquals(s.risk_flags.no_backup_configured, true);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, false);
});

Deno.test("system.status: recent verified backup → survives_device_loss_via_backup=true", async () => {
  const ctx = await freshCtx();
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.insert(backupTargetState).values({
    targetId: "local-download",
    configuredAt: now,
    lastBackupAt: now - 60, // 1 minute ago
    lastBackupSizeBytes: 1234,
    lastVerifyAt: now - 50,
    lastVerifyOk: 1,
  });
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.backups.targets.length, 1);
  assertEquals(s.backups.targets[0].id, "local-download");
  assertEquals(s.backups.targets[0].last_verify_ok, true);
  assertEquals(s.risk_flags.no_backup_configured, false);
  assertEquals(s.risk_flags.no_recent_backup, false);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, true);
});

Deno.test("system.status: stale backup → no_recent_backup=true, survives=false", async () => {
  const ctx = await freshCtx();
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.insert(backupTargetState).values({
    targetId: "github",
    configuredAt: now - 30 * 86400,
    lastBackupAt: now - 30 * 86400, // 30 days ago
    lastVerifyAt: now - 30 * 86400,
    lastVerifyOk: 1,
  });
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.risk_flags.no_recent_backup, true);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, false);
});

Deno.test("system.status: failed last verify → last_verify_failed=true", async () => {
  const ctx = await freshCtx();
  const now = Math.floor(Date.now() / 1000);
  await ctx.db.insert(backupTargetState).values({
    targetId: "github",
    configuredAt: now,
    lastBackupAt: now - 60,
    lastVerifyAt: now - 30,
    lastVerifyOk: 0,
  });
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.risk_flags.last_verify_failed, true);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, false);
});

Deno.test("system.status: write-only target (no verify) still counts as recent", async () => {
  const ctx = await freshCtx();
  const now = Math.floor(Date.now() / 1000);
  // local-download never verifies — last_verify_ok stays null. Recent
  // last_backup_at is enough to flip survives_device_loss_via_backup.
  await ctx.db.insert(backupTargetState).values({
    targetId: "local-download",
    configuredAt: now,
    lastBackupAt: now - 60,
    lastVerifyAt: null,
    lastVerifyOk: null,
  });
  const s = await do_getSystemStatus(ctx);
  assertEquals(s.risk_flags.last_verify_failed, false);
  assertEquals(s.risk_flags.survives_device_loss_via_backup, true);
});
