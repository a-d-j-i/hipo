export type PublicDebtorPaymentSplit = {
  lender_id: number;
  lender_name: string;
  amount_cents: number;
};

/** Matches src/bindings/DebtorPayment.ts (snake_case). */
export type PublicDebtorPayment = {
  id: number;
  loan_id: number;
  amount_cents: number;
  paid_at: number;
  notes: string | null;
  splits: PublicDebtorPaymentSplit[];
  created_at: number;
  created_by: number | null;
};

export type CreateDebtorPaymentInput = {
  loanId: number;
  amountCents: number;
  paidAt: number;
  notes: string | null;
};
