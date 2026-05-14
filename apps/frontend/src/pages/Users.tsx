import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { DeleteOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import * as api from "../auth/api";
import { useResponsiveDrawerWidth } from "../hooks/useIsMobile";
import type { Role } from "../bindings/Role";
import type { User } from "../bindings/User";

type CreateValues = { username: string; password: string; role: Role };
type ResetValues = { password: string; confirm: string };

export default function Users() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [resetForm] = Form.useForm<ResetValues>();
  const drawerWidth = useResponsiveDrawerWidth(420);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async (values: CreateValues) => {
    try {
      await api.createUser(values);
      message.success(t("users.toast.created"));
      createForm.resetFields();
      setCreateOpen(false);
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onReset = async (values: ResetValues) => {
    if (!resetFor) return;
    try {
      await api.resetUserPassword({
        id: resetFor.id,
        newPassword: values.password,
      });
      message.success(
        t("users.toast.passwordReset", { username: resetFor.username }),
      );
      resetForm.resetFields();
      setResetFor(null);
    } catch (e) {
      message.error(String(e));
    }
  };

  const onChangeRole = async (user: User, role: Role) => {
    try {
      await api.changeUserRole({ id: user.id, role });
      message.success(
        t("users.toast.roleChanged", {
          username: user.username,
          role: t(`users.role.${role}`),
        }),
      );
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onDelete = async (user: User) => {
    try {
      await api.deleteUser({ id: user.id });
      message.success(t("users.toast.deleted", { username: user.username }));
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const roleOptions: { value: Role; label: string }[] = [
    { value: "admin", label: t("users.role.admin") },
    { value: "user", label: t("users.role.user") },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          {t("users.addUser")}
        </Button>
      </Space>
      <Table<User>
        rowKey="id"
        loading={loading}
        dataSource={users}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("users.column.username"), dataIndex: "username" },
          {
            title: t("users.column.role"),
            dataIndex: "role",
            width: 160,
            render: (_, user) => {
              const isSelf = user.id === currentUser?.id;
              if (isSelf) {
                return <Tag color="blue">{t(`users.role.${user.role}`)}</Tag>;
              }
              return (
                <Select<Role>
                  value={user.role}
                  style={{ width: 140 }}
                  onChange={(role) => onChangeRole(user, role)}
                  options={roleOptions}
                />
              );
            },
          },
          {
            title: t("users.column.created"),
            dataIndex: "created_at",
            width: 180,
            render: (ts: number) => dayjs.unix(ts).format("YYYY-MM-DD HH:mm"),
          },
          {
            title: "",
            key: "actions",
            width: 220,
            render: (_, user) => {
              const isSelf = user.id === currentUser?.id;
              return (
                <Space>
                  <Button
                    icon={<KeyOutlined />}
                    onClick={() => setResetFor(user)}
                  >
                    {t("users.actionTitle.resetPassword")}
                  </Button>
                  <Popconfirm
                    title={t("users.confirmDelete", {
                      username: user.username,
                    })}
                    okText={t("common.delete")}
                    okButtonProps={{ danger: true }}
                    disabled={isSelf}
                    onConfirm={() => onDelete(user)}
                  >
                    <Button danger icon={<DeleteOutlined />} disabled={isSelf} />
                  </Popconfirm>
                </Space>
              );
            },
          },
        ]}
      />

      <Drawer
        title={t("users.drawerTitle.add")}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={drawerWidth}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={onCreate}
          initialValues={{ role: "user" as Role }}
          requiredMark={false}
        >
          <Form.Item
            name="username"
            label={t("users.form.username")}
            rules={[
              { required: true, message: t("users.form.usernameRequired") },
            ]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("users.form.password")}
            rules={[
              { required: true, message: t("users.form.passwordRequired") },
              { min: 8, message: t("common.atLeast8Chars") },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="role"
            label={t("users.form.role")}
            rules={[{ required: true }]}
          >
            <Select options={roleOptions} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("common.create")}
          </Button>
        </Form>
      </Drawer>

      <Modal
        title={
          resetFor
            ? t("users.drawerTitle.resetFor", { username: resetFor.username })
            : ""
        }
        open={!!resetFor}
        onCancel={() => setResetFor(null)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={onReset}
          requiredMark={false}
        >
          <Form.Item
            name="password"
            label={t("users.form.newPassword")}
            rules={[
              { required: true, message: t("users.form.passwordRequired") },
              { min: 8, message: t("common.atLeast8Chars") },
            ]}
          >
            <Input.Password autoFocus />
          </Form.Item>
          <Form.Item
            name="confirm"
            label={t("users.form.confirm")}
            dependencies={["password"]}
            rules={[
              { required: true, message: t("users.form.confirmRequired") },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value)
                    return Promise.resolve();
                  return Promise.reject(
                    new Error(t("users.form.passwordsDontMatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("users.reset")}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
