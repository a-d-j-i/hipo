// Backup pipeline measurement module.
//
// Mirrors what packages/backup will do:
//   exportDb (read OPFS bytes) → gzip → Argon2id KDF → AES-GCM → "upload"
//   restore: decrypt → gunzip → write OPFS → bytes equal
//
// Each stage is independently timed so we can pinpoint where time goes.

import { argon2id } from "hash-wasm";

export type Stage =
  | "read-opfs"
  | "gzip"
  | "kdf"
  | "encrypt"
  | "decrypt"
  | "gunzip"
  | "verify";

export type StageTiming = { stage: Stage; ms: number; outBytes?: number };

export type BackupResult = {
  timings: StageTiming[];
  totalMs: number;
  rawBytes: number;
  compressedBytes: number;
  encryptedBytes: number;
  ratioGzip: number;
};

const DB_PATH = "spike-04.sqlite3";

export async function readDbBytes(): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DB_PATH);
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase,
    salt: salt as unknown as Uint8Array<ArrayBuffer>,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536, // 64 MiB; modest for a browser
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey(
    "raw",
    raw as Uint8Array<ArrayBuffer>,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(
  bytes: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    bytes as BufferSource,
  );
  return new Uint8Array(ct);
}

export async function decrypt(
  bytes: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    bytes as BufferSource,
  );
  return new Uint8Array(pt);
}

export async function runBackupPipeline(
  passphrase: string,
): Promise<BackupResult> {
  const timings: StageTiming[] = [];
  const t = (label: Stage) => {
    const start = performance.now();
    return (outBytes?: number) =>
      timings.push({
        stage: label,
        ms: +(performance.now() - start).toFixed(2),
        outBytes,
      });
  };

  const tStart = performance.now();

  // 1. Read OPFS bytes
  let mark = t("read-opfs");
  const raw = await readDbBytes();
  mark(raw.byteLength);

  // 2. gzip
  mark = t("gzip");
  const compressed = await gzipBytes(raw);
  mark(compressed.byteLength);

  // 3. Argon2id KDF
  const salt = crypto.getRandomValues(new Uint8Array(16));
  mark = t("kdf");
  const key = await deriveKey(passphrase, salt);
  mark();

  // 4. AES-GCM encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  mark = t("encrypt");
  const encrypted = await encrypt(compressed, key, iv);
  mark(encrypted.byteLength);

  // 5. Verify round-trip: decrypt → gunzip → length match
  mark = t("decrypt");
  const decrypted = await decrypt(encrypted, key, iv);
  mark(decrypted.byteLength);

  mark = t("gunzip");
  const decompressed = await gunzipBytes(decrypted);
  mark(decompressed.byteLength);

  mark = t("verify");
  if (decompressed.byteLength !== raw.byteLength) {
    throw new Error(
      `verify failed: ${decompressed.byteLength} != ${raw.byteLength}`,
    );
  }
  mark();

  const totalMs = +(performance.now() - tStart).toFixed(2);
  return {
    timings,
    totalMs,
    rawBytes: raw.byteLength,
    compressedBytes: compressed.byteLength,
    encryptedBytes: encrypted.byteLength,
    ratioGzip: +(compressed.byteLength / raw.byteLength).toFixed(3),
  };
}
