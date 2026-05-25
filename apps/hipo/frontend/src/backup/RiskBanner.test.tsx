// RiskBanner: pick-worst-flag + dashboard-vs-settings mode behaviour.
// Plain render assertions against the antd Alert; we look for the
// description text since the title is the same across cases.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import en from "../i18n/locales/en.json";
import type { SystemStatus } from "../api/system";
import { RiskBanner } from "./RiskBanner";

// Initialise i18next inline so the component sees a translator
// without pulling in the app-wide setup (which mounts side effects).
void i18next.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

function status(flags: Partial<SystemStatus["risk_flags"]>): SystemStatus {
  return {
    status_schema_version: 1,
    framework_version: "0.0.0",
    shape: "browser",
    shape_details: {},
    storage: { backend: "opfs" },
    backups: { targets: [] },
    risk_flags: flags,
  };
}

function renderBanner(s: SystemStatus, mode: "dashboard" | "settings") {
  return render(
    <I18nextProvider i18n={i18next}>
      <RiskBanner status={s} mode={mode} />
    </I18nextProvider>,
  );
}

describe("RiskBanner", () => {
  it("renders the error banner when no_backup_configured", () => {
    renderBanner(status({ no_backup_configured: true }), "dashboard");
    expect(
      screen.getByText(en.settings.storage.risk.noBackupConfigured),
    ).toBeTruthy();
  });

  it("renders the verify-failed banner over no_recent_backup (severity order)", () => {
    renderBanner(
      status({
        last_verify_failed: true,
        no_recent_backup: true,
      }),
      "dashboard",
    );
    expect(
      screen.getByText(en.settings.storage.risk.lastVerifyFailed),
    ).toBeTruthy();
    expect(
      screen.queryByText(en.settings.storage.risk.noRecentBackup),
    ).toBeNull();
  });

  it("dashboard mode renders nothing when everything is fine", () => {
    const { container } = renderBanner(
      status({ survives_device_loss_via_backup: true }),
      "dashboard",
    );
    expect(container.textContent).toBe("");
  });

  it("settings mode renders the green banner when survives_device_loss_via_backup", () => {
    renderBanner(status({ survives_device_loss_via_backup: true }), "settings");
    expect(screen.getByText(en.settings.storage.risk.ok)).toBeTruthy();
  });

  it("settings mode renders the info banner for cleared_by_browser_data_clear when nothing's wrong", () => {
    renderBanner(status({ cleared_by_browser_data_clear: true }), "settings");
    expect(
      screen.getByText(en.settings.storage.risk.clearedByBrowserDataClear),
    ).toBeTruthy();
  });

  it("dashboard mode hides the info banner for cleared_by_browser_data_clear alone", () => {
    const { container } = renderBanner(
      status({ cleared_by_browser_data_clear: true }),
      "dashboard",
    );
    expect(container.textContent).toBe("");
  });
});
