// Reconstructs live BackupTarget instances for every target the user
// has wired up on this device. Used by:
//
//   - Settings → "Back up to GitHub" / "Back up to folder" buttons.
//   - CadenceRunner → finding a cadence-eligible target to run
//     against on the daily timer.
//
// Each entry pairs the target with a `cadenceEligible` flag. The
// universal `local-download` target is intentionally NOT in this
// registry — it would pop a browser save dialog at unpredictable
// times under cadence, which is bad UX. local-download remains
// available via the manual "Back up now (download)" button in
// Settings.

import type { BackupTarget } from "@hipo/backup";
import { fsAccessTarget } from "@hipo/backup-local/fs-access";
import { githubTarget } from "@hipo/backup-github";
import {
  loadGithubConfig,
  type GithubConfig,
} from "./github-config";
import { getSecret } from "./secrets-vault";

export type ConfiguredTarget = {
  target: BackupTarget;
  cadenceEligible: boolean;
};

/**
 * Iterate every target this device has configured and return live
 * `BackupTarget` instances ready to back up against. The `key`
 * parameter is the AES-GCM CryptoKey derived from the vault salt
 * (via `usePassphrase().keyFor(getOrCreateVaultSalt())`) — it gates
 * GitHub PAT decryption. Pass `null` to skip targets that need a
 * secret (i.e. GitHub).
 */
export async function getConfiguredTargets(
  key: CryptoKey | null,
): Promise<ConfiguredTarget[]> {
  const out: ConfiguredTarget[] = [];

  // ---- fs-access ----
  const fs = fsAccessTarget({ filename: "backup.bin" });
  if (fs.isAvailable()) {
    try {
      if (await fs.isConfigured()) {
        out.push({ target: fs, cadenceEligible: true });
      }
    } catch {
      // IndexedDB unavailable or permission lost; skip silently.
    }
  }

  // ---- github ----
  const ghConfig = loadGithubConfig();
  if (ghConfig && key) {
    try {
      const token = await getSecret("github.pat", key);
      if (token) {
        out.push({
          target: makeGithubTarget(ghConfig, token),
          cadenceEligible: true,
        });
      }
    } catch {
      // Wrong key, tampered ciphertext, etc. Skip; UI surfaces this
      // separately via the explicit "Test connection" button.
    }
  }

  return out;
}

export function makeGithubTarget(
  config: GithubConfig,
  token: string,
): BackupTarget {
  return githubTarget({
    owner: config.owner,
    repo: config.repo,
    token,
    path: config.path,
    branch: config.branch,
  });
}
