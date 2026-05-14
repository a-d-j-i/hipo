import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { useResponsiveDrawerWidth } from "../hooks/useIsMobile";
import * as loansApi from "../loans/api";
import * as partiesApi from "../parties/api";
import PaymentsDrawer from "../payments/PaymentsDrawer";
import {
  centsToMajor,
  COMMON_CURRENCIES,
  formatCents,
  majorToCents,
} from "../loans/format";
import type { Loan } from "../bindings/Loan";
import type { LoanLenderInput } from "../bindings/LoanLenderInput";
import type { LoanStatus } from "../bindings/LoanStatus";
import type { Party } from "../bindings/Party";

type LenderRow = { lenderId: number | null; amount: number | null };

type CreateFormValues = {
  reference?: string;
  debtorId: number;
  currencyCode: string;
  interest: number;
  issuedAt: Dayjs;
  notes?: string;
  lenders: LenderRow[];
};

type EditFormValues = {
  reference?: string;
  interest: number;
  issuedAt: Dayjs;
  status: LoanStatus;
  notes?: string;
};

type LendersFormValues = { lenders: LenderRow[] };

function LendersEditor({
  parties,
  currencyCode,
  fieldName = "lenders",
}: {
  parties: Party[];
  currencyCode: string;
  fieldName?: string;
}) {
  const { t } = useTranslation();
  const watched = Form.useWatch(fieldName) as LenderRow[] | undefined;
  const rows = watched ?? [];
  const sumMajor = rows.reduce((s, r) => s + (r?.amount ?? 0), 0);

  const lenderOptions = parties.map((p) => ({ value: p.id, label: p.name }));

  return (
    <Form.List
      name={fieldName}
      rules={[
        {
          validator: async (_, value: LenderRow[]) => {
            if (!value || value.length === 0)
              throw new Error(t("loans.lenders.atLeastOne"));
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <>
          {fields.map((field) => {
            const row = rows[field.name];
            const pct =
              sumMajor > 0 && row?.amount ? (row.amount / sumMajor) * 100 : 0;
            return (
              <Space
                key={field.key}
                align="baseline"
                style={{ display: "flex", marginBottom: 8 }}
              >
                <Form.Item
                  name={[field.name, "lenderId"]}
                  rules={[
                    {
                      required: true,
                      message: t("loans.lenders.lenderPlaceholder"),
                    },
                  ]}
                  style={{ marginBottom: 0, minWidth: 200 }}
                >
                  <Select
                    placeholder={t("loans.lenders.lenderPlaceholder")}
                    options={lenderOptions}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, "amount"]}
                  rules={[
                    {
                      required: true,
                      message: t("loans.lenders.amountPlaceholder"),
                    },
                    { type: "number", min: 0.01, message: "> 0" },
                  ]}
                  style={{ marginBottom: 0, minWidth: 140 }}
                >
                  <InputNumber<number>
                    placeholder={t("loans.lenders.amountPlaceholder")}
                    min={0}
                    step={0.01}
                    style={{ width: "100%" }}
                    inputMode="decimal"
                  />
                </Form.Item>
                <Typography.Text
                  type="secondary"
                  style={{ minWidth: 60, display: "inline-block" }}
                >
                  {pct.toFixed(2)}%
                </Typography.Text>
                <Button danger type="text" onClick={() => remove(field.name)}>
                  {t("loans.lenders.remove")}
                </Button>
              </Space>
            );
          })}
          <Form.ErrorList errors={errors} />
          <Button
            type="dashed"
            onClick={() => add({ lenderId: null, amount: null })}
            icon={<PlusOutlined />}
            block
            style={{ marginBottom: 8 }}
          >
            {t("loans.lenders.add")}
          </Button>
          <Typography.Paragraph strong style={{ marginTop: 8 }}>
            {t("loans.form.principal")}:{" "}
            {formatCents(majorToCents(sumMajor), currencyCode || "USD")}
          </Typography.Paragraph>
        </>
      )}
    </Form.List>
  );
}

export default function Loans() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [loans, setLoans] = useState<Loan[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [managingLenders, setManagingLenders] = useState<Loan | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Loan | null>(null);

  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<EditFormValues>();
  const [lendersForm] = Form.useForm<LendersFormValues>();
  const wideDrawerWidth = useResponsiveDrawerWidth(560);
  const editDrawerWidth = useResponsiveDrawerWidth(460);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ls, ps] = await Promise.all([
        loansApi.listLoans(),
        partiesApi.listParties(),
      ]);
      setLoans(ls);
      setParties(ps);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const debtorOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      currencyCode: "ARS",
      issuedAt: dayjs(),
      interest: 0,
      lenders: [{ lenderId: null, amount: null }],
    });
    setCreating(true);
  };

  const openEdit = (l: Loan) => {
    editForm.resetFields();
    editForm.setFieldsValue({
      reference: l.reference ?? undefined,
      interest: centsToMajor(l.interest_cents),
      issuedAt: dayjs.unix(l.issued_at),
      status: l.status,
      notes: l.notes ?? undefined,
    });
    setEditing(l);
  };

  const openManageLenders = (l: Loan) => {
    lendersForm.resetFields();
    lendersForm.setFieldsValue({
      lenders: l.lenders.map((ll) => ({
        lenderId: ll.lender_id,
        amount: centsToMajor(ll.amount_lent_cents),
      })),
    });
    setManagingLenders(l);
  };

  const onCreate = async (v: CreateFormValues) => {
    try {
      const lenders: LoanLenderInput[] = v.lenders.map((r) => ({
        lenderId: r.lenderId!,
        amountLentCents: majorToCents(r.amount!),
      }));
      await loansApi.createLoan({
        reference: v.reference?.trim() || null,
        debtorId: v.debtorId,
        currencyCode: v.currencyCode,
        interestCents: majorToCents(v.interest ?? 0),
        issuedAt: v.issuedAt.unix(),
        notes: v.notes?.trim() || null,
        lenders,
      });
      message.success(t("loans.toast.created"));
      setCreating(false);
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onUpdate = async (v: EditFormValues) => {
    if (!editing) return;
    try {
      await loansApi.updateLoan({
        id: editing.id,
        reference: v.reference?.trim() || null,
        interestCents: majorToCents(v.interest ?? 0),
        issuedAt: v.issuedAt.unix(),
        status: v.status,
        notes: v.notes?.trim() || null,
      });
      message.success(t("loans.toast.saved"));
      setEditing(null);
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onSetLenders = async (v: LendersFormValues) => {
    if (!managingLenders) return;
    try {
      const lenders: LoanLenderInput[] = v.lenders.map((r) => ({
        lenderId: r.lenderId!,
        amountLentCents: majorToCents(r.amount!),
      }));
      await loansApi.setLoanLenders({
        loanId: managingLenders.id,
        lenders,
      });
      message.success(t("loans.toast.lendersUpdated"));
      setManagingLenders(null);
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const onDelete = async (l: Loan) => {
    try {
      await loansApi.deleteLoan({ id: l.id });
      message.success(t("loans.toast.deleted"));
      refresh();
    } catch (e) {
      message.error(String(e));
    }
  };

  const createCurrency = Form.useWatch("currencyCode", createForm) ?? "ARS";

  const refOf = (l: Loan | null) =>
    l ? l.reference ?? `#${l.id}` : "";

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t("loans.newLoan")}
        </Button>
      </Space>
      <Table<Loan>
        rowKey="id"
        loading={loading}
        dataSource={loans}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (loan) => (
            <Table<Loan["lenders"][number]>
              rowKey="lender_id"
              size="small"
              pagination={false}
              dataSource={loan.lenders}
              columns={[
                {
                  title: t("payments.column.lender"),
                  dataIndex: "lender_name",
                },
                {
                  title: t("loans.column.principal"),
                  dataIndex: "amount_lent_cents",
                  align: "right",
                  render: (c: number) => formatCents(c, loan.currency_code),
                },
                {
                  title: t("payments.column.share"),
                  key: "share",
                  align: "right",
                  width: 100,
                  render: (_, ll) =>
                    `${((ll.amount_lent_cents / loan.principal_cents) * 100).toFixed(2)}%`,
                },
              ]}
            />
          ),
        }}
        columns={[
          {
            title: t("loans.column.ref"),
            dataIndex: "reference",
            render: (v) => v ?? "—",
            width: 100,
          },
          { title: t("loans.column.debtor"), dataIndex: "debtor_name" },
          {
            title: t("loans.column.principal"),
            key: "principal",
            align: "right",
            render: (_, l) => formatCents(l.principal_cents, l.currency_code),
          },
          {
            title: t("loans.column.interest"),
            key: "interest",
            align: "right",
            render: (_, l) =>
              l.interest_cents > 0
                ? formatCents(l.interest_cents, l.currency_code)
                : "—",
          },
          {
            title: t("loans.column.status"),
            dataIndex: "status",
            width: 100,
            render: (s: LoanStatus) => (
              <Tag color={s === "active" ? "green" : "default"}>
                {t(`loans.status.${s}`)}
              </Tag>
            ),
          },
          {
            title: t("loans.column.issued"),
            dataIndex: "issued_at",
            width: 120,
            render: (ts: number) => dayjs.unix(ts).format("YYYY-MM-DD"),
          },
          {
            title: "",
            key: "actions",
            width: 220,
            render: (_, l) => (
              <Space>
                <Button
                  icon={<DollarOutlined />}
                  onClick={() => setPaymentsFor(l)}
                  title={t("loans.actionTitle.payments")}
                />
                <Button icon={<EditOutlined />} onClick={() => openEdit(l)} />
                <Button
                  icon={<TeamOutlined />}
                  onClick={() => openManageLenders(l)}
                  title={t("loans.actionTitle.manageLenders")}
                />
                <Popconfirm
                  title={t("loans.confirmDelete", { ref: refOf(l) })}
                  okText={t("common.delete")}
                  okButtonProps={{ danger: true }}
                  disabled={!isAdmin}
                  onConfirm={() => onDelete(l)}
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

      <PaymentsDrawer
        loan={paymentsFor}
        open={paymentsFor !== null}
        onClose={() => setPaymentsFor(null)}
      />

      {/* Create drawer */}
      <Drawer
        title={t("loans.drawerTitle.create")}
        open={creating}
        onClose={() => setCreating(false)}
        width={wideDrawerWidth}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={onCreate}
          requiredMark={false}
        >
          <Form.Item name="reference" label={t("loans.form.reference")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="debtorId"
            label={t("loans.form.debtor")}
            rules={[
              { required: true, message: t("loans.form.debtorRequired") },
            ]}
          >
            <Select
              options={debtorOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Space>
            <Form.Item
              name="currencyCode"
              label={t("loans.form.currency")}
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 110 }}
                options={COMMON_CURRENCIES.map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
            </Form.Item>
            <Form.Item name="interest" label={t("loans.form.interest")}>
              <InputNumber<number>
                min={0}
                step={0.01}
                style={{ width: 160 }}
                inputMode="decimal"
              />
            </Form.Item>
          </Space>
          <Form.Item
            name="issuedAt"
            label={t("loans.form.issuedAt")}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="notes" label={t("loans.form.notes")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Typography.Title level={5}>
            {t("loans.form.lendersSection")}
          </Typography.Title>
          <LendersEditor parties={parties} currencyCode={createCurrency} />
          <Button type="primary" htmlType="submit" block>
            {t("common.create")}
          </Button>
        </Form>
      </Drawer>

      {/* Edit drawer */}
      <Drawer
        title={
          editing ? t("loans.drawerTitle.edit", { ref: refOf(editing) }) : ""
        }
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={editDrawerWidth}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={onUpdate}
          requiredMark={false}
        >
          <Form.Item name="reference" label={t("loans.form.reference")}>
            <Input />
          </Form.Item>
          <Form.Item name="interest" label={t("loans.form.interest")}>
            <InputNumber<number>
              min={0}
              step={0.01}
              style={{ width: "100%" }}
              inputMode="decimal"
            />
          </Form.Item>
          <Form.Item
            name="issuedAt"
            label={t("loans.form.issuedAt")}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="status"
            label={t("loans.column.status")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "active", label: t("loans.status.active") },
                { value: "closed", label: t("loans.status.closed") },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label={t("loans.form.notes")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            {t("common.save")}
          </Button>
        </Form>
      </Drawer>

      {/* Manage lenders drawer */}
      <Drawer
        title={
          managingLenders
            ? t("loans.drawerTitle.manageLenders", {
                ref: refOf(managingLenders),
              })
            : ""
        }
        open={managingLenders !== null}
        onClose={() => setManagingLenders(null)}
        width={wideDrawerWidth}
        destroyOnClose
      >
        <Form
          form={lendersForm}
          layout="vertical"
          onFinish={onSetLenders}
          requiredMark={false}
        >
          <LendersEditor
            parties={parties}
            currencyCode={managingLenders?.currency_code ?? "USD"}
          />
          <Button type="primary" htmlType="submit" block>
            {t("common.save")}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
