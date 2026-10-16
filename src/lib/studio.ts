/**
 * Practice player: independent speed and pitch control, per-stem mixing,
 * a beat-locked metronome with count-in, and A/B section looping.
 * Everything runs in the browser on top of Web Audio + SoundTouch.
 */

export const STEMS = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEMS)[number];
export type TrackName = "full" | StemName;

export const STEM_LABELS: Record<TrackName, string> = {
  full: "Original",
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

interface Track {
  buffer: AudioBuffer;
  gain: GainNode;
  shifter: { tempo: number; pitchSemitones: number; percentagePlayed: number;
    connect: (n: AudioNode) => void; disconnect: () => void } | null;
  volume: number;
  muted: boolean;
}

type Tick = (position: number) => void;

export class StudioPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private tracks = new Map<TrackName, Track>();
  private PitchShifter: unknown = null;
  private raf = 0;
  private schedTimer = 0;
  private startCtxTime = 0;
  private startPos = 0;
  private beatIdx = 0;

  duration = 0;
  position = 0;
  playing = false;
  tempo = 1;
  semitones = 0;
  loop: { start: number; end: number } | null = null;
  metronome = false;
  countIn = false;
  beats: number[] = [];
  beatsPerBar = 4;
  onTick: Tick | null = null;

  /**
   * Initialises the Web Audio context (falling back to the webkit-prefixed
   * variant for older Safari) and creates the master gain node that all
   * loaded tracks route through.
   */
  constructor() {
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  /** Returns the names of all currently loaded tracks. */
  get stems(): TrackName[] {
    return [...this.tracks.keys()];
  }

  /**
   * Decodes and loads an audio blob for the named track, replacing any
   * previously loaded buffer.  Updates the master duration if the new buffer
   * is longer than all currently loaded tracks.
   *
   * @param name - Track slot to load into (`"full"`, `"vocals"`, etc.).
   * @param blob - Raw audio blob to decode via the Web Audio API.
   */
  async load(name: TrackName, blob: Blob) {
    const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    const existing = this.tracks.get(name);
    existing?.shifter?.disconnect();
    this.tracks.set(name, {
      buffer,
      gain,
      shifter: null,
      volume: existing?.volume ?? 1,
      muted: existing?.muted ?? false,
    });
    this.duration = Math.max(this.duration, buffer.duration);
    this.applyMix();
  }

  /** Only these tracks are audible; the rest are silenced. */
  /**
   * Sets which tracks are audible.  All tracks not in `names` are silenced
   * (their gain is set to 0 without stopping playback).
   *
   * @param names - Array of track names that should be heard.
   */
  setActive(names: TrackName[]) {
    for (const [name, t] of this.tracks) t.muted = !names.includes(name);
    this.applyMix();
  }

  /**
   * Sets the volume (0–1) for a specific track without affecting others.
   *
   * @param name   - Track name.
   * @param volume - Linear volume level (0 = silent, 1 = full).
   */
  setVolume(name: TrackName, volume: number) {
    const t = this.tracks.get(name);
    if (!t) return;
    t.volume = volume;
    this.applyMix();
  }

  /**
   * Mutes or unmutes a specific track without changing its volume setting.
   *
   * @param name  - Track name.
   * @param muted - `true` to silence the track, `false` to restore it.
   */
  setMuted(name: TrackName, muted: boolean) {
    const t = this.tracks.get(name);
    if (!t) return;
    t.muted = muted;
    this.applyMix();
  }

  /**
   * Returns whether a track is currently muted.
   *
   * @param name - Track name to query.
   * @returns `true` if the track is muted.
   */
  isMuted(name: TrackName) {
    return this.tracks.get(name)?.muted ?? false;
  }

  /**
   * Returns the current volume setting for a track (0–1).  Defaults to 1 when
   * the track has not been loaded yet.
   *
   * @param name - Track name to query.
   */
  volumeOf(name: TrackName) {
    return this.tracks.get(name)?.volume ?? 1;
  }

  /**
   * Applies the current mute/volume settings to all loaded track gain nodes.
   * Called internally whenever the mix state changes.
   */
  private applyMix() {
    for (const t of this.tracks.values()) {
      t.gain.gain.value = t.muted ? 0 : t.volume;
    }
  }

  /**
   * Changes playback speed.  If already playing, the playback position is
   * rebased (so the displayed time stays correct) and the SoundTouch tempo is
   * updated in real time without restarting the audio.
   *
   * @param tempo - Speed multiplier (e.g. 0.75 = 75 %, 1 = normal, 1.25 = 125 %).
   */
  setTempo(tempo: number) {
    this.tempo = tempo;
    if (this.playing) {
      this.rebase();
      for (const t of this.tracks.values()) if (t.shifter) t.shifter.tempo = tempo;
    }
  }

  /**
   * Shifts playback pitch without changing speed.  Updates the SoundTouch
   * pitch-shifter in real time when the player is already running.
   *
   * @param semitones - Number of semitones to shift (negative = lower pitch).
   */
  setPitch(semitones: number) {
    this.semitones = semitones;
    if (this.playing) {
      for (const t of this.tracks.values()) if (t.shifter) t.shifter.pitchSemitones = semitones;
    }
  }

  /**
   * Updates the internal playback-position reference so that tempo or seek
   * changes do not cause a jump in the displayed position.  Must be called
   * before any tempo change while the player is running.
   */
  private rebase() {
    this.position = this.currentPosition();
    this.startPos = this.position;
    this.startCtxTime = this.ctx.currentTime;
    this.beatIdx = this.beats.findIndex((b) => b > this.position);
    if (this.beatIdx < 0) this.beatIdx = this.beats.length;
  }

  /**
   * Computes the real playback position in seconds by multiplying the elapsed
   * Web Audio clock time by the current tempo ratio and clamping to the track
   * duration.
   *
   * @returns Current playback position in seconds.
   */
  private currentPosition() {
    if (!this.playing) return this.position;
    const elapsed = (this.ctx.currentTime - this.startCtxTime) * this.tempo;
    return Math.max(this.startPos, Math.min(this.duration, this.startPos + elapsed));
  }

  /**
   * Starts playback from the current position, creating a SoundTouch pitch/tempo
   * shifter for every loaded track.  Plays an optional metronome count-in before
   * the audio begins.  Does nothing when already playing or when no tracks are
   * loaded.
   */
  async play() {
    if (this.playing || this.tracks.size === 0) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.PitchShifter) {
      this.PitchShifter = (await import("soundtouchjs")).PitchShifter;
    }
    const Shifter = this.PitchShifter as new (
      ctx: BaseAudioContext,
      buffer: AudioBuffer,
      size: number,
    ) => Track["shifter"];

    const beatLen = this.beats.length > 1 ? (this.beats[1]! - this.beats[0]!) || 0.5 : 0.5;
    const lead = this.countIn && this.metronome ? (this.beatsPerBar * beatLen) / this.tempo : 0;

    this.playing = true;
    this.startPos = this.position;
    this.startCtxTime = this.ctx.currentTime + lead;
    this.beatIdx = Math.max(
      0,
      this.beats.findIndex((b) => b > this.position),
    );

    if (lead > 0) {
      for (let i = 0; i < this.beatsPerBar; i++) {
        this.click(this.ctx.currentTime + (i * beatLen) / this.tempo, i === 0);
      }
    }

    const start = () => {
      if (!this.playing) return;
      for (const t of this.tracks.values()) {
        const shifter = new Shifter(this.ctx, t.buffer, 4096);
        if (!shifter) continue;
        shifter.tempo = this.tempo;
        shifter.pitchSemitones = this.semitones;
        shifter.percentagePlayed = this.duration ? this.position / this.duration : 0;
        shifter.connect(t.gain);
        t.shifter = shifter;
      }
    };
    if (lead > 0) window.setTimeout(start, lead * 1000);
    else start();

    this.schedTimer = window.setInterval(() => this.schedule(), 25);
    const tick = () => {
      if (!this.playing) return;
      this.position = this.currentPosition();
      if (this.loop && this.position >= this.loop.end) {
        this.seek(this.loop.start);
      } else if (this.position >= this.duration - 0.05) {
        this.pause();
        this.position = this.duration;
      }
      this.onTick?.(this.position);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Pauses playback, captures the current position, disconnects all SoundTouch
   * nodes, and stops the metronome scheduler.  Does nothing when not playing.
   */
  pause() {
    if (!this.playing) return;
    this.position = this.currentPosition();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.schedTimer);
    for (const t of this.tracks.values()) {
      t.shifter?.disconnect();
      t.shifter = null;
    }
    this.onTick?.(this.position);
  }

  /**
   * Seeks to a specific position in the track.  When playing, immediately
   * repositions all SoundTouch shifters to the new percentage without
   * restarting the audio.
   *
   * @param time - Target position in seconds (clamped to 0‮duration).
   */
  seek(time: number) {
    const target = Math.max(0, Math.min(this.duration, time));
    if (!this.playing) {
      this.position = target;
      this.onTick?.(target);
      return;
    }
    this.position = target;
    this.startPos = target;
    this.startCtxTime = this.ctx.currentTime;
    this.beatIdx = Math.max(
      0,
      this.beats.findIndex((b) => b > target),
    );
    for (const t of this.tracks.values()) {
      if (!t.shifter) continue;
      t.shifter.percentagePlayed = this.duration ? target / this.duration : 0;
    }
    this.onTick?.(target);
  }

  /** Schedules metronome clicks a short way ahead of the audio clock. */
  /**
   * Schedules metronome click oscillators a short horizon ahead of the current
   * audio-clock position.  Called on a 25 ms interval while playing to keep
   * the click track aligned with the beat grid.
   */
  private schedule() {
    if (!this.metronome || !this.playing) return;
    const horizon = this.currentPosition() + 0.3 * this.tempo;
    while (this.beatIdx < this.beats.length && this.beats[this.beatIdx]! <= horizon) {
      const beat = this.beats[this.beatIdx]!;
      const when = this.startCtxTime + (beat - this.startPos) / this.tempo;
      if (when > this.ctx.currentTime) this.click(when, this.beatIdx % this.beatsPerBar === 0);
      this.beatIdx++;
    }
  }

  /**
   * Creates a short oscillator burst to produce a single metronome click.
   * Accented beats (downbeats) are higher-pitched and louder.
   *
   * @param when   - Web Audio clock time at which the click should sound.
   * @param accent - `true` for a louder, higher-pitched downbeat click.
   */
  private click(when: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.28, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + 0.07);
  }

  /**
   * Stops playback and closes the Web Audio context, releasing all associated
   * resources.  The player cannot be used after `destroy()` is called.
   */
  destroy() {
    this.pause();
    void this.ctx.close();
  }
}
