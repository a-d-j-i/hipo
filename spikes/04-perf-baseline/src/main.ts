import { runBackupPipeline } from "./backup.ts";

const coldstartEl = document.getElementById("coldstart") as HTMLDivElement;
const seedBtn = document.getElementById("seed-btn") as HTMLButtonElement;
const countBtn = document.getElementById("count-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const benchBtn = document.getElementById("bench-btn") as HTMLButtonElement;
const rowsInput = document.getElementById("rows") as HTMLInputElement;
const bprInput = document.getElementById("bpr") as HTMLInputElement;
const passInput = document.getElementById("passphrase") as HTMLInputElement;
const seedOut = document.getElementById("seed-out") as HTMLPreElement;
const benchOut = document.getElementById("bench-out") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLPreElement;

function log(msg: string, cls?: "ok" | "err") {
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 ** 2).toFixed(2)} MiB`;
}

function fmtMs(n: number): string {
  if (n < 1000) return `${n.toFixed(1)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

const tBootStart = performance.now();
const tMilestones: Record<string, number> = {};
function mark(name: string) {
  tMilestones[name] = performance.now() - tBootStart;
  renderColdstart();
}

function renderColdstart() {
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const navType = nav?.type ?? "(unknown)";
  const domContentLoaded = nav ? Math.round(nav.domContentLoadedEventEnd) : NaN;
  const lines: string[] = [];
  lines.push(`<table><tr><th>Event</th><th>Time</th></tr>`);
  lines.push(
    `<tr><td>navigation type</td><td class="num">${navType}</td></tr>`,
  );
  lines.push(
    `<tr><td>DOMContentLoaded</td><td class="num">${fmtMs(domContentLoaded)}</td></tr>`,
  );
  for (const [k, v] of Object.entries(tMilestones)) {
    lines.push(`<tr><td>${k}</td><td class="num">${fmtMs(v)}</td></tr>`);
  }
  lines.push("</table>");
  coldstartEl.innerHTML = lines.join("");
}

async function callApi(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const r = await fetch(path, init);
  return { status: r.status, body: await r.json() };
}

const BASE = import.meta.env.BASE_URL;

async function ensureSWAndIsolation(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    log("serviceWorker not supported", "err");
    return false;
  }
  const reg = await navigator.serviceWorker.register(`${BASE}sw.js`, {
    scope: BASE,
  });
  log(`SW registered (scope=${reg.scope})`);
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const onChange = () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onChange,
        );
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onChange);
      const poll = setInterval(() => {
        if (navigator.serviceWorker.controller) {
          clearInterval(poll);
          navigator.serviceWorker.removeEventListener(
            "controllerchange",
            onChange,
          );
          resolve();
        }
      }, 100);
    });
  }
  if (!self.crossOriginIsolated) {
    document.body.style.visibility = "hidden";
    location.reload();
    return false;
  }
  return true;
}

async function init() {
  if (!(await ensureSWAndIsolation())) return;
  mark("isolation+SW ready");

  log("spawning worker…");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  await new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.kind === "loaded") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
  });
  mark("worker loaded");

  const channel = new MessageChannel();
  const workerReady = new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.kind === "ready") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
  });
  worker.postMessage({ kind: "api-port" }, [channel.port1]);
  navigator.serviceWorker.controller!.postMessage({ kind: "api-port" }, [
    channel.port2,
  ]);
  await workerReady;
  mark("port wired");

  // First /api/health round-trip — the canonical "ready to serve" mark.
  const t0 = performance.now();
  await callApi("GET", "/api/health");
  mark(`first /api/health (+${(performance.now() - t0).toFixed(0)} ms)`);

  [seedBtn, countBtn, clearBtn, benchBtn].forEach((b) => (b.disabled = false));
  log("ready", "ok");
}

seedBtn.addEventListener("click", async () => {
  const rows = parseInt(rowsInput.value, 10) || 5000;
  const bytesPerRow = parseInt(bprInput.value, 10) || 1024;
  log(`seeding ${rows} rows × ${bytesPerRow} bytes…`);
  seedBtn.disabled = true;
  try {
    const { body } = await callApi("POST", "/api/seed", { rows, bytesPerRow });
    seedOut.textContent = JSON.stringify(body, null, 2);
    log(`seed done in ${body.elapsedMs} ms`, "ok");
  } catch (e) {
    log(`seed failed: ${e}`, "err");
  } finally {
    seedBtn.disabled = false;
  }
});

countBtn.addEventListener("click", async () => {
  const { body } = await callApi("GET", "/api/items/count");
  seedOut.textContent = JSON.stringify(body, null, 2);
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete all rows?")) return;
  await callApi("DELETE", "/api/items");
  seedOut.textContent = "(cleared)";
});

benchBtn.addEventListener("click", async () => {
  benchBtn.disabled = true;
  benchOut.innerHTML = "<i>running…</i>";
  log("running backup pipeline benchmark…");
  try {
    const r = await runBackupPipeline(passInput.value || "hunter2");
    const rows: string[] = [];
    rows.push(
      "<table><tr><th>Stage</th><th>Time</th><th>Output size</th></tr>",
    );
    for (const t of r.timings) {
      rows.push(
        `<tr><td>${t.stage}</td><td class="num">${fmtMs(t.ms)}</td><td class="num">${
          t.outBytes !== undefined ? fmtBytes(t.outBytes) : "—"
        }</td></tr>`,
      );
    }
    rows.push(
      `<tr><td><b>Total</b></td><td class="num"><b>${fmtMs(r.totalMs)}</b></td><td></td></tr>`,
    );
    rows.push("</table>");
    rows.push(
      `<p class="hint">DB raw ${fmtBytes(r.rawBytes)} → gzip ${fmtBytes(r.compressedBytes)} (ratio ${(
        r.ratioGzip * 100
      ).toFixed(1)}%) → encrypted ${fmtBytes(r.encryptedBytes)}</p>`,
    );
    benchOut.innerHTML = rows.join("");
    log(`benchmark done in ${r.totalMs.toFixed(0)} ms`, "ok");
  } catch (e) {
    benchOut.innerHTML = `<span class="err">ERROR: ${e}</span>`;
    log(`benchmark failed: ${e}`, "err");
  } finally {
    benchBtn.disabled = false;
  }
});

renderColdstart();
init().catch((e) => {
  log(`fatal: ${e}\n${(e as Error).stack ?? ""}`, "err");
});
