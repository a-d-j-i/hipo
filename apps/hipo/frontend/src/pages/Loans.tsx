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
  checkCurrencyCode,
  checkLenders,
  checkPromoters,
  COMMON_CURRENCIES,
  formatCents,
  LOAN_PROMOTER_SHARE_BPS_MAX,
  majorToCents,
} from "@hipo/shared";
import { rule } from "../lib/antdRules";
import type { Loan } from "@hipo/shared";
import type { LoanLenderInput, LoanPromoterInput } from "@hipo/shared";
import type { LoanStatus } from "@hipo/shared";
import type { Party } from "@hipo/shared";

type LenderRow = { lenderId: number | null; amount: number | null };
type PromoterRow = { partyId: number | null; percent: number | null };

type CreateFormValues = {
  reference?: string;
  debtorId: number;
  currencyCode: string;
  interest: number;
  issuedAt: Dayjs;
  notes?: string;
  lenders: LenderRow[];
  promoters: PromoterRow[];
};

type EditFormValues = {
  reference?: string;
  interest: number;
  issuedAt: Dayjs;
  status: LoanStatus;
  notes?: string;
};

type LendersFormValues = { lenders: LenderRow[] };
type PromotersFormValues = { promoters: PromoterRow[] };

function rowsToPromoterInput(rows: PromoterRow[]): LoanPromoterInput[] {
  // % stored as a 2-decimal value (e.g. 12.5 = 12.5%); bps is the integer
  // 100x that (12.5% → 1250 bps). Rounding here is safe because the
  // shared `checkPromoters` rejects non-integer bps.
  return rows
    .filter((r) => r?.partyId != null && r?.percent != null && r.percent > 0)
    .map((r) => ({
      partyId: r.partyId!,
      shareBps: Math.round(r.percent! * 100),
    }));
}

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
            // Only run shared cross-row checks on fully-filled rows;
            // incomplete rows are flagged by their own per-row rules.
            const complete = value.filter(
              (r) => r?.lenderId != null && r?.amount != null && r.amount > 0,
            );
            if (complete.length === 0) return;
            const err = checkLenders(
              complete.map((r) => ({
                lenderId: r.lenderId!,
                amountLentCents: majorToCents(r.amount!),
              })),
            );
            if (err) throw new Error(err);
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
                    {
                      validator: async (_, value) => {
                        if (value == null) return;
                        const duplicated = rows.some(
                          (r, i) => i !== field.name && r?.lenderId === value,
                        );
                        if (duplicated)
                          throw new Error(t("loans.lenders.duplicate"));
                      },
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

function PromotersEditor({
  parties,
  lenderRows,
  fieldName = "promoters",
}: {
  parties: Party[];
  lenderRows: LenderRow[];
  fieldName?: string;
}) {
  const { t } = useTranslation();
  const watched = Form.useWatch(fieldName) as PromoterRow[] | undefined;
  const rows = watched ?? [];
  const sumPercent = rows.reduce((s, r) => s + (r?.percent ?? 0), 0);

  const partyOptions = parties.map((p) => ({ value: p.id, label: p.name }));

  return (
    <Form.List
      name={fieldName}
      rules={[
        {
          validator: async (_, value: PromoterRow[]) => {
            const complete = (value ?? []).filter(
              (r) => r?.partyId != null && r?.percent != null && r.percent > 0,
            );
            if (complete.length === 0) return;
            const err = checkPromoters(rowsToPromoterInput(complete));
            if (err) throw new Error(err);
            const lenderIds = new Set(
              (lenderRows ?? [])
                .map((l) => l?.lenderId)
                .filter((x): x is number => x != null),
            );
            for (const r of complete) {
              if (lenderIds.has(r.partyId!))
                throw new Error(t("loans.promoters.bothLenderAndPromoter"));
            }
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <>
          {fields.map((field) => (
            <Space
              key={field.key}
              align="baseline"
              style={{ display: "flex", marginBottom: 8 }}
            >
              <Form.Item
                name={[field.name, "partyId"]}
                rules={[
                  {
                    required: true,
                    message: t("loans.promoters.partyPlaceholder"),
                  },
                ]}
                style={{ marginBottom: 0, minWidth: 200 }}
              >
                <Select
                  placeholder={t("loans.promoters.partyPlaceholder")}
                  options={partyOptions}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item
                name={[field.name, "percent"]}
                rules={[
                  {
                    required: true,
                    message: t("loans.promoters.percentPlaceholder"),
                  },
                  { type: "number", min: 0.01, message: "> 0" },
                  {
                    type: "number",
                    max: 99.99,
                    message: `< 100%`,
                  },
                ]}
                style={{ marginBottom: 0, minWidth: 140 }}
              >
                <InputNumber<number>
                  placeholder={t("loans.promoters.percentPlaceholder")}
                  min={0}
                  max={100}
                  step={0.01}
                  style={{ width: "100%" }}
                  inputMode="decimal"
                  addonAfter="%"
                />
              </Form.Item>
              <Button danger type="text" onClick={() => remove(field.name)}>
                {t("loans.lenders.remove")}
              </Button>
            </Space>
          ))}
          <Form.ErrorList errors={errors} />
          <Button
            type="dashed"
            onClick={() => add({ partyId: null, percent: null })}
            icon={<PlusOutlined />}
            block
            style={{ marginBottom: 8 }}
          >
            {t("loans.promoters.add")}
          </Button>
          <Typography.Paragraph
            type={
              sumPercent >= LOAN_PROMOTER_SHARE_BPS_MAX / 100
                ? "danger"
                : "secondary"
            }
            style={{ marginTop: 8 }}
          >
            {t("loans.promoters.sumLabel", {
              pct: sumPercent.toFixed(2),
            })}
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
  const [managingPromoters, setManagingPromoters] = useState<Loan | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Loan | null>(null);

  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<EditFormValues>();
  const [lendersForm] = Form.useForm<LendersFormValues>();
  const [promotersForm] = Form.useForm<PromotersFormValues>();
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
      promoters: [],
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

  const openManagePromoters = (l: Loan) => {
    promotersForm.resetFields();
    promotersForm.setFieldsValue({
      promoters: l.promoters.map((p) => ({
        partyId: p.party_id,
        percent: p.share_bps / 100,
      })),
    });
    setManagingPromoters(l);
  };

  const onCreate = async (v: CreateFormValues) => {
    try {
      const lenders: LoanLenderInput[] = v.lenders.map((r) => ({
        lenderId: r.lenderId!,
        amountLentCents: majorToCents(r.amount!),
      }));
      const promoters = rowsToPromoterInput(v.promoters ?? []);
      await loansApi.createLoan({
        reference: v.reference?.trim() || null,
        debtorId: v.debtorId,
        currencyCode: v.currencyCode,
        interestCents: majorToCents(v.interest ?? 0),
        issuedAt: v.issuedAt.unix(),
        notes: v.notes?.trim() || null,
        lenders,
        promoters: promoters.length > 0 ? promoters : undefined,
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

  const onSetPromoters = async (v: PromotersFormValues) => {
    if (!managingPromoters) return;
    try {
      const promoters = rowsToPromoterInput(v.promoters ?? []);
      await loansApi.setLoanPromoters({
        loanId: managingPromoters.id,
        promoters,
      });
      message.success(t("loans.toast.promotersUpdated"));
      setManagingPromoters(null);
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
  const createLenderRows =
    (Form.useWatch("lenders", createForm) as LenderRow[] | undefined) ?? [];
  const managePromotersLenderRows: LenderRow[] =
    managingPromoters?.lenders.map((l) => ({
      lenderId: l.lender_id,
      amount: centsToMajor(l.amount_lent_cents),
    })) ?? [];

  const refOf = (l: Loan | null) => (l ? (l.reference ?? `#${l.id}`) : "");

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
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text strong>
                {t("loans.form.lendersSection")}
              </Typography.Text>
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
              {loan.promoters.length > 0 ? (
                <>
                  <Typography.Text strong style={{ marginTop: 8 }}>
                    {t("loans.form.promotersSection")}
                  </Typography.Text>
                  <Table<Loan["promoters"][number]>
                    rowKey="party_id"
                    size="small"
                    pagination={false}
                    dataSource={loan.promoters}
                    columns={[
                      {
                        title: t("loans.promoters.party"),
                        dataIndex: "party_name",
                      },
                      {
                        title: t("loans.promoters.shareOfInterest"),
                        key: "share",
                        align: "right",
                        width: 200,
                        render: (_, p) => `${(p.share_bps / 100).toFixed(2)}%`,
                      },
                    ]}
                  />
                </>
              ) : null}
            </Space>
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
                <Button
                  onClick={() => openManagePromoters(l)}
                  title={t("loans.actionTitle.managePromoters")}
                >
                  %
                </Button>
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
              rules={[{ required: true }, rule(checkCurrencyCode)]}
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
          <Typography.Title level={5}>
            {t("loans.form.promotersSection")}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            {t("loans.form.promotersHelp")}
          </Typography.Paragraph>
          <PromotersEditor parties={parties} lenderRows={createLenderRows} />
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

      {/* Manage promoters drawer */}
      <Drawer
        title={
          managingPromoters
            ? t("loans.drawerTitle.managePromoters", {
                ref: refOf(managingPromoters),
              })
            : ""
        }
        open={managingPromoters !== null}
        onClose={() => setManagingPromoters(null)}
        width={wideDrawerWidth}
        destroyOnClose
      >
        <Form
          form={promotersForm}
          layout="vertical"
          onFinish={onSetPromoters}
          requiredMark={false}
        >
          <Typography.Paragraph type="secondary">
            {t("loans.form.promotersHelp")}
          </Typography.Paragraph>
          <PromotersEditor
            parties={parties}
            lenderRows={managePromotersLenderRows}
          />
          <Button type="primary" htmlType="submit" block>
            {t("common.save")}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
