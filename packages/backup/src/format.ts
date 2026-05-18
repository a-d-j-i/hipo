// Engine-agnostic backup-format interface. Concrete implementations
// live in the substrate package they describe — `@hipo/sqlite` ships
// the SQLite binary format; a hypothetical future `@hipo/pglite`
// or `@hipo/dexie` would ship its own. The encrypt/compress/target
// machinery in @hipo/backup never knows which substrate it's wrapping.
//
// The factory pattern (`name` + closures over the substrate handle)
// matches the plan: a `BackupFormat` is bound to a specific store
// instance, so `encode()` is a no-arg call that returns the
// snapshot bytes.

export interface BackupFormat {
  /** Stable identifier recorded in the envelope. Used to dispatch decoders. */
  readonly name: string;
  /** Snapshot the substrate to a single Uint8Array. */
  encode(): Promise<Uint8Array>;
  /** Apply the snapshot bytes back into the substrate. */
  decode(bytes: Uint8Array): Promise<void>;
}
