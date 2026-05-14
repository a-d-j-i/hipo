import { checkPartyName, normalizeOptional } from "@hipo/shared";
import { badRequest } from "../errors.ts";

export function validateName(name: string): void {
  const err = checkPartyName(name);
  if (err) throw badRequest(err);
}

// Re-export so existing consumers (parties/operations.ts) keep their import
// path. New code should reach for `normalizeOptional` from @hipo/shared.
export { normalizeOptional as normalizeOpt };
