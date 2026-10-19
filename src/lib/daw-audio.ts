// Studio DAW Audio Engine for ChordLab (Physical Modeling & Acoustic Instrument Synthesis)

export type DawInstrumentCategory =
  | "keys"
  | "guitars"
  | "bass"
  | "strings"
  | "winds"
  | "synths"
  | "drums"
  | "vocals";

export type DawInstrumentType =
  | "grand_piano"
  | "electric_piano"
  | "acoustic_guitar"
  | "electric_guitar_clean"
  | "electric_guitar_lead"
  | "modern_bass"
  | "string_section"
  | "rock_organ"
  | "flute"
  | "brass_section"
  | "synth_lead"
  | "drum_kit"
  | "percussion"
  | "vocals";

export interface DawInstrumentInfo {
  id: DawInstrumentType;
  name: string;
  category: DawInstrumentCategory;
  color: string; // Apple GarageBand color
  iconName: string;
  isMelodic: boolean;
  defaultOctave: number;
  description: string;
}

export const DAW_INSTRUMENTS: DawInstrumentInfo[] = [
  {
    id: "grand_piano",
    name: "Grand Piano",
    category: "keys",
    color: "#22c55e", // Apple Green
    iconName: "Piano",
    isMelodic: true,
    defaultOctave: 4,
    description: "Steinway Concert Grand with hammer strike attack and soundboard resonance.",
  },
  {
    id: "electric_piano",
    name: "Rhodes E-Piano",
    category: "keys",
    color: "#10b981", // Emerald
    iconName: "Keyboard",
    isMelodic: true,
    defaultOctave: 4,
    description: "Vintage 1970s Rhodes Mark I with warm tine chime and stereo chorus.",
  },
  {
    id: "rock_organ",
    name: "Classic Rock Organ",
    category: "keys",
    color: "#84cc16", // Lime Green
    iconName: "SlidersHorizontal",
    isMelodic: true,
    defaultOctave: 4,
    description: "Hammond B3 drawbar organ with rotating Leslie speaker simulation.",
  },
  {
    id: "acoustic_guitar",
    name: "Ac Guitar",
    category: "guitars",
    color: "#3b82f6", // Blue
    iconName: "Guitar",
    isMelodic: true,
    defaultOctave: 3,
    description: "Martin steel-string acoustic guitar with Karplus-Strong physical modeling.",
  },
  {
    id: "electric_guitar_clean",
    name: "Clean Strat",
    category: "guitars",
    color: "#06b6d4", // Cyan
    iconName: "Guitar",
    isMelodic: true,
    defaultOctave: 3,
    description: "Fender Stratocaster single-coil pickups with tube amp warmth.",
  },
  {
    id: "electric_guitar_lead",
    name: "Guitar Solo",
    category: "guitars",
    color: "#eab308", // Yellow / Gold
    iconName: "Flame",
    isMelodic: true,
    defaultOctave: 4,
    description: "Overdriven singing lead guitar with 4x12 speaker cabinet resonance.",
  },
  {
    id: "modern_bass",
    name: "Modern Bass",
    category: "bass",
    color: "#2563eb", // Deep Cobalt Blue
    iconName: "Activity",
    isMelodic: true,
    defaultOctave: 2,
    description: "Fender Jazz Bass with deep fundamental and punchy finger pluck.",
  },
  {
    id: "string_section",
    name: "String Section",
    category: "strings",
    color: "#16a34a", // Forest Green
    iconName: "Music2",
    isMelodic: true,
    defaultOctave: 4,
    description: "Philharmonic orchestral violin and cello ensemble with natural vibrato.",
  },
  {
    id: "flute",
    name: "Concert Flute",
    category: "winds",
    color: "#14b8a6", // Teal
    iconName: "Wind",
    isMelodic: true,
    defaultOctave: 5,
    description: "Silver orchestral flute with breath flutter noise and woody resonance.",
  },
  {
    id: "brass_section",
    name: "Brass Horns",
    category: "winds",
    color: "#f59e0b", // Amber
    iconName: "Megaphone",
    isMelodic: true,
    defaultOctave: 4,
    description: "Trumpet & French Horn brass section with bright harmonic flare.",
  },
  {
    id: "synth_lead",
    name: "Analog Synth",
    category: "synths",
    color: "#ec4899", // Pink
    iconName: "Zap",
    isMelodic: true,
    defaultOctave: 4,
    description: "Multi-sawtooth vintage synthesizer with 24dB resonant lowpass sweep.",
  },
  {
    id: "drum_kit",
    name: "Studio Drum Kit",
    category: "drums",
    color: "#f97316", // Orange
    iconName: "Disc",
    isMelodic: false,
    defaultOctave: 3,
    description: "Punchy acoustic studio drum kit with kick, snare, hi-hats, toms & crash.",
  },
  {
    id: "percussion",
    name: "Percussion",
    category: "drums",
    color: "#d946ef", // Fuchsia
    iconName: "Bell",
    isMelodic: false,
    defaultOctave: 4,
    description: "Tambourine, shakers, hand claps, and cowbell.",
  },
  {
    id: "vocals",
    name: "My Vocal",
    category: "vocals",
    color: "#a855f7", // Purple
    iconName: "Mic",
    isMelodic: true,
    defaultOctave: 4,
    description: "Vocal microphone recording, line-in instrument, or imported audio file.",
  },
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function noteToFrequency(note: string | number): number {
  if (typeof note === "number") {
    return 440 * Math.pow(2, (note - 69) / 12);
  }
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return 440;
  const name = match[1]?.toUpperCase() ?? "C";
  const octave = parseInt(match[2] ?? "4", 10);
  let semitone = NOTE_NAMES.indexOf(name);
  if (semitone === -1) semitone = FLAT_NAMES.indexOf(name);
  if (semitone === -1) semitone = 0;
  const midi = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex] ?? "C"}${octave}`;
}

// ==========================================
// REAL ACOUSTIC INSTRUMENT SYNTHESIS ENGINE
// ==========================================

export function playDawInstrumentSound(
  ctx: AudioContext,
  instrument: DawInstrumentType,
  note: string | number,
  time = ctx.currentTime,
  duration = 0.8,
  velocity = 0.85,
  destination: AudioNode = ctx.destination
): { stop: () => void } {
  const freq = noteToFrequency(note);
  const stopCallbacks: (() => void)[] = [];

  switch (instrument) {
    case "grand_piano": {
      // Steinway Grand Piano:
      // 1. Hammer strike attack (transient felt impulse)
      // 2. Triple-string unison with micro-detuning
      // 3. Multi-harmonic overtone series with exponential damping
      // 4. Acoustic wooden soundboard resonance filter
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(velocity * 0.9, time);

      const soundboard = ctx.createBiquadFilter();
      soundboard.type = "peaking";
      soundboard.frequency.setValueAtTime(320, time);
      soundboard.Q.setValueAtTime(1.8, time);
      soundboard.gain.setValueAtTime(4.5, time);

      const highDamp = ctx.createBiquadFilter();
      highDamp.type = "lowpass";
      highDamp.frequency.setValueAtTime(Math.min(8000, freq * 14), time);
      highDamp.frequency.exponentialRampToValueAtTime(Math.max(250, freq * 1.5), time + duration);

      // Felt hammer attack transient
      const hammerLen = Math.floor(ctx.sampleRate * 0.015);
      const hammerBuffer = ctx.createBuffer(1, hammerLen, ctx.sampleRate);
      const hammerData = hammerBuffer.getChannelData(0);
      for (let i = 0; i < hammerLen; i++) {
        hammerData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003));
      }
      const hammerSource = ctx.createBufferSource();
      hammerSource.buffer = hammerBuffer;
      const hammerFilter = ctx.createBiquadFilter();
      hammerFilter.type = "bandpass";
      hammerFilter.frequency.setValueAtTime(freq * 2.5, time);
      const hammerGain = ctx.createGain();
      hammerGain.gain.setValueAtTime(velocity * 0.45, time);
      hammerSource.connect(hammerFilter);
      hammerFilter.connect(hammerGain);
      hammerGain.connect(masterGain);
      hammerSource.start(time);

      // 3 Unison Strings (detuned by ~0.08% to create natural acoustic beating)
      const detunes = [0, 1.0008, 0.9992];
      const harmonics = [
        { mult: 1, gain: 0.65, decay: duration * 1.5 },
        { mult: 2, gain: 0.35, decay: duration * 1.0 },
        { mult: 3, gain: 0.22, decay: duration * 0.7 },
        { mult: 4, gain: 0.12, decay: duration * 0.45 },
        { mult: 5, gain: 0.06, decay: duration * 0.3 },
      ];

      detunes.forEach((detuneRate) => {
        harmonics.forEach((h) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq * h.mult * detuneRate, time);

          g.gain.setValueAtTime(0, time);
          g.gain.linearRampToValueAtTime(h.gain * 0.33, time + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, time + h.decay);

          osc.connect(g);
          g.connect(highDamp);
          osc.start(time);
          osc.stop(time + h.decay + 0.05);
          stopCallbacks.push(() => {
            try {
              g.gain.cancelScheduledValues(ctx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
              osc.stop(ctx.currentTime + 0.06);
            } catch (_) {}
          });
        });
      });

      highDamp.connect(soundboard);
      soundboard.connect(masterGain);
      masterGain.connect(destination);
      break;
    }

    case "electric_piano": {
      // Rhodes Mark I: 2-Operator FM synthesis
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const carrierGain = ctx.createGain();
      const masterGain = ctx.createGain();

      carrier.type = "sine";
      carrier.frequency.setValueAtTime(freq, time);

      mod.type = "sine";
      mod.frequency.setValueAtTime(freq, time);

      modGain.gain.setValueAtTime(freq * 1.8 * velocity, time);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.05, time + duration * 0.6);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      carrierGain.gain.setValueAtTime(0, time);
      carrierGain.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.006);
      carrierGain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 1.2);

      const chorus = ctx.createBiquadFilter();
      chorus.type = "lowpass";
      chorus.frequency.setValueAtTime(3200, time);

      carrier.connect(carrierGain);
      carrierGain.connect(chorus);
      chorus.connect(masterGain);
      masterGain.connect(destination);

      carrier.start(time);
      mod.start(time);
      carrier.stop(time + duration * 1.25);
      mod.stop(time + duration * 1.25);

      stopCallbacks.push(() => {
        try {
          carrierGain.gain.cancelScheduledValues(ctx.currentTime);
          carrierGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          carrier.stop(ctx.currentTime + 0.06);
          mod.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "acoustic_guitar": {
      // Karplus-Strong string pluck with wooden body acoustic resonance
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(velocity * 0.85, time);

      const bodyAir = ctx.createBiquadFilter();
      bodyAir.type = "peaking";
      bodyAir.frequency.setValueAtTime(105, time);
      bodyAir.gain.setValueAtTime(6.0, time);

      const bodyWood = ctx.createBiquadFilter();
      bodyWood.type = "peaking";
      bodyWood.frequency.setValueAtTime(235, time);
      bodyWood.gain.setValueAtTime(4.0, time);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const g1 = ctx.createGain();
      const g2 = ctx.createGain();

      osc1.type = "triangle";
      osc1.frequency.setValueAtTime(freq, time);
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq * 2, time);

      const pluckFilter = ctx.createBiquadFilter();
      pluckFilter.type = "lowpass";
      pluckFilter.frequency.setValueAtTime(Math.min(7500, freq * 8), time);
      pluckFilter.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.2), time + duration);

      g1.gain.setValueAtTime(0, time);
      g1.gain.linearRampToValueAtTime(0.65, time + 0.003);
      g1.gain.exponentialRampToValueAtTime(0.0001, time + duration * 1.3);

      g2.gain.setValueAtTime(0, time);
      g2.gain.linearRampToValueAtTime(0.35, time + 0.002);
      g2.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.7);

      osc1.connect(g1);
      osc2.connect(g2);
      g1.connect(pluckFilter);
      g2.connect(pluckFilter);
      pluckFilter.connect(bodyAir);
      bodyAir.connect(bodyWood);
      bodyWood.connect(masterGain);
      masterGain.connect(destination);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(time + duration * 1.35);
      osc2.stop(time + duration * 1.35);

      stopCallbacks.push(() => {
        try {
          g1.gain.cancelScheduledValues(ctx.currentTime);
          g1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          osc1.stop(ctx.currentTime + 0.06);
          osc2.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "electric_guitar_clean":
    case "electric_guitar_lead": {
      const isLead = instrument === "electric_guitar_lead";
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc1.type = isLead ? "sawtooth" : "triangle";
      osc1.frequency.setValueAtTime(freq, time);
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq * 1.002, time);

      const shaper = ctx.createWaveShaper();
      const curveLen = 512;
      const curve = new Float32Array(curveLen);
      const drive = isLead ? 6.5 : 1.4;
      for (let i = 0; i < curveLen; i++) {
        const x = (i * 2) / curveLen - 1;
        curve[i] = Math.tanh(drive * x);
      }
      shaper.curve = curve;
      shaper.oversample = "4x";

      const cabPresence = ctx.createBiquadFilter();
      cabPresence.type = "peaking";
      cabPresence.frequency.setValueAtTime(1800, time);
      cabPresence.gain.setValueAtTime(isLead ? 5.0 : 2.5, time);

      const cabRollOff = ctx.createBiquadFilter();
      cabRollOff.type = "lowpass";
      cabRollOff.frequency.setValueAtTime(isLead ? 4200 : 5500, time);

      const envGain = ctx.createGain();
      envGain.gain.setValueAtTime(0, time);
      envGain.gain.linearRampToValueAtTime(velocity * (isLead ? 0.75 : 0.8), time + 0.005);
      envGain.gain.exponentialRampToValueAtTime(0.0001, time + duration * (isLead ? 1.8 : 1.2));

      osc1.connect(oscGain);
      osc2.connect(oscGain);
      oscGain.connect(shaper);
      shaper.connect(cabPresence);
      cabPresence.connect(cabRollOff);
      cabRollOff.connect(envGain);
      envGain.connect(destination);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(time + duration * 1.9);
      osc2.stop(time + duration * 1.9);

      stopCallbacks.push(() => {
        try {
          envGain.gain.cancelScheduledValues(ctx.currentTime);
          envGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          osc1.stop(ctx.currentTime + 0.06);
          osc2.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "modern_bass": {
      const sub = ctx.createOscillator();
      const harmonics = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      sub.type = "sine";
      sub.frequency.setValueAtTime(freq, time);

      harmonics.type = "sawtooth";
      harmonics.frequency.setValueAtTime(freq, time);

      filter.type = "lowpass";
      filter.Q.setValueAtTime(3.5, time);
      filter.frequency.setValueAtTime(freq * 5.5, time);
      filter.frequency.exponentialRampToValueAtTime(freq * 1.2, time + 0.25);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(velocity * 0.95, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 1.2);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.7, time);
      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0.4, time);

      sub.connect(subGain);
      harmonics.connect(harmGain);
      subGain.connect(filter);
      harmGain.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      sub.start(time);
      harmonics.start(time);
      sub.stop(time + duration * 1.25);
      harmonics.stop(time + duration * 1.25);

      stopCallbacks.push(() => {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          sub.stop(ctx.currentTime + 0.06);
          harmonics.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "string_section": {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.4, time);
      lfoGain.gain.setValueAtTime(freq * 0.015, time);
      lfo.connect(lfoGain);

      const detunes = [-7, 0, 8, 14];
      const masterGain = ctx.createGain();

      const f1 = ctx.createBiquadFilter();
      f1.type = "peaking";
      f1.frequency.setValueAtTime(450, time);
      f1.gain.setValueAtTime(4.0, time);

      const f2 = ctx.createBiquadFilter();
      f2.type = "peaking";
      f2.frequency.setValueAtTime(1200, time);
      f2.gain.setValueAtTime(3.5, time);

      detunes.forEach((cents) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime(cents, time);
        lfoGain.connect(osc.frequency);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.22, time + 0.09);
        g.gain.setValueAtTime(0.2, time + duration * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.3);

        osc.connect(g);
        g.connect(f1);
        osc.start(time);
        osc.stop(time + duration + 0.35);

        stopCallbacks.push(() => {
          try {
            g.gain.cancelScheduledValues(ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
            osc.stop(ctx.currentTime + 0.1);
          } catch (_) {}
        });
      });

      f1.connect(f2);
      f2.connect(masterGain);
      masterGain.connect(destination);
      lfo.start(time);
      lfo.stop(time + duration + 0.35);
      break;
    }

    case "rock_organ": {
      const drawbars = [
        { mult: 0.5, gain: 0.5 },
        { mult: 1.0, gain: 0.8 },
        { mult: 1.5, gain: 0.4 },
        { mult: 2.0, gain: 0.6 },
        { mult: 3.0, gain: 0.3 },
        { mult: 4.0, gain: 0.2 },
      ];

      const masterGain = ctx.createGain();
      const tremolo = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(6.2, time);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.25, time);
      lfo.connect(lfoGain);
      lfoGain.connect(tremolo.gain);
      tremolo.gain.setValueAtTime(0.75, time);

      drawbars.forEach((d) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * d.mult, time);
        g.gain.setValueAtTime(d.gain * 0.2, time);
        osc.connect(g);
        g.connect(tremolo);
        osc.start(time);
        osc.stop(time + duration);

        stopCallbacks.push(() => {
          try {
            g.gain.cancelScheduledValues(ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
            osc.stop(ctx.currentTime + 0.04);
          } catch (_) {}
        });
      });

      masterGain.gain.setValueAtTime(velocity * 0.85, time);
      tremolo.connect(masterGain);
      masterGain.connect(destination);
      lfo.start(time);
      lfo.stop(time + duration);
      break;
    }

    case "flute": {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);

      const noiseLen = Math.floor(ctx.sampleRate * Math.min(1.0, duration));
      const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * 0.12;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(freq * 1.5, time);
      noiseFilter.Q.setValueAtTime(4.0, time);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(freq * 3.5, time);

      oscGain.gain.setValueAtTime(0, time);
      oscGain.gain.linearRampToValueAtTime(velocity * 0.75, time + 0.06);
      oscGain.gain.setValueAtTime(velocity * 0.7, time + duration * 0.8);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.1);

      osc.connect(filter);
      noise.connect(noiseFilter);
      noiseFilter.connect(filter);
      filter.connect(oscGain);
      oscGain.connect(destination);

      osc.start(time);
      noise.start(time);
      osc.stop(time + duration + 0.15);
      noise.stop(time + duration + 0.15);

      stopCallbacks.push(() => {
        try {
          oscGain.gain.cancelScheduledValues(ctx.currentTime);
          oscGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          osc.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "brass_section": {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(freq, time);
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq * 1.004, time);

      filter.type = "lowpass";
      filter.Q.setValueAtTime(4.5, time);
      filter.frequency.setValueAtTime(freq * 1.2, time);
      filter.frequency.exponentialRampToValueAtTime(freq * 6.5, time + 0.08);
      filter.frequency.exponentialRampToValueAtTime(freq * 2.8, time + duration);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(velocity * 0.8, time + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.15);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      osc1.start(time);
      osc2.start(time);
      osc1.stop(time + duration + 0.2);
      osc2.stop(time + duration + 0.2);

      stopCallbacks.push(() => {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          osc1.stop(ctx.currentTime + 0.06);
          osc2.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }

    case "synth_lead": {
      const masterGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.setValueAtTime(6.0, time);
      filter.frequency.setValueAtTime(Math.min(10000, freq * 9), time);
      filter.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.5), time + duration);

      [-12, -4, 0, 5, 11].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime(cents, time);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration);
        stopCallbacks.push(() => {
          try {
            osc.stop(ctx.currentTime + 0.05);
          } catch (_) {}
        });
      });

      masterGain.gain.setValueAtTime(0, time);
      masterGain.gain.linearRampToValueAtTime(velocity * 0.4, time + 0.008);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      filter.connect(masterGain);
      masterGain.connect(destination);
      break;
    }

    case "vocals":
    default: {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);

      f1.type = "bandpass";
      f1.frequency.setValueAtTime(800, time);
      f1.Q.setValueAtTime(5.0, time);

      f2.type = "bandpass";
      f2.frequency.setValueAtTime(1250, time);
      f2.Q.setValueAtTime(5.0, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.08);
      gain.gain.setValueAtTime(velocity * 0.65, time + duration * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.2);

      osc.connect(f1);
      osc.connect(f2);
      f1.connect(gain);
      f2.connect(gain);
      gain.connect(destination);

      osc.start(time);
      osc.stop(time + duration + 0.25);

      stopCallbacks.push(() => {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
          osc.stop(ctx.currentTime + 0.06);
        } catch (_) {}
      });
      break;
    }
  }

  return {
    stop: () => {
      stopCallbacks.forEach((cb) => cb());
    },
  };
}

// ==========================================
// REAL STUDIO DRUM SYNTHESIS ENGINE
// ==========================================

export type DawDrumType =
  | "kick"
  | "snare"
  | "hihat"
  | "hihat_open"
  | "clap"
  | "tom"
  | "crash"
  | "tambourine";

export function playDawDrumSound(
  ctx: AudioContext,
  type: DawDrumType,
  time = ctx.currentTime,
  velocity = 0.9,
  destination: AudioNode = ctx.destination
) {
  switch (type) {
    case "kick": {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(145, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.06);

      gain.gain.setValueAtTime(velocity * 1.0, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.42);

      const clickLen = Math.floor(ctx.sampleRate * 0.008);
      const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const clickData = clickBuf.getChannelData(0);
      for (let i = 0; i < clickLen; i++) {
        clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.002));
      }
      const clickSource = ctx.createBufferSource();
      clickSource.buffer = clickBuf;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = "bandpass";
      clickFilter.frequency.setValueAtTime(3500, time);
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(velocity * 0.5, time);

      clickSource.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(destination);
      clickSource.start(time);

      osc.connect(gain);
      gain.connect(destination);
      osc.start(time);
      osc.stop(time + 0.45);
      break;
    }

    case "snare": {
      const tone = ctx.createOscillator();
      const toneGain = ctx.createGain();
      tone.type = "triangle";
      tone.frequency.setValueAtTime(185, time);
      tone.frequency.exponentialRampToValueAtTime(75, time + 0.08);
      toneGain.gain.setValueAtTime(velocity * 0.7, time);
      toneGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      tone.connect(toneGain);
      toneGain.connect(destination);
      tone.start(time);
      tone.stop(time + 0.2);

      const noiseLen = Math.floor(ctx.sampleRate * 0.24);
      const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) {
        noiseData[i] = Math.random() * 2 - 1;
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1200, time);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(velocity * 0.85, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(destination);
      noiseSource.start(time);
      break;
    }

    case "hihat":
    case "hihat_open": {
      const isOpen = type === "hihat_open";
      const decay = isOpen ? 0.35 : 0.055;
      const freqs = [215, 305, 420, 540, 680, 890];
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(velocity * (isOpen ? 0.65 : 0.55), time);
      masterGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(8500, time);
      filter.Q.setValueAtTime(2.2, time);

      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(f, time);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + decay + 0.02);
      });

      filter.connect(masterGain);
      masterGain.connect(destination);
      break;
    }

    case "clap": {
      for (let i = 0; i < 3; i++) {
        const t = time + i * 0.012;
        const bufLen = Math.floor(ctx.sampleRate * 0.04);
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let j = 0; j < bufLen; j++) {
          data[j] = Math.random() * 2 - 1;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.setValueAtTime(1400, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(velocity * 0.65, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.connect(f);
        f.connect(g);
        g.connect(destination);
        src.start(t);
      }
      const tailLen = Math.floor(ctx.sampleRate * 0.18);
      const tailBuf = ctx.createBuffer(1, tailLen, ctx.sampleRate);
      const tailData = tailBuf.getChannelData(0);
      for (let j = 0; j < tailLen; j++) tailData[j] = Math.random() * 2 - 1;
      const tailSrc = ctx.createBufferSource();
      tailSrc.buffer = tailBuf;
      const tailF = ctx.createBiquadFilter();
      tailF.type = "bandpass";
      tailF.frequency.setValueAtTime(1100, time);
      const tailG = ctx.createGain();
      tailG.gain.setValueAtTime(velocity * 0.5, time + 0.035);
      tailG.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      tailSrc.connect(tailF);
      tailF.connect(tailG);
      tailG.connect(destination);
      tailSrc.start(time + 0.035);
      break;
    }

    case "tom": {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(130, time);
      osc.frequency.exponentialRampToValueAtTime(80, time + 0.12);
      gain.gain.setValueAtTime(velocity * 0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(time);
      osc.stop(time + 0.38);
      break;
    }

    case "crash": {
      const decay = 2.4;
      const freqs = [380, 520, 710, 890, 1140, 1450, 1920, 2450, 3100, 4200];
      const master = ctx.createGain();
      master.gain.setValueAtTime(velocity * 0.6, time);
      master.gain.exponentialRampToValueAtTime(0.001, time + decay);

      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.setValueAtTime(4500, time);

      freqs.forEach((freqVal) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freqVal, time);
        osc.connect(f);
        osc.start(time);
        osc.stop(time + decay + 0.05);
      });

      f.connect(master);
      master.connect(destination);
      break;
    }

    case "tambourine": {
      const decay = 0.14;
      const master = ctx.createGain();
      master.gain.setValueAtTime(velocity * 0.7, time);
      master.gain.exponentialRampToValueAtTime(0.001, time + decay);

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(9500, time);
      filter.Q.setValueAtTime(5.0, time);

      const bufLen = Math.floor(ctx.sampleRate * decay);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(filter);
      filter.connect(master);
      master.connect(destination);
      src.start(time);
      break;
    }
  }
}
