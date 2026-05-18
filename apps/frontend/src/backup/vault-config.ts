// Vault target's plain configuration: baseUrl and blobId.
// The PAT is NOT stored here — it goes through `secrets-vault` under
// key `vault.pat` so it's passphrase-encrypted at rest.

const STORAGE_KEY = "hipo.vault.config";

export type VaultConfig = {
  baseUrl: string;
  blobId: string;
};

export function loadVaultConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultConfig;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.blobId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveVaultConfig(config: VaultConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearVaultConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
