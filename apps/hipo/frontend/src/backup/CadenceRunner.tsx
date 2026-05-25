// Background daily-backup runner. Mounted at the app root inside
// AuthProvider + PassphraseProvider. Returns null — it's all
// effects.
//
// Trigger conditions (all must hold):
//   - User is authenticated.
//   - Passphrase is set in PassphraseContext.
//   - There's at least one cadence-eligible target configured
//     (fs-access or github; local-download deliberately excluded).
//   - The last backup against that target was more than
//     `BACKUP_INTERVAL_MS` ago, or has never run.
//
// Schedule:
//   - First check happens ~30 s after mount so the app's initial paint
//     + auth bootstrap finishes uninterrupted by a KDF.
//   - Subsequent checks every `CHECK_INTERVAL_MS`.
//   - Re-entrancy is guarded by an `inFlight` ref — only one backup
//     can run at a time.
//
// On failure we log + leave the state alone; the next tick retries.
// On success we toast quietly so the user knows it happened.

import { useEffect, useRef } from "react";
import { message } from "antd";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { usePassphrase } from "../bootstrap/PassphraseContext";
import { getSystemStatus } from "../api/system";
import { runBackup } from "./orchestrate";
import { getConfiguredTargets } from "./targets-registry";
import { getOrCreateVaultSalt } from "./secrets-vault";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const INITIAL_DELAY_MS = 30 * 1000; // 30 s
const BACKUP_INTERVAL_SECS = 24 * 3600; // daily

export function CadenceRunner() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const passphrase = usePassphrase();
  // Refs so the polling loop sees fresh values without restarting
  // every render. We capture the *current* react state into refs
  // and the tick reads them.
  const inFlight = useRef(false);
  const userRef = useRef(currentUser);
  const passphraseRef = useRef(passphrase);

  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || inFlight.current) return;
      const user = userRef.current;
      const pass = passphraseRef.current;
      if (!user) return;
      if (!pass.isSet) return;

      try {
        inFlight.current = true;
        const status = await getSystemStatus();
        const nowSec = Math.floor(Date.now() / 1000);
        const stale = status.backups.targets.some(
          (tg) =>
            tg.id !== "local-download" &&
            (typeof tg.last_backup_at !== "number" ||
              nowSec - tg.last_backup_at > BACKUP_INTERVAL_SECS),
        );
        if (!stale) return;

        const vaultKey = await pass.keyFor(getOrCreateVaultSalt());
        const targets = await getConfiguredTargets(vaultKey);
        const cadenceTarget = targets.find(
          (entry) =>
            entry.cadenceEligible && entry.target.id !== "local-download",
        );
        if (!cadenceTarget) return;

        await runBackup({
          target: cadenceTarget.target,
          keyFor: pass.keyFor,
        });
        if (!cancelled) {
          message.success(
            t("cadence.success", {
              target: cadenceTarget.target.displayName,
            }),
          );
        }
      } catch (e) {
        // Silent failure for cadence — the user explicitly didn't
        // ask for this backup, and the next tick retries. The error
        // is still surfaced to the console for debugging.

        console.warn("[hipo] cadence tick failed:", e);
      } finally {
        inFlight.current = false;
      }
    }

    const initialId = setTimeout(() => void tick(), INITIAL_DELAY_MS);
    const intervalId = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initialId);
      clearInterval(intervalId);
    };
  }, [t]);

  return null;
}
