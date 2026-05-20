# @hipo/sqlite

Framework substrate: libsql/SQLite-WASM data layer + Drizzle types + migrations
runner.

## Public surface

```ts
import {
  runMigrations,
  splitStatements,
  type Db,
  type Migration,
} from "@hipo/sqlite";
```

Engine-specific factories (different runtime deps, different options) have their
own entry points and are imported directly:

```ts
// Deno/Node — libsql native binding
import { openDb } from "@hipo/sqlite/client-deno";

// Browser — sqlocal + SQLite-WASM (Phase 2 placeholder)
import { openDb } from "@hipo/sqlite/client-browser";
```

## Migrations

Apps and feature packages contribute `Migration[]` arrays; the app merges them
and passes the result to `openDb`. The runner:

- Creates the `migrations` table on first run.
- Loads already-applied versions.
- Applies any missing migration in ascending `version` order, one SQL statement
  at a time.
- Records each application in the `migrations` table inside the same flow.

```ts
import { type Migration } from "@hipo/sqlite";

export const migrations: Migration[] = [
  { version: 1, sql: `CREATE TABLE users (...)` },
  { version: 2, sql: `ALTER TABLE users ADD COLUMN ...` },
];
```

## What this package does not own

- **Schema/table definitions** — those live in feature packages (`@hipo/auth`
  ships users/sessions, `@hipo/audit` ships audit_log) or in app code
  (`apps/hipo/src/db/schema.ts` for domain tables).
- **`Ctx`** — that's `@hipo/server`'s concern; we only provide `Db`.
