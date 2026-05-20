// Post-upload verification helper. Wraps `target.put(envelope)` with an
// immediate `target.get()` + byte-equal compare + AES-GCM decrypt
// sanity check. Catches three classes of failure that plain `put`
// can't:
//
//   - Target lost / truncated bytes in transit (e.g. an HTTP retry
//     hit the wrong endpoint).
//   - Target returned a stale previous version on `get()` (provider
//     bug or cache).
//   - Local key/passphrase doesn't actually match the bytes we just
//     wrote (caught at decrypt time).
//
// Targets without `get()` (the universal `<a download>` write-only
// target) skip the verify legs and return `{ at }` only — callers
// translate "no verify info" into a yellow flag in the UI rather
// than a red one.

import { decryptBlob } from "./encrypt.ts";
import { unpackEnvelope } from "./envelope.ts";
import type { BackupTarget } from "./target.ts";

export type PutAndVerifyResult = {
  /** Unix seconds when `target.put` resolved. */
  at: number;
  /** Filename reported by the target, if it has a meaningful one. */
  filename?: string;
  /** Unix seconds when verify finished. Absent on write-only targets. */
  verified_at?: number;
  /** True if both byte-equal and decrypt succeeded. */
  verified_ok?: boolean;
};

export type PutAndVerifyInput = {
  target: BackupTarget;
  envelopeBytes: Uint8Array;
  /** Same CryptoKey used to encrypt; needed for the decrypt sanity check. */
  key: CryptoKey;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function putAndVerify(
  opts: PutAndVerifyInput,
): Promise<PutAndVerifyResult> {
  const { at, filename } = await opts.target.put(opts.envelopeBytes);
  if (!opts.target.get) {
    return { at, filename };
  }

  const verified_at = nowSec();
  try {
    const fetched = await opts.target.get();
    if (!fetched) return { at, filename, verified_at, verified_ok: false };
    if (!bytesEqual(fetched, opts.envelopeBytes)) {
      return { at, filename, verified_at, verified_ok: false };
    }
    // Decryptability proves the key + envelope are mutually consistent;
    // this is what guarantees future restores will work.
    const env = unpackEnvelope(fetched);
    await decryptBlob(env, opts.key);
    return { at, filename, verified_at, verified_ok: true };
  } catch {
    return { at, filename, verified_at, verified_ok: false };
  }
}
