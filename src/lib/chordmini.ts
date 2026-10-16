import { backendFetch, backendJson } from "./backend";

/**
 * Adapters for the TensorFlow and ChordMini analysis APIs.
 * Both normalize results to the on-device `AnalysisResult` shape.
 */

import type { AnalysisResult, ChordEvent } from "./audio-analysis";
import { noteToPc, pcToNote } from "./chords";

export interface ChordMiniModels {
  beatModel: "auto" | "madmom" | "beat-transformer";
  chordModel: "chord-cnn-lstm";
}

export const DEFAULT_CHORDMINI_MODELS: ChordMiniModels = {
  beatModel: "auto",
  chordModel: "chord-cnn-lstm",
};

/* ------------------------------------------------------------------ */
/* Label mapping: ChordMini uses the Harte "C:min7" / "N" vocabulary    */
/* ------------------------------------------------------------------ */

const QUALITY_MAP: Record<string, string> = {
  "": "",
  maj: "",
  major: "",
  min: "m",
  minor: "m",
  dim: "dim",
  aug: "aug",
  maj6: "6",
  "6": "6",
  min6: "m6",
  maj7: "maj7",
  min7: "m7",
  minmaj7: "mMaj7",
  "7": "7",
  dim7: "dim7",
  hdim7: "m7b5",
  sus2: "sus2",
  sus4: "sus4",
  "9": "9",
  maj9: "maj9",
  min9: "m9",
  "11": "11",
  min11: "m11",
  "13": "13",
  maj13: "maj13",
  min13: "m13",
};

/** "A:min7/b3" -> "Am7"; "N" / "X" -> "N". */
/**
 * Converts a Harte-notation chord label (e.g. `"A:min7/b3"`, `"N"`, `"X"`) to
 * the compact display format used throughout the app (e.g. `"Am7"`, `"N"`).
 * Strips inversion info, maps quality synonyms, and returns unknown qualities
 * verbatim so nothing is silently lost.
 *
 * @param raw - Raw label string from the ChordMini or TensorFlow API response.
 * @returns Normalised chord label string.
 */
export function normalizeChordLabel(raw: string): string {
  const token = (raw ?? "").trim();
  if (!token || token === "N" || token === "X" || /^n\.?c\.?$/i.test(token)) return "N";

  // Strip inversion / added-degree info that our renderer can't use.
  const [core] = token.split("/");
  const [rootPart, qualityPart = ""] = (core ?? "").split(":");
  const root = (rootPart ?? "").trim();
  if (noteToPc(root) === null) return token;

  const quality = qualityPart.replace(/\(.*?\)/g, "").trim().toLowerCase();
  const mapped = QUALITY_MAP[quality];
  if (mapped !== undefined) return root + mapped;
  // Unknown quality: keep it verbatim so nothing is silently lost.
  return root + qualityPart.trim();
}

/* ------------------------------------------------------------------ */
/* Tolerant response readers                                           */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

/**
 * Safely coerces an unknown JSON value to a finite number.
 *
 * @param v - Any value from a parsed JSON object.
 * @returns The numeric value, or `null` if not a finite number.
 */
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Searches a JSON object for the first array value associated with any of the
 * given keys, including one level of nesting.  Used to tolerate different
 * property names across API versions (e.g. `"beats"` vs `"beat_times"`).
 *
 * @param source - Parsed JSON object.
 * @param keys   - Ordered list of candidate property names.
 * @returns First array found, or an empty array.
 */
function firstArray(source: Json, keys: string[]): unknown[] {
  for (const k of keys) {
    const v = source[k];
    if (Array.isArray(v)) return v;
  }
  for (const k of keys) {
    const nested = source[k];
    if (nested && typeof nested === "object") {
      const inner = firstArray(nested as Json, keys);
      if (inner.length) return inner;
    }
  }
  return [];
}

/**
 * Searches a JSON object for the first numeric value associated with any of
 * the given keys, including one level of nesting.
 *
 * @param source - Parsed JSON object.
 * @param keys   - Ordered list of candidate property names.
 * @returns First finite number found, or `null`.
 */
function firstNumber(source: Json, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(source[k]);
    if (n !== null) return n;
  }
  for (const k of Object.keys(source)) {
    const nested = source[k];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = firstNumber(nested as Json, keys);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/**
 * Parses beat and downbeat timestamps out of a tolerant JSON payload,
 * accepting several different key names used by various ChordMini versions.
 *
 * @param payload - JSON object from the beats portion of the API response.
 * @returns `{ beats, downbeats }` both as sorted number arrays (seconds).
 */
export function parseBeats(payload: Json): { beats: number[]; downbeats: number[] } {
  const toTime = (b: unknown): number | null => {
    if (typeof b === "number") return Number.isFinite(b) ? b : null;
    if (b && typeof b === "object") {
      const o = b as Json;
      return num(o["time"]) ?? num(o["timestamp"]) ?? num(o["start"]) ?? num(o["beat_time"]);
    }
    return num(b);
  };

  const beats = firstArray(payload, ["beats", "beat_times", "beatTimes"])
    .map(toTime)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  const downbeats = firstArray(payload, ["downbeats", "downbeat_times", "downbeatTimes"])
    .map(toTime)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  return { beats, downbeats };
}

/**
 * Parses a chord event list from a tolerant JSON payload, normalising label
 * strings and filling in missing end times from the next onset.
 *
 * @param payload - JSON object from the chords portion of the API response.
 * @returns Array of `ChordEvent` objects sorted by start time.
 */
export function parseChords(payload: Json): ChordEvent[] {
  const raw = firstArray(payload, [
    "chords",
    "chord_sequence",
    "chordSequence",
    "chord_predictions",
    "predictions",
    "segments",
    "results",
  ]);
  const out: ChordEvent[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Json;
    const start = num(o["start"]) ?? num(o["start_time"]) ?? num(o["time"]) ?? num(o["timestamp"]);
    const end =
      num(o["end"]) ?? num(o["end_time"]) ?? num(o["endTime"]) ?? num(o["duration"]);
    const labelRaw =
      o["chord"] ?? o["label"] ?? o["name"] ?? o["chord_label"] ?? o["chordLabel"];
    if (start === null || typeof labelRaw !== "string") continue;
    out.push({
      start,
      end: end !== null && end > start ? end : start,
      label: normalizeChordLabel(labelRaw),
      confidence: num(o["confidence"]) ?? 0.8,
    });
  }

  out.sort((a, b) => a.start - b.start);
  // Fill missing end times from the next onset.
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    const next = out[i + 1];
    if (cur.end <= cur.start) cur.end = next ? next.start : cur.start + 2;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Key estimation from the chord track                                 */
/* ------------------------------------------------------------------ */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Returns the pitch classes (0–11) belonging to a chord label, used for
 * building a weighted chroma histogram during key estimation.
 *
 * @param label - Chord label string (e.g. `"Dm7"`).
 * @returns Array of pitch-class integers, or empty array for unrecognised labels.
 */
function chordTones(label: string): number[] {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(label);
  if (!m) return [];
  const root = noteToPc(m[1]!);
  if (root === null) return [];
  const q = m[2]!;
  const third = /^(m|min)(?!aj)/.test(q) || /dim/.test(q) ? 3 : 4;
  const fifth = /dim/.test(q) ? 6 : /aug/.test(q) ? 8 : 7;
  const tones = [root, (root + third) % 12, (root + fifth) % 12];
  if (/7/.test(q)) tones.push((root + (/maj7/i.test(q) ? 11 : /dim7/.test(q) ? 9 : 10)) % 12);
  return tones;
}

/**
 * Estimates the musical key (tonic pitch class + mode) from a sequence of chord
 * events by building a duration-weighted chroma histogram and correlating it
 * against Krumhansl-Schmuckler major/minor key profiles.
 *
 * @param chords - Array of `ChordEvent` objects from the analysis.
 * @returns `{ pc, mode }` where `pc` is 0–11 (C…B) and `mode` is `"major"` or `"minor"`.
 */
export function estimateKeyFromChords(chords: ChordEvent[]): {
  pc: number;
  mode: "major" | "minor";
} {
  const chroma = new Array(12).fill(0) as number[];
  for (const c of chords) {
    if (c.label === "N") continue;
    const dur = Math.max(0.1, c.end - c.start);
    const tones = chordTones(c.label);
    tones.forEach((pc, i) => {
      chroma[pc]! += dur * (i === 0 ? 1.6 : 1);
    });
  }
  const total = chroma.reduce((a, b) => a + b, 0) || 1;
  const norm = chroma.map((v) => v / total);

  let best = { pc: 0, mode: "major" as "major" | "minor", score: -Infinity };
  for (let shift = 0; shift < 12; shift++) {
    let maj = 0;
    let min = 0;
    for (let i = 0; i < 12; i++) {
      const v = norm[(i + shift) % 12]!;
      maj += v * MAJOR_PROFILE[i]!;
      min += v * MINOR_PROFILE[i]!;
    }
    if (maj > best.score) best = { pc: shift, mode: "major", score: maj };
    if (min > best.score) best = { pc: shift, mode: "minor", score: min };
  }
  return { pc: best.pc, mode: best.mode };
}

/* ------------------------------------------------------------------ */
/* Normalisation into AnalysisResult                                   */
/* ------------------------------------------------------------------ */

/**
 * Computes the median inter-beat interval from a sorted beat array, ignoring
 * values that are too short (< 150 ms) or too long (> 2 s) to be real beats.
 *
 * @param beats - Sorted array of beat timestamps in seconds.
 * @returns Median IBI in seconds, or `null` if there are too few valid gaps.
 */
function medianInterval(beats: number[]): number | null {
  if (beats.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const g = beats[i]! - beats[i - 1]!;
    if (g > 0.15 && g < 2) gaps.push(g);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * Converts the raw JSON payloads returned by a ChordMini/TensorFlow analysis
 * call into a normalised `AnalysisResult` object ready for the frontend.
 *
 * @param beatsPayload  - JSON object containing beat timestamps and optional BPM.
 * @param chordsPayload - JSON object containing chord event segments.
 * @param duration      - Track duration in seconds (used as fallback).
 * @returns A fully populated `AnalysisResult`.
 * @throws {Error} When the chord payload contains no segments.
 */
export function toAnalysisResult(
  beatsPayload: Json,
  chordsPayload: Json,
  duration: number,
): AnalysisResult {
  const { beats, downbeats } = parseBeats(beatsPayload);
  const chords = parseChords(chordsPayload);
  if (chords.length === 0) throw new Error("Chord analysis returned no chord segments");

  const gap = medianInterval(beats);
  const reportedBpm = firstNumber(beatsPayload, ["bpm", "tempo", "BPM", "estimated_bpm"]);
  const bpm = Math.round(
    reportedBpm && reportedBpm > 40 && reportedBpm < 240
      ? reportedBpm
      : gap
        ? 60 / gap
        : 120,
  );

  let timeSignature =
    firstNumber(beatsPayload, ["time_signature", "timeSignature", "beats_per_bar"]) ?? 0;
  if (!timeSignature || timeSignature < 2 || timeSignature > 12) {
    if (downbeats.length > 1 && gap) {
      const barGaps: number[] = [];
      for (let i = 1; i < downbeats.length; i++) barGaps.push(downbeats[i]! - downbeats[i - 1]!);
      barGaps.sort((a, b) => a - b);
      const barLen = barGaps[Math.floor(barGaps.length / 2)] ?? 0;
      timeSignature = Math.round(barLen / gap) || 4;
    } else {
      timeSignature = 4;
    }
  }
  if (timeSignature < 2 || timeSignature > 12) timeSignature = 4;

  const total = Math.max(
    duration || 0,
    chords[chords.length - 1]!.end,
    beats[beats.length - 1] ?? 0,
  );

  const grid = beats.length >= 4 ? beats : buildGrid(total, 60 / bpm);
  const beatChords = grid.map((t) => {
    const hit = chords.find((c) => t >= c.start && t < c.end);
    return hit ? hit.label : "N";
  });

  const key = estimateKeyFromChords(chords);

  return {
    duration: total,
    bpm,
    beats: grid,
    key: pcToNote(key.pc) + (key.mode === "minor" ? "m" : ""),
    keyPc: key.pc,
    mode: key.mode,
    timeSignature: Math.round(timeSignature),
    chords,
    beatChords,
  };
}

/**
 * Builds a regular beat grid spaced by `beatLen` seconds, from 0 to
 * (but not including) `duration`.
 *
 * @param duration - Track duration in seconds.
 * @param beatLen  - Inter-beat interval in seconds.
 * @returns Array of beat timestamps in seconds.
 */
function buildGrid(duration: number, beatLen: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < duration; t += beatLen) out.push(t);
  return out;
}

/* ------------------------------------------------------------------ */
/* Client entry point                                                  */
/* ------------------------------------------------------------------ */

export type ChordMiniOutcome =
  | { ok: true; analysis: AnalysisResult; models: ChordMiniModels }
  | { ok: false; reason: string };

/**
 * Uploads an audio file to the ChordMini backend endpoint, waits for the
 * analysis to complete, and returns a normalised `AnalysisResult`.
 *
 * @param file     - Audio file to analyse.
 * @param duration - Known track duration in seconds (used as a fallback).
 * @param models   - Which beat and chord models to request from ChordMini.
 * @returns A `ChordMiniOutcome` union: `{ ok: true, analysis, models }` on
 *          success or `{ ok: false, reason }` on failure.
 */
export async function analyzeWithChordMini(
  file: File,
  duration: number,
  models: ChordMiniModels = DEFAULT_CHORDMINI_MODELS,
): Promise<ChordMiniOutcome> {
  const body = new FormData();
  body.append("file", file, file.name || "audio");
  body.append("beatModel", models.beatModel);
  body.append("chordModel", models.chordModel);

  try {
    const res = await backendFetch("/api/chordmini", { method: "POST", body });
    const json = (await res.json()) as Json;
    if (!json["ok"]) {
      return { ok: false, reason: String(json["reason"] ?? "ChordMini is unavailable") };
    }
    const analysis = toAnalysisResult(
      (json["beats"] ?? {}) as Json,
      (json["chords"] ?? {}) as Json,
      duration,
    );
    return { ok: true, analysis, models };
  } catch (error) {
    console.error(error);
    return { ok: false, reason: "Could not reach ChordMini" };
  }
}

export type TensorFlowOutcome =
  { ok: true; analysis: AnalysisResult } | { ok: false; reason: string };

/**
 * Uploads an audio file to the TensorFlow chord-model endpoint and returns
 * a normalised `AnalysisResult`.
 *
 * @param file     - Audio file to analyse.
 * @param duration - Known track duration in seconds.
 * @returns A `TensorFlowOutcome` union: `{ ok: true, analysis }` on success
 *          or `{ ok: false, reason }` on failure.
 */
export async function analyzeWithTensorFlow(
  file: File,
  duration: number,
): Promise<TensorFlowOutcome> {
  const body = new FormData();
  body.append("file", file, file.name || "audio");
  try {
    const json = await backendJson<Json>("/api/chord-model", {
      method: "POST",
      body,
    });
    const analysis = toAnalysisResult(
      (json["beats"] ?? {}) as Json,
      (json["chords"] ?? {}) as Json,
      duration,
    );
    return { ok: true, analysis };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "TensorFlow chord analysis failed",
    };
  }
}
