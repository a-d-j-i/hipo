const statusEl = document.getElementById("status") as HTMLPreElement;
const responseEl = document.getElementById("response") as HTMLPreElement;
const logEl = document.getElementById("log") as HTMLPreElement;
const healthBtn = document.getElementById("health-btn") as HTMLButtonElement;
const listBtn = document.getElementById("list-btn") as HTMLButtonElement;
const createBtn = document.getElementById("create-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const notFoundBtn = document.getElementById("not-found-btn") as HTMLButtonElement;
const textInput = document.getElementById("text-input") as HTMLInputElement;

function log(msg: string, cls?: "ok" | "err") {
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(s: string) {
  statusEl.textContent = s;
}

function setButtonsEnabled(on: boolean) {
  [healthBtn, listBtn, createBtn, clearBtn, notFoundBtn].forEach(
    (b) => (b.disabled = !on),
  );
}

async function callApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<void> {
  const t0 = performance.now();
  try {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    const r = await fetch(path, init);
    const t = (performance.now() - t0).toFixed(1);
    const text = await r.text();
    responseEl.textContent = `${method} ${path} → ${r.status} (${t} ms)\n\n${text}`;
    log(`${method} ${path} → ${r.status} (${t} ms)`, r.ok ? "ok" : "err");
  } catch (e) {
    log(`${method} ${path} failed: ${e}`, "err");
    responseEl.textContent = `ERROR: ${e}`;
  }
}

async function init() {
  setButtonsEnabled(false);
  setStatus(`crossOriginIsolated: ${self.crossOriginIsolated}\nbooting…`);

  // 1. Spawn the dedicated Worker first. It needs to exist before we can
  //    forward the MessageChannel port to it.
  log("spawning worker…");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });

  // Wait until the worker reports "loaded"
  await new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.kind === "loaded") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
  });
  log("worker loaded", "ok");

  // 2. Register the service worker. Wait for it to control this page.
  if (!("serviceWorker" in navigator)) {
    setStatus("ERROR: serviceWorker not available");
    log("serviceWorker not available", "err");
    return;
  }
  log("registering service worker…");
  const reg = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });
  log(`SW registered, scope=${reg.scope}`);

  // If we just installed and there's no controller, reload so the SW takes
  // control. (skipWaiting + clients.claim in the SW means this usually
  // doesn't trigger more than once on first install.)
  if (!navigator.serviceWorker.controller) {
    log("SW not yet controlling — reloading to claim", "ok");
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        resolve(),
      );
      // Some browsers won't fire controllerchange without a hard reload.
      setTimeout(() => location.reload(), 100);
    });
    return;
  }
  log("SW controlling page", "ok");

  // 3. Create a MessageChannel: port1 → worker, port2 → SW.
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
  log("worker confirmed port wired", "ok");

  setStatus(
    [
      `crossOriginIsolated: ${self.crossOriginIsolated}`,
      `Worker: loaded`,
      `Service Worker: controlling, port wired`,
      `Topology ready — try a button.`,
    ].join("\n"),
  );
  setButtonsEnabled(true);
}

healthBtn.addEventListener("click", () => callApi("GET", "/api/health"));
listBtn.addEventListener("click", () => callApi("GET", "/api/items"));
createBtn.addEventListener("click", () => {
  const text = textInput.value.trim() || `auto ${Date.now()}`;
  textInput.value = "";
  void callApi("POST", "/api/items", { text });
});
clearBtn.addEventListener("click", () => callApi("DELETE", "/api/items"));
notFoundBtn.addEventListener("click", () => callApi("GET", "/api/missing"));

init().catch((e) => {
  log(`fatal: ${e}\n${(e as Error).stack ?? ""}`, "err");
  setStatus(`ERROR: ${e}`);
});
