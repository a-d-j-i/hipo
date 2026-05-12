import { invoke } from "@tauri-apps/api/core";
import type { Party } from "../bindings/Party";

export type PartyInput = {
  name: string;
  externalRef: string | null;
  notes: string | null;
};

export const listParties = () => invoke<Party[]>("list_parties");

export const getParty = (args: { id: number }) =>
  invoke<Party>("get_party", args);

export const createParty = (input: PartyInput) =>
  invoke<Party>("create_party", input);

export const updateParty = (args: { id: number } & PartyInput) =>
  invoke<Party>("update_party", args);

export const deleteParty = (args: { id: number }) =>
  invoke<null>("delete_party", args);
