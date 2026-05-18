// Write-only BackupTarget that hands the sealed blob to the browser's
// download manager via `<a download>`. The user picks the save
// location through the browser's native save dialog (or it goes to the
// downloads folder, depending on browser settings).
//
// No `get()`: the browser doesn't expose previously downloaded files
// back to JS. The restore flow uses `readBackupFromFile(file)` with a
// `<input type="file">` picker instead.

import type { BackupTarget } from "@hipo/backup";

export type DownloadTargetOptions = {
  /** Filename suggested in the save dialog. Default: `hipo-backup.bin`. */
  filename?: string;
  /** Display name override. Default: "Download to device". */
  displayName?: string;
};

export type DownloadTarget = BackupTarget & {
  isAvailable(): boolean;
};

export function downloadTarget(
  opts: DownloadTargetOptions = {},
): DownloadTarget {
  const filename = opts.filename ?? "hipo-backup.bin";
  return {
    id: "local-download",
    displayName: opts.displayName ?? "Download to device",

    isAvailable(): boolean {
      return (
        typeof document !== "undefined" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function"
      );
    },

    async put(blob: Uint8Array): Promise<{ at: number }> {
      const objectUrl = URL.createObjectURL(
        new Blob([blob as BlobPart], { type: "application/octet-stream" }),
      );
      try {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Defer revoke so the browser has time to start streaming the
        // download before the URL goes away. 1s is generous; downloads
        // start almost immediately.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      return { at: Math.floor(Date.now() / 1000) };
    },
  };
}

/**
 * Read the bytes of a `File` (as produced by `<input type="file">`) into
 * a `Uint8Array`. Used by the restore flow when the user picks a backup
 * file from their device.
 */
export async function readBackupFromFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
