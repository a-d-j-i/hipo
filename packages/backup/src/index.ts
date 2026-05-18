// Public surface of @hipo/backup. See README.md.

export { deriveKey, freshIv, freshSalt } from "./key.ts";
export { decryptBlob, encryptBlob } from "./encrypt.ts";
export type { EncryptBlobInput } from "./encrypt.ts";
export { compress, decompress } from "./compress.ts";
export {
  ENVELOPE_VERSION,
  packEnvelope,
  unpackEnvelope,
  type Envelope,
} from "./envelope.ts";
export type { BackupFormat } from "./format.ts";
export type { BackupTarget } from "./target.ts";
export {
  exportDb,
  gzipped,
  importDb,
  type ExportDbInput,
  type ImportDbInput,
} from "./do-backup.ts";
