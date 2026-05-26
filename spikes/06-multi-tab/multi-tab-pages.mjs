// Multi-tab single-owner parity check against the deployed Pages build.
//
// Same flow as multi-tab.mjs but skips the local frontend spawn and runs
// against the public Pages URL. Drives both Chromium and WebKit via
// Playwright so we exercise the Web Lock primitive on each engine's
// production-built output. Note: Playwright's webkit is desktop Safari
// WebKit, not WebKitGTK 2.50.6 — closer than Chromium-only but not a
// perfect substitute for Linux Tauri's runtime.

import { chromium, webkit } from "playwright";

const URL = process.env.PAGES_URL ?? "https://a-d-j-i.github.io/hipo/hipo/";
const BROWSERS = { chromium, webkit };

function log(browser, line) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${browser} ${ts}] ${line}`);
}

async function runAgainst(name, browserType) {
  log(name, `launching against ${URL}`);
  const browser = await browserType.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "allow" });

    // ── Tab A: should acquire the lock and render bootstrap ──────────
    log(name, "opening tab A…");
    const pageA = await ctx.newPage();
    pageA.on("pageerror", (e) => log(name, `[A err] ${e}`));
    pageA.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") log(name, `[A ${t}] ${m.text()}`);
    });
    await pageA.goto(URL, { waitUntil: "domcontentloaded" });

    // Cold SW install + COI self-reload + Worker spawn can take a while
    // on Pages (production bundle + network). Budget 60 s.
    await pageA.waitForSelector("input[type='password']", { timeout: 60_000 });
    log(name, "tab A: bootstrap UI visible (lock acquired)");

    // ── Tab B: lock probe should fail, MultiTabBlock should render ──
    log(name, "opening tab B…");
    const pageB = await ctx.newPage();
    pageB.on("pageerror", (e) => log(name, `[B err] ${e}`));
    pageB.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") log(name, `[B ${t}] ${m.text()}`);
    });
    await pageB.goto(URL, { waitUntil: "domcontentloaded" });

    const heading = await pageB.waitForSelector(
      "h2, h3, .ant-typography-title, [class*='ant-typography']",
      { timeout: 30_000 },
    );
    const headingText = (await heading.textContent())?.trim() ?? "";
    log(name, `tab B heading: "${headingText}"`);
    const isMultiTabBlock = /already open|otra pestaña/i.test(headingText);
    if (!isMultiTabBlock) {
      throw new Error(
        `tab B did not show MultiTabBlock — heading was "${headingText}"`,
      );
    }
    log(name, "tab B: MultiTabBlock visible ✓");

    const hasPassphraseInput = await pageB.$("input[type='password']");
    if (hasPassphraseInput) {
      throw new Error("tab B should not have rendered the bootstrap form");
    }

    // ── Close tab A → tab B should auto-reload + reach bootstrap ──
    log(name, "closing tab A…");
    await pageA.close();

    log(name, "waiting for tab B to auto-reload + reach bootstrap…");
    await pageB.waitForSelector("input[type='password']", { timeout: 15_000 });
    log(name, "tab B: bootstrap UI visible after auto-reload ✓");

    log(name, "pages multi-tab parity ok ✓");
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const targets = process.argv.slice(2).length
    ? process.argv.slice(2)
    : Object.keys(BROWSERS);

  const results = [];
  for (const t of targets) {
    const browserType = BROWSERS[t];
    if (!browserType) {
      console.error(`unknown browser: ${t} (known: ${Object.keys(BROWSERS).join(", ")})`);
      process.exit(2);
    }
    try {
      await runAgainst(t, browserType);
      results.push({ browser: t, ok: true });
    } catch (e) {
      console.error(`[${t}] FAILED:`, e);
      results.push({ browser: t, ok: false, error: String(e) });
    }
  }

  console.log("\n── summary ──");
  for (const r of results) {
    console.log(`  ${r.browser}: ${r.ok ? "PASS" : "FAIL"}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
