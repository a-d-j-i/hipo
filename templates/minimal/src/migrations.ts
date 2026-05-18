// Migrations for the minimal template.
//
// Version 1: users + sessions tables (@hipo/auth requirement).
// Version 2: audit_log table (@hipo/audit requirement — @hipo/auth's do_*
//   operations always call writeAudit(), so the table must exist even though
//   the template exposes no audit log UI or routes).
//
// No domain tables (parties, loans, etc.) — those are hipo-specific.

import type { Migration } from "@hipo/sqlite";

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        username       TEXT    NOT NULL UNIQUE,
        password_hash  TEXT    NOT NULL,
        role           TEXT    NOT NULL CHECK(role IN ('admin', 'user')),
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        deleted_at     INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT    PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at    INTEGER NOT NULL,
        ip            TEXT,
        user_agent    TEXT
      )
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          INTEGER NOT NULL,
        user_id     INTEGER NOT NULL,
        action      TEXT    NOT NULL,
        entity_type TEXT    NOT NULL,
        entity_id   INTEGER,
        payload     TEXT
      )
    `,
  },
];
