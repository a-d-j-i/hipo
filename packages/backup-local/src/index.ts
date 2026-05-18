// Barrel: re-exports every backup-local variant + helpers. Apps that
// only want one variant can import directly from the subpath
// (`@hipo/backup-local/download` etc.) to keep the bundler from
// pulling in the other variants' code.

export {
  downloadTarget,
  readBackupFromFile,
  type DownloadTarget,
  type DownloadTargetOptions,
} from "./download.ts";
export {
  fsAccessTarget,
  type FsAccessTarget,
  type FsAccessTargetOptions,
} from "./fs-access.ts";
export {
  isTauri,
  tauriTarget,
  type TauriFsApi,
  type TauriTarget,
  type TauriTargetOptions,
} from "./tauri.ts";
