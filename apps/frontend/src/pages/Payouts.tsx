import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DollarOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { useResponsiveDrawerWidth } from "../hooks/useIsMobile";
import * as payoutsApi from "../payouts/api";
import { formatCents, majorToCents } from "@hipo/shared";
import type { LenderBalance } from "@hipo/shared";
import type { LenderPayout } from "@hipo/shared";

type FormValues = {
  amount: number;
  paidAt: Dayjs;
  notes?: string;
};

type Target = { lenderId: number; lenderName: string; currencyCode: string };

export default function Payouts() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [balances, setBalances] = useState<LenderBalance[]>([]);
  const [payouts, setPayouts] = useState<LenderPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordTarget, setRecordTarget] = useState<Target | null>(null);
  const [form] = Form.useForm<FormValues>();
  const drawerWidth = useResponsiveDrawerWidth(420);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [bs, ps] = await Promise.all([
        payoutsApi.lenderBalances(),
        payoutsApi.listPayouts(),
      ]);
      setBalances(bs);
      setPayouts(ps);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalOutstanding = useMemo(() => {
    const by: Record<string, number> = {};
    for (const b of balances) {
      by[b.currency_code] = (by[b.currency_code] ?? 0) + b.outstanding_cents;
    }
    return by;
  }, [balances]);

  const openRecord = (target: Target) => {
    form.resetFields();
    form.setFieldsValue({ paidAt: dayjs() });
    setRecordTarget(target);
  };

  const onSubmit = async (v: FormValues) => {
    if (!recordTarget) return;
    try {
      await payoutsApi.createLenderPayout({
        lenderId: recordTarget.lenderId,
        currencyCode: recordTarget.currencyCode,
        amountCents: majorToCents(v.amount),
        paidAt: v.paidAt.unix(),
        notes: v.notes?.trim() || null,
      });
      message.success(t("payouts.toast.recorded"));
      setRecordTarget(null);
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onDelete = async (p: LenderPayout) => {
    try {
      await payoutsApi.deleteLenderPayout({ id: p.id });
      message.success(t("payouts.toast.deleted"));
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("payouts.outstandingTitle")}
      </Typography.Title>
      {Object.keys(totalOutstanding).length > 0 && (
        <Space size="large" wrap style={{ marginBottom: 16 }}>
          {Object.entries(totalOutstanding).map(([ccy, total]) => (
            <Typography.Text key={ccy}>
              <Tag color="blue">{ccy}</Tag>
              <strong>{formatCents(total, ccy)}</strong>
            </Typography.Text>
          ))}
        </Space>
      )}
      <Table<LenderBalance>
        rowKey={(b) => `${b.lender_id}-${b.currency_code}`}
        loading={loading}
        dataSource={balances}
        pagination={false}
        size="small"
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description={t("payouts.emptyBalances")} /> }}
        style={{ marginBottom: 32 }}
        columns={[
          { title: t("payouts.column.lender"), dataIndex: "lender_name" },
          {
            title: t("payouts.column.currency"),
            dataIndex: "currency_code",
            width: 90,
            render: (c) => <Tag>{c}</Tag>,
          },
          {
            title: t("payouts.column.received"),
            dataIndex: "received_cents",
            align: "right",
            render: (c: number, b) => formatCents(c, b.currency_code),
          },
          {
            title: t("payouts.column.paidOut"),
            dataIndex: "paid_out_cents",
            align: "right",
            render: (c: number, b) => formatCents(c, b.currency_code),
          },
          {
            title: t("payouts.column.outstanding"),
            dataIndex: "outstanding_cents",
            align: "right",
            render: (c: number, b) => (
              <Typography.Text
                strong
                type={c > 0 ? "warning" : c < 0 ? "danger" : "success"}
              >
                {formatCents(c, b.currency_code)}
              </Typography.Text>
            ),
          },
          {
            title: "",
            key: "actions",
            width: 180,
            render: (_, b) => (
              <Button
                icon={<DollarOutlined />}
                onClick={() =>
                  openRecord({
                    lenderId: b.lender_id,
                    lenderName: b.lender_name,
                    currencyCode: b.currency_code,
                  })
                }
              >
                {t("payouts.record")}
              </Button>
            ),
          },
        ]}
      />

      <Typography.Title level={4}>
        {t("payouts.historyTitle")}
      </Typography.Title>
      <Table<LenderPayout>
        rowKey="id"
        loading={loading}
        dataSource={payouts}
        size="small"
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: t("payouts.column.date"),
            dataIndex: "paid_at",
            width: 120,
            render: (ts: number) => dayjs.unix(ts).format("YYYY-MM-DD"),
          },
          { title: t("payouts.column.lender"), dataIndex: "lender_name" },
          {
            title: t("payouts.column.currency"),
            dataIndex: "currency_code",
            width: 90,
            render: (c) => <Tag>{c}</Tag>,
          },
          {
            title: t("payouts.column.amount"),
            dataIndex: "amount_cents",
            align: "right",
            render: (c: number, p) => formatCents(c, p.currency_code),
          },
          {
            title: t("payouts.column.notes"),
            dataIndex: "notes",
            render: (v) => v ?? "—",
          },
          {
            title: "",
            key: "actions",
            width: 60,
            render: (_, p) => (
              <Popconfirm
                title={t("payouts.confirmDelete")}
                okText={t("common.delete")}
                okButtonProps={{ danger: true }}
                disabled={!isAdmin}
                onConfirm={() => onDelete(p)}
              >
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={!isAdmin}
                />
              </Popconfirm>
            ),
          },
        ]}
      />

      <Drawer
        title={
          recordTarget
            ? t("payouts.recordTo", {
                lender: recordTarget.lenderName,
                currency: recordTarget.currencyCode,
              })
            : ""
        }
        open={recordTarget !== null}
        onClose={() => setRecordTarget(null)}
        width={drawerWidth}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          requiredMark={false}
        >
          <Form.Item
            name="amount"
            label={t("payouts.form.amount")}
            rules={[
              { required: true, message: t("common.required") },
              { type: "number", min: 0.01, message: "> 0" },
            ]}
          >
            <InputNumber<number>
              autoFocus
              min={0}
              step={0.01}
              style={{ width: "100%" }}
              placeholder="0.00"
              inputMode="decimal"
            />
          </Form.Item>
          <Form.Item
            name="paidAt"
            label={t("payouts.form.paidAt")}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="notes" label={t("payouts.form.notes")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} block>
            {t("payouts.record")}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
