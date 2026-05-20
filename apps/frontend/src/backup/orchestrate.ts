// Composes the backup pipeline from the bytes returned by
// /api/backup/snapshot (already gzipped by the Worker's
// `gzipped(binaryFormat(...))`) → AES-GCM → packed envelope →
// `target.put` (+ verify when the target supports `get`).
//
// Pulled into a single function so the Settings "Back up now"
// button, future cadence timer, and the bootstrap initial-backup
// flow share one path.

import {
  encryptBlob,
  freshSalt,
  packEnvelope,
  putAndVerify,
  type BackupTarget,
} from "@hipo/backup";
import { getSnapshot, recordBackup, recordVerify } from "../api/backup";

export type RunBackupStage = "preparing" | "uploading" | "verifying";

export type RunBackupInput = {
  target: BackupTarget;
  /** Derive an AES-GCM key for the given salt (cached per session). */
  keyFor: (salt: Uint8Array) => Promise<CryptoKey>;
  onProgress?: (stage: RunBackupStage) => void;
};

export type RunBackupResult = {
  size_bytes: number;
  at: number;
  filename?: string;
  verified_at?: number;
  verified_ok?: boolean;
};

/**
 * Run a single backup attempt end-to-end and persist `backup_target_state`.
 * Throws on any failure; caller surfaces a toast. Verify failures don't
 * throw — they just record `verified_ok: false`, since the bytes did
 * reach the target.
 */
export async function runBackup(
  opts: RunBackupInput,
): Promise<RunBackupResult> {
  opts.onProgress?.("preparing");
  // /api/backup/snapshot is plumbed through the Worker's BackupFormat,
  // which is `gzipped(binaryFormat(...))` for every shape — so these
  // bytes are already gzipped SQLite. The envelope's `format` field
  // ("binary-gzip") matches what's actually inside; the symmetric
  // server-side `format.decode` will decompress on restore.
  const snapshotBytes = await getSnapshot();
  const salt = freshSalt();
  const key = await opts.keyFor(salt);
  const envelope = await encryptBlob({
    bytes: snapshotBytes,
    key,
    salt,
    format: "binary-gzip",
  });
  const envelopeBytes = packEnvelope(envelope);

  opts.onProgress?.("uploading");
  if (opts.target.get) opts.onProgress?.("verifying");
  const result = await putAndVerify({
    target: opts.target,
    envelopeBytes,
    key,
  });

  await recordBackup(opts.target.id, envelopeBytes.length, result.filename);
  if (typeof result.verified_ok === "boolean") {
    await recordVerify(opts.target.id, result.verified_ok);
  }

  return {
    size_bytes: envelopeBytes.length,
    at: result.at,
    filename: result.filename,
    verified_at: result.verified_at,
    verified_ok: result.verified_ok,
  };
}
