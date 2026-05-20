// Vault BackupTarget. Reads + writes a single blob (default `backup.bin`)
// on a vault server running @hipo/backup-vault-server routes.
//
// Auth: Bearer PAT sent on every request. Tokens are passed in as a
// string — this package never persists them; the app stores them
// wherever its secret-storage policy says (browser: passphrase-derived
// encryption + IndexedDB).

import type { BackupTarget } from "@hipo/backup";

export type VaultTargetOptions = {
  /** Base URL of the vault server, e.g. "https://vault.example.com" or
   *  "" for same-origin. No trailing slash. */
  baseUrl: string;
  /** Vault PAT, sent as Authorization: Bearer <token>. */
  token: string;
  /** Blob ID to store under. Default: "backup.bin". */
  blobId?: string;
  /** Override global fetch (useful in tests). */
  fetch?: typeof fetch;
  /** Display name override. */
  displayName?: string;
};

export type VaultTarget = BackupTarget & {
  /** Verify the server is reachable and the PAT is valid. */
  checkAccess(): Promise<void>;
};

export function vaultTarget(opts: VaultTargetOptions): VaultTarget {
  const blobId = opts.blobId ?? "backup.bin";
  const doFetch = opts.fetch ?? ((...args) => fetch(...args));
  const base = opts.baseUrl.replace(/\/$/, "");

  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${opts.token}`,
  });

  const url = (path: string) => `${base}${path}`;

  return {
    id: "vault",
    displayName: opts.displayName ?? `Vault: ${base}/${blobId}`,

    async checkAccess(): Promise<void> {
      // First check the server is reachable.
      const health = await doFetch(url("/api/vault/health"));
      if (!health.ok) {
        throw new Error(`vault health: ${health.status} ${health.statusText}`);
      }
      // Then verify the PAT is valid by calling the whoami endpoint.
      const whoami = await doFetch(url("/api/vault/whoami"), {
        headers: authHeader(),
      });
      if (!whoami.ok) {
        throw new Error(
          `vault whoami: ${whoami.status} ${whoami.statusText}: ${await whoami.text()}`,
        );
      }
    },

    async put(blob: Uint8Array): Promise<{ at: number }> {
      const res = await doFetch(
        url(`/api/vault/blob/${encodeURIComponent(blobId)}`),
        {
          method: "PUT",
          headers: {
            ...authHeader(),
            "Content-Type": "application/octet-stream",
          },
          body: blob,
        },
      );
      if (!res.ok) {
        throw new Error(
          `vault PUT blob: ${res.status} ${res.statusText}: ${await res.text()}`,
        );
      }
      const json = (await res.json()) as { updated_at?: number };
      const at =
        typeof json.updated_at === "number"
          ? json.updated_at
          : Math.floor(Date.now() / 1000);
      return { at };
    },

    async get(): Promise<Uint8Array | null> {
      const res = await doFetch(
        url(`/api/vault/blob/${encodeURIComponent(blobId)}`),
        {
          headers: authHeader(),
        },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `vault GET blob: ${res.status} ${res.statusText}: ${await res.text()}`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
