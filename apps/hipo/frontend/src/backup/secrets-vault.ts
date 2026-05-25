// Tiny passphrase-encrypted secrets store for things the framework
// needs to persist across reloads (GitHub PAT, Dropbox refresh
// token, etc.) but should NOT live in plaintext on disk.
//
// Storage layout:
//
//   localStorage["hipo.vault.salt"]    base64(16 bytes) — stable per device
//   localStorage["hipo.vault.<key>"]   base64(packed AES-GCM envelope)
//
// Vault key derivation:
//
//   vaultKey = Argon2id(passphrase, vault-salt)
//
// The vault-salt is *not* secret — it's stored alongside the
// ciphertexts. The passphrase is what gates access; with no
// passphrase the vault is inert.
//
// Re-uses @hipo/backup's `encryptBlob` / `decryptBlob` so the
// envelope shape, IV handling, and AES-GCM parameters match every
// other encrypted artifact in the framework. Wrong passphrase fails
// closed at the auth-tag.

import {
  decryptBlob,
  encryptBlob,
  packEnvelope,
  unpackEnvelope,
} from "@hipo/backup";

const SALT_KEY = "hipo.vault.salt";
const SECRET_PREFIX = "hipo.vault.";
const VAULT_FORMAT = "vault-secret-v1";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Read (or create on first call) the stable vault salt. Once written
 * it never changes for the lifetime of this install — that's what
 * lets a single passphrase decrypt every secret in this device's
 * vault across sessions.
 */
export function getOrCreateVaultSalt(): Uint8Array {
  const stored = localStorage.getItem(SALT_KEY);
  if (stored) {
    const bytes = base64ToBytes(stored);
    if (bytes.length === 16) return bytes;
    // Garbage in storage — overwrite. (Pre-existing secrets are
    // now unrecoverable. Should never happen unless the user
    // manually edited storage.)
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SALT_KEY, bytesToBase64(salt));
  return salt;
}

export type SecretKey = "github.pat" | "vault.pat";

function storageKey(name: SecretKey): string {
  return `${SECRET_PREFIX}${name}`;
}

/**
 * Encrypt + persist a UTF-8 string secret under `name`. Caller
 * provides the AES-GCM CryptoKey already derived against the vault
 * salt (typically via `usePassphrase().keyFor(getOrCreateVaultSalt())`).
 */
export async function setSecret(
  name: SecretKey,
  value: string,
  key: CryptoKey,
): Promise<void> {
  const salt = getOrCreateVaultSalt();
  const env = await encryptBlob({
    bytes: new TextEncoder().encode(value),
    key,
    salt,
    format: VAULT_FORMAT,
  });
  localStorage.setItem(storageKey(name), bytesToBase64(packEnvelope(env)));
}

/**
 * Read + decrypt a secret previously written with `setSecret`. Returns
 * `null` if the secret is missing. Throws on wrong-passphrase / tampered
 * ciphertext (AES-GCM auth-tag failure).
 */
export async function getSecret(
  name: SecretKey,
  key: CryptoKey,
): Promise<string | null> {
  const stored = localStorage.getItem(storageKey(name));
  if (!stored) return null;
  const env = unpackEnvelope(base64ToBytes(stored));
  if (env.format !== VAULT_FORMAT) {
    throw new Error(
      `secrets-vault: unexpected format "${env.format}" — refusing to decode`,
    );
  }
  const { bytes } = await decryptBlob(env, key);
  return new TextDecoder().decode(bytes);
}

export function clearSecret(name: SecretKey): void {
  localStorage.removeItem(storageKey(name));
}

/** True if a secret with this name is currently stored (not whether it decrypts). */
export function hasSecret(name: SecretKey): boolean {
  return localStorage.getItem(storageKey(name)) !== null;
}
