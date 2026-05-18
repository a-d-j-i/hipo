// Single-page bootstrap flow for in-page-backend installs. Renders
// before the React app proper when OPFS hasn't been marked
// bootstrapped (see main.tsx). Two tabs:
//
//   - Start fresh: pick a backup passphrase, optionally download an
//     initial backup file (a sanity-check that the passphrase + flow
//     work before any real data exists), then proceed to the regular
//     setup screen.
//   - Restore: pick a backup file, enter its passphrase, decrypt,
//     write the SQLite snapshot into OPFS, mark bootstrapped, reload.
//
// Both flows end the same way: OPFS marker present, page reloaded,
// main.tsx's next decision falls through to the existing in-page
// backend boot path.

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Segmented,
  Space,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import { downloadTarget } from "@hipo/backup-local/download";
import { rule } from "../lib/antdRules";
import { usePassphrase } from "../bootstrap/PassphraseContext";
import {
  applyRestoredBackup,
  makeInitialBackup,
  makeSalt,
  readEnvelopeFromFile,
} from "../bootstrap/helpers";
import { markOpfsBootstrapped } from "../bootstrap/opfs-state";

type Tab = "new" | "restore";

const MIN_PASSPHRASE_LENGTH = 12;

function checkPassphraseLength(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  return value.length < MIN_PASSPHRASE_LENGTH ? "passphrase.tooShort" : null;
}

export default function Bootstrap() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("new");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <Card style={{ width: 520, maxWidth: "100%" }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t("bootstrap.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("bootstrap.intro")}
        </Typography.Paragraph>
        <Segmented<Tab>
          block
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { label: t("bootstrap.tab.new"), value: "new" },
            { label: t("bootstrap.tab.restore"), value: "restore" },
          ]}
          style={{ marginBottom: 16 }}
        />
        {tab === "new" ? <BootstrapNewPanel /> : <BootstrapRestorePanel />}
      </Card>
    </div>
  );
}

// ----- New install -----

type NewValues = {
  passphrase: string;
  confirm: string;
  downloadInitial: boolean;
};

function BootstrapNewPanel() {
  const { t } = useTranslation();
  const passphraseCtx = usePassphrase();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: NewValues) => {
    setSubmitting(true);
    try {
      passphraseCtx.setPassphrase(values.passphrase);

      if (values.downloadInitial) {
        const hide = message.loading(t("bootstrap.new.downloadingBackup"), 0);
        try {
          const salt = makeSalt();
          const key = await passphraseCtx.keyFor(salt);
          const envelopeBytes = await makeInitialBackup({ salt, key });
          await downloadTarget({ filename: "hipo-backup-initial.bin" }).put(
            envelopeBytes,
          );
        } finally {
          hide();
        }
      }

      await markOpfsBootstrapped();
      message.success(t("bootstrap.new.successMessage"));
      // Reload so the full app boots; main.tsx now sees the marker and
      // takes the regular in-page-backend path → /setup → admin creation.
      window.location.reload();
    } catch (e) {
      passphraseCtx.clear();
      message.error(String(e));
      setSubmitting(false);
    }
  };

  return (
    <>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("bootstrap.new.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("bootstrap.new.description")}
      </Typography.Paragraph>
      <Alert
        type="warning"
        showIcon
        message={t("bootstrap.new.warningTitle")}
        description={t("bootstrap.new.warningDescription")}
        style={{ marginBottom: 16 }}
      />
      <Form<NewValues>
        layout="vertical"
        onFinish={onFinish}
        requiredMark={false}
        initialValues={{ downloadInitial: true }}
      >
        <Form.Item
          name="passphrase"
          label={t("bootstrap.new.passphrase")}
          rules={[
            { required: true, message: t("bootstrap.new.passphraseRequired") },
            rule((v) => {
              const code = checkPassphraseLength(v);
              return code === "passphrase.tooShort"
                ? t("bootstrap.new.passphraseTooShort")
                : null;
            }),
          ]}
        >
          <Input.Password autoFocus autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t("bootstrap.new.confirm")}
          dependencies={["passphrase"]}
          rules={[
            { required: true, message: t("bootstrap.new.confirmRequired") },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("passphrase") === value)
                  return Promise.resolve();
                return Promise.reject(
                  new Error(t("bootstrap.new.passphrasesDontMatch")),
                );
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="downloadInitial" valuePropName="checked">
          <Checkbox>
            <Space direction="vertical" size={0}>
              <span>{t("bootstrap.new.downloadInitial")}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("bootstrap.new.downloadHint")}
              </Typography.Text>
            </Space>
          </Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          {t("bootstrap.new.continue")}
        </Button>
      </Form>
    </>
  );
}

// ----- Restore -----

type RestoreValues = { passphrase: string };

function BootstrapRestorePanel() {
  const { t } = useTranslation();
  const passphraseCtx = usePassphrase();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: RestoreValues) => {
    if (!file) {
      message.error(t("bootstrap.restore.fileRequired"));
      return;
    }
    setSubmitting(true);
    const hide = message.loading(t("bootstrap.restore.restoring"), 0);
    try {
      passphraseCtx.setPassphrase(values.passphrase);
      const envelopeBytes = await readEnvelopeFromFile(file);
      // Peek at the salt by unpacking before deriving — the helper
      // re-unpacks internally but we need the salt to derive a key.
      const { unpackEnvelope } = await import("@hipo/backup");
      const env = unpackEnvelope(envelopeBytes);
      const key = await passphraseCtx.keyFor(env.salt);
      await applyRestoredBackup({ envelopeBytes, key });
      await markOpfsBootstrapped();
      hide();
      message.success(t("bootstrap.restore.successMessage"));
      // Hard reload so the worker boots a fresh DB handle on the
      // newly-overwritten OPFS file.
      window.location.reload();
    } catch (e) {
      hide();
      passphraseCtx.clear();
      // AES-GCM auth failures are the common case; surface a friendly
      // message but log the raw error for debugging.
      // eslint-disable-next-line no-console
      console.warn("[hipo] restore failed:", e);
      message.error(t("bootstrap.restore.decryptFailed"));
      setSubmitting(false);
    }
  };

  return (
    <>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("bootstrap.restore.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("bootstrap.restore.description")}
      </Typography.Paragraph>
      <Form<RestoreValues>
        layout="vertical"
        onFinish={onFinish}
        requiredMark={false}
      >
        <Form.Item label={t("bootstrap.restore.pickFile")}>
          <input
            type="file"
            accept=".bin,application/octet-stream"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
            }}
          />
          {file && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("bootstrap.restore.fileSelected", {
                name: file.name,
                bytes: file.size,
              })}
            </Typography.Text>
          )}
        </Form.Item>
        <Form.Item
          name="passphrase"
          label={t("bootstrap.restore.passphrase")}
          rules={[
            {
              required: true,
              message: t("bootstrap.restore.passphraseRequired"),
            },
          ]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={submitting}
          disabled={!file}
        >
          {t("bootstrap.restore.restoreNow")}
        </Button>
      </Form>
    </>
  );
}
