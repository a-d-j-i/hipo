// Re-exports the API shapes from @hipo/shared under the Public* names used
// by operations/route handlers. Single source of truth lives in shared.
export type {
  AuditEntry as PublicAuditEntry,
  ListAuditLogInput,
} from "@hipo/shared";
