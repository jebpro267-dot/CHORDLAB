from __future__ import annotations

import hashlib
import json
import math
import os
import random
import shutil
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_RATE = 22050
HOP_LENGTH = 512
N_FFT = 4096
WINDOW_FRAMES = 64

PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
QUALITIES = ("", "m", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")

PITCH_CLASSES = {
    "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "C##": 2,
    "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "F": 5, "E#": 5,
    "F#": 6, "Gb": 6, "G": 7, "F##": 7, "G#": 8, "Ab": 8,
    "A": 9, "G##": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}

GUITARSET_URLS = {
    "annotation.zip": (
        "https://zenodo.org/api/records/3371780/files/annotation.zip/content",
        "b39b78e63d3446f2e54ddb7a54df9b10",
    ),
}

# Western / English Chord Progression Templates
ENGLISH_PROGRESSIONS = [
    # Classic Diatonic Pop / Rock
    [("C", 2.0), ("G", 2.0), ("Am", 2.0), ("F", 2.0)],
    [("Am", 2.0), ("F", 2.0), ("C", 2.0), ("G", 2.0)],
    [("C", 2.0), ("Am", 2.0), ("F", 2.0), ("G", 2.0)],
    [("G", 2.0), ("D", 2.0), ("Em", 2.0), ("C", 2.0)],
    [("D", 2.0), ("A", 2.0), ("Bm", 2.0), ("G", 2.0)],
    # Jazz / ii-V-I & Extensions
    [("Dm7", 2.0), ("G7", 2.0), ("Cmaj7", 4.0)],
    [("Cm7", 2.0), ("F7", 2.0), ("Bbmaj7", 4.0)],
    [("Em7", 2.0), ("A7", 2.0), ("Dmaj7", 4.0)],
    # Blues / Rock 'n' Roll
    [("E7", 4.0), ("A7", 2.0), ("E7", 2.0), ("B7", 1.0), ("A7", 1.0), ("E7", 2.0)],
    [("A7", 4.0), ("D7", 2.0), ("A7", 2.0), ("E7", 1.0), ("D7", 1.0), ("A7", 2.0)],
    # Acoustic Folk / Ballad
    [("C", 2.0), ("Em", 2.0), ("F", 2.0), ("G", 2.0)],
    [("D", 2.0), ("F#m", 2.0), ("G", 2.0), ("A", 2.0)],
    [("Am", 2.0), ("Em", 2.0), ("F", 2.0), ("C", 2.0)],
]

# Hindi / Bollywood / Hindustani Chord Progression Templates
HINDI_PROGRESSIONS = [
    # Raag Yaman (Lydian / Kalyani adapted - #4, Major/Minor modal shifts)
    [("C", 2.0), ("D", 2.0), ("Em", 2.0), ("C", 2.0)],
    [("G", 2.0), ("A", 2.0), ("Bm", 2.0), ("G", 2.0)],
    [("C", 2.0), ("Gsus4", 1.0), ("G", 1.0), ("Am", 2.0), ("F", 2.0)],
    # Raag Bhairavi (Phrygian / Minor tonic, bII, bVII, bVI)
    [("Am", 2.0), ("G", 2.0), ("F", 2.0), ("E", 2.0)],
    [("Dm", 2.0), ("C", 2.0), ("Bb", 2.0), ("A", 2.0)],
    [("Em", 2.0), ("F", 2.0), ("Dm", 2.0), ("Em", 2.0)],
    # Raag Kafi (Dorian - Minor tonic with major IV)
    [("Dm", 2.0), ("G", 2.0), ("Dm", 2.0), ("C", 2.0)],
    [("Am", 2.0), ("D", 2.0), ("Am", 2.0), ("G", 2.0)],
    # Classic Bollywood Ballad / Ghazal (Minor 9th, Harmonic Minor, V7)
    [("Am", 2.0), ("Dm", 2.0), ("E7", 2.0), ("Am", 2.0)],
    [("Dm", 2.0), ("Gm", 2.0), ("A7", 2.0), ("Dm", 2.0)],
    [("Cm", 2.0), ("Fm", 2.0), ("G7", 2.0), ("Cm", 2.0)],
    # Modern Bollywood Anthem (Arijit / Pritam / Rahman style)
    [("Em", 2.0), ("C", 2.0), ("D", 2.0), ("Bm", 2.0)],
    [("Em", 2.0), ("D", 2.0), ("C", 2.0), ("D", 2.0)],
    [("Am", 2.0), ("Fmaj7", 2.0), ("G", 2.0), ("Em7", 2.0)],
    [("C", 2.0), ("Am", 2.0), ("F", 2.0), ("G", 2.0), ("Em", 2.0), ("F", 2.0)],
    [("Dm", 2.0), ("C", 2.0), ("Dm", 2.0), ("Bb", 1.0), ("C", 1.0)],
]

# Tamil / Kollywood / Carnatic Chord Progression Templates
TAMIL_PROGRESSIONS = [
    # Ilaiyaraaja Signature Keeravani (Harmonic Minor harmonic richness)
    [("Am", 2.0), ("Dm", 2.0), ("E", 2.0), ("F", 1.0), ("G", 1.0)],
    [("Dm", 2.0), ("Gm", 2.0), ("A", 2.0), ("Bb", 1.0), ("C", 1.0)],
    [("Cm", 2.0), ("Fm", 2.0), ("G", 2.0), ("Ab", 1.0), ("Bb", 1.0)],
    # Ilaiyaraaja Chromatic Third Mediant Shifts (C -> Eb, Am -> F#m, C -> Ab)
    [("C", 2.0), ("Eb", 2.0), ("F", 2.0), ("G", 2.0)],
    [("Am", 2.0), ("F#m", 2.0), ("F", 2.0), ("E", 2.0)],
    [("C", 2.0), ("Ab", 2.0), ("Bb", 2.0), ("C", 2.0)],
    # Raag Natabhairavi (Natural minor with prominent modal degrees)
    [("Am", 2.0), ("F", 2.0), ("Dm", 2.0), ("G", 2.0)],
    [("Dm", 2.0), ("Bb", 2.0), ("Gm", 2.0), ("C", 2.0)],
    # A.R. Rahman Masterpiece Progressions (Roja, Bombay, Alaipayuthey)
    [("Dm", 2.0), ("Bbmaj7", 2.0), ("C", 2.0), ("Am7", 2.0)],
    [("Dm", 2.0), ("C", 2.0), ("Bb", 2.0), ("Asus4", 1.0), ("A", 1.0)],
    [("Gm", 2.0), ("Eb", 2.0), ("F", 2.0), ("Bb", 1.0), ("Cm", 1.0), ("D7", 2.0)],
    [("C", 2.0), ("F", 2.0), ("G", 2.0), ("C", 2.0)],
    # Raag Charukesi (Major 3rd, Minor 6th modal mix)
    [("C", 2.0), ("Dm", 2.0), ("Fm", 2.0), ("C", 2.0)],
    [("F", 2.0), ("Gm", 2.0), ("Bbm", 2.0), ("F", 2.0)],
    # Raag Mayamalavagowla (Bhairav equivalent)
    [("C", 2.0), ("Db", 2.0), ("Fm", 2.0), ("C", 2.0)],
    # Modern Tamil / Anirudh / Harris Jayaraj
    [("Dm", 2.0), ("C", 2.0), ("Bb", 2.0), ("Am", 2.0)],
    [("Em", 2.0), ("C", 2.0), ("G", 2.0), ("D", 2.0)],
    [("C", 2.0), ("Am", 2.0), ("F", 2.0), ("G", 2.0)],
]


def _md5(path: Path) -> str:
    """Calculate MD5 checksum of a file."""
    digest = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(url: str, target: Path, expected_md5: str | None = None) -> None:
    """Download a remote file with progress reporting and optional MD5 verification."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and (expected_md5 is None or _md5(target) == expected_md5):
        print(f"Already downloaded: {target.name}")
        return
    partial = target.with_suffix(target.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "ChordLab/1.0"})
    print(f"Downloading {target.name} from {url}...")
    with urllib.request.urlopen(req, timeout=90) as response, partial.open("wb") as out:
        total = int(response.headers.get("Content-Length", 0))
        received = 0
        while chunk := response.read(1024 * 512):
            out.write(chunk)
            received += len(chunk)
            if total:
                print(f"\r  {received * 100 // total}% ({received // 1024**2} MB / {total // 1024**2} MB)", end="", flush=True)
    print()
    if expected_md5 and _md5(partial) != expected_md5:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"MD5 mismatch for {target.name}")
    partial.replace(target)
    print(f"Verified & saved {target.name}")


def safe_extract_zip(archive_path: Path, destination: Path) -> None:
    """Safely extract a zip file preventing path traversal attacks."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            rel = PurePosixPath(member.filename)
            if rel.is_absolute() or ".." in rel.parts:
                continue
            target = (destination / Path(*rel.parts)).resolve()
            if root not in target.parents and target != root:
                continue
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def parse_chord_symbol(symbol: str) -> tuple[int, str]:
    """Parse a chord symbol like 'Am7', 'C#', 'Gsus4', 'Bb' into root pitch class and quality."""
    token = symbol.strip().split("/")[0]
    if token.upper() in {"N", "X", "NC", ""}:
        return 0, ""
    match = ""
    for name in sorted(PITCH_CLASSES.keys(), key=len, reverse=True):
        if token.startswith(name):
            match = name
            break
    if not match:
        return 0, ""
    root = PITCH_CLASSES[match]
    quality = token[len(match):]
    if quality in {"min", "m"}:
        quality = "m"
    elif quality in {"major", "maj"}:
        quality = ""
    elif quality in {"min7", "m7"}:
        quality = "m7"
    elif quality in {"maj7"}:
        quality = "maj7"
    elif quality in {"7", "dom7"}:
        quality = "7"
    elif quality in {"dim", "diminished"}:
        quality = "dim"
    elif quality in {"aug", "augmented"}:
        quality = "aug"
    elif quality in {"sus2"}:
        quality = "sus2"
    elif quality in {"sus4", "sus"}:
        quality = "sus4"
    else:
        quality = ""
    return root, quality


def get_chord_notes(root: int, quality: str) -> list[int]:
    """Get the MIDI pitch classes for a given root and quality."""
    intervals_map = {
        "": [0, 4, 7],
        "m": [0, 3, 7],
        "7": [0, 4, 7, 10],
        "maj7": [0, 4, 7, 11],
        "m7": [0, 3, 7, 10],
        "dim": [0, 3, 6],
        "aug": [0, 4, 8],
        "sus2": [0, 2, 7],
        "sus4": [0, 5, 7],
    }
    intervals = intervals_map.get(quality, [0, 4, 7])
    return [(root + iv) % 12 for iv in intervals]


def synthesize_chord_audio(chord_events: list[tuple[str, float]], sample_rate: int = SAMPLE_RATE, timbre: str = "acoustic") -> tuple[Any, list[dict]]:
    """Synthesize high-fidelity audio waveform with harmonic overtones, bass foundation, and envelopes.
    
    Timbre options: 'acoustic' (guitar/folk), 'piano' (balanced keys), 'indian_drone' (harmonium/tanpura/sitar harmonic rich), 'carnatic' (veena/violin/strings).
    """
    import numpy as np

    total_duration = sum(dur for _, dur in chord_events)
    total_samples = int(total_duration * sample_rate)
    waveform = np.zeros(total_samples, dtype=np.float32)

    current_sample = 0
    ground_truth = []
    current_time = 0.0

    for chord_name, duration in chord_events:
        seg_samples = int(duration * sample_rate)
        if seg_samples <= 0:
            continue
        seg_time = np.linspace(0, duration, seg_samples, endpoint=False, dtype=np.float32)
        root, quality = parse_chord_symbol(chord_name)
        chord_chroma = get_chord_notes(root, quality) if chord_name != "N" else []

        seg_audio = np.zeros(seg_samples, dtype=np.float32)

        if chord_name != "N":
            # Bass fundamental in octave 2 (MIDI 36 - 47)
            bass_midi = 36 + root
            bass_freq = 440.0 * (2.0 ** ((bass_midi - 69) / 12.0))
            seg_audio += 0.45 * np.sin(2 * np.pi * bass_freq * seg_time)
            seg_audio += 0.25 * np.sin(2 * np.pi * (bass_freq * 2) * seg_time)
            seg_audio += 0.12 * np.sin(2 * np.pi * (bass_freq * 3) * seg_time)

            # Chord voices in octave 3 & 4
            for octave in (3, 4):
                for pc in chord_chroma:
                    midi_note = 12 * (octave + 1) + pc
                    freq = 440.0 * (2.0 ** ((midi_note - 69) / 12.0))
                    # Strum micro-delay
                    phase_offset = (pc * 0.015) % 0.05
                    t_shifted = np.maximum(0.0, seg_time - phase_offset)
                    
                    if timbre == "acoustic":
                        # Fast attack, natural exponential decay + harmonics
                        env = np.exp(-1.8 * t_shifted) * (1.0 - np.exp(-100 * t_shifted))
                        seg_audio += 0.22 * env * np.sin(2 * np.pi * freq * t_shifted)
                        seg_audio += 0.11 * env * np.sin(2 * np.pi * (freq * 2) * t_shifted)
                        seg_audio += 0.05 * env * np.sin(2 * np.pi * (freq * 3) * t_shifted)
                    elif timbre in ("indian_drone", "carnatic"):
                        # Rich sustained harmonics + slight vibrato/gamaka
                        vibrato = 0.008 * np.sin(2 * np.pi * 5.5 * seg_time)
                        env = np.ones_like(seg_time)
                        attack_s = int(0.06 * sample_rate)
                        release_s = int(0.08 * sample_rate)
                        if seg_samples > attack_s + release_s:
                            env[:attack_s] = np.linspace(0, 1, attack_s)
                            env[-release_s:] = np.linspace(1, 0, release_s)
                        seg_audio += 0.25 * env * np.sin(2 * np.pi * freq * (1 + vibrato) * seg_time)
                        seg_audio += 0.15 * env * np.sin(2 * np.pi * (freq * 2) * (1 + vibrato) * seg_time)
                        seg_audio += 0.08 * env * np.sin(2 * np.pi * (freq * 3) * seg_time)
                        seg_audio += 0.04 * env * np.sin(2 * np.pi * (freq * 4) * seg_time)
                    else:  # piano
                        env = np.exp(-1.2 * t_shifted) * (1.0 - np.exp(-80 * t_shifted))
                        seg_audio += 0.25 * env * np.sin(2 * np.pi * freq * t_shifted)
                        seg_audio += 0.10 * env * np.sin(2 * np.pi * (freq * 2) * t_shifted)

        # Subtle acoustic room noise floor
        seg_audio += 0.002 * (np.random.rand(seg_samples).astype(np.float32) - 0.5)

        end_idx = min(total_samples, current_sample + seg_samples)
        waveform[current_sample:end_idx] += seg_audio[: end_idx - current_sample]

        ground_truth.append({
            "start": round(current_time, 3),
            "end": round(current_time + duration, 3),
            "chord": chord_name,
            "root": root,
            "quality": quality,
        })
        current_sample += seg_samples
        current_time += duration

    # Normalize waveform
    max_amp = np.max(np.abs(waveform)) + 1e-9
    if max_amp > 0:
        waveform = (waveform / max_amp) * 0.92

    return waveform, ground_truth


def save_audio_file(path: Path, samples: Any, sample_rate: int = SAMPLE_RATE) -> None:
    """Save float32 samples to 16-bit PCM WAV."""
    import soundfile as sf
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), samples, sample_rate, subtype="PCM_16")


def build_and_save_dataset(
    output_dir: Path,
    language: str,
    progressions: list[list[tuple[str, float]]],
    num_tracks: int = 40,
) -> int:
    """Build a comprehensive dataset with audio recordings and chord ground-truth annotations."""
    import soundfile as sf

    output_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = output_dir / "audio"
    annot_dir = output_dir / "annotations"
    audio_dir.mkdir(parents=True, exist_ok=True)
    annot_dir.mkdir(parents=True, exist_ok=True)

    timbre = "carnatic" if language == "tamil" else ("indian_drone" if language == "hindi" else "acoustic")
    created_count = 0

    print(f"Building {language.capitalize()} chord dataset ({num_tracks} tracks)...")

    # Cycle through progressions with key transpositions and tempo variations
    for idx in range(num_tracks):
        base_prog = progressions[idx % len(progressions)]
        semitone_shift = (idx * 5) % 12  # Circle of fifths transpositions
        tempo_factor = 0.85 + 0.35 * ((idx * 7) % 10) / 10.0  # 0.85x to 1.20x duration

        transposed_events: list[tuple[str, float]] = []
        for chord_name, dur in base_prog:
            scaled_dur = round(dur / tempo_factor, 2)
            if chord_name == "N":
                transposed_events.append(("N", scaled_dur))
                continue
            r, q = parse_chord_symbol(chord_name)
            shifted_root = (r + semitone_shift) % 12
            new_name = PITCH_NAMES[shifted_root] + q
            transposed_events.append((new_name, scaled_dur))

        # Repeat progression 2 or 3 times to make a complete song track
        repeats = 3 if len(transposed_events) <= 4 else 2
        full_events = transposed_events * repeats

        waveform, gt = synthesize_chord_audio(full_events, sample_rate=SAMPLE_RATE, timbre=timbre)

        track_id = f"{language}_track_{idx+1:03d}"
        wav_path = audio_dir / f"{track_id}.wav"
        json_path = annot_dir / f"{track_id}.json"

        save_audio_file(wav_path, waveform, SAMPLE_RATE)
        json_path.write_text(json.dumps({
            "track_id": track_id,
            "language": language,
            "duration": gt[-1]["end"] if gt else 0.0,
            "events": gt,
        }, indent=2), encoding="utf-8")

        created_count += 1
        if (idx + 1) % 10 == 0 or idx == num_tracks - 1:
            print(f"  [{language}] Created {idx+1}/{num_tracks} tracks")

    return created_count


INSTRUMENT_NAMES = (
    "vocals",
    "piano",
    "drums",
    "bass_guitar",
    "acoustic_guitar",
    "electric_guitar",
    "flute",
    "violin",
    "ukulele",
)


def generate_stem_datasets(output_dir: Path, num_stems_each: int = 30) -> dict[str, int]:
    """Generate high-fidelity acoustic training audio for 9 instrument stems:
    Vocals, Piano, Drums, Bass Guitar, Acoustic Guitar, Electric Guitar, Flute, Violin, and Ukulele.
    """
    import numpy as np

    output_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}

    for stem_name in INSTRUMENT_NAMES:
        stem_dir = output_dir / stem_name
        stem_dir.mkdir(parents=True, exist_ok=True)
        counts[stem_name] = 0

        for i in range(num_stems_each):
            dur = 6.0  # 6 second audio clips
            num_samples = int(dur * SAMPLE_RATE)
            t = np.linspace(0, dur, num_samples, endpoint=False, dtype=np.float32)
            audio = np.zeros(num_samples, dtype=np.float32)

            if stem_name == "vocals":
                # Resonant human singing voice with vowel formants (F1, F2, F3), vibrato, and breathiness
                notes = [220.0, 261.6, 293.7, 329.6, 392.0, 440.0, 523.25]
                step = int(0.75 * SAMPLE_RATE)
                for seg_idx, b in enumerate(range(0, num_samples, step)):
                    f0 = notes[(seg_idx + i) % len(notes)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    vibrato = 0.018 * np.sin(2 * np.pi * 5.6 * st)
                    env = np.sin(np.pi * np.linspace(0, 1, seg_len)) ** 0.8
                    voice = np.sin(2 * np.pi * f0 * (1 + vibrato) * st)
                    # Formants (F1: 650 Hz, F2: 1700 Hz, F3: 2800 Hz)
                    voice += 0.45 * np.sin(2 * np.pi * (f0 * round(650.0 / f0)) * st)
                    voice += 0.30 * np.sin(2 * np.pi * (f0 * round(1700.0 / f0)) * st)
                    voice += 0.15 * np.sin(2 * np.pi * (f0 * round(2800.0 / f0)) * st)
                    # Vocal breath turbulence
                    noise = (np.random.rand(seg_len).astype(np.float32) - 0.5) * 0.04
                    audio[b : b + seg_len] += (voice + noise) * env

            elif stem_name == "piano":
                # Grand piano: hammer attack strike + inharmonic partials + multi-stage decay
                chords = [
                    [261.63, 329.63, 392.0],        # C
                    [293.66, 349.23, 440.0],        # Dm
                    [329.63, 392.0, 493.88],        # Em
                    [349.23, 440.0, 523.25],        # F
                    [392.0, 493.88, 587.33],        # G
                    [440.0, 523.25, 659.25],        # Am
                ]
                chord = chords[(i + 1) % len(chords)]
                note_dur = int(1.5 * SAMPLE_RATE)
                for c_idx, b in enumerate(range(0, num_samples, note_dur)):
                    cur_chord = chords[(c_idx + i) % len(chords)]
                    seg_len = min(note_dur, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    p_sig = np.zeros(seg_len, dtype=np.float32)
                    for f in cur_chord:
                        # Hammer attack + soundboard decay
                        env = np.exp(-1.4 * st) * (1.0 - np.exp(-120 * st))
                        # Inharmonic piano partials: fn = n * f0 * sqrt(1 + B * n^2)
                        for h in range(1, 7):
                            fn = f * h * np.sqrt(1 + 0.0003 * (h ** 2))
                            p_sig += (1.0 / (h ** 1.3)) * np.sin(2 * np.pi * fn * st) * env
                    audio[b : b + seg_len] += p_sig * 0.35

            elif stem_name == "drums":
                # Complete drum kit: sub kick drop (150->45 Hz) + snare body & burst + hi-hat metallic sizzle
                beat_period = int(0.5 * SAMPLE_RATE)  # 120 BPM
                for b in range(0, num_samples, beat_period):
                    b_num = b // beat_period
                    if b_num % 2 == 0:
                        # Kick drum on 1 and 3
                        k_len = min(int(0.20 * SAMPLE_RATE), num_samples - b)
                        kt = np.linspace(0, 0.20, k_len, endpoint=False)
                        k_freq = 145.0 * np.exp(-28.0 * kt) + 42.0
                        audio[b : b + k_len] += 0.85 * np.sin(2 * np.pi * k_freq * kt) * np.exp(-14.0 * kt)
                    else:
                        # Snare on 2 and 4
                        s_len = min(int(0.24 * SAMPLE_RATE), num_samples - b)
                        st = np.linspace(0, 0.24, s_len, endpoint=False)
                        snare_tone = np.sin(2 * np.pi * 185.0 * st) * np.exp(-20.0 * st)
                        snare_noise = (np.random.rand(s_len).astype(np.float32) - 0.5) * np.exp(-15.0 * st)
                        audio[b : b + s_len] += 0.45 * snare_tone + 0.65 * snare_noise

                    # 16th-note closed hi-hat metallic chits
                    for hat_sub in [0, int(0.25 * beat_period)]:
                        hb = b + hat_sub
                        if hb < num_samples:
                            h_len = min(int(0.05 * SAMPLE_RATE), num_samples - hb)
                            ht = np.linspace(0, 0.05, h_len, endpoint=False)
                            metallic = (np.sin(2 * np.pi * 8400.0 * ht) + np.sin(2 * np.pi * 10200.0 * ht)) * (np.random.rand(h_len).astype(np.float32) - 0.5)
                            audio[hb : hb + h_len] += 0.35 * metallic * np.exp(-55.0 * ht)

            elif stem_name == "bass_guitar":
                # Electric/acoustic bass: fundamental in 41.2–196 Hz (E1–G3), punchy plucking transient, warm sustain
                bass_notes = [41.2, 49.0, 55.0, 65.4, 73.4, 82.4, 98.0, 110.0, 123.4, 130.8]
                step = int(0.75 * SAMPLE_RATE)
                for seg_idx, b in enumerate(range(0, num_samples, step)):
                    freq = bass_notes[(seg_idx + i) % len(bass_notes)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    env = np.exp(-1.1 * st) * (1.0 - np.exp(-200 * st))
                    b_sig = 0.80 * np.sin(2 * np.pi * freq * st)
                    b_sig += 0.45 * np.sin(2 * np.pi * (freq * 2) * st)
                    b_sig += 0.20 * np.sin(2 * np.pi * (freq * 3) * st)
                    # Pluck attack click
                    click = 0.3 * (np.random.rand(seg_len).astype(np.float32) - 0.5) * np.exp(-80.0 * st)
                    audio[b : b + seg_len] += (b_sig + click) * env

            elif stem_name == "acoustic_guitar":
                # Strummed steel/nylon acoustic guitar: hollow body resonance (105 Hz, 220 Hz) + multi-string strum timing
                guitar_chords = [
                    [82.4, 123.4, 164.8, 196.0, 246.9, 329.6],  # Em
                    [110.0, 164.8, 220.0, 261.6, 329.6],        # Am
                    [130.8, 164.8, 196.0, 261.6, 329.6],        # C
                    [98.0, 123.4, 146.8, 196.0, 246.9, 392.0],  # G
                    [146.8, 220.0, 293.7, 370.0],               # D
                ]
                strum_period = int(1.0 * SAMPLE_RATE)
                for s_idx, b in enumerate(range(0, num_samples, strum_period)):
                    g_chord = guitar_chords[(s_idx + i) % len(guitar_chords)]
                    seg_len = min(strum_period, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    g_sig = np.zeros(seg_len, dtype=np.float32)
                    for str_idx, freq in enumerate(g_chord):
                        str_delay = int(str_idx * 0.015 * SAMPLE_RATE)
                        if str_delay < seg_len:
                            eff_len = seg_len - str_delay
                            est = np.linspace(0, eff_len / SAMPLE_RATE, eff_len, endpoint=False)
                            env = np.exp(-1.8 * est) * (1.0 - np.exp(-100 * est))
                            pluck = np.sin(2 * np.pi * freq * est) + 0.35 * np.sin(2 * np.pi * (freq * 2) * est)
                            # Body resonance
                            body = 0.25 * np.sin(2 * np.pi * 105.0 * est) * env
                            g_sig[str_delay:] += (pluck + body) * env * 0.25
                    audio[b : b + seg_len] += g_sig

            elif stem_name == "electric_guitar":
                # Overdriven rock electric guitar: power chords (root + 5th + 8ve) + tanh clipping distortion + cabinet filter
                power_roots = [82.4, 98.0, 110.0, 130.8, 146.8, 164.8]
                step = int(1.2 * SAMPLE_RATE)
                for p_idx, b in enumerate(range(0, num_samples, step)):
                    rf = power_roots[(p_idx + i) % len(power_roots)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    env = np.exp(-0.7 * st) * (1.0 - np.exp(-150 * st))
                    raw = np.sin(2 * np.pi * rf * st) + 0.8 * np.sin(2 * np.pi * (rf * 1.5) * st) + 0.6 * np.sin(2 * np.pi * (rf * 2.0) * st)
                    # Non-linear amplifier distortion (soft clipping)
                    distorted = np.tanh(3.5 * raw) * env
                    audio[b : b + seg_len] += distorted * 0.75

            elif stem_name == "flute":
                # Breathy transverse flute: pure sinusoidal tone (523 Hz – 1760 Hz) + subtle 2nd harmonic + airy wind turbulence
                flute_notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 1046.5]
                step = int(0.75 * SAMPLE_RATE)
                for seg_idx, b in enumerate(range(0, num_samples, step)):
                    ff = flute_notes[(seg_idx + i) % len(flute_notes)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    vibrato = 0.012 * np.sin(2 * np.pi * 5.2 * st)
                    env = np.sin(np.pi * np.linspace(0, 1, seg_len)) ** 0.6
                    # Pure fundamental pipe resonance
                    tone = np.sin(2 * np.pi * ff * (1 + vibrato) * st) + 0.12 * np.sin(2 * np.pi * (ff * 2.0) * st)
                    # Breath turbulence chiff noise
                    chiff = (np.random.rand(seg_len).astype(np.float32) - 0.5) * 0.08 * (1.0 - np.exp(-60 * st))
                    audio[b : b + seg_len] += (tone + chiff) * env * 0.70

            elif stem_name == "violin":
                # Bowed orchestral violin: continuous sawtooth-like harmonic series (1/n) + 6 Hz natural vibrato
                violin_notes = [196.0, 246.9, 293.7, 370.0, 440.0, 587.3, 659.3, 880.0]
                step = int(1.0 * SAMPLE_RATE)
                for v_idx, b in enumerate(range(0, num_samples, step)):
                    vf = violin_notes[(v_idx + i) % len(violin_notes)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    vibrato = 0.015 * np.sin(2 * np.pi * 6.0 * st)
                    env = np.sin(np.pi * np.linspace(0, 1, seg_len)) ** 0.7
                    v_tone = np.zeros(seg_len, dtype=np.float32)
                    for h in range(1, 9):
                        v_tone += (1.0 / h) * np.sin(2 * np.pi * (vf * h) * (1 + vibrato) * st)
                    # Body formants (280 Hz and 2500 Hz warmth)
                    v_tone += 0.25 * np.sin(2 * np.pi * 2500.0 * st) * env
                    audio[b : b + seg_len] += v_tone * env * 0.30

            elif stem_name == "ukulele":
                # Hawaiian ukulele: re-entrant tuning (G4, C4, E4, A4), bright twangy chime, fast decay, zero low-bass
                ukulele_chords = [
                    [261.63, 329.63, 392.0, 523.25],  # C
                    [293.66, 392.0, 440.0, 587.33],   # G
                    [261.63, 349.23, 440.0, 523.25],  # F
                    [261.63, 329.63, 440.0, 523.25],  # Am
                ]
                step = int(0.6 * SAMPLE_RATE)
                for u_idx, b in enumerate(range(0, num_samples, step)):
                    u_chord = ukulele_chords[(u_idx + i) % len(ukulele_chords)]
                    seg_len = min(step, num_samples - b)
                    st = np.linspace(0, seg_len / SAMPLE_RATE, seg_len, endpoint=False)
                    u_sig = np.zeros(seg_len, dtype=np.float32)
                    for str_idx, freq in enumerate(u_chord):
                        str_d = int(str_idx * 0.012 * SAMPLE_RATE)
                        if str_d < seg_len:
                            eff_l = seg_len - str_d
                            est = np.linspace(0, eff_l / SAMPLE_RATE, eff_l, endpoint=False)
                            env = np.exp(-3.2 * est) * (1.0 - np.exp(-250 * est))
                            twang = np.sin(2 * np.pi * freq * est) + 0.4 * np.sin(2 * np.pi * (freq * 2) * est)
                            u_sig[str_d:] += twang * env * 0.35
                    audio[b : b + seg_len] += u_sig

            # Peak normalize
            m = np.max(np.abs(audio)) + 1e-9
            audio = (audio / m) * 0.92

            out_path = stem_dir / f"{stem_name}_{i+1:03d}.wav"
            save_audio_file(out_path, audio, SAMPLE_RATE)
            counts[stem_name] += 1

    return counts
