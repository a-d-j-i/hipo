import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Item = typeof items.$inferSelect;
