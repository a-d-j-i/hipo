// Frontend wrappers around /api/vault/* (PAT management only — blob
// operations are done directly by the VaultTarget in @hipo/backup-vault).

import { httpRequest } from "./http";

export type PatView = {
  token_hash: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
};

export type MintPatResponse = {
  token: string;
  token_hash: string;
  label: string | null;
  created_at: number;
};

export async function mintVaultPat(label?: string): Promise<MintPatResponse> {
  return await httpRequest<MintPatResponse>("POST", "/api/vault/pats", {
    label: label ?? null,
  });
}

export async function listVaultPats(): Promise<PatView[]> {
  return await httpRequest<PatView[]>("GET", "/api/vault/pats");
}

export async function revokeVaultPat(tokenHash: string): Promise<void> {
  await httpRequest<null>(
    "DELETE",
    `/api/vault/pats/${encodeURIComponent(tokenHash)}`,
  );
}

/** Matches the server's SHA-256 hex digest — used to find the local PAT in the list. */
export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
