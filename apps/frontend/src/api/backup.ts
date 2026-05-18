// Frontend wrappers around /api/backup/*. Mirrors the backend types
// in `apps/backend/src/backup/types.ts`.
//
// `bytesToBase64` / `base64ToBytes` are exported as helpers so the
// Settings + bootstrap flows can keep `Uint8Array` until just before
// the HTTP boundary and just after the response.

import { httpRequest } from "./http";

export type BackupTargetStateView = {
  target_id: string;
  configured_at: number;
  last_backup_at: number | null;
  last_backup_size_bytes: number | null;
  last_verify_at: number | null;
  last_verify_ok: boolean | null;
};

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function listBackupTargets(): Promise<BackupTargetStateView[]> {
  return await httpRequest<BackupTargetStateView[]>(
    "GET",
    "/api/backup/targets",
  );
}

export async function configureTarget(
  targetId: string,
): Promise<BackupTargetStateView> {
  return await httpRequest<BackupTargetStateView>(
    "POST",
    "/api/backup/targets/configure",
    { target_id: targetId },
  );
}

export async function recordBackup(
  targetId: string,
  sizeBytes: number,
): Promise<BackupTargetStateView> {
  return await httpRequest<BackupTargetStateView>(
    "POST",
    "/api/backup/targets/record-backup",
    { target_id: targetId, size_bytes: sizeBytes },
  );
}

export async function recordVerify(
  targetId: string,
  ok: boolean,
): Promise<BackupTargetStateView> {
  return await httpRequest<BackupTargetStateView>(
    "POST",
    "/api/backup/targets/record-verify",
    { target_id: targetId, ok },
  );
}

/**
 * Pull the current DB snapshot as raw bytes. The Worker calls
 * `BackupFormat.encode()` server-side and ships base64 in JSON; we
 * decode on the way out.
 *
 * Substrate-supported runtimes only. Deno + browser shape both work;
 * cloud / shared-server shapes that omit the BackupFormat answer 501.
 */
export async function getSnapshot(): Promise<Uint8Array> {
  const res = await httpRequest<{ bytes_b64: string }>(
    "GET",
    "/api/backup/snapshot",
  );
  return base64ToBytes(res.bytes_b64);
}

/**
 * Apply a previously-decrypted snapshot back to the live DB. Caller
 * must reload the page immediately after — the server-side handle
 * may be invalidated and an in-flight Drizzle query would see stale
 * schema metadata.
 */
export async function applyRestore(bytes: Uint8Array): Promise<void> {
  await httpRequest<null>("POST", "/api/backup/restore", {
    bytes_b64: bytesToBase64(bytes),
  });
}
