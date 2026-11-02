/**
 * Returns the currently active backend base URL.
 * Checks localStorage for user-specified server override, falling back to VITE_BACKEND_URL.
 *
 * Priority:
 *  1. Value stored in localStorage under "chordlab_backend_url"
 *  2. VITE_BACKEND_URL env var (set at build time)
 *  3. PERMANENT_BACKEND_URL hard-coded fallback (Cloudflare tunnel)
 *  4. LOCAL_WIFI_BACKEND_URL fallback (Direct local PC IP on Wi-Fi)
 */
export const PERMANENT_BACKEND_URL = "https://enter-decent-blink-wallet.trycloudflare.com";
export const LOCAL_WIFI_BACKEND_URL = "http://192.168.0.109:8000";

/**
 * Returns the currently active backend base URL.
 * Users can override the server from Settings — any https:// or local Wi-Fi http:// URL is accepted.
 */
export function getBackendBaseUrl(): string {
  try {
    const custom = localStorage.getItem("chordlab_backend_url");
    if (custom && custom.trim()) {
      const trimmed = custom.trim().replace(/\/+$/, "");
      // Discard dead legacy URLs automatically
      if (
        !trimmed.includes("onrender.com") &&
        !trimmed.includes("certification-manga-framing-varied")
      ) {
        return trimmed;
      }
      localStorage.removeItem("chordlab_backend_url");
    }
  } catch {
    // ignore
  }
  return (import.meta.env["VITE_BACKEND_URL"] || PERMANENT_BACKEND_URL).replace(/\/+$/, "");
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
 * `localStorage` and dual-network resilience (Cloudflare Tunnel <-> Local Wi-Fi).
 *
 * @param path - API path to call (resolved via `backendUrl`).
 * @param init - Optional `RequestInit` options forwarded to `fetch`.
 * @returns The raw `Response` promise.
 */
export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem("chordlab-user-token");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const primaryUrl = backendUrl(path);
  try {
    return await fetch(primaryUrl, { ...init, headers });
  } catch (err) {
    // If primary failed with network error, try automatic fallback
    const isLocal = primaryUrl.startsWith("http://192.168.");
    const fallbackBase = isLocal ? PERMANENT_BACKEND_URL : LOCAL_WIFI_BACKEND_URL;
    if (fallbackBase && !primaryUrl.startsWith(fallbackBase)) {
      try {
        const fallbackUrl = `${fallbackBase}${path}`;
        const res = await fetch(fallbackUrl, { ...init, headers });
        if (res.ok) {
          setBackendBaseUrl(fallbackBase);
          return res;
        }
      } catch {
        // fallback also failed, rethrow original error
      }
    }
    throw err;
  }
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
