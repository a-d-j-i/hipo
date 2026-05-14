import type { Db } from "../db/client.ts";
import { auditLog } from "../db/schema.ts";

/**
 * Drizzle transaction handle, derived from the db.transaction callback signature
 * — avoids manual generic instantiation, which is fragile across Drizzle versions.
 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export async function writeAudit(
  tx: Tx,
  userId: number,
  action: string,
  entityType: string,
  entityId: number | null,
  payload: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    at: nowSecs(),
    userId,
    action,
    entityType,
    entityId,
    payload: JSON.stringify(payload ?? {}),
  });
}
