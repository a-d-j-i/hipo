// Root application. Auth-state-driven view switch:
//   loading  → spinner
//   needs_setup → <Setup>
//   no current_user → <Login>
//   authenticated → <Main>
//
// Auth state is fetched once on mount via /api/auth/status + /api/auth/me.
// After a mutation (login, setup, logout) the relevant state is refreshed.

import { useEffect, useState } from "react";
import { api, type User } from "./api.ts";
import { PassphraseProvider } from "./PassphraseContext.tsx";
import Setup from "./pages/Setup.tsx";
import Login from "./pages/Login.tsx";
import Main from "./pages/Main.tsx";

type AuthState =
  | { phase: "loading" }
  | { phase: "needs_setup" }
  | { phase: "unauthenticated" }
  | { phase: "authenticated"; user: User };

async function loadAuthState(): Promise<AuthState> {
  try {
    const status = await api.getAuthStatus();
    if (status.needs_setup) return { phase: "needs_setup" };
    if (status.current_user) {
      return { phase: "authenticated", user: status.current_user };
    }
    // Status says app is set up but didn't return a user — check /me.
    const me = await api.me();
    if (me) return { phase: "authenticated", user: me };
    return { phase: "unauthenticated" };
  } catch {
    // API not reachable (Worker not yet ready, jsdom in tests, etc.) —
    // stay in loading rather than crashing.
    return { phase: "loading" };
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });

  const refresh = () => {
    loadAuthState()
      .then(setAuth)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (auth.phase === "loading") {
    return (
      <div className="center-wrap">
        <p>Loading…</p>
      </div>
    );
  }

  if (auth.phase === "needs_setup") {
    return <Setup onSetup={refresh} />;
  }

  if (auth.phase === "unauthenticated") {
    return <Login onLogin={refresh} />;
  }

  return (
    <PassphraseProvider>
      <Main user={auth.user} onLogout={refresh} />
    </PassphraseProvider>
  );
}
