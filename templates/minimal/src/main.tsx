import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import BootstrapApp from "./BootstrapApp.tsx";
import "./styles.css";

async function boot() {
  // Step 1: Register the merged Service Worker and wait for COOP/COEP.
  // If a reload is needed for cross-origin isolation, registerInPageSW()
  // triggers it and the returned promise never resolves.
  const { registerInPageSW, spawnInPageWorker } =
    await import("./in-page-backend.ts");
  await registerInPageSW();

  // Step 2a: Acquire the single-tab Web Lock. If another tab already
  // owns it, render the MultiTabBlock screen and stop here. The browser
  // releases the lock when the page unloads.
  const { tryAcquireLock } = await import("@hipo/server");
  const lock = await tryAcquireLock();
  if (!lock.acquired) {
    const { default: MultiTabBlock } = await import("./MultiTabBlock.tsx");
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <MultiTabBlock />
      </React.StrictMode>,
    );
    return;
  }

  // Step 2b: Check whether OPFS has been bootstrapped on this device.
  const { isOpfsBootstrapped } = await import("./opfs-state.ts");
  const bootstrapped = await isOpfsBootstrapped();

  if (!bootstrapped) {
    // Show the passphrase/bootstrap UI. The Worker is NOT spawned yet —
    // it would race against the bootstrap UI for the sqlocal OPFS lock.
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <BootstrapApp />
      </React.StrictMode>,
    );
    return;
  }

  // Step 3: Spawn the Worker (opens OPFS, builds router).
  await spawnInPageWorker();

  // Step 4: Mount the application.
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot().catch((e) => {
  console.error("[minimal] boot failed:", e);
  document.body.innerHTML = `<p style="color:red;padding:2rem">Boot failed: ${String(e)}</p>`;
});
