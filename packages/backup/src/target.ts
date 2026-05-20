// External-storage contract for sealed envelopes. Concrete targets
// ship as sibling packages (`@hipo/backup-local`, `@hipo/backup-github`,
// future `@hipo/backup-vault`) so apps depend only on the targets they
// actually use.
//
// `get()` is optional: the universal `<a download>` target can write
// the blob to the user's filesystem but can't read it back, so it omits
// `get`. The restore flow uses `readBackupFromFile()` (from
// `@hipo/backup-local`) for that case instead. Auto-targets (FS Access
// handle, Tauri path, GitHub Contents, vault) implement `get` and can
// round-trip without user interaction per call.

export interface BackupTarget {
  /**
   * Stable identifier, used as the key in `/api/system/status`
   * responses. Examples: `"local-download"`, `"fs-access"`,
   * `"tauri-fs"`, `"github"`, `"vault"`.
   */
  readonly id: string;

  /** Human-readable label. UI catalogs translate. */
  readonly displayName: string;

  /**
   * Persist an envelope blob. Returns a unix-seconds timestamp from
   * the target (e.g., GitHub's commit time) or the local clock if the
   * target doesn't expose its own. Throws on failure.
   *
   * `filename` is optional — targets that have a meaningful filename
   * concept (download, fs-access) return it so the UI can surface
   * "Backup saved as <name>". Cloud/blob targets (github, vault) omit it.
   */
  put(blob: Uint8Array): Promise<{ at: number; filename?: string }>;

  /**
   * Read the most recent blob, or `null` if the target is empty. Omit
   * `get` entirely on write-only targets (the download anchor) so
   * callers can feature-detect with `if (target.get) …`.
   */
  get?(): Promise<Uint8Array | null>;
}
