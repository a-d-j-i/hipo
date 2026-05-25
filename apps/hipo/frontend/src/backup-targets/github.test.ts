// GitHub target tests. Replace global fetch with a spy that records
// requests and returns scripted responses. Round-trip put → get is
// the main contract.

import { afterEach, describe, expect, it, vi } from "vitest";
import { githubTarget } from "@hipo/backup-github";
import { bytesToBase64 } from "@hipo/backup-github";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ message: "Not Found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

const OWNER = "alice";
const REPO = "hipo-backups";
const PATH = "backup.bin";
const TOKEN = "github_pat_test";
const TARGET_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("githubTarget", () => {
  it("get() returns null when the file does not exist (404)", async () => {
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => notFound(),
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(await target.get!()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${TARGET_BASE}/contents/${PATH}`);
    expect(init?.headers as Record<string, string>).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("put() with no prior file omits sha and PUTs base64 content", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchSpy = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const s = typeof url === "string" ? url : url.toString();
        calls.push({ url: s, init: init ?? {} });
        if (init?.method === "PUT") {
          return jsonResponse({
            content: { sha: "new-sha", path: PATH },
            commit: {
              sha: "commit-sha",
              committer: { date: "2026-01-02T03:04:05Z" },
            },
          });
        }
        // First request is the GET-for-sha, file doesn't exist yet.
        return notFound();
      },
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const blob = new Uint8Array([1, 2, 3, 4]);
    const res = await target.put(blob);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${TARGET_BASE}/contents/${PATH}`);
    expect(calls[1].init.method).toBe("PUT");
    const putBody = JSON.parse(calls[1].init.body as string);
    expect(putBody.content).toBe(bytesToBase64(blob));
    expect(putBody.sha).toBeUndefined();
    expect(typeof putBody.message).toBe("string");

    // 2026-01-02T03:04:05Z → unix seconds.
    expect(res.at).toBe(Math.floor(Date.parse("2026-01-02T03:04:05Z") / 1000));
  });

  it("put() with an existing file includes the current sha", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchSpy = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const s = typeof url === "string" ? url : url.toString();
        calls.push({ url: s, init: init ?? {} });
        if (init?.method === "PUT") {
          return jsonResponse({
            content: { sha: "next-sha", path: PATH },
            commit: { sha: "c2", committer: { date: "2026-02-03T00:00:00Z" } },
          });
        }
        return jsonResponse({
          type: "file",
          encoding: "base64",
          size: 4,
          name: PATH,
          path: PATH,
          content: bytesToBase64(new Uint8Array([9, 9, 9, 9])),
          sha: "existing-sha",
        });
      },
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      branch: "main",
      authorName: "hipo",
      authorEmail: "bot@example.com",
      fetch: fetchSpy as unknown as typeof fetch,
    });

    await target.put(new Uint8Array([1, 2, 3, 4]));
    const putBody = JSON.parse(calls[1].init.body as string);
    expect(putBody.sha).toBe("existing-sha");
    expect(putBody.branch).toBe("main");
    expect(putBody.committer).toEqual({
      name: "hipo",
      email: "bot@example.com",
    });
    // GET also passed `?ref=main`.
    expect(calls[0].url).toBe(`${TARGET_BASE}/contents/${PATH}?ref=main`);
  });

  it("get() returns inline base64 content for small files", async () => {
    const original = new Uint8Array([100, 101, 102, 103]);
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        type: "file",
        encoding: "base64",
        size: original.length,
        name: PATH,
        path: PATH,
        content: bytesToBase64(original),
        sha: "abc",
      }),
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const back = await target.get!();
    expect(back).toEqual(original);
  });

  it("get() falls back to the Git Blobs API when content is empty (large files)", async () => {
    const original = new Uint8Array([200, 201, 202]);
    const calls: string[] = [];
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const s = typeof url === "string" ? url : url.toString();
      calls.push(s);
      if (s.endsWith(`/contents/${PATH}`)) {
        return jsonResponse({
          type: "file",
          encoding: "none",
          size: 2_000_000,
          name: PATH,
          path: PATH,
          content: "",
          sha: "big-sha",
        });
      }
      if (s.endsWith(`/git/blobs/big-sha`)) {
        return jsonResponse({
          sha: "big-sha",
          size: original.length,
          encoding: "base64",
          content: bytesToBase64(original),
        });
      }
      return new Response("nope", { status: 500 });
    });
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const back = await target.get!();
    expect(back).toEqual(original);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(`${TARGET_BASE}/git/blobs/big-sha`);
  });

  it("round-trip: bytes survive put → get against a stub server", async () => {
    // Fake server keeps the last PUT in memory.
    let store: { sha: string; content: string } | null = null;
    const fetchSpy = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const s = typeof url === "string" ? url : url.toString();
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body as string);
          store = {
            sha: `sha-${store?.sha ?? ""}-next`,
            content: body.content,
          };
          return jsonResponse({
            content: { sha: store.sha, path: PATH },
            commit: { sha: "c", committer: { date: "2026-01-01T00:00:00Z" } },
          });
        }
        if (s.endsWith(`/contents/${PATH}`)) {
          if (!store) return notFound();
          return jsonResponse({
            type: "file",
            encoding: "base64",
            size: store.content.length,
            name: PATH,
            path: PATH,
            content: store.content,
            sha: store.sha,
          });
        }
        return new Response("nope", { status: 500 });
      },
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    const original = new Uint8Array(1024).map((_, i) => i & 0xff);
    await target.put(original);
    const back = await target.get!();
    expect(back).toEqual(original);
  });

  it("checkAccess() throws on auth failure", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("Bad credentials", { status: 401 }),
    );
    const target = githubTarget({
      owner: OWNER,
      repo: REPO,
      token: "bad",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(target.checkAccess()).rejects.toThrow(/401/);
  });
});
