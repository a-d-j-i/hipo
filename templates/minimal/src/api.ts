// Minimal httpRequest wrapper. Fetches the backend at /api/... using
// X-Hipo-Token for session auth (the in-page Worker accepts either
// X-Hipo-Token or the Set-Cookie session header; the SW doesn't
// propagate Set-Cookie so we use X-Hipo-Token).
//
// On login/setup the server echoes the session id via X-Hipo-Session;
// we store it in sessionStorage and forward it on subsequent requests.

const SESSION_STORAGE_KEY = "minimal.session";

function getSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setSessionId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore quota/security errors
  }
}

export async function httpRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const sid = getSessionId();
  if (sid) headers["X-Hipo-Token"] = sid;

  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Sync session id from response headers (both login and setup).
  const newSid = res.headers.get("X-Hipo-Session");
  if (newSid !== null) setSessionId(newSid || null);

  if (!res.ok) {
    let msg = `${method} ${path} → ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) msg = json.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export function clearSession(): void {
  setSessionId(null);
}

// Typed API helpers

export type AuthStatus = { needs_setup: boolean; current_user: User | null };
export type User = { id: number; username: string; role: string; created_at: number };

export const api = {
  getAuthStatus: () => httpRequest<AuthStatus>("GET", "/api/auth/status"),
  me: () => httpRequest<User | null>("GET", "/api/auth/me"),
  setup: (username: string, password: string) =>
    httpRequest<User>("POST", "/api/auth/setup", { username, password }),
  login: (username: string, password: string) =>
    httpRequest<User>("POST", "/api/auth/login", { username, password }),
  logout: () => httpRequest("POST", "/api/auth/logout"),

  // Returns gzipped binary snapshot as base64.
  snapshotRaw: () => httpRequest<{ bytes_b64: string }>("GET", "/api/backup/snapshot"),
  restoreRaw: (bytes_b64: string) =>
    httpRequest("POST", "/api/backup/restore", { bytes_b64 }),
};
