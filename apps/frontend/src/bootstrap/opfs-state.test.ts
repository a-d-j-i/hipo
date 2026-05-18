// Vitest coverage for the OPFS bootstrap marker helpers. JSDOM
// doesn't ship navigator.storage.getDirectory(), so we stub it with
// an in-memory FileSystemDirectoryHandle-shaped object that mirrors
// just enough of the spec for these helpers to round-trip.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOpfsBootstrap,
  isOpfsBootstrapped,
  markOpfsBootstrapped,
} from "./opfs-state";

type FileEntry = { name: string; bytes: Uint8Array };

function makeFakeOpfs() {
  const files = new Map<string, FileEntry>();

  const root = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const existing = files.get(name);
      if (existing) return makeHandle(name);
      if (opts?.create) {
        files.set(name, { name, bytes: new Uint8Array(0) });
        return makeHandle(name);
      }
      const e = new Error("NotFoundError");
      e.name = "NotFoundError";
      throw e;
    },
    async removeEntry(name: string) {
      if (!files.has(name)) {
        const e = new Error("NotFoundError");
        e.name = "NotFoundError";
        throw e;
      }
      files.delete(name);
    },
  };

  function makeHandle(name: string) {
    return {
      name,
      async createWritable() {
        return {
          async write(data: Uint8Array | ArrayBuffer | string) {
            let bytes: Uint8Array;
            if (typeof data === "string") {
              bytes = new TextEncoder().encode(data);
            } else if (data instanceof Uint8Array) {
              bytes = data;
            } else {
              bytes = new Uint8Array(data);
            }
            files.set(name, { name, bytes });
          },
          async close() {},
        };
      },
    };
  }

  return { files, root };
}

describe("opfs-state", () => {
  let fake: ReturnType<typeof makeFakeOpfs>;

  beforeEach(() => {
    fake = makeFakeOpfs();
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => fake.root,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports false when the marker is absent", async () => {
    expect(await isOpfsBootstrapped()).toBe(false);
  });

  it("writes the marker and reports true after marking", async () => {
    await markOpfsBootstrapped();
    expect(await isOpfsBootstrapped()).toBe(true);
    expect(fake.files.has("hipo-bootstrap-v1")).toBe(true);
  });

  it("clear removes the marker", async () => {
    await markOpfsBootstrapped();
    expect(await isOpfsBootstrapped()).toBe(true);
    await clearOpfsBootstrap();
    expect(await isOpfsBootstrapped()).toBe(false);
  });

  it("isOpfsBootstrapped returns false when navigator.storage is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    expect(await isOpfsBootstrapped()).toBe(false);
  });

  it("clear is a no-op when navigator.storage is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(clearOpfsBootstrap()).resolves.toBeUndefined();
  });
});
