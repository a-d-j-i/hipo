import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Empty,
  message,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import * as auditApi from "../audit/api";
import * as authApi from "../auth/api";
import type { AuditEntry } from "@hipo/shared";
import type { User } from "@hipo/shared";

const PAGE_SIZE = 50;

const ENTITY_TYPE_VALUES = ["user", "party", "loan", "payment", "payout"];

const ACTION_COLORS: Record<string, string> = {
  create: "green",
  update: "blue",
  delete: "red",
  set_lenders: "blue",
  setup_first_admin: "green",
  password_reset: "orange",
  change_role: "orange",
  change_password: "orange",
};

function actionTagColor(action: string): string {
  const verb = action.split(".").slice(1).join(".");
  return ACTION_COLORS[verb] ?? "default";
}

function prettyPayload(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function AuditLog() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [entityType, setEntityType] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditApi.listAuditLog({
        entityType,
        userId,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setEntries(data);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [entityType, userId, page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    authApi
      .listUsers()
      .then(setUsers)
      .catch(() => {
        /* admin-only call; ignore failure */
      });
  }, []);

  const entityOptions = useMemo(
    () =>
      ENTITY_TYPE_VALUES.map((v) => ({
        value: v,
        label: t(`audit.entity.${v}`),
      })),
    [t],
  );

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.username })),
    [users],
  );

  const hasMore = entries.length === PAGE_SIZE;

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Text type="secondary">
          {t("audit.filter.entity")}
        </Typography.Text>
        <Select<string | null>
          value={entityType}
          onChange={(v) => {
            setEntityType(v);
            setPage(1);
          }}
          allowClear
          placeholder={t("common.all")}
          style={{ width: 160 }}
          options={entityOptions}
        />
        <Typography.Text type="secondary">
          {t("audit.filter.user")}
        </Typography.Text>
        <Select<number | null>
          value={userId}
          onChange={(v) => {
            setUserId(v);
            setPage(1);
          }}
          allowClear
          placeholder={t("common.all")}
          style={{ width: 180 }}
          showSearch
          optionFilterProp="label"
          options={userOptions}
        />
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          {t("common.refresh")}
        </Button>
      </Space>

      <Table<AuditEntry>
        rowKey="id"
        loading={loading}
        dataSource={entries}
        size="small"
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description={t("audit.emptyText")} /> }}
        expandable={{
          expandedRowRender: (e) => (
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 4,
                fontSize: 12,
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              {prettyPayload(e.payload)}
            </pre>
          ),
        }}
        columns={[
          {
            title: t("audit.column.when"),
            dataIndex: "at",
            width: 160,
            render: (ts: number) =>
              dayjs.unix(ts).format("YYYY-MM-DD HH:mm:ss"),
          },
          {
            title: t("audit.column.user"),
            dataIndex: "user_name",
            width: 160,
            render: (name: string | null) =>
              name ?? (
                <Typography.Text type="secondary" italic>
                  {t("audit.deletedUser")}
                </Typography.Text>
              ),
          },
          {
            title: t("audit.column.action"),
            dataIndex: "action",
            width: 200,
            render: (action: string) => (
              <Tag color={actionTagColor(action)}>{action}</Tag>
            ),
          },
          {
            title: t("audit.column.entity"),
            dataIndex: "entity_type",
            width: 100,
            render: (et: string) =>
              ENTITY_TYPE_VALUES.includes(et) ? t(`audit.entity.${et}`) : et,
          },
          {
            title: t("audit.column.id"),
            dataIndex: "entity_id",
            width: 80,
            render: (v: number | null) => v ?? "—",
          },
        ]}
      />

      <Space
        style={{ marginTop: 16, justifyContent: "flex-end", width: "100%" }}
      >
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          {t("common.previous")}
        </Button>
        <Typography.Text>{t("common.page", { n: page })}</Typography.Text>
        <Button disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          {t("common.next")}
        </Button>
      </Space>
    </>
  );
}
