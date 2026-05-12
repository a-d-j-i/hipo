import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Button, Layout, Menu, Space, Tag, Typography } from "antd";
import {
  BankOutlined,
  ContactsOutlined,
  DashboardOutlined,
  HistoryOutlined,
  LogoutOutlined,
  SettingOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useAuth } from "../auth/AuthContext";

const { Sider, Header, Content } = Layout;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { t } = useTranslation();

  const menuItems = [
    { key: "/", icon: <DashboardOutlined />, label: t("nav.dashboard") },
    { key: "/loans", icon: <BankOutlined />, label: t("nav.loans") },
    { key: "/payouts", icon: <WalletOutlined />, label: t("nav.payouts") },
    { key: "/parties", icon: <ContactsOutlined />, label: t("nav.parties") },
    ...(currentUser?.role === "admin"
      ? [
          { key: "/users", icon: <UserOutlined />, label: t("nav.users") },
          { key: "/audit", icon: <HistoryOutlined />, label: t("nav.audit") },
        ]
      : []),
    { key: "/settings", icon: <SettingOutlined />, label: t("nav.settings") },
  ];

  const selectedKey = "/" + (location.pathname.split("/")[1] ?? "");
  const pageLabel =
    menuItems.find((i) => i.key === selectedKey)?.label ?? "";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
      >
        <div
          style={{
            height: 48,
            margin: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 18,
          }}
        >
          {collapsed ? "h" : "hipo"}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {pageLabel}
          </Typography.Title>
          <Space>
            <Typography.Text strong>{currentUser?.username}</Typography.Text>
            <Tag color={currentUser?.role === "admin" ? "blue" : "default"}>
              {currentUser?.role === "admin"
                ? t("users.role.admin")
                : t("users.role.user")}
            </Tag>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              {t("nav.logout")}
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: "#fff" }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
