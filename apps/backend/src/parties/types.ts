import type { Party as PartyRow } from "../db/schema.ts";
import type { Party as PublicPartyType } from "@hipo/shared";

export type { PartyInput } from "@hipo/shared";
export type PublicParty = PublicPartyType;

export function publicParty(p: PartyRow): PublicParty {
  return {
    id: p.id,
    name: p.name,
    external_ref: p.externalRef,
    notes: p.notes,
    created_at: p.createdAt,
    created_by: p.createdBy,
  };
}
