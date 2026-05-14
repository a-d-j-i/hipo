import { useState } from "react";
import { Button, Radio, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "../i18n";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
