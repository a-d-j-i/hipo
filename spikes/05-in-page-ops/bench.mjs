// Headless driver for spike 05. Starts the Vite dev server, loads the
// page in Playwright Chromium, waits for either "smoke ok" or an error
// in the log element, then prints the result panel.

import { spawn } from "node:child_process";
import { chromium } from "../04-perf-baseline/node_modules/playwright/index.mjs";

const PORT = 5178;
const URL = `http://127.0.0.1:${PORT}/`;

async function startDev() {
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
  if (!ready) throw new Error("vite didn't start");
  await new Promise((r) => setTimeout(r, 500));
  return proc;
}

async function main() {
  console.log("starting vite dev…");
  const dev = await startDev();
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("console", (m) => {
        if (m.type() === "error") console.error(`[page err] ${m.text()}`);
      });
      page.on("pageerror", (e) => console.error(`[page err] ${e}`));
      await page.goto(URL, { waitUntil: "load" });
      // Wait for either success or fatal in the log element.
      await page.waitForFunction(
        () => {
          const t = document.getElementById("log")?.textContent ?? "";
          return t.includes("smoke ok") || t.includes("fatal:");
        },
        { timeout: 60_000 },
      );
      const logText = await page.$eval("#log", (el) => el.textContent ?? "");
      const outText = await page.$eval("#out", (el) => el.textContent ?? "");
      console.log("\n=== log ===");
      console.log(logText.trim());
      console.log("\n=== out ===");
      console.log(outText.trim());
      if (!logText.includes("smoke ok")) {
        throw new Error("spike failed — see log above");
      }
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
