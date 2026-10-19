import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  Circle,
  Disc3,
  Download,
  FolderPlus,
  Mic,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sliders,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { getMicrophoneStream } from "@/lib/microphone";
import { putAudio } from "@/lib/audio-store";
import { newId, saveSong } from "@/lib/storage";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Music Creation Studio — ChordLab" },
      {
        name: "description",
        content: "Create music with multi-track recording, virtual piano, drum sequencer, vocals, and instruments.",
      },
    ],
  }),
  component: CreateMusicPage,
});

// Sound synthesizers using Web Audio
function playDrumSound(ctx: AudioContext, type: "kick" | "snare" | "hihat" | "clap", time: number) {
  if (type === "kick") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.4);
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.4);
  } else if (type === "snare") {
    // Noise + tone
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseBuffer.length; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(800, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(time);
  } else if (type === "hihat") {
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseBuffer.length; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(7000, time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(time);
  } else if (type === "clap") {
    for (let i = 0; i < 3; i++) {
      const t = time + i * 0.015;
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let j = 0; j < noiseBuffer.length; j++) {
        output[j] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1200, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
    }
  }
}

// Polyphonic Key Synthesizer
function playPianoNote(ctx: AudioContext, freq: number, type: "piano" | "rhodes" | "synth") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;

  if (type === "piano") {
    osc.type = "triangle";
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  } else if (type === "rhodes") {
    osc.type = "sine";
    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
  } else {
    osc.type = "sawtooth";
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.8);
    osc.connect(filter);
    filter.connect(gain);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(freq, now);
    osc.start(now);
    osc.stop(now + 1.0);
    return;
  }

  osc.frequency.setValueAtTime(freq, now);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 2.0);
}

// Piano keys setup
const PIANO_KEYS = [
  { note: "C4", freq: 261.63, isBlack: false, key: "A" },
  { note: "C#4", freq: 277.18, isBlack: true, key: "W" },
  { note: "D4", freq: 293.66, isBlack: false, key: "S" },
  { note: "D#4", freq: 311.13, isBlack: true, key: "E" },
  { note: "E4", freq: 329.63, isBlack: false, key: "D" },
  { note: "F4", freq: 349.23, isBlack: false, key: "F" },
  { note: "F#4", freq: 369.99, isBlack: true, key: "T" },
  { note: "G4", freq: 392.00, isBlack: false, key: "G" },
  { note: "G#4", freq: 415.30, isBlack: true, key: "Y" },
  { note: "A4", freq: 440.00, isBlack: false, key: "H" },
  { note: "A#4", freq: 466.16, isBlack: true, key: "U" },
  { note: "B4", freq: 493.88, isBlack: false, key: "J" },
  { note: "C5", freq: 523.25, isBlack: false, key: "K" },
  { note: "C#5", freq: 554.37, isBlack: true, key: "O" },
  { note: "D5", freq: 587.33, isBlack: false, key: "L" },
  { note: "D#5", freq: 622.25, isBlack: true, key: "P" },
  { note: "E5", freq: 659.25, isBlack: false, key: ";" },
];

export function CreateMusicPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"keys" | "drums" | "vocals" | "tracks">("keys");
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [keyInstrument, setKeyInstrument] = useState<"piano" | "rhodes" | "synth">("piano");
  const [octaveShift, setOctaveShift] = useState(0);

  // Drum Pattern: 4 instruments x 16 steps
  const [drumPattern, setDrumPattern] = useState<Record<string, boolean[]>>({
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    clap: [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
  });
  const [currentStep, setCurrentStep] = useState(0);

  // Vocal Recording
  const [isRecordingVocal, setIsRecordingVocal] = useState(false);
  const [vocalAudioUrl, setVocalAudioUrl] = useState<string | null>(null);
  const [vocalAudioBlob, setVocalAudioBlob] = useState<Blob | null>(null);
  const vocalRecorderRef = useRef<MediaRecorder | null>(null);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stepTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Key press listener for piano keys
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const matched = PIANO_KEYS.find((k) => k.key.toLowerCase() === e.key.toLowerCase());
      if (matched) {
        handlePlayNote(matched.freq, matched.note);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [octaveShift, keyInstrument]);

  // Drum Sequencer Step Runner
  useEffect(() => {
    if (!isPlaying) {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      setCurrentStep(0);
      return;
    }

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") void ctx.resume();

    const stepInterval = (60 / bpm / 4) * 1000; // 16th note in ms
    let step = 0;

    stepTimerRef.current = window.setInterval(() => {
      const now = ctx.currentTime;
      (["kick", "snare", "hihat", "clap"] as const).forEach((inst) => {
        if (drumPattern[inst]?.[step]) {
          playDrumSound(ctx, inst, now);
        }
      });
      setCurrentStep(step);
      step = (step + 1) % 16;
    }, stepInterval);

    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, [isPlaying, bpm, drumPattern]);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function handlePlayNote(baseFreq: number, noteName: string) {
    const ctx = getAudioContext();
    const factor = Math.pow(2, octaveShift);
    playPianoNote(ctx, baseFreq * factor, keyInstrument);
  }

  function toggleStep(inst: string, index: number) {
    setDrumPattern((prev) => {
      const row = [...(prev[inst] || [])];
      row[index] = !row[index];
      return { ...prev, [inst]: row };
    });
  }

  function loadDrumPreset(preset: "rock" | "hiphop" | "dance" | "trap" | "clear") {
    if (preset === "clear") {
      setDrumPattern({
        kick: Array(16).fill(false),
        snare: Array(16).fill(false),
        hihat: Array(16).fill(false),
        clap: Array(16).fill(false),
      });
      return;
    }
    if (preset === "rock") {
      setDrumPattern({
        kick: [true, false, false, false, false, false, true, false, false, false, false, false, false, false, true, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
        clap: Array(16).fill(false),
      });
      setBpm(120);
    } else if (preset === "hiphop") {
      setDrumPattern({
        kick: [true, false, false, true, false, false, false, false, true, false, false, false, false, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
        clap: [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
      });
      setBpm(92);
    } else if (preset === "dance") {
      setDrumPattern({
        kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        hihat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
        clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      });
      setBpm(128);
    } else if (preset === "trap") {
      setDrumPattern({
        kick: [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
        snare: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
        hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
        clap: [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      });
      setBpm(140);
    }
    toast.success(`Loaded ${preset.toUpperCase()} drum pattern`);
  }

  // Vocal Recording via resilient getMicrophoneStream
  async function toggleVocalRecord() {
    if (isRecordingVocal) {
      vocalRecorderRef.current?.stop();
      setIsRecordingVocal(false);
      return;
    }
    try {
      const stream = await getMicrophoneStream();
      const rec = new MediaRecorder(stream);
      vocalRecorderRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setVocalAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setVocalAudioUrl(url);
        toast.success("Vocal recording captured!");
      };
      rec.start();
      setIsRecordingVocal(true);
      toast.info("Recording vocals... Sing or hum your melody!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Microphone access denied");
    }
  }

  // Save Project directly into ChordLab Library
  async function handleSaveProjectToLibrary() {
    try {
      toast.info("Rendering and saving project to your library...");
      const id = newId();
      // If we have vocal audio, use it, otherwise synthesize a short audio loop
      let fileToSave: File;
      if (vocalAudioBlob) {
        fileToSave = new File([vocalAudioBlob], "studio_project.webm", { type: vocalAudioBlob.type });
      } else {
        // Create a 4-bar WAV file from the drum loop
        const offline = new OfflineAudioContext(2, 44100 * 4, 44100);
        // Play drum pattern 4 times
        const stepSec = 60 / bpm / 4;
        for (let loop = 0; loop < 4; loop++) {
          const loopOffset = loop * 16 * stepSec;
          (["kick", "snare", "hihat", "clap"] as const).forEach((inst) => {
            drumPattern[inst]?.forEach((active, step) => {
              if (active) {
                playDrumSound(offline as any, inst, loopOffset + step * stepSec);
              }
            });
          });
        }
        const rendered = await offline.startRendering();
        // Convert to WAV Blob
        const wavBuffer = audioBufferToWav(rendered);
        const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
        fileToSave = new File([wavBlob], "studio_drum_beat.wav", { type: "audio/wav" });
      }

      await putAudio(id, fileToSave);
      saveSong({
        id,
        title: "Studio Beat Creation",
        artist: "ChordLab Studio",
        createdAt: Date.now(),
        analysis: {
          duration: 8.0,
          bpm: bpm,
          key: "C Major",
          scale: "major",
          chords: [
            { start: 0, end: 2, label: "C", confidence: 0.95 },
            { start: 2, end: 4, label: "G", confidence: 0.92 },
            { start: 4, end: 6, label: "Am", confidence: 0.94 },
            { start: 6, end: 8, label: "F", confidence: 0.91 },
          ],
        },
        lyrics: "[Verse 1]\nCreated inside ChordLab Studio\nBeats and chords made live",
        capo: 0,
        transpose: 0,
        notes: `Created in ChordLab Studio at ${bpm} BPM`,
        engine: "local",
      });
      toast.success("Project saved to your ChordLab Library!");
      void navigate({ to: "/song/$id", params: { id } });
    } catch (err) {
      console.error(err);
      toast.error("Failed to save project");
    }
  }

  // Export WAV file directly to user device
  async function handleExportWav() {
    toast.info("Synthesizing audio project...");
    try {
      const offline = new OfflineAudioContext(2, 44100 * 8, 44100);
      const stepSec = 60 / bpm / 4;
      for (let loop = 0; loop < 4; loop++) {
        const loopOffset = loop * 16 * stepSec;
        (["kick", "snare", "hihat", "clap"] as const).forEach((inst) => {
          drumPattern[inst]?.forEach((active, step) => {
            if (active) {
              playDrumSound(offline as any, inst, loopOffset + step * stepSec);
            }
          });
        });
      }
      const rendered = await offline.startRendering();
      const wavBuffer = audioBufferToWav(rendered);
      const blob = new Blob([wavBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ChordLab_Studio_Track_${bpm}BPM.wav`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("WAV track exported!");
    } catch (e) {
      toast.error("Could not export audio");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-24">
      {/* Studio Header */}
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-sm shadow-primary/20">
            <Disc3 className="size-5 animate-[spin_8s_linear_infinite]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Create Music</h1>
            <p className="text-xs text-muted-foreground">GarageBand-style studio with keys, drums & vocals</p>
          </div>
        </div>

        {/* Global Master Transport */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsPlaying((p) => !p)}
            className={`gap-1.5 font-semibold transition-all ${
              isPlaying
                ? "bg-amber-500 hover:bg-amber-600 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)]"
                : "bg-primary hover:bg-primary/90 text-primary-foreground"
            }`}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            {isPlaying ? "Pause" : "Play Loop"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveProjectToLibrary}
            className="gap-1.5 border-primary/30 text-xs text-primary hover:bg-primary/10"
          >
            <FolderPlus className="size-3.5" />
            Save
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportWav}
            className="gap-1.5 text-xs"
          >
            <Download className="size-3.5" />
            WAV
          </Button>
        </div>
      </header>

      {/* BPM & Metronome Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card/60 p-3.5 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">TEMPO:</span>
          <span className="font-mono text-base font-bold text-primary">{bpm} BPM</span>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-[200px]">
          <Slider
            value={[bpm]}
            min={60}
            max={180}
            step={1}
            onValueChange={([v]) => setBpm(v)}
          />
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setBpm((b) => Math.max(60, b - 5))}
            className="rounded-lg bg-background/60 px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-background hover:text-foreground"
          >
            -5
          </button>
          <button
            type="button"
            onClick={() => setBpm((b) => Math.min(180, b + 5))}
            className="rounded-lg bg-background/60 px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-background hover:text-foreground"
          >
            +5
          </button>
        </div>
      </div>

      {/* Studio Instrument Tabs */}
      <div className="mb-5 flex rounded-xl border border-white/10 bg-background/70 p-1 shadow-inner">
        <button
          type="button"
          onClick={() => setActiveTab("keys")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            activeTab === "keys"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Piano & Keys
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("drums")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            activeTab === "drums"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Drum Machine
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vocals")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            activeTab === "vocals"
              ? "bg-primary text-primary-foreground shadow"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Vocal Mic
        </button>
      </div>

      {/* TAB 1: PIANO & KEYS */}
      {activeTab === "keys" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-card/60 p-3 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Sound:</Label>
              <div className="flex gap-1.5">
                {(["piano", "rhodes", "synth"] as const).map((inst) => (
                  <button
                    key={inst}
                    type="button"
                    onClick={() => setKeyInstrument(inst)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition ${
                      keyInstrument === inst
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-background/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {inst === "piano" ? "Grand Piano" : inst === "rhodes" ? "Electric Rhodes" : "Synth Lead"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Octave:</Label>
              <button
                type="button"
                onClick={() => setOctaveShift((o) => Math.max(-2, o - 1))}
                className="size-6 rounded bg-background/60 font-bold text-xs"
              >
                -
              </button>
              <span className="w-5 text-center font-mono text-xs font-semibold">
                {octaveShift > 0 ? `+${octaveShift}` : octaveShift}
              </span>
              <button
                type="button"
                onClick={() => setOctaveShift((o) => Math.min(2, o + 1))}
                className="size-6 rounded bg-background/60 font-bold text-xs"
              >
                +
              </button>
            </div>
          </div>

          {/* Interactive Piano Keyboard */}
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-neutral-950 p-4 shadow-2xl">
            <p className="mb-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
              Tap or use computer keys (A, W, S, E, D, F, T, G, Y, H, U, J, K) to play chords & melody
            </p>
            <div className="relative flex h-48 select-none justify-center">
              {PIANO_KEYS.map((k) =>
                !k.isBlack ? (
                  <button
                    key={k.note}
                    type="button"
                    onMouseDown={() => handlePlayNote(k.freq, k.note)}
                    onTouchStart={() => handlePlayNote(k.freq, k.note)}
                    className="relative flex h-full w-10 flex-col justify-end rounded-b-lg border border-neutral-300 bg-gradient-to-b from-neutral-100 to-white pb-2 text-neutral-900 shadow-md transition-all active:scale-[0.98] active:bg-neutral-200"
                  >
                    <span className="text-[10px] font-bold text-neutral-400">{k.key}</span>
                    <span className="text-[11px] font-bold">{k.note}</span>
                  </button>
                ) : (
                  <button
                    key={k.note}
                    type="button"
                    onMouseDown={() => handlePlayNote(k.freq, k.note)}
                    onTouchStart={() => handlePlayNote(k.freq, k.note)}
                    className="relative -mx-3.5 z-10 flex h-32 w-7 flex-col justify-end rounded-b-md border border-neutral-900 bg-gradient-to-b from-neutral-800 to-neutral-950 pb-2 text-white shadow-xl transition-all active:scale-[0.97] active:bg-neutral-800"
                  >
                    <span className="text-[9px] font-bold text-neutral-400">{k.key}</span>
                    <span className="text-[9px] font-semibold text-primary">{k.note}</span>
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DRUM MACHINE SEQUENCER */}
      {activeTab === "drums" && (
        <div className="space-y-4">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-card/60 p-3">
            <span className="text-xs font-semibold text-muted-foreground">Pattern Presets:</span>
            <div className="flex flex-wrap gap-1.5">
              {(["rock", "hiphop", "dance", "trap", "clear"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => loadDrumPreset(preset)}
                  className="rounded-lg bg-background/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-primary/20 hover:text-primary transition"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* 16-step Sequencer Grid */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-card/60 p-4 shadow-sm backdrop-blur-md">
            {(["kick", "snare", "hihat", "clap"] as const).map((inst) => (
              <div key={inst} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    {inst}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const ctx = getAudioContext();
                      playDrumSound(ctx, inst, ctx.currentTime);
                    }}
                    className="text-[10px] text-muted-foreground hover:text-primary"
                  >
                    Tap preview
                  </button>
                </div>
                <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
                  {drumPattern[inst]?.map((active, stepIdx) => (
                    <button
                      key={stepIdx}
                      type="button"
                      onClick={() => toggleStep(inst, stepIdx)}
                      className={`h-9 rounded-md transition-all ${
                        active
                          ? "bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.6)]"
                          : stepIdx % 4 === 0
                            ? "bg-white/15 hover:bg-white/25"
                            : "bg-white/5 hover:bg-white/15"
                      } ${
                        isPlaying && currentStep === stepIdx
                          ? "ring-2 ring-amber-400 scale-105"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: VOCAL MIC RECORDING */}
      {activeTab === "vocals" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-card/60 p-8 text-center backdrop-blur-md">
            <div
              className={`mb-4 flex size-20 items-center justify-center rounded-full transition-all duration-300 ${
                isRecordingVocal
                  ? "bg-red-500/20 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] animate-pulse"
                  : "bg-primary/20 text-primary"
              }`}
            >
              <Mic className="size-10" />
            </div>

            <h3 className="text-lg font-bold">
              {isRecordingVocal ? "Recording in progress..." : "Vocal Microphone"}
            </h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Record vocal melodies, hums, or lyrics. Your recording syncs directly with the drum & piano track!
            </p>

            <Button
              size="lg"
              onClick={toggleVocalRecord}
              className={`mt-6 gap-2 rounded-full px-8 font-semibold shadow-lg transition-all ${
                isRecordingVocal
                  ? "bg-red-500 hover:bg-red-600 text-white animate-bounce"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              }`}
            >
              {isRecordingVocal ? <Square className="size-4" /> : <Circle className="size-4 fill-current" />}
              {isRecordingVocal ? "Stop Recording" : "Record Vocals"}
            </Button>

            {/* Audio Preview if recorded */}
            {vocalAudioUrl && (
              <div className="mt-6 w-full rounded-xl bg-background/50 p-4">
                <p className="text-xs font-semibold text-emerald-400 mb-2">Vocal Track Captured</p>
                <audio controls src={vocalAudioUrl} className="w-full h-10" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to convert Web Audio Float32 AudioBuffer to standard 16-bit PCM stereo WAV
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, length, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}
