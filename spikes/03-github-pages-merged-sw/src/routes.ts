import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql, desc, eq } from "drizzle-orm";
import { SQLocalDrizzle } from "sqlocal/drizzle";
import { Router, json } from "./router.ts";
import { items } from "./schema.ts";

const dbInstance = new SQLocalDrizzle({ databasePath: "spike-03.sqlite3" });
const db = drizzle(dbInstance.driver, { logger: false });

// One-time schema setup. Real framework would have a migrations runner.
let migrated = false;
async function ensureMigrated() {
  if (migrated) return;
  await db.run(sql`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  migrated = true;
}

export const app = new Router()
  .get("/api/health", () => json({ ok: true, ts: Date.now(), worker: true }))
  .get("/api/items", async () => {
    await ensureMigrated();
    const rows = await db.select().from(items).orderBy(desc(items.id));
    return json({ items: rows });
  })
  .get("/api/items/:id", async ({ params }) => {
    await ensureMigrated();
    const id = Number(params.id);
    const [row] = await db.select().from(items).where(eq(items.id, id));
    if (!row) return json({ error: "not found" }, { status: 404 });
    return json(row);
  })
  .post("/api/items", async ({ req }) => {
    await ensureMigrated();
    const body = (await req.json()) as { text?: string };
    if (!body.text || typeof body.text !== "string") {
      return json({ error: "text required" }, { status: 400 });
    }
    const [inserted] = await db
      .insert(items)
      .values({ text: body.text, createdAt: Date.now() })
      .returning();
    return json(inserted, { status: 201 });
  })
  .delete("/api/items", async () => {
    await ensureMigrated();
    await db.delete(items);
    return json({ ok: true });
  });
