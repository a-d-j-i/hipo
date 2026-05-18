// SQLite binary format for the sqlocal/OPFS shape. Mirrors
// `binary-format-deno.ts`: `encode()` returns a consistent snapshot of
// the database as a `Uint8Array`; `decode(bytes)` swaps the live DB
// contents in place.
//
// `getDatabaseFile()` returns a `File` whose bytes are the SQLite file
// as it exists on disk in OPFS — sqlocal handles the consistency
// (drains WAL, takes a snapshot). `overwriteDatabaseFile(...)` replaces
// the on-disk file atomically and reinitialises the worker against the
// new contents.
//
// After `decode`, the live `SQLocal` connection is still usable, but
// the schema may now lag the app's migration set (forward-version
// restore). Callers typically reload the page after restore — the
// migrations runner applies forward migrations on next open.
//
// The `name` is `"binary"` so envelopes interoperate with the Deno
// variant: the format identifier is engine-agnostic, only the codec
// implementation differs.
//
// `format.name` is `"binary"`; wrap with `gzipped(...)` from
// `@hipo/backup` to get `"binary-gzip"` envelopes.

import type { SQLocal } from "sqlocal";
import type { BackupFormat } from "@hipo/backup";

export type BinaryFormatBrowserOptions = {
  /**
   * Live SQLocal client for the database being backed up. Both
   * SQLocal and SQLocalDrizzle satisfy this — only the file-IO surface
   * is used.
   */
  local: SQLocal;
};

/**
 * Build a browser-shape `BackupFormat`. `encode()` reads the OPFS
 * SQLite file via `getDatabaseFile`; `decode(bytes)` writes it back
 * via `overwriteDatabaseFile`.
 */
export function binaryFormat(opts: BinaryFormatBrowserOptions): BackupFormat {
  return {
    name: "binary",
    async encode(): Promise<Uint8Array> {
      const file = await opts.local.getDatabaseFile();
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    },
    async decode(bytes: Uint8Array): Promise<void> {
      // overwriteDatabaseFile accepts Uint8Array directly. The sqlocal
      // worker drains the lock, replaces the file, and reinitialises.
      // Caller is expected to reload to re-run migrations.
      await opts.local.overwriteDatabaseFile(
        bytes as Uint8Array<ArrayBuffer>,
      );
    },
  };
}