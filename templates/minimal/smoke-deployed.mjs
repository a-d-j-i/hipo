// Post-deploy Playwright smoke for the GitHub Pages build.
//
// Target URL comes from the SMOKE_URL env var (the Pages job sets this
// to the deployment's `page_url` output). We hit the templates/minimal
// subpath under the deployed Pages site and run the same bootstrap →
// setup → take-backup flow as smoke.mjs.
//
// Additional invariants vs the dev-server smoke:
//   - crossOriginIsolated must be true after the SW activates (otherwise
//     the in-page Worker can't use OPFS sync-access-handle).
//   - The merged Service Worker must control the page after activation.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const SMOKE_URL = process.env.SMOKE_URL;
if (!SMOKE_URL) {
  console.error(
    "[smoke-deployed] SMOKE_URL env var is required (the Pages deploy job sets it).",
  );
  process.exit(2);
}

// SMOKE_URL is the Pages root; the minimal demo lives under /minimal/.
const TARGET = new URL("minimal/", SMOKE_URL).toString();
const SHOTS_DIR = process.env.SHOTS_DIR ?? "/tmp/pages-smoke-shots";

function log(line) {
  console.log(`[smoke-deployed ${new Date().toISOString().slice(11, 19)}] ${line}`);
}

async function main() {
  mkdirSync(SHOTS_DIR, { recursive: true });
  log(`target → ${TARGET}`);
  log(`screenshots → ${SHOTS_DIR}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "allow" });
    const page = await ctx.newPage();

    page.on("pageerror", (e) => log(`[browser err] ${e}`));
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") {
        log(`[browser ${t}] ${m.text()}`);
      }
    });

    // ── 1. Navigate; wait for SW activation + COI reload ────────────────
    log(`navigating to ${TARGET}`);
    await page.goto(TARGET, { waitUntil: "domcontentloaded" });

    // The SW does location.reload() on first activation to unlock COI;
    // wait for the page to settle.
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);

    // Assert COI is in force — this is the entire point of the merged SW.
    const coi = await page.evaluate(() => self.crossOriginIsolated);
    if (!coi) {
      throw new Error(
        `crossOriginIsolated=false — SW didn't inject COOP/COEP correctly`,
      );
    }
    log("crossOriginIsolated=true ✓");

    // Assert the SW is controlling.
    const swController = await page.evaluate(
      () => !!navigator.serviceWorker.controller,
    );
    if (!swController) {
      throw new Error("no SW controller — registration / activation failed");
    }
    log("SW controller active ✓");

    await page.screenshot({ path: `${SHOTS_DIR}/01-initial.png` });

    // ── 2. Bootstrap: enter passphrase ──────────────────────────────────
    log("waiting for passphrase input…");
    const passphraseInput = await page.waitForSelector(
      "input[type='password']",
      { timeout: 30_000 },
    );
    await passphraseInput.fill("my-secret-test-passphrase-2026");
    await page.screenshot({ path: `${SHOTS_DIR}/02-passphrase-filled.png` });

    await page.click("button[type='submit']");
    log("clicked Continue; waiting for reload…");
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: 30_000,
    });
    await page.screenshot({ path: `${SHOTS_DIR}/03-after-bootstrap.png` });

    // ── 3. Setup: create admin account ──────────────────────────────────
    log("waiting for setup form…");
    await page.waitForSelector("input[type='text']", { timeout: 30_000 });
    await page.fill("input[type='text']", "admin");
    await page.fill("input[type='password']", "admin12345");
    await page.screenshot({ path: `${SHOTS_DIR}/04-setup-filled.png` });

    await page.click("button[type='submit']");
    log("submitted setup; waiting for main page…");
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

    // ── 4. Take backup — download has HIPB envelope magic ───────────────
    log("clicking 'Take backup (download)'…");
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.click("text=Take backup (download)");

    const promptInput = await page
      .waitForSelector("input[autocomplete='current-password']", {
        timeout: 1000,
      })
      .catch(() => null);
    if (promptInput) {
      log("passphrase prompt appeared; re-entering passphrase…");
      await promptInput.fill("my-secret-test-passphrase-2026");
      await page.click("button[type='submit']");
    }

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
    await browser.close().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[smoke-deployed] FAILED:", e);
    process.exit(1);
  });
