// hipo's combined schema barrel. Framework tables come from the
// dedicated packages; domain tables (parties / loans / payments /
// payouts) live here. Domain tables move to apps/hipo in Phase 1D.

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Framework tables (re-exported for back-compat with existing imports).
export {
  users,
  sessions,
  type UserRow,
  type NewUser,
  type Session,
} from "@hipo/auth/schema";
export { auditLog, type AuditEntryRow } from "@hipo/audit/schema";

// Domain tables (hipo-specific).

export const parties = sqliteTable("parties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  externalRef: text("external_ref"),
  notes: text("notes"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  createdBy: integer("created_by"),
  deletedAt: integer("deleted_at"),
});

export const loans = sqliteTable("loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference"),
  debtorId: integer("debtor_id").notNull(),
  currencyCode: text("currency_code").notNull(),
  principalCents: integer("principal_cents").notNull(),
  interestCents: integer("interest_cents").notNull().default(0),
  issuedAt: integer("issued_at").notNull(),
  status: text("status", { enum: ["active", "closed"] })
    .notNull()
    .default("active"),
  notes: text("notes"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  createdBy: integer("created_by"),
  deletedAt: integer("deleted_at"),
});

export const loanLenders = sqliteTable("loan_lenders", {
  loanId: integer("loan_id").notNull(),
  lenderId: integer("lender_id").notNull(),
  amountLentCents: integer("amount_lent_cents").notNull(),
});

export const debtorPayments = sqliteTable("debtor_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loanId: integer("loan_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidAt: integer("paid_at").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  createdBy: integer("created_by"),
  deletedAt: integer("deleted_at"),
});

export const debtorPaymentSplits = sqliteTable("debtor_payment_splits", {
  paymentId: integer("payment_id").notNull(),
  lenderId: integer("lender_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
});

export const lenderPayouts = sqliteTable("lender_payouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lenderId: integer("lender_id").notNull(),
  currencyCode: text("currency_code").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidAt: integer("paid_at").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  createdBy: integer("created_by"),
  deletedAt: integer("deleted_at"),
});

// Per-backup-target metadata. One row per `BackupTarget.id` ever
// configured on this device. Updated by `do_recordBackup` /
// `do_recordVerify` after each `put` (and optional verify).
export const backupTargetState = sqliteTable("backup_target_state", {
  targetId: text("target_id").primaryKey(),
  configuredAt: integer("configured_at")
    .notNull()
    .default(sql`(unixepoch())`),
  lastBackupAt: integer("last_backup_at"),
  lastBackupSizeBytes: integer("last_backup_size_bytes"),
  lastVerifyAt: integer("last_verify_at"),
  // 0/1 nullable — `null` = never verified, 1 = ok, 0 = failed.
  lastVerifyOk: integer("last_verify_ok"),
});

// Domain row types
export type PartyRow = typeof parties.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type LoanLenderRow = typeof loanLenders.$inferSelect;
export type BackupTargetStateRow = typeof backupTargetState.$inferSelect;
