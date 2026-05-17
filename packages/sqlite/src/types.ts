// Engine-agnostic types for the framework's SQLite substrate.
//
// `Db` is the Drizzle handle each platform-specific client returns.
// Today both libsql (Deno/Node) and the future browser variant produce
// the same shape via Drizzle's libsql adapter; if browser uses
// sqlite-proxy we'll widen this with a union.

import type { drizzle } from "drizzle-orm/libsql";

export type Db = ReturnType<typeof drizzle>;

/**
 * A single migration. Apps + framework packages contribute these.
 *
 * `version` is a monotonic integer for compatibility with the original
 * hipo scheme. The framework plan moves toward lex-IDs
 * (`YYYYMMDDHHMMSS_<pkg>_<slug>`) but we keep numeric here while we
 * have existing data; the runner just sorts by `version` ascending.
 *
 * Multi-statement `sql` is split on `;` and applied one statement at
 * a time so libsql's node binding can handle each.
 */
export type Migration = {
  version: number;
  sql: string;
};
