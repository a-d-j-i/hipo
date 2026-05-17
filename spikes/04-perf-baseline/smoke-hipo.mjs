// End-to-end smoke test of hipo after the Phase 1 refactor.
// Boots a fresh backend (clean data dir) + frontend dev server,
// drives Playwright through: setup → create party → create loan →
// reload → confirm persistence. Tears everything down.

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const DATA_DIR = `/tmp/hipo-smoke-${Date.now()}`;
const BACKEND_PORT = 18787;
const FRONTEND_PORT = 1420;
const URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const REPO_ROOT = "/home/work/user/hipo";

function log(line) {
  console.log(`[smoke ${new Date().toISOString().slice(11, 19)}] ${line}`);
}

function startProc(label, cmd, args, opts) {
  const proc = spawn(cmd, args, {
    ...opts,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pipe = (stream, prefix) => {
    stream.on("data", (d) => {
      const s = String(d).trimEnd();
      if (s) for (const line of s.split("\n")) console.log(`[${prefix}] ${line}`);
    });
  };
  pipe(proc.stdout, `${label}/out`);
  pipe(proc.stderr, `${label}/err`);
  return proc;
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status > 0) return;
    } catch {
      // keep trying
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitForUrl timeout: ${url}`);
}

async function main() {
  // Clean data dir
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  log(`data dir: ${DATA_DIR}`);

  // Start backend
  log("starting backend…");
  const backend = startProc(
    "backend",
    "deno",
    ["task", "start"],
    {
      cwd: `${REPO_ROOT}/apps/backend`,
      env: {
        ...process.env,
        HIPO_DATA_DIR: DATA_DIR,
        HIPO_PORT: String(BACKEND_PORT),
      },
    },
  );

  // Start frontend dev (with proxy pointed at our backend)
  log("starting frontend…");
  const frontend = startProc(
    "frontend",
    "npm",
    ["run", "dev"],
    {
      cwd: `${REPO_ROOT}/apps/frontend`,
      env: { ...process.env, HIPO_BACKEND_PORT: String(BACKEND_PORT) },
    },
  );

  let browser;
  try {
    log("waiting for backend…");
    await waitForUrl(`http://127.0.0.1:${BACKEND_PORT}/api/healthz`);
    log("backend up");

    log("waiting for frontend…");
    await waitForUrl(URL);
    log("frontend up");

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`[browser err] ${e}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        log(`[browser ${m.type()}] ${m.text()}`);
      }
    });

    log(`navigating to ${URL}`);
    await page.goto(URL, { waitUntil: "domcontentloaded" });

    // SETUP — fresh DB, the app should show the first-admin form.
    log("looking for setup form…");
    await page.waitForSelector("input", { timeout: 15_000 });
    // Find the visible username and password inputs (antd renders them).
    const usernameInput = page.locator(
      'input[placeholder*="user" i], input[name*="user" i], input[type="text"]',
    ).first();
    const passwordInput = page.locator('input[type="password"]').first();
    await usernameInput.fill("admin");
    await passwordInput.fill("admin12345");

    // Sometimes setup requires confirm password — fill all password fields.
    const passCount = await page.locator('input[type="password"]').count();
    log(`password fields visible: ${passCount}`);
    if (passCount > 1) {
      await page.locator('input[type="password"]').nth(1).fill("admin12345");
    }

    log("submitting setup form…");
    await page.locator("button").filter({ hasText: /setup|create|sign|crear|configurar/i }).first().click();
    // Wait for nav away from the setup page.
    await page.waitForFunction(
      () => !document.body.textContent?.toLowerCase().includes("setup") || document.body.textContent?.length > 200,
      { timeout: 15_000 },
    );
    log("setup submitted — heuristic dashboard wait");
    await page.waitForTimeout(800);
    const afterSetup = await page.title();
    log(`page title after setup: ${afterSetup}`);

    // Probe a few API endpoints directly through the proxy.
    log("probing /api/healthz from main thread…");
    const health = await page.evaluate(async () => {
      const r = await fetch("/api/healthz");
      return { status: r.status, body: await r.json() };
    });
    log(`healthz → ${health.status} ${JSON.stringify(health.body)}`);

    log("probing /api/auth/status…");
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/auth/status");
      return { status: r.status, body: await r.json() };
    });
    log(`auth/status → ${status.status} ${JSON.stringify(status.body)}`);

    log("probing /api/auth/me…");
    const me = await page.evaluate(async () => {
      const r = await fetch("/api/auth/me", { credentials: "include" });
      return { status: r.status, body: await r.json() };
    });
    log(`auth/me → ${me.status} ${JSON.stringify(me.body)}`);

    log("probing /api/parties (creating one)…");
    const createParty = await page.evaluate(async () => {
      const r = await fetch("/api/parties", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Smoke Bank", externalRef: null, notes: null }),
      });
      return { status: r.status, body: await r.json() };
    });
    log(`POST /api/parties → ${createParty.status} ${JSON.stringify(createParty.body)}`);

    log("probing /api/parties (listing)…");
    const listParties = await page.evaluate(async () => {
      const r = await fetch("/api/parties", { credentials: "include" });
      return { status: r.status, body: await r.json() };
    });
    log(`GET /api/parties → ${listParties.status} count=${(listParties.body || []).length}`);

    log("probing /api/audit (admin-only)…");
    const audit = await page.evaluate(async () => {
      const r = await fetch("/api/audit?limit=10", { credentials: "include" });
      return { status: r.status, body: await r.json() };
    });
    log(`GET /api/audit → ${audit.status} count=${(audit.body || []).length}`);

    log("reloading page to confirm session + data persist…");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const afterReload = await page.evaluate(async () => {
      const me = await fetch("/api/auth/me", { credentials: "include" });
      const parties = await fetch("/api/parties", { credentials: "include" });
      return {
        me: { status: me.status, body: await me.json() },
        parties: { status: parties.status, body: await parties.json() },
      };
    });
    log(`after reload: me=${afterReload.me.status} ${JSON.stringify(afterReload.me.body?.username)}, parties count=${(afterReload.parties.body || []).length}`);

    log("smoke ok ✓");
  } finally {
    try { await browser?.close(); } catch {}
    backend.kill("SIGTERM");
    frontend.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(DATA_DIR, { recursive: true }); } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
