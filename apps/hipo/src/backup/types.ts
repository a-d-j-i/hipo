// Wire types for /api/backup/*. Mirrored on the frontend via
// `apps/hipo/frontend/src/api/backup.ts`.
//
// Bytes payloads are base64 strings for Phase 7A — JSON-only wire
// keeps us on the existing worker bridge. The 33% size penalty is
// fine for hipo's ~5 MB DB; revisit with a binary wire format when a
// larger consumer needs it.

export type BackupTargetStateView = {
  target_id: string;
  configured_at: number;
  last_backup_at: number | null;
  last_backup_size_bytes: number | null;
  last_backup_filename: string | null;
  last_verify_at: number | null;
  last_verify_ok: boolean | null;
};

export type SnapshotResponse = { bytes_b64: string };

export type RestoreInput = { bytes_b64: string };

export type RecordBackupInput = {
  target_id: string;
  size_bytes: number;
  filename?: string | null;
};

export type RecordVerifyInput = {
  target_id: string;
  ok: boolean;
};

export type ConfigureTargetInput = {
  target_id: string;
};
