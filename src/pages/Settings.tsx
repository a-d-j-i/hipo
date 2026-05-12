import { Radio, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "../i18n";

export default function Settings() {
  const { t, i18n } = useTranslation();

  const onChange = (lng: Locale) => {
    void i18n.changeLanguage(lng);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
    } catch {
      /* localStorage may not be available */
    }
  };

  const active = (i18n.resolvedLanguage ?? i18n.language ?? "es") as Locale;

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
      <Typography.Paragraph type="secondary">
        {t("settings.placeholderNote")}
      </Typography.Paragraph>
    </Space>
  );
}
