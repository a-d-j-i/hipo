// Migrations runner. Engine-specific clients call this with their
// libsql Client and a sorted list of migrations to apply.

import type { Client } from "@libsql/client";
import type { Migration } from "./types.ts";

/** Split a multi-statement SQL string into individual executable statements. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(
  client: Client,
  migrations: Migration[],
): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  );
  const applied = await client.execute("SELECT version FROM migrations");
  const seen = new Set(
    applied.rows.map((r: Record<string, unknown>) => Number(r.version)),
  );

  // Apply in version order regardless of input ordering.
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const m of sorted) {
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
