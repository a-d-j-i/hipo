import { httpRequest } from "../api/http";
import type { DebtorPayment } from "@hipo/shared";

export const listLoanPayments = (args: { loanId: number }) =>
  httpRequest<DebtorPayment[]>(
    "GET",
    `/api/payments?loan_id=${args.loanId}`,
  );

export const createDebtorPayment = (args: {
  loanId: number;
  amountCents: number;
  paidAt: number;
  notes: string | null;
}) => httpRequest<DebtorPayment>("POST", "/api/payments", args);

export const deleteDebtorPayment = (args: { id: number }) =>
  httpRequest<null>("DELETE", `/api/payments/${args.id}`);
