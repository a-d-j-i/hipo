// Cadence-trigger logic — fake timers + module mocks. We mock the
// auth + passphrase contexts directly rather than mounting the real
// providers (which would have to fetch /api/auth/status).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import en from "../i18n/locales/en.json";

const mockUseAuth = vi.fn();
const mockUsePassphrase = vi.fn();
const mockGetSystemStatus = vi.fn();
const mockGetConfiguredTargets = vi.fn();
const mockRunBackup = vi.fn();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../bootstrap/PassphraseContext", () => ({
  usePassphrase: () => mockUsePassphrase(),
}));

vi.mock("../api/system", () => ({
  getSystemStatus: () => mockGetSystemStatus(),
}));

vi.mock("./orchestrate", () => ({
  runBackup: (opts: unknown) => mockRunBackup(opts),
}));

vi.mock("./targets-registry", () => ({
  getConfiguredTargets: () => mockGetConfiguredTargets(),
}));

vi.mock("./secrets-vault", () => ({
  getOrCreateVaultSalt: () => new Uint8Array(16),
}));

import { CadenceRunner } from "./CadenceRunner";

void i18next.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

function makeStatus(opts: {
  lastBackupAt: number | null;
  targetId?: string;
}): unknown {
  return {
    status_schema_version: 1,
    framework_version: "0.0.0",
    shape: "browser",
    shape_details: {},
    storage: { backend: "opfs" },
    backups: {
      targets:
        opts.lastBackupAt === null && !opts.targetId
          ? []
          : [
              {
                id: opts.targetId ?? "fs-access",
                configured: true,
                last_backup_at: opts.lastBackupAt ?? undefined,
              },
            ],
    },
    risk_flags: {},
  };
}

function fakeTarget(id: string) {
  return {
    target: {
      id,
      displayName: id,
      put: vi.fn(),
      get: vi.fn(),
    },
    cadenceEligible: true,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockUseAuth.mockReset();
  mockUsePassphrase.mockReset();
  mockGetSystemStatus.mockReset();
  mockGetConfiguredTargets.mockReset();
  mockRunBackup.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderWithI18n() {
  return render(
    <I18nextProvider i18n={i18next}>
      <CadenceRunner />
    </I18nextProvider>,
  );
}

describe("CadenceRunner", () => {
  it("does nothing when there's no authenticated user", async () => {
    mockUseAuth.mockReturnValue({ currentUser: null });
    mockUsePassphrase.mockReturnValue({
      isSet: true,
      keyFor: vi.fn(),
    });
    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetSystemStatus).not.toHaveBeenCalled();
    expect(mockRunBackup).not.toHaveBeenCalled();
  });

  it("does nothing when passphrase isn't set", async () => {
    mockUseAuth.mockReturnValue({ currentUser: { role: "admin" } });
    mockUsePassphrase.mockReturnValue({
      isSet: false,
      keyFor: vi.fn(),
    });
    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetSystemStatus).not.toHaveBeenCalled();
  });

  it("does nothing when no targets are stale (recent last_backup_at)", async () => {
    mockUseAuth.mockReturnValue({ currentUser: { role: "admin" } });
    mockUsePassphrase.mockReturnValue({
      isSet: true,
      keyFor: vi.fn().mockResolvedValue(null),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    mockGetSystemStatus.mockResolvedValue(
      makeStatus({ lastBackupAt: nowSec - 60 }), // 1 min ago
    );
    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockGetSystemStatus).toHaveBeenCalled();
    expect(mockGetConfiguredTargets).not.toHaveBeenCalled();
    expect(mockRunBackup).not.toHaveBeenCalled();
  });

  it("triggers runBackup when target is stale + cadence-eligible target exists", async () => {
    mockUseAuth.mockReturnValue({ currentUser: { role: "admin" } });
    const keyFor = vi.fn().mockResolvedValue("fake-key");
    mockUsePassphrase.mockReturnValue({ isSet: true, keyFor });
    const nowSec = Math.floor(Date.now() / 1000);
    mockGetSystemStatus.mockResolvedValue(
      makeStatus({ lastBackupAt: nowSec - 48 * 3600, targetId: "fs-access" }),
    );
    mockGetConfiguredTargets.mockResolvedValue([fakeTarget("fs-access")]);
    mockRunBackup.mockResolvedValue({ size_bytes: 1, at: 1 });

    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockRunBackup).toHaveBeenCalledOnce();
    const call = mockRunBackup.mock.calls[0][0] as { target: { id: string } };
    expect(call.target.id).toBe("fs-access");
  });

  it("skips local-download even if stale", async () => {
    mockUseAuth.mockReturnValue({ currentUser: { role: "admin" } });
    mockUsePassphrase.mockReturnValue({
      isSet: true,
      keyFor: vi.fn().mockResolvedValue("k"),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    mockGetSystemStatus.mockResolvedValue(
      makeStatus({
        lastBackupAt: nowSec - 48 * 3600,
        targetId: "local-download",
      }),
    );
    mockGetConfiguredTargets.mockResolvedValue([]);

    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRunBackup).not.toHaveBeenCalled();
  });

  it("triggers when target has never backed up (null last_backup_at)", async () => {
    mockUseAuth.mockReturnValue({ currentUser: { role: "admin" } });
    mockUsePassphrase.mockReturnValue({
      isSet: true,
      keyFor: vi.fn().mockResolvedValue("k"),
    });
    mockGetSystemStatus.mockResolvedValue(
      makeStatus({ lastBackupAt: null, targetId: "fs-access" }),
    );
    mockGetConfiguredTargets.mockResolvedValue([fakeTarget("fs-access")]);
    mockRunBackup.mockResolvedValue({ size_bytes: 1, at: 1 });

    renderWithI18n();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRunBackup).toHaveBeenCalledOnce();
  });
});
