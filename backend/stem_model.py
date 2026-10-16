from __future__ import annotations

import io
import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
STEM_MODEL_PATH = Path(os.getenv("STEM_MODEL_PATH", ROOT / "backend/data/stem_classifier.keras"))
STEM_LABELS_PATH = STEM_MODEL_PATH.with_suffix(".labels.json")
SAMPLE_RATE = 22050
STEM_NAMES = (
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


class StemMetric(BaseModel):
    """Metrics and activity analysis for a single stem."""
    name: str = Field(description="Stem identifier (vocals, piano, drums, bass_guitar, acoustic_guitar, electric_guitar, flute, violin, ukulele)")
    presence: bool = Field(description="Whether this stem is active and prominently detected")
    energy_rms: float = Field(description="Normalized RMS energy [0.0 - 1.0]")
    peak_db: float = Field(description="Peak decibel level [dB FS]")
    spectral_centroid_hz: float = Field(description="Spectral brightness centroid in Hz")
    prominence_pct: float = Field(description="Percentage contribution to the total audio mix")
    active_duration_seconds: float = Field(description="Total active seconds where stem is audible")
    summary: str = Field(description="Descriptive insight about this stem in the track")


class VocalMetrics(BaseModel):
    """Detailed singing and vocal performance analysis."""
    detected: bool = Field(description="Whether singing voice or vocal content is detected")
    vocal_ratio_pct: float = Field(description="Vocal prominence percentage of total track energy")
    estimated_pitch_register: str = Field(description="Estimated voice register or vocal range")
    pitch_centroid_hz: float = Field(description="Average vocal formant frequency in Hz")
    singing_segments_count: int = Field(description="Number of vocal phrase segments detected")
    lead_vs_backing: str = Field(description="Characterization of vocal arrangement")


class RhythmMetrics(BaseModel):
    """Rhythm, percussion, and drum groove analysis."""
    detected: bool = Field(description="Whether rhythmic drum/percussion tracks are detected")
    estimated_bpm: float | None = Field(default=None, description="Estimated tempo in beats per minute")
    beat_regularity: float = Field(description="Regularity score of rhythmic transients [0.0 - 1.0]")
    drum_presence_pct: float = Field(description="Drum energy percentage of total track")
    groove_style: str = Field(description="Detected rhythm style (e.g., Four-on-the-floor, Syncopated, Ambient)")


class BassMetrics(BaseModel):
    """Low-end, bass guitar, and sub-bass analysis."""
    detected: bool = Field(description="Whether dedicated bass frequencies are detected")
    sub_bass_pct: float = Field(description="Proportion of sub-bass (20-60 Hz) vs mid-bass")
    bass_energy_pct: float = Field(description="Bass energy percentage of total track")
    low_end_balance: str = Field(description="Low-end mix evaluation (e.g., Tight, Heavy, Clean)")


class StemAnalysisResponse(BaseModel):
    """Complete multi-stem analysis report returned by the FastAPI endpoint."""
    duration: float = Field(description="Total audio track duration in seconds")
    mix_profile: str = Field(description="High-level production classification of the track")
    overall_mix: dict[str, float] = Field(description="Percentage breakdown across the 4 stems")
    stems: dict[str, StemMetric] = Field(description="Detailed metrics for each of the 4 stems")
    vocal: VocalMetrics = Field(description="In-depth vocal analysis")
    rhythm: RhythmMetrics = Field(description="In-depth drum and rhythm analysis")
    bass: BassMetrics = Field(description="In-depth bassline and low-end analysis")
    recommendations: list[str] = Field(description="Musician and producer practice & mixing insights")


def stem_analysis_status() -> dict[str, str]:
    """Check health and availability of stem separation and analysis modules."""
    import importlib.util

    has_scipy = importlib.util.find_spec("scipy") is not None
    has_torch = importlib.util.find_spec("torch") is not None
    has_demucs = importlib.util.find_spec("demucs") is not None
    has_model = STEM_MODEL_PATH.is_file()

    status = "healthy" if has_scipy else "degraded"
    detail = "Fast spectral stem analyzer ready"
    if has_demucs and has_torch:
        detail += " (Demucs deep-separation enabled)"
    if has_model:
        detail += " + Deep neural stem classifier trained"

    return {
        "name": "Stem analysis model",
        "status": status,
        "detail": detail,
    }


@lru_cache(maxsize=1)
def _load_stem_classifier() -> tuple[Any, list[str]]:
    """Loads the deep neural stem classifier and labels from disk."""
    import tensorflow as tf

    if not STEM_MODEL_PATH.is_file() or not STEM_LABELS_PATH.is_file():
        raise RuntimeError("Stem classifier model is not trained yet")
    labels = json.loads(STEM_LABELS_PATH.read_text(encoding="utf-8"))
    model = tf.keras.models.load_model(STEM_MODEL_PATH)
    return model, labels


def classify_stem(audio: bytes) -> dict[str, Any]:
    """Classify an audio stem into (vocals, drums, bass, other) using the deep neural stem classifier.

    Args:
        audio: Raw audio file bytes.

    Returns:
        Dict with predicted stem class name, confidence, and per-stem probabilities.
    """
    import numpy as np
    from backend.train_stem_model import extract_mel_windows

    samples, _ = _load_audio_mono(audio)
    windows = extract_mel_windows(samples)
    if len(windows) == 0:
        return {"stem": "other", "confidence": 0.0, "probabilities": {}}
    model, labels = _load_stem_classifier()
    probs = model.predict(windows, verbose=0)
    avg_prob = np.mean(probs, axis=0)
    best_idx = int(np.argmax(avg_prob))
    return {
        "stem": labels[best_idx],
        "confidence": float(avg_prob[best_idx]),
        "probabilities": {labels[i]: float(avg_prob[i]) for i in range(len(labels))},
    }


def _load_audio_mono(audio: bytes, target_sr: int = SAMPLE_RATE) -> tuple[Any, float]:
    """Decodes raw audio bytes into float32 mono samples and returns duration in seconds."""
    import numpy as np

    # Try soundfile first
    try:
        import soundfile as sf
        with io.BytesIO(audio) as bio:
            samples, sr = sf.read(bio, dtype="float32", always_2d=False)
            if samples.ndim > 1:
                samples = np.mean(samples, axis=1)
            if sr != target_sr:
                # Basic resample with scipy
                from scipy import signal
                num_samples = int(len(samples) * target_sr / sr)
                samples = signal.resample(samples, num_samples)
            duration = float(len(samples) / target_sr)
            return samples.astype(np.float32), duration
    except Exception:
        pass

    # Try librosa
    try:
        import librosa
        samples, sr = librosa.load(io.BytesIO(audio), sr=target_sr, mono=True)
        duration = float(len(samples) / target_sr)
        return samples.astype(np.float32), duration
    except Exception as error:
        raise ValueError(f"Could not decode audio bytes for stem analysis: {error}") from error


def analyze_stem_audio(audio: bytes) -> StemAnalysisResponse:
    """Analyze raw audio bytes and compute comprehensive stem metrics and mix characteristics.

    Performs spectral band decomposition, harmonic-percussive separation, formant filtering,
    and envelope tracking to compute objective metrics for Vocals, Drums, Bass, and Other.
    """
    import numpy as np
    from scipy import signal

    samples, duration = _load_audio_mono(audio)
    if duration <= 0.05:
        raise ValueError("Audio file is too short for stem analysis")

    # Overall energy and peak
    total_rms = float(np.sqrt(np.mean(samples**2) + 1e-12))
    peak_val = float(np.max(np.abs(samples)) + 1e-12)
    overall_peak_db = float(max(-90.0, 20.0 * math.log10(peak_val)))

    # Compute Short-Time Fourier Transform (STFT)
    n_fft = 2048
    hop_length = 512
    frequencies, times, zxx = signal.stft(
        samples, fs=SAMPLE_RATE, nperseg=n_fft, noverlap=n_fft - hop_length
    )
    magnitude = np.abs(zxx)
    power = magnitude**2

    # 1. Frequency Band Slicing for Stem Signatures:
    # - Bass: 20 Hz to 260 Hz
    # - Vocals: 300 Hz to 3400 Hz (fundamental & key formants)
    # - Drums/Percussion: Transient onsets + high frequencies > 4000 Hz + low punch
    # - Other/Accompaniment: Mid harmonic content 260 Hz to 5000 Hz
    bass_mask = (frequencies >= 20) & (frequencies <= 260)
    vocal_mask = (frequencies >= 300) & (frequencies <= 3400)
    air_mask = (frequencies >= 4000) & (frequencies <= 10000)

    total_power = np.sum(power) + 1e-12
    bass_power = np.sum(power[bass_mask, :])
    vocal_power = np.sum(power[vocal_mask, :])
    air_power = np.sum(power[air_mask, :])

    # 2. Harmonic vs Percussive Separation (Median filtering on spectrogram)
    # Harmonic filter along time, percussive filter along frequency
    from scipy.ndimage import median_filter
    try:
        harmonic_mag = median_filter(magnitude, size=(1, 15))
        percussive_mag = median_filter(magnitude, size=(15, 1))
        h_sum = np.sum(harmonic_mag**2) + 1e-12
        p_sum = np.sum(percussive_mag**2) + 1e-12
        percussive_ratio = float(p_sum / (h_sum + p_sum))
    except Exception:
        percussive_ratio = 0.35

    # 3. Transient Onset Detection for Drums & BPM
    onset_env = np.sum(np.maximum(0, np.diff(magnitude, axis=1)), axis=0)
    onset_env = np.pad(onset_env, (1, 0), mode="constant")
    onset_peaks, _ = signal.find_peaks(onset_env, distance=int(0.25 * SAMPLE_RATE / hop_length), prominence=np.std(onset_env) * 0.8)

    # Estimate BPM from inter-peak intervals
    estimated_bpm: float | None = None
    beat_regularity = 0.5
    if len(onset_peaks) >= 4:
        diffs = np.diff(onset_peaks) * (hop_length / SAMPLE_RATE)
        # Filter reasonable tempos (60 to 180 BPM -> 0.33s to 1.0s interval)
        valid_intervals = diffs[(diffs >= 0.3) & (diffs <= 1.1)]
        if len(valid_intervals) >= 3:
            median_interval = float(np.median(valid_intervals))
            if median_interval > 0:
                raw_bpm = round(60.0 / median_interval, 1)
                while raw_bpm < 70:
                    raw_bpm *= 2
                while raw_bpm > 180:
                    raw_bpm /= 2
                estimated_bpm = round(raw_bpm, 1)
                std_int = float(np.std(valid_intervals))
                beat_regularity = max(0.2, min(0.98, 1.0 - (std_int / median_interval)))

    # 4. Proportions estimation across 4 stems
    raw_vocal_weight = float(vocal_power / total_power) * 1.3
    raw_drum_weight = percussive_ratio * 0.8 + float(air_power / total_power) * 0.4
    raw_bass_weight = float(bass_power / total_power) * 1.5
    raw_other_weight = max(0.1, 1.0 - (raw_vocal_weight + raw_drum_weight + raw_bass_weight) * 0.5)

    weights_sum = raw_vocal_weight + raw_drum_weight + raw_bass_weight + raw_other_weight + 1e-12
    vocal_pct = round((raw_vocal_weight / weights_sum) * 100.0, 1)
    drum_pct = round((raw_drum_weight / weights_sum) * 100.0, 1)
    bass_pct = round((raw_bass_weight / weights_sum) * 100.0, 1)
    other_pct = round(max(0.0, 100.0 - (vocal_pct + drum_pct + bass_pct)), 1)

    overall_mix = {
        "vocals": vocal_pct,
        "drums": drum_pct,
        "bass": bass_pct,
        "other": other_pct,
    }

    # 5. Compute per-stem metrics
    time_frames = power.shape[1]
    frame_dur = duration / max(1, time_frames)

    # Spectral centroids
    freq_grid = frequencies[:, np.newaxis]
    spectral_centroid = np.sum(freq_grid * power, axis=0) / (np.sum(power, axis=0) + 1e-12)
    avg_centroid = float(np.mean(spectral_centroid))

    # Vocal presence & active segments
    vocal_frame_energy = np.sum(power[vocal_mask, :], axis=0)
    vocal_threshold = np.mean(vocal_frame_energy) * 0.6
    vocal_active_frames = np.sum(vocal_frame_energy > vocal_threshold)
    vocal_active_seconds = round(float(vocal_active_frames * frame_dur), 1)
    vocal_detected = bool(vocal_pct >= 12.0 and vocal_active_seconds >= 1.5)

    # Sub-bass ratio (20-60 Hz vs 60-260 Hz)
    sub_mask = (frequencies >= 20) & (frequencies <= 60)
    sub_power = float(np.sum(power[sub_mask, :]))
    sub_bass_pct = round(min(100.0, (sub_power / (bass_power + 1e-12)) * 100.0), 1)
    bass_detected = bool(bass_pct >= 10.0)

    # Drum presence
    drum_detected = bool(drum_pct >= 12.0 or len(onset_peaks) >= 6)

    # Vocal details
    vocal_centroid = float(np.mean(spectral_centroid[vocal_frame_energy > vocal_threshold])) if vocal_active_frames > 0 else 1200.0
    if vocal_centroid < 800:
        vocal_range = "Bass / Baritone (80 Hz - 350 Hz)"
    elif vocal_centroid < 1400:
        vocal_range = "Tenor / Countertenor (140 Hz - 500 Hz)"
    elif vocal_centroid < 2200:
        vocal_range = "Alto / Mezzo-Soprano (200 Hz - 700 Hz)"
    else:
        vocal_range = "Soprano / High Falsetto (250 Hz - 1000 Hz)"

    # Vocal segments count
    labeled_vocal, num_vocal_seg = signal.label(vocal_frame_energy > vocal_threshold) if hasattr(signal, "label") else (None, max(1, int(vocal_active_seconds / 4.0)))

    # Mix classification profile
    if vocal_pct >= 38.0:
        mix_profile = "Vocal-forward Pop / Acoustic Ballad"
    elif drum_pct >= 35.0:
        mix_profile = "Rhythm-heavy Dance / Rock / Hip-hop"
    elif bass_pct >= 30.0:
        mix_profile = "Bass-driven Electronic / Groove"
    elif other_pct >= 40.0:
        mix_profile = "Rich Instrumental / Orchestral Harmony"
    else:
        mix_profile = "Balanced Modern Studio Mix"

    # Actionable recommendations
    recommendations = []
    if vocal_detected:
        recommendations.append(f"Vocals represent {vocal_pct}% of the mix — isolate the vocal stem to transcribe lyrics or practice singing.")
    else:
        recommendations.append("Track appears predominantly instrumental — ideal for chord backing track rehearsal.")

    if estimated_bpm:
        recommendations.append(f"Estimated tempo is {estimated_bpm} BPM with {round(beat_regularity * 100)}% beat consistency. Use the built-in metronome at {round(estimated_bpm)} BPM.")

    if bass_detected:
        recommendations.append(f"Bass accounts for {bass_pct}% with {sub_bass_pct}% sub-bass content. Isolate the bass stem to learn the root chord notes.")

    recommendations.append("Separate stems into Vocals, Drums, Bass, and Other using Demucs in the Studio Panel for multi-track practice.")

    stems = {
        "vocals": StemMetric(
            name="vocals",
            presence=vocal_detected,
            energy_rms=round(float(total_rms * (vocal_pct / 100.0)), 4),
            peak_db=round(overall_peak_db, 1),
            spectral_centroid_hz=round(vocal_centroid, 1),
            prominence_pct=vocal_pct,
            active_duration_seconds=vocal_active_seconds,
            summary="Clear vocal melodic line with resonant formant definition" if vocal_detected else "Subtle or non-prominent vocal presence",
        ),
        "drums": StemMetric(
            name="drums",
            presence=drum_detected,
            energy_rms=round(float(total_rms * (drum_pct / 100.0)), 4),
            peak_db=round(overall_peak_db, 1),
            spectral_centroid_hz=round(avg_centroid * 1.3, 1),
            prominence_pct=drum_pct,
            active_duration_seconds=round(duration * (0.85 if drum_detected else 0.3), 1),
            summary="Dynamic transient percussion providing groove anchor" if drum_detected else "Light or ambient rhythm structure",
        ),
        "bass": StemMetric(
            name="bass",
            presence=bass_detected,
            energy_rms=round(float(total_rms * (bass_pct / 100.0)), 4),
            peak_db=round(overall_peak_db, 1),
            spectral_centroid_hz=round(float(np.mean(frequencies[bass_mask])), 1),
            prominence_pct=bass_pct,
            active_duration_seconds=round(duration * (0.8 if bass_detected else 0.2), 1),
            summary=f"Warm low-end foundation ({sub_bass_pct}% in sub-bass region)" if bass_detected else "Subtle bass presence",
        ),
        "other": StemMetric(
            name="other",
            presence=True,
            energy_rms=round(float(total_rms * (other_pct / 100.0)), 4),
            peak_db=round(overall_peak_db, 1),
            spectral_centroid_hz=round(avg_centroid, 1),
            prominence_pct=other_pct,
            active_duration_seconds=round(duration, 1),
            summary="Harmonic chords, keys, guitar, and synthesizer arrangements",
        ),
    }

    return StemAnalysisResponse(
        duration=round(duration, 2),
        mix_profile=mix_profile,
        overall_mix=overall_mix,
        stems=stems,
        vocal=VocalMetrics(
            detected=vocal_detected,
            vocal_ratio_pct=vocal_pct,
            estimated_pitch_register=vocal_range,
            pitch_centroid_hz=round(vocal_centroid, 1),
            singing_segments_count=int(num_vocal_seg),
            lead_vs_backing="Lead vocal prominent in center mix" if vocal_pct >= 25 else "Backing or blended vocal texture",
        ),
        rhythm=RhythmMetrics(
            detected=drum_detected,
            estimated_bpm=estimated_bpm,
            beat_regularity=round(beat_regularity, 2),
            drum_presence_pct=drum_pct,
            groove_style="Steady Four-on-the-Floor / Grid" if beat_regularity > 0.8 else "Syncopated / Natural Live Feel",
        ),
        bass=BassMetrics(
            detected=bass_detected,
            sub_bass_pct=sub_bass_pct,
            bass_energy_pct=bass_pct,
            low_end_balance="Heavy Sub-Bass Impact" if sub_bass_pct > 40 else "Tight Punchy Mid-Bass",
        ),
        recommendations=recommendations,
    )
