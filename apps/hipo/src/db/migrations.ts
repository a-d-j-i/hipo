// Monotonic migration list. Each entry is (version, sql).
// Mirrors the Rust pattern: never edit a migration that has shipped;
// add a new one with the next version number.
//
// Phase 5 will port the domain tables (parties, loans, loan_lenders,
// debtor_payments, debtor_payment_splits, lender_payouts, audit_log).
//
// Phase 7 adds backup_target_state (per-target backup/verify metadata
// surfaced through /api/system/status).
//
// Phase 9 adds vault tables (via vaultMigrations, version 100+).

import { vaultMigrations } from "@hipo/backup-vault-server/migrations";

export type Migration = {
  version: number;
  sql: string;
};

// hipo domain migrations (version 1–99).
const hipoMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        deleted_at INTEGER
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT
      );

      CREATE INDEX idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

      CREATE TABLE parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        external_ref TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_by INTEGER,
        deleted_at INTEGER
      );

      CREATE INDEX idx_parties_name ON parties(name);
      CREATE INDEX idx_parties_deleted_at ON parties(deleted_at);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        payload TEXT
      );

      CREATE INDEX idx_audit_log_at ON audit_log(at DESC);
      CREATE INDEX idx_audit_log_entity_type ON audit_log(entity_type);
      CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);

      CREATE TABLE loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT,
        debtor_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
        principal_cents INTEGER NOT NULL CHECK(principal_cents > 0),
        interest_cents INTEGER NOT NULL DEFAULT 0 CHECK(interest_cents >= 0),
        issued_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_by INTEGER,
        deleted_at INTEGER
      );

      CREATE INDEX idx_loans_debtor ON loans(debtor_id);
      CREATE INDEX idx_loans_status ON loans(status);
      CREATE INDEX idx_loans_deleted_at ON loans(deleted_at);

      CREATE TABLE loan_lenders (
        loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
        lender_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        amount_lent_cents INTEGER NOT NULL CHECK(amount_lent_cents > 0),
        PRIMARY KEY (loan_id, lender_id)
      );

      CREATE INDEX idx_loan_lenders_lender ON loan_lenders(lender_id);

      -- Parties that take a fixed cut of the loan's interest off the top.
      -- share_bps is in basis points (1..9999). Sum across all promoters
      -- on a loan must be <= 10000 (enforced in app code via
      -- checkPromoters).
      CREATE TABLE loan_promoters (
        loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
        party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        share_bps INTEGER NOT NULL CHECK(share_bps > 0 AND share_bps < 10000),
        PRIMARY KEY (loan_id, party_id)
      );

      CREATE INDEX idx_loan_promoters_party ON loan_promoters(party_id);

      CREATE TABLE debtor_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        principal_cents INTEGER NOT NULL CHECK(principal_cents >= 0),
        interest_cents INTEGER NOT NULL CHECK(interest_cents >= 0),
        paid_at INTEGER NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_by INTEGER,
        deleted_at INTEGER,
        CHECK (amount_cents = principal_cents + interest_cents)
      );

      CREATE INDEX idx_debtor_payments_loan ON debtor_payments(loan_id);
      CREATE INDEX idx_debtor_payments_paid_at ON debtor_payments(paid_at DESC);
      CREATE INDEX idx_debtor_payments_deleted ON debtor_payments(deleted_at);

      CREATE TABLE debtor_payment_splits (
        payment_id INTEGER NOT NULL REFERENCES debtor_payments(id) ON DELETE CASCADE,
        lender_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        kind TEXT NOT NULL CHECK(kind IN ('lender', 'promoter')),
        PRIMARY KEY (payment_id, lender_id)
      );

      CREATE INDEX idx_payment_splits_lender ON debtor_payment_splits(lender_id);

      CREATE TABLE lender_payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lender_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
        currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        paid_at INTEGER NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_by INTEGER,
        deleted_at INTEGER
      );

      CREATE INDEX idx_lender_payouts_lender ON lender_payouts(lender_id);
      CREATE INDEX idx_lender_payouts_paid_at ON lender_payouts(paid_at DESC);
      CREATE INDEX idx_lender_payouts_currency ON lender_payouts(currency_code);
      CREATE INDEX idx_lender_payouts_deleted ON lender_payouts(deleted_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE backup_target_state (
        target_id TEXT PRIMARY KEY,
        configured_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_backup_at INTEGER,
        last_backup_size_bytes INTEGER,
        last_backup_filename TEXT,
        last_verify_at INTEGER,
        last_verify_ok INTEGER
      );
    `,
  },
];

// Combined migration list: hipo domain migrations + vault migrations.
// Sorted by version so the runner applies them in order.
export const migrations: Migration[] = [
  ...hipoMigrations,
  ...vaultMigrations,
].sort((a, b) => a.version - b.version);
