import { badRequest } from "../errors.ts";

export function validateUsername(s: string): void {
  if (s.trim() === "") throw badRequest("username is required");
  if (s.length > 64) throw badRequest("username is too long");
}

export function validatePassword(s: string): void {
  if (s.length < 8) throw badRequest("password must be at least 8 characters");
}
