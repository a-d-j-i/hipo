// Engine-agnostic `/api/system/status` response shape.
//
// One round trip the UI can call to render "where is my data, how
// safe is it, what can lose it". Structured facts only — UI handles
// localisation. See docs/local-first-framework.md §Phase 7 for the
// rationale.
//
// Versioning policy:
//   - Additive fields don't bump `status_schema_version`. New
//     `risk_flags`, new `target.id` values, new `shape` strings
//     are additive; UIs must ignore unknown values gracefully.
//   - Structural changes (rename, type change, removal) bump.
//   - UIs should treat any unknown `risk_flags` key as a yellow
//     flag rather than "no problem" so future warnings aren't
//     silently dropped on older UIs.

export type SystemStatusShape =
  | "browser"
  | "tauri"
  | "pwa"
  | "server"
  | "server-replica";

export type SystemStatusStorageBackend =
  | "opfs"
  | "libsql-local"
  | "libsql-remote";

export type SystemStatusTarget = {
  /** Stable target id (e.g. "github", "local-download", "fs-access"). */
  id: string;
  /** Whether the user has wired this target up at least once. */
  configured: boolean;
  last_backup_at?: number;
  last_verify_at?: number;
  last_verify_ok?: boolean;
};

export type SystemStatusRiskFlags = {
  no_backup_configured?: boolean;
  no_recent_backup?: boolean;
  last_verify_failed?: boolean;
  near_storage_quota?: boolean;
  /** True on browser/PWA, false on Tauri/server. */
  cleared_by_browser_data_clear?: boolean;
  /** True if at least one configured target has a recent successful backup. */
  survives_device_loss_via_backup?: boolean;
};

export type SystemStatus = {
  status_schema_version: 1;
  framework_version: string;
  shape: SystemStatusShape;
  shape_details: {
    browser?: { name: string; version: string };
    tauri?: {
      os: "windows" | "linux" | "macos";
      app_data_dir: string;
    };
    pwa?: { installed: boolean };
    server?: { url: string };
  };
  storage: {
    backend: SystemStatusStorageBackend;
    estimated_usage_bytes?: number;
    estimated_quota_bytes?: number;
  };
  backups: {
    targets: SystemStatusTarget[];
    next_scheduled_at?: number;
  };
  risk_flags: SystemStatusRiskFlags;
};

export const STATUS_SCHEMA_VERSION = 1 as const;
