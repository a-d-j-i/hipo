import { invoke } from "@tauri-apps/api/core";
import type { AuditEntry } from "../bindings/AuditEntry";

export const listAuditLog = (args: {
  entityType: string | null;
  userId: number | null;
  limit: number;
  offset: number;
}) => invoke<AuditEntry[]>("list_audit_log", args);
