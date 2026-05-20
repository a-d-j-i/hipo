// Source-only TypeScript package consumed by both the frontend (Vite) and the
// backend (Deno). Both runtimes read these .ts files directly — no build step.
//
// Imports use explicit `.ts` extensions so Deno's strict resolver is happy;
// Vite + tsc (`allowImportingTsExtensions`) also accept them.

export { splitPayment, splitDebtorPayment } from "./split.ts";
export type { DebtorPaymentAllocation } from "./split.ts";
export {
  centsToMajor,
  COMMON_CURRENCIES,
  formatCents,
  majorToCents,
} from "./format.ts";
export {
  CURRENCY_CODE_PATTERN,
  LOAN_PROMOTER_SHARE_BPS_MAX,
  PARTY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  checkCurrencyCode,
  checkLenders,
  checkLoanComposition,
  checkPartyName,
  checkPassword,
  checkPromoters,
  checkUsername,
  normalizeOptional,
  sumLenderAmounts,
  sumPromoterShareBps,
} from "./validators.ts";
export type {
  AuditEntry,
  AuthStatus,
  CreateDebtorPaymentInput,
  CreateLenderPayoutInput,
  CreateLoanInput,
  DebtorPayment,
  DebtorPaymentSplit,
  DebtorPaymentSplitKind,
  LenderBalance,
  LenderPayout,
  ListAuditLogInput,
  Loan,
  LoanLender,
  LoanLenderInput,
  LoanPromoter,
  LoanPromoterInput,
  LoanStatus,
  Party,
  PartyInput,
  Role,
  UpdateLoanInput,
  User,
} from "./types.ts";
