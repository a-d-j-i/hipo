import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { useIsMobile, useResponsiveDrawerWidth } from "../hooks/useIsMobile";
import * as api from "./api";
import { formatCents, majorToCents } from "../loans/format";
import type { DebtorPayment } from "../bindings/DebtorPayment";
import type { Loan } from "../bindings/Loan";

type FormValues = {
  amount: number;
  paidAt: Dayjs;
  notes?: string;
};

export default function PaymentsDrawer({
  loan,
  open,
  onClose,
}: {
  loan: Loan | null;
  open: boolean;
  onClose: () => void;
}) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [payments, setPayments] = useState<DebtorPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm<FormValues>();
  const drawerWidth = useResponsiveDrawerWidth(720);
  const isMobile = useIsMobile();

  const refresh = useCallback(async () => {
    if (!loan) return;
    setLoading(true);
    try {
      setPayments(await api.listLoanPayments({ loanId: loan.id }));
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [loan]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ paidAt: dayjs() });
      refresh();
    } else {
      setPayments([]);
    }
  }, [open, loan, form, refresh]);

  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + p.amount_cents, 0),
    [payments],
  );
  const totalOwed = (loan?.principal_cents ?? 0) + (loan?.interest_cents ?? 0);
  const outstanding = totalOwed - totalPaid;

  const onSubmit = async (v: FormValues) => {
    if (!loan) return;
    try {
      await api.createDebtorPayment({
        loanId: loan.id,
        amountCents: majorToCents(v.amount),
        paidAt: v.paidAt.unix(),
        notes: v.notes?.trim() || null,
      });
      message.success(t("payments.toast.recorded"));
      form.resetFields();
      form.setFieldsValue({ paidAt: dayjs() });
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onDelete = async (p: DebtorPayment) => {
    try {
      await api.deleteDebtorPayment({ id: p.id });
      message.success(t("payments.toast.deleted"));
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const ccy = loan?.currency_code ?? "USD";

  return (
    <Drawer
      title={
        loan
          ? t("payments.drawerTitle", {
              ref: loan.reference ?? `#${loan.id}`,
              debtor: loan.debtor_name,
            })
          : ""
      }
      open={open}
      onClose={onClose}
      width={drawerWidth}
      destroyOnClose
    >
      {loan && (
        <>
          <Descriptions
            size="small"
            column={isMobile ? 1 : 2}
            style={{ marginBottom: 16 }}
            bordered
          >
            <Descriptions.Item label={t("payments.summary.principal")}>
              {formatCents(loan.principal_cents, ccy)}
            </Descriptions.Item>
            <Descriptions.Item label={t("payments.summary.interest")}>
              {formatCents(loan.interest_cents, ccy)}
            </Descriptions.Item>
            <Descriptions.Item label={t("payments.summary.paidSoFar")}>
              {formatCents(totalPaid, ccy)}
            </Descriptions.Item>
            <Descriptions.Item label={t("payments.summary.outstanding")}>
              <Typography.Text
                strong
                type={outstanding > 0 ? "warning" : "success"}
              >
                {formatCents(outstanding, ccy)}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>

          {loan.status === "closed" ? (
            <Alert
              type="info"
              showIcon
              message={t("payments.loanClosedAlert")}
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Form
              form={form}
              layout={isMobile ? "vertical" : "inline"}
              onFinish={onSubmit}
              style={{ marginBottom: 16 }}
              requiredMark={false}
            >
              <Form.Item
                name="amount"
                label={t("payments.form.amount")}
                rules={[
                  { required: true, message: t("common.required") },
                  { type: "number", min: 0.01, message: "> 0" },
                ]}
              >
                <InputNumber<number>
                  min={0}
                  step={0.01}
                  style={{ width: isMobile ? "100%" : 160 }}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </Form.Item>
              <Form.Item
                name="paidAt"
                label={t("payments.form.paidAt")}
                rules={[{ required: true }]}
              >
                <DatePicker style={{ width: isMobile ? "100%" : undefined }} />
              </Form.Item>
              <Form.Item
                name="notes"
                label={t("payments.form.notes")}
                style={{ flex: 1 }}
              >
                <Input placeholder={t("payments.notesPlaceholder")} />
              </Form.Item>
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<PlusOutlined />}
                  block={isMobile}
                >
                  {t("payments.form.record")}
                </Button>
              </Form.Item>
            </Form>
          )}

          <Table<DebtorPayment>
            rowKey="id"
            loading={loading}
            dataSource={payments}
            size="small"
            pagination={false}
            scroll={{ x: "max-content" }}
            expandable={{
              expandedRowRender: (p) => (
                <Table
                  rowKey="lender_id"
                  size="small"
                  pagination={false}
                  dataSource={p.splits}
                  columns={[
                    {
                      title: t("payments.column.lender"),
                      dataIndex: "lender_name",
                    },
                    {
                      title: t("payments.column.share"),
                      dataIndex: "amount_cents",
                      align: "right",
                      render: (c: number) => formatCents(c, ccy),
                    },
                  ]}
                />
              ),
            }}
            columns={[
              {
                title: t("payments.column.date"),
                dataIndex: "paid_at",
                width: 120,
                render: (ts: number) => dayjs.unix(ts).format("YYYY-MM-DD"),
              },
              {
                title: t("payments.column.amount"),
                dataIndex: "amount_cents",
                align: "right",
                render: (c: number) => formatCents(c, ccy),
              },
              {
                title: t("payments.column.notes"),
                dataIndex: "notes",
                render: (v) => v ?? "—",
              },
              {
                title: "",
                key: "actions",
                width: 60,
                render: (_, p) => (
                  <Popconfirm
                    title={t("payments.confirmDelete")}
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
        </>
      )}
    </Drawer>
  );
}
