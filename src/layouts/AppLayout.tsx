import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Button, Drawer, Grid, Layout, Menu, Space, Tag, Typography } from "antd";
import {
  BankOutlined,
  ContactsOutlined,
  DashboardOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useAuth } from "../auth/AuthContext";

const { Sider, Header, Content } = Layout;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

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

  const handleNavigate = (key: string) => {
    navigate(key);
    setDrawerOpen(false);
  };

  const brand = (
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
      {isMobile ? "hipo" : collapsed ? "h" : "hipo"}
    </div>
  );

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={({ key }) => handleNavigate(key)}
    />
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="light"
          breakpoint="md"
        >
          {brand}
          {menu}
        </Sider>
      )}
      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={240}
          styles={{ body: { padding: 0 } }}
        >
          {brand}
          {menu}
        </Drawer>
      )}
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: isMobile ? "0 12px" : "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Space>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setDrawerOpen(true)}
                size="large"
                aria-label={t("nav.openMenu")}
              />
            )}
            <Typography.Title
              level={isMobile ? 5 : 4}
              style={{ margin: 0, whiteSpace: "nowrap" }}
            >
              {pageLabel}
            </Typography.Title>
          </Space>
          <Space size={isMobile ? 4 : 8}>
            {!isMobile && (
              <Typography.Text strong>{currentUser?.username}</Typography.Text>
            )}
            <Tag color={currentUser?.role === "admin" ? "blue" : "default"}>
              {currentUser?.role === "admin"
                ? t("users.role.admin")
                : t("users.role.user")}
            </Tag>
            <Button
              icon={<LogoutOutlined />}
              onClick={logout}
              size={isMobile ? "middle" : "middle"}
            >
              {!isMobile && t("nav.logout")}
            </Button>
          </Space>
        </Header>
        <Content
          style={{
            margin: isMobile ? 12 : 24,
            padding: isMobile ? 12 : 24,
            background: "#fff",
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
