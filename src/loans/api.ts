import { invoke } from "@tauri-apps/api/core";
import type { Loan } from "../bindings/Loan";
import type { LoanLenderInput } from "../bindings/LoanLenderInput";
import type { LoanStatus } from "../bindings/LoanStatus";

export const listLoans = () => invoke<Loan[]>("list_loans");

export const getLoan = (args: { id: number }) =>
  invoke<Loan>("get_loan", args);

export const createLoan = (args: {
  reference: string | null;
  debtorId: number;
  currencyCode: string;
  interestCents: number;
  issuedAt: number;
  notes: string | null;
  lenders: LoanLenderInput[];
}) => invoke<Loan>("create_loan", args);

export const updateLoan = (args: {
  id: number;
  reference: string | null;
  interestCents: number;
  issuedAt: number;
  status: LoanStatus;
  notes: string | null;
}) => invoke<Loan>("update_loan", args);

export const setLoanLenders = (args: {
  loanId: number;
  lenders: LoanLenderInput[];
}) => invoke<Loan>("set_loan_lenders", args);

export const deleteLoan = (args: { id: number }) =>
  invoke<null>("delete_loan", args);
