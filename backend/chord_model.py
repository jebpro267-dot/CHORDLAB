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


def get_model_paths(language: str = "auto") -> tuple[Path, Path]:
    """Resolve the model and label paths for the specified language or fallback to default."""
    lang = (language or "auto").lower().strip()
    if lang in ("english", "en"):
        p = ROOT / "backend/data/chord_model_english.keras"
        if p.is_file():
            return p, p.with_suffix(".labels.json")
    elif lang in ("hindi", "hi"):
        p = ROOT / "backend/data/chord_model_hindi.keras"
        if p.is_file():
            return p, p.with_suffix(".labels.json")
    elif lang in ("tamil", "ta"):
        p = ROOT / "backend/data/chord_model_tamil.keras"
        if p.is_file():
            return p, p.with_suffix(".labels.json")
    return MODEL_PATH, LABELS_PATH


def model_status() -> dict[str, str]:
    """
    Returns a status dictionary describing whether the TensorFlow chord models
    are available and ready to use across English, Hindi, Tamil, and default.
    """
    if any(
        importlib.util.find_spec(package) is None
        for package in ("tensorflow", "librosa")
    ):
        return {
            "name": "TensorFlow chord model",
            "status": "unavailable",
            "detail": "Install backend/requirements-ml.txt in the API environment",
        }

    english_ok = (ROOT / "backend/data/chord_model_english.keras").is_file()
    hindi_ok = (ROOT / "backend/data/chord_model_hindi.keras").is_file()
    tamil_ok = (ROOT / "backend/data/chord_model_tamil.keras").is_file()
    default_ok = MODEL_PATH.is_file()

    active_models = []
    if english_ok:
        active_models.append("English")
    if hindi_ok:
        active_models.append("Hindi")
    if tamil_ok:
        active_models.append("Tamil")
    if default_ok:
        active_models.append("Master")

    if not active_models:
        return {
            "name": "TensorFlow chord model",
            "status": "unavailable",
            "detail": "Train models with python -m backend.train_chord_model --language all",
        }

    return {
        "name": "TensorFlow chord model",
        "status": "healthy",
        "detail": f"Models ready: {', '.join(active_models)}",
    }


@lru_cache(maxsize=8)
def _load_model(language: str = "auto") -> tuple[Any, list[str]]:
    """
    Loads the Keras chord model and its label list from disk for the specified language.
    """
    try:
        import tensorflow as tf
    except ImportError as error:
        raise RuntimeError(
            "TensorFlow is not installed; install backend/requirements-ml.txt"
        ) from error

    model_p, labels_p = get_model_paths(language)
    if not model_p.is_file() or not labels_p.is_file():
        # Try default master model if language specific model not found
        model_p, labels_p = MODEL_PATH, LABELS_PATH

    if not model_p.is_file() or not labels_p.is_file():
        raise RuntimeError(
            "The TensorFlow chord model is not trained; run "
            "python -m backend.train_chord_model --language all"
        )
    try:
        labels = json.loads(labels_p.read_text(encoding="utf-8"))
        model = tf.keras.models.load_model(model_p)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not load the TensorFlow chord model: {error}") from error
    if not isinstance(labels, list) or model.output_shape[-1] != len(labels):
        raise RuntimeError("The chord model and its label file do not match")
    return model, labels


def _audio_features(audio: bytes) -> tuple[Any, float]:
    """
    Decodes raw audio bytes and extracts a normalised chroma-STFT feature matrix.

    Args:
        audio: Raw audio file bytes (any format supported by librosa/ffmpeg).

    Returns:
        A ``(chroma, duration)`` tuple where ``chroma`` is a 2-D NumPy array
        of shape ``(frames, 12)`` and ``duration`` is the track length in seconds.

    Raises:
        RuntimeError: If librosa or numpy are not installed.
        ValueError:   If the audio cannot be decoded, contains no samples, or
                      exceeds ``MAX_DURATION_SECONDS``.
    """
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
    """
    Slices the chroma feature matrix into overlapping fixed-size windows for
    batch inference.

    Args:
        chroma: 2-D NumPy array of shape ``(frames, 12)``.

    Returns:
        A ``(windows, centers)`` tuple where ``windows`` has shape
        ``(n_windows, WINDOW_FRAMES, 12, 1)`` (ready for the Conv2D model) and
        ``centers`` is an int32 array of the start-frame index for each window.
    """
    import numpy as np

    half = WINDOW_FRAMES // 2
    padded = np.pad(chroma, ((half, half), (0, 0)), mode="reflect")
    centers = np.arange(0, len(chroma), STRIDE_FRAMES, dtype=np.int32)
    starts = centers
    windows = np.stack([padded[start : start + WINDOW_FRAMES] for start in starts])
    return windows[..., np.newaxis], centers


def _detect_audio_language(chroma: Any) -> str:
    """Detect whether chroma aligns closest with english, hindi, or tamil profiles."""
    import numpy as np

    avg = np.mean(chroma, axis=0)
    norm = np.linalg.norm(avg) or 1.0
    avg = avg / norm

    profiles = {
        "english": np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]),
        "hindi": np.array([6.12, 1.95, 3.25, 2.10, 4.52, 3.10, 3.45, 5.30, 2.15, 3.50, 2.40, 3.05]),
        "tamil": np.array([6.25, 2.10, 3.15, 2.65, 4.20, 3.85, 2.40, 5.15, 3.30, 3.20, 2.85, 2.75]),
    }
    best_lang = "english"
    best_score = -1e9
    for lang, prof in profiles.items():
        p_norm = prof / (np.linalg.norm(prof) or 1.0)
        for shift in range(12):
            score = float(np.dot(np.roll(avg, shift), p_norm))
            if score > best_score:
                best_score = score
                best_lang = lang
    return best_lang


def analyze_audio(audio: bytes, language: str = "auto") -> dict[str, Any]:
    """
    Runs the full TensorFlow chord-recognition pipeline on raw audio bytes.

    Pipeline: decode audio → extract chroma → build windows → model inference
    → merge consecutive identical predictions into time-stamped chord events.

    Args:
        audio: Raw audio file bytes.
        language: Language specialization ('english', 'hindi', 'tamil', or 'auto').

    Returns:
        A dict with keys:
        - ``"duration"`` (float): track length in seconds.
        - ``"chords"`` (list[dict]): list of chord events, each with
          ``"start"``, ``"end"``, ``"label"``, and ``"confidence"`` fields.
        - ``"language"`` (str): resolved language model ('english', 'hindi', or 'tamil').
    """
    import numpy as np

    chroma, duration = _audio_features(audio)
    target_lang = (language or "auto").lower().strip()
    if target_lang == "auto":
        resolved_lang = _detect_audio_language(chroma)
    elif target_lang in ("hindi", "hi"):
        resolved_lang = "hindi"
    elif target_lang in ("tamil", "ta"):
        resolved_lang = "tamil"
    else:
        resolved_lang = "english"

    model, labels = _load_model(resolved_lang)
    windows, centers = _make_windows(chroma)
    probabilities = model.predict(windows, batch_size=256, verbose=0)
    predictions = np.argmax(probabilities, axis=1)
    frame_seconds = HOP_LENGTH / SAMPLE_RATE
    events: list[dict[str, float | str]] = []
    current = int(predictions[0])
    start = 0
    scores = [float(probabilities[0, current])]

    def append_event(label_id: int, first: int, last: int, confidence: list[float]) -> None:
        """
        Appends a single chord event to ``events`` if the time window is
        non-empty (i.e. ``end_seconds > start_seconds``).

        Args:
            label_id:   Class index into ``labels``.
            first:      Index of the first window in this run.
            last:       Index of the last window in this run (inclusive).
            confidence: Per-window softmax confidence values for this class.
        """
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
    return {"duration": duration, "chords": events, "language": resolved_lang}


def _label_id(root: int, quality: str) -> int:
    """
    Converts a (root pitch-class, quality string) pair to the integer class ID
    used by the model.  Class 0 is reserved for "no chord" (N).

    Args:
        root:    Root pitch class (0 = C, 1 = C#, … 11 = B).
        quality: Quality string (one of ``QUALITIES``).

    Returns:
        Integer class ID in the range ``[1, 12 * len(QUALITIES)]``.
    """
    return 1 + root * len(QUALITIES) + QUALITIES.index(quality)


def chord_label_id(raw: str) -> int | None:
    """
    Maps a chord label (Harte notation like ``"A:min7"`` or direct symbol like ``"Am7"``, ``"C"``)
    to the integer class ID expected by the model, or returns ``None`` for unrecognised labels.
    """
    token = raw.strip().split("/", 1)[0]
    if token.upper() in {"N", "X", "NC", ""}:
        return 0
    root, separator, quality = token.partition(":")
    if not separator:
        for p_name in sorted(PITCH_CLASSES.keys(), key=len, reverse=True):
            if token.startswith(p_name):
                root = p_name
                quality = token[len(p_name):]
                separator = ":"
                break
    if not separator:
        return None
    pitch = PITCH_CLASSES.get(root)
    if pitch is None:
        return None
    lowered = quality.lower().strip()
    if lowered.startswith("hdim") or lowered.startswith("dim"):
        family = "dim"
    elif lowered.startswith("aug"):
        family = "aug"
    elif lowered.startswith("sus2"):
        family = "sus2"
    elif lowered.startswith("sus4") or lowered == "sus":
        family = "sus4"
    elif lowered.startswith("min7") or lowered.startswith("m7"):
        family = "m7"
    elif lowered.startswith("maj7"):
        family = "maj7"
    elif lowered.startswith("maj") or lowered == "":
        family = ""
    elif lowered.startswith("min") or lowered.startswith("m"):
        family = "m"
    elif lowered.startswith("7") or lowered.startswith("dom7"):
        family = "7"
    else:
        family = ""
    return _label_id(pitch, family)


def chord_name(label_id: int) -> str:
    """
    Converts an integer class ID back to a human-readable chord name string.

    Args:
        label_id: Integer class ID (0 = "N", 1–108 = standard chord labels).

    Returns:
        Chord name string such as ``"Am7"`` or ``"N"`` for no-chord.
    """
    if label_id == 0:
        return "N"
    value = label_id - 1
    root = PITCH_NAMES[value // len(QUALITIES)]
    quality = QUALITIES[value % len(QUALITIES)]
    return root + quality
