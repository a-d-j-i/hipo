// Multi-tab single-owner spike (Phase 13 modal-only design).
//
// Verifies the Web Lock based "one tab at a time" guarantee:
//
//   1. Tab A boots first → acquires the "hipo-db" Web Lock, renders
//      the bootstrap UI (lock held while user is on first-launch
//      passphrase screen — no worker spawned yet).
//   2. Tab B opens against the same origin → lock probe fails → renders
//      MultiTabBlock with "Already open in another tab" copy.
//   3. Tab A closes → its Web Lock releases. Tab B's poller notices
//      within ~1 s and auto-reloads. Tab B's reload now acquires the
//      lock cleanly and renders the bootstrap UI.
//
// This proves the lock probe + release polling work end-to-end in a
// real Chromium against the dev frontend. WebKitGTK / Pages
// verification is deferred until Pages is deployed.

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const FRONTEND_PORT = 1420;
const URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const REPO_ROOT = "/home/work/user/hipo";

function log(line) {
  console.log(`[multi-tab ${new Date().toISOString().slice(11, 19)}] ${line}`);
}

function startProc(label, cmd, args, opts) {
  const proc = spawn(cmd, args, {
    ...opts,
    stdio: ["ignore", "pipe", "pipe"],
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
      // keep trying
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`waitForUrl timeout: ${url}`);
}

async function main() {
  log("starting frontend (dev:inpage)…");
  const frontend = startProc("frontend", "npm", ["run", "dev:inpage"], {
    cwd: `${REPO_ROOT}/apps/frontend`,
  });

  let browser;
  try {
    log("waiting for frontend…");
    await waitForUrl(URL);
    log("frontend up");

    browser = await chromium.launch({ headless: true });
    // Single context so both pages share the same origin / lock manager.
    const ctx = await browser.newContext({ serviceWorkers: "allow" });

    // ── Tab A: should acquire the lock and render bootstrap ──────────
    log("opening tab A…");
    const pageA = await ctx.newPage();
    pageA.on("pageerror", (e) => log(`[A err] ${e}`));
    pageA.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") log(`[A ${t}] ${m.text()}`);
    });
    await pageA.goto(URL, { waitUntil: "domcontentloaded" });

    // Bootstrap input is the first form on the start-fresh tab.
    await pageA.waitForSelector("input[type='password']", { timeout: 30_000 });
    log("tab A: bootstrap UI visible (lock acquired)");

    // ── Tab B: lock probe should fail, MultiTabBlock should render ──
    log("opening tab B…");
    const pageB = await ctx.newPage();
    pageB.on("pageerror", (e) => log(`[B err] ${e}`));
    pageB.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") log(`[B ${t}] ${m.text()}`);
    });
    await pageB.goto(URL, { waitUntil: "domcontentloaded" });

    // Look for the i18n'd title text — both ES (default) and EN forms
    // contain the word "tab" / "pestaña" — match on the h2/h3.
    const heading = await pageB.waitForSelector(
      "h2, h3, .ant-typography-title, [class*='ant-typography']",
      { timeout: 15_000 },
    );
    const headingText = (await heading.textContent())?.trim() ?? "";
    log(`tab B heading: "${headingText}"`);
    const isMultiTabBlock = /already open|otra pestaña/i.test(headingText);
    if (!isMultiTabBlock) {
      throw new Error(
        `tab B did not show MultiTabBlock — heading was "${headingText}"`,
      );
    }
    log("tab B: MultiTabBlock visible ✓");

    // Confirm tab B has not spawned a worker (api-port-not-wired probe
    // would 503; bootstrap-UI input shouldn't be present either).
    const hasPassphraseInput = await pageB.$("input[type='password']");
    if (hasPassphraseInput) {
      throw new Error("tab B should not have rendered the bootstrap form");
    }

    // ── Close tab A → tab B should auto-reload within ~1s + polling ──
    log("closing tab A…");
    await pageA.close();

    log("waiting for tab B to auto-reload + reach bootstrap…");
    // Reload happens ~600 ms after observeLockReleased fires, polling
    // is 1 s default — budget 5 s to absorb any jitter.
    await pageB.waitForSelector("input[type='password']", {
      timeout: 8_000,
    });
    log("tab B: bootstrap UI visible after auto-reload ✓");

    log("multi-tab spike ok ✓");
  } finally {
    try {
      await browser?.close();
    } catch {}
    killTree(frontend);
    await new Promise((r) => setTimeout(r, 500));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
