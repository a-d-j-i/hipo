import { invoke } from "@tauri-apps/api/core";
import type { LenderBalance } from "../bindings/LenderBalance";
import type { LenderPayout } from "../bindings/LenderPayout";

export const listPayouts = () => invoke<LenderPayout[]>("list_payouts");

export const createLenderPayout = (args: {
  lenderId: number;
  currencyCode: string;
  amountCents: number;
  paidAt: number;
  notes: string | null;
}) => invoke<LenderPayout>("create_lender_payout", args);

export const deleteLenderPayout = (args: { id: number }) =>
  invoke<null>("delete_lender_payout", args);

export const lenderBalances = () => invoke<LenderBalance[]>("lender_balances");
