import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { config } from "../config.ts";
import { migrations } from "./migrations.ts";

export type Db = ReturnType<typeof drizzle>;

async function ensureDataDir(): Promise<void> {
  try {
    await Deno.mkdir(config.dataDir, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  }
}

/** Split a multi-statement SQL string into individual executable statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runMigrations(client: Client): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  );
  const applied = await client.execute("SELECT version FROM migrations");
  const seen = new Set(applied.rows.map((r) => Number(r.version)));

  for (const m of migrations) {
    if (seen.has(m.version)) continue;
    for (const stmt of splitStatements(m.sql)) {
      await client.execute(stmt);
    }
    await client.execute({
      sql: "INSERT INTO migrations (version) VALUES (?)",
      args: [m.version],
    });
  }
}

export { splitStatements };

export async function openDb(): Promise<{ db: Db; client: Client }> {
  await ensureDataDir();
  const url = `file:${config.dataDir}/hipo.db`;
  const client = createClient({ url });

  // SQLite-side hardening
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  await runMigrations(client);

  const db = drizzle(client);
  return { db, client };
}

export { sql };
