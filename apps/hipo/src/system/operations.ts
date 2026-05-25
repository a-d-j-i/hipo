// `/api/system/status` operation. Returns DB-known facts + runtime
// shape detection. Browser-side augmentation (Tauri detection,
// PWA installed state, navigator.userAgent parsing) happens in the
// frontend's `api/system.ts` wrapper on top of this payload.

import { asc } from "drizzle-orm";
import {
  STATUS_SCHEMA_VERSION,
  type SystemStatus,
  type SystemStatusShape,
  type SystemStatusStorageBackend,
  type SystemStatusTarget,
} from "@hipo/server";
import type { Ctx } from "@hipo/auth";
import { backupTargetState } from "../db/schema.ts";
import { APP_VERSION } from "../version.ts";

// A target counts as "stale" if its last successful backup is older
// than this. Matches plan §Phase 7's nudge threshold.
const RECENT_BACKUP_WINDOW_SECS = 7 * 86400;

// Runtime detection: the in-page Worker has no `Deno` global; the
// Deno server does. PWA/Tauri detection happens in the main thread
// (the Worker can't see `window.__TAURI__` etc.), so a Worker-side
// response always reports "browser" and the frontend hook upgrades
// it as needed.
function detectShape(): SystemStatusShape {
  const hasDeno =
    typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
  return hasDeno ? "server" : "browser";
}

function detectStorageBackend(
  shape: SystemStatusShape,
): SystemStatusStorageBackend {
  return shape === "browser" ? "opfs" : "libsql-local";
}

async function readStorageEstimate(): Promise<{
  usage?: number;
  quota?: number;
}> {
  try {
    const navAny = (
      globalThis as {
        navigator?: { storage?: { estimate?: () => Promise<StorageEstimate> } };
      }
    ).navigator;
    const est = await navAny?.storage?.estimate?.();
    if (!est) return {};
    return { usage: est.usage, quota: est.quota };
  } catch {
    return {};
  }
}

export async function do_getSystemStatus(ctx: Ctx): Promise<SystemStatus> {
  const shape = detectShape();
  const backend = detectStorageBackend(shape);
  const { usage, quota } = await readStorageEstimate();

  const stateRows = await ctx.db
    .select()
    .from(backupTargetState)
    .orderBy(asc(backupTargetState.targetId));

  const targets: SystemStatusTarget[] = stateRows.map((r) => ({
    id: r.targetId,
    // Presence in the table = the user (or an auto-backup) wrote to
    // this target at least once. Either is "configured" in the user-
    // facing sense.
    configured: true,
    last_backup_at: r.lastBackupAt ?? undefined,
    last_backup_filename: r.lastBackupFilename ?? undefined,
    last_verify_at: r.lastVerifyAt ?? undefined,
    last_verify_ok: r.lastVerifyOk === null ? undefined : r.lastVerifyOk === 1,
  }));

  const nowSec = Math.floor(Date.now() / 1000);
  const anyConfigured = targets.length > 0;
  const hasRecentBackup = targets.some(
    (t) =>
      typeof t.last_backup_at === "number" &&
      nowSec - t.last_backup_at < RECENT_BACKUP_WINDOW_SECS,
  );
  const anyVerifyFailed = targets.some((t) => t.last_verify_ok === false);
  const hasRecentVerifiedBackup = targets.some(
    (t) =>
      typeof t.last_backup_at === "number" &&
      nowSec - t.last_backup_at < RECENT_BACKUP_WINDOW_SECS &&
      // Either verified ok, or a write-only target that we trust the
      // user has the bytes for (verify_ok undefined ≠ false).
      t.last_verify_ok !== false,
  );
  const nearQuota =
    typeof usage === "number" &&
    typeof quota === "number" &&
    quota > 0 &&
    usage / quota > 0.9;

  return {
    status_schema_version: STATUS_SCHEMA_VERSION,
    framework_version: APP_VERSION,
    shape,
    shape_details: {},
    storage: {
      backend,
      estimated_usage_bytes: usage,
      estimated_quota_bytes: quota,
    },
    backups: { targets },
    risk_flags: {
      no_backup_configured: !anyConfigured,
      no_recent_backup: anyConfigured && !hasRecentBackup,
      last_verify_failed: anyVerifyFailed,
      near_storage_quota: nearQuota,
      cleared_by_browser_data_clear: shape === "browser" || shape === "pwa",
      survives_device_loss_via_backup: hasRecentVerifiedBackup,
    },
  };
}
