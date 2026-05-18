// Detects whether the in-page backend's bootstrap flow has already
// been completed on this device. The marker is a tiny file written
// to the OPFS root *outside* sqlocal's storage pool, so its presence
// is independent of any specific DB engine layout.
//
// Why a marker file rather than sniffing the DB file or sqlocal pool:
//   - sqlocal uses the `opfs-sahpool` VFS, which manages a private
//     pool directory with internally-mapped filenames. There's no
//     reliable "does hipo.sqlite3 exist?" query against OPFS.
//   - Opening a SQLocal client would *create* the DB on disk as a
//     side effect of the check, which conflates "fresh OPFS" with
//     "OPFS that we just initialised by checking."
//   - A plain text marker file at the OPFS root has none of those
//     issues. It only ever flips from absent → present on bootstrap.

const MARKER_FILENAME = "hipo-bootstrap-v1";

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
    // NotFoundError when the marker is absent; any other error
    // (security, quota) we treat the same — fall through to bootstrap.
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

/**
 * Remove the marker. Used by the restore flow to force a fresh bootstrap
 * on next load, and by tests / dev tools that want to reset state.
 */
export async function clearOpfsBootstrap(): Promise<void> {
  if (!opfsAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(MARKER_FILENAME);
  } catch {
    // Marker already absent — nothing to do.
  }
}
