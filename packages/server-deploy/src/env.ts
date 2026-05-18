// Tiny env-var helpers. Read from Deno.env on the Deno runtime; return
// the supplied default on browser/Worker (where there are no env vars
// and these helpers are typically not even called).

declare const Deno:
  | { env: { get(name: string): string | undefined } }
  | undefined;

export function envRaw(name: string): string | undefined {
  return typeof Deno !== "undefined" && Deno?.env
    ? Deno.env.get(name)
    : undefined;
}

export function envInt(name: string, defaultValue: number): number {
  const raw = envRaw(name);
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return parsed;
}

export function envString(name: string, defaultValue: string): string {
  const raw = envRaw(name);
  return raw === undefined || raw === "" ? defaultValue : raw;
}
