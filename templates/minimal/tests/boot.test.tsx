// Smoke tests: App and BootstrapApp mount without throwing.
//
// These don't test the full OPFS/SW/Worker topology (that requires a real
// browser — see smoke.mjs). They verify that the template's imports all
// resolve and that the React components don't crash on mount in jsdom.
//
// App.tsx loads auth state on mount via fetch('/api/auth/status'). In jsdom
// that fetch is stubbed to reject, so App stays in the "loading…" state —
// which is valid: the component must not crash when the API isn't reachable.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "../src/App.tsx";
import BootstrapApp from "../src/BootstrapApp.tsx";

describe("App", () => {
  it("mounts and renders a loading state without throwing", () => {
    render(<App />);
    // The component renders "Loading…" while waiting for the API.
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe("BootstrapApp", () => {
  it("mounts and renders the passphrase form without throwing", () => {
    render(<BootstrapApp />);
    // The Bootstrap page renders a passphrase input and a Continue button.
    expect(
      screen.getByRole("button", { name: /continue/i }),
    ).toBeInTheDocument();
  });
});
