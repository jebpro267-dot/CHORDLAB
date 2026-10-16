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

/**
 * Queries the backend lyrics service (lrclib) to retrieve synchronized LRC timestamps and plain lyrics text.
 *
 * @param args - Wrapper object containing song title, optional artist, and duration for ranking candidates.
 * @returns Promise resolving to the SyncedLyricsResult containing synced lines and plain text.
 */
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
