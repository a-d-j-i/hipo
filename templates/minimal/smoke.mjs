// Playwright end-to-end smoke for templates/minimal.
//
// In-page only — no Deno backend. Starts the Vite dev server on port 1430,
// drives a real Chromium browser through:
//   1. Bootstrap (passphrase entry)
//   2. Setup (create admin account)
//   3. Auth/me via fetch from page.evaluate
//   4. Take backup (download) — intercepts the download and verifies the
//      file is non-empty and has the HIPB envelope magic bytes.
//
// Screenshots written to /tmp/templates-minimal-shots/

import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const FRONTEND_PORT = 1430;
const URL = `http://127.0.0.1:${FRONTEND_PORT}/`;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS_DIR = "/tmp/templates-minimal-shots";

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
      if (s)
        for (const line of s.split("\n")) console.log(`[${prefix}] ${line}`);
    });
  };
  pipe(proc.stdout, `${label}/out`);
  pipe(proc.stderr, `${label}/err`);
  return proc;
}

async function waitForUrl(url, timeoutMs = 60_000) {
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
  mkdirSync(SHOTS_DIR, { recursive: true });
  log(`screenshots → ${SHOTS_DIR}`);

  log("starting templates/minimal dev server…");
  const frontend = startProc("frontend", "npm", ["run", "dev"], {
    cwd: `${REPO_ROOT}/templates/minimal`,
    env: {
      ...process.env,
      // Vite needs to know the project root.
    },
  });

  let browser;
  try {
    log("waiting for dev server…");
    await waitForUrl(URL);
    log("dev server up");

    browser = await chromium.launch({ headless: true });
    // Fresh context = clean OPFS state.
    const ctx = await browser.newContext({ serviceWorkers: "allow" });
    const page = await ctx.newPage();

    page.on("pageerror", (e) => log(`[browser err] ${e}`));
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning" || t === "log") {
        // Filter out noisy HMR/Vite messages
        const txt = m.text();
        if (
          !txt.includes("optimized dependencies") &&
          !txt.includes("reloading")
        ) {
          log(`[browser ${t}] ${txt}`);
        }
      }
    });

    // ── 1. Navigate; wait for SW activation + COI reload ─────────────────
    log(`navigating to ${URL}`);
    await page.goto(URL, { waitUntil: "domcontentloaded" });

    // Wait for the page to settle after the potential SW-activation reload.
    // The SW triggers location.reload() when crossOriginIsolated is false;
    // after reload the page should be stable.
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 30_000,
    });
    await page.screenshot({ path: `${SHOTS_DIR}/01-initial.png` });

    // ── 2. Bootstrap: enter passphrase ───────────────────────────────────
    log("waiting for passphrase input…");
    const passphraseInput = await page.waitForSelector(
      "input[type='password']",
      {
        timeout: 30_000,
      },
    );
    log("found passphrase input; filling…");
    await passphraseInput.fill("my-secret-test-passphrase-2026");

    await page.screenshot({ path: `${SHOTS_DIR}/02-passphrase-filled.png` });

    // Click the Continue button.
    await page.click("button[type='submit']");
    log("clicked Continue; waiting for reload…");

    // Bootstrap writes the OPFS marker then calls location.reload().
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 30_000,
    });
    await page.screenshot({ path: `${SHOTS_DIR}/03-after-bootstrap.png` });

    // ── 3. Setup: create admin account ───────────────────────────────────
    log("waiting for setup form…");
    await page.waitForSelector("input[type='text']", { timeout: 30_000 });
    await page.fill("input[type='text']", "admin");
    await page.fill("input[type='password']", "admin12345");
    await page.screenshot({ path: `${SHOTS_DIR}/04-setup-filled.png` });

    await page.click("button[type='submit']");
    log("submitted setup; waiting for main page…");
    // Wait for the "Hello" heading that indicates successful login.
    // Vite may do an HMR optimization reload here; wait until we see
    // the authenticated state. Use a generous timeout.
    await page.waitForFunction(
      () => {
        const h2 = document.querySelector("h2");
        return (
          h2 && h2.textContent && h2.textContent.toLowerCase().includes("hello")
        );
      },
      { timeout: 60_000 },
    );
    await page.screenshot({ path: `${SHOTS_DIR}/05-main.png` });

    // ── 4. Verify /api/auth/me ────────────────────────────────────────────
    // Wait a bit for any Vite HMR reload to complete before checking.
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 30_000,
    });
    // Give the in-page Worker time to boot after any HMR reload.
    await page.waitForTimeout(2000);

    log("calling /api/auth/me from page context…");
    const sessionInfo = await page.evaluate(() => ({
      sid: sessionStorage.getItem("minimal.session"),
      allKeys: Object.keys(sessionStorage),
    }));
    log(`sessionStorage: ${JSON.stringify(sessionInfo)}`);

    const me = await page.evaluate(async () => {
      const sid = sessionStorage.getItem("minimal.session");
      const headers = { "content-type": "application/json" };
      if (sid) headers["X-Hipo-Token"] = sid;
      const r = await fetch("/api/auth/me", {
        credentials: "include",
        headers,
      });
      if (!r.ok) return { error: r.status };
      return r.json();
    });
    log(`/api/auth/me → ${JSON.stringify(me)}`);

    if (!me || me.username !== "admin") {
      throw new Error(`expected me.username=admin, got ${JSON.stringify(me)}`);
    }

    // ── 5. Backup download — intercept the anchor click ──────────────────
    log("clicking 'Take backup (download)'…");

    // Set up download interception before the click.
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

    await page.click("text=Take backup (download)");

    // After the page reload, the passphrase is gone from context.
    // If the inline passphrase prompt appears, fill it in.
    const promptInput = await page
      .waitForSelector("input[autocomplete='current-password']", {
        timeout: 1000,
      })
      .catch(() => null);
    if (promptInput) {
      log("passphrase prompt appeared; re-entering passphrase…");
      await promptInput.fill("my-secret-test-passphrase-2026");
      await page.click("button[type='submit']");
      log("submitted passphrase; waiting for download…");
    }
    log("waiting for download…");
    const download = await downloadPromise;
    log(`download started: ${download.suggestedFilename()}`);

    const stream = await download.createReadStream();
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const bytes = Buffer.concat(chunks);
    log(`download size: ${bytes.length} bytes`);

    // Verify magic bytes: "HIPB" = 0x48 0x49 0x50 0x42
    if (bytes.length < 4) {
      throw new Error(`envelope too short: ${bytes.length} bytes`);
    }
    const magic = bytes.slice(0, 4).toString("ascii");
    if (magic !== "HIPB") {
      throw new Error(`bad magic: expected HIPB, got ${JSON.stringify(magic)}`);
    }
    log(`envelope magic ok: ${magic}`);

    await page.screenshot({ path: `${SHOTS_DIR}/06-after-backup.png` });

    log("smoke ok ✓");
  } finally {
    try {
      await browser?.close();
    } catch {}
    frontend.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[smoke] FAILED:", e);
    process.exit(1);
  });
