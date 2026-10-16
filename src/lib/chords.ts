export const SHARP_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const FLAT_NOTES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

/**
 * Converts a note name (e.g. "C#", "Bb", "G") to a pitch-class integer (0–11).
 * Returns `null` if the name is not recognised.
 *
 * @param note - Note name string to look up (case-insensitive root letter).
 * @returns Pitch-class index 0–11, or `null` for unrecognised inputs.
 */
export function noteToPc(note: string): number | null {
  const n = note.charAt(0).toUpperCase() + note.slice(1);
  return n in NOTE_INDEX ? NOTE_INDEX[n]! : null;
}

/**
 * Converts a pitch-class integer (0–11, or any integer via wrapping) back to a
 * note name.  Uses sharps by default; pass `useFlats = true` for flat spellings.
 *
 * @param pc      - Pitch-class value (will be wrapped into 0–11).
 * @param useFlats - When `true`, returns flat note names (Db, Eb, …) instead of sharps.
 * @returns Note name string such as "C#", "Gb", "A", etc.
 */
export function pcToNote(pc: number, useFlats = false): string {
  const i = ((pc % 12) + 12) % 12;
  return useFlats ? FLAT_NOTES[i]! : SHARP_NOTES[i]!;
}

/** Matches a chord token like C#m7/G# or Bbsus4 */
export const CHORD_RE = /^([A-G](?:#|b)?)((?:maj|min|m|dim|aug|sus|add|M)?[0-9a-zA-Z+#°Δ()-]*)(?:\/([A-G](?:#|b)?))?$/;

export interface ParsedChord {
  root: string;
  quality: string;
  bass?: string;
}

/**
 * Parses a chord token into its constituent parts: root note, quality suffix,
 * and optional bass note (slash chords like "G/B").
 *
 * @param token - Chord string to parse (e.g. "Am7", "C#maj7/E").
 * @returns A `ParsedChord` object with `root`, `quality`, and optional `bass`,
 *          or `null` if the token does not look like a chord.
 */
export function parseChord(token: string): ParsedChord | null {
  const m = CHORD_RE.exec(token.trim());
  if (!m) return null;
  const [, root, quality, bass] = m;
  if (!root) return null;
  return { root, quality: quality ?? "", ...(bass ? { bass } : {}) };
}

/**
 * Transposes a chord token by the given number of semitones, preserving the
 * quality suffix and optional bass note.  Returns the original string unchanged
 * if the token cannot be parsed as a chord.
 *
 * @param token     - Chord string to transpose (e.g. "Am7").
 * @param semitones - Number of semitones to transpose up (positive) or down (negative).
 * @param useFlats  - When `true`, spell the transposed root/bass with flats.
 * @returns Transposed chord string (e.g. "Bm7" for "Am7" + 2 semitones).
 */
export function transposeChord(token: string, semitones: number, useFlats = false): string {
  const parsed = parseChord(token);
  if (!parsed) return token;
  const rootPc = noteToPc(parsed.root);
  if (rootPc === null) return token;
  let out = pcToNote(rootPc + semitones, useFlats) + parsed.quality;
  if (parsed.bass) {
    const bassPc = noteToPc(parsed.bass);
    if (bassPc !== null) out += "/" + pcToNote(bassPc + semitones, useFlats);
  }
  return out;
}

/**
 * Returns `true` when the given token looks like a valid chord name according
 * to `CHORD_RE` (e.g. "Cmaj7", "F#m", "Bb").
 *
 * @param token - Single whitespace-free token to test.
 * @returns `true` if the token is a recognisable chord name, `false` otherwise.
 */
export function isChordToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return CHORD_RE.test(t);
}

/** A text line counts as a chord line when most of its tokens are chords. */
/**
 * Heuristically decides whether a line of text is a chord line (as opposed to
 * a lyric line).  A line qualifies when at least 60 % of its whitespace-separated
 * tokens are recognisable chord names.
 *
 * @param line - A single line of text from a chord-sheet or lyric file.
 * @returns `true` when the majority of tokens look like chords.
 */
export function looksLikeChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const chords = tokens.filter(isChordToken).length;
  return chords / tokens.length >= 0.6;
}

export const KEY_NAMES = (useFlats = false) =>
  Array.from({ length: 12 }, (_, i) => pcToNote(i, useFlats));

/** Nashville-style roman numerals for a chord within a key. */
const MAJOR_DEGREES = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];

/**
 * Returns the Nashville-style Roman numeral for a chord within a given key.
 * Major chords use upper-case numerals (I, IV, V); minor chords use lower-case
 * (i, iv, v).  Chromatic degrees are prefixed with "b" (e.g. "bVII").
 *
 * @param chord - Chord label to describe (e.g. "Am", "G7").
 * @param keyPc - Pitch class of the tonic (0 = C, 1 = C#/Db, …).
 * @returns Roman numeral string such as "IV", "vi", "bVII", or "" if unparseable.
 */
export function romanNumeral(chord: string, keyPc: number): string {
  const p = parseChord(chord);
  if (!p) return "";
  const pc = noteToPc(p.root);
  if (pc === null) return "";
  const deg = MAJOR_DEGREES[(((pc - keyPc) % 12) + 12) % 12]!;
  const minor = /^(m|min)(?!aj)/.test(p.quality);
  return minor ? deg.toLowerCase() : deg;
}

/** Guitar voicings: string order low E -> high E. -1 = muted, 0 = open. */
export const GUITAR_SHAPES: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  Cm: [-1, 3, 5, 5, 4, 3],
  C7: [-1, 3, 2, 3, 1, 0],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  "C#": [-1, 4, 3, 1, 2, 1],
  "C#m": [-1, 4, 6, 6, 5, 4],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  D7: [-1, -1, 0, 2, 1, 2],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Dm7: [-1, -1, 0, 2, 1, 1],
  "D#": [-1, -1, 1, 3, 4, 3],
  "D#m": [-1, -1, 1, 3, 4, 2],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 2, 0, 3, 0],
  Emaj7: [0, 2, 1, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fm: [1, 3, 3, 1, 1, 1],
  F7: [1, 3, 1, 2, 1, 1],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  "F#": [2, 4, 4, 3, 2, 2],
  "F#m": [2, 4, 4, 2, 2, 2],
  "F#m7": [2, 4, 2, 2, 2, 2],
  G: [3, 2, 0, 0, 0, 3],
  Gm: [3, 5, 5, 3, 3, 3],
  G7: [3, 2, 0, 0, 0, 1],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  "G#": [4, 6, 6, 5, 4, 4],
  "G#m": [4, 6, 6, 4, 4, 4],
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  "A#": [-1, 1, 3, 3, 3, 1],
  "A#m": [-1, 1, 3, 3, 2, 1],
  B: [-1, 2, 4, 4, 4, 2],
  Bm: [-1, 2, 4, 4, 3, 2],
  B7: [-1, 2, 1, 2, 0, 2],
  Bm7: [-1, 2, 4, 2, 3, 2],
};

/**
 * Looks up a standard open-position guitar voicing for a chord label.
 * Tries an exact match first, then resolves enharmonic equivalents and falls
 * back to a simplified voicing (e.g. Am for Am7 when Am7 is unavailable).
 *
 * @param chord - Chord label to look up (e.g. "Dm7", "F#m").
 * @returns Array of 6 fret numbers [low-E … high-E] where -1 = muted, 0 = open,
 *          or `null` when no voicing is available in the built-in library.
 */
export function shapeFor(chord: string): number[] | null {
  if (GUITAR_SHAPES[chord]) return GUITAR_SHAPES[chord]!;
  const p = parseChord(chord);
  if (!p) return null;
  const pc = noteToPc(p.root);
  if (pc === null) return null;
  const sharpRoot = pcToNote(pc);
  const q = p.quality.replace(/^min(?!aj)/, "m");
  return GUITAR_SHAPES[sharpRoot + q] ?? GUITAR_SHAPES[sharpRoot + (q.startsWith("m") ? "m" : "")] ?? null;
}
