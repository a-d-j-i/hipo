// @hipo/backup primitives + @hipo/sqlite binary format round-trip
// tests. Runs against real libsql via temp files — :memory: can't
// VACUUM INTO a filesystem path, and tests need to read those bytes
// back to validate the snapshot.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import {
  compress,
  decompress,
  decryptBlob,
  deriveKey,
  encryptBlob,
  ENVELOPE_VERSION,
  type Envelope,
  exportDb,
  freshSalt,
  gzipped,
  importDb,
  packEnvelope,
  unpackEnvelope,
} from "@hipo/backup";
import { runMigrations, type Migration } from "@hipo/sqlite";
import { binaryFormat } from "@hipo/sqlite/binary-format-deno";

const PASSPHRASE = "correct horse battery staple";

// ---------------------------------------------------------------------------
// Envelope pack/unpack
// ---------------------------------------------------------------------------

Deno.test("envelope: pack/unpack round-trip", () => {
  const env: Envelope = {
    envelope_version: ENVELOPE_VERSION,
    format: "binary-gzip",
    salt: new Uint8Array(16).map((_, i) => i),
    iv: new Uint8Array(12).map((_, i) => i + 100),
    ct: new Uint8Array(257).map((_, i) => i % 256),
  };
  const packed = packEnvelope(env);
  const back = unpackEnvelope(packed);
  assertEquals(back.envelope_version, env.envelope_version);
  assertEquals(back.format, env.format);
  assertEquals(Array.from(back.salt), Array.from(env.salt));
  assertEquals(Array.from(back.iv), Array.from(env.iv));
  assertEquals(Array.from(back.ct), Array.from(env.ct));
});

Deno.test("envelope: bad magic rejected", () => {
  const bad = new Uint8Array(64);
  bad.set([0x42, 0x41, 0x44, 0x21]);
  assertRejects(async () => unpackEnvelope(bad), Error, "bad magic");
});

Deno.test("envelope: truncated ciphertext rejected", () => {
  const env: Envelope = {
    envelope_version: ENVELOPE_VERSION,
    format: "binary",
    salt: new Uint8Array(16),
    iv: new Uint8Array(12),
    ct: new Uint8Array(100).fill(7),
  };
  const packed = packEnvelope(env);
  const truncated = packed.slice(0, packed.length - 1);
  assertRejects(
    async () => unpackEnvelope(truncated),
    Error,
    "truncated ciphertext",
  );
});

// ---------------------------------------------------------------------------
// gzip
// ---------------------------------------------------------------------------

Deno.test("compress/decompress: round-trip equal bytes", async () => {
  const data = new TextEncoder().encode("hello world ".repeat(500));
  const z = await compress(data);
  assert(z.length < data.length, "gzip should shrink repetitive text");
  const back = await decompress(z);
  assertEquals(back.length, data.length);
  assertEquals(new TextDecoder().decode(back), new TextDecoder().decode(data));
});

// ---------------------------------------------------------------------------
// AES-GCM + Argon2id
// ---------------------------------------------------------------------------

Deno.test("encrypt/decrypt: round-trip equal bytes", async () => {
  const salt = freshSalt();
  const key = await deriveKey(PASSPHRASE, salt);
  const plaintext = new TextEncoder().encode("the quick brown fox");
  const env = await encryptBlob({
    bytes: plaintext,
    key,
    salt,
    format: "test",
  });
  assertEquals(env.envelope_version, ENVELOPE_VERSION);
  assertEquals(env.format, "test");
  assertEquals(env.iv.length, 12);
  assertEquals(env.salt.length, 16);

  const out = await decryptBlob(env, key);
  assertEquals(out.format, "test");
  assertEquals(new TextDecoder().decode(out.bytes), "the quick brown fox");
});

Deno.test("decrypt: wrong passphrase fails (GCM auth tag)", async () => {
  const salt = freshSalt();
  const k1 = await deriveKey("right-password", salt);
  const k2 = await deriveKey("wrong-password", salt);
  const env = await encryptBlob({
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    key: k1,
    salt,
    format: "test",
  });
  await assertRejects(() => decryptBlob(env, k2));
});

Deno.test("decrypt: tampered ciphertext fails (GCM auth tag)", async () => {
  const salt = freshSalt();
  const key = await deriveKey(PASSPHRASE, salt);
  const env = await encryptBlob({
    bytes: new TextEncoder().encode("important secret"),
    key,
    salt,
    format: "test",
  });
  // Flip one bit in the ciphertext.
  env.ct[0] ^= 0x01;
  await assertRejects(() => decryptBlob(env, key));
});

Deno.test("decrypt: unknown envelope_version rejected", async () => {
  const salt = freshSalt();
  const key = await deriveKey(PASSPHRASE, salt);
  const env = await encryptBlob({
    bytes: new Uint8Array([9]),
    key,
    salt,
    format: "test",
  });
  env.envelope_version = 999;
  await assertRejects(() => decryptBlob(env, key), Error, "envelope_version");
});

// ---------------------------------------------------------------------------
// BinaryFormat + exportDb/importDb round-trip
// ---------------------------------------------------------------------------

type SetupResult = {
  client: ReturnType<typeof createClient>;
  path: string;
};

async function freshDb(migrations: Migration[]): Promise<SetupResult> {
  const path = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${path}` });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client);
  await runMigrations(db, migrations);
  return { client, path };
}

async function cleanup(s: SetupResult): Promise<void> {
  try {
    s.client.close();
  } catch {
    /* already closed */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    await Deno.remove(s.path + suffix).catch(() => {});
  }
}

const v1: Migration = {
  version: 1,
  sql: `
    CREATE TABLE widgets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `,
};

const v2: Migration = {
  version: 2,
  sql: `ALTER TABLE widgets ADD COLUMN color TEXT;`,
};

Deno.test(
  "binaryFormat: exportDb → importDb round-trip preserves rows",
  async () => {
    const src = await freshDb([v1]);
    try {
      const db = drizzle(src.client);
      await db.run(
        sql.raw(`INSERT INTO widgets (id, name) VALUES (1, 'alpha')`),
      );
      await db.run(
        sql.raw(`INSERT INTO widgets (id, name) VALUES (2, 'beta')`),
      );

      const salt = freshSalt();
      const key = await deriveKey(PASSPHRASE, salt);
      const fmt = gzipped(
        binaryFormat({ client: src.client, dbPath: src.path }),
      );
      const env = await exportDb({ format: fmt, key, salt });

      // Format should be "binary-gzip" (binary wrapped by gzipped()).
      assertEquals(env.format, "binary-gzip");

      // Trash the DB rows before restore to prove the restore actually
      // wrote the file (and not just that the original survived).
      await db.run(sql.raw(`DELETE FROM widgets`));
      const empty = await db.run(sql.raw(`SELECT COUNT(*) FROM widgets`));
      void empty;

      // Restore via importDb. Format closes the client and writes bytes.
      await importDb({ envelope: env, format: fmt, key });

      // Reopen and check rows are back.
      const c2 = createClient({ url: `file:${src.path}` });
      const db2 = drizzle(c2);
      const rows = await db2.all<{ id: number; name: string }>(
        sql.raw(`SELECT id, name FROM widgets ORDER BY id`),
      );
      assertEquals(rows.length, 2);
      assertEquals(rows[0].name, "alpha");
      assertEquals(rows[1].name, "beta");
      c2.close();
    } finally {
      await cleanup(src);
    }
  },
);

Deno.test(
  "binaryFormat: through pack/unpack envelope (durable wire form)",
  async () => {
    const src = await freshDb([v1]);
    try {
      const db = drizzle(src.client);
      await db.run(sql.raw(`INSERT INTO widgets (id, name) VALUES (42, 'x')`));

      const salt = freshSalt();
      const key = await deriveKey(PASSPHRASE, salt);
      const fmt = gzipped(
        binaryFormat({ client: src.client, dbPath: src.path }),
      );
      const env = await exportDb({ format: fmt, key, salt });

      // Round-trip through the durable byte form.
      const packed = packEnvelope(env);
      const unpacked = unpackEnvelope(packed);

      await importDb({ envelope: unpacked, format: fmt, key });

      const c2 = createClient({ url: `file:${src.path}` });
      const rows = await drizzle(c2).all<{ id: number; name: string }>(
        sql.raw(`SELECT id, name FROM widgets`),
      );
      assertEquals(rows.length, 1);
      assertEquals(rows[0].id, 42);
      c2.close();
    } finally {
      await cleanup(src);
    }
  },
);

Deno.test("binaryFormat: format mismatch on import is rejected", async () => {
  const src = await freshDb([v1]);
  try {
    const salt = freshSalt();
    const key = await deriveKey(PASSPHRASE, salt);
    const fmt = binaryFormat({ client: src.client, dbPath: src.path });
    const env = await exportDb({ format: fmt, key, salt }); // format "binary"

    // Try to import with a gzipped wrapper expecting "binary-gzip".
    const wrong = gzipped(
      binaryFormat({ client: src.client, dbPath: src.path }),
    );
    await assertRejects(
      () => importDb({ envelope: env, format: wrong, key }),
      Error,
      "format mismatch",
    );
  } finally {
    await cleanup(src);
  }
});

Deno.test(
  "cross-schema restore: v1 backup opens on v2 app + applies forward migration",
  async () => {
    // Create a v1 DB, insert rows, take a backup.
    const src = await freshDb([v1]);
    try {
      const db = drizzle(src.client);
      await db.run(sql.raw(`INSERT INTO widgets (id, name) VALUES (1, 'old')`));

      const salt = freshSalt();
      const key = await deriveKey(PASSPHRASE, salt);
      const fmt = gzipped(
        binaryFormat({ client: src.client, dbPath: src.path }),
      );
      const env = await exportDb({ format: fmt, key, salt });

      // Restore over the same file (closes client + writes bytes).
      await importDb({ envelope: env, format: fmt, key });

      // Reopen as a "v2 app" — runMigrations should detect v1 already
      // applied and apply v2 forward.
      const c2 = createClient({ url: `file:${src.path}` });
      await c2.execute("PRAGMA foreign_keys = ON");
      const db2 = drizzle(c2);
      await runMigrations(db2, [v1, v2]);

      // Pre-existing row preserved.
      const rows = await db2.all<{
        id: number;
        name: string;
        color: string | null;
      }>(sql.raw(`SELECT id, name, color FROM widgets`));
      assertEquals(rows.length, 1);
      assertEquals(rows[0].name, "old");
      assertEquals(rows[0].color, null); // v2 added the column with NULL default.

      // v2 column is writable.
      await db2.run(sql.raw(`UPDATE widgets SET color = 'red' WHERE id = 1`));
      const after = await db2.all<{ color: string }>(
        sql.raw(`SELECT color FROM widgets WHERE id = 1`),
      );
      assertEquals(after[0].color, "red");
      c2.close();
    } finally {
      await cleanup(src);
    }
  },
);
