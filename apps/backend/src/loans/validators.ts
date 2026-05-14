import { badRequest } from "../errors.ts";
import type { LoanLenderInput } from "./types.ts";

export function validateCurrencyCode(code: string): void {
  if (code.length !== 3 || !/^[A-Z]{3}$/.test(code))
    throw badRequest("currency_code must be 3 uppercase letters (ISO 4217)");
}

/**
 * Validates the lender list and returns the principal (sum of contributions)
 * in cents. The principal is derived — not provided separately.
 */
export function validateLenders(lenders: LoanLenderInput[]): number {
  if (lenders.length === 0) throw badRequest("loan needs at least one lender");
  const seen = new Set<number>();
  let sum = 0;
  for (const l of lenders) {
    if (l.amountLentCents <= 0)
      throw badRequest("each lender amount must be > 0");
    if (seen.has(l.lenderId))
      throw badRequest(`lender ${l.lenderId} appears more than once`);
    seen.add(l.lenderId);
    sum += l.amountLentCents;
    if (!Number.isSafeInteger(sum))
      throw badRequest("lender amounts overflow");
  }
  return sum;
}

export function normalizeOpt(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}
