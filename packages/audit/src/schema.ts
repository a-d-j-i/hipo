// audit_log table — owned by @hipo/audit.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  payload: text("payload"),
});

export type AuditEntryRow = typeof auditLog.$inferSelect;
