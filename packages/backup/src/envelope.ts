// Encrypted-backup envelope: durable wire format for sealed snapshots.
//
// Layout (binary, little-endian where multi-byte):
//
//   offset  size  field
//   ------  ----  ------------------------------------------------
//   0       4     magic "HIPB"
//   4       1     envelope_version (u8)
//   5       1     format-name length (u8)
//   6       N     format name (utf-8)
//   6+N     1     salt length (u8)
//   ...     S     salt bytes
//   ...     1     iv length (u8)
//   ...     I     iv bytes
//   ...     4     ct length (u32 LE)
//   ...     C     ciphertext (AES-GCM output, includes auth tag)
//
// Versioning policy (load-bearing — see docs/local-first-framework.md):
//
//   - `envelope_version` is the *structural* version of this envelope.
//     Decoders reject unknown values. Bumped only when the shape
//     itself changes (new required field, primitive swap).
//   - `format` is the encoding of the inner bytes ("binary-gzip" for
//     v1). New formats coexist by getting new names. Decoders dispatch
//     by `format`. Unknown format = clear "needs newer framework" error.
//   - Within a major framework version every published backup must
//     remain restorable. Never break a published backup.

export const ENVELOPE_VERSION = 1;

export type Envelope = {
  envelope_version: number;
  format: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ct: Uint8Array;
};

const MAGIC = new Uint8Array([0x48, 0x49, 0x50, 0x42]); // "HIPB"

function checkU8(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`envelope: ${what} out of u8 range (${value})`);
  }
}

export function packEnvelope(env: Envelope): Uint8Array {
  const formatBytes = new TextEncoder().encode(env.format);
  checkU8(env.envelope_version, "envelope_version");
  checkU8(formatBytes.length, "format length");
  checkU8(env.salt.length, "salt length");
  checkU8(env.iv.length, "iv length");

  const total =
    4 +
    1 +
    1 +
    formatBytes.length +
    1 +
    env.salt.length +
    1 +
    env.iv.length +
    4 +
    env.ct.length;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf.set(MAGIC, o);
  o += 4;
  buf[o++] = env.envelope_version;
  buf[o++] = formatBytes.length;
  buf.set(formatBytes, o);
  o += formatBytes.length;
  buf[o++] = env.salt.length;
  buf.set(env.salt, o);
  o += env.salt.length;
  buf[o++] = env.iv.length;
  buf.set(env.iv, o);
  o += env.iv.length;
  view.setUint32(o, env.ct.length, true);
  o += 4;
  buf.set(env.ct, o);
  return buf;
}

export function unpackEnvelope(bytes: Uint8Array): Envelope {
  const HEADER_MIN = 4 + 1 + 1 + 1 + 1 + 4;
  if (bytes.length < HEADER_MIN) {
    throw new Error("envelope: input too short");
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("envelope: bad magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const envelope_version = bytes[o++];
  const fl = bytes[o++];
  if (o + fl > bytes.length) throw new Error("envelope: truncated format");
  const format = new TextDecoder().decode(bytes.subarray(o, o + fl));
  o += fl;
  if (o + 1 > bytes.length) throw new Error("envelope: missing salt length");
  const sl = bytes[o++];
  if (o + sl > bytes.length) throw new Error("envelope: truncated salt");
  const salt = bytes.slice(o, o + sl);
  o += sl;
  if (o + 1 > bytes.length) throw new Error("envelope: missing iv length");
  const il = bytes[o++];
  if (o + il > bytes.length) throw new Error("envelope: truncated iv");
  const iv = bytes.slice(o, o + il);
  o += il;
  if (o + 4 > bytes.length) throw new Error("envelope: missing ct length");
  const cl = view.getUint32(o, true);
  o += 4;
  if (o + cl > bytes.length) throw new Error("envelope: truncated ciphertext");
  const ct = bytes.slice(o, o + cl);
  return { envelope_version, format, salt, iv, ct };
}
