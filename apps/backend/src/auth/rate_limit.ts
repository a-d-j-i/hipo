/**
 * Per-username sliding-window failure tracker for /api/auth/login.
 *
 * In-memory only — fine for the single-process Deno backend that runs
 * as a Tauri sidecar or single hosted instance. When multi-instance
 * cloud lands, swap the Map for shared storage (Redis / DB) without
 * changing the public surface.
 *
 * Argon2id already makes brute force expensive in CPU terms; this layer
 * stops an attacker from pinning the sidecar at 100% CPU by spraying
 * guesses.
 */

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

type FailRecord = { count: number; windowStart: number };
const fails = new Map<string, FailRecord>();

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

export function isLoginLocked(username: string): boolean {
  const rec = fails.get(key(username));
  if (!rec) return false;
  if (now() - rec.windowStart > WINDOW_SECONDS) {
    fails.delete(key(username));
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(username: string): void {
  const t = now();
  const k = key(username);
  const rec = fails.get(k);
  if (!rec || t - rec.windowStart > WINDOW_SECONDS) {
    fails.set(k, { count: 1, windowStart: t });
  } else {
    rec.count++;
  }
}

export function clearLoginFailures(username: string): void {
  fails.delete(key(username));
}

/** Test-only: reset all tracked state. */
export function _resetForTests(): void {
  fails.clear();
}
