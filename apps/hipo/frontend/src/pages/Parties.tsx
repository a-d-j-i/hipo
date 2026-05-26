import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Space,
  Table,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { checkPartyName } from "@hipo/shared";
import { useAuth } from "../auth/AuthContext";
import { useResponsiveDrawerWidth } from "../hooks/useIsMobile";
import { rule } from "../lib/antdRules";
import * as api from "../parties/api";
import type { Party } from "@hipo/shared";

type FormValues = {
  name: string;
  externalRef?: string;
  notes?: string;
};

export default function Parties() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Party | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const drawerWidth = useResponsiveDrawerWidth(420);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setParties(await api.listParties());
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    form.resetFields();
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (p: Party) => {
    form.resetFields();
    form.setFieldsValue({
      name: p.name,
      externalRef: p.external_ref ?? undefined,
      notes: p.notes ?? undefined,
    });
    setEditing(p);
    setCreating(false);
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const onSubmit = async (values: FormValues) => {
    const input = {
      name: values.name,
      externalRef: values.externalRef ?? null,
      notes: values.notes ?? null,
    };
    try {
      if (editing) {
        await api.updateParty({ id: editing.id, ...input });
        message.success(t("parties.toast.saved"));
      } else {
        await api.createParty(input);
        message.success(t("parties.toast.created"));
      }
      close();
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onDelete = async (p: Party) => {
    try {
      await api.deleteParty({ id: p.id });
      message.success(t("parties.toast.deleted"));
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const open = creating || editing !== null;
  const drawerTitle = editing
    ? t("parties.drawerTitle.edit", { name: editing.name })
    : t("parties.drawerTitle.add");

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t("parties.addParty")}
        </Button>
      </Space>
      <Table<Party>
        rowKey="id"
        loading={loading}
        dataSource={parties}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("parties.column.name"), dataIndex: "name" },
          {
            title: t("parties.column.reference"),
            dataIndex: "external_ref",
            render: (v: string | null) => v ?? "—",
          },
          {
            title: t("parties.column.created"),
            dataIndex: "created_at",
            width: 180,
            render: (ts: number) => dayjs.unix(ts).format("YYYY-MM-DD HH:mm"),
          },
          {
            title: "",
            key: "actions",
            width: 140,
            render: (_, p) => (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEdit(p)} />
                <Popconfirm
                  title={t("parties.confirmDelete", { name: p.name })}
                  okText={t("common.delete")}
                  okButtonProps={{ danger: true }}
                  disabled={!isAdmin}
                  onConfirm={() => onDelete(p)}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={!isAdmin}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={drawerTitle}
        open={open}
        onClose={close}
        size={drawerWidth}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          requiredMark={false}
        >
          <Form.Item
            name="name"
            label={t("parties.form.name")}
            rules={[
              { required: true, message: t("parties.form.nameRequired") },
              rule(checkPartyName),
            ]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="externalRef" label={t("parties.form.externalRef")}>
            <Input />
          </Form.Item>
          <Form.Item name="notes" label={t("parties.form.notes")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {editing ? t("common.save") : t("common.create")}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
