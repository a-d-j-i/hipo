// UI smoke for the Phase 9 backup-vault flow.
// Boots a clean Deno backend + Vite frontend, drives Playwright through:
//   1. Setup first admin.
//   2. Open Settings, click "Back up now (download)" to set the
//      passphrase in PassphraseContext (the modal asks for one;
//      we discard the resulting download).
//   3. In the Vault section: Mint PAT → close modal → Test connection
//      → Save & link → Back up to vault.
//   4. Verify via the backend's audit log that vault.blob.put landed.
// Captures screenshots at each step under /tmp/hipo-vault-ui-shots/.

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const DATA_DIR = `/tmp/hipo-vault-ui-${Date.now()}`;
const SHOTS_DIR = "/tmp/hipo-vault-ui-shots";
const BACKEND_PORT = 18901;
const FRONTEND_PORT = 1424;
const URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PASSPHRASE = "smoke-passphrase-2026";

function log(line) {
  console.log(`[smoke ${new Date().toISOString().slice(11, 19)}] ${line}`);
}

function startProc(label, cmd, args, opts) {
  const proc = spawn(cmd, args, {
    ...opts,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so killTree() reaches `vite` that npm exec'd —
    // SIGTERM to npm alone doesn't propagate through the exec call.
    detached: true,
  });
  const pipe = (stream, prefix) => {
    stream.on("data", (d) => {
      const s = String(d).trimEnd();
      if (s)
        for (const line of s.split("\n")) console.log(`[${prefix}] ${line}`);
    });
  };
  pipe(proc.stdout, `${label}/out`);
  pipe(proc.stderr, `${label}/err`);
  return proc;
}

function killTree(proc) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // group may already be gone
  }
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status > 0) return;
    } catch {
      /* keep trying */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitForUrl timeout: ${url}`);
}

async function shot(page, name) {
  const path = `${SHOTS_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  log(`📸 ${path}`);
}

async function main() {
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  log(`data dir: ${DATA_DIR}`);
  log(`screenshots: ${SHOTS_DIR}`);

  log("starting backend…");
  const backend = startProc("backend", "deno", ["task", "start"], {
    cwd: `${REPO_ROOT}/apps/hipo`,
    env: {
      ...process.env,
      HIPO_DATA_DIR: DATA_DIR,
      HIPO_PORT: String(BACKEND_PORT),
    },
  });

  log("starting frontend…");
  // vite.config.ts hard-codes port 1420 with strictPort:true; override
  // via --port so multiple devs can run smoke simultaneously.
  const frontend = startProc(
    "frontend",
    "npm",
    ["run", "dev", "--", "--port", String(FRONTEND_PORT)],
    {
      cwd: `${REPO_ROOT}/apps/frontend`,
      env: {
        ...process.env,
        HIPO_BACKEND_PORT: String(BACKEND_PORT),
        // Force English so the smoke's regexes don't have to know Spanish.
        VITE_LOCALE: "en",
      },
    },
  );

  let browser;
  try {
    await waitForUrl(`http://127.0.0.1:${BACKEND_PORT}/api/healthz`);
    log("backend up");
    await waitForUrl(URL);
    log("frontend up");

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`[browser err] ${e}`));
    page.on("console", (m) => {
      if (m.type() === "error") log(`[browser err] ${m.text()}`);
    });

    log("→ navigate");
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input", { timeout: 15_000 });
    await shot(page, "01-setup");

    log("→ setup admin");
    await page
      .locator('input[type="text"], input[autocomplete*="user"]')
      .first()
      .fill("admin");
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.first().fill("admin12345");
    if ((await pwInputs.count()) > 1) {
      await pwInputs.nth(1).fill("admin12345");
    }
    await page
      .locator("button")
      .filter({ hasText: /setup|create|crear|configurar/i })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await shot(page, "02-after-setup");

    log("→ go to Settings");
    // Try menu link first; fallback to direct URL.
    const settingsLink = page
      .locator('a, [role="menuitem"]')
      .filter({ hasText: /settings|ajustes|configurac/i })
      .first();
    if ((await settingsLink.count()) > 0) {
      await settingsLink.click();
    } else {
      await page.goto(`${URL}settings`, { waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(600);
    await shot(page, "03-settings");

    log("→ set passphrase via 'Back up now (download)' modal");
    // The button's i18n key is `settings.storage.backupNow.button`; we
    // match by visible text without relying on locale.
    const backupNowBtn = page
      .locator("button")
      .filter({ hasText: /back up now.*download|copia.*descargar|descarga/i })
      .first();
    await backupNowBtn.click();
    await page.waitForTimeout(300);
    const passModalInput = page.locator('input[type="password"]').first();
    await passModalInput.fill(PASSPHRASE);
    await shot(page, "04-passphrase-modal");
    const downloadPromise = page.waitForEvent("download").catch(() => null);
    // antd Modal OK button is the primary one in the footer; the label
    // is `okText={t("settings.storage.backupNow.button")}` ("Back up now
    // (download)") but the class is enough to disambiguate.
    await page.locator(".ant-modal-footer .ant-btn-primary").first().click();
    const dl = await downloadPromise;
    if (dl) {
      await dl.saveAs(`${SHOTS_DIR}/discarded-backup.bin`);
      log("  ↳ download triggered + discarded");
    }
    await page.waitForTimeout(800);
    await shot(page, "05-passphrase-set");

    log("→ scope to Vault Card by its title");
    // The vault Card has title "Vault backup" — scope all further
    // locators to that card so other Cards' identical button labels
    // (e.g. GitHub "Save & link") don't collide.
    const vaultCard = page
      .locator(".ant-card")
      .filter({ has: page.locator('h5:has-text("Vault backup")') })
      .first();
    await vaultCard.scrollIntoViewIfNeeded();
    await shot(page, "06-vault-section");

    log("→ fill base URL");
    // Inputs in order inside the card: baseUrl, blobId, PAT.
    await vaultCard.locator("input").nth(0).fill(URL.replace(/\/$/, ""));

    log("→ click Mint new PAT");
    await vaultCard
      .locator("button")
      .filter({ hasText: /mint/i })
      .first()
      .click();
    await page.waitForTimeout(800);
    await shot(page, "07-mint-pat-modal");

    log("→ close minted-PAT modal (close-X)");
    await page.locator(".ant-modal-close").first().click();
    await page.waitForTimeout(400);

    log("→ Test connection");
    await vaultCard
      .locator("button")
      .filter({ hasText: /test/i })
      .first()
      .click();
    await page.waitForTimeout(1000);
    await shot(page, "08-test-ok");

    log("→ Save & link");
    await vaultCard
      .locator("button")
      .filter({ hasText: /save|guardar/i })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await shot(page, "09-saved");

    log("→ Back up to vault");
    // The "Back up to vault" button only renders after Save completes
    // (config !== null). Wait for the antd success toast or re-scope.
    await page.waitForTimeout(500);
    const backupToVaultBtn = vaultCard
      .locator("button")
      .filter({ hasText: /back up to vault/i });
    if ((await backupToVaultBtn.count()) > 0) {
      await backupToVaultBtn.first().click();
      await page.waitForTimeout(4000);
      await shot(page, "10-backup-done");
    } else {
      log("  ↳ 'Back up to vault' button not found; vault not saved?");
    }

    log("→ verify via /api/audit");
    const auditRes = await page.evaluate(async () => {
      const r = await fetch("/api/audit?limit=20", {
        credentials: "include",
      });
      return { status: r.status, rows: await r.json() };
    });
    log(`  audit status=${auditRes.status}`);
    const vaultEvents = (auditRes.rows || []).filter((r) =>
      String(r.action).startsWith("vault."),
    );
    log(`  vault audit events: ${vaultEvents.length}`);
    for (const e of vaultEvents) {
      log(`    · ${e.action} ${e.payload}`);
    }

    log("→ verify blob via /api/vault/blob/backup.bin (session-authed)");
    const blobRes = await page.evaluate(async () => {
      const r = await fetch("/api/vault/blob/backup.bin", {
        credentials: "include",
      });
      const ab = r.ok ? await r.arrayBuffer() : null;
      return { status: r.status, size: ab ? ab.byteLength : 0 };
    });
    log(`  blob status=${blobRes.status} size=${blobRes.size} bytes`);

    log("→ verify /api/system/status reflects vault target");
    const statusRes = await page.evaluate(async () => {
      const r = await fetch("/api/system/status", { credentials: "include" });
      return await r.json();
    });
    const vaultRow = (statusRes.backups?.targets || []).find(
      (t) => t.id === "vault",
    );
    log(`  vault state row: ${JSON.stringify(vaultRow)}`);

    const ok =
      vaultEvents.some((e) => e.action === "vault.blob.put") &&
      blobRes.status === 200 &&
      blobRes.size > 0 &&
      vaultRow &&
      vaultRow.last_backup_at;

    if (ok) {
      log("✅ vault UI smoke PASS");
    } else {
      log("❌ vault UI smoke FAIL");
      process.exitCode = 1;
    }
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    killTree(backend);
    killTree(frontend);
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(DATA_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
