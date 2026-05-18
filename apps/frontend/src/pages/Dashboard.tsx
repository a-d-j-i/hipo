import { useEffect, useState } from "react";
import { Space, Typography } from "antd";
import { getSystemStatus, type SystemStatus } from "../api/system";
import { RiskBanner } from "../backup/RiskBanner";

export default function Dashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getSystemStatus();
        if (!cancelled) setStatus(s);
      } catch (e) {
        // Status is non-fatal for the dashboard — just don't render
        // the banner. The Settings panel surfaces the same error.
        // eslint-disable-next-line no-console
        console.warn("[hipo] dashboard: getSystemStatus failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {status && <RiskBanner status={status} mode="dashboard" />}
      <Typography.Paragraph>
        Dashboard placeholder. Summary widgets land here.
      </Typography.Paragraph>
    </Space>
  );
}
