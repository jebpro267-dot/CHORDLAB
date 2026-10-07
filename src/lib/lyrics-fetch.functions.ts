import { backendJson } from "./backend";

export interface SyncedLine {
  /** seconds */
  time: number;
  text: string;
}

export interface SyncedLyricsResult {
  found: boolean;
  plain: string;
  synced: SyncedLine[];
  trackName?: string;
  artistName?: string;
}

export function fetchSyncedLyrics({
  data,
}: {
  data: { title: string; artist?: string; duration?: number };
}) {
  return backendJson<SyncedLyricsResult>("/api/lyrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
