// Auth tables: users + sessions. Owned by @hipo/auth; consumed via
// either `import { users, sessions } from "@hipo/auth/schema"` or
// re-exported by the app's combined schema barrel.

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

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
