// Renders before the rest of the app when this tab couldn't acquire
// the single-tab Web Lock. The other tab owns the OPFS sync access
// handle; running both would silently diverge (the second Worker
// can't open the same DB, falls back to in-memory, audit reconciles
// to garbage). User can close the other tab to continue here — we
// poll navigator.locks.query() and reload as soon as the lock is
// released.

import { useEffect, useState } from "react";
import { Alert, Card, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { observeLockReleased } from "@hipo/server";

export default function MultiTabBlock() {
  const { t } = useTranslation();
  const [released, setReleased] = useState(false);

  useEffect(() => {
    const stop = observeLockReleased(() => {
      setReleased(true);
      // Small visible delay so the user notices the state change before
      // the reload navigates away.
      setTimeout(() => location.reload(), 600);
    });
    return stop;
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
        background: "#f5f5f5",
      }}
    >
      <Card style={{ maxWidth: 480, width: "100%" }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t("multiTab.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("multiTab.body")}
        </Typography.Paragraph>
        {released ? (
          <Alert
            type="success"
            showIcon
            message={t("multiTab.resuming")}
            icon={<Spin size="small" />}
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message={t("multiTab.waiting")}
            icon={<Spin size="small" />}
          />
        )}
      </Card>
    </div>
  );
}
