// putAndVerify coverage. Constructs a real envelope + a fake
// in-memory target with `get()`, exercises the byte-equal + decrypt
// success paths, then tampers with the round-trip to confirm the
// failure paths.

import { describe, expect, it } from "vitest";
import {
  deriveKey,
  encryptBlob,
  freshSalt,
  packEnvelope,
  putAndVerify,
  type BackupTarget,
} from "@hipo/backup";

async function makeEnvelope(): Promise<{
  bytes: Uint8Array;
  key: CryptoKey;
}> {
  const salt = freshSalt();
  const key = await deriveKey("correct horse battery staple", salt);
  const env = await encryptBlob({
    bytes: new TextEncoder().encode("hello world"),
    key,
    salt,
    format: "binary-gzip",
  });
  return { bytes: packEnvelope(env), key };
}

function makeMemoryTarget(): BackupTarget & { stored: Uint8Array | null } {
  let stored: Uint8Array | null = null;
  return {
    id: "memory",
    displayName: "in-memory target",
    async put(bytes) {
      stored = bytes.slice();
      return { at: Math.floor(Date.now() / 1000) };
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

function makeWriteOnlyTarget(): BackupTarget {
  return {
    id: "writeonly",
    displayName: "write-only",
    async put() {
      return { at: 1 };
    },
    // get omitted on purpose
  };
}

describe("putAndVerify", () => {
  it("round-trip matches → verified_ok=true", async () => {
    const { bytes, key } = await makeEnvelope();
    const target = makeMemoryTarget();
    const result = await putAndVerify({
      target,
      envelopeBytes: bytes,
      key,
    });
    expect(result.verified_ok).toBe(true);
    expect(typeof result.verified_at).toBe("number");
  });

  it("write-only target skips verify (no verified_ok)", async () => {
    const { bytes, key } = await makeEnvelope();
    const result = await putAndVerify({
      target: makeWriteOnlyTarget(),
      envelopeBytes: bytes,
      key,
    });
    expect(result.verified_at).toBeUndefined();
    expect(result.verified_ok).toBeUndefined();
  });

  it("target tampered with bytes → verified_ok=false", async () => {
    const { bytes, key } = await makeEnvelope();
    const target = makeMemoryTarget();
    // Wrap put so it stores a flipped byte. Cast since we're
    // augmenting the original at runtime only.
    const original = target.put;
    target.put = async (b) => {
      const meta = await original(b);
      // Flip a byte deep in the ciphertext region (past the header).
      if (target.stored && target.stored.length > 60) {
        target.stored[60] ^= 0x01;
      }
      return meta;
    };
    const result = await putAndVerify({
      target,
      envelopeBytes: bytes,
      key,
    });
    expect(result.verified_ok).toBe(false);
  });

  it("target returns null on get → verified_ok=false", async () => {
    const { bytes, key } = await makeEnvelope();
    const target: BackupTarget = {
      id: "broken",
      displayName: "broken",
      async put() {
        return { at: 1 };
      },
      async get() {
        return null;
      },
    };
    const result = await putAndVerify({
      target,
      envelopeBytes: bytes,
      key,
    });
    expect(result.verified_ok).toBe(false);
  });
});
