// Deno/Node SQLite client factory. Uses libsql's native node binding.
// Browser variant lives in client-browser.ts.

import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { runMigrations } from "./migrations-runner.ts";
import type { Db, Migration } from "./types.ts";

export type OpenDbOptions = {
  /** Filesystem directory holding the SQLite file. Created if missing. */
  dataDir: string;
  /** SQLite filename inside `dataDir`. */
  filename: string;
  /** Migrations to apply on open. */
  migrations: Migration[];
};

async function ensureDataDir(dir: string): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  }
}

export async function openDb(
  opts: OpenDbOptions,
): Promise<{ db: Db; client: Client; dbPath: string }> {
  await ensureDataDir(opts.dataDir);
  const dbPath = `${opts.dataDir}/${opts.filename}`;
  const url = `file:${dbPath}`;
  const client = createClient({ url });

  // SQLite-side hardening — WAL for concurrent readers + foreign keys on.
  // Pragmas can't go through Drizzle (no DDL/PRAGMA in the typed API)
  // so we run them on the raw client before constructing the wrapper.
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  const db = drizzle(client);
  await runMigrations(db, opts.migrations);

  return { db, client, dbPath };
}
