// Backup state + snapshot operations. State CRUD goes through
// `backup_target_state`; snapshot/restore uses an injected
// `BackupFormat` (browser shape passes `binaryFormat({ local })`;
// Deno shape passes `binaryFormat({ client, dbPath })`).
//
// All snapshot/restore endpoints require admin: backups contain
// every row, including audit log + sessions. State CRUD also
// requires auth so signed-in users (not just admin) can read the
// status panel, but writing target state is admin-only.

import { asc, eq } from "drizzle-orm";
import type { BackupFormat } from "@hipo/backup";
import { type Ctx, nowSecs, requireAdmin, requireAuth } from "@hipo/auth";
import { backupTargetState } from "../db/schema.ts";
import { badRequest } from "@hipo/server";
import type {
  BackupTargetStateView,
  ConfigureTargetInput,
  RecordBackupInput,
  RecordVerifyInput,
  RestoreInput,
  SnapshotResponse,
} from "./types.ts";

// ---------------------------------------------------------------------------
// base64 helpers (JSON wire format)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to keep String.fromCharCode argument count under the
  // engine limit; 8 KB chunks are safe in every modern runtime.
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// State CRUD
// ---------------------------------------------------------------------------

function rowToView(r: {
  targetId: string;
  configuredAt: number;
  lastBackupAt: number | null;
  lastBackupSizeBytes: number | null;
  lastBackupFilename: string | null;
  lastVerifyAt: number | null;
  lastVerifyOk: number | null;
}): BackupTargetStateView {
  return {
    target_id: r.targetId,
    configured_at: r.configuredAt,
    last_backup_at: r.lastBackupAt,
    last_backup_size_bytes: r.lastBackupSizeBytes,
    last_backup_filename: r.lastBackupFilename,
    last_verify_at: r.lastVerifyAt,
    last_verify_ok: r.lastVerifyOk === null ? null : r.lastVerifyOk === 1,
  };
}

export async function do_listBackupTargets(
  ctx: Ctx,
): Promise<BackupTargetStateView[]> {
  requireAuth(ctx);
  const rows = await ctx.db
    .select()
    .from(backupTargetState)
    .orderBy(asc(backupTargetState.targetId));
  return rows.map(rowToView);
}

export async function do_configureTarget(
  ctx: Ctx,
  args: ConfigureTargetInput,
): Promise<BackupTargetStateView> {
  requireAdmin(ctx);
  const targetId = args.target_id?.trim();
  if (!targetId) throw badRequest("target_id is required");

  // ON CONFLICT DO NOTHING — first configure wins; later "configures"
  // are idempotent. Re-configuration of details (e.g. PAT rotation)
  // is target-specific and lives outside this row.
  await ctx.db
    .insert(backupTargetState)
    .values({ targetId, configuredAt: nowSecs() })
    .onConflictDoNothing();

  const [row] = await ctx.db
    .select()
    .from(backupTargetState)
    .where(eq(backupTargetState.targetId, targetId))
    .limit(1);
  if (!row) throw new Error("configureTarget: row missing after upsert");
  return rowToView(row);
}

export async function do_recordBackup(
  ctx: Ctx,
  args: RecordBackupInput,
): Promise<BackupTargetStateView> {
  requireAdmin(ctx);
  const targetId = args.target_id?.trim();
  if (!targetId) throw badRequest("target_id is required");
  if (!Number.isFinite(args.size_bytes) || args.size_bytes < 0) {
    throw badRequest("size_bytes must be a non-negative number");
  }
  const at = nowSecs();
  const filename =
    typeof args.filename === "string" && args.filename.length > 0
      ? args.filename
      : null;
  // Upsert: a `record-backup` before `configure` should still create
  // the row (the first put on a write-only target like local-download
  // is itself the "configuration").
  await ctx.db
    .insert(backupTargetState)
    .values({
      targetId,
      configuredAt: at,
      lastBackupAt: at,
      lastBackupSizeBytes: args.size_bytes,
      lastBackupFilename: filename,
    })
    .onConflictDoUpdate({
      target: backupTargetState.targetId,
      set: {
        lastBackupAt: at,
        lastBackupSizeBytes: args.size_bytes,
        lastBackupFilename: filename,
      },
    });
  const [row] = await ctx.db
    .select()
    .from(backupTargetState)
    .where(eq(backupTargetState.targetId, targetId))
    .limit(1);
  return rowToView(row);
}

export async function do_recordVerify(
  ctx: Ctx,
  args: RecordVerifyInput,
): Promise<BackupTargetStateView> {
  requireAdmin(ctx);
  const targetId = args.target_id?.trim();
  if (!targetId) throw badRequest("target_id is required");
  const at = nowSecs();
  await ctx.db
    .update(backupTargetState)
    .set({ lastVerifyAt: at, lastVerifyOk: args.ok ? 1 : 0 })
    .where(eq(backupTargetState.targetId, targetId));
  const [row] = await ctx.db
    .select()
    .from(backupTargetState)
    .where(eq(backupTargetState.targetId, targetId))
    .limit(1);
  if (!row) throw badRequest("unknown target_id");
  return rowToView(row);
}

// ---------------------------------------------------------------------------
// Snapshot / restore via BackupFormat
// ---------------------------------------------------------------------------

export async function do_getDbSnapshot(
  ctx: Ctx,
  format: BackupFormat,
): Promise<SnapshotResponse> {
  requireAdmin(ctx);
  const bytes = await format.encode();
  return { bytes_b64: bytesToBase64(bytes) };
}

export async function do_applyDbSnapshot(
  ctx: Ctx,
  format: BackupFormat,
  args: RestoreInput,
): Promise<void> {
  requireAdmin(ctx);
  if (typeof args.bytes_b64 !== "string" || args.bytes_b64.length === 0) {
    throw badRequest("bytes_b64 is required");
  }
  const bytes = base64ToBytes(args.bytes_b64);
  await format.decode(bytes);
  // After decode, the underlying client may be invalidated (Deno
  // binaryFormat closes the libsql connection; browser sqlocal
  // reinitialises but the schema may now lag the in-process Drizzle
  // metadata). Caller is expected to reload immediately. We don't
  // throw here so the response makes it back to the client cleanly;
  // a subsequent DB query in this same request would likely fail.
}

// Exported for tests that need to feed bytes through the JSON shape.
export const _testHelpers = { bytesToBase64, base64ToBytes };
