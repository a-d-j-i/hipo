// Main-thread bootstrap for the in-page backend shape.
//
// Mirror of apps/frontend/src/in-page-backend.ts. See that file for the
// full topology description. Identical logic; separate file so the
// template has no import dependency on apps/frontend.

const BASE = import.meta.env.BASE_URL;

/**
 * Phase 1+2: register the SW and wait for it to control the page in a
 * crossOriginIsolated context. If a COI reload is required, this function
 * triggers location.reload() and returns a promise that never resolves
 * (the page navigates away).
 */
export async function registerInPageSW(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("serviceWorker not supported");
  }

  const swUrl = `${BASE}sw.js`;
  const reg = await navigator.serviceWorker.register(swUrl, { scope: BASE });
  console.log(`[minimal backend] SW registered, scope=${reg.scope}`);

  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const onChange = () => {
        navigator.serviceWorker.removeEventListener("controllerchange", onChange);
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", onChange);
      const poll = setInterval(() => {
        if (navigator.serviceWorker.controller) {
          clearInterval(poll);
          navigator.serviceWorker.removeEventListener("controllerchange", onChange);
          resolve();
        }
      }, 100);
    });
    console.log("[minimal backend] SW now controlling");
  } else {
    console.log("[minimal backend] SW already controlling on load");
  }

  if (!self.crossOriginIsolated) {
    console.log("[minimal backend] reloading once for SW-injected COOP/COEP…");
    document.body.style.visibility = "hidden";
    location.reload();
    await new Promise(() => {});
  }
}

/**
 * Phase 3+4: spawn the Worker that owns the router + OPFS DB, wire a
 * MessageChannel from main → Worker → SW. Must be called after
 * registerInPageSW() has resolved.
 */
export async function spawnInPageWorker(): Promise<void> {
  console.log("[minimal backend] spawning Worker…");
  const worker = new Worker(new URL("./in-page-worker.ts", import.meta.url), {
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
  console.log("[minimal backend] Worker loaded");

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
  console.log("[minimal backend] api port wired");
}
