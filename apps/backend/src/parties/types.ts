import type { Party as PartyRow } from "../db/schema.ts";

/** Public party shape. Matches src/bindings/Party.ts (snake_case). */
export type PublicParty = {
  id: number;
  name: string;
  external_ref: string | null;
  notes: string | null;
  created_at: number;
  created_by: number | null;
};

export type PartyInput = {
  name: string;
  externalRef: string | null;
  notes: string | null;
};

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
