// Main-thread bootstrap for the in-page backend shape.
//
// Topology (per the plan):
//   1. Register the merged Service Worker (public/sw.js). It does
//      COOP/COEP injection + /api/* routing.
//   2. Wait for it to control the page. If `crossOriginIsolated` is
//      false, reload once so the SW can inject the headers on the
//      navigation response.
//   3. Spawn the dedicated Web Worker (in-page-worker.ts). It opens
//      OPFS, builds the framework Router with hipo's full route
//      surface, listens for the api port.
//   4. Create a MessageChannel. Send port1 to the Worker, port2 to
//      the Service Worker (via transfer). They use it for /api/*
//      request/response round-trips.
//   5. Resolve. After this, vanilla `fetch("/api/...")` from React
//      goes SW → Worker → router → response with no further setup.
//
// Phase 6 split these into two phases so the bootstrap flow can run
// after step 2 but before step 3 — bootstrap touches OPFS directly
// in the main thread and shouldn't have to fight the Worker for the
// sqlocal sync-access-handle.

const BASE = import.meta.env.BASE_URL;

/**
 * Phase 1+2 of the in-page backend boot: register the SW and wait
 * for it to control the page in a crossOriginIsolated context.
 * Returns true if SW + COI are ready; returns a never-resolving
 * promise (after kicking off `location.reload()`) when a COI reload
 * is required.
 */
export async function registerInPageSW(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("serviceWorker not supported");
  }

  const swUrl = `${BASE}sw.js`;
  const reg = await navigator.serviceWorker.register(swUrl, { scope: BASE });
  console.log(`[in-page backend] SW registered, scope=${reg.scope}`);

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
      // Safety: poll in case controllerchange already fired.
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
    console.log("[in-page backend] SW now controlling");
  } else {
    console.log("[in-page backend] SW already controlling on load");
  }

  if (!self.crossOriginIsolated) {
    console.log("[in-page backend] reloading once for SW-injected COOP/COEP…");
    document.body.style.visibility = "hidden";
    location.reload();
    // Promise never resolves — the page navigates away.
    await new Promise(() => {});
  }
}

/**
 * Phase 3+4 of the in-page backend boot: spawn the Worker that owns
 * the router + OPFS DB, wire a MessageChannel from main → Worker → SW.
 * Must be called after `registerInPageSW()` has resolved.
 */
export async function spawnInPageWorker(): Promise<void> {
  console.log("[in-page backend] spawning Worker…");
  const worker = new Worker(new URL("./in-page-worker.ts", import.meta.url), {
    type: "module",
  });

  // Wait for "loaded".
  await new Promise<void>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.kind === "loaded") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    };
    worker.addEventListener("message", onMsg);
  });
  console.log("[in-page backend] Worker loaded");

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
  console.log("[in-page backend] api port wired (main → Worker, main → SW)");
}

/**
 * Convenience wrapper used by paths that aren't bootstrap-aware
 * (e.g. the Tauri / Deno proxy shapes never reach this anyway).
 * Equivalent to calling `registerInPageSW()` then `spawnInPageWorker()`.
 */
export async function bootInPageBackend(): Promise<void> {
  await registerInPageSW();
  await spawnInPageWorker();
}
