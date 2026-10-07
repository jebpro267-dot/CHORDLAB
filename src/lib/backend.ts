const backendBaseUrl = (import.meta.env.VITE_BACKEND_URL || "http://localhost:8000").replace(
  /\/+$/,
  "",
);

export function backendUrl(path: string): string {
  return `${backendBaseUrl}${path}`;
}

export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(backendUrl(path), init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(body.detail ?? body.error ?? "The API request failed.");
  }
  return (await response.json()) as T;
}
