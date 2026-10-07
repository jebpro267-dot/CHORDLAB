import { backendJson } from "./backend";

/**
 * Transliterates lyric text the user supplied themselves. It never fetches or
 * generates song lyrics — it only converts the user's own input line by line.
 */
export function romanizeLyrics({
  data,
}: {
  data: { lyrics: string; style: "hinglish" | "tanglish" | "auto" | "english" };
}) {
  return backendJson<{ text: string }>("/api/romanize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
