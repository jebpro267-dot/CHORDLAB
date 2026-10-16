import type { AnalysisResult } from "./audio-analysis";

export interface LyricLine {
  text: string;
  roman?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  createdAt: number;
  analysis: AnalysisResult;
  /** raw lyrics pasted by the user */
  lyrics: string;
  /** romanized (Hinglish / Tanglish / etc.) lyrics */
  romanized: string;
  romanizationStyle: string;
  capo: number;
  transpose: number;
  notes: string;
  /** which engine produced the analysis */
  engine?: "tensorflow" | "chordmini" | "local";
  /** ChordMini models used, when engine === "chordmini" */
  models?: { beatModel: string; chordModel: string };
  /** time-synced lyric lines (LRCLIB), used for exact chord placement */
  syncedLyrics?: { time: number; text: string }[];
}

const KEY = "chordlab.songs.v1";

/**
 * Reads and parses the songs array stored in `localStorage`.
 * Returns an empty array when running outside a browser or when the stored
 * value cannot be parsed.
 *
 * @returns Parsed array of `Song` objects (may be empty).
 */
function read(): Song[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Song[]) : [];
  } catch {
    return [];
  }
}

/**
 * Serialises the songs array back to `localStorage` and fires a
 * `chordlab:songs` custom event so that other tabs / components can react.
 *
 * @param songs - Updated array of `Song` objects to persist.
 */
function write(songs: Song[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(songs));
  window.dispatchEvent(new CustomEvent("chordlab:songs"));
}

/**
 * Returns all saved songs sorted by creation date (newest first).
 *
 * @returns Array of `Song` objects in descending creation-date order.
 */
export function listSongs(): Song[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Finds a single song by its unique identifier.
 *
 * @param id - The song's unique ID.
 * @returns The matching `Song`, or `undefined` if not found.
 */
export function getSong(id: string): Song | undefined {
  return read().find((s) => s.id === id);
}

/**
 * Upserts a song: replaces an existing record with the same `id`, or appends
 * a new one if no match is found.  Persists the result to `localStorage`.
 *
 * @param song - The `Song` object to save or update.
 */
export function saveSong(song: Song) {
  const songs = read();
  const i = songs.findIndex((s) => s.id === song.id);
  if (i >= 0) songs[i] = song;
  else songs.push(song);
  write(songs);
}

/**
 * Permanently removes the song with the given ID from `localStorage`.
 *
 * @param id - ID of the song to delete.
 */
export function deleteSong(id: string) {
  write(read().filter((s) => s.id !== id));
}

/**
 * Generates a random, collision-resistant unique ID by combining a base-36
 * random string with the current timestamp in base-36.
 *
 * @returns A short alphanumeric unique ID string.
 */
export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
