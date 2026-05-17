import { checkPassword, checkUsername } from "@hipo/shared";
import { badRequest } from "@hipo/server";

export function validateUsername(s: string): void {
  const err = checkUsername(s);
  if (err) throw badRequest(err);
}

export function validatePassword(s: string): void {
  const err = checkPassword(s);
  if (err) throw badRequest(err);
}
