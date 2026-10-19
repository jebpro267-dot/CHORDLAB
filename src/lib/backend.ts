/**
 * Returns the currently active backend base URL.
 * Checks localStorage for user-specified server override, falling back to VITE_BACKEND_URL.
 */
export function getBackendBaseUrl(): string {
  try {
    const custom = localStorage.getItem("chordlab_backend_url");
    if (custom && custom.trim()) return custom.trim().replace(/\/+$/, "");
  } catch {
    // ignore
  }
  return (import.meta.env["VITE_BACKEND_URL"] || "").replace(/\/+$/, "");
}

/**
 * Persists a custom backend server URL to localStorage.
 */
export function setBackendBaseUrl(url: string): void {
  try {
    if (!url || !url.trim()) {
      localStorage.removeItem("chordlab_backend_url");
    } else {
      localStorage.setItem("chordlab_backend_url", url.trim().replace(/\/+$/, ""));
    }
  } catch {
    // ignore
  }
}

/**
 * Resolves an API path against the configured backend base URL.
 *
 * @param path - Absolute path string starting with `/` (e.g. `/api/lyrics`).
 * @returns Full URL string ready for use in `fetch`.
 */
export function backendUrl(path: string): string {
  return `${getBackendBaseUrl()}${path}`;
}

/**
 * Wraps the browser's `fetch` with automatic JWT Bearer token injection from
 * `localStorage`.  The token is NOT added when an `Authorization` header is
 * already present in `init`.
 *
 * @param path - API path to call (resolved via `backendUrl`).
 * @param init - Optional `RequestInit` options forwarded to `fetch`.
 * @returns The raw `Response` promise.
 */
export function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem("chordlab-user-token");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(backendUrl(path), { ...init, headers });
}

/**
 * Calls an authenticated backend endpoint and deserialises the JSON response
 * body into the requested type `T`.  Throws an `Error` with a human-readable
 * message when the HTTP status is not OK.
 *
 * @param path - API path to call (resolved via `backendUrl`).
 * @param init - Optional `RequestInit` options forwarded to `backendFetch`.
 * @returns Parsed response body typed as `T`.
 * @throws {Error} When the server returns a non-2xx status.
 */
export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await backendFetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(body.detail ?? body.error ?? "The API request failed.");
  }
  return (await response.json()) as T;
}
