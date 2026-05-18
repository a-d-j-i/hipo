// Detects whether the in-page backend's bootstrap flow has already been
// completed on this device. The marker is a tiny file written to the OPFS
// root *outside* sqlocal's storage pool; its presence is independent of any
// specific DB engine layout.
//
// Mirror of apps/frontend/src/bootstrap/opfs-state.ts — uses the
// "minimal-bootstrap-v1" marker so a minimal template install doesn't
// accidentally share state with a hipo install on the same origin.

const MARKER_FILENAME = "minimal-bootstrap-v1";

function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

export async function isOpfsBootstrapped(): Promise<boolean> {
  if (!opfsAvailable()) return false;
  try {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle(MARKER_FILENAME, { create: false });
    return true;
  } catch {
    // NotFoundError when the marker is absent; any other error treated the
    // same — fall through to bootstrap.
    return false;
  }
}

/** Write the marker. Called once when bootstrap completes successfully. */
export async function markOpfsBootstrapped(): Promise<void> {
  if (!opfsAvailable()) {
    throw new Error("OPFS not available; cannot mark bootstrap complete");
  }
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(MARKER_FILENAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(
    new TextEncoder().encode(JSON.stringify({ at: Date.now() })),
  );
  await writable.close();
}

/** Remove the marker. Useful for tests / dev reset. */
export async function clearOpfsBootstrap(): Promise<void> {
  if (!opfsAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(MARKER_FILENAME);
  } catch {
    // Marker already absent — nothing to do.
  }
}
