import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Activity,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Disc,
  Download,
  Flame,
  FolderPlus,
  Guitar,
  HelpCircle,
  Keyboard,
  Maximize2,
  Megaphone,
  Mic,
  Minimize2,
  Music,
  Music2,
  Pause,
  Piano,
  Play,
  Plus,
  Radio,
  Repeat,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wind,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DAW_INSTRUMENTS,
  DawInstrumentInfo,
  DawInstrumentType,
  DawDrumType,
  playDawInstrumentSound,
  playDawDrumSound,
  noteToFrequency,
  midiToNote,
} from "@/lib/daw-audio";
import { getMicrophoneStream } from "@/lib/microphone";
import { putAudio } from "@/lib/audio-store";
import { newId, saveSong, Song } from "@/lib/storage";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Music Studio — ChordLab DAW" },
      {
        name: "description",
        content: "GarageBand-style music creation studio with real instruments, multi-track recording, line-in, and file uploads.",
      },
    ],
  }),
  component: CreateMusicPage,
});

// ==========================================
// DATA STRUCTURES
// ==========================================

export interface NoteEvent {
  note: string;
  beat: number; // in beats from start of clip
  duration: number; // in beats
  velocity: number;
}

export interface AudioClip {
  id: string;
  name: string;
  startBeat: number;
  durationBeats: number;
  type: "audio" | "midi" | "drums";
  audioBuffer?: AudioBuffer;
  waveformPeaks?: number[];
  notes?: NoteEvent[];
  drumPattern?: boolean[][]; // 8 drum rows x 16 steps
}

export interface DawTrack {
  id: string;
  name: string;
  instrument: DawInstrumentType;
  color: string;
  volume: number; // 0 to 100
  pan: number; // -50 to 50
  isMuted: boolean;
  isSolo: boolean;
  isArmed: boolean;
  clips: AudioClip[];
  eqBass: number; // -12 to 12 dB
  eqTreble: number; // -12 to 12 dB
  reverb: number; // 0 to 100%
}

// Preset Drum Patterns
const DRUM_PRESETS: Record<string, boolean[][]> = {
  Rock: [
    // Kick (0), Snare (1), HiHat (2), HiHatOpen (3), Clap (4), Tom (5), Crash (6), Tambourine (7)
    [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false], // Kick
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Snare
    [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false], // HiHat
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true], // HiHat Open
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Clap
    [false, false, false, false, false, false, false, false, false, false, false, false, false, true, false, false], // Tom
    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Crash
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Tambourine
  ],
  HipHop: [
    [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false], // Kick
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Snare
    [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // HiHat
    [false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false], // HiHat Open
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Clap
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Tom
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Crash
    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false], // Tambourine
  ],
  Pop: [
    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false], // Kick (Four-on-the-floor)
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Snare
    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false], // HiHat
    [false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, true], // HiHat Open
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Clap
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Tom
    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Crash
    [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false], // Tambourine
  ],
  Dance: [
    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false], // Kick
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Snare
    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false], // HiHat
    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false], // HiHat Open
    [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], // Clap
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Tom
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // Crash
    [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true], // Tambourine
  ],
};

const DRUM_NAMES = [
  "Kick",
  "Snare",
  "Hi-Hat Closed",
  "Hi-Hat Open",
  "Clap",
  "Tom",
  "Crash",
  "Tambourine",
];
const DRUM_TYPES: DawDrumType[] = [
  "kick",
  "snare",
  "hihat",
  "hihat_open",
  "clap",
  "tom",
  "crash",
  "tambourine",
];

// Helper to render waveform peaks
function extractWaveformPeaks(buffer: AudioBuffer, numPeaks = 80): number[] {
  const data = buffer.getChannelData(0);
  const step = Math.floor(data.length / numPeaks);
  const peaks: number[] = [];
  for (let i = 0; i < numPeaks; i++) {
    let max = 0;
    const start = i * step;
    const end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) {
      const val = Math.abs(data[j] ?? 0);
      if (val > max) max = val;
    }
    peaks.push(Math.min(1, max));
  }
  return peaks;
}

export function CreateMusicPage() {
  const navigate = useNavigate();

  // Project Settings
  const [songTitle, setSongTitle] = useState("My GarageBand Track");
  const [bpm, setBpm] = useState(120);
  const [timeSignature] = useState("4/4");
  const [keySignature] = useState("C Maj");
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [isMetronomeActive, setIsMetronomeActive] = useState(true);
  const [isCountInActive, setIsCountInActive] = useState(true);
  const [isCycleActive, setIsCycleActive] = useState(true);
  const [cycleStartBar, setCycleStartBar] = useState(1);
  const [cycleEndBar, setCycleEndBar] = useState(5); // 4 bars cycle by default

  // Transport state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0); // 0-indexed beat (0 = bar 1 beat 1)
  const [totalBars, setTotalBars] = useState(12);

  // Selected Track & Bottom Drawer State
  const [selectedTrackId, setSelectedTrackId] = useState<string>("track-1");
  const [activeDrawerTab, setActiveDrawerTab] = useState<"instrument" | "linein" | "upload" | "mixer">("instrument");
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false);

  // Keyboard / Instrument Player State
  const [currentOctave, setCurrentOctave] = useState(4);
  const [showNoteLabels, setShowNoteLabels] = useState(true);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());

  // Line-in & Mic Recording State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [inputGain, setInputGain] = useState(1.0);
  const [vuLevel, setVuLevel] = useState(0); // 0 to 1
  const [isInputClipping, setIsInputClipping] = useState(false);

  // Add Track Modal
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartBeatRef = useRef<number>(0);
  const monitorNodeRef = useRef<GainNode | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playheadAnimRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const beatSchedulerRef = useRef<number | null>(null);

  // Initial Tracks (GarageBand Style Starter Template)
  const [tracks, setTracks] = useState<DawTrack[]>([
    {
      id: "track-1",
      name: "Guitar Solo",
      instrument: "electric_guitar_lead",
      color: "#eab308", // Yellow
      volume: 85,
      pan: 0,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: 0,
      eqTreble: 2,
      reverb: 35,
      clips: [
        {
          id: "clip-guitar-1",
          name: "Guitar Solo Take",
          startBeat: 0,
          durationBeats: 16,
          type: "midi",
          notes: [
            { note: "E4", beat: 0, duration: 1, velocity: 0.9 },
            { note: "G4", beat: 1, duration: 1, velocity: 0.9 },
            { note: "A4", beat: 2, duration: 2, velocity: 0.95 },
            { note: "B4", beat: 4, duration: 1, velocity: 0.85 },
            { note: "D5", beat: 5, duration: 1, velocity: 0.9 },
            { note: "E5", beat: 6, duration: 2, velocity: 1.0 },
            { note: "D5", beat: 8, duration: 1, velocity: 0.85 },
            { note: "B4", beat: 9, duration: 1, velocity: 0.8 },
            { note: "A4", beat: 10, duration: 2, velocity: 0.9 },
            { note: "G4", beat: 12, duration: 1, velocity: 0.85 },
            { note: "E4", beat: 13, duration: 3, velocity: 0.95 },
          ],
        },
      ],
    },
    {
      id: "track-2",
      name: "Ac Guitar",
      instrument: "acoustic_guitar",
      color: "#3b82f6", // Blue
      volume: 80,
      pan: -20,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: -1,
      eqTreble: 1,
      reverb: 20,
      clips: [
        {
          id: "clip-ac-guitar",
          name: "Acoustic Strum",
          startBeat: 0,
          durationBeats: 16,
          type: "midi",
          notes: [
            { note: "C3", beat: 0, duration: 2, velocity: 0.8 },
            { note: "E3", beat: 0, duration: 2, velocity: 0.75 },
            { note: "G3", beat: 0, duration: 2, velocity: 0.8 },
            { note: "C4", beat: 0, duration: 2, velocity: 0.85 },
            { note: "G2", beat: 4, duration: 2, velocity: 0.8 },
            { note: "D3", beat: 4, duration: 2, velocity: 0.8 },
            { note: "G3", beat: 4, duration: 2, velocity: 0.8 },
            { note: "B3", beat: 4, duration: 2, velocity: 0.85 },
            { note: "A2", beat: 8, duration: 2, velocity: 0.8 },
            { note: "E3", beat: 8, duration: 2, velocity: 0.8 },
            { note: "A3", beat: 8, duration: 2, velocity: 0.8 },
            { note: "C4", beat: 8, duration: 2, velocity: 0.85 },
            { note: "F2", beat: 12, duration: 2, velocity: 0.8 },
            { note: "C3", beat: 12, duration: 2, velocity: 0.8 },
            { note: "F3", beat: 12, duration: 2, velocity: 0.8 },
            { note: "A3", beat: 12, duration: 2, velocity: 0.85 },
          ],
        },
      ],
    },
    {
      id: "track-3",
      name: "Modern Bass",
      instrument: "modern_bass",
      color: "#2563eb", // Deep Blue
      volume: 85,
      pan: 0,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: 3,
      eqTreble: -2,
      reverb: 10,
      clips: [
        {
          id: "clip-bass-1",
          name: "Bass Groove",
          startBeat: 0,
          durationBeats: 16,
          type: "midi",
          notes: [
            { note: "C2", beat: 0, duration: 1.5, velocity: 0.9 },
            { note: "C2", beat: 2, duration: 1, velocity: 0.85 },
            { note: "G1", beat: 4, duration: 1.5, velocity: 0.9 },
            { note: "G1", beat: 6, duration: 1, velocity: 0.85 },
            { note: "A1", beat: 8, duration: 1.5, velocity: 0.9 },
            { note: "A1", beat: 10, duration: 1, velocity: 0.85 },
            { note: "F1", beat: 12, duration: 1.5, velocity: 0.9 },
            { note: "F1", beat: 14, duration: 1, velocity: 0.85 },
          ],
        },
      ],
    },
    {
      id: "track-4",
      name: "Grand Piano",
      instrument: "grand_piano",
      color: "#22c55e", // Apple Green
      volume: 80,
      pan: 15,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: 0,
      eqTreble: 1,
      reverb: 25,
      clips: [
        {
          id: "clip-piano-1",
          name: "Piano Chords",
          startBeat: 0,
          durationBeats: 16,
          type: "midi",
          notes: [
            { note: "C4", beat: 0, duration: 2, velocity: 0.8 },
            { note: "E4", beat: 0, duration: 2, velocity: 0.8 },
            { note: "G4", beat: 0, duration: 2, velocity: 0.8 },
            { note: "G3", beat: 4, duration: 2, velocity: 0.8 },
            { note: "B3", beat: 4, duration: 2, velocity: 0.8 },
            { note: "D4", beat: 4, duration: 2, velocity: 0.8 },
            { note: "A3", beat: 8, duration: 2, velocity: 0.8 },
            { note: "C4", beat: 8, duration: 2, velocity: 0.8 },
            { note: "E4", beat: 8, duration: 2, velocity: 0.8 },
            { note: "F3", beat: 12, duration: 2, velocity: 0.8 },
            { note: "A3", beat: 12, duration: 2, velocity: 0.8 },
            { note: "C4", beat: 12, duration: 2, velocity: 0.8 },
          ],
        },
      ],
    },
    {
      id: "track-5",
      name: "Studio Drum Kit",
      instrument: "drum_kit",
      color: "#f97316", // Orange
      volume: 90,
      pan: 0,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: 2,
      eqTreble: 2,
      reverb: 15,
      clips: [
        {
          id: "clip-drums-1",
          name: "Rock Drum Pattern",
          startBeat: 0,
          durationBeats: 16,
          type: "drums",
          drumPattern: DRUM_PRESETS.Rock,
        },
      ],
    },
    {
      id: "track-6",
      name: "My Vocal",
      instrument: "vocals",
      color: "#a855f7", // Purple
      volume: 85,
      pan: 0,
      isMuted: false,
      isSolo: false,
      isArmed: true,
      eqBass: -1,
      eqTreble: 3,
      reverb: 30,
      clips: [],
    },
  ]);

  // Selected Track Helper
  const selectedTrack = useMemo(() => {
    return tracks.find((t) => t.id === selectedTrackId) ?? tracks[0];
  }, [tracks, selectedTrackId]);

  // Audio Context Initialization
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtxClass();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current);
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Handle Metronome Click
  const playMetronomeClick = useCallback(
    (time: number, isDownbeat: boolean) => {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(isDownbeat ? 1400 : 900, time);
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.05);
    },
    [getAudioContext]
  );

  // Keyboard Play Function
  const handlePlayNote = useCallback(
    (noteStr: string, velocity = 0.9) => {
      const ctx = getAudioContext();
      if (!selectedTrack) return;
      playDawInstrumentSound(ctx, selectedTrack.instrument, noteStr, ctx.currentTime, 0.8, velocity);
      setActiveNotes((prev) => new Set(prev).add(noteStr));
      setTimeout(() => {
        setActiveNotes((prev) => {
          const next = new Set(prev);
          next.delete(noteStr);
          return next;
        });
      }, 250);

      // If recording, record note into selected track
      if (isRecording && selectedTrack) {
        const beatPosition = Math.max(0, currentBeat);
        setTracks((prev) =>
          prev.map((t) => {
            if (t.id !== selectedTrack.id) return t;
            const existingClip = t.clips[0];
            const newNote: NoteEvent = {
              note: noteStr,
              beat: beatPosition,
              duration: 1.0,
              velocity,
            };
            if (existingClip) {
              const updatedNotes = [...(existingClip.notes ?? []), newNote];
              return {
                ...t,
                clips: [{ ...existingClip, notes: updatedNotes }],
              };
            } else {
              return {
                ...t,
                clips: [
                  {
                    id: `clip-${Date.now()}`,
                    name: `${t.name} Take`,
                    startBeat: 0,
                    durationBeats: 16,
                    type: "midi",
                    notes: [newNote],
                  },
                ],
              };
            }
          })
        );
      }
    },
    [getAudioContext, selectedTrack, isRecording, currentBeat]
  );

  // Play Drum Hit
  const handlePlayDrum = useCallback(
    (drumType: DawDrumType, velocity = 0.9) => {
      const ctx = getAudioContext();
      playDawDrumSound(ctx, drumType, ctx.currentTime, velocity);
    },
    [getAudioContext]
  );

  // Computer Keyboard Listeners
  useEffect(() => {
    const KEY_NOTE_MAP: Record<string, string> = {
      a: "C",
      w: "C#",
      s: "D",
      e: "D#",
      d: "E",
      f: "F",
      t: "F#",
      g: "G",
      y: "G#",
      h: "A",
      u: "A#",
      j: "B",
      k: "C",
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.repeat) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
        return;
      }

      const key = e.key.toLowerCase();
      const noteBase = KEY_NOTE_MAP[key];
      if (noteBase) {
        const octave = key === "k" ? currentOctave + 1 : currentOctave;
        handlePlayNote(`${noteBase}${octave}`);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentOctave, handlePlayNote]);

  // Master Play / Pause Toggle
  const togglePlayPause = useCallback(() => {
    const ctx = getAudioContext();
    if (isPlaying) {
      // STOP PLAYBACK
      setIsPlaying(false);
      setIsRecording(false);
      activeSourcesRef.current.forEach((src) => {
        try {
          src.stop();
        } catch (_) {}
      });
      activeSourcesRef.current = [];
      if (playheadAnimRef.current) cancelAnimationFrame(playheadAnimRef.current);
    } else {
      // START PLAYBACK
      setIsPlaying(true);
      const secondsPerBeat = 60 / bpm;
      const startSec = ctx.currentTime;
      playbackStartTimeRef.current = startSec - currentBeat * secondsPerBeat;

      // Animate Playhead
      const updatePlayhead = () => {
        const now = ctx.currentTime;
        const elapsedSec = now - playbackStartTimeRef.current;
        let newBeat = elapsedSec / secondsPerBeat;

        // Loop handling
        if (isCycleActive) {
          const loopStartBeat = (cycleStartBar - 1) * 4;
          const loopEndBeat = (cycleEndBar - 1) * 4;
          const loopLength = loopEndBeat - loopStartBeat;
          if (newBeat >= loopEndBeat) {
            newBeat = loopStartBeat + ((newBeat - loopStartBeat) % loopLength);
            playbackStartTimeRef.current = now - newBeat * secondsPerBeat;
          }
        }

        setCurrentBeat(newBeat);
        playheadAnimRef.current = requestAnimationFrame(updatePlayhead);
      };
      playheadAnimRef.current = requestAnimationFrame(updatePlayhead);

      // Schedule Audio & MIDI notes for all tracks
      const anySolo = tracks.some((t) => t.isSolo);
      tracks.forEach((track) => {
        if (track.isMuted) return;
        if (anySolo && !track.isSolo) return;

        const trackGain = (track.volume / 100) * masterVolume;

        track.clips.forEach((clip) => {
          // Play Synthesized Notes
          if (clip.notes && clip.notes.length > 0) {
            clip.notes.forEach((noteEv) => {
              const noteStartSec = startSec + (noteEv.beat - currentBeat) * secondsPerBeat;
              if (noteStartSec >= startSec) {
                playDawInstrumentSound(
                  ctx,
                  track.instrument,
                  noteEv.note,
                  noteStartSec,
                  noteEv.duration * secondsPerBeat,
                  noteEv.velocity * trackGain
                );
              }
            });
          }

          // Play Drums Sequencer Pattern
          if (clip.drumPattern) {
            const pattern = clip.drumPattern;
            for (let step = 0; step < 16; step++) {
              const stepBeat = clip.startBeat + step * 0.25;
              const stepTime = startSec + (stepBeat - currentBeat) * secondsPerBeat;
              if (stepTime >= startSec) {
                DRUM_TYPES.forEach((drumType, rowIdx) => {
                  if (pattern[rowIdx]?.[step]) {
                    playDawDrumSound(ctx, drumType, stepTime, 0.9 * trackGain);
                  }
                });
              }
            }
          }

          // Play Recorded / Uploaded Audio Buffer
          if (clip.audioBuffer) {
            const clipStartSec = startSec + (clip.startBeat - currentBeat) * secondsPerBeat;
            const src = ctx.createBufferSource();
            src.buffer = clip.audioBuffer;
            const g = ctx.createGain();
            g.gain.setValueAtTime(trackGain, ctx.currentTime);
            src.connect(g);
            g.connect(ctx.destination);

            if (clipStartSec >= startSec) {
              src.start(clipStartSec);
            } else {
              const offset = (startSec - clipStartSec);
              if (offset < clip.audioBuffer.duration) {
                src.start(startSec, offset);
              }
            }
            activeSourcesRef.current.push(src);
          }
        });
      });
    }
  }, [isPlaying, getAudioContext, bpm, currentBeat, isCycleActive, cycleStartBar, cycleEndBar, tracks, masterVolume]);

  // Master Record Toggle (Line-In / Mic Record Take)
  const toggleRecord = useCallback(async () => {
    const ctx = getAudioContext();

    if (isRecording) {
      // STOP RECORDING
      setIsRecording(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      togglePlayPause();
      toast.success("Recording take saved to track!");
    } else {
      // START RECORDING
      try {
        const stream = await getMicrophoneStream();
        recordingStreamRef.current = stream;

        // Setup real-time VU meter analyzer
        const source = ctx.createMediaStreamSource(stream);
        micSourceNodeRef.current = source;
        const analyzer = ctx.createAnalyser();
        analyzer.fftSize = 256;
        source.connect(analyzer);

        // Setup direct monitoring if enabled
        const monitorGain = ctx.createGain();
        monitorGain.gain.setValueAtTime(isMonitoring ? inputGain : 0, ctx.currentTime);
        source.connect(monitorGain);
        monitorGain.connect(ctx.destination);
        monitorNodeRef.current = monitorGain;

        // Monitor volume level loop
        const dataArr = new Uint8Array(analyzer.frequencyBinCount);
        const updateVu = () => {
          if (!recordingStreamRef.current) return;
          analyzer.getByteFrequencyData(dataArr);
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i] ?? 0;
          const avg = sum / dataArr.length / 255;
          setVuLevel(avg);
          setIsInputClipping(avg > 0.92);
          if (isRecording) requestAnimationFrame(updateVu);
        };
        requestAnimationFrame(updateVu);

        // Setup MediaRecorder
        recordedChunksRef.current = [];
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recordStartBeatRef.current = currentBeat;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          const peaks = extractWaveformPeaks(decoded, 100);
          const durationBeats = (decoded.duration / (60 / bpm));

          const newAudioClip: AudioClip = {
            id: `clip-audio-${Date.now()}`,
            name: `${selectedTrack.name} Take`,
            startBeat: recordStartBeatRef.current,
            durationBeats: Math.max(1, Math.round(durationBeats)),
            type: "audio",
            audioBuffer: decoded,
            waveformPeaks: peaks,
          };

          setTracks((prev) =>
            prev.map((t) => {
              if (t.id !== selectedTrack.id) return t;
              return {
                ...t,
                clips: [...t.clips, newAudioClip],
              };
            })
          );
        };

        recorder.start();
        setIsRecording(true);
        if (!isPlaying) togglePlayPause();
      } catch (err) {
        console.error(err);
        toast.error("Microphone or line-in input access denied.");
      }
    }
  }, [isRecording, getAudioContext, isMonitoring, inputGain, currentBeat, selectedTrack, isPlaying, togglePlayPause, bpm]);

  // Handle Direct Audio File Upload onto a Specific Track
  const handleUploadAudioFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const toastId = toast.loading(`Importing ${file.name} into ${selectedTrack.name}...`);
      try {
        const ctx = getAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        const peaks = extractWaveformPeaks(decoded, 120);
        const secondsPerBeat = 60 / bpm;
        const durationBeats = Math.max(1, Math.round(decoded.duration / secondsPerBeat));

        const uploadedClip: AudioClip = {
          id: `clip-file-${Date.now()}`,
          name: file.name.replace(/\.[^/.]+$/, ""),
          startBeat: currentBeat,
          durationBeats,
          type: "audio",
          audioBuffer: decoded,
          waveformPeaks: peaks,
        };

        setTracks((prev) =>
          prev.map((t) => {
            if (t.id !== selectedTrack.id) return t;
            return {
              ...t,
              clips: [...t.clips, uploadedClip],
            };
          })
        );

        toast.success(`Loaded ${file.name} (${durationBeats} beats) onto ${selectedTrack.name}!`, { id: toastId });
      } catch (err) {
        console.error(err);
        toast.error("Failed to decode audio file.", { id: toastId });
      }
    },
    [getAudioContext, selectedTrack, bpm, currentBeat]
  );

  // Rewind to beginning
  const handleRewind = () => {
    setCurrentBeat(0);
    if (isPlaying) {
      togglePlayPause();
      setTimeout(togglePlayPause, 50);
    }
  };

  // Add a new track
  const handleAddTrack = (instrumentType: DawInstrumentType) => {
    const inst = DAW_INSTRUMENTS.find((i) => i.id === instrumentType);
    if (!inst) return;

    const newTrack: DawTrack = {
      id: `track-${Date.now()}`,
      name: inst.name,
      instrument: inst.id,
      color: inst.color,
      volume: 80,
      pan: 0,
      isMuted: false,
      isSolo: false,
      isArmed: false,
      eqBass: 0,
      eqTreble: 0,
      reverb: 20,
      clips: inst.category === "drums" ? [
        {
          id: `clip-drum-${Date.now()}`,
          name: "Drum Loop",
          startBeat: 0,
          durationBeats: 16,
          type: "drums",
          drumPattern: DRUM_PRESETS.Pop,
        }
      ] : [],
    };

    setTracks((prev) => [...prev, newTrack]);
    setSelectedTrackId(newTrack.id);
    setIsAddTrackOpen(false);
    toast.success(`Added new ${inst.name} track!`);
  };

  // Delete Track
  const handleDeleteTrack = (trackId: string) => {
    if (tracks.length <= 1) {
      toast.error("You must have at least one track in the studio.");
      return;
    }
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    toast.info("Track deleted.");
  };

  // Toggle Track Drum Step
  const handleToggleDrumStep = (rowIdx: number, stepIdx: number) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== selectedTrack.id) return t;
        const clip = t.clips[0];
        if (!clip) return t;
        const currentPattern = clip.drumPattern ? clip.drumPattern.map((r) => [...r]) : DRUM_PRESETS.Rock.map((r) => [...r]);
        if (!currentPattern[rowIdx]) currentPattern[rowIdx] = new Array(16).fill(false);
        currentPattern[rowIdx][stepIdx] = !currentPattern[rowIdx][stepIdx];

        // Preview sound on step toggle
        if (currentPattern[rowIdx][stepIdx]) {
          const drumType = DRUM_TYPES[rowIdx];
          if (drumType) handlePlayDrum(drumType);
        }

        return {
          ...t,
          clips: [{ ...clip, drumPattern: currentPattern }],
        };
      })
    );
  };

  // Set Preset Drum Pattern
  const handleApplyDrumPreset = (presetName: string) => {
    const preset = DRUM_PRESETS[presetName];
    if (!preset) return;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== selectedTrack.id) return t;
        const clip = t.clips[0];
        if (!clip) return t;
        return {
          ...t,
          clips: [{ ...clip, drumPattern: preset }],
        };
      })
    );
    toast.success(`Applied ${presetName} drum pattern!`);
  };

  // Export Master Stereo 16-Bit WAV
  const handleExportWav = async (andSaveToChordLab = false) => {
    const toastId = toast.loading(andSaveToChordLab ? "Rendering & saving song to ChordLab..." : "Bouncing master stereo WAV...");
    try {
      const maxBeats = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.startBeat + c.durationBeats)));
      const durationSeconds = (maxBeats * 60) / bpm;
      const sampleRate = 44100;
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * durationSeconds), sampleRate);

      const anySolo = tracks.some((t) => t.isSolo);
      tracks.forEach((track) => {
        if (track.isMuted) return;
        if (anySolo && !track.isSolo) return;

        const gainNode = offlineCtx.createGain();
        gainNode.gain.setValueAtTime((track.volume / 100) * masterVolume, 0);

        // Pan
        const panner = offlineCtx.createStereoPanner ? offlineCtx.createStereoPanner() : null;
        if (panner) {
          panner.pan.setValueAtTime(track.pan / 50, 0);
          gainNode.connect(panner);
          panner.connect(offlineCtx.destination);
        } else {
          gainNode.connect(offlineCtx.destination);
        }

        track.clips.forEach((clip) => {
          // Render Audio Clips
          if (clip.audioBuffer) {
            const src = offlineCtx.createBufferSource();
            src.buffer = clip.audioBuffer;
            src.connect(gainNode);
            const startSec = (clip.startBeat * 60) / bpm;
            src.start(startSec);
          }
          // Render MIDI Notes
          if (clip.notes) {
            clip.notes.forEach((n) => {
              const noteSec = (n.beat * 60) / bpm;
              const durSec = (n.duration * 60) / bpm;
              playDawInstrumentSound(offlineCtx as unknown as AudioContext, track.instrument, n.note, noteSec, durSec, n.velocity, gainNode);
            });
          }
          // Render Drums
          if (clip.drumPattern) {
            for (let step = 0; step < 16; step++) {
              const stepTime = ((clip.startBeat + step * 0.25) * 60) / bpm;
              DRUM_TYPES.forEach((drumType, rIdx) => {
                if (clip.drumPattern?.[rIdx]?.[step]) {
                  playDawDrumSound(offlineCtx as unknown as AudioContext, drumType, stepTime, 0.9, gainNode);
                }
              });
            }
          }
        });
      });

      const renderedBuffer = await offlineCtx.startRendering();

      // Encode to 16-bit PCM WAV
      const numOfChan = renderedBuffer.numberOfChannels;
      const length = renderedBuffer.length * numOfChan * 2 + 44;
      const out = new DataView(new ArrayBuffer(length));
      const channels: Float32Array[] = [];
      let offset = 0;
      let pos = 0;

      function setUint16(data: number) {
        out.setUint16(pos, data, true);
        pos += 2;
      }
      function setUint32(data: number) {
        out.setUint32(pos, data, true);
        pos += 4;
      }

      // WAV Header
      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8);
      setUint32(0x45564157); // "WAVE"
      setUint32(0x20746d66); // "fmt "
      setUint32(16); // 16 for PCM
      setUint16(1); // PCM type
      setUint16(numOfChan);
      setUint32(renderedBuffer.sampleRate);
      setUint32(renderedBuffer.sampleRate * 2 * numOfChan); // byte rate
      setUint16(numOfChan * 2); // block align
      setUint16(16); // bits per sample
      setUint32(0x61746164); // "data"
      setUint32(length - pos - 4);

      for (let i = 0; i < renderedBuffer.numberOfChannels; i++) {
        channels.push(renderedBuffer.getChannelData(i));
      }

      while (offset < renderedBuffer.length) {
        for (let i = 0; i < numOfChan; i++) {
          const sample = Math.max(-1, Math.min(1, channels[i]?.[offset] ?? 0));
          out.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          pos += 2;
        }
        offset++;
      }

      const wavBlob = new Blob([out.buffer], { type: "audio/wav" });

      if (andSaveToChordLab) {
        const id = newId();
        await putAudio(id, wavBlob);
        const newSong: Song = {
          id,
          title: songTitle || "My GarageBand Creation",
          artist: "ChordLab Studio DAW",
          detectedKey: keySignature,
          detectedTempo: bpm,
          hasAudio: true,
          chords: [
            { chord: "C", beat: 1, time: 0 },
            { chord: "G", beat: 5, time: 2.0 },
            { chord: "Am", beat: 9, time: 4.0 },
            { chord: "F", beat: 13, time: 6.0 },
          ],
          source: "mic",
          createdAt: Date.now(),
        };
        saveSong(newSong);
        toast.success("Saved to ChordLab library!", { id: toastId });
        navigate({ to: "/song/$id", params: { id } });
      } else {
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${songTitle.replace(/\s+/g, "_")}.wav`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Master WAV downloaded!", { id: toastId });
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to render master audio.", { id: toastId });
    }
  };

  // Convert currentBeat into Bar.Beat.Tick string for LCD
  const lcdBar = Math.floor(currentBeat / 4) + 1;
  const lcdBeat = Math.floor(currentBeat % 4) + 1;
  const lcdTick = Math.floor((currentBeat % 1) * 100);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#1c1d22] text-zinc-100 font-sans select-none overflow-hidden">
      {/* ======================================================== */}
      {/* 1. TOP TRANSPORT HEADER (GARAGEBAND TITANIUM BAR)         */}
      {/* ======================================================== */}
      <header className="flex items-center justify-between px-3 py-2 bg-gradient-to-b from-[#2a2c35] to-[#20222a] border-b border-[#363844] shadow-md z-30">
        {/* Left: Song Info & Rewind/Play/Record */}
        <div className="flex items-center gap-2">
          {/* Rewind */}
          <button
            onClick={handleRewind}
            className="p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 active:scale-95 text-zinc-200 transition-all border border-zinc-700/60 shadow-sm"
            title="Rewind to Beginning (Bar 1)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlayPause}
            className={`p-2.5 rounded-full transition-all active:scale-95 shadow-md flex items-center justify-center ${
              isPlaying
                ? "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/30"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30"
            }`}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          {/* Record */}
          <button
            onClick={toggleRecord}
            className={`p-2.5 rounded-full transition-all active:scale-95 shadow-md flex items-center justify-center ${
              isRecording
                ? "bg-red-600 text-white animate-pulse shadow-red-600/50"
                : "bg-zinc-800 hover:bg-zinc-700 text-red-500 border border-zinc-700"
            }`}
            title="Record Take (Line-in / Mic)"
          >
            <Circle className={`w-4 h-4 ${isRecording ? "fill-current" : "fill-red-500"}`} />
          </button>

          {/* Loop / Cycle */}
          <button
            onClick={() => setIsCycleActive(!isCycleActive)}
            className={`p-2 rounded-full transition-all border ${
              isCycleActive
                ? "bg-amber-500/20 border-amber-500/60 text-amber-400 shadow-sm"
                : "bg-zinc-800/80 border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Toggle Cycle / Loop"
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Center: GARAGEBAND SIGNATURE LCD DISPLAY */}
        <div className="flex items-center gap-3">
          <div className="bg-[#121317] px-4 py-1.5 rounded-md border border-zinc-700/80 shadow-inner flex items-center gap-4">
            {/* Position Readout (Bar.Beat.Tick) */}
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-mono">Position</span>
              <span className="text-base font-bold font-mono text-cyan-400 tracking-wider">
                {lcdBar} . {lcdBeat} . {String(lcdTick).padStart(2, "0")}
              </span>
            </div>

            <div className="h-6 w-px bg-zinc-800" />

            {/* Tempo BPM */}
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-mono">Tempo</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="40"
                  max="240"
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  className="w-10 bg-transparent text-center font-bold font-mono text-amber-400 text-base focus:outline-none"
                />
                <span className="text-[10px] text-zinc-400">BPM</span>
              </div>
            </div>

            <div className="h-6 w-px bg-zinc-800" />

            {/* Key & Time Signature */}
            <div className="hidden sm:flex flex-col items-center">
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-mono">Signature</span>
              <span className="text-sm font-semibold font-mono text-zinc-300">
                {timeSignature} / {keySignature}
              </span>
            </div>
          </div>

          {/* Metronome & Count-In */}
          <div className="hidden md:flex items-center gap-1 bg-[#15161b] p-1 rounded-md border border-zinc-800">
            <button
              onClick={() => setIsMetronomeActive(!isMetronomeActive)}
              className={`px-2 py-1 text-xs rounded font-medium flex items-center gap-1 transition-all ${
                isMetronomeActive ? "bg-purple-600/30 text-purple-300 border border-purple-500/40" : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Metronome Click"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Click</span>
            </button>
            <button
              onClick={() => setIsCountInActive(!isCountInActive)}
              className={`px-2 py-1 text-xs rounded font-medium transition-all ${
                isCountInActive ? "bg-purple-600/30 text-purple-300 border border-purple-500/40" : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="1-Bar Count-In"
            >
              1 2 3 4
            </button>
          </div>
        </div>

        {/* Right: Master Volume & Export */}
        <div className="flex items-center gap-3">
          {/* Master Volume Slider */}
          <div className="hidden lg:flex items-center gap-2 bg-[#15161b] px-3 py-1.5 rounded-md border border-zinc-800">
            <Volume2 className="w-4 h-4 text-zinc-400" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              className="w-20 accent-emerald-500 cursor-pointer"
              title={`Master Volume: ${Math.round(masterVolume * 100)}%`}
            />
          </div>

          {/* Add Track */}
          <Button
            size="sm"
            onClick={() => setIsAddTrackOpen(true)}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 gap-1.5 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Track</span>
          </Button>

          {/* Export WAV */}
          <Button
            size="sm"
            onClick={() => handleExportWav(false)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-xs font-semibold shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export WAV</span>
          </Button>

          {/* Save to ChordLab */}
          <Button
            size="sm"
            onClick={() => handleExportWav(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white gap-1.5 text-xs font-semibold shadow-sm"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save Song</span>
          </Button>
        </div>
      </header>

      {/* ======================================================== */}
      {/* 2. MULTI-TRACK TIMELINE ARRANGER (GARAGEBAND WORKSPACE)    */}
      {/* ======================================================== */}
      <div className="flex-1 flex overflow-hidden bg-[#24252b]">
        {/* LEFT COLUMN: TRACK HEADERS LIST (WIDTH: 270px) */}
        <div className="w-64 sm:w-72 flex-shrink-0 bg-[#1c1d22] border-r border-[#2d2e36] flex flex-col z-20">
          {/* Arranger Track Header Title */}
          <div className="h-9 px-3 flex items-center justify-between bg-[#191a1f] border-b border-[#2d2e36] text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
            <span>Tracks ({tracks.length})</span>
            <span className="text-zinc-500 text-[10px]">Mute / Solo / Pan</span>
          </div>

          {/* Track Headers Stack */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#282932]">
            {tracks.map((track) => {
              const isSelected = track.id === selectedTrackId;
              return (
                <div
                  key={track.id}
                  onClick={() => setSelectedTrackId(track.id)}
                  style={{ borderLeftColor: track.color }}
                  className={`h-24 px-3 py-2 flex flex-col justify-between cursor-pointer border-l-4 transition-all ${
                    isSelected ? "bg-[#282a33]" : "bg-[#1c1d22] hover:bg-[#222329]"
                  }`}
                >
                  {/* Track Name & Instrument Badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold shadow-sm"
                        style={{ backgroundColor: track.color }}
                      >
                        {track.name.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-zinc-100 truncate">{track.name}</span>
                    </div>

                    {/* Delete Track */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTrack(track.id);
                      }}
                      className="text-zinc-500 hover:text-red-400 p-1 rounded"
                      title="Delete Track"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Volume Slider & Pan */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 font-mono w-5">Vol</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={track.volume}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, volume: val } : t)));
                      }}
                      className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-200"
                    />
                    <span className="text-[10px] text-zinc-400 font-mono w-7 text-right">{track.volume}%</span>
                  </div>

                  {/* Track Controls & The 3 Action Buttons */}
                  <div className="flex items-center justify-between pt-1">
                    {/* Mute & Solo */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTracks((prev) =>
                            prev.map((t) => (t.id === track.id ? { ...t, isMuted: !t.isMuted } : t))
                          );
                        }}
                        className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-all ${
                          track.isMuted ? "bg-amber-600 text-white font-extrabold" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="Mute"
                      >
                        M
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTracks((prev) =>
                            prev.map((t) => (t.id === track.id ? { ...t, isSolo: !t.isSolo } : t))
                          );
                        }}
                        className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-all ${
                          track.isSolo ? "bg-yellow-400 text-black font-extrabold" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="Solo"
                      >
                        S
                      </button>
                    </div>

                    {/* The 3 Quick Options Badges */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrackId(track.id);
                          setActiveDrawerTab("instrument");
                          setIsDrawerCollapsed(false);
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-0.5 ${
                          isSelected && activeDrawerTab === "instrument"
                            ? "bg-zinc-700 text-white"
                            : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="Create using instrument"
                      >
                        <Piano className="w-2.5 h-2.5" />
                        <span>Play</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrackId(track.id);
                          setActiveDrawerTab("linein");
                          setIsDrawerCollapsed(false);
                        }}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-0.5 ${
                          isSelected && activeDrawerTab === "linein"
                            ? "bg-zinc-700 text-white"
                            : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="Record via line-in or device microphone"
                      >
                        <Mic className="w-2.5 h-2.5" />
                        <span>Rec</span>
                      </button>

                      <label
                        className="px-1.5 py-0.5 rounded text-[9px] font-medium flex items-center gap-0.5 bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        title="Upload audio file directly into this track"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Upload className="w-2.5 h-2.5" />
                        <span>Upload</span>
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={handleUploadAudioFile}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: TIMELINE RULER & TRACK LANES */}
        <div className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden relative bg-[#24252b]">
          {/* Top Measure Ruler */}
          <div
            className="h-9 flex-shrink-0 bg-[#1e2026] border-b border-[#2d2e36] flex items-center relative cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const beatWidth = 32; // 32px per beat
              const clickedBeat = Math.max(0, clickX / beatWidth);
              setCurrentBeat(clickedBeat);
            }}
          >
            {/* Cycle / Loop Highlight Bar */}
            {isCycleActive && (
              <div
                style={{
                  left: `${(cycleStartBar - 1) * 4 * 32}px`,
                  width: `${(cycleEndBar - cycleStartBar) * 4 * 32}px`,
                }}
                className="absolute top-0 bottom-0 bg-amber-500/25 border-t-2 border-b-2 border-amber-400 z-10 pointer-events-none"
              >
                <span className="text-[10px] font-bold text-amber-300 font-mono px-1">CYCLE LOOP</span>
              </div>
            )}

            {/* Bars & Ticks */}
            {Array.from({ length: totalBars }).map((_, barIdx) => {
              const barNum = barIdx + 1;
              return (
                <div key={barIdx} className="w-[128px] h-full flex flex-col justify-between border-r border-zinc-700/50 flex-shrink-0">
                  <span className="text-[10px] font-bold text-zinc-400 font-mono px-1 pt-0.5">{barNum}</span>
                  <div className="flex justify-between px-2 pb-1">
                    <span className="w-px h-2 bg-zinc-600/60" />
                    <span className="w-px h-1.5 bg-zinc-700/40" />
                    <span className="w-px h-2 bg-zinc-600/60" />
                    <span className="w-px h-1.5 bg-zinc-700/40" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Multi-Track Arrangement Lanes */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#2d2e36] relative">
            {/* Moving Playhead Needle */}
            <div
              style={{ left: `${currentBeat * 32}px` }}
              className="absolute top-0 bottom-0 w-px bg-cyan-400 shadow-md z-30 pointer-events-none transition-all duration-75"
            >
              <div className="w-3 h-3 bg-cyan-400 -ml-1.5 -top-1 rounded-sm rotate-45 shadow-cyan-400/50 shadow" />
            </div>

            {tracks.map((track) => {
              const isSelected = track.id === selectedTrackId;
              return (
                <div
                  key={track.id}
                  onClick={() => setSelectedTrackId(track.id)}
                  className={`h-24 relative flex items-center transition-colors ${
                    isSelected ? "bg-[#2c2d36]/50" : "bg-transparent hover:bg-zinc-800/30"
                  }`}
                  style={{ width: `${totalBars * 128}px` }}
                >
                  {/* Grid Lines for Beats */}
                  {Array.from({ length: totalBars * 4 }).map((_, bIdx) => (
                    <div
                      key={bIdx}
                      style={{ left: `${bIdx * 32}px` }}
                      className={`absolute top-0 bottom-0 pointer-events-none ${
                        bIdx % 4 === 0 ? "border-r border-zinc-700/40" : "border-r border-zinc-800/20"
                      }`}
                    />
                  ))}

                  {/* Render Track Clips (Colored GarageBand Blocks) */}
                  {track.clips.map((clip) => {
                    const leftPx = clip.startBeat * 32;
                    const widthPx = Math.max(48, clip.durationBeats * 32);

                    return (
                      <div
                        key={clip.id}
                        style={{
                          left: `${leftPx}px`,
                          width: `${widthPx}px`,
                          backgroundColor: `${track.color}35`,
                          borderColor: track.color,
                        }}
                        className="absolute h-18 rounded-md border-2 overflow-hidden flex flex-col justify-between p-1.5 shadow-md cursor-pointer hover:brightness-110"
                      >
                        {/* Clip Label */}
                        <div className="flex items-center justify-between text-[11px] font-bold text-white drop-shadow truncate">
                          <span>{clip.name}</span>
                          <span className="text-[9px] font-mono opacity-80">{clip.durationBeats}b</span>
                        </div>

                        {/* Real Waveform Display for Audio Tracks */}
                        {clip.waveformPeaks && clip.waveformPeaks.length > 0 && (
                          <div className="flex items-center gap-0.5 h-10 w-full overflow-hidden">
                            {clip.waveformPeaks.map((peak, pIdx) => (
                              <div
                                key={pIdx}
                                style={{
                                  height: `${Math.max(12, peak * 100)}%`,
                                  backgroundColor: track.color,
                                }}
                                className="flex-1 rounded-sm opacity-90 shadow-sm"
                              />
                            ))}
                          </div>
                        )}

                        {/* Emerald Piano Roll Note Dashes for Synthesizer / Instrument Tracks */}
                        {clip.notes && clip.notes.length > 0 && (
                          <div className="relative h-10 w-full bg-black/20 rounded overflow-hidden">
                            {clip.notes.map((n, nIdx) => {
                              const noteLeft = (n.beat / clip.durationBeats) * 100;
                              const noteWidth = Math.max(4, (n.duration / clip.durationBeats) * 100);
                              return (
                                <div
                                  key={nIdx}
                                  style={{
                                    left: `${noteLeft}%`,
                                    width: `${noteWidth}%`,
                                    top: `${(nIdx % 4) * 8}px`,
                                    backgroundColor: track.color,
                                  }}
                                  className="absolute h-1.5 rounded-full shadow"
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Drum Sequencer Blocks */}
                        {clip.drumPattern && (
                          <div className="grid grid-cols-16 gap-0.5 h-9 w-full bg-black/30 p-0.5 rounded">
                            {clip.drumPattern[0]?.map((active, stepIdx) => (
                              <div
                                key={stepIdx}
                                className={`rounded-sm ${
                                  active ? "bg-amber-400" : stepIdx % 4 === 0 ? "bg-zinc-700/50" : "bg-zinc-800/30"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. INTERACTIVE BOTTOM WORKSTATION DRAWER (THE 3 OPTIONS)  */}
      {/* ======================================================== */}
      <div
        className={`bg-[#1c1d22] border-t border-[#31333d] transition-all flex flex-col shadow-2xl z-20 ${
          isDrawerCollapsed ? "h-10" : "h-72 sm:h-80"
        }`}
      >
        {/* Drawer Tabs Navigation */}
        <div className="h-10 px-3 bg-[#191a1f] border-b border-[#2d2e36] flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 mr-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedTrack.color }} />
              <span>{selectedTrack.name}</span>
            </span>

            {/* Option 1: Create using Instrument */}
            <button
              onClick={() => {
                setActiveDrawerTab("instrument");
                setIsDrawerCollapsed(false);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-t-md transition-all flex items-center gap-1.5 ${
                activeDrawerTab === "instrument" && !isDrawerCollapsed
                  ? "bg-[#1c1d22] text-emerald-400 border-t-2 border-emerald-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Piano className="w-3.5 h-3.5" />
              <span>1. Create Instrument</span>
            </button>

            {/* Option 2: Record via Line-In / Mic */}
            <button
              onClick={() => {
                setActiveDrawerTab("linein");
                setIsDrawerCollapsed(false);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-t-md transition-all flex items-center gap-1.5 ${
                activeDrawerTab === "linein" && !isDrawerCollapsed
                  ? "bg-[#1c1d22] text-purple-400 border-t-2 border-purple-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>2. Record Line-in / Mic</span>
            </button>

            {/* Option 3: Upload Audio File */}
            <button
              onClick={() => {
                setActiveDrawerTab("upload");
                setIsDrawerCollapsed(false);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-t-md transition-all flex items-center gap-1.5 ${
                activeDrawerTab === "upload" && !isDrawerCollapsed
                  ? "bg-[#1c1d22] text-blue-400 border-t-2 border-blue-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>3. Upload Audio File</span>
            </button>

            {/* Option 4: FX & Mixer */}
            <button
              onClick={() => {
                setActiveDrawerTab("mixer");
                setIsDrawerCollapsed(false);
              }}
              className={`hidden sm:flex px-3 py-1 text-xs font-semibold rounded-t-md transition-all items-center gap-1.5 ${
                activeDrawerTab === "mixer" && !isDrawerCollapsed
                  ? "bg-[#1c1d22] text-amber-400 border-t-2 border-amber-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>FX & EQ</span>
            </button>
          </div>

          {/* Drawer Collapse Button */}
          <button
            onClick={() => setIsDrawerCollapsed(!isDrawerCollapsed)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            title={isDrawerCollapsed ? "Expand Drawer" : "Collapse Drawer"}
          >
            {isDrawerCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Drawer Content */}
        {!isDrawerCollapsed && (
          <div className="flex-1 overflow-y-auto p-3">
            {/* ======================================================== */}
            {/* OPTION 1 CONTENT: PLAY / CREATE USING INSTRUMENT          */}
            {/* ======================================================== */}
            {activeDrawerTab === "instrument" && (
              <div className="h-full flex flex-col justify-between">
                {/* Drum Machine Sequencer (for Drum Kit) */}
                {selectedTrack.instrument === "drum_kit" || selectedTrack.instrument === "percussion" ? (
                  <div className="flex flex-col gap-2">
                    {/* Presets & Controls */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-300">16-Step Drum Sequencer</span>
                        <div className="flex items-center gap-1">
                          {["Rock", "HipHop", "Pop", "Dance"].map((preset) => (
                            <button
                              key={preset}
                              onClick={() => handleApplyDrumPreset(preset)}
                              className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>

                      <span className="text-[11px] text-zinc-400 font-mono">16 Beats / Bar (4x4)</span>
                    </div>

                    {/* 16-Step Sequencer Grid */}
                    <div className="overflow-x-auto pb-2">
                      <div className="min-w-[600px] flex flex-col gap-1">
                        {DRUM_NAMES.map((name, rowIdx) => {
                          const pattern = selectedTrack.clips[0]?.drumPattern ?? DRUM_PRESETS.Rock;
                          return (
                            <div key={name} className="flex items-center gap-1.5">
                              <span className="w-24 text-[11px] font-medium text-zinc-400 truncate">{name}</span>
                              <div className="flex-1 grid grid-cols-16 gap-1">
                                {Array.from({ length: 16 }).map((_, stepIdx) => {
                                  const isActive = pattern[rowIdx]?.[stepIdx] ?? false;
                                  const isCurrentStep = Math.floor(currentBeat * 4) % 16 === stepIdx && isPlaying;
                                  const isBeatStart = stepIdx % 4 === 0;

                                  return (
                                    <button
                                      key={stepIdx}
                                      onClick={() => handleToggleDrumStep(rowIdx, stepIdx)}
                                      className={`h-7 rounded transition-all active:scale-95 border ${
                                        isActive
                                          ? "bg-amber-500 border-amber-400 shadow-sm"
                                          : isBeatStart
                                          ? "bg-zinc-800 border-zinc-700"
                                          : "bg-zinc-900 border-zinc-800"
                                      } ${isCurrentStep ? "ring-2 ring-cyan-400 brightness-125" : ""}`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Melodic Piano Keyboard & Chord Palette */
                  <div className="h-full flex flex-col justify-between">
                    {/* Keyboard Controls Bar */}
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                      <div className="flex items-center gap-2">
                        {/* Octave Shifter */}
                        <div className="flex items-center bg-[#15161b] px-2 py-1 rounded-md border border-zinc-800 gap-2">
                          <button
                            onClick={() => setCurrentOctave((o) => Math.max(1, o - 1))}
                            className="text-xs font-bold px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          >
                            Oct -
                          </button>
                          <span className="text-xs font-mono font-bold text-emerald-400">Octave {currentOctave}</span>
                          <button
                            onClick={() => setCurrentOctave((o) => Math.min(7, o + 1))}
                            className="text-xs font-bold px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          >
                            Oct +
                          </button>
                        </div>

                        {/* Labels toggle */}
                        <button
                          onClick={() => setShowNoteLabels(!showNoteLabels)}
                          className={`px-2 py-1 text-xs rounded border transition-all ${
                            showNoteLabels
                              ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300"
                              : "bg-zinc-800 border-zinc-700 text-zinc-400"
                          }`}
                        >
                          Labels
                        </button>
                      </div>

                      {/* Instant Chords Shortcuts */}
                      <div className="hidden sm:flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500 font-mono mr-1">CHORDS:</span>
                        {["C", "Dm", "Em", "F", "G", "Am"].map((ch) => (
                          <button
                            key={ch}
                            onClick={() => {
                              const notesMap: Record<string, string[]> = {
                                C: ["C4", "E4", "G4"],
                                Dm: ["D4", "F4", "A4"],
                                Em: ["E4", "G4", "B4"],
                                F: ["F4", "A4", "C5"],
                                G: ["G4", "B4", "D5"],
                                Am: ["A4", "C5", "E5"],
                              };
                              const notes = notesMap[ch] ?? [];
                              notes.forEach((n) => handlePlayNote(n));
                            }}
                            className="px-2 py-0.5 text-xs font-bold rounded bg-zinc-800 hover:bg-emerald-600/30 hover:text-emerald-300 text-zinc-300 border border-zinc-700"
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Interactive Real Piano Keyboard */}
                    <div className="flex-1 flex justify-center items-end py-1 select-none overflow-x-auto">
                      <div className="relative flex h-36 sm:h-44 bg-[#141519] p-1.5 rounded-lg border border-zinc-800 shadow-inner">
                        {/* 2 Full Octaves White Keys */}
                        {[
                          "C", "D", "E", "F", "G", "A", "B",
                          "C", "D", "E", "F", "G", "A", "B"
                        ].map((noteName, idx) => {
                          const oct = idx < 7 ? currentOctave : currentOctave + 1;
                          const fullNote = `${noteName}${oct}`;
                          const isPressed = activeNotes.has(fullNote);

                          return (
                            <button
                              key={idx}
                              onMouseDown={() => handlePlayNote(fullNote)}
                              onTouchStart={(e) => {
                                e.preventDefault();
                                handlePlayNote(fullNote);
                              }}
                              className={`w-10 sm:w-12 h-full rounded-b-md flex flex-col justify-end items-center pb-2 transition-all border border-zinc-300/40 relative shadow-md ${
                                isPressed
                                  ? "bg-emerald-300 translate-y-1 shadow-inner"
                                  : "bg-gradient-to-b from-zinc-100 to-zinc-200 hover:from-white hover:to-zinc-100 text-zinc-800"
                              }`}
                            >
                              {showNoteLabels && (
                                <span className="text-[10px] font-bold text-zinc-700 pointer-events-none">
                                  {fullNote}
                                </span>
                              )}
                            </button>
                          );
                        })}

                        {/* Black Keys Positioned Above */}
                        {[
                          { note: "C#", left: 28, oct: currentOctave },
                          { note: "D#", left: 68, oct: currentOctave },
                          { note: "F#", left: 148, oct: currentOctave },
                          { note: "G#", left: 188, oct: currentOctave },
                          { note: "A#", left: 228, oct: currentOctave },
                          { note: "C#", left: 308, oct: currentOctave + 1 },
                          { note: "D#", left: 348, oct: currentOctave + 1 },
                          { note: "F#", left: 428, oct: currentOctave + 1 },
                          { note: "G#", left: 468, oct: currentOctave + 1 },
                          { note: "A#", left: 508, oct: currentOctave + 1 },
                        ].map((bKey, bIdx) => {
                          const fullNote = `${bKey.note}${bKey.oct}`;
                          const isPressed = activeNotes.has(fullNote);

                          return (
                            <button
                              key={bIdx}
                              style={{ left: `${bKey.left}px` }}
                              onMouseDown={() => handlePlayNote(fullNote)}
                              onTouchStart={(e) => {
                                e.preventDefault();
                                handlePlayNote(fullNote);
                              }}
                              className={`absolute top-1.5 w-6 sm:w-7 h-20 sm:h-26 rounded-b-sm z-10 border border-zinc-950 transition-all shadow-lg flex items-end justify-center pb-1 ${
                                isPressed
                                  ? "bg-emerald-500 translate-y-1"
                                  : "bg-gradient-to-b from-[#222329] to-[#0f1013] hover:from-zinc-800 hover:to-zinc-900"
                              }`}
                            >
                              {showNoteLabels && (
                                <span className="text-[8px] font-bold text-zinc-300 pointer-events-none">
                                  {bKey.note}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ======================================================== */}
            {/* OPTION 2 CONTENT: RECORD VIA CONNECT INSTRUMENT LINE / MIC*/}
            {/* ======================================================== */}
            {activeDrawerTab === "linein" && (
              <div className="h-full flex flex-col justify-between max-w-2xl mx-auto py-2">
                <div className="bg-[#15161b] p-4 rounded-xl border border-zinc-800 space-y-4 shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                        <Radio className="w-4 h-4 text-purple-400" />
                        <span>Direct Instrument Line-In / Microphone</span>
                      </h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Connect your electric guitar, bass, synthesizer, or studio microphone to your device audio input.
                      </p>
                    </div>

                    <Button
                      size="sm"
                      onClick={toggleRecord}
                      className={
                        isRecording
                          ? "bg-red-600 hover:bg-red-500 text-white animate-pulse"
                          : "bg-purple-600 hover:bg-purple-500 text-white"
                      }
                    >
                      {isRecording ? "Stop Recording Take" : "Record Take Directly"}
                    </Button>
                  </div>

                  {/* Real-time Peak Level VU Meter */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-300">Live Input Level</span>
                      <span className={`font-mono font-bold ${isInputClipping ? "text-red-400 animate-pulse" : "text-emerald-400"}`}>
                        {isInputClipping ? "CLIPPING PEAK!" : `${Math.round(vuLevel * 100)}%`}
                      </span>
                    </div>

                    <div className="h-3 w-full bg-zinc-900 rounded-full overflow-hidden p-0.5 border border-zinc-800 flex items-center">
                      <div
                        style={{ width: `${Math.min(100, vuLevel * 100)}%` }}
                        className={`h-full rounded-full transition-all duration-75 ${
                          isInputClipping
                            ? "bg-red-500 shadow-red-500/50 shadow"
                            : vuLevel > 0.7
                            ? "bg-amber-400"
                            : "bg-emerald-500"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Input Gain & Direct Monitoring Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800">
                    <div className="flex items-center justify-between bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                      <div>
                        <span className="text-xs font-semibold text-zinc-200">Headphone Direct Monitor</span>
                        <p className="text-[10px] text-zinc-400">Hear your instrument in headphones</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isMonitoring}
                        onChange={(e) => {
                          setIsMonitoring(e.target.checked);
                          if (monitorNodeRef.current && audioCtxRef.current) {
                            monitorNodeRef.current.gain.setValueAtTime(
                              e.target.checked ? inputGain : 0,
                              audioCtxRef.current.currentTime
                            );
                          }
                        }}
                        className="w-4 h-4 accent-purple-500 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                      <div>
                        <span className="text-xs font-semibold text-zinc-200">Pre-Amp Input Gain</span>
                        <p className="text-[10px] text-zinc-400">{Math.round(inputGain * 100)}% Boost</p>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.5"
                        step="0.05"
                        value={inputGain}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setInputGain(val);
                          if (monitorNodeRef.current && audioCtxRef.current && isMonitoring) {
                            monitorNodeRef.current.gain.setValueAtTime(val, audioCtxRef.current.currentTime);
                          }
                        }}
                        className="w-24 accent-purple-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* OPTION 3 CONTENT: UPLOAD AUDIO FILE DIRECTLY INTO TRACK   */}
            {/* ======================================================== */}
            {activeDrawerTab === "upload" && (
              <div className="h-full flex flex-col justify-center items-center max-w-xl mx-auto py-2">
                <label className="w-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-zinc-700 hover:border-blue-500 rounded-xl bg-[#15161b] hover:bg-[#1a1b22] cursor-pointer transition-all shadow-md group">
                  <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8" />
                  </div>
                  <span className="mt-3 text-sm font-bold text-zinc-200">
                    Upload Audio File onto {selectedTrack.name}
                  </span>
                  <span className="mt-1 text-xs text-zinc-400 text-center">
                    Select a WAV, MP3, M4A, FLAC, or OGG file from your phone or computer.
                  </span>
                  <span className="mt-3 px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-md shadow-sm">
                    Choose Audio File
                  </span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleUploadAudioFile}
                  />
                </label>
              </div>
            )}

            {/* ======================================================== */}
            {/* OPTION 4 CONTENT: FX & MIXER                              */}
            {/* ======================================================== */}
            {activeDrawerTab === "mixer" && (
              <div className="h-full flex flex-col justify-center max-w-xl mx-auto py-2">
                <div className="bg-[#15161b] p-4 rounded-xl border border-zinc-800 space-y-4">
                  <h3 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                    <span>Track Equalizer & Studio Space</span>
                  </h3>

                  <div className="grid grid-cols-3 gap-4">
                    {/* Bass */}
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">Bass (Low)</span>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        value={selectedTrack.eqBass}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, eqBass: val } : t))
                          );
                        }}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-400">{selectedTrack.eqBass > 0 ? `+${selectedTrack.eqBass}` : selectedTrack.eqBass} dB</span>
                    </div>

                    {/* Treble */}
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">Treble (High)</span>
                      <input
                        type="range"
                        min="-12"
                        max="12"
                        value={selectedTrack.eqTreble}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, eqTreble: val } : t))
                          );
                        }}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-400">{selectedTrack.eqTreble > 0 ? `+${selectedTrack.eqTreble}` : selectedTrack.eqTreble} dB</span>
                    </div>

                    {/* Studio Reverb */}
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-300">Reverb Send</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={selectedTrack.reverb}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setTracks((prev) =>
                            prev.map((t) => (t.id === selectedTrack.id ? { ...t, reverb: val } : t))
                          );
                        }}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-400">{selectedTrack.reverb}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* ADD TRACK MODAL (PRESET INSTRUMENTS SELECTOR)             */}
      {/* ======================================================== */}
      {isAddTrackOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#1f2026] border border-zinc-700 rounded-xl p-5 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div>
                <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-emerald-400" />
                  <span>Choose New Instrument Track</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Select an authentic instrument to add to your multi-track project.
                </p>
              </div>
              <button
                onClick={() => setIsAddTrackOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            {/* Instruments Grid */}
            <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2.5 py-4">
              {DAW_INSTRUMENTS.map((inst) => (
                <button
                  key={inst.id}
                  onClick={() => handleAddTrack(inst.id)}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[#18191f] hover:bg-[#252630] border border-zinc-800 hover:border-zinc-600 transition-all text-left group"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0"
                    style={{ backgroundColor: inst.color }}
                  >
                    {inst.name.charAt(0)}
                  </div>
                  <div className="flex-1 truncate">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors">
                        {inst.name}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {inst.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">
                      {inst.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
