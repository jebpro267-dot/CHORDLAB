import { backendJson } from "./backend";

export interface LinkMeta {
  source: "youtube" | "spotify" | "other";
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
}

/**
 * Import public metadata for a YouTube or Spotify link via oEmbed.
 * Streaming platforms do not permit downloading their audio, so only the
 * title, artist and artwork are imported — the audio itself comes from a
 * file the user picks or records.
 */
export function importLink({ data }: { data: { url: string } }): Promise<LinkMeta> {
  return backendJson<LinkMeta>("/api/import-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
