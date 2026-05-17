// Thin hipo-specific wrapper around @hipo/sqlite. Provides the
// `openDb()` call hipo expects, with hipo's config + migrations baked
// in. All substrate logic lives in @hipo/sqlite.

import { sql } from "drizzle-orm";
import {
  splitStatements,
  type Db,
  type Migration,
} from "@hipo/sqlite";
import { openDb as openDbBase } from "@hipo/sqlite/client-deno";
import type { Client } from "@libsql/client";
import { config } from "../config.ts";
import { migrations } from "./migrations.ts";

export type { Db, Migration };

export async function openDb(): Promise<{ db: Db; client: Client }> {
  return await openDbBase({
    dataDir: config.dataDir,
    filename: "hipo.db",
    migrations,
  });
}

// Re-exports for existing call sites (server.ts, tests, etc.).
export { splitStatements, sql };
