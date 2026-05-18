// `/api/system/status` operation. Returns DB-known facts + runtime
// shape detection. Browser-side augmentation (Tauri detection,
// PWA installed state, navigator.userAgent parsing) happens in the
// frontend's useSystemStatus hook on top of this payload.
//
// Phase 6: returns the schema with empty backup-target state. Phase 7
// fills in the `backups.targets` array once `backup_target_state`
// is wired up.

import {
  STATUS_SCHEMA_VERSION,
  type SystemStatus,
  type SystemStatusShape,
  type SystemStatusStorageBackend,
} from "@hipo/server";
import type { AppCtx } from "../middleware/session.ts";

const FRAMEWORK_VERSION = "0.0.0";

// Runtime detection: the in-page Worker has no `Deno` global; the
// Deno server does. PWA/Tauri detection happens in the main thread
// (the Worker can't see `window.__TAURI__` etc.), so a Worker-side
// response always reports "browser" and the frontend hook upgrades
// it as needed.
function detectShape(): SystemStatusShape {
  const hasDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
  return hasDeno ? "server" : "browser";
}

function detectStorageBackend(shape: SystemStatusShape): SystemStatusStorageBackend {
  return shape === "browser" ? "opfs" : "libsql-local";
}

async function readStorageEstimate(): Promise<{
  usage?: number;
  quota?: number;
}> {
  try {
    const navAny = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<StorageEstimate> } } }).navigator;
    const est = await navAny?.storage?.estimate?.();
    if (!est) return {};
    return { usage: est.usage, quota: est.quota };
  } catch {
    return {};
  }
}

export async function do_getSystemStatus(
  _ctx: AppCtx,
): Promise<SystemStatus> {
  const shape = detectShape();
  const backend = detectStorageBackend(shape);
  const { usage, quota } = await readStorageEstimate();

  const targets: SystemStatus["backups"]["targets"] = [];
  const noBackupConfigured = targets.every((t) => !t.configured);
  const hasRecentSuccessfulBackup = targets.some(
    (t) =>
      t.configured &&
      typeof t.last_backup_at === "number" &&
      Date.now() / 1000 - t.last_backup_at < 7 * 86400,
  );

  return {
    status_schema_version: STATUS_SCHEMA_VERSION,
    framework_version: FRAMEWORK_VERSION,
    shape,
    shape_details: {},
    storage: {
      backend,
      estimated_usage_bytes: usage,
      estimated_quota_bytes: quota,
    },
    backups: {
      targets,
    },
    risk_flags: {
      no_backup_configured: noBackupConfigured,
      cleared_by_browser_data_clear: shape === "browser" || shape === "pwa",
      survives_device_loss_via_backup: hasRecentSuccessfulBackup,
    },
  };
}
