import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql, desc, count } from "drizzle-orm";
import { SQLocalDrizzle } from "sqlocal/drizzle";
import { Router, json } from "./router.ts";
import { items } from "./schema.ts";

const dbInstance = new SQLocalDrizzle({ databasePath: "spike-04.sqlite3" });
const db = drizzle(dbInstance.driver, { logger: false });

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

// Pseudo-random text generator — pumps high-entropy ASCII so gzip can't
// trivially compress to nothing. Reflects real audit-log / domain text
// better than a repeated filler string. Deterministic seed so tests
// are reproducible.
function randomText(bytes: number, seed = 1): string {
  // Simple LCG; not cryptographic, but produces non-repeating output.
  let s = seed >>> 0;
  const chars: number[] = new Array(bytes);
  for (let i = 0; i < bytes; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    // Printable ASCII range 32..126 (95 chars).
    chars[i] = 32 + (s % 95);
  }
  return String.fromCharCode(...chars);
}

export const app = new Router()
  .get("/api/health", () => json({ ok: true, ts: Date.now() }))
  .get("/api/items/count", async () => {
    await ensureMigrated();
    // Use drizzle's typed count() helper rather than raw db.all() —
    // the sqlite-proxy adapter's raw path returns rows in a shape
    // that depends on the proxy implementation (column-as-array vs
    // column-as-object) and tripped us up here.
    const [r] = await db.select({ c: count() }).from(items);
    return json({ count: r?.c ?? 0 });
  })
  .get("/api/items", async () => {
    await ensureMigrated();
    const rows = await db.select().from(items).orderBy(desc(items.id)).limit(5);
    return json({ items: rows });
  })
  .post("/api/seed", async ({ req }) => {
    await ensureMigrated();
    const body = (await req.json()) as { rows?: number; bytesPerRow?: number };
    const rows = body.rows ?? 5000;
    const bytesPerRow = body.bytesPerRow ?? 1024;
    const t0 = performance.now();
    // Batch-insert in chunks of 500 so we don't blow the SQL parser/buffer.
    const chunk = 500;
    let inserted = 0;
    const now = Date.now();
    while (inserted < rows) {
      const batch = Math.min(chunk, rows - inserted);
      // Distinct text per row (seeded by row index) so gzip can't
      // dedupe everything to a single chunk — better proxy for real data.
      const values = Array.from({ length: batch }, (_, j) => ({
        text: randomText(bytesPerRow, inserted + j + 1),
        createdAt: now,
      }));
      await db.insert(items).values(values);
      inserted += batch;
    }
    const elapsedMs = performance.now() - t0;
    return json({ inserted, elapsedMs: Math.round(elapsedMs) });
  })
  .delete("/api/items", async () => {
    await ensureMigrated();
    await db.delete(items);
    return json({ ok: true });
  });
