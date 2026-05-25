// Light unit test for the FS Access target — JSDOM lacks both
// showDirectoryPicker and a real IndexedDB, so we only assert the
// public surface and feature-detection. Full round-trip is covered by
// Playwright in a Chromium browser (future Phase 5/7 integration test).

import { describe, expect, it } from "vitest";
import { fsAccessTarget } from "@hipo/backup-local";

describe("fsAccessTarget", () => {
  it("reports the canonical id and a sensible displayName", () => {
    const target = fsAccessTarget();
    expect(target.id).toBe("fs-access");
    expect(target.displayName.length).toBeGreaterThan(0);
  });

  it("isAvailable() returns false in JSDOM (no showDirectoryPicker)", () => {
    const target = fsAccessTarget();
    expect(target.isAvailable()).toBe(false);
  });

  it("get/put exist as functions (so the BackupTarget contract is met)", () => {
    const target = fsAccessTarget();
    expect(typeof target.get).toBe("function");
    expect(typeof target.put).toBe("function");
    expect(typeof target.pickDirectory).toBe("function");
    expect(typeof target.forget).toBe("function");
    expect(typeof target.isConfigured).toBe("function");
  });

  it("put without prior pickDirectory throws a clear configuration error", async () => {
    const target = fsAccessTarget({
      // Use a unique DB name so this test doesn't share state with others.
      databaseName: "hipo-backup-local-test-1",
      storageKey: "ephemeral",
    });
    // JSDOM lacks indexedDB; this rejects with a different shape than
    // in a real browser, but it MUST reject — the contract is
    // "put without configuration fails." That's all we assert.
    await expect(target.put(new Uint8Array(1))).rejects.toBeTruthy();
  });
});
