// Migrations runner. Drizzle-level so it works for both client-deno
// (libsql) and client-browser (sqlocal + sqlite-proxy) without
// duplication.
//
// DDL goes through `sql.raw()`; migrations-table CRUD uses the typed
// Drizzle schema below. Multi-statement migrations are split on `;`
// and applied one at a time because some SQLite drivers (notably the
// libsql node binding) reject multi-statement strings.

import { sql, asc } from "drizzle-orm";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import type { Db, Migration } from "./types.ts";

/** The framework's own table — created if missing on every open. */
const migrationsTable = sqliteTable("migrations", {
  version: integer("version").primaryKey(),
  appliedAt: integer("applied_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Split a multi-statement SQL string into individual executable statements. */
export function splitStatements(input: string): string[] {
  return input
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(
  db: Db,
  migrations: Migration[],
): Promise<void> {
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  );

  const applied = await db
    .select({ version: migrationsTable.version })
    .from(migrationsTable)
    .orderBy(asc(migrationsTable.version));
  const seen = new Set(applied.map((r) => r.version));

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of sorted) {
    if (seen.has(m.version)) continue;
    for (const stmt of splitStatements(m.sql)) {
      await db.run(sql.raw(stmt));
    }
    await db.insert(migrationsTable).values({ version: m.version });
  }
}
