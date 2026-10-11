from __future__ import annotations

import io
import importlib.util
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = Path(os.getenv("CHORD_MODEL_PATH", ROOT / "backend/data/chord_model.keras"))
LABELS_PATH = MODEL_PATH.with_suffix(".labels.json")
SAMPLE_RATE = 22050
HOP_LENGTH = 512
N_FFT = 4096
WINDOW_FRAMES = 64
STRIDE_FRAMES = 11
MAX_DURATION_SECONDS = 15 * 60
QUALITIES = ("", "m", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")
PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
PITCH_CLASSES = {
    "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "C##": 2,
    "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "F": 5, "E#": 5,
    "F#": 6, "Gb": 6, "G": 7, "F##": 7, "G#": 8, "Ab": 8,
    "A": 9, "G##": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}


def model_status() -> dict[str, str]:
    if not MODEL_PATH.is_file() or not LABELS_PATH.is_file():
        return {
            "name": "TensorFlow chord model",
            "status": "unavailable",
            "detail": "Train a model with python -m backend.train_chord_model --download",
        }
    if any(
        importlib.util.find_spec(package) is None
        for package in ("tensorflow", "librosa")
    ):
        return {
            "name": "TensorFlow chord model",
            "status": "unavailable",
            "detail": "Install backend/requirements-ml.txt in the API environment",
        }
    return {
        "name": "TensorFlow chord model",
        "status": "healthy",
        "detail": "Model and labels are ready",
    }


@lru_cache(maxsize=1)
def _load_model() -> tuple[Any, list[str]]:
    try:
        import tensorflow as tf
    except ImportError as error:
        raise RuntimeError(
            "TensorFlow is not installed; install backend/requirements-ml.txt"
        ) from error

    if not MODEL_PATH.is_file() or not LABELS_PATH.is_file():
        raise RuntimeError(
            "The TensorFlow chord model is not trained; run "
            "python -m backend.train_chord_model --download"
        )
    try:
        labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
        model = tf.keras.models.load_model(MODEL_PATH)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not load the TensorFlow chord model: {error}") from error
    if not isinstance(labels, list) or model.output_shape[-1] != len(labels):
        raise RuntimeError("The chord model and its label file do not match")
    return model, labels


def _audio_features(audio: bytes) -> tuple[Any, float]:
    try:
        import librosa
        import numpy as np
    except ImportError as error:
        raise RuntimeError(
            "Audio model dependencies are missing; install backend/requirements-ml.txt"
        ) from error

    try:
        samples, _ = librosa.load(io.BytesIO(audio), sr=SAMPLE_RATE, mono=True)
    except Exception as error:
        raise ValueError(f"Could not decode audio for chord recognition: {error}") from error
    duration = len(samples) / SAMPLE_RATE
    if duration == 0:
        raise ValueError("The audio file contains no samples")
    if duration > MAX_DURATION_SECONDS:
        raise ValueError("TensorFlow chord analysis supports audio up to 15 minutes")
    chroma = librosa.feature.chroma_stft(
        y=samples,
        sr=SAMPLE_RATE,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        tuning=0,
        norm=2,
    ).T
    return np.nan_to_num(chroma, copy=False), duration


def _make_windows(chroma: Any) -> tuple[Any, Any]:
    import numpy as np

    half = WINDOW_FRAMES // 2
    padded = np.pad(chroma, ((half, half), (0, 0)), mode="reflect")
    centers = np.arange(0, len(chroma), STRIDE_FRAMES, dtype=np.int32)
    starts = centers
    windows = np.stack([padded[start : start + WINDOW_FRAMES] for start in starts])
    return windows[..., np.newaxis], centers


def analyze_audio(audio: bytes) -> dict[str, Any]:
    import numpy as np

    model, labels = _load_model()
    chroma, duration = _audio_features(audio)
    windows, centers = _make_windows(chroma)
    probabilities = model.predict(windows, batch_size=256, verbose=0)
    predictions = np.argmax(probabilities, axis=1)
    frame_seconds = HOP_LENGTH / SAMPLE_RATE
    events: list[dict[str, float | str]] = []
    current = int(predictions[0])
    start = 0
    scores = [float(probabilities[0, current])]

    def append_event(label_id: int, first: int, last: int, confidence: list[float]) -> None:
        start_seconds = max(0.0, first * STRIDE_FRAMES * frame_seconds)
        end_seconds = min(duration, (last * STRIDE_FRAMES + STRIDE_FRAMES) * frame_seconds)
        if end_seconds > start_seconds:
            events.append({
                "start": start_seconds,
                "end": end_seconds,
                "label": labels[label_id],
                "confidence": sum(confidence) / len(confidence),
            })

    for index in range(1, len(predictions)):
        label_id = int(predictions[index])
        if label_id == current:
            scores.append(float(probabilities[index, label_id]))
            continue
        append_event(current, start, index - 1, scores)
        current, start = label_id, index
        scores = [float(probabilities[index, label_id])]
    append_event(current, start, len(predictions) - 1, scores)
    return {"duration": duration, "chords": events}


def _label_id(root: int, quality: str) -> int:
    return 1 + root * len(QUALITIES) + QUALITIES.index(quality)


def chord_label_id(raw: str) -> int | None:
    token = raw.strip().split("/", 1)[0]
    if token.upper() in {"N", "X", "NC"}:
        return 0
    root, separator, quality = token.partition(":")
    if not separator:
        return None
    pitch = PITCH_CLASSES.get(root)
    if pitch is None:
        return None
    lowered = quality.lower()
    if lowered.startswith("hdim") or lowered.startswith("dim"):
        family = "dim"
    elif lowered.startswith("aug"):
        family = "aug"
    elif lowered.startswith("sus2"):
        family = "sus2"
    elif lowered.startswith("sus4"):
        family = "sus4"
    elif lowered.startswith("min7"):
        family = "m7"
    elif lowered.startswith("maj7"):
        family = "maj7"
    elif lowered.startswith("min"):
        family = "m"
    elif lowered.startswith("7"):
        family = "7"
    else:
        family = ""
    return _label_id(pitch, family)


def chord_name(label_id: int) -> str:
    if label_id == 0:
        return "N"
    value = label_id - 1
    root = PITCH_NAMES[value // len(QUALITIES)]
    quality = QUALITIES[value % len(QUALITIES)]
    return root + quality
