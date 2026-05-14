// Source-only TypeScript package consumed by both the frontend (Vite) and the
// backend (Deno). Both runtimes read these .ts files directly — no build step.
//
// Imports use explicit `.ts` extensions so Deno's strict resolver is happy;
// Vite + tsc (`allowImportingTsExtensions`) also accept them.

export { splitPayment } from "./split.ts";
export {
  centsToMajor,
  COMMON_CURRENCIES,
  formatCents,
  majorToCents,
} from "./format.ts";
export {
  CURRENCY_CODE_PATTERN,
  PARTY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  checkCurrencyCode,
  checkLenders,
  checkPartyName,
  checkPassword,
  checkUsername,
  normalizeOptional,
  sumLenderAmounts,
} from "./validators.ts";
export type {
  AuditEntry,
  AuthStatus,
  CreateDebtorPaymentInput,
  CreateLenderPayoutInput,
  CreateLoanInput,
  DebtorPayment,
  DebtorPaymentSplit,
  LenderBalance,
  LenderPayout,
  ListAuditLogInput,
  Loan,
  LoanLender,
  LoanLenderInput,
  LoanStatus,
  Party,
  PartyInput,
  Role,
  UpdateLoanInput,
  User,
} from "./types.ts";
