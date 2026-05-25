// Round-trip + failure-mode coverage for the secrets vault. Uses a
// real AES-GCM key (via deriveKey + hash-wasm Argon2id) so the test
// exercises the actual primitives.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveKey } from "@hipo/backup";
import {
  clearSecret,
  getOrCreateVaultSalt,
  getSecret,
  hasSecret,
  setSecret,
} from "./secrets-vault";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("secrets-vault", () => {
  it("salt persists across calls", () => {
    const a = getOrCreateVaultSalt();
    const b = getOrCreateVaultSalt();
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(16);
  });

  it("round-trips a string secret with the right key", async () => {
    const salt = getOrCreateVaultSalt();
    const key = await deriveKey("right-passphrase", salt);
    await setSecret("github.pat", "ghp_TESTtoken123", key);
    expect(hasSecret("github.pat")).toBe(true);
    const back = await getSecret("github.pat", key);
    expect(back).toBe("ghp_TESTtoken123");
  });

  it("returns null when the secret is absent", async () => {
    const salt = getOrCreateVaultSalt();
    const key = await deriveKey("p", salt);
    expect(await getSecret("github.pat", key)).toBeNull();
  });

  it("wrong passphrase fails closed (AES-GCM auth tag)", async () => {
    const salt = getOrCreateVaultSalt();
    const k1 = await deriveKey("right", salt);
    const k2 = await deriveKey("wrong", salt);
    await setSecret("github.pat", "secret-value", k1);
    await expect(getSecret("github.pat", k2)).rejects.toThrow();
  });

  it("clear removes the entry but leaves the salt", async () => {
    const salt = getOrCreateVaultSalt();
    const key = await deriveKey("p", salt);
    await setSecret("github.pat", "v", key);
    clearSecret("github.pat");
    expect(hasSecret("github.pat")).toBe(false);
    expect(localStorage.getItem("hipo.vault.salt")).not.toBeNull();
  });
});
