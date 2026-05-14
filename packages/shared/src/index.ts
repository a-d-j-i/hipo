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
  type LoanLenderInput,
  normalizeOptional,
  sumLenderAmounts,
} from "./validators.ts";
