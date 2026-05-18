// GitHub Contents-API backup target. Reads + writes a single file
// (default `backup.bin`) in a chosen repo via fine-grained PAT.
//
// Behaviour:
//   - put: PUT /repos/{owner}/{repo}/contents/{path}. First put has no
//     sha; subsequent puts must include the current sha (a GET is
//     issued to fetch it).
//   - get: GET /repos/{owner}/{repo}/contents/{path}. For files >1 MB
//     the Contents API returns an empty `content`; fall back to the
//     Git Blobs API which works up to the 100 MB file cap. 404 → null.
//
// Auth: caller supplies the PAT; this package never persists it.

import type { BackupTarget } from "@hipo/backup";
import { base64ToBytes, bytesToBase64 } from "./base64.ts";

const API = "https://api.github.com";

export type GithubTargetOptions = {
  owner: string;
  repo: string;
  /** Fine-grained PAT with `Contents: Read and write` on the repo. */
  token: string;
  /** File path inside the repo. Default: `backup.bin`. */
  path?: string;
  /** Branch to commit to. Default: the repo's default branch. */
  branch?: string;
  /** Commit author. */
  authorName?: string;
  authorEmail?: string;
  /** Commit message template. Receives the timestamp; default uses ISO time. */
  message?: (at: Date) => string;
  /**
   * Override the global fetch (tests, custom retry/proxy). Default
   * uses `globalThis.fetch`.
   */
  fetch?: typeof fetch;
  /** Display name override. */
  displayName?: string;
};

type ContentsResponse = {
  type: string;
  encoding: string;
  size: number;
  name: string;
  path: string;
  content?: string;
  sha: string;
  git_url?: string;
  download_url?: string | null;
};

type PutResponse = {
  content: { sha: string; path: string };
  commit: { sha: string; committer?: { date?: string } };
};

type BlobResponse = {
  sha: string;
  size: number;
  encoding: string;
  content: string;
};

export type GithubTarget = BackupTarget & {
  /** Network round-trip to verify the PAT and reachability. */
  checkAccess(): Promise<void>;
};

export function githubTarget(opts: GithubTargetOptions): GithubTarget {
  const path = opts.path ?? "backup.bin";
  const filename = path;
  const doFetch = opts.fetch ?? ((...args) => fetch(...args));
  const buildMessage =
    opts.message ?? ((at: Date) => `backup ${at.toISOString()}`);

  const baseHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });

  const repoUrl = (extra: string, query?: URLSearchParams): string => {
    const base = `${API}/repos/${opts.owner}/${opts.repo}${extra}`;
    return query && query.size > 0 ? `${base}?${query.toString()}` : base;
  };

  async function readJsonOrThrow<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      throw new Error(
        `github ${what}: ${res.status} ${res.statusText}: ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  async function fetchContents(): Promise<ContentsResponse | null> {
    const query = new URLSearchParams();
    if (opts.branch) query.set("ref", opts.branch);
    const res = await doFetch(repoUrl(`/contents/${filename}`, query), {
      headers: baseHeaders(),
    });
    if (res.status === 404) return null;
    return readJsonOrThrow<ContentsResponse>(res, "GET contents");
  }

  async function fetchBlob(sha: string): Promise<Uint8Array> {
    const res = await doFetch(repoUrl(`/git/blobs/${sha}`), {
      headers: baseHeaders(),
    });
    const json = await readJsonOrThrow<BlobResponse>(res, "GET blob");
    return base64ToBytes(json.content);
  }

  return {
    id: "github",
    displayName:
      opts.displayName ?? `GitHub: ${opts.owner}/${opts.repo}/${filename}`,

    async checkAccess(): Promise<void> {
      const res = await doFetch(repoUrl(""), { headers: baseHeaders() });
      if (!res.ok) {
        throw new Error(
          `github checkAccess: ${res.status} ${res.statusText}: ${await res.text()}`,
        );
      }
    },

    async put(blob: Uint8Array): Promise<{ at: number }> {
      const existing = await fetchContents();
      const body: Record<string, unknown> = {
        message: buildMessage(new Date()),
        content: bytesToBase64(blob),
      };
      if (existing) body.sha = existing.sha;
      if (opts.branch) body.branch = opts.branch;
      if (opts.authorName && opts.authorEmail) {
        body.committer = { name: opts.authorName, email: opts.authorEmail };
      }
      const res = await doFetch(repoUrl(`/contents/${filename}`), {
        method: "PUT",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readJsonOrThrow<PutResponse>(res, "PUT contents");
      const dateStr = json.commit?.committer?.date;
      const at = dateStr
        ? Math.floor(new Date(dateStr).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      return { at };
    },

    async get(): Promise<Uint8Array | null> {
      const c = await fetchContents();
      if (!c) return null;
      // Contents API returns content inline for files ≤ 1 MB. For
      // larger files `content` is empty (or `encoding === "none"`);
      // fall back to the Git Blobs API which handles up to 100 MB.
      if (c.content && c.encoding === "base64") {
        return base64ToBytes(c.content);
      }
      return await fetchBlob(c.sha);
    },
  };
}
