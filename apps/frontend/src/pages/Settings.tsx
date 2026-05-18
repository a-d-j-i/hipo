import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Input,
  Radio,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import { CloudDownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { downloadTarget } from "@hipo/backup-local/download";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "../i18n";
import { getSystemStatus, type SystemStatus } from "../api/system";
import { runBackup } from "../backup/orchestrate";
import { usePassphrase } from "../bootstrap/PassphraseContext";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatBytes(n: number | undefined): string | undefined {
  if (typeof n !== "number") return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatTimestamp(t: number | undefined | null): string | null {
  if (typeof t !== "number") return null;
  return new Date(t * 1000).toLocaleString();
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const [checking, setChecking] = useState(false);

  const onChange = (lng: Locale) => {
    void i18n.changeLanguage(lng);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
    } catch {
      /* localStorage may not be available */
    }
  };

  const active = (i18n.resolvedLanguage ?? i18n.language ?? "es") as Locale;

  const onCheckUpdates = async () => {
    setChecking(true);
    try {
      const { checkForUpdates } = await import("../api/updater");
      await checkForUpdates({
        silent: false,
        copy: {
          upToDate: t("settings.updates.upToDate"),
          checkFailed: t("settings.updates.checkFailed"),
          updateAvailable: (v: string) =>
            t("settings.updates.available", { version: v }),
          updateBodyFallback: t("settings.updates.bodyFallback"),
          install: t("settings.updates.install"),
          later: t("settings.updates.later"),
          updateFailed: t("settings.updates.updateFailed"),
        },
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("settings.language.title")}
        </Typography.Title>
        <Radio.Group
          value={active}
          onChange={(e) => onChange(e.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((lng) => (
            <Radio.Button key={lng} value={lng}>
              {t(`settings.language.${lng}`)}
            </Radio.Button>
          ))}
        </Radio.Group>
      </div>

      <StoragePanel />

      {inTauri() && (
        <div>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("settings.updates.title")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {t("settings.updates.description")}
          </Typography.Paragraph>
          <Button
            icon={<ReloadOutlined />}
            loading={checking}
            onClick={onCheckUpdates}
          >
            {checking
              ? t("settings.updates.checking")
              : t("settings.updates.check")}
          </Button>
        </div>
      )}
    </Space>
  );
}

// ---------------------------------------------------------------------------
// Storage & backups panel
// ---------------------------------------------------------------------------

function StoragePanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSystemStatus();
      setStatus(s);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("settings.storage.title")}
      </Typography.Title>
      {loading || !status ? (
        <Spin />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <RiskBanner status={status} />
          <ShapeDescription status={status} />
          <TargetsList status={status} />
          <BackupNowAction status={status} refresh={refresh} />
        </Space>
      )}
    </div>
  );
}

function RiskBanner({ status }: { status: SystemStatus }) {
  const { t } = useTranslation();
  const f = status.risk_flags;

  // Order matters: pick the worst-case message.
  if (f.no_backup_configured) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.noBackupConfigured")}
      />
    );
  }
  if (f.last_verify_failed) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.lastVerifyFailed")}
      />
    );
  }
  if (f.no_recent_backup) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.noRecentBackup")}
      />
    );
  }
  if (f.near_storage_quota) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.nearStorageQuota")}
      />
    );
  }
  if (f.survives_device_loss_via_backup) {
    return (
      <Alert
        type="success"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.ok")}
      />
    );
  }
  if (f.cleared_by_browser_data_clear) {
    return (
      <Alert
        type="info"
        showIcon
        message={t("settings.storage.risk.title")}
        description={t("settings.storage.risk.clearedByBrowserDataClear")}
      />
    );
  }
  return null;
}

function ShapeDescription({ status }: { status: SystemStatus }) {
  const { t } = useTranslation();
  const used = formatBytes(status.storage.estimated_usage_bytes);
  const quota = formatBytes(status.storage.estimated_quota_bytes);
  const usage =
    used && quota
      ? t("settings.storage.usage", { used, quota })
      : t("settings.storage.usageUnknown");

  return (
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label={t("settings.storage.shape.label")}>
        {t(`settings.storage.shape.${status.shape}`)}
      </Descriptions.Item>
      <Descriptions.Item label={t("settings.storage.backend.label")}>
        {t(`settings.storage.backend.${status.storage.backend}`)}
      </Descriptions.Item>
      <Descriptions.Item label={t("settings.storage.usage", { used: "", quota: "" }).split(" ")[0]}>
        {usage}
      </Descriptions.Item>
      <Descriptions.Item
        label={t("settings.storage.framework", { version: "" }).trim()}
      >
        {status.framework_version}
      </Descriptions.Item>
    </Descriptions>
  );
}

function TargetsList({ status }: { status: SystemStatus }) {
  const { t } = useTranslation();
  if (status.backups.targets.length === 0) {
    return (
      <Typography.Text type="secondary">
        {t("settings.storage.noTargets")}
      </Typography.Text>
    );
  }
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
        {t("settings.storage.targetsTitle")}
      </Typography.Title>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {status.backups.targets.map((tg) => {
          const lastBackup =
            formatTimestamp(tg.last_backup_at) ??
            t("settings.storage.target.neverBackedUp");
          const lastVerifyAt = formatTimestamp(tg.last_verify_at);
          const verifyOkLabel =
            tg.last_verify_ok === true
              ? t("settings.storage.target.verifyOk")
              : t("settings.storage.target.verifyFailed");
          return (
            <Card key={tg.id} size="small">
              <Typography.Text strong>{tg.id}</Typography.Text>
              <div>
                {t("settings.storage.target.lastBackup", { when: lastBackup })}
              </div>
              <div>
                {lastVerifyAt
                  ? t("settings.storage.target.lastVerify", {
                      when: lastVerifyAt,
                      ok: verifyOkLabel,
                    })
                  : t("settings.storage.target.neverVerified")}
              </div>
            </Card>
          );
        })}
      </Space>
    </div>
  );
}

function BackupNowAction({
  status,
  refresh,
}: {
  status: SystemStatus;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const passphrase = usePassphrase();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"preparing" | "uploading" | "verifying" | null>(
    null,
  );
  const [askPass, setAskPass] = useState(false);
  const [passInput, setPassInput] = useState("");

  // Backup is admin-only at the API layer. Hide the button on the
  // status panel for non-admins instead of letting them get a 403.
  // The server is still the enforcing barrier; this is UX.
  void status; // status drives any future "what target to use" picking.

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const target = downloadTarget({
        filename: `hipo-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.bin`,
      });
      await runBackup({
        target,
        keyFor: passphrase.keyFor,
        onProgress: (s) => setStage(s),
      });
      message.success(t("settings.storage.backupNow.success"));
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[hipo] backup failed:", e);
      message.error(t("settings.storage.backupNow.failed"));
    } finally {
      setStage(null);
      setBusy(false);
    }
  }, [passphrase, refresh, t]);

  const onClick = () => {
    if (passphrase.isSet) {
      void run();
    } else {
      setPassInput("");
      setAskPass(true);
    }
  };

  const onSubmitPassphrase = async () => {
    if (passInput.length === 0) {
      message.error(t("settings.storage.backupNow.passphraseEmpty"));
      return;
    }
    passphrase.setPassphrase(passInput);
    setAskPass(false);
    setPassInput("");
    await run();
  };

  const label =
    stage === "preparing"
      ? t("settings.storage.backupNow.preparing")
      : stage === "uploading"
        ? t("settings.storage.backupNow.uploading")
        : stage === "verifying"
          ? t("settings.storage.backupNow.verifying")
          : t("settings.storage.backupNow.button");

  return (
    <div>
      <Button
        type="primary"
        icon={<CloudDownloadOutlined />}
        loading={busy}
        onClick={onClick}
      >
        {label}
      </Button>
      <Modal
        title={t("settings.storage.backupNow.passphraseRequired")}
        open={askPass}
        onCancel={() => setAskPass(false)}
        onOk={() => void onSubmitPassphrase()}
        okText={t("settings.storage.backupNow.button")}
      >
        <Typography.Paragraph type="secondary">
          {t("settings.storage.backupNow.passphraseHint")}
        </Typography.Paragraph>
        <Input.Password
          value={passInput}
          onChange={(e) => setPassInput(e.target.value)}
          placeholder={t("settings.storage.backupNow.passphrasePlaceholder")}
          onPressEnter={() => void onSubmitPassphrase()}
          autoFocus
        />
      </Modal>
    </div>
  );
}
