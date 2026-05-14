// Shared domain helpers consumed by both the frontend (Vite) and the backend
// (Deno). Both runtimes read TypeScript sources directly — no build step.
//
// Migrate code here when it would otherwise be duplicated. Good first
// candidates from the existing codebase:
//   - largest-remainder split (apps/backend/src/payments/split.ts)
//   - currency / decimal formatters (currently in apps/frontend/src/loans/format.ts)
//   - validators that mirror the antd Form rules (parties name, currency code, etc.)
//   - role / loan-status enums (currently in apps/frontend/src/bindings/)
export {};
