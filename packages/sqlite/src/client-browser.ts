// Browser SQLite client factory — Phase 2 placeholder.
//
// Will use sqlocal (SQLite-WASM in a dedicated Worker + OPFS) per
// Phase 0 Spike #1's decision. The signature should match `client-deno`
// so consumers can swap via Vite conditional import.

import type { Db, Migration } from "./types.ts";

export type OpenDbOptions = {
  /** OPFS path for the database file. */
  databasePath: string;
  /** Migrations to apply on open. */
  migrations: Migration[];
};

export function openDb(_opts: OpenDbOptions): Promise<{ db: Db }> {
  throw new Error(
    "openDb (browser) is a Phase 2 placeholder — not implemented yet.",
  );
}
