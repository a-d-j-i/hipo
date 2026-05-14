import { badRequest } from "../errors.ts";

export function validateName(name: string): void {
  if (name.trim() === "") throw badRequest("name is required");
  if (name.length > 200) throw badRequest("name is too long");
}

/** Returns null for blank/whitespace-only input, otherwise the trimmed value. */
export function normalizeOpt(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}
