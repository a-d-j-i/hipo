// End-to-end smoke of hipo in the in-page backend shape.
// Starts ONLY the frontend (no Deno backend), drives Playwright through
// setup → API calls → reload, confirms session persists.

import { spawn } from "node:child_process";
import { chromium } from "playwright";

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
      if (s)
        for (const line of s.split("\n")) console.log(`[${prefix}] ${line}`);
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
  log("starting frontend in VITE_INPAGE_BACKEND mode (no Deno)…");
  const frontend = startProc("frontend", "npm", ["run", "dev:inpage"], {
    cwd: `${REPO_ROOT}/apps/frontend`,
  });

  let browser;
  try {
    log("waiting for frontend…");
    await waitForUrl(URL);
    log("frontend up");

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ serviceWorkers: "allow" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`[browser err] ${e}`));
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") {
        log(`[browser ${t}] ${m.text()}`);
      }
    });

    log(`navigating to ${URL}`);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input", { timeout: 30_000 });

    // Install a small wrapper that mirrors apps/frontend/src/api/http.ts:
    // sends X-Hipo-Token from sessionStorage, syncs from X-Hipo-Session
    // response headers. Same logic the React app uses.
    await page.evaluate(() => {
      let authToken = sessionStorage.getItem("hipo:authToken");
      // @ts-expect-error
      window.__HIPO_API = async (method, path, body) => {
        const headers = {};
        if (body !== undefined) headers["content-type"] = "application/json";
        if (authToken) headers["X-Hipo-Token"] = authToken;
        const r = await fetch(path, {
          method,
          credentials: "include",
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const session = r.headers.get("X-Hipo-Session");
        if (session !== null) {
          authToken = session && session.length > 0 ? session : null;
          if (authToken) sessionStorage.setItem("hipo:authToken", authToken);
          else sessionStorage.removeItem("hipo:authToken");
        }
        const text = await r.text();
        return {
          status: r.status,
          body: text === "" ? null : JSON.parse(text),
        };
      };
    });

    const status = await page.evaluate(() =>
      window.__HIPO_API("GET", "/api/auth/status"),
    );
    log(`auth/status → ${status.status} ${JSON.stringify(status.body)}`);

    const health = await page.evaluate(() =>
      window.__HIPO_API("GET", "/api/healthz"),
    );
    log(`healthz → ${health.status} user=${JSON.stringify(health.body?.user)}`);

    log("setup via wrapper…");
    const setup = await page.evaluate(() =>
      window.__HIPO_API("POST", "/api/auth/setup", {
        username: "admin",
        password: "admin12345",
      }),
    );
    log(`setup → ${setup.status} ${JSON.stringify(setup.body)}`);

    const me = await page.evaluate(() =>
      window.__HIPO_API("GET", "/api/auth/me"),
    );
    log(`auth/me → ${me.status} ${JSON.stringify(me.body)}`);

    const createParty = await page.evaluate(() =>
      window.__HIPO_API("POST", "/api/parties", {
        name: "Smoke Bank In-Page",
      }),
    );
    log(
      `POST /api/parties → ${createParty.status} ${JSON.stringify(createParty.body)}`,
    );

    const listParties = await page.evaluate(() =>
      window.__HIPO_API("GET", "/api/parties"),
    );
    log(
      `GET /api/parties → ${listParties.status} count=${(listParties.body || []).length}`,
    );

    const audit = await page.evaluate(() =>
      window.__HIPO_API("GET", "/api/audit?limit=10"),
    );
    log(`GET /api/audit → ${audit.status} count=${(audit.body || []).length}`);

    log("reloading to confirm session + data persist…");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Reinstall the wrapper (page state was reset by reload).
    await page.evaluate(() => {
      let authToken = sessionStorage.getItem("hipo:authToken");
      window.__HIPO_API = async (method, path, body) => {
        const headers = {};
        if (body !== undefined) headers["content-type"] = "application/json";
        if (authToken) headers["X-Hipo-Token"] = authToken;
        const r = await fetch(path, {
          method,
          credentials: "include",
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const session = r.headers.get("X-Hipo-Session");
        if (session !== null) {
          authToken = session && session.length > 0 ? session : null;
          if (authToken) sessionStorage.setItem("hipo:authToken", authToken);
          else sessionStorage.removeItem("hipo:authToken");
        }
        const text = await r.text();
        return {
          status: r.status,
          body: text === "" ? null : JSON.parse(text),
        };
      };
    });

    const afterReload = await page.evaluate(async () => {
      const me = await window.__HIPO_API("GET", "/api/auth/me");
      const parties = await window.__HIPO_API("GET", "/api/parties");
      return { me, parties };
    });
    log(
      `after reload: me.username=${JSON.stringify(afterReload.me.body?.username)}, parties count=${(afterReload.parties.body || []).length}`,
    );

    const allOk =
      setup.status === 200 &&
      me.body?.username === "admin" &&
      createParty.status === 200 &&
      listParties.status === 200 &&
      (listParties.body || []).length === 1 &&
      audit.status === 200 &&
      (audit.body || []).length >= 1 &&
      afterReload.me.body?.username === "admin" &&
      (afterReload.parties.body || []).length === 1;

    if (allOk) {
      log("in-page smoke ok ✓");
    } else {
      log("in-page smoke FAILED — see above");
      process.exit(1);
    }
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
    console.error(e);
    process.exit(1);
  });
