import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockAuthStatusOnce(body: unknown) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/status")) return jsonResponse(body);
    return new Response("not mocked", { status: 500 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthContext", () => {
  it("shows needs-setup when the backend reports zero users", async () => {
    mockAuthStatusOnce({ needs_setup: true, current_user: null });
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
    mockAuthStatusOnce({
      needs_setup: false,
      current_user: {
        id: 1,
        username: "alice",
        role: "admin",
        created_at: 1700000000,
      },
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
    mockAuthStatusOnce({ needs_setup: false, current_user: null });
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
