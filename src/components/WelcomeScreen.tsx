import { useEffect, useRef, useState } from "react";
import { Music2, Sparkles, Volume2, VolumeX } from "lucide-react";

interface WelcomeScreenProps {
  onComplete: () => void;
  message?: string;
  autoPlayAudio?: boolean;
}

/**
 * Plays a realistic warm major 7th acoustic synthesizer chord chime (C4 - G4 - B4 - E5)
 * using the Web Audio API with realistic harmonic overtones and envelope decay.
 */
function playMusicalTransitionChime(muted = false) {
  if (muted || typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const frequencies = [261.63, 392.0, 493.88, 659.25]; // C4, G4, B4, E5 (Cmaj7 chime)
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.28, now + 0.08);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    masterGain.connect(ctx.destination);

    // Warm resonant filter
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(4200, now + 0.3);
    filter.frequency.exponentialRampToValueAtTime(1200, now + 2.6);
    filter.connect(masterGain);

    frequencies.forEach((freq, idx) => {
      const stagger = idx * 0.06;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + stagger);

      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2, now + stagger); // 2nd harmonic sparkle

      noteGain.gain.setValueAtTime(0.0001, now + stagger);
      noteGain.gain.exponentialRampToValueAtTime(0.35 / frequencies.length, now + stagger + 0.04);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + stagger + 2.2);

      osc.connect(noteGain);
      osc2.connect(noteGain);
      noteGain.connect(filter);

      osc.start(now + stagger);
      osc2.start(now + stagger);
      osc.stop(now + stagger + 2.4);
      osc2.stop(now + stagger + 2.4);
    });

    setTimeout(() => {
      void ctx.close();
    }, 3200);
  } catch {
    // Audio autoplay restrictions gracefully handled
  }
}

/**
 * Premium Welcome Screen component.
 * Features realistic musical harmonic audio transition, animated soundwave frequency bars,
 * glowing brand identity, and a realistic progress loading bar.
 */
export function WelcomeScreen({
  onComplete,
  message = "Welcome to ChordLab",
  autoPlayAudio = true,
}: WelcomeScreenProps) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Initializing Harmonic Engine...");
  const [fading, setFading] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioPlayed = useRef(false);

  useEffect(() => {
    if (autoPlayAudio && !audioPlayed.current && !muted) {
      audioPlayed.current = true;
      playMusicalTransitionChime(false);
    }
  }, [autoPlayAudio, muted]);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 2400; // 2.4 seconds realistic load transition

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);

      if (pct < 30) {
        setStage("Initializing Web Audio Engine...");
      } else if (pct < 65) {
        setStage("Calibrating Multi-Lingual ACR Neural Models...");
      } else if (pct < 90) {
        setStage("Preparing Stem Separation & AI Lyrics Agent...");
      } else {
        setStage(message);
      }

      if (pct >= 100) {
        clearInterval(interval);
        setFading(true);
        setTimeout(() => {
          onComplete();
        }, 550);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [message, onComplete]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to ChordLab"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-between overflow-hidden bg-[#0c0e14] px-6 py-12 text-foreground transition-opacity duration-500 ${
        fading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      onClick={() => {
        // Allow tap-to-skip
        if (progress > 35) {
          setFading(true);
          setTimeout(onComplete, 300);
        }
      }}
    >
      {/* Background radial glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] rounded-full bg-primary/20 blur-[120px] transition-all" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[280px] rounded-full bg-indigo-500/15 blur-[90px]" />
      </div>

      {/* Top toolbar */}
      <div className="relative z-10 flex w-full max-w-md items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium tracking-wider uppercase text-primary/80">
          <Sparkles className="size-3.5 text-primary animate-pulse" />
          <span>ChordLab Studio v2.4</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMuted(!muted);
            if (muted) playMusicalTransitionChime(false);
          }}
          className="flex items-center gap-1.5 rounded-full border border-border/40 bg-surface-1/80 px-2.5 py-1 text-[11px] backdrop-blur-md transition-colors hover:text-foreground"
        >
          {muted ? <VolumeX className="size-3 text-destructive" /> : <Volume2 className="size-3 text-primary" />}
          <span>{muted ? "Muted" : "Chime ON"}</span>
        </button>
      </div>

      {/* Centered Brand & Musical Transition Visualizer */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        {/* Glowing DAW / Harmonic Icon */}
        <div className="relative mb-6 flex size-20 items-center justify-center rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/30 via-surface-2/60 to-surface-1/80 shadow-[0_0_40px_rgba(139,92,246,0.35)] backdrop-blur-xl">
          <Music2 className="size-10 text-primary drop-shadow-[0_2px_10px_rgba(139,92,246,0.6)]" />
          <div className="absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-r from-primary to-indigo-500 opacity-20 blur-md animate-pulse" />
        </div>

        {/* Brand Name */}
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          <span className="bg-gradient-to-r from-white via-primary-foreground to-primary bg-clip-text text-transparent">
            CHORD
          </span>
          <span className="text-primary">LAB</span>
        </h1>

        <p className="mt-2 text-xs font-medium tracking-widest uppercase text-muted-foreground sm:text-sm">
          Harmonic Studio & Multi-Lingual Chord AI
        </p>

        {/* Animated Soundwave Frequency Bars */}
        <div className="mt-8 flex h-10 items-end justify-center gap-1.5 px-4" aria-hidden="true">
          {[24, 45, 68, 92, 54, 76, 100, 84, 62, 95, 48, 70, 88, 52, 36].map((h, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-gradient-to-t from-primary/40 to-primary transition-all duration-300"
              style={{
                height: `${Math.max(15, (h * Math.sin((progress / 15) + i * 0.45) ** 2))}%`,
                opacity: 0.35 + (i % 3) * 0.3,
              }}
            />
          ))}
        </div>
      </div>

      {/* Realistic Bottom Loading Bar */}
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="truncate font-medium text-foreground/90">{stage}</span>
          <span className="font-mono text-xs text-primary font-semibold">{progress}%</span>
        </div>

        {/* Outer track */}
        <div className="relative h-2 w-full overflow-hidden rounded-full border border-border/40 bg-surface-2/80 p-0.5 shadow-inner">
          {/* Animated fill */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary via-indigo-500 to-purple-400 transition-all duration-75 shadow-[0_0_12px_rgba(139,92,246,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground/80">
          <span>English • Tanglish • Hinglish</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFading(true);
              setTimeout(onComplete, 200);
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
