// Vault tables: vault_pats (PAT credentials) + vault_blobs (stored blobs).
// Owned by @hipo/backup-vault-server; referenced by vault operations + routes.

import {
  integer,
  sqliteTable,
  text,
  customType,
} from "drizzle-orm/sqlite-core";
import { users } from "@hipo/auth/schema";

// Custom blob type that works in both Deno and browser runtimes.
// Stored as BLOB in SQLite; read back as Uint8Array by normalising
// whatever the driver returns (Buffer / ArrayBuffer / Uint8Array).
const blobAsUint8Array = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
}>({
  dataType() {
    return "BLOB";
  },
  fromDriver(val) {
    if (val instanceof Uint8Array) return val;
    // Buffer (Node/Deno compat) or ArrayBuffer fallback.
    const ab = val as unknown as ArrayBuffer;
    return new Uint8Array(ab);
  },
});

export const vaultPats = sqliteTable("vault_pats", {
  // SHA-256 hex of the cleartext token. Primary key — no plaintext stored.
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  label: text("label"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});

export const vaultBlobs = sqliteTable("vault_blobs", {
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  blobId: text("blob_id").notNull(),
  bytes: blobAsUint8Array("bytes").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type VaultPatRow = typeof vaultPats.$inferSelect;
export type VaultBlobRow = typeof vaultBlobs.$inferSelect;
