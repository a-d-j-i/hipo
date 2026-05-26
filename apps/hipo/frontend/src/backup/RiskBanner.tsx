// Single Alert that translates `SystemStatus.risk_flags` into the
// worst-flag warning users should see. Two modes:
//
//   - `dashboard`: prominent banner at the top of the dashboard.
//     Renders null when there's nothing to warn about (green case
//     stays implicit; we don't want a "ok" splash on every load).
//   - `settings`: full status panel context — always render
//     something, including the green/info modes, so users know the
//     check ran.
//
// Severity order (worst first):
//   error   no_backup_configured | last_verify_failed
//   warning no_recent_backup | near_storage_quota
//   info    cleared_by_browser_data_clear (in-app reminder)
//   success otherwise

import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import type { SystemStatus } from "../api/system";

export type RiskBannerMode = "dashboard" | "settings";

export function RiskBanner({
  status,
  mode,
}: {
  status: SystemStatus;
  mode: RiskBannerMode;
}) {
  const { t } = useTranslation();
  const f = status.risk_flags;
  const title = t("settings.storage.risk.title");

  if (f.no_backup_configured) {
    return (
      <Alert
        type="error"
        showIcon
        title={title}
        description={t("settings.storage.risk.noBackupConfigured")}
      />
    );
  }
  if (f.last_verify_failed) {
    return (
      <Alert
        type="error"
        showIcon
        title={title}
        description={t("settings.storage.risk.lastVerifyFailed")}
      />
    );
  }
  if (f.no_recent_backup) {
    return (
      <Alert
        type="warning"
        showIcon
        title={title}
        description={t("settings.storage.risk.noRecentBackup")}
      />
    );
  }
  if (f.near_storage_quota) {
    return (
      <Alert
        type="warning"
        showIcon
        title={title}
        description={t("settings.storage.risk.nearStorageQuota")}
      />
    );
  }

  // From here on the state is fine. Dashboard wants out — settings
  // still renders the explainer + green banner so the panel isn't
  // empty when everything's healthy.
  if (mode === "dashboard") return null;

  if (f.survives_device_loss_via_backup) {
    return (
      <Alert
        type="success"
        showIcon
        title={title}
        description={t("settings.storage.risk.ok")}
      />
    );
  }
  if (f.cleared_by_browser_data_clear) {
    return (
      <Alert
        type="info"
        showIcon
        title={title}
        description={t("settings.storage.risk.clearedByBrowserDataClear")}
      />
    );
  }
  return null;
}
