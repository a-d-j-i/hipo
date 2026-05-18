# @hipo/backup-local

`BackupTarget` implementations that write encrypted envelopes to the user's own
device. Three variants:

| Target        | Available       | Persistent       | Notes                                                                                                    |
| ------------- | --------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| **download**  | Any browser     | No (manual save) | `<a download>` writer + file-picker reader. Write-only `BackupTarget` (no `get`).                        |
| **fs-access** | Chromium / Edge | Yes              | File System Access API. User picks a folder once; handle persists in IndexedDB. Read/write `backup.bin`. |
| **tauri**     | Tauri webview   | Yes              | `@tauri-apps/plugin-fs`. Read/write a configured path.                                                   |

Apps import the variants they want:

```ts
import {
  downloadTarget,
  readBackupFromFile,
} from "@hipo/backup-local/download";
import { fsAccessTarget } from "@hipo/backup-local/fs-access";
import { tauriTarget } from "@hipo/backup-local/tauri";
```

Or `import { … } from "@hipo/backup-local"` for the barrel.

## Detection

Each variant exports an `isAvailable()` that feature-detects at runtime. Use it
to gate UI:

```ts
if (fsAccessTarget.isAvailable()) {
  // offer the persistent-folder option
}
```

## What this package does not own

- Encryption / sealing — those live in `@hipo/backup`. The targets here take an
  already-sealed `Uint8Array` blob and write it.
- Cadence + verify-after-upload — Phase 7. Targets just put/get.
- UI — bootstrap and restore screens are app concerns (Phase 6).
