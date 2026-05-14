// Canonical API types. Single source of truth for both frontend (consumed
// from `@hipo/shared`) and backend (re-exported under the existing Public*
// aliases by each domain's types.ts).
//
// Snake_case is intentional for response shapes — that's what the wire
// format looks like. CamelCase is used for request/input shapes
// (CreateLoanInput, PartyInput, …) which are JSON body payloads.

// ---------- Auth ----------

export type Role = "admin" | "user";

export type User = {
  id: number;
  username: string;
  role: Role;
  created_at: number;
};

export type AuthStatus = {
  needs_setup: boolean;
  current_user: User | null;
};

// ---------- Parties ----------

export type Party = {
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

// ---------- Loans ----------

export type LoanStatus = "active" | "closed";

export type LoanLender = {
  lender_id: number;
  lender_name: string;
  amount_lent_cents: number;
};

export type LoanLenderInput = {
  lenderId: number;
  amountLentCents: number;
};

export type Loan = {
  id: number;
  reference: string | null;
  debtor_id: number;
  debtor_name: string;
  currency_code: string;
  principal_cents: number;
  interest_cents: number;
  issued_at: number;
  status: LoanStatus;
  notes: string | null;
  lenders: LoanLender[];
  created_at: number;
  created_by: number | null;
};

export type CreateLoanInput = {
  reference: string | null;
  debtorId: number;
  currencyCode: string;
  interestCents: number;
  issuedAt: number;
  notes: string | null;
  lenders: LoanLenderInput[];
};

export type UpdateLoanInput = {
  id: number;
  reference: string | null;
  interestCents: number;
  issuedAt: number;
  status: LoanStatus;
  notes: string | null;
};

// ---------- Payments ----------

export type DebtorPaymentSplit = {
  lender_id: number;
  lender_name: string;
  amount_cents: number;
};

export type DebtorPayment = {
  id: number;
  loan_id: number;
  amount_cents: number;
  paid_at: number;
  notes: string | null;
  splits: DebtorPaymentSplit[];
  created_at: number;
  created_by: number | null;
};

export type CreateDebtorPaymentInput = {
  loanId: number;
  amountCents: number;
  paidAt: number;
  notes: string | null;
};

// ---------- Payouts ----------

export type LenderPayout = {
  id: number;
  lender_id: number;
  lender_name: string;
  currency_code: string;
  amount_cents: number;
  paid_at: number;
  notes: string | null;
  created_at: number;
  created_by: number | null;
};

export type LenderBalance = {
  lender_id: number;
  lender_name: string;
  currency_code: string;
  received_cents: number;
  paid_out_cents: number;
  outstanding_cents: number;
};

export type CreateLenderPayoutInput = {
  lenderId: number;
  currencyCode: string;
  amountCents: number;
  paidAt: number;
  notes: string | null;
};

// ---------- Audit ----------

export type AuditEntry = {
  id: number;
  at: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  payload: string | null;
};

export type ListAuditLogInput = {
  entityType: string | null;
  userId: number | null;
  limit: number;
  offset: number;
};
