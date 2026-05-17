// Main thread: same wiring as spike 02, plus the cross-origin-isolation
// handshake required by GitHub-Pages-style hosts that don't set
// COOP/COEP themselves. The flow is:
//
//   First visit (no SW yet):
//     1. Page loads without crossOriginIsolated.
//     2. SW registers, activates, claims this client.
//     3. We detect !crossOriginIsolated → reload once.
//     4. On reload, SW intercepts the navigation, injects COOP/COEP.
//     5. Page is now crossOriginIsolated. Proceed with Worker spawn.
//
//   Subsequent visits (SW cached):
//     1. SW intercepts navigation immediately.
//     2. Page boots crossOriginIsolated from the start.
//     3. No reload needed.
//
//   Dev mode (Vite + sqlocal plugin already set COOP/COEP):
//     1. Page loads already crossOriginIsolated.
//     2. SW still registers — we need it for /api/* routing
//        independent of COI.
//     3. After SW activates & claims, controller is set.
//     4. No reload needed because COI is already true.
//
// **Always register the SW.** Reload only if COI is missing.

const statusEl = document.getElementById("status") as HTMLPreElement;
const bannerEl = document.getElementById("isolation-banner") as HTMLDivElement;
const responseEl = document.getElementById("response") as HTMLPreElement;
const logEl = document.getElementById("log") as HTMLPreElement;
const healthBtn = document.getElementById("health-btn") as HTMLButtonElement;
const listBtn = document.getElementById("list-btn") as HTMLButtonElement;
const createBtn = document.getElementById("create-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const textInput = document.getElementById("text-input") as HTMLInputElement;
const opfsEl = document.getElementById("opfs") as HTMLPreElement;
const opfsBtn = document.getElementById("opfs-btn") as HTMLButtonElement;
const opfsDownloadBtn = document.getElementById(
  "opfs-download-btn",
) as HTMLButtonElement;

function log(msg: string, cls?: "ok" | "err") {
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toISOString().slice(11, 23)}] ${msg}\n`;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setBanner(text: string, cls: "ok" | "warn" | "err") {
  bannerEl.textContent = text;
  bannerEl.className = `banner ${cls}`;
}

function setButtonsEnabled(on: boolean) {
  [healthBtn, listBtn, createBtn, clearBtn, opfsBtn, opfsDownloadBtn].forEach(
    (b) => (b.disabled = !on),
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

async function inspectOpfs(): Promise<void> {
  if (!navigator.storage?.getDirectory) {
    opfsEl.textContent = "navigator.storage.getDirectory not supported";
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const lines: string[] = [];
    const est = await navigator.storage.estimate?.();
    if (est) {
      lines.push(
        `Storage estimate: usage ${formatBytes(est.usage ?? 0)}` +
          ` / quota ${formatBytes(est.quota ?? 0)}`,
      );
      lines.push("");
    }
    lines.push("OPFS root contents:");
    await walk(root, "", lines);
    opfsEl.textContent = lines.join("\n");
  } catch (e) {
    opfsEl.textContent = `inspect failed: ${e}`;
  }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  lines: string[],
): Promise<void> {
  // values() is async iterable in modern browsers.
  for await (const entry of (
    dir as FileSystemDirectoryHandle & {
      values(): AsyncIterableIterator<FileSystemHandle>;
    }
  ).values()) {
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      lines.push(
        `  ${prefix}${entry.name}  (${formatBytes(file.size)}, modified ${new Date(
          file.lastModified,
        )
          .toISOString()
          .slice(0, 19)})`,
      );
    } else {
      lines.push(`  ${prefix}${entry.name}/`);
      await walk(entry as FileSystemDirectoryHandle, prefix + "  ", lines);
    }
  }
}

async function downloadDbFile(): Promise<void> {
  if (!navigator.storage?.getDirectory) {
    opfsEl.textContent = "navigator.storage.getDirectory not supported";
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    // sqlocal stores the DB at the path passed to SQLocalDrizzle
    // (databasePath: "spike-03.sqlite3"). The file lives at the root.
    let handle: FileSystemFileHandle;
    try {
      handle = await root.getFileHandle("spike-03.sqlite3");
    } catch {
      opfsEl.textContent =
        "spike-03.sqlite3 not found at OPFS root yet — insert a row first.";
      return;
    }
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spike-03.sqlite3";
    a.click();
    URL.revokeObjectURL(url);
    log(`downloaded spike-03.sqlite3 (${formatBytes(file.size)})`, "ok");
  } catch (e) {
    opfsEl.textContent = `download failed: ${e}`;
  }
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

// The base path Vite was built with. import.meta.env.BASE_URL is "/" for
// dev and "/<repo>/" for GitHub Pages builds. We use it to resolve sw.js
// at the right URL.
const BASE = import.meta.env.BASE_URL;

// Registers the SW (always — we need it for /api/* routing) and only
// reloads if the page isn't yet crossOriginIsolated (production case
// where the host doesn't set COOP/COEP and the SW must inject them).
// Resolves only when the SW is controlling AND the page is COI.
async function ensureSWAndIsolation(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    setBanner("serviceWorker not supported in this browser", "err");
    return false;
  }

  const swUrl = `${BASE}sw.js`;
  log(`registering ${swUrl}`);
  const reg = await navigator.serviceWorker.register(swUrl, { scope: BASE });
  log(`SW registered, scope=${reg.scope}`);

  // Wait until *some* SW is active and controlling this page.
  // - Subsequent visits: controller is already set on page load.
  // - First visit: SW finishes install/activate, then clients.claim()
  //   fires controllerchange.
  if (!navigator.serviceWorker.controller) {
    log("waiting for SW to take control…");
    await new Promise<void>((resolve) => {
      const onChange = () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onChange,
        );
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onChange);
      // Safety: poll in case controllerchange already fired or never does.
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
    log("SW now controlling", "ok");
  } else {
    log("SW already controlling on load", "ok");
  }

  // If we already have COI (dev mode with Vite plugin, or subsequent
  // visit where SW intercepted the navigation), we're done.
  if (self.crossOriginIsolated) {
    setBanner("crossOriginIsolated: true (SW + headers active)", "ok");
    return true;
  }

  // Reload to pick up SW-injected COOP/COEP headers. Happens on:
  //   - first install (SW didn't exist when this navigation started)
  //   - hard reload (Ctrl-F5 / Cmd-Shift-R explicitly bypasses SW)
  //   - host that doesn't set headers + we lost SW control for any reason
  //
  // Hide the body during the bounce so the user doesn't see the
  // misleading flash. The reload is fast — by the time the eye
  // registers anything, the new page is loading.
  document.body.style.visibility = "hidden";
  location.reload();
  return false; // unreachable
}

async function init() {
  setButtonsEnabled(false);
  const ready = await ensureSWAndIsolation();
  if (!ready) return; // a reload is in progress

  setStatus(
    [
      `crossOriginIsolated: ${self.crossOriginIsolated}`,
      `base: ${BASE}`,
      `userAgent: ${navigator.userAgent.slice(0, 100)}`,
      `spawning worker…`,
    ].join("\n"),
  );

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
  log("worker loaded", "ok");

  // After ensureSWAndIsolation(), controller is always non-null.
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
  // controller is guaranteed non-null here because ensureSWAndIsolation()
  // waited for it.
  navigator.serviceWorker.controller!.postMessage({ kind: "api-port" }, [
    channel.port2,
  ]);
  await workerReady;
  log("api port wired (main → worker, main → SW)", "ok");

  setStatus(
    [
      `crossOriginIsolated: ${self.crossOriginIsolated}`,
      `base: ${BASE}`,
      `Worker: loaded`,
      `Service Worker: controlling, port wired`,
      `Topology ready — try a button.`,
    ].join("\n"),
  );
  setButtonsEnabled(true);
}

function setStatus(s: string) {
  statusEl.textContent = s;
}

healthBtn.addEventListener("click", () => callApi("GET", "/api/health"));
listBtn.addEventListener("click", () => callApi("GET", "/api/items"));
createBtn.addEventListener("click", () => {
  const text = textInput.value.trim() || `auto ${Date.now()}`;
  textInput.value = "";
  void callApi("POST", "/api/items", { text });
});
clearBtn.addEventListener("click", () => callApi("DELETE", "/api/items"));
opfsBtn.addEventListener("click", () => void inspectOpfs());
opfsDownloadBtn.addEventListener("click", () => void downloadDbFile());

init().catch((e) => {
  log(`fatal: ${e}\n${(e as Error).stack ?? ""}`, "err");
  setStatus(`ERROR: ${e}`);
  setBanner(`ERROR: ${e}`, "err");
});
