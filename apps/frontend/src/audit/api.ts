import { httpRequest } from "../api/http";
import type { AuditEntry } from "../bindings/AuditEntry";

export const listAuditLog = (args: {
  entityType: string | null;
  userId: number | null;
  limit: number;
  offset: number;
}) => {
  const q = new URLSearchParams();
  if (args.entityType) q.set("entity_type", args.entityType);
  if (args.userId !== null) q.set("user_id", String(args.userId));
  q.set("limit", String(args.limit));
  q.set("offset", String(args.offset));
  return httpRequest<AuditEntry[]>("GET", `/api/audit?${q.toString()}`);
};
