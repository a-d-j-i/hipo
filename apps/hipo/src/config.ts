// Runtime config. Reads env vars on Deno; defaults across the board on
// browser (where this module is bundled into the in-page Worker —
// there are no env vars and the fields that matter for the Deno
// shape, like dataDir/staticDir/port, aren't used by the in-page
// shape anyway).

declare const Deno:
  | { env: { get(name: string): string | undefined } }
  | undefined;

function envRaw(name: string): string | undefined {
  return typeof Deno !== "undefined" && Deno?.env
    ? Deno.env.get(name)
    : undefined;
}

function envInt(name: string, defaultValue: number): number {
  const raw = envRaw(name);
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return parsed;
}

function envString(name: string, defaultValue: string): string {
  const raw = envRaw(name);
  return raw === undefined || raw === "" ? defaultValue : raw;
}

// Default port matches the Vite dev proxy (HIPO_BACKEND_PORT in vite.config.ts).
// Set HIPO_PORT=0 in sidecar mode so Tauri reads the actual port from stdout.
export const config = {
  port: envInt("HIPO_PORT", 8787),
  dataDir: envString("HIPO_DATA_DIR", "./data"),
  staticDir: envString("HIPO_STATIC_DIR", "../dist"),
  sessionTtlDays: envInt("HIPO_SESSION_TTL_DAYS", 30),
  authToken: envRaw("HIPO_AUTH_TOKEN"),
} as const;

export const SESSION_COOKIE = "hipo_session";
