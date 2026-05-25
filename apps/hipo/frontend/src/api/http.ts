/**
 * Minimal fetch helper for talking to the backend.
 *
 * - `credentials: "include"` so the session cookie flows (Deno shape).
 * - `X-Hipo-Token` header attached when a token has been registered.
 *   Set by:
 *     - Tauri shell: random launch token, gates /api/* on the sidecar.
 *     - In-page backend: session ID (the Worker can't propagate cookies
 *       through the SW because synthetic Responses don't honour
 *       Set-Cookie in some browsers; X-Hipo-Token carries the same ID
 *       via a non-forbidden header instead).
 * - After every response, we check for `X-Hipo-Session` on the
 *   response headers — login/setup set it to the new session ID; logout
 *   sets it empty. That keeps `authToken` in sync without the frontend
 *   pages having to know about session transport.
 * - Non-2xx responses throw with the backend's `{ error }` message,
 *   matching the `try/catch + message.error(String(e))` pattern the
 *   pages already use.
 * - `VITE_BACKEND_URL` lets the Tauri webview hit an absolute URL when
 *   the Vite proxy isn't in the loop. Defaults to empty (same-origin).
 */
const API_BASE = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

// sessionStorage key for the in-page session token. Survives reloads
// within the tab but not tab close. We only persist the token in the
// in-page shape — for Tauri it comes from the URL hash each launch,
// for the Deno shape from the Set-Cookie response.
const TOKEN_STORAGE_KEY = "hipo:authToken";

function loadInitialToken(): string | null {
  // Only restore for the in-page shape. Tauri/cloud shapes set
  // authToken via extractAuthToken or rely on cookies.
  if (
    typeof sessionStorage !== "undefined" &&
    import.meta.env.VITE_INPAGE_BACKEND
  ) {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return null;
}

let authToken: string | null = loadInitialToken();

/** Programmatic setter. Persists in sessionStorage for the in-page shape. */
export function setAuthToken(token: string | null): void {
  authToken = token && token.length > 0 ? token : null;
  if (
    typeof sessionStorage !== "undefined" &&
    import.meta.env.VITE_INPAGE_BACKEND
  ) {
    if (authToken) sessionStorage.setItem(TOKEN_STORAGE_KEY, authToken);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Reads `#token=...` from the URL, stores it for later requests, and rewrites
 * the URL so the token doesn't linger in the address bar or get bookmarked.
 * No-op when the fragment isn't present.
 */
export function extractAuthToken(): void {
  const hash = window.location.hash;
  if (!hash || !hash.includes("token=")) return;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  if (!token) return;
  authToken = token;
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

export async function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (authToken) headers["X-Hipo-Token"] = authToken;

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, init);

  // The server uses X-Hipo-Session on /api/auth/* responses to
  // communicate session-token changes (login/setup → new ID, logout
  // → empty). Sync our in-memory token so subsequent requests carry
  // it via X-Hipo-Token.
  const sessionUpdate = res.headers.get("X-Hipo-Session");
  if (sessionUpdate !== null) {
    setAuthToken(sessionUpdate);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data === "object" && "error" in data && data.error) {
        msg = String(data.error);
      }
    } catch {
      /* response wasn't JSON; keep the status-code message */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text === "" ? null : JSON.parse(text)) as T;
}
