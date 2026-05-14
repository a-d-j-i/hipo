/** Matches src/bindings/AuditEntry.ts (snake_case). */
export type PublicAuditEntry = {
  id: number;
  at: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  payload: string | null;
};

export type ListAuditLogInput = {
  entityType: string | null;
  userId: number | null;
  limit: number;
  offset: number;
};
