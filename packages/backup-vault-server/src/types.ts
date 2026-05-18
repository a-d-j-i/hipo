// Wire types for the vault PAT management and blob API.

export type MintPatInput = {
  label?: string;
};

export type MintPatResponse = {
  /** Cleartext token — only time this is returned. Caller must store it. */
  token: string;
  token_hash: string;
  label: string | null;
  created_at: number;
};

export type PatView = {
  token_hash: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
};
