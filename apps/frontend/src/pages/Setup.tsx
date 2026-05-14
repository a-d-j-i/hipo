import { Alert, Button, Card, Form, Input, message, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";

type FormValues = { username: string; password: string; confirm: string };

export default function Setup() {
  const { setupFirstAdmin } = useAuth();
  const { t } = useTranslation();

  const onFinish = async (values: FormValues) => {
    try {
      await setupFirstAdmin(values.username, values.password);
      message.success(t("auth.setup.success"));
    } catch (e) {
      message.error(String(e));
    }
  };

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
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t("auth.setup.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("auth.setup.description")}
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          message={t("auth.setup.warningTitle")}
          description={t("auth.setup.warningDescription")}
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label={t("auth.setup.username")}
            rules={[
              { required: true, message: t("auth.setup.usernameRequired") },
            ]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("auth.setup.password")}
            rules={[
              { required: true, message: t("auth.setup.passwordRequired") },
              { min: 8, message: t("common.atLeast8Chars") },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label={t("auth.setup.confirm")}
            dependencies={["password"]}
            rules={[
              { required: true, message: t("auth.setup.confirmRequired") },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value)
                    return Promise.resolve();
                  return Promise.reject(
                    new Error(t("auth.setup.passwordsDontMatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("auth.setup.createAdmin")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
