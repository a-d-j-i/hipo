// Browser SQLite client factory. Wraps sqlocal (SQLite-WASM in a
// dedicated Worker + OPFS) and exposes the same `{ db }` shape as
// `client-deno.ts` so consumers can swap by import path.
//
// Per Phase 0 Spike #1 (2026-05-17): sqlocal 0.18 + drizzle-orm/sqlite-proxy
// is the chosen substrate. libsql-wasm was 4.4× the bundle and we
// don't need the Turso embedded-replica path.

import { drizzle } from "drizzle-orm/sqlite-proxy";
import { SQLocalDrizzle } from "sqlocal/drizzle";
import { runMigrations } from "./migrations-runner.ts";
import type { Db, Migration } from "./types.ts";

export type OpenDbBrowserOptions = {
  /** Filename for the SQLite DB inside OPFS. */
  databasePath: string;
  /** Migrations to apply on open. */
  migrations: Migration[];
};

/**
 * Open (or create) an OPFS-backed SQLite database. Returns a Drizzle
 * handle. The actual SQLite engine runs in a Worker that sqlocal
 * spawns; the returned `db` proxies through it.
 *
 * Requires the page to be cross-origin-isolated (COOP/COEP headers).
 * For dev, use `sqlocal/vite` plugin; for production GitHub Pages,
 * use packages/sw (the merged Service Worker injects them).
 */
export async function openDb(
  opts: OpenDbBrowserOptions,
): Promise<{ db: Db; close: () => Promise<void> }> {
  const local = new SQLocalDrizzle({ databasePath: opts.databasePath });
  // sqlocal's driver satisfies the same Drizzle interface libsql does
  // at the call-site level; the Db type widens to accommodate either.
  const db = drizzle(local.driver, { logger: false }) as unknown as Db;

  await runMigrations(db, opts.migrations);

  return {
    db,
    close: async () => {
      // sqlocal exposes destroy() to close the underlying worker.
      // Call via cast since the types may not expose it.
      const closer = (local as unknown as { destroy?: () => Promise<void> })
        .destroy;
      if (typeof closer === "function") await closer.call(local);
    },
  };
}
