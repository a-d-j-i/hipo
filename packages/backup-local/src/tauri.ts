// Tauri-webview BackupTarget backed by the host filesystem via
// @tauri-apps/plugin-fs. Reads and writes a fixed path; the app picks
// the path (probably via @tauri-apps/plugin-dialog on first run, then
// stores it in localStorage or its own settings table).
//
// We accept the plugin-fs surface as a parameter rather than dynamic-
// importing it, so:
//   1. @hipo/backup-local doesn't take @tauri-apps/* as runtime deps —
//      non-Tauri consumers don't pay the bundle cost or carry the
//      capability requirement.
//   2. Tests inject a trivial mock; no plugin scaffolding needed.
//   3. The consumer's existing Tauri capabilities config governs which
//      paths the underlying plugin will let it touch.

import type { BackupTarget } from "@hipo/backup";

/**
 * The subset of `@tauri-apps/plugin-fs` we use. Matches its function
 * signatures so `import * as fs from "@tauri-apps/plugin-fs"` passes
 * straight in.
 */
export type TauriFsApi = {
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
};

export type TauriTargetOptions = {
  /** Filesystem path to read/write. */
  path: string;
  /** Plugin-fs surface; from `import * as fs from "@tauri-apps/plugin-fs"`. */
  fs: TauriFsApi;
  /** Display name override. */
  displayName?: string;
};

export type TauriTarget = BackupTarget & {
  isAvailable(): boolean;
};

/** True if running inside a Tauri webview (the global is injected by Tauri). */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== undefined ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined
  );
}

export function tauriTarget(opts: TauriTargetOptions): TauriTarget {
  return {
    id: "tauri-fs",
    displayName: opts.displayName ?? `Local file (${opts.path})`,
    isAvailable: isTauri,

    async put(blob: Uint8Array): Promise<{ at: number }> {
      await opts.fs.writeFile(opts.path, blob);
      return { at: Math.floor(Date.now() / 1000) };
    },

    async get(): Promise<Uint8Array | null> {
      if (!(await opts.fs.exists(opts.path))) return null;
      return await opts.fs.readFile(opts.path);
    },
  };
}
