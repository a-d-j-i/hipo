// Vault migrations. Starts at version 100 to leave room for hipo's
// domain migrations to keep claiming low numbers (hipo currently uses 1
// and 2). Vault is a framework-level optional feature; spacing it out
// from domain migrations makes the ordering unambiguous even if future
// domain migrations are added below this threshold.

import type { Migration } from "@hipo/sqlite";

export const vaultMigrations: Migration[] = [
  {
    version: 100,
    sql: `
      CREATE TABLE vault_pats (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        label TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE INDEX idx_vault_pats_user ON vault_pats(user_id);

      CREATE TABLE vault_blobs (
        user_id INTEGER NOT NULL REFERENCES users(id),
        blob_id TEXT NOT NULL,
        bytes BLOB NOT NULL,
        size_bytes INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, blob_id)
      );
    `,
  },
];
