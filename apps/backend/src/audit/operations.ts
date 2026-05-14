import { and, desc, eq, type SQL } from "drizzle-orm";
import { type Ctx, requireAdmin } from "../auth/types.ts";
import { auditLog, users } from "../db/schema.ts";
import type { ListAuditLogInput, AuditEntry } from "./types.ts";

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function doListAuditLog(
  ctx: Ctx,
  args: ListAuditLogInput,
): Promise<AuditEntry[]> {
  requireAdmin(ctx);
  const limit = clamp(args.limit, MIN_LIMIT, MAX_LIMIT);
  const offset = Math.max(0, args.offset);

  const conditions: SQL[] = [];
  if (args.entityType && args.entityType !== "")
    conditions.push(eq(auditLog.entityType, args.entityType));
  if (args.userId !== null) conditions.push(eq(auditLog.userId, args.userId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // LEFT JOIN users so soft-deleted users (preserved rows with deleted_at set)
  // still resolve to their username — audit attribution survives deletion.
  return await ctx.db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      user_id: auditLog.userId,
      user_name: users.username,
      action: auditLog.action,
      entity_type: auditLog.entityType,
      entity_id: auditLog.entityId,
      payload: auditLog.payload,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(whereClause)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset);
}
