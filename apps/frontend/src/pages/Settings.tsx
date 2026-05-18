import { useCallback, useEffect, useState } from "react";
import {
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
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { downloadTarget } from "@hipo/backup-local/download";
import { fsAccessTarget } from "@hipo/backup-local/fs-access";
import { githubTarget } from "@hipo/backup-github";
import { unpackEnvelope } from "@hipo/backup";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "../i18n";
import { getSystemStatus, type SystemStatus } from "../api/system";
import {
  applyRestore,
  configureTarget,
  type BackupTargetStateView,
} from "../api/backup";
import { runBackup } from "../backup/orchestrate";
import { RiskBanner } from "../backup/RiskBanner";
import { vaultTarget } from "@hipo/backup-vault";
import {
  clearGithubConfig,
  loadGithubConfig,
  saveGithubConfig,
  type GithubConfig,
} from "../backup/github-config";
import {
  clearVaultConfig,
  loadVaultConfig,
  saveVaultConfig,
  type VaultConfig,
} from "../backup/vault-config";
import {
  clearSecret,
  getOrCreateVaultSalt,
  getSecret,
  setSecret,
} from "../backup/secrets-vault";
import { mintVaultPat } from "../api/vault";
import { usePassphrase } from "../bootstrap/PassphraseContext";
import { useAuth } from "../auth/AuthContext";

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
          <RiskBanner status={status} mode="settings" />
          <ShapeDescription status={status} />
          <TargetsList status={status} />
          <BackupNowAction status={status} refresh={refresh} />
          <FsAccessSection status={status} refresh={refresh} />
          <GithubSection status={status} refresh={refresh} />
          <VaultSection status={status} refresh={refresh} />
          <RestoreSection />
        </Space>
      )}
    </div>
  );
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

// ---------------------------------------------------------------------------
// FS Access target — persistent local folder (Chromium-only browsers)
// ---------------------------------------------------------------------------

function FsAccessSection({
  status,
  refresh,
}: {
  status: SystemStatus;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const passphrase = usePassphrase();
  // One shared target instance per render; the underlying handle is
  // looked up from IndexedDB on every put/get.
  const [target] = useState(() => fsAccessTarget({ filename: "backup.bin" }));
  const [available] = useState(() => target.isAvailable());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [passInput, setPassInput] = useState("");

  const stateRow: BackupTargetStateView | undefined =
    status.backups.targets.find((tg) => tg.id === "fs-access") &&
    ({
      target_id: "fs-access",
      configured_at: 0,
      last_backup_at: status.backups.targets.find((tg) => tg.id === "fs-access")
        ?.last_backup_at ?? null,
      last_backup_size_bytes: null,
      last_verify_at:
        status.backups.targets.find((tg) => tg.id === "fs-access")
          ?.last_verify_at ?? null,
      last_verify_ok:
        status.backups.targets.find((tg) => tg.id === "fs-access")
          ?.last_verify_ok ?? null,
    } as BackupTargetStateView);

  useEffect(() => {
    if (!available) {
      setConfigured(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const c = await target.isConfigured();
        if (!cancelled) setConfigured(c);
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, target]);

  if (!available) {
    return (
      <Card size="small">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t("settings.storage.fsAccess.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("settings.storage.fsAccess.unsupported")}
        </Typography.Paragraph>
      </Card>
    );
  }

  const onPick = async () => {
    setBusy(true);
    try {
      await target.pickDirectory();
      await configureTarget("fs-access");
      setConfigured(true);
      await refresh();
      message.success(t("settings.storage.fsAccess.configured"));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[hipo] fs-access pickDirectory:", e);
      message.error(t("settings.storage.fsAccess.pickFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onForget = async () => {
    setBusy(true);
    try {
      await target.forget();
      setConfigured(false);
      message.success(t("settings.storage.fsAccess.disconnected"));
    } finally {
      setBusy(false);
    }
  };

  const runOnce = async () => {
    setBusy(true);
    try {
      await runBackup({ target, keyFor: passphrase.keyFor });
      message.success(t("settings.storage.backupNow.success"));
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[hipo] fs-access backup:", e);
      message.error(t("settings.storage.backupNow.failed"));
    } finally {
      setBusy(false);
    }
  };

  const onBackup = () => {
    if (passphrase.isSet) {
      void runOnce();
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
    await runOnce();
  };

  return (
    <Card size="small">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("settings.storage.fsAccess.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("settings.storage.fsAccess.description")}
      </Typography.Paragraph>
      {configured === null ? (
        <Spin />
      ) : configured ? (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text>
            {t("settings.storage.fsAccess.currentLabel")}
            {stateRow?.last_backup_at
              ? " · " +
                t("settings.storage.target.lastBackup", {
                  when: new Date(stateRow.last_backup_at * 1000).toLocaleString(),
                })
              : ""}
          </Typography.Text>
          <Space wrap>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={busy}
              onClick={onBackup}
            >
              {t("settings.storage.fsAccess.backupNow")}
            </Button>
            <Button
              icon={<FolderOpenOutlined />}
              loading={busy}
              onClick={() => void onPick()}
            >
              {t("settings.storage.fsAccess.reconnectFolder")}
            </Button>
            <Button danger loading={busy} onClick={() => void onForget()}>
              {t("settings.storage.fsAccess.disconnectFolder")}
            </Button>
          </Space>
        </Space>
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {t("settings.storage.fsAccess.notConfigured")}
          </Typography.Text>
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={busy}
            onClick={() => void onPick()}
          >
            {t("settings.storage.fsAccess.pickFolder")}
          </Button>
        </Space>
      )}
      <Modal
        title={t("settings.storage.backupNow.passphraseRequired")}
        open={askPass}
        onCancel={() => setAskPass(false)}
        onOk={() => void onSubmitPassphrase()}
        okText={t("settings.storage.fsAccess.backupNow")}
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Restore from a backup file (admin-only)
// ---------------------------------------------------------------------------

function RestoreSection() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const passphrase = usePassphrase();
  const [file, setFile] = useState<File | null>(null);
  const [passInput, setPassInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (currentUser?.role !== "admin") return null;

  const onSubmit = async () => {
    if (!file) {
      message.error(t("settings.storage.restore.fileRequired"));
      return;
    }
    if (passInput.length === 0) {
      message.error(t("settings.storage.restore.passphraseRequired"));
      return;
    }
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setConfirmOpen(false);
    if (!file) return;
    setBusy(true);
    const hide = message.loading(t("settings.storage.restore.restoring"), 0);
    try {
      const envelopeBytes = new Uint8Array(await file.arrayBuffer());
      const env = unpackEnvelope(envelopeBytes);
      if (env.format !== "binary-gzip") {
        throw new Error(
          `unsupported backup format "${env.format}" — this app version ` +
            `only supports "binary-gzip"`,
        );
      }
      passphrase.setPassphrase(passInput);
      const key = await passphrase.keyFor(env.salt);
      // Client-side decrypt — keeps the key off the wire. The server's
      // BackupFormat is `gzipped(binaryFormat({...}))`, expecting gzip
      // bytes; the AES-GCM plaintext of a "binary-gzip" envelope IS
      // gzipped binary, so we forward the decrypt output directly.
      const { decryptBlob } = await import("@hipo/backup");
      const dec = await decryptBlob(env, key);
      await applyRestore(dec.bytes);
      hide();
      message.success(t("settings.storage.restore.success"));
      window.location.reload();
    } catch (e) {
      hide();
      passphrase.clear();
      // eslint-disable-next-line no-console
      console.warn("[hipo] restore failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      // AES-GCM auth-tag failures throw OperationError or similar —
      // surface a friendly "wrong passphrase" message and leave the
      // raw error in the console for debugging.
      if (msg.includes("OperationError") || msg.includes("decrypt")) {
        message.error(t("settings.storage.restore.decryptFailed"));
      } else {
        message.error(
          t("settings.storage.restore.applyFailed", { message: msg }),
        );
      }
      setBusy(false);
    }
  };

  return (
    <Card size="small">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("settings.storage.restore.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("settings.storage.restore.description")} ·{" "}
        {t("settings.storage.restore.adminOnly")}
      </Typography.Paragraph>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <input
          type="file"
          accept=".bin,application/octet-stream"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Input.Password
          value={passInput}
          onChange={(e) => setPassInput(e.target.value)}
          placeholder={t("settings.storage.restore.passphrasePlaceholder")}
          autoComplete="current-password"
        />
        <Button
          type="primary"
          danger
          loading={busy}
          disabled={!file || passInput.length === 0}
          onClick={() => void onSubmit()}
        >
          {t("settings.storage.restore.restoreNow")}
        </Button>
      </Space>
      <Modal
        title={t("settings.storage.restore.confirmTitle")}
        open={confirmOpen}
        okText={t("settings.storage.restore.confirmOk")}
        okType="danger"
        onCancel={() => setConfirmOpen(false)}
        onOk={() => void onConfirm()}
      >
        <Typography.Paragraph>
          {t("settings.storage.restore.confirmBody")}
        </Typography.Paragraph>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Vault target — encrypted PAT in secrets-vault, config in localStorage
// ---------------------------------------------------------------------------

function VaultSection({
  status,
  refresh,
}: {
  status: SystemStatus;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const passphrase = usePassphrase();
  const [config, setConfig] = useState<VaultConfig | null>(() =>
    loadVaultConfig(),
  );
  const [busy, setBusy] = useState(false);
  // Form values.
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [blobId, setBlobId] = useState(config?.blobId ?? "backup.bin");
  const [pat, setPat] = useState("");
  // Mint PAT modal state.
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stateRow = status.backups.targets.find((tg) => tg.id === "vault");

  const ensureVaultKey = async (): Promise<CryptoKey | null> => {
    if (!passphrase.isSet) {
      message.error(t("settings.storage.vault.needPassphrase"));
      return null;
    }
    return passphrase.keyFor(getOrCreateVaultSalt());
  };

  const onMintPat = async () => {
    if (!baseUrl) {
      message.error(t("settings.storage.vault.fieldRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await mintVaultPat("hipo-backup");
      setMintedToken(res.token);
      setPat(res.token);
      setCopied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(t("settings.storage.vault.testFailed", { message: msg }));
    } finally {
      setBusy(false);
    }
  };

  const onCopyToken = () => {
    if (!mintedToken) return;
    navigator.clipboard.writeText(mintedToken).then(() => {
      setCopied(true);
    });
  };

  const onTest = async () => {
    if (!baseUrl || !pat) {
      message.error(t("settings.storage.vault.fieldRequired"));
      return;
    }
    setBusy(true);
    try {
      const target = vaultTarget({ baseUrl, blobId, token: pat });
      await target.checkAccess();
      message.success(t("settings.storage.vault.testOk"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(t("settings.storage.vault.testFailed", { message: msg }));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!baseUrl || !blobId || !pat) {
      message.error(t("settings.storage.vault.fieldRequired"));
      return;
    }
    const key = await ensureVaultKey();
    if (!key) return;
    setBusy(true);
    try {
      const nextConfig: VaultConfig = {
        baseUrl: baseUrl.trim(),
        blobId: blobId.trim(),
      };
      saveVaultConfig(nextConfig);
      await setSecret("vault.pat", pat, key);
      await configureTarget("vault");
      setConfig(nextConfig);
      setPat("");
      message.success(t("settings.storage.vault.savedAndConfigured"));
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(t("settings.storage.vault.saveFailed", { message: msg }));
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = () => {
    clearVaultConfig();
    clearSecret("vault.pat");
    setConfig(null);
    setBaseUrl("");
    setBlobId("backup.bin");
    setPat("");
    message.success(t("settings.storage.vault.unlinked"));
    void refresh();
  };

  const onBackupNow = async () => {
    if (!config) return;
    const key = await ensureVaultKey();
    if (!key) return;
    setBusy(true);
    try {
      const token = await getSecret("vault.pat", key);
      if (!token) {
        message.error(t("settings.storage.vault.needPassphrase"));
        return;
      }
      const target = vaultTarget({
        baseUrl: config.baseUrl,
        blobId: config.blobId,
        token,
      });
      await runBackup({ target, keyFor: passphrase.keyFor });
      message.success(t("settings.storage.backupNow.success"));
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[hipo] vault backup:", e);
      message.error(t("settings.storage.backupNow.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card size="small">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("settings.storage.vault.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("settings.storage.vault.description")}
      </Typography.Paragraph>
      {config && (
        <Typography.Text>
          {t("settings.storage.vault.currentLabel")}: {config.baseUrl}/
          {config.blobId}
          {stateRow?.last_backup_at
            ? " · " +
              t("settings.storage.target.lastBackup", {
                when: new Date(stateRow.last_backup_at * 1000).toLocaleString(),
              })
            : ""}
        </Typography.Text>
      )}
      <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={t("settings.storage.vault.baseUrlPlaceholder")}
          addonBefore={t("settings.storage.vault.baseUrlLabel")}
        />
        <Input
          value={blobId}
          onChange={(e) => setBlobId(e.target.value)}
          placeholder={t("settings.storage.vault.blobIdPlaceholder")}
          addonBefore={t("settings.storage.vault.blobIdLabel")}
        />
        <Input.Password
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={t("settings.storage.vault.patLabel")}
          autoComplete="off"
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("settings.storage.vault.patHint")}
        </Typography.Text>
        <Space wrap>
          <Button onClick={() => void onMintPat()} loading={busy}>
            {t("settings.storage.vault.mintPat")}
          </Button>
          <Button onClick={() => void onTest()} loading={busy}>
            {t("settings.storage.vault.testConnection")}
          </Button>
          <Button type="primary" onClick={() => void onSave()} loading={busy}>
            {t("settings.storage.vault.save")}
          </Button>
          {config && (
            <>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={busy}
                onClick={() => void onBackupNow()}
              >
                {t("settings.storage.vault.backupNow")}
              </Button>
              <Button danger onClick={onUnlink} loading={busy}>
                {t("settings.storage.vault.unlink")}
              </Button>
            </>
          )}
        </Space>
      </Space>
      {/* Minted PAT modal — shows the token exactly once */}
      <Modal
        title={t("settings.storage.vault.mintedTitle")}
        open={mintedToken !== null}
        footer={[
          <Button
            key="copy"
            type={copied ? "default" : "primary"}
            onClick={onCopyToken}
          >
            {copied
              ? t("settings.storage.vault.mintedCopied")
              : t("settings.storage.vault.mintedCopy")}
          </Button>,
          <Button key="close" onClick={() => setMintedToken(null)}>
            {t("settings.storage.vault.mintedClose")}
          </Button>,
        ]}
        onCancel={() => setMintedToken(null)}
      >
        <Typography.Paragraph type="warning">
          {t("settings.storage.vault.mintedBody")}
        </Typography.Paragraph>
        <Input.Password
          value={mintedToken ?? ""}
          readOnly
          autoFocus
        />
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// GitHub target — encrypted PAT in localStorage, config in localStorage
// ---------------------------------------------------------------------------

function GithubSection({
  status,
  refresh,
}: {
  status: SystemStatus;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const passphrase = usePassphrase();
  const [config, setConfig] = useState<GithubConfig | null>(() =>
    loadGithubConfig(),
  );
  const [busy, setBusy] = useState(false);
  // Form values for the configuration drawer.
  const [owner, setOwner] = useState(config?.owner ?? "");
  const [repo, setRepo] = useState(config?.repo ?? "");
  const [path, setPath] = useState(config?.path ?? "backup.bin");
  const [branch, setBranch] = useState(config?.branch ?? "");
  const [pat, setPat] = useState("");

  const stateRow = status.backups.targets.find((tg) => tg.id === "github");

  const ensureVaultKey = async (): Promise<CryptoKey | null> => {
    if (!passphrase.isSet) {
      message.error(t("settings.storage.github.needPassphrase"));
      return null;
    }
    return passphrase.keyFor(getOrCreateVaultSalt());
  };

  const onTest = async () => {
    if (!owner || !repo || !path || !pat) {
      message.error(t("settings.storage.github.fieldRequired"));
      return;
    }
    setBusy(true);
    try {
      const target = githubTarget({
        owner,
        repo,
        path,
        branch: branch || undefined,
        token: pat,
      });
      await target.checkAccess();
      message.success(t("settings.storage.github.testOk"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(
        t("settings.storage.github.testFailed", { message: msg }),
      );
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!owner || !repo || !path || !pat) {
      message.error(t("settings.storage.github.fieldRequired"));
      return;
    }
    const key = await ensureVaultKey();
    if (!key) return;
    setBusy(true);
    try {
      const nextConfig: GithubConfig = {
        owner: owner.trim(),
        repo: repo.trim(),
        path: path.trim(),
        branch: branch.trim() || undefined,
      };
      saveGithubConfig(nextConfig);
      await setSecret("github.pat", pat, key);
      await configureTarget("github");
      setConfig(nextConfig);
      setPat("");
      message.success(t("settings.storage.github.savedAndConfigured"));
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(t("settings.storage.github.saveFailed", { message: msg }));
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = () => {
    clearGithubConfig();
    clearSecret("github.pat");
    setConfig(null);
    setOwner("");
    setRepo("");
    setPath("backup.bin");
    setBranch("");
    setPat("");
    message.success(t("settings.storage.github.unlinked"));
    void refresh();
  };

  const onBackupNow = async () => {
    if (!config) return;
    const key = await ensureVaultKey();
    if (!key) return;
    setBusy(true);
    try {
      const token = await getSecret("github.pat", key);
      if (!token) {
        message.error(t("settings.storage.github.needPassphrase"));
        return;
      }
      const target = githubTarget({
        owner: config.owner,
        repo: config.repo,
        path: config.path,
        branch: config.branch,
        token,
      });
      await runBackup({ target, keyFor: passphrase.keyFor });
      message.success(t("settings.storage.backupNow.success"));
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[hipo] github backup:", e);
      message.error(t("settings.storage.backupNow.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card size="small">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("settings.storage.github.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("settings.storage.github.description")}
      </Typography.Paragraph>
      {config && (
        <Typography.Text>
          {t("settings.storage.github.currentLabel")}: {config.owner}/{config.repo}/
          {config.path}
          {stateRow?.last_backup_at
            ? " · " +
              t("settings.storage.target.lastBackup", {
                when: new Date(stateRow.last_backup_at * 1000).toLocaleString(),
              })
            : ""}
        </Typography.Text>
      )}
      <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
        <Input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder={t("settings.storage.github.ownerPlaceholder")}
          addonBefore={t("settings.storage.github.ownerLabel")}
        />
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={t("settings.storage.github.repoPlaceholder")}
          addonBefore={t("settings.storage.github.repoLabel")}
        />
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t("settings.storage.github.pathPlaceholder")}
          addonBefore={t("settings.storage.github.pathLabel")}
        />
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder={t("settings.storage.github.branchPlaceholder")}
          addonBefore={t("settings.storage.github.branchLabel")}
        />
        <Input.Password
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder={t("settings.storage.github.patLabel")}
          autoComplete="off"
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("settings.storage.github.patHint")}
        </Typography.Text>
        <Space wrap>
          <Button onClick={() => void onTest()} loading={busy}>
            {t("settings.storage.github.testConnection")}
          </Button>
          <Button type="primary" onClick={() => void onSave()} loading={busy}>
            {t("settings.storage.github.save")}
          </Button>
          {config && (
            <>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={busy}
                onClick={() => void onBackupNow()}
              >
                {t("settings.storage.github.backupNow")}
              </Button>
              <Button danger onClick={onUnlink} loading={busy}>
                {t("settings.storage.github.unlink")}
              </Button>
            </>
          )}
        </Space>
      </Space>
    </Card>
  );
}
