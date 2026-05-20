// runBackup orchestration: mocks /api/backup wrappers and a
// BackupTarget, then asserts the pipeline (snapshot → gzip → encrypt
// → put + verify → record) goes through in order and records the
// right state in backup_target_state.

import { describe, expect, it, vi } from "vitest";

vi.mock("../api/backup", () => {
  // Snapshot returns a fixed DB-byte fixture so the rest is deterministic.
  return {
    getSnapshot: vi.fn(async () =>
      new TextEncoder().encode("fake-sqlite-bytes-".repeat(50)),
    ),
    recordBackup: vi.fn(async (id: string, n: number) => ({
      target_id: id,
      configured_at: 1,
      last_backup_at: Math.floor(Date.now() / 1000),
      last_backup_size_bytes: n,
      last_verify_at: null,
      last_verify_ok: null,
    })),
    recordVerify: vi.fn(async (id: string, ok: boolean) => ({
      target_id: id,
      configured_at: 1,
      last_backup_at: 1,
      last_backup_size_bytes: 1,
      last_verify_at: Math.floor(Date.now() / 1000),
      last_verify_ok: ok,
    })),
  };
});

import { deriveKey, freshSalt, type BackupTarget } from "@hipo/backup";
import { runBackup } from "./orchestrate";
import * as backupApi from "../api/backup";

function memoryTarget(): BackupTarget & { stored: Uint8Array | null } {
  let stored: Uint8Array | null = null;
  return {
    id: "test-memory",
    displayName: "test memory",
    async put(b) {
      stored = b.slice();
      return { at: 1234 };
    },
    async get() {
      return stored ? stored.slice() : null;
    },
    get stored() {
      return stored;
    },
    set stored(v: Uint8Array | null) {
      stored = v;
    },
  };
}

describe("runBackup", () => {
  it("walks the full pipeline and records state", async () => {
    const target = memoryTarget();
    const progress: string[] = [];
    const result = await runBackup({
      target,
      keyFor: async (salt) => deriveKey("passphrase", salt),
      onProgress: (s) => progress.push(s),
    });
    expect(progress).toContain("preparing");
    expect(progress).toContain("uploading");
    expect(progress).toContain("verifying");
    expect(result.verified_ok).toBe(true);
    expect(vi.mocked(backupApi.getSnapshot)).toHaveBeenCalledOnce();
    expect(vi.mocked(backupApi.recordBackup)).toHaveBeenCalledWith(
      "test-memory",
      result.size_bytes,
    );
    expect(vi.mocked(backupApi.recordVerify)).toHaveBeenCalledWith(
      "test-memory",
      true,
    );
  });

  it("write-only target skips recordVerify but still recordBackups", async () => {
    vi.mocked(backupApi.recordVerify).mockClear();
    const writeOnly: BackupTarget = {
      id: "writeonly",
      displayName: "write only",
      async put() {
        return { at: 1 };
      },
    };
    const result = await runBackup({
      target: writeOnly,
      keyFor: async () => deriveKey("passphrase", freshSalt()),
    });
    expect(result.verified_ok).toBeUndefined();
    expect(vi.mocked(backupApi.recordBackup)).toHaveBeenCalledWith(
      "writeonly",
      result.size_bytes,
    );
    expect(vi.mocked(backupApi.recordVerify)).not.toHaveBeenCalled();
  });
});
