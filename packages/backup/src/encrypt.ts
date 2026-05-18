// AES-256-GCM seal/open against the envelope. Caller supplies the
// already-derived key (+ the salt that produced it) and the bytes to
// seal; the envelope embeds the salt so a future decoder can re-derive
// the key from passphrase + envelope.salt.
//
// The `as BufferSource` casts work around TS 5.7+'s tightened
// `Uint8Array<ArrayBufferLike>` typing — `BufferSource` (ArrayBuffer or
// `ArrayBufferView<ArrayBuffer>`) no longer accepts Uint8Array generic
// over ArrayBufferLike. Our Uint8Arrays are always backed by
// ArrayBuffer in practice; the runtime contract is preserved.

import { ENVELOPE_VERSION, type Envelope } from "./envelope.ts";
import { freshIv } from "./key.ts";

export type EncryptBlobInput = {
  bytes: Uint8Array;
  key: CryptoKey;
  salt: Uint8Array;
  format: string;
};

export async function encryptBlob(opts: EncryptBlobInput): Promise<Envelope> {
  const iv = freshIv();
  const ctBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    opts.key,
    opts.bytes as BufferSource,
  );
  return {
    envelope_version: ENVELOPE_VERSION,
    format: opts.format,
    salt: opts.salt,
    iv,
    ct: new Uint8Array(ctBuffer),
  };
}

export async function decryptBlob(
  envelope: Envelope,
  key: CryptoKey,
): Promise<{ bytes: Uint8Array; format: string }> {
  if (envelope.envelope_version !== ENVELOPE_VERSION) {
    throw new Error(
      `unsupported envelope_version ${envelope.envelope_version}; ` +
        `this build understands ${ENVELOPE_VERSION}`,
    );
  }
  // WebCrypto throws an OperationError on auth-tag failure (wrong key,
  // tampered/truncated ct). Caller catches and surfaces a sane message.
  const ptBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: envelope.iv as BufferSource },
    key,
    envelope.ct as BufferSource,
  );
  return {
    bytes: new Uint8Array(ptBuffer),
    format: envelope.format,
  };
}
