// getConfiguredTargets returns the live BackupTarget instances for
// every wired-up target on this device. JSDOM doesn't ship
// `showDirectoryPicker` or a usable IndexedDB so we stub the
// fs-access target's `isConfigured` / `isAvailable` and exercise the
// branch logic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveKey } from "@hipo/backup";
import { getConfiguredTargets } from "./targets-registry";
import { saveGithubConfig, clearGithubConfig } from "./github-config";
import { setSecret, getOrCreateVaultSalt } from "./secrets-vault";

vi.mock("@hipo/backup-local/fs-access", () => ({
  fsAccessTarget: vi.fn(() => ({
    id: "fs-access",
    displayName: "Local folder",
    isAvailable: () => true,
    isConfigured: async () => true,
    async put() {
      return { at: 1 };
    },
    async get() {
      return null;
    },
    async pickDirectory() {},
    async forget() {},
  })),
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("getConfiguredTargets", () => {
  it("returns fs-access when isConfigured=true, no github when missing", async () => {
    const targets = await getConfiguredTargets(null);
    expect(targets.map((t) => t.target.id)).toEqual(["fs-access"]);
    expect(targets[0].cadenceEligible).toBe(true);
  });

  it("skips github when config exists but no key provided", async () => {
    saveGithubConfig({ owner: "o", repo: "r", path: "p.bin" });
    const targets = await getConfiguredTargets(null);
    expect(targets.map((t) => t.target.id)).toEqual(["fs-access"]);
  });

  it("skips github when key provided but no PAT stored", async () => {
    saveGithubConfig({ owner: "o", repo: "r", path: "p.bin" });
    const salt = getOrCreateVaultSalt();
    const key = await deriveKey("p", salt);
    const targets = await getConfiguredTargets(key);
    expect(targets.map((t) => t.target.id)).toEqual(["fs-access"]);
  });

  it("includes github when config + PAT are both present and key decrypts", async () => {
    saveGithubConfig({ owner: "o", repo: "r", path: "p.bin" });
    const salt = getOrCreateVaultSalt();
    const key = await deriveKey("p", salt);
    await setSecret("github.pat", "ghp_token", key);
    const targets = await getConfiguredTargets(key);
    expect(targets.map((t) => t.target.id).sort()).toEqual([
      "fs-access",
      "github",
    ]);
  });

  it("excludes github silently when the key can't decrypt the PAT", async () => {
    saveGithubConfig({ owner: "o", repo: "r", path: "p.bin" });
    const salt = getOrCreateVaultSalt();
    const writeKey = await deriveKey("right", salt);
    const wrongKey = await deriveKey("wrong", salt);
    await setSecret("github.pat", "ghp_token", writeKey);
    const targets = await getConfiguredTargets(wrongKey);
    expect(targets.map((t) => t.target.id)).toEqual(["fs-access"]);
  });

  it("clearGithubConfig removes the entry", () => {
    saveGithubConfig({ owner: "o", repo: "r", path: "p.bin" });
    clearGithubConfig();
    expect(localStorage.getItem("hipo.backup.github.config")).toBeNull();
  });
});
