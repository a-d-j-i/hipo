import { httpRequest } from "../api/http";
import type { Loan } from "@hipo/shared";
import type { LoanLenderInput } from "@hipo/shared";
import type { LoanStatus } from "@hipo/shared";

export const listLoans = () => httpRequest<Loan[]>("GET", "/api/loans");

export const getLoan = (args: { id: number }) =>
  httpRequest<Loan>("GET", `/api/loans/${args.id}`);

export const createLoan = (args: {
  reference: string | null;
  debtorId: number;
  currencyCode: string;
  interestCents: number;
  issuedAt: number;
  notes: string | null;
  lenders: LoanLenderInput[];
}) => httpRequest<Loan>("POST", "/api/loans", args);

export const updateLoan = (args: {
  id: number;
  reference: string | null;
  interestCents: number;
  issuedAt: number;
  status: LoanStatus;
  notes: string | null;
}) => {
  const { id, ...body } = args;
  return httpRequest<Loan>("PATCH", `/api/loans/${id}`, body);
};

export const setLoanLenders = (args: {
  loanId: number;
  lenders: LoanLenderInput[];
}) =>
  httpRequest<Loan>("PUT", `/api/loans/${args.loanId}/lenders`, {
    lenders: args.lenders,
  });

export const deleteLoan = (args: { id: number }) =>
  httpRequest<null>("DELETE", `/api/loans/${args.id}`);
