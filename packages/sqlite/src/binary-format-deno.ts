// SQLite binary format for the Deno/libsql shape. `VACUUM INTO` is
// SQLite's idiomatic consistent-snapshot primitive: it produces a clean
// SQLite file at the named path, locking only briefly.
//
// Encode reads those bytes; decode writes them back over the on-disk
// DB file. Decode closes the supplied client first to release any
// filesystem locks — the caller MUST reopen afterwards and re-run
// migrations (forward-schema-version restores depend on it).
//
// The browser/sqlocal variant ships separately when Phase 5+ needs it.

import type { Client } from "@libsql/client/node";
import type { BackupFormat } from "@hipo/backup";

export type BinaryFormatOptions = {
  /** Live libsql client for the database being backed up. */
  client: Client;
  /** Filesystem path to the SQLite file backing `client`. */
  dbPath: string;
};

/**
 * Build a `BackupFormat` whose `encode()` does `VACUUM INTO` and
 * `decode(bytes)` overwrites the on-disk file (after closing the
 * client). After decode, the supplied client is no longer usable.
 */
export function binaryFormat(opts: BinaryFormatOptions): BackupFormat {
  return {
    name: "binary",
    async encode(): Promise<Uint8Array> {
      const tmp = await Deno.makeTempFile({ suffix: ".sqlite-backup" });
      // VACUUM INTO takes a single-quoted SQL literal for the path;
      // SQLite doesn't expose it as a bound parameter. Disallow quotes
      // outright rather than escape — Deno temp paths never contain them.
      if (tmp.includes("'")) {
        await Deno.remove(tmp).catch(() => {});
        throw new Error(
          "binaryFormat: refusing to VACUUM INTO a path containing '",
        );
      }
      try {
        await opts.client.execute(`VACUUM INTO '${tmp}'`);
        return await Deno.readFile(tmp);
      } finally {
        await Deno.remove(tmp).catch(() => {});
      }
    },
    async decode(bytes: Uint8Array): Promise<void> {
      // Close the live client first so file locks (WAL, SHM) are
      // released before we overwrite the file. Caller reopens.
      try {
        opts.client.close();
      } catch {
        /* already closed */
      }
      // WAL/SHM sidecars may be stale after the overwrite; remove them
      // so the next open reads only the new main file. SQLite recreates
      // these as needed.
      for (const suffix of ["-wal", "-shm"]) {
        await Deno.remove(opts.dbPath + suffix).catch(() => {});
      }
      await Deno.writeFile(opts.dbPath, bytes);
    },
  };
}
