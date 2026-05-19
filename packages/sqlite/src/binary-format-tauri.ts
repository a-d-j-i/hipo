// SQLite binary format for the Tauri shape (Phase 12). The Rust
// shell owns the live SQLite file; encode/decode go through Tauri
// commands rather than reading the filesystem directly.
//
// Mirrors `binary-format-browser.ts` and `binary-format-deno.ts`:
// `encode()` returns a consistent SQLite snapshot as `Uint8Array`;
// `decode(bytes)` swaps the live DB contents in place. After
// `decode`, callers should reload the page so migrations re-apply
// against the restored schema.
//
// Designed to be imported by code running inside the in-page Worker
// — the bridge primitive forwards via postMessage to the main thread
// (which has `invoke()`). When called from the main thread directly,
// the bridge listener simply doesn't match its own postMessage; use
// the `client-tauri.ts` direct path on the main thread.
//
// `format.name` is `"binary"` so envelopes interoperate with the
// other shapes' binary backups — wrap with `gzipped(...)` from
// `@hipo/backup` to get `"binary-gzip"` envelopes.

import type { BackupFormat } from "@hipo/backup";
import { bridgeInvoke } from "./client-tauri-bridge.ts";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // chunk to avoid String.fromCharCode call-stack blow-up on large
  // arrays (apply has an arg-count ceiling around 64k on some engines).
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }
  return btoa(bin);
}

/**
 * Build a Tauri-shape `BackupFormat`. `encode()` calls
 * `sql_backup_to_bytes` (`VACUUM INTO` → read → base64); `decode()`
 * calls `sql_restore_from_bytes` (base64 → temp file → close → rename
 * → reopen). Both transit through the Worker → main → Rust bridge.
 */
export function binaryFormat(): BackupFormat {
  return {
    name: "binary",
    async encode(): Promise<Uint8Array> {
      const b64 = await bridgeInvoke<string>("sql_backup_to_bytes", {});
      return base64ToBytes(b64);
    },
    async decode(bytes: Uint8Array): Promise<void> {
      await bridgeInvoke<void>("sql_restore_from_bytes", {
        bytes: bytesToBase64(bytes),
      });
    },
  };
}
