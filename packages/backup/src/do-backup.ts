// High-level orchestration: format → (optionally) gzip → AES-GCM
// → Envelope, and the inverse for restore.
//
// The substrate handle (a SQLite client, an OPFS handle, …) is closed
// over by the BackupFormat factory in the substrate package, so these
// functions never touch the engine directly.

import { compress, decompress } from "./compress.ts";
import { decryptBlob, encryptBlob } from "./encrypt.ts";
import type { Envelope } from "./envelope.ts";
import type { BackupFormat } from "./format.ts";

/**
 * Compose a BackupFormat with gzip. The composed format's name is
 * `<inner>-gzip` — that's what ends up in the envelope and what
 * `importDb` checks against on restore.
 */
export function gzipped(inner: BackupFormat): BackupFormat {
  return {
    name: `${inner.name}-gzip`,
    encode: async () => compress(await inner.encode()),
    decode: async (bytes) => inner.decode(await decompress(bytes)),
  };
}

export type ExportDbInput = {
  format: BackupFormat;
  key: CryptoKey;
  salt: Uint8Array;
};

export async function exportDb(opts: ExportDbInput): Promise<Envelope> {
  const bytes = await opts.format.encode();
  return await encryptBlob({
    bytes,
    key: opts.key,
    salt: opts.salt,
    format: opts.format.name,
  });
}

export type ImportDbInput = {
  envelope: Envelope;
  format: BackupFormat;
  key: CryptoKey;
};

export async function importDb(opts: ImportDbInput): Promise<void> {
  const { bytes, format } = await decryptBlob(opts.envelope, opts.key);
  if (format !== opts.format.name) {
    throw new Error(
      `backup format mismatch: envelope is "${format}", ` +
        `decoder expects "${opts.format.name}"`,
    );
  }
  await opts.format.decode(bytes);
}
