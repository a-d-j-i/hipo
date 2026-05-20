// Canonical API types. Single source of truth for both frontend (consumed
// from `@hipo/shared`) and backend (re-exported by name from each domain's
// types.ts).
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

/**
 * A party that contributes no principal but takes a fixed cut of the
 * loan's interest, off the top. Share is expressed in basis points
 * (1 bps = 0.01 %). The sum of `share_bps` across all promoters on
 * a loan must satisfy `0 < total <= 10000`; if equal to 10000 the
 * lenders get only the principal.
 */
export type LoanPromoter = {
  party_id: number;
  party_name: string;
  share_bps: number;
};

export type LoanPromoterInput = {
  partyId: number;
  shareBps: number;
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
  promoters: LoanPromoter[];
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
  /** Optional list of fixed-share-of-interest parties. Empty / omitted = none. */
  promoters?: LoanPromoterInput[];
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

export type DebtorPaymentSplitKind = "lender" | "promoter";

export type DebtorPaymentSplit = {
  lender_id: number;
  lender_name: string;
  amount_cents: number;
  kind: DebtorPaymentSplitKind;
};

export type DebtorPayment = {
  id: number;
  loan_id: number;
  amount_cents: number;
  principal_cents: number;
  interest_cents: number;
  paid_at: number;
  notes: string | null;
  splits: DebtorPaymentSplit[];
  created_at: number;
  created_by: number | null;
};

export type CreateDebtorPaymentInput = {
  loanId: number;
  principalCents: number;
  interestCents: number;
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
