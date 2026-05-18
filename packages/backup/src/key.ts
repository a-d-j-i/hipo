// KDF: Argon2id passphrase → AES-256-GCM CryptoKey.
//
// Parameters match @hipo/auth's passwords.browser.ts (Phase 0 Spike #4:
// ~190 ms on commodity hardware, dominates backup cost at 56%). The
// architectural conclusion from that spike is: cache the derived key
// per session so re-backups skip this expense.
//
// `hash-wasm` works in both Deno and browsers, so this file is
// engine-agnostic and shared by both shapes.

import { argon2id } from "hash-wasm";

const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MiB
  hashLength: 32, // bytes — AES-256
} as const;

/** Cryptographically random 16-byte salt. */
export function freshSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Cryptographically random 12-byte AES-GCM nonce. */
export function freshIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/**
 * Derive an AES-256-GCM CryptoKey from a passphrase + salt. Caller is
 * expected to cache the returned key for the session so subsequent
 * backups skip the ~190 ms KDF cost.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase,
    salt,
    ...PARAMS,
    outputType: "binary",
  });
  return await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
