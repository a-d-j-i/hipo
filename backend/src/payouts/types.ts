/** Matches src/bindings/LenderPayout.ts (snake_case). */
export type PublicLenderPayout = {
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

/** Matches src/bindings/LenderBalance.ts. */
export type PublicLenderBalance = {
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
