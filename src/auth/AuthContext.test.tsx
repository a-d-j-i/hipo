import { render, screen, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

function Probe() {
  const { ready, needsSetup, currentUser } = useAuth();
  if (!ready) return <span>loading</span>;
  if (needsSetup) return <span>needs-setup</span>;
  if (!currentUser) return <span>no-user</span>;
  return (
    <span>
      user:{currentUser.username}:{currentUser.role}
    </span>
  );
}

describe("AuthContext", () => {
  it("shows needs-setup when the backend reports zero users", async () => {
    mockIPC((cmd) => {
      if (cmd === "auth_status")
        return { needs_setup: true, current_user: null };
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("needs-setup")).toBeInTheDocument(),
    );
  });

  it("shows the current user when authenticated", async () => {
    mockIPC((cmd) => {
      if (cmd === "auth_status")
        return {
          needs_setup: false,
          current_user: {
            id: 1,
            username: "alice",
            role: "admin",
            created_at: 1700000000,
          },
        };
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("user:alice:admin")).toBeInTheDocument(),
    );
  });

  it("shows no-user when ready but unauthenticated", async () => {
    mockIPC((cmd) => {
      if (cmd === "auth_status")
        return { needs_setup: false, current_user: null };
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("no-user")).toBeInTheDocument(),
    );
  });
});
