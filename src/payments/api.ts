import { invoke } from "@tauri-apps/api/core";
import type { DebtorPayment } from "../bindings/DebtorPayment";

export const listLoanPayments = (args: { loanId: number }) =>
  invoke<DebtorPayment[]>("list_loan_payments", args);

export const createDebtorPayment = (args: {
  loanId: number;
  amountCents: number;
  paidAt: number;
  notes: string | null;
}) => invoke<DebtorPayment>("create_debtor_payment", args);

export const deleteDebtorPayment = (args: { id: number }) =>
  invoke<null>("delete_debtor_payment", args);
