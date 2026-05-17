// Engine-agnostic types for the framework's SQLite substrate.
//
// `Db` is broad enough to cover both libsql (Deno/Node via
// drizzle-orm/libsql) and sqlite-proxy (browser via drizzle-orm/
// sqlite-proxy backed by sqlocal). Both adapters produce a
// BaseSQLiteDatabase under the hood, so query/transaction code at
// call sites is the same — only the constructor differs.

import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/**
 * Shared shape of write-statement results (UPDATE/INSERT/DELETE without
 * `.returning()`). Both libsql and sqlite-proxy expose `rowsAffected`;
 * `lastInsertRowid` is libsql-only. Apps that need the latter should
 * use `.returning()` instead so the column comes back typed.
 */
export type RunResult = { rowsAffected: number };

// 'async' = both client kinds support transactions via async callbacks.
// `Record<string, never>` for the schema generic — apps that want
// query-builder schema-mode would parameterise this further.
export type Db = BaseSQLiteDatabase<"async", RunResult, Record<string, never>>;

/**
 * A single migration. Apps + framework packages contribute these.
 *
 * `version` is a monotonic integer (compat with hipo's existing scheme).
 * The framework plan moves toward lex-IDs eventually; we keep numeric
 * while real installs exist on the old format.
 *
 * Multi-statement `sql` is split on `;` and applied one at a time so
 * libsql's node binding (which is single-statement) is happy.
 */
export type Migration = {
  version: number;
  sql: string;
};
