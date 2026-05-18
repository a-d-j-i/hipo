// Persistent-folder BackupTarget via the File System Access API
// (Chromium/Edge; not Firefox/Safari yet — Phase 0 plan accepts this).
//
// Flow:
//   1. App calls `pickDirectory()` inside a user gesture (a button
//      click). The browser shows the OS folder picker; the user grants
//      readwrite access. The resulting handle persists in IndexedDB.
//   2. On subsequent visits, `put`/`get` re-query the stored handle.
//      If the permission state is `"prompt"` (browser dropped the
//      grant), `requestPermission()` must run inside a user gesture
//      again. Targets surface that as an error so the UI can offer
//      a "reconnect folder" button.

import type { BackupTarget } from "@hipo/backup";

// ---------- minimal FS Access API types (the DOM lib has these in 2026 but
// `showDirectoryPicker` itself is still gated; declare what we use). ----------

type PermissionDescriptor = { mode?: "read" | "readwrite" };
type PermissionState = "granted" | "denied" | "prompt";

interface FsDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FsFileHandle>;
  queryPermission?(desc: PermissionDescriptor): Promise<PermissionState>;
  requestPermission?(desc: PermissionDescriptor): Promise<PermissionState>;
}

interface FsFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritableStream>;
}

interface FsWritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

type ShowDirectoryPicker = (opts?: {
  mode?: "read" | "readwrite";
  id?: string;
}) => Promise<FsDirectoryHandle>;

function getPicker(): ShowDirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { showDirectoryPicker?: ShowDirectoryPicker };
  return w.showDirectoryPicker ?? null;
}

// ---------- IndexedDB helpers (no external dep). ----------

const DEFAULT_DB = "hipo-backup-local";
const STORE = "handles";

function openIdb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(
  dbName: string,
  key: string,
  value: FsDirectoryHandle,
): Promise<void> {
  const db = await openIdb(dbName);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbGet(
  dbName: string,
  key: string,
): Promise<FsDirectoryHandle | null> {
  const db = await openIdb(dbName);
  try {
    return await new Promise<FsDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as FsDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// ---------- public surface ----------

export type FsAccessTargetOptions = {
  /** Filename inside the chosen directory. Default: `backup.bin`. */
  filename?: string;
  /** IndexedDB key for the handle. Lets multiple apps coexist. */
  storageKey?: string;
  /** IndexedDB database name. Default: `hipo-backup-local`. */
  databaseName?: string;
  /** Display name override. */
  displayName?: string;
};

export type FsAccessTarget = BackupTarget & {
  /** Feature-detect at runtime — false on Firefox/Safari. */
  isAvailable(): boolean;
  /** True if a directory handle is currently stored. */
  isConfigured(): Promise<boolean>;
  /**
   * Prompt the user to pick a folder. MUST be called inside a user
   * gesture (button click handler). Stores the handle for later use.
   */
  pickDirectory(): Promise<void>;
  /** Forget the stored handle (UI: "disconnect folder"). */
  forget(): Promise<void>;
};

export function fsAccessTarget(
  opts: FsAccessTargetOptions = {},
): FsAccessTarget {
  const filename = opts.filename ?? "backup.bin";
  const dbName = opts.databaseName ?? DEFAULT_DB;
  const key = opts.storageKey ?? "default";

  async function getReadyHandle(): Promise<FsDirectoryHandle> {
    const handle = await idbGet(dbName, key);
    if (!handle) {
      throw new Error(
        "fs-access target: no directory configured; call pickDirectory() first",
      );
    }
    if (typeof handle.queryPermission === "function") {
      const state = await handle.queryPermission({ mode: "readwrite" });
      if (state === "granted") return handle;
      if (
        state === "prompt" &&
        typeof handle.requestPermission === "function"
      ) {
        const granted = await handle.requestPermission({ mode: "readwrite" });
        if (granted === "granted") return handle;
      }
      throw new Error(
        "fs-access target: folder permission not granted; reconnect via pickDirectory()",
      );
    }
    return handle;
  }

  return {
    id: "fs-access",
    displayName: opts.displayName ?? "Local folder (persistent)",

    isAvailable(): boolean {
      return getPicker() !== null && typeof indexedDB !== "undefined";
    },

    async isConfigured(): Promise<boolean> {
      return (await idbGet(dbName, key)) !== null;
    },

    async pickDirectory(): Promise<void> {
      const picker = getPicker();
      if (!picker) {
        throw new Error("fs-access target: showDirectoryPicker unavailable");
      }
      const handle = await picker({ mode: "readwrite", id: "hipo-backup" });
      await idbPut(dbName, key, handle);
    },

    async forget(): Promise<void> {
      const db = await openIdb(dbName);
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },

    async put(blob: Uint8Array): Promise<{ at: number }> {
      const dir = await getReadyHandle();
      const file = await dir.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(blob as BufferSource);
      } finally {
        await writable.close();
      }
      return { at: Math.floor(Date.now() / 1000) };
    },

    async get(): Promise<Uint8Array | null> {
      const dir = await getReadyHandle();
      let fh: FsFileHandle;
      try {
        fh = await dir.getFileHandle(filename, { create: false });
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotFoundError")
          return null;
        throw e;
      }
      const f = await fh.getFile();
      return new Uint8Array(await f.arrayBuffer());
    },
  };
}
