// Orchestration helpers for the bootstrap page. Open OPFS-backed
// SQLocal directly in the main thread (no Worker, no router) so we
// can do the one-shot encode/decode the bootstrap flow needs, then
// destroy the handle and reload the page — at which point the
// normal in-page-backend boot path takes over.
//
// All operations here are gated to the main thread; they assume a
// cross-origin-isolated context (sqlocal's Vite plugin + the merged
// SW handle that for dev + prod respectively).

import { openDb } from "@hipo/sqlite/client-browser";
import { binaryFormat } from "@hipo/sqlite/binary-format-browser";
import {
  exportDb,
  freshSalt,
  gzipped,
  importDb,
  packEnvelope,
  unpackEnvelope,
  type Envelope,
} from "@hipo/backup";
import { migrations } from "@hipo/backend/migrations";

const DB_PATH = "hipo.sqlite3";

/**
 * Encode + encrypt + pack the current OPFS DB as a sealed envelope.
 * Opens SQLocal, runs migrations (creating the DB if absent), takes a
 * `VACUUM INTO`-equivalent snapshot, encrypts under `key`, then destroys
 * the handle. Returns the packed envelope bytes ready to feed a
 * `BackupTarget.put`.
 */
export async function makeInitialBackup(opts: {
  salt: Uint8Array;
  key: CryptoKey;
}): Promise<Uint8Array> {
  const { local, close } = await openDb({
    databasePath: DB_PATH,
    migrations,
  });
  try {
    const fmt = gzipped(binaryFormat({ local }));
    const env = await exportDb({ format: fmt, key: opts.key, salt: opts.salt });
    return packEnvelope(env);
  } finally {
    await close();
  }
}

/**
 * Unpack + decrypt + write a sealed envelope back into the OPFS DB.
 * Used by the restore flow. Throws on wrong passphrase or tampered
 * ciphertext (the AES-GCM auth tag fails closed). On success the
 * caller must reload — the worker reopens the new DB on next boot
 * and the migrations runner applies any newer schema entries.
 */
export async function applyRestoredBackup(opts: {
  envelopeBytes: Uint8Array;
  key: CryptoKey;
}): Promise<void> {
  const env: Envelope = unpackEnvelope(opts.envelopeBytes);
  const { local, close } = await openDb({
    databasePath: DB_PATH,
    migrations,
  });
  try {
    // Match whatever format the envelope advertises. We only ship
    // "binary-gzip" today — any other format means a newer framework
    // version produced this backup, and we should fail loudly.
    if (env.format !== "binary-gzip") {
      throw new Error(
        `unsupported backup format "${env.format}" — this app version ` +
          `only supports "binary-gzip". Update before restoring.`,
      );
    }
    const fmt = gzipped(binaryFormat({ local }));
    await importDb({ envelope: env, format: fmt, key: opts.key });
  } finally {
    await close();
  }
}

/** Random 16-byte salt for a one-shot bootstrap backup. */
export function makeSalt(): Uint8Array {
  return freshSalt();
}

/** Read raw bytes from a `<input type="file">` File handle. */
export async function readEnvelopeFromFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
