/**
 * Minimal fetch helper for talking to the Deno backend.
 *
 * - `credentials: "include"` so the session cookie flows.
 * - `X-Hipo-Token` header attached when a token has been registered (Tauri
 *   shell injects one via the URL hash on launch; browser dev mode has none).
 * - Non-2xx responses throw with the backend's `{ error }` message, matching
 *   the `try/catch + message.error(String(e))` pattern the pages already use.
 * - `VITE_BACKEND_URL` lets the Tauri webview hit an absolute URL when the
 *   Vite proxy isn't in the loop. Defaults to empty (same-origin), which
 *   means `/api/*` goes through Vite's proxy in dev or the bundled server
 *   in production.
 */
const API_BASE = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

let authToken: string | null = null;

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
  // Remove the token from the visible URL.
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
