// Tauri target tests: inject a mock plugin-fs surface so we don't
// need a Tauri runtime. JSDOM doesn't set window.__TAURI__, so the
// `isAvailable()` test is the negative path; the positive path is
// covered by manually stamping the global for one test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isTauri, tauriTarget, type TauriFsApi } from "@hipo/backup-local";

function makeFakeFs(): {
  fs: TauriFsApi;
  state: { [path: string]: Uint8Array };
} {
  const state: { [path: string]: Uint8Array } = {};
  return {
    state,
    fs: {
      async writeFile(path, contents) {
        state[path] = contents;
      },
      async readFile(path) {
        if (!(path in state)) throw new Error("not found");
        return state[path];
      },
      async exists(path) {
        return path in state;
      },
    },
  };
}

afterEach(() => {
  // Cleanup any __TAURI__ marker test set.
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
});

describe("tauriTarget", () => {
  it("isTauri() returns false outside a Tauri webview", () => {
    expect(isTauri()).toBe(false);
  });

  it("isTauri() returns true when __TAURI_INTERNALS__ is set", () => {
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });

  it("put writes bytes via the injected fs API", async () => {
    const { fs, state } = makeFakeFs();
    const target = tauriTarget({ path: "/tmp/x.bin", fs });
    const blob = new Uint8Array([7, 8, 9]);
    const res = await target.put(blob);
    expect(state["/tmp/x.bin"]).toEqual(blob);
    expect(typeof res.at).toBe("number");
  });

  it("get returns null when the file does not exist", async () => {
    const { fs } = makeFakeFs();
    const target = tauriTarget({ path: "/tmp/none.bin", fs });
    expect(await target.get!()).toBeNull();
  });

  it("get returns the stored bytes after put", async () => {
    const { fs } = makeFakeFs();
    const target = tauriTarget({ path: "/tmp/rt.bin", fs });
    const blob = new Uint8Array([42, 43, 44]);
    await target.put(blob);
    const back = await target.get!();
    expect(Array.from(back!)).toEqual([42, 43, 44]);
  });

  it("writeFile is invoked with the configured path and exact bytes", async () => {
    const writeFile = vi.fn(async () => {});
    const fs: TauriFsApi = {
      writeFile,
      readFile: vi.fn(async () => new Uint8Array()),
      exists: vi.fn(async () => false),
    };
    const target = tauriTarget({ path: "/special/path.bin", fs });
    const blob = new Uint8Array([1, 2, 3]);
    await target.put(blob);
    expect(writeFile).toHaveBeenCalledWith("/special/path.bin", blob);
  });
});
