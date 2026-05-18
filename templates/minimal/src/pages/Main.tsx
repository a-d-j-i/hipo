// Main page — rendered when the user is authenticated.
//
// Shows: "hello {username}" + Logout + Take backup (download) + Restore
// from file. No domain data — this is the framework contract test.
//
// Passphrase handling: the PassphraseContext is populated during bootstrap.
// After a page reload the passphrase is gone (never persisted). If the user
// tries to backup without a set passphrase, we show an inline prompt.

import { useState, useRef } from "react";
import { api, clearSession, type User } from "../api.ts";
import { usePassphrase } from "../PassphraseContext.tsx";
import {
  exportDb,
  importDb,
  freshSalt,
  packEnvelope,
  unpackEnvelope,
} from "@hipo/backup";
import { downloadTarget, readBackupFromFile } from "@hipo/backup-local/download";

const MIN_PASSPHRASE_LENGTH = 12;

type Props = {
  user: User;
  onLogout: () => void;
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...(chunk as unknown as number[]));
  }
  return btoa(binary);
}

export default function Main({ user, onLogout }: Props) {
  const { keyFor, isSet, setPassphrase } = usePassphrase();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Inline passphrase prompt shown when backup is requested but no
  // passphrase is set (happens after a page reload — passphrase is
  // never persisted).
  const [passphrasePrompt, setPassphrasePrompt] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState("");

  const handleLogout = async () => {
    setBusy(true);
    try {
      await api.logout();
      clearSession();
      onLogout();
    } catch (err) {
      setStatus(`Logout failed: ${String(err)}`);
      setBusy(false);
    }
  };

  const handleBackup = async () => {
    // If the passphrase isn't set (e.g. after a page reload), show the
    // inline prompt before proceeding.
    if (!isSet) {
      setPassphrasePrompt("backup");
      return;
    }
    await doBackup();
  };

  const doBackup = async () => {
    setBusy(true);
    setStatus("Preparing backup…");
    try {
      // Fetch gzipped binary snapshot from the Worker.
      const { bytes_b64 } = await api.snapshotRaw();
      const snapshotBytes = base64ToBytes(bytes_b64);

      // Encrypt with the passphrase from context.
      const salt = freshSalt();
      const key = await keyFor(salt);
      // The snapshot from the worker is already gzipped ("binary-gzip").
      // We encrypt it directly.
      const { encryptBlob } = await import("@hipo/backup");
      const envelope = await encryptBlob({
        bytes: snapshotBytes,
        key,
        salt,
        format: "binary-gzip",
      });

      const envelopeBytes = packEnvelope(envelope);
      const target = downloadTarget({ filename: "minimal-backup.bin" });
      await target.put(envelopeBytes);
      setStatus("Backup downloaded.");
    } catch (err) {
      setStatus(`Backup failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePassphrasePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (promptInput.length < MIN_PASSPHRASE_LENGTH) return;
    setPassphrase(promptInput);
    setPromptInput("");
    setPassphrasePrompt(null);
    // Now run the deferred action.
    await doBackup();
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus("Restoring…");
    try {
      const envelopeBytes = await readBackupFromFile(file);
      const envelope = unpackEnvelope(envelopeBytes);
      const key = await keyFor(envelope.salt);
      const { decryptBlob } = await import("@hipo/backup");
      const { bytes } = await decryptBlob(envelope, key);

      // POST the decrypted gzip bytes back to the worker.
      await api.restoreRaw(bytesToBase64(bytes));
      setStatus("Restore complete. Reloading…");
      window.location.reload();
    } catch (err) {
      setStatus(`Restore failed: ${String(err)}`);
      if (fileRef.current) fileRef.current.value = "";
      setBusy(false);
    }
  };

  return (
    <div className="center-wrap">
      <div className="card">
        <h2>Hello, {user.username}!</h2>
        <p className="hint">Role: {user.role}</p>

        {status && <p className="status">{status}</p>}

        {passphrasePrompt && (
          <form onSubmit={handlePassphrasePromptSubmit} style={{ marginBottom: "1rem" }}>
            <label>
              Re-enter backup passphrase
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                minLength={MIN_PASSPHRASE_LENGTH}
                required
              />
            </label>
            <button type="submit" disabled={busy} style={{ marginTop: "0.5rem" }}>
              Unlock backup
            </button>
          </form>
        )}

        <div className="actions">
          <button onClick={handleBackup} disabled={busy}>
            Take backup (download)
          </button>

          <label className="file-label">
            Restore from file
            <input
              ref={fileRef}
              type="file"
              accept=".bin,application/octet-stream"
              onChange={handleRestore}
              disabled={busy}
              style={{ display: "none" }}
            />
          </label>

          <button onClick={handleLogout} disabled={busy} className="secondary">
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

// Ensure the backup exports are properly resolved at bundle time.
void exportDb;
void importDb;
