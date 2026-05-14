export type LoanStatus = "active" | "closed";

export type PublicLoanLender = {
  lender_id: number;
  lender_name: string;
  amount_lent_cents: number;
};

/** Matches src/bindings/Loan.ts (snake_case). */
export type PublicLoan = {
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
  lenders: PublicLoanLender[];
  created_at: number;
  created_by: number | null;
};

export type LoanLenderInput = {
  lenderId: number;
  amountLentCents: number;
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
