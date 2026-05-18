// Setup page — first-admin creation. Shown when auth status reports
// needs_setup = true (no users exist yet).

import { useState } from "react";
import { api } from "../api.ts";

type Props = {
  onSetup: () => void;
};

export default function Setup({ onSetup }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup(username, password);
      onSetup();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="center-wrap">
      <div className="card">
        <h2>Create admin account</h2>
        <p className="hint">This is the first-time setup. Create your admin user.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create admin"}
          </button>
        </form>
      </div>
    </div>
  );
}
