import {
  checkCurrencyCode,
  checkLenders,
  type LoanLenderInput,
  normalizeOptional,
  sumLenderAmounts,
} from "@hipo/shared";
import { badRequest } from "../errors.ts";

export function validateCurrencyCode(code: string): void {
  const err = checkCurrencyCode(code);
  if (err) throw badRequest(err);
}

/** Validates the lender list and returns the principal (sum of contributions). */
export function validateLenders(lenders: LoanLenderInput[]): number {
  const err = checkLenders(lenders);
  if (err) throw badRequest(err);
  return sumLenderAmounts(lenders);
}

// Re-export so existing consumers (loans/operations.ts, payments/operations.ts,
// payouts/operations.ts) keep their import path. New code should reach for
// `normalizeOptional` from @hipo/shared.
export { normalizeOptional as normalizeOpt };
