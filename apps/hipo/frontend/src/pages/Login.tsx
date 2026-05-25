import { Button, Card, Form, Input, message, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";

type FormValues = { username: string; password: string };

export default function Login() {
  const { login } = useAuth();
  const { t } = useTranslation();

  const onFinish = async (values: FormValues) => {
    try {
      await login(values.username, values.password);
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
      <Card style={{ width: 360 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t("auth.login.title")}
        </Typography.Title>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label={t("auth.login.username")}
            rules={[
              { required: true, message: t("auth.login.usernameRequired") },
            ]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("auth.login.password")}
            rules={[
              { required: true, message: t("auth.login.passwordRequired") },
            ]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("auth.login.submit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
