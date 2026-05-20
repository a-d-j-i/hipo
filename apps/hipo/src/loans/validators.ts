import {
  checkCurrencyCode,
  checkLenders,
  checkLoanComposition,
  checkPromoters,
  type LoanLenderInput,
  type LoanPromoterInput,
  normalizeOptional,
  sumLenderAmounts,
} from "@hipo/shared";
import { badRequest } from "@hipo/server";

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

/** Validates the promoter list (may be empty). */
export function validatePromoters(promoters: LoanPromoterInput[]): void {
  const err = checkPromoters(promoters);
  if (err) throw badRequest(err);
}

/** No party may be both lender and promoter on the same loan. */
export function validateLoanComposition(
  lenders: LoanLenderInput[],
  promoters: LoanPromoterInput[],
): void {
  const err = checkLoanComposition(lenders, promoters);
  if (err) throw badRequest(err);
}

// Re-export so existing consumers (loans/operations.ts, payments/operations.ts,
// payouts/operations.ts) keep their import path. New code should reach for
// `normalizeOptional` from @hipo/shared.
export { normalizeOptional as normalizeOpt };
