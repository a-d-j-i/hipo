# @hipo/backup

Encrypted backup primitives. Engine-agnostic: the pipeline (compress → encrypt →
envelope) doesn't care whether the bytes came from SQLite, PGLite, or a Dexie
store. Concrete `BackupFormat` implementations live in the substrate packages
they describe (`@hipo/sqlite` ships the SQLite binary format).

## Pipeline

```
format.encode()    → Uint8Array (consistent snapshot of the substrate)
   ↓
compress("gzip")   → smaller bytes (skip when format is already compressed)
   ↓
seal(AES-GCM)      → { envelope_version, salt, iv, format, ct }
   ↓
target.write(env)  → external storage (a separate `@hipo/backup-*` package)
```

Restore reverses the chain. Order matters: encrypted ciphertext won't compress,
so compress _before_ encrypting.

## Public surface

```ts
import {
  deriveKey,
  freshSalt,
  freshIv,
  seal,
  open,
  compress,
  decompress,
  packEnvelope,
  unpackEnvelope,
  exportDb,
  importDb,
  ENVELOPE_VERSION,
  type Envelope,
  type BackupFormat,
} from "@hipo/backup";
```

## Versioning

The envelope is the framework's most durable artifact — backups made today may
be restored years later, after many framework upgrades.

- `envelope_version` (integer): structural version of the envelope itself.
  Decoders reject unknown values. Bumped only when the envelope shape changes
  (new required field, primitive swap).
- `format` (string): inner-byte encoding, e.g. `"binary-gzip"`. New formats
  coexist by getting new names. Decoders dispatch by `format`.

Restore policy: within a major framework version, every backup is restorable.
Across majors, ship a migrator. **Never break a published backup.**

## What this package does not own

- **Targets** — `<a download>`, FS Access API, GitHub Contents API, vault
  clients. Those ship as `@hipo/backup-*` siblings, each implementing the
  `BackupTarget` interface.
- **Substrate-specific encoders** — SQLite's `VACUUM INTO` lives in
  `@hipo/sqlite`. Future PGLite / Dexie packages would ship their own.
- **UI** — bootstrap screens and the status panel are app concerns (or future
  `@hipo/bootstrap`).
