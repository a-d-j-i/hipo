// JSDOM-level tests for the universal download target.
//
// JSDOM doesn't actually open a save dialog when `a.click()` is called
// on a download anchor — that's fine; we assert it composed the anchor
// correctly and revoked the blob URL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTarget, readBackupFromFile } from "@hipo/backup-local";

// JSDOM 29 doesn't ship URL.createObjectURL by default — install stubs
// for the duration of these tests so isAvailable() and put() can run.
type UrlBlobApi = {
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
};

let urlBackup: { create?: unknown; revoke?: unknown };

beforeEach(() => {
  const u = URL as unknown as UrlBlobApi;
  urlBackup = {
    create: (URL as unknown as { createObjectURL?: unknown }).createObjectURL,
    revoke: (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL,
  };
  u.createObjectURL = () => "blob:test/abc";
  u.revokeObjectURL = () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const u = URL as unknown as Record<string, unknown>;
  if (urlBackup.create === undefined) delete u.createObjectURL;
  else u.createObjectURL = urlBackup.create;
  if (urlBackup.revoke === undefined) delete u.revokeObjectURL;
  else u.revokeObjectURL = urlBackup.revoke;
});

describe("downloadTarget", () => {
  it("is available when URL.createObjectURL is wired", () => {
    expect(downloadTarget().isAvailable()).toBe(true);
  });

  it("put() creates a blob URL, clicks an anchor with the right filename, and schedules revoke", async () => {
    vi.useFakeTimers();
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test/abc");
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    let clickedAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag) as HTMLElement;
      if (tag === "a") {
        // Intercept click so the test can inspect the configured anchor.
        const a = el as HTMLAnchorElement;
        a.click = () => {
          clickedAnchor = a;
        };
      }
      return el as HTMLElement;
    });

    const target = downloadTarget({ filename: "my-backup.bin" });
    const blob = new Uint8Array([1, 2, 3, 4]);
    const result = await target.put(blob);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickedAnchor).not.toBeNull();
    expect(clickedAnchor!.download).toBe("my-backup.bin");
    expect(clickedAnchor!.href).toContain("blob:test/abc");
    // Anchor should have been removed after click.
    expect(clickedAnchor!.parentNode).toBeNull();
    expect(typeof result.at).toBe("number");

    // Revoke runs on a 1s timeout — advance the clock.
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeSpy).toHaveBeenCalledWith("blob:test/abc");
  });

  it("downloadTarget exposes no get() — restore goes through readBackupFromFile", () => {
    const target = downloadTarget();
    expect((target as { get?: unknown }).get).toBeUndefined();
  });

  it("readBackupFromFile returns the file bytes", async () => {
    const f = new File([new Uint8Array([10, 20, 30])], "backup.bin");
    const bytes = await readBackupFromFile(f);
    expect(Array.from(bytes)).toEqual([10, 20, 30]);
  });
});
