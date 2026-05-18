// gzip helpers via the native CompressionStream API. Available in
// Chromium, Firefox 113+, Safari 16.4+, WebKitGTK 2.42+, Deno 1.34+.
// No third-party dependency.
//
// The `as BufferSource` casts work around TS 5.7+'s tightened
// `Uint8Array<ArrayBufferLike>` typing — our Uint8Arrays are always
// backed by ArrayBuffer in practice. WebCrypto-style APIs that take
// `BufferSource` are happy with them at runtime.

async function streamThrough(
  bytes: Uint8Array,
  transform: GenericTransformStream,
): Promise<Uint8Array> {
  const input = new Blob([bytes as BufferSource]);
  const out = await new Response(
    input
      .stream()
      .pipeThrough(
        transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      ),
  ).arrayBuffer();
  return new Uint8Array(out);
}

export async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  return streamThrough(bytes, new CompressionStream("gzip"));
}

export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  return streamThrough(bytes, new DecompressionStream("gzip"));
}
