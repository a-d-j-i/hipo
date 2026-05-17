// Browser Argon2id implementation. hash-wasm with `outputType: "encoded"`
// produces the standard PHC string `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`
// — same format @node-rs/argon2 emits on the Deno side, so hashes are
// cross-compatible: a password set in the Tauri/Deno shape verifies on
// the browser shape, and vice versa.

import { argon2id, argon2Verify } from "hash-wasm";
import { badRequest } from "@hipo/server";

// Tuned in Spike 4: ~190 ms on commodity hardware. Within budget.
const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MiB
  hashLength: 32,
} as const;

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function hashPassword(password: string): Promise<string> {
  return await argon2id({
    password,
    salt: randomSalt(),
    ...PARAMS,
    outputType: "encoded",
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<void> {
  const ok = await argon2Verify({ password, hash: storedHash }).catch(
    () => false,
  );
  if (!ok) throw badRequest("wrong username or password");
}
