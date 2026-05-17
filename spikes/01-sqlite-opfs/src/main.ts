import { SQLocalDrizzle } from "sqlocal/drizzle";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql, desc } from "drizzle-orm";
import { items } from "./schema.ts";

const envEl = document.getElementById("env") as HTMLPreElement;
const rowsEl = document.getElementById("rows") as HTMLPreElement;
const logEl = document.getElementById("log") as HTMLPreElement;
const insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;
const selectBtn = document.getElementById("select-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const input = document.getElementById("text-input") as HTMLInputElement;

function log(msg: string, cls?: "ok" | "err") {
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function reportEnv() {
  const lines: string[] = [];
  lines.push(`crossOriginIsolated: ${self.crossOriginIsolated}`);
  lines.push(`userAgent: ${navigator.userAgent}`);
  lines.push(`navigator.storage: ${"storage" in navigator}`);
  if ("storage" in navigator && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      lines.push(
        `quota: ${formatBytes(est.quota ?? 0)} usage: ${formatBytes(est.usage ?? 0)}`,
      );
    } catch (e) {
      lines.push(`navigator.storage.estimate() failed: ${e}`);
    }
  }
  envEl.textContent = lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

const dbInstance = new SQLocalDrizzle({ databasePath: "spike.sqlite3" });
const db = drizzle(dbInstance.driver, { logger: false });

async function migrate() {
  await db.run(sql`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  log("migration ok (CREATE TABLE IF NOT EXISTS items)", "ok");
}

async function refresh() {
  const rows = await db.select().from(items).orderBy(desc(items.id));
  if (rows.length === 0) {
    rowsEl.textContent = "(no rows yet — insert one above)";
    return;
  }
  rowsEl.textContent = rows
    .map(
      (r) =>
        `#${String(r.id).padStart(4, "0")}  ${new Date(r.createdAt).toISOString()}  ${r.text}`,
    )
    .join("\n");
}

insertBtn.addEventListener("click", async () => {
  const text = input.value.trim() || `auto ${Date.now()}`;
  try {
    insertBtn.disabled = true;
    await db.insert(items).values({ text, createdAt: Date.now() });
    log(`inserted: ${text}`, "ok");
    input.value = "";
    await refresh();
  } catch (e) {
    log(`insert failed: ${e}`, "err");
  } finally {
    insertBtn.disabled = false;
  }
});

selectBtn.addEventListener("click", async () => {
  try {
    await refresh();
    log("refresh ok", "ok");
  } catch (e) {
    log(`refresh failed: ${e}`, "err");
  }
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete all rows?")) return;
  try {
    await db.delete(items);
    log("cleared all rows", "ok");
    await refresh();
  } catch (e) {
    log(`clear failed: ${e}`, "err");
  }
});

async function main() {
  await reportEnv();
  try {
    await migrate();
    await refresh();
    log("ready", "ok");
  } catch (e) {
    log(`init failed: ${e}`, "err");
    rowsEl.textContent = `(init failed: ${e})`;
  }
}

main().catch((e) => log(`fatal: ${e}`, "err"));
