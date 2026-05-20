// Pure validation helpers shared by both the frontend (antd Form rules /
// preview-as-you-type checks) and the backend (do_* operations that throw
// on invalid input).
//
// Functions named `check*` return either `null` (input is valid) or a short
// English error message describing the violation. The backend wraps these in
// thin `validate*` functions that throw `AppError` via `badRequest`; the
// frontend can call them directly inside antd `rules` validators.

import type { LoanLenderInput, LoanPromoterInput } from "./types.ts";

// ---------- Constants ----------

export const USERNAME_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 8;
export const PARTY_NAME_MAX_LENGTH = 200;
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
/** 10000 basis points = 100 %. */
export const LOAN_PROMOTER_SHARE_BPS_MAX = 10000;

// ---------- Checks ----------

export function checkUsername(s: string): string | null {
  if (s.trim() === "") return "username is required";
  if (s.length > USERNAME_MAX_LENGTH) return "username is too long";
  return null;
}

export function checkPassword(s: string): string | null {
  if (s.length < PASSWORD_MIN_LENGTH)
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  return null;
}

export function checkPartyName(s: string): string | null {
  if (s.trim() === "") return "name is required";
  if (s.length > PARTY_NAME_MAX_LENGTH) return "name is too long";
  return null;
}

export function checkCurrencyCode(code: string): string | null {
  if (code.length !== 3 || !CURRENCY_CODE_PATTERN.test(code))
    return "currency_code must be 3 uppercase letters (ISO 4217)";
  return null;
}

/**
 * Validates the lender list. Returns `null` if valid, an error message
 * otherwise. Sum-of-contributions (the loan principal) is exposed separately
 * via `sumLenderAmounts` so callers can do `if (checkLenders(...)) throw …`
 * before computing.
 */
export function checkLenders(lenders: LoanLenderInput[]): string | null {
  if (lenders.length === 0) return "loan needs at least one lender";
  const seen = new Set<number>();
  let sum = 0;
  for (const l of lenders) {
    if (l.amountLentCents <= 0) return "each lender amount must be > 0";
    if (seen.has(l.lenderId))
      return `lender ${l.lenderId} appears more than once`;
    seen.add(l.lenderId);
    sum += l.amountLentCents;
    if (!Number.isSafeInteger(sum)) return "lender amounts overflow";
  }
  return null;
}

export function sumLenderAmounts(lenders: LoanLenderInput[]): number {
  return lenders.reduce((s, l) => s + l.amountLentCents, 0);
}

/**
 * Validates a list of loan promoters. Returns `null` if valid, an error
 * message otherwise. Promoters MAY be an empty list — promoters are
 * optional. When present, each `shareBps` must be a positive integer
 * (1..9999) and the sum across all promoters must be <= 10000.
 *
 * The disjointness check against lenders (no party can be both lender
 * and promoter on the same loan) is the caller's responsibility — that
 * cross-list check lives in `checkLoanComposition` below.
 */
export function checkPromoters(promoters: LoanPromoterInput[]): string | null {
  const seen = new Set<number>();
  let sum = 0;
  for (const p of promoters) {
    if (
      !Number.isInteger(p.shareBps) ||
      p.shareBps <= 0 ||
      p.shareBps >= LOAN_PROMOTER_SHARE_BPS_MAX
    ) {
      return `promoter share_bps must be an integer in (0, ${LOAN_PROMOTER_SHARE_BPS_MAX})`;
    }
    if (seen.has(p.partyId))
      return `promoter ${p.partyId} appears more than once`;
    seen.add(p.partyId);
    sum += p.shareBps;
    if (sum > LOAN_PROMOTER_SHARE_BPS_MAX)
      return `promoter shares sum to more than 100% (max ${LOAN_PROMOTER_SHARE_BPS_MAX} bps)`;
  }
  return null;
}

export function sumPromoterShareBps(promoters: LoanPromoterInput[]): number {
  return promoters.reduce((s, p) => s + p.shareBps, 0);
}

/**
 * Cross-list check: no party may simultaneously be a lender and a
 * promoter on the same loan. Run after the individual list checks
 * have already passed.
 */
export function checkLoanComposition(
  lenders: LoanLenderInput[],
  promoters: LoanPromoterInput[],
): string | null {
  if (promoters.length === 0) return null;
  const lenderIds = new Set(lenders.map((l) => l.lenderId));
  for (const p of promoters) {
    if (lenderIds.has(p.partyId))
      return `party ${p.partyId} is listed as both lender and promoter`;
  }
  return null;
}

// ---------- Utilities ----------

/** Returns null for blank/whitespace-only input, otherwise the trimmed value. */
export function normalizeOptional(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}
