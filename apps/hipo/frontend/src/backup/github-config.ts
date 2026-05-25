// GitHub target's plain configuration: owner / repo / path / branch.
// The PAT is *not* here — that goes through `secrets-vault` so it's
// passphrase-encrypted at rest. These four fields are not secret
// (the repo URL is public information in most cases) so we keep
// them in localStorage in cleartext for easy editing.

const STORAGE_KEY = "hipo.backup.github.config";

export type GithubConfig = {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
};

export function loadGithubConfig(): GithubConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GithubConfig;
    if (!parsed.owner || !parsed.repo || !parsed.path) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGithubConfig(config: GithubConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearGithubConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
