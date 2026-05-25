// Lightweight coverage for PassphraseContext. The real Argon2id KDF
// is exercised end-to-end in the backup_test.ts on the Deno side and
// in the actual Playwright smoke (deferred). Here we just stub
// `deriveKey` so we can assert: (1) `keyFor` proxies through to it,
// (2) repeat calls with the same salt hit the cache, (3) `clear`
// drops the cached key, (4) `keyFor` throws when no passphrase set.

import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@hipo/backup", () => {
  return {
    deriveKey: vi.fn(async (passphrase: string, salt: Uint8Array) => {
      // Return a synthetic CryptoKey-like value so we can identity-
      // compare cached results. Real type isn't asserted.
      return {
        __test: true,
        passphrase,
        saltSum: salt.reduce((a, b) => a + b, 0),
      } as unknown as CryptoKey;
    }),
  };
});

import { PassphraseProvider, usePassphrase } from "./PassphraseContext";
import { deriveKey } from "@hipo/backup";

const wrapper = ({ children }: { children: ReactNode }) => (
  <PassphraseProvider>{children}</PassphraseProvider>
);

describe("PassphraseContext", () => {
  it("keyFor throws when no passphrase is set", async () => {
    const { result } = renderHook(() => usePassphrase(), { wrapper });
    await expect(result.current.keyFor(new Uint8Array(16))).rejects.toThrow(
      /passphrase not set/,
    );
    expect(result.current.isSet).toBe(false);
  });

  it("setPassphrase flips isSet and lets keyFor succeed", async () => {
    const { result } = renderHook(() => usePassphrase(), { wrapper });
    act(() => result.current.setPassphrase("correct horse battery staple"));
    expect(result.current.isSet).toBe(true);
    const k = await result.current.keyFor(new Uint8Array([1, 2, 3]));
    expect((k as unknown as { passphrase: string }).passphrase).toBe(
      "correct horse battery staple",
    );
  });

  it("caches the derived key per salt-hex", async () => {
    const { result } = renderHook(() => usePassphrase(), { wrapper });
    const calls = vi.mocked(deriveKey).mock.calls.length;

    act(() => result.current.setPassphrase("p1"));
    const salt = new Uint8Array([9, 9, 9]);
    const k1 = await result.current.keyFor(salt);
    const k2 = await result.current.keyFor(salt);
    expect(k1).toBe(k2);
    expect(vi.mocked(deriveKey).mock.calls.length).toBe(calls + 1);

    const k3 = await result.current.keyFor(new Uint8Array([1, 1, 1]));
    expect(k3).not.toBe(k1);
    expect(vi.mocked(deriveKey).mock.calls.length).toBe(calls + 2);
  });

  it("clear drops the cache and resets isSet", async () => {
    const { result } = renderHook(() => usePassphrase(), { wrapper });
    act(() => result.current.setPassphrase("p"));
    const salt = new Uint8Array([1]);
    await result.current.keyFor(salt);
    const callsBeforeClear = vi.mocked(deriveKey).mock.calls.length;

    act(() => result.current.clear());
    expect(result.current.isSet).toBe(false);

    act(() => result.current.setPassphrase("p"));
    await result.current.keyFor(salt);
    // Cache should not survive clear — second keyFor re-derives.
    expect(vi.mocked(deriveKey).mock.calls.length).toBe(callsBeforeClear + 1);
  });
});
