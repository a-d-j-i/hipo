function envInt(name: string, defaultValue: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return parsed;
}

function envString(name: string, defaultValue: string): string {
  const raw = Deno.env.get(name);
  return raw === undefined || raw === "" ? defaultValue : raw;
}

// Default port matches the Vite dev proxy (HIPO_BACKEND_PORT in vite.config.ts).
// Set HIPO_PORT=0 in sidecar mode so Tauri reads the actual port from stdout.
export const config = {
  port: envInt("HIPO_PORT", 8787),
  dataDir: envString("HIPO_DATA_DIR", "./data"),
  // Path is relative to apps/backend/. Resolves to the on-disk dir during
  // `deno task dev`; the compiled binary embeds it via `deno compile
  // --include ../frontend/dist` so the same path works at runtime.
  staticDir: envString("HIPO_STATIC_DIR", "../frontend/dist"),
  sessionTtlDays: envInt("HIPO_SESSION_TTL_DAYS", 30),
  authToken: Deno.env.get("HIPO_AUTH_TOKEN"),
} as const;

export const SESSION_COOKIE = "hipo_session";
