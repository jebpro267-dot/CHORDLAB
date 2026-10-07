const backendBaseUrl = (import.meta.env["VITE_BACKEND_URL"] || "").replace(/\/+$/, "");

export function backendUrl(path: string): string {
  return `${backendBaseUrl}${path}`;
}

export function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem("chordlab-user-token");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(backendUrl(path), { ...init, headers });
}

export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await backendFetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(body.detail ?? body.error ?? "The API request failed.");
  }
  return (await response.json()) as T;
}
