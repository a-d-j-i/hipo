// Headless benchmark driver for Spike 04.
//
// Spawns `vite preview` (production build), opens the page in Playwright
// Chromium, waits for init, seeds the synthetic DB, runs the backup
// pipeline, and prints all timing tables to stdout.
//
// Usage:
//   npm run build
//   node bench.mjs
//
// Assumes the build has just been produced (./dist exists) and that
// Playwright + the Chromium headless shell are installed.

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 5177;
const URL = `http://127.0.0.1:${PORT}/`;
const SEED_ROWS = 5000;
const SEED_BYTES_PER_ROW = 1024;

async function startDev() {
  // Use the dev server because sqlocal's Vite plugin sets COOP/COEP
  // headers there automatically — `vite preview` doesn't, and the SW
  // reload bounce is finicky in headless. The backup-pipeline numbers
  // are unaffected (the work is in WASM); cold-start numbers are
  // slightly worse than prod (un-minified bundles) but still
  // representative.
  const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  proc.stdout.on("data", (d) => {
    const s = String(d);
    if (s.includes("ready in") || s.includes("Local:")) ready = true;
  });
  proc.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 100 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("vite dev didn't start");
  await new Promise((r) => setTimeout(r, 800));
  return proc;
}

async function readColdstartTable(page) {
  return page.$$eval("#coldstart table tr", (rows) => {
    const out = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("th,td");
      if (cells.length === 2) {
        out.push({
          event: cells[0].textContent.trim(),
          time: cells[1].textContent.trim(),
        });
      }
    }
    return out;
  });
}

async function readBenchTable(page) {
  return page.$$eval("#bench-out table tr", (rows) => {
    const out = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("th,td");
      if (cells.length === 3) {
        out.push({
          stage: cells[0].textContent.trim(),
          time: cells[1].textContent.trim(),
          out: cells[2].textContent.trim(),
        });
      }
    }
    return out;
  });
}

function table(rows, cols) {
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const fmtRow = (vals) =>
    vals.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "─".repeat(w)).join("  ");
  const lines = [];
  lines.push(fmtRow(cols));
  lines.push(sep);
  for (const r of rows) lines.push(fmtRow(cols.map((c) => r[c] ?? "")));
  return lines.join("\n");
}

async function runOne(label, browser, opts = {}) {
  const context = await browser.newContext({
    serviceWorkers: "allow",
    ignoreHTTPSErrors: true,
    ...opts,
  });
  const page = await context.newPage();
  const consoleLines = [];
  page.on("console", (msg) =>
    consoleLines.push(`[${msg.type()}] ${msg.text()}`),
  );
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err}`));

  console.log(`\n=== Cold load (${label}) ===`);
  await page.goto(URL, { waitUntil: "load" });
  // Wait for "ready" log line — emitted at the end of init() after the
  // SW reload bounce on first visit.
  try {
    await page.waitForFunction(
      () => document.getElementById("log")?.textContent?.includes("ready"),
      { timeout: 60_000 },
    );
  } catch (e) {
    const logText = await page
      .$eval("#log", (el) => el.textContent ?? "(no log)")
      .catch(() => "(no log element)");
    const bodyHTML = await page.content();
    console.error("--- console messages ---");
    for (const line of consoleLines) console.error(line);
    console.error("--- log element ---");
    console.error(logText);
    console.error("--- page HTML (first 2000 chars) ---");
    console.error(bodyHTML.slice(0, 2000));
    throw e;
  }

  // Cold-start timings table.
  const cold = await readColdstartTable(page);
  console.log("Cold-start:");
  console.log(table(cold, ["event", "time"]));

  // Seed.
  console.log(
    `\n--- Seeding ${SEED_ROWS} rows × ${SEED_BYTES_PER_ROW} bytes ---`,
  );
  await page.fill("#rows", String(SEED_ROWS));
  await page.fill("#bpr", String(SEED_BYTES_PER_ROW));
  await page.click("#seed-btn");
  await page.waitForFunction(
    () =>
      document.getElementById("seed-out")?.textContent?.includes("inserted"),
    { timeout: 120_000 },
  );
  const seedText = await page.$eval("#seed-out", (e) => e.textContent ?? "");
  console.log(seedText.trim());

  // Backup benchmark.
  console.log("\n--- Backup pipeline benchmark ---");
  await page.click("#bench-btn");
  await page.waitForFunction(
    () => document.getElementById("bench-out")?.textContent?.includes("Total"),
    { timeout: 120_000 },
  );
  const bench = await readBenchTable(page);
  console.log(table(bench, ["stage", "time", "out"]));
  const summary = await page.$eval("#bench-out p", (e) => e.textContent ?? "");
  console.log(summary.trim());

  // Now reload the page (warm-start) — same browser context, OPFS still
  // populated, SW already controlling.
  console.log(`\n=== Warm load (${label}, reload, OPFS populated) ===`);
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById("log")?.textContent?.includes("ready"),
    { timeout: 20_000 },
  );
  const warm = await readColdstartTable(page);
  console.log("Warm-start (same context):");
  console.log(table(warm, ["event", "time"]));

  await context.close();
}

async function main() {
  console.log("starting vite dev…");
  const dev = await startDev();
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      await runOne("Chromium / Linux / headless / dev", browser);
    } finally {
      await browser.close();
    }
  } finally {
    dev.kill("SIGTERM");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
