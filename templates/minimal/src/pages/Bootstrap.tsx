// Bootstrap page — shown when the OPFS marker is absent.
//
// Single passphrase entry (12-char minimum). "Continue" sets the
// passphrase in context, writes the OPFS marker, reloads the page so
// the full boot sequence takes the bootstrapped path.
//
// Restore from backup lives on the Main page (after login). Keeping
// the bootstrap surface minimal by design.

import { useState } from "react";
import { usePassphrase } from "../PassphraseContext.tsx";
import { markOpfsBootstrapped } from "../opfs-state.ts";

const MIN_PASSPHRASE_LENGTH = 12;

export default function Bootstrap() {
  const { setPassphrase } = usePassphrase();
  const [passphrase, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(
        `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPassphrase(passphrase);
      await markOpfsBootstrapped();
      window.location.reload();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="center-wrap">
      <div className="card">
        <h2>Set up your passphrase</h2>
        <p className="hint">
          This passphrase protects your encrypted backups. It is never stored —
          keep it safe.
        </p>
        <form onSubmit={handleSubmit}>
          <label>
            Passphrase
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPass(e.target.value)}
              minLength={MIN_PASSPHRASE_LENGTH}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Setting up…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
