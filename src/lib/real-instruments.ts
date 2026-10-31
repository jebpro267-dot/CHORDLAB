// High-Fidelity Real Instrument Soundfont & Studio Sample Engine for ChordLab DAW
// Real sampled audio from FluidR3_GM / MusyngKite studio soundfonts with instant hybrid fallback.

import type { DawDrumType, DawInstrumentType } from "./daw-audio";

// Soundfont instrument name mapping for Gleitz CDN
const SOUNDFONT_MAP: Record<DawInstrumentType, string> = {
  grand_piano: "acoustic_grand_piano",
  electric_piano: "electric_piano_1",
  acoustic_guitar: "acoustic_guitar_steel",
  electric_guitar_clean: "electric_guitar_clean",
  electric_guitar_lead: "distortion_guitar",
  modern_bass: "electric_bass_finger",
  string_section: "string_ensemble_1",
  rock_organ: "drawbar_organ",
  flute: "flute",
  brass_section: "brass_section",
  synth_lead: "lead_1_square",
  drum_kit: "synth_drum",
  percussion: "synth_drum",
  vocals: "lead_1_square",
};

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex] ?? "C"}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-Ga-g][b#]?)(-?\d+)$/);
  if (!match) return 60; // C4 default
  const noteStr = match[1]?.toUpperCase() ?? "C";
  const octave = parseInt(match[2] ?? "4", 10);
  const noteIndex = NOTE_NAMES.indexOf(noteStr === "C#" ? "Db" : noteStr === "D#" ? "Eb" : noteStr === "F#" ? "Gb" : noteStr === "G#" ? "Ab" : noteStr === "A#" ? "Bb" : noteStr);
  return (octave + 1) * 12 + (noteIndex >= 0 ? noteIndex : 0);
}

// In-memory cache for decoded instrument audio buffers: instrument -> noteName -> AudioBuffer
const soundfontBufferCache: Map<string, Map<string, AudioBuffer>> = new Map();
const soundfontLoadingPromises: Map<string, Promise<boolean>> = new Map();

// Studio drum sample cache
const studioDrumBufferCache: Map<string, AudioBuffer> = new Map();

/**
 * Base64 to ArrayBuffer helper
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Loads a real instrument soundfont from high-speed CDN and decodes audio buffers.
 */
export async function preloadSoundfont(
  ctx: AudioContext,
  instrument: DawInstrumentType
): Promise<boolean> {
  const soundfontName = SOUNDFONT_MAP[instrument];
  if (!soundfontName) return false;
  if (soundfontBufferCache.has(soundfontName)) return true;

  if (soundfontLoadingPromises.has(soundfontName)) {
    return soundfontLoadingPromises.get(soundfontName)!;
  }

  const loadPromise = (async () => {
    try {
      const url = `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${soundfontName}-mp3.js`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      // Parse MIDI.Soundfont.{name} = { ... } format
      let dataObj: Record<string, string> = {};
      try {
        const MIDI = { Soundfont: {} as Record<string, Record<string, string>> };
        const parserFn = new Function("MIDI", text + "\nreturn MIDI.Soundfont;");
        const soundfonts = parserFn(MIDI) as Record<string, Record<string, string>>;
        dataObj = soundfonts[soundfontName] || {};
      } catch {
        // Safe regex fallback if new Function is restricted
        const regex = /"([A-Ga-g][b#]?-?\d+)":\s*"(data:audio\/mp3;base64,[^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          if (match[1] && match[2]) {
            dataObj[match[1]] = match[2];
          }
        }
      }

      const instrumentBuffers = new Map<string, AudioBuffer>();

      // Decode samples in parallel batches
      const entries = Object.entries(dataObj);
      const decodeTasks = entries.map(async ([noteKey, dataUri]) => {
        try {
          const b64Data = dataUri.split(",")[1];
          if (!b64Data) return;
          const arrayBuf = base64ToArrayBuffer(b64Data);
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          instrumentBuffers.set(noteKey, audioBuf);
        } catch (_) {
          // ignore individual note decode error
        }
      });

      await Promise.all(decodeTasks);

      if (instrumentBuffers.size > 0) {
        soundfontBufferCache.set(soundfontName, instrumentBuffers);
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`Soundfont load fallback for ${soundfontName}:`, err);
      return false;
    } finally {
      soundfontLoadingPromises.delete(soundfontName);
    }
  })();

  soundfontLoadingPromises.set(soundfontName, loadPromise);
  return loadPromise;
}

/**
 * Synthesizes high-definition studio drum samples (Acoustic Punch Kick, Crisp Snare, Metallic Hats, Claps, Toms, Crash).
 */
export function getStudioDrumBuffer(ctx: AudioContext, type: DawDrumType): AudioBuffer {
  const key = `${ctx.sampleRate}_${type}`;
  if (studioDrumBufferCache.has(key)) {
    return studioDrumBufferCache.get(key)!;
  }

  const sampleRate = ctx.sampleRate;

  switch (type) {
    case "kick": {
      // Acoustic & 808 Layered Punch Kick: 0.4s
      const len = Math.floor(sampleRate * 0.45);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        // Pitch drop from 180Hz down to 42Hz
        const freq = 42 + 138 * Math.exp(-t * 28);
        const phase = 2 * Math.PI * (42 * t + (138 / 28) * (1 - Math.exp(-t * 28)));
        // Sub-body sine with tape saturation
        const sub = Math.sin(phase) * Math.exp(-t * 7.5);
        // Beater transient click (first 12ms)
        const click = t < 0.015 ? (Math.random() * 2 - 1) * Math.exp(-t * 250) * 0.45 : 0;
        const s = Math.tanh(sub * 1.35 + click);
        left[i] = s * 0.95;
        right[i] = s * 0.95;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "snare": {
      // Studio Snare Drum (Wood body + wire rattle): 0.35s
      const len = Math.floor(sampleRate * 0.4);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        // Body tone (195Hz with quick decay)
        const tone = Math.sin(2 * Math.PI * 195 * t) * Math.exp(-t * 22) * 0.6;
        const overTone = Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 30) * 0.3;
        // Crisp high-frequency snare wire rattle
        const noiseL = (Math.random() * 2 - 1) * Math.exp(-t * 11) * 0.65;
        const noiseR = (Math.random() * 2 - 1) * Math.exp(-t * 11) * 0.65;
        // Transient snap
        const snap = t < 0.008 ? Math.exp(-t * 350) * 0.4 : 0;

        left[i] = Math.tanh(tone + overTone + noiseL + snap);
        right[i] = Math.tanh(tone + overTone + noiseR + snap);
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "hihat": {
      // Crisp Closed Studio Hi-Hat: 0.06s
      const len = Math.floor(sampleRate * 0.075);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        // Metallic modal cluster (frequencies ~ 7kHz, 9.8kHz, 12kHz)
        const metal =
          (Math.sin(2 * Math.PI * 7200 * t) +
            Math.sin(2 * Math.PI * 9450 * t) +
            Math.sin(2 * Math.PI * 11800 * t)) *
          0.2;
        const noise = (Math.random() * 2 - 1) * 0.6;
        const env = Math.exp(-t * 65);
        const s = (metal + noise) * env;
        left[i] = s * 0.8;
        right[i] = s * 0.75;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "hihat_open": {
      // Sizzling Open Studio Hi-Hat: 0.45s
      const len = Math.floor(sampleRate * 0.5);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        const metal =
          (Math.sin(2 * Math.PI * 6800 * t) +
            Math.sin(2 * Math.PI * 9100 * t) +
            Math.sin(2 * Math.PI * 12200 * t)) *
          0.25;
        const noiseL = (Math.random() * 2 - 1) * 0.55;
        const noiseR = (Math.random() * 2 - 1) * 0.55;
        const env = Math.exp(-t * 7.5);
        left[i] = (metal + noiseL) * env * 0.7;
        right[i] = (metal + noiseR) * env * 0.7;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "clap": {
      // Studio Handclap (triple micro-burst + room tail): 0.35s
      const len = Math.floor(sampleRate * 0.38);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        let burst = 0;
        if (t < 0.011) burst = Math.exp(-t * 220);
        else if (t >= 0.011 && t < 0.024) burst = Math.exp(-(t - 0.011) * 220);
        else if (t >= 0.024 && t < 0.038) burst = Math.exp(-(t - 0.024) * 200);
        else burst = Math.exp(-(t - 0.038) * 16) * 0.9;

        const noiseL = (Math.random() * 2 - 1) * burst;
        const noiseR = (Math.random() * 2 - 1) * burst;
        left[i] = noiseL * 0.85;
        right[i] = noiseR * 0.85;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "tom": {
      // Tuned Low-Mid Drum Tom: 0.5s
      const len = Math.floor(sampleRate * 0.55);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        const freq = 85 + 65 * Math.exp(-t * 14);
        const tone = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6.5);
        const stick = t < 0.01 ? (Math.random() * 2 - 1) * 0.4 : 0;
        const s = Math.tanh(tone + stick);
        left[i] = s * 0.9;
        right[i] = s * 0.9;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "crash": {
      // Shimmering 18" Studio Crash Cymbal: 2.2s
      const len = Math.floor(sampleRate * 2.2);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 1.8);
        const metalL =
          (Math.sin(2 * Math.PI * 4500 * t) +
            Math.sin(2 * Math.PI * 6800 * t) +
            Math.sin(2 * Math.PI * 8900 * t) +
            Math.sin(2 * Math.PI * 13500 * t)) *
          0.15;
        const metalR =
          (Math.sin(2 * Math.PI * 4520 * t) +
            Math.sin(2 * Math.PI * 6780 * t) +
            Math.sin(2 * Math.PI * 8940 * t) +
            Math.sin(2 * Math.PI * 13460 * t)) *
          0.15;
        const noiseL = (Math.random() * 2 - 1) * 0.6;
        const noiseR = (Math.random() * 2 - 1) * 0.6;
        left[i] = (metalL + noiseL) * env * 0.8;
        right[i] = (metalR + noiseR) * env * 0.8;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }

    case "tambourine":
    default: {
      // Percussive Shaker / Tambourine: 0.18s
      const len = Math.floor(sampleRate * 0.22);
      const buf = ctx.createBuffer(2, len, sampleRate);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);

      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        const jingle = (Math.sin(2 * Math.PI * 8500 * t) + Math.sin(2 * Math.PI * 11200 * t)) * 0.25;
        const noise = (Math.random() * 2 - 1) * 0.55;
        const env = Math.exp(-t * 18);
        left[i] = (jingle + noise) * env * 0.75;
        right[i] = (jingle + noise) * env * 0.7;
      }
      studioDrumBufferCache.set(key, buf);
      return buf;
    }
  }
}

/**
 * Finds the closest sampled note in the soundfont buffer map and computes playback rate.
 */
function findClosestSample(
  buffers: Map<string, AudioBuffer>,
  targetMidi: number
): { buffer: AudioBuffer; playbackRate: number } | null {
  if (buffers.size === 0) return null;

  let bestMidi = -1;
  let minDiff = 999;
  let bestBuffer: AudioBuffer | null = null;

  buffers.forEach((buf, noteKey) => {
    const m = noteNameToMidi(noteKey);
    const diff = Math.abs(m - targetMidi);
    if (diff < minDiff) {
      minDiff = diff;
      bestMidi = m;
      bestBuffer = buf;
    }
  });

  if (!bestBuffer || bestMidi === -1) return null;
  const semitones = targetMidi - bestMidi;
  const playbackRate = Math.pow(2, semitones / 12);
  return { buffer: bestBuffer, playbackRate };
}

/**
 * Plays a real studio instrument note using sampled soundfont audio with smooth ADSR envelope.
 * Returns a stop() function to cleanly release sustained notes.
 */
export function playRealSampledNote(
  ctx: AudioContext,
  instrument: DawInstrumentType,
  note: string | number,
  time = ctx.currentTime,
  duration = 1.0,
  velocity = 0.85,
  destination: AudioNode = ctx.destination
): { stop: () => void } | null {
  const soundfontName = SOUNDFONT_MAP[instrument];
  if (!soundfontName) return null;

  const buffers = soundfontBufferCache.get(soundfontName);
  if (!buffers || buffers.size === 0) {
    // Initiate background pre-load if not yet started
    void preloadSoundfont(ctx, instrument);
    return null; // Signals caller to fall back to enhanced synthesis
  }

  const targetMidi = typeof note === "number" ? note : noteNameToMidi(note);
  const sample = findClosestSample(buffers, targetMidi);
  if (!sample) return null;

  const startTime = Math.max(ctx.currentTime, time);
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.setValueAtTime(sample.playbackRate, startTime);

  // Studio gain envelope
  const gainNode = ctx.createGain();
  const peakGain = Math.max(0.1, Math.min(1.2, velocity * 0.95));

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, startTime + 0.005);
  // Natural sustain
  gainNode.gain.setValueAtTime(peakGain * 0.88, startTime + 0.08);
  // Exponential release
  const releaseStart = startTime + Math.max(0.15, duration - 0.05);
  gainNode.gain.setValueAtTime(peakGain * 0.75, releaseStart);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, releaseStart + 0.25);

  source.connect(gainNode);
  gainNode.connect(destination);

  const stopTime = releaseStart + 0.28;
  source.start(startTime);
  source.stop(stopTime);

  return {
    stop: () => {
      try {
        const now = ctx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        source.stop(now + 0.09);
      } catch (_) {}
    },
  };
}

/**
 * Plays a real studio drum sample with high-definition transient impact.
 */
export function playRealStudioDrum(
  ctx: AudioContext,
  type: DawDrumType,
  time = ctx.currentTime,
  velocity = 0.9,
  destination: AudioNode = ctx.destination
): void {
  const buffer = getStudioDrumBuffer(ctx, type);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const startTime = Math.max(ctx.currentTime, time);
  const gain = ctx.createGain();
  const v = Math.max(0.1, Math.min(1.5, velocity));
  gain.gain.setValueAtTime(v, startTime);

  source.connect(gain);
  gain.connect(destination);
  source.start(startTime);
}

// ========================================================
// GARAGEBAND / BANDLAB SMART CHORD STRIPS DEFINITIONS
// ========================================================

export interface SmartChordVoicing {
  chordName: string;
  rootNote: string;
  bassNotes: string[]; // [Root Bass, 5th Bass]
  guitarStrum: string[]; // 6 strings from low to high e.g. ["E2", "B2", "E3", "G#3", "B3", "E4"]
  pianoVoicing: string[]; // [Left Hand Root, Right Hand Triad/7th]
}

export const GARAGEBAND_SMART_CHORDS: Record<string, SmartChordVoicing[]> = {
  "C Maj": [
    {
      chordName: "C",
      rootNote: "C",
      bassNotes: ["C2", "G2"],
      guitarStrum: ["C3", "E3", "G3", "C4", "E4"],
      pianoVoicing: ["C2", "G2", "C4", "E4", "G4"],
    },
    {
      chordName: "Dm",
      rootNote: "D",
      bassNotes: ["D2", "A2"],
      guitarStrum: ["D3", "A3", "D4", "F4"],
      pianoVoicing: ["D2", "A2", "D4", "F4", "A4"],
    },
    {
      chordName: "Em",
      rootNote: "E",
      bassNotes: ["E2", "B2"],
      guitarStrum: ["E2", "B2", "E3", "G3", "B3", "E4"],
      pianoVoicing: ["E2", "B2", "E4", "G4", "B4"],
    },
    {
      chordName: "F",
      rootNote: "F",
      bassNotes: ["F2", "C3"],
      guitarStrum: ["F2", "C3", "F3", "A3", "C4", "F4"],
      pianoVoicing: ["F2", "C3", "F4", "A4", "C5"],
    },
    {
      chordName: "G",
      rootNote: "G",
      bassNotes: ["G2", "D3"],
      guitarStrum: ["G2", "B2", "D3", "G3", "B3", "G4"],
      pianoVoicing: ["G2", "D3", "G4", "B4", "D5"],
    },
    {
      chordName: "Am",
      rootNote: "A",
      bassNotes: ["A1", "E2"],
      guitarStrum: ["A2", "E3", "A3", "C4", "E4"],
      pianoVoicing: ["A1", "E2", "A3", "C4", "E4"],
    },
    {
      chordName: "Bdim",
      rootNote: "B",
      bassNotes: ["B1", "F2"],
      guitarStrum: ["B2", "F3", "B3", "D4"],
      pianoVoicing: ["B1", "F2", "B3", "D4", "F4"],
    },
    {
      chordName: "Bb",
      rootNote: "Bb",
      bassNotes: ["Bb1", "F2"],
      guitarStrum: ["Bb2", "F3", "Bb3", "D4", "F4"],
      pianoVoicing: ["Bb1", "F2", "Bb3", "D4", "F4"],
    },
  ],
};

