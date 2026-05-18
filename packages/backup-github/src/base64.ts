// Binary ↔ base64 in chunks. Avoids `String.fromCharCode(...bytes)`'s
// per-call argument-count limit (~64k on V8) and JSON-payload
// allocation spikes on large blobs.

const CHUNK = 0x8000; // 32 KiB

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  // GitHub wraps base64 at 60 chars; strip whitespace before decoding.
  const clean = b64.replace(/\s/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
