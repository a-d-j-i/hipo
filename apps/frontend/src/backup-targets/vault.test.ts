// Vault target tests. Replace global fetch with a spy that records
// requests and returns scripted responses.

import { afterEach, describe, expect, it, vi } from "vitest";
import { vaultTarget } from "@hipo/backup-vault";

const BASE_URL = "https://vault.example.com";
const TOKEN = "vault_pat_test_token";
const BLOB_ID = "backup.bin";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vaultTarget", () => {
  it("put() sends binary body with correct URL, headers, and method", async () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ size_bytes: 4, updated_at: 1700000000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      blobId: BLOB_ID,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const result = await target.put(blob);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${BASE_URL}/api/vault/blob/${BLOB_ID}`);
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/octet-stream",
    );
    expect(init?.method).toBe("PUT");
    expect(init?.body).toEqual(blob);
    expect(result.at).toBe(1700000000);
  });

  it("put() falls back to local time if server response lacks updated_at", async () => {
    const before = Math.floor(Date.now() / 1000);
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ size_bytes: 2 }), { status: 200 }),
    );
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const result = await target.put(new Uint8Array([1, 2]));
    const after = Math.floor(Date.now() / 1000);
    expect(result.at).toBeGreaterThanOrEqual(before);
    expect(result.at).toBeLessThanOrEqual(after + 1);
  });

  it("get() returns Uint8Array on 200", async () => {
    const original = new Uint8Array([10, 20, 30]);
    const fetchSpy = vi.fn(
      async () =>
        new Response(original, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const result = await target.get!();
    expect(result).toEqual(original);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe(`${BASE_URL}/api/vault/blob/backup.bin`);
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("get() returns null on 404", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const result = await target.get!();
    expect(result).toBeNull();
  });

  it("get() throws on non-200/non-404", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("Unauthorized", { status: 401 }),
    );
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(target.get!()).rejects.toThrow(/401/);
  });

  it("checkAccess() hits health then whoami", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ ok: true, user_id: 1, username: "admin" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await target.checkAccess();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(`${BASE_URL}/api/vault/health`);
    expect(calls[1]).toBe(`${BASE_URL}/api/vault/whoami`);
  });

  it("checkAccess() throws when whoami returns 401 (invalid PAT)", async () => {
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // health OK
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // whoami 401
      return new Response("Unauthorized", { status: 401 });
    });
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: "bad-token",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(target.checkAccess()).rejects.toThrow(/401/);
  });

  it("uses custom blobId in URL", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ updated_at: 1 }), { status: 200 }),
    );
    const target = vaultTarget({
      baseUrl: BASE_URL,
      token: TOKEN,
      blobId: "my-custom-backup.bin",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await target.put(new Uint8Array([1]));
    const [url] = fetchSpy.mock.calls[0] as unknown as [RequestInfo | URL];
    expect(String(url)).toBe(`${BASE_URL}/api/vault/blob/my-custom-backup.bin`);
  });

  it("id is 'vault' and displayName includes baseUrl", () => {
    const target = vaultTarget({ baseUrl: BASE_URL, token: TOKEN });
    expect(target.id).toBe("vault");
    expect(target.displayName).toContain("vault.example.com");
  });
});
