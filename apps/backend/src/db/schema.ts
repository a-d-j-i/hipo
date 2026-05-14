import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  deletedAt: integer("deleted_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at")
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

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

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  payload: text("payload"),
});

// DB row types use the `Row` suffix to keep them distinct from the API
// shapes of the same name in @hipo/shared (User, Party, Loan, …).
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type AuditEntryRow = typeof auditLog.$inferSelect;
export type PartyRow = typeof parties.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type LoanLenderRow = typeof loanLenders.$inferSelect;
