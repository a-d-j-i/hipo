import type { Party } from "@hipo/shared";
import type { PartyRow } from "../db/schema.ts";

export type { Party, PartyInput } from "@hipo/shared";

export function publicParty(p: PartyRow): Party {
  return {
    id: p.id,
    name: p.name,
    external_ref: p.externalRef,
    notes: p.notes,
    created_at: p.createdAt,
    created_by: p.createdBy,
  };
}
