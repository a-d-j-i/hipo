// Spike 05: prove the framework's do_* ops execute in-browser against
// an OPFS-backed SQLite DB, with the same code that runs on Deno.
//
// Flow:
//   1. open OPFS-backed DB via @hipo/sqlite/client-browser
//   2. apply migrations (users + sessions only — no domain tables)
//   3. construct Ctx { db, user: null }
//   4. call doSetupFirstAdmin → expect success, user returned
//   5. construct Ctx with that admin
//   6. call doListUsers → expect [admin]
//
// On failure, the page shows what threw. On success, it dumps the
// admin user record + the list result.

import { openDb } from "@hipo/sqlite/client-browser";
import type { Migration } from "@hipo/sqlite";
import type { Ctx } from "@hipo/server";
import { doSetupFirstAdmin, doListUsers } from "@hipo/auth";

const outEl = document.getElementById("out") as HTMLPreElement;
const logEl = document.getElementById("log") as HTMLPreElement;

function log(msg: string, cls?: "ok" | "err") {
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`;
  logEl.append(line);
}

// Minimum schema needed for doSetupFirstAdmin + doListUsers.
// Mirrors packages/auth/src/schema.ts.
const migrations: Migration[] = [
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
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        payload TEXT
      );
    `,
  },
];

async function main() {
  log(`crossOriginIsolated: ${self.crossOriginIsolated}`);

  log("opening OPFS DB…");
  const { db } = await openDb({
    databasePath: "spike-05.sqlite3",
    migrations,
  });
  log("DB opened + migrations applied", "ok");

  // Step 1: setup first admin (Ctx with no user — the special setup case).
  const setupCtx: Ctx = { db, user: null };
  log("calling doSetupFirstAdmin…");
  const t0 = performance.now();
  const admin = await doSetupFirstAdmin(setupCtx, {
    username: "admin",
    password: "admin12345",
  });
  log(
    `admin created in ${(performance.now() - t0).toFixed(0)} ms`,
    "ok",
  );

  // Step 2: list users (Ctx with the admin).
  const adminCtx: Ctx = { db, user: admin };
  log("calling doListUsers…");
  const users = await doListUsers(adminCtx);
  log(`doListUsers returned ${users.length} user(s)`, "ok");

  outEl.textContent = [
    `crossOriginIsolated: ${self.crossOriginIsolated}`,
    "",
    "doSetupFirstAdmin result:",
    JSON.stringify(admin, null, 2),
    "",
    "doListUsers result:",
    JSON.stringify(users, null, 2),
  ].join("\n");

  log("smoke ok ✓", "ok");
}

main().catch((e) => {
  log(`fatal: ${e}\n${(e as Error).stack ?? ""}`, "err");
  outEl.textContent = `ERROR: ${e}\n\n${(e as Error).stack ?? ""}`;
  outEl.className = "err";
});
