import { httpRequest } from "../api/http";
import type { Party } from "../bindings/Party";

export type PartyInput = {
  name: string;
  externalRef: string | null;
  notes: string | null;
};

export const listParties = () => httpRequest<Party[]>("GET", "/api/parties");

export const getParty = (args: { id: number }) =>
  httpRequest<Party>("GET", `/api/parties/${args.id}`);

export const createParty = (input: PartyInput) =>
  httpRequest<Party>("POST", "/api/parties", input);

export const updateParty = (args: { id: number } & PartyInput) => {
  const { id, ...input } = args;
  return httpRequest<Party>("PATCH", `/api/parties/${id}`, input);
};

export const deleteParty = (args: { id: number }) =>
  httpRequest<null>("DELETE", `/api/parties/${args.id}`);
