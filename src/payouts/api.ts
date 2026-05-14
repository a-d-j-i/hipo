import { httpRequest } from "../api/http";
import type { LenderBalance } from "../bindings/LenderBalance";
import type { LenderPayout } from "../bindings/LenderPayout";

export const listPayouts = () =>
  httpRequest<LenderPayout[]>("GET", "/api/payouts");

export const createLenderPayout = (args: {
  lenderId: number;
  currencyCode: string;
  amountCents: number;
  paidAt: number;
  notes: string | null;
}) => httpRequest<LenderPayout>("POST", "/api/payouts", args);

export const deleteLenderPayout = (args: { id: number }) =>
  httpRequest<null>("DELETE", `/api/payouts/${args.id}`);

export const lenderBalances = () =>
  httpRequest<LenderBalance[]>("GET", "/api/payouts/balances");
