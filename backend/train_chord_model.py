from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from backend.chord_model import (
    HOP_LENGTH,
    LABELS_PATH,
    MODEL_PATH,
    N_FFT,
    PITCH_NAMES,
    QUALITIES,
    SAMPLE_RATE,
    WINDOW_FRAMES,
    chord_label_id,
)
from backend.dataset_collector import (
    ENGLISH_PROGRESSIONS,
    HINDI_PROGRESSIONS,
    TAMIL_PROGRESSIONS,
    build_and_save_dataset,
    download_file,
    safe_extract_zip,
)

ROOT = Path(__file__).resolve().parent.parent
TRAIN_STRIDE_FRAMES = 11  # Matches inference window stride for exact alignment
GUITARSET_URLS = {
    "annotation.zip": (
        "https://zenodo.org/api/records/3371780/files/annotation.zip/content",
        "b39b78e63d3446f2e54ddb7a54df9b10",
    ),
}


def download_guitarset(data_dir: Path) -> None:
    """Fetch and extract GuitarSet annotations from Zenodo."""
    raw_dir = data_dir / "downloads"
    for filename, (url, checksum) in GUITARSET_URLS.items():
        archive = raw_dir / filename
        download_file(url, archive, checksum)
        safe_extract_zip(archive, data_dir)


def _quality_labels() -> list[str]:
    """Generate the complete list of 109 chord label class names including 'N' (no chord)."""
    return ["N"] + [
        pitch + quality for pitch in PITCH_NAMES for quality in QUALITIES
    ]


def _windows_for_track(audio_path: Path, annotation_path: Path) -> tuple[Any, Any]:
    """Extract sliding 12-semitone chroma feature windows and corresponding chord labels.
    Supports both JAMS (*.jams) and JSON (*.json) annotation files.
    """
    import librosa
    import numpy as np

    events = []
    if annotation_path.suffix.lower() == ".jams":
        with annotation_path.open(encoding="utf-8") as source:
            jams = json.load(source)
        chord_annotations = [
            ann for ann in jams.get("annotations", [])
            if ann.get("namespace") == "chord"
        ]
        if not chord_annotations:
            return np.empty((0, WINDOW_FRAMES, 12, 1), np.float32), np.empty((0,), np.int32)
        for e in chord_annotations[-1].get("data", []):
            events.append({
                "time": float(e.get("time", 0)),
                "duration": float(e.get("duration", 0)),
                "value": str(e.get("value", "")),
            })
    else:  # .json
        with annotation_path.open(encoding="utf-8") as source:
            data = json.load(source)
        for e in data.get("events", []):
            start_t = float(e.get("start", e.get("time", 0)))
            end_t = float(e.get("end", start_t + float(e.get("duration", 0))))
            events.append({
                "time": start_t,
                "duration": max(0.01, end_t - start_t),
                "value": str(e.get("chord", e.get("value", ""))),
            })

    if not events:
        return np.empty((0, WINDOW_FRAMES, 12, 1), np.float32), np.empty((0,), np.int32)

    try:
        samples, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
    except Exception:
        import soundfile as sf
        samples, _ = sf.read(str(audio_path), dtype="float32", always_2d=False)
        if samples.ndim > 1:
            samples = np.mean(samples, axis=1)

    chroma = librosa.feature.chroma_stft(
        y=samples,
        sr=SAMPLE_RATE,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        tuning=0,
        norm=2,
    ).T

    half = WINDOW_FRAMES // 2
    padded = np.pad(chroma, ((half, half), (0, 0)), mode="reflect")
    windows: list[Any] = []
    labels: list[int] = []

    hop_time = HOP_LENGTH / SAMPLE_RATE
    for start_f in range(0, len(chroma), TRAIN_STRIDE_FRAMES):
        t = start_f * hop_time
        chord_val = "N"
        for ev in events:
            if ev["time"] <= t < ev["time"] + ev["duration"]:
                chord_val = ev["value"]
                break
        label_id = chord_label_id(chord_val)
        if label_id is not None:
            windows.append(padded[start_f : start_f + WINDOW_FRAMES])
            labels.append(label_id)

    if not windows:
        return np.empty((0, WINDOW_FRAMES, 12, 1), np.float32), np.empty((0,), np.int32)
    return np.asarray(windows, dtype=np.float32)[..., np.newaxis], np.asarray(labels, dtype=np.int32)


def build_model(num_labels: int) -> Any:
    """Construct and compile the 2D Convolutional Neural Network (CNN) for chord classification."""
    import tensorflow as tf

    inputs = tf.keras.Input(shape=(WINDOW_FRAMES, 12, 1))
    x = tf.keras.layers.Conv2D(32, (5, 3), padding="same", activation="relu")(inputs)
    x = tf.keras.layers.MaxPooling2D((2, 1))(x)
    x = tf.keras.layers.Dropout(0.2)(x)

    x = tf.keras.layers.Conv2D(64, (5, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPooling2D((2, 1))(x)
    x = tf.keras.layers.Dropout(0.25)(x)

    x = tf.keras.layers.Conv2D(96, (3, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.Flatten()(x)

    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(num_labels, activation="softmax")(x)

    model = tf.keras.Model(inputs=inputs, outputs=outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy")],
    )
    return model


def ensure_datasets(data_dir: Path, download_guitar: bool = False) -> None:
    """Ensure English, Hindi, and Tamil datasets exist under data_dir."""
    datasets_root = data_dir / "datasets"
    en_dir = datasets_root / "english"
    hi_dir = datasets_root / "hindi"
    ta_dir = datasets_root / "tamil"

    if download_guitar:
        try:
            download_guitarset(data_dir / "guitarset")
        except Exception as e:
            print("GuitarSet download note:", e)

    if not (en_dir / "audio").exists() or not list((en_dir / "audio").glob("*.wav")):
        build_and_save_dataset(en_dir, "english", ENGLISH_PROGRESSIONS, num_tracks=30)

    if not (hi_dir / "audio").exists() or not list((hi_dir / "audio").glob("*.wav")):
        build_and_save_dataset(hi_dir, "hindi", HINDI_PROGRESSIONS, num_tracks=35)

    if not (ta_dir / "audio").exists() or not list((ta_dir / "audio").glob("*.wav")):
        build_and_save_dataset(ta_dir, "tamil", TAMIL_PROGRESSIONS, num_tracks=35)


def gather_tracks_for_language(data_dir: Path, language: str) -> list[tuple[Path, Path, str]]:
    """Discover matched audio and annotation pairs for a given language."""
    datasets_root = data_dir / "datasets"
    matched: list[tuple[Path, Path, str]] = []

    target_dirs = []
    if language in ("english", "all"):
        target_dirs.append((datasets_root / "english", "en"))
        guitarset_dir = data_dir / "guitarset"
        if guitarset_dir.is_dir():
            target_dirs.append((guitarset_dir, "guitarset"))
    if language in ("hindi", "all"):
        target_dirs.append((datasets_root / "hindi", "hi"))
    if language in ("tamil", "all"):
        target_dirs.append((datasets_root / "tamil", "ta"))

    for search_dir, group_prefix in target_dirs:
        if not search_dir.is_dir():
            continue
        ann_files = {p.stem: p for p in search_dir.rglob("*") if p.is_file() and p.suffix.lower() in {".jams", ".json"}}
        audio_files = {
            p.stem.removesuffix("_mic"): p
            for p in search_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in {".wav", ".flac"}
        }
        for stem, ann_path in ann_files.items():
            if stem in audio_files:
                group = f"{group_prefix}_{stem.split('_')[0]}"
                matched.append((ann_path, audio_files[stem], group))

    return matched


def train_single_model(
    matched: list[tuple[Path, Path, str]],
    model_save_path: Path,
    labels_save_path: Path,
    epochs: int = 15,
    seed: int = 42,
    model_name: str = "Master",
) -> float:
    """Train a CNN chord model on the provided track pairs and save to disk."""
    import numpy as np
    import tensorflow as tf

    random.seed(seed)
    np.random.seed(seed)
    tf.keras.utils.set_random_seed(seed)

    print(f"\n=======================================================")
    print(f"Training {model_name} Chord Model on {len(matched)} tracks...")
    print(f"=======================================================")

    tracks: dict[str, list[tuple[Any, Any]]] = {}
    for index, (annotation, audio_path, group) in enumerate(matched, start=1):
        track_windows, track_labels = _windows_for_track(audio_path, annotation)
        if len(track_labels):
            tracks.setdefault(group, []).append((track_windows, track_labels))

    if len(tracks) < 2:
        # Group fallback if only 1 group
        all_items = [t for g in tracks for t in tracks[g]]
        group_names = [f"g_{i}" for i in range(len(all_items))]
        tracks = {group_names[i]: [all_items[i]] for i in range(len(all_items))}

    group_names = list(tracks)
    random.Random(seed).shuffle(group_names)
    validation_count = max(1, round(len(group_names) * 0.2))
    validation_groups = group_names[:validation_count]
    training_groups = group_names[validation_count:]

    def combine(groups: list[str]) -> tuple[Any, Any]:
        items = [track for group in groups for track in tracks[group]]
        return np.concatenate([item[0] for item in items]), np.concatenate([item[1] for item in items])

    train_x, train_y = combine(training_groups)
    validation_x, validation_y = combine(validation_groups)

    # Pitch-shift data augmentation across all 12 semitones
    augmented_x = [train_x]
    augmented_y = [train_y]
    for shift in range(1, 12):
        augmented_x.append(np.roll(train_x, shift, axis=2))
        roots = np.where(train_y == 0, 0, (train_y - 1) // len(QUALITIES))
        families = np.where(train_y == 0, 0, (train_y - 1) % len(QUALITIES))
        shifted_roots = (roots + shift) % 12
        augmented_y.append(
            np.where(train_y == 0, 0, 1 + shifted_roots * len(QUALITIES) + families).astype(np.int32)
        )
    train_x = np.concatenate(augmented_x)
    train_y = np.concatenate(augmented_y)

    # Augment validation across all 12 semitones to evaluate key invariance
    val_aug_x = [validation_x]
    val_aug_y = [validation_y]
    for shift in range(1, 12):
        val_aug_x.append(np.roll(validation_x, shift, axis=2))
        roots = np.where(validation_y == 0, 0, (validation_y - 1) // len(QUALITIES))
        families = np.where(validation_y == 0, 0, (validation_y - 1) % len(QUALITIES))
        shifted_roots = (roots + shift) % 12
        val_aug_y.append(
            np.where(validation_y == 0, 0, 1 + shifted_roots * len(QUALITIES) + families).astype(np.int32)
        )
    validation_x = np.concatenate(val_aug_x)
    validation_y = np.concatenate(val_aug_y)

    labels = _quality_labels()
    model = build_model(len(labels))
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=5, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=0.00005),
    ]

    print(f"Training data: {len(train_x)} windows, Validation: {len(validation_x)} windows.")
    model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        epochs=epochs,
        batch_size=64,
        callbacks=callbacks,
        verbose=1,
    )

    loss, accuracy = model.evaluate(validation_x, validation_y, verbose=0)
    model_save_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(model_save_path)
    labels_save_path.write_text(json.dumps(labels, indent=2), encoding="utf-8")
    print(
        f"[OK] Successfully saved {model_name} model to {model_save_path.name}\n"
        f"  Held-out validation accuracy: {accuracy * 100:.2f}%, loss: {loss:.3f}"
    )
    return accuracy


def train_acr_models(data_dir: Path, epochs: int = 7, seed: int = 42, language: str = "all") -> None:
    """Execute training for English, Hindi, Tamil, and Master TensorFlow chord recognition models."""
    ensure_datasets(data_dir)

    results = {}
    if language in ("english", "all"):
        matched_en = gather_tracks_for_language(data_dir, "english")
        p_model = ROOT / "backend/data/chord_model_english.keras"
        p_labels = p_model.with_suffix(".labels.json")
        results["English"] = train_single_model(matched_en, p_model, p_labels, epochs=epochs, seed=seed, model_name="English")

    if language in ("hindi", "all"):
        matched_hi = gather_tracks_for_language(data_dir, "hindi")
        p_model = ROOT / "backend/data/chord_model_hindi.keras"
        p_labels = p_model.with_suffix(".labels.json")
        results["Hindi"] = train_single_model(matched_hi, p_model, p_labels, epochs=epochs, seed=seed, model_name="Hindi")

    if language in ("tamil", "all"):
        matched_ta = gather_tracks_for_language(data_dir, "tamil")
        p_model = ROOT / "backend/data/chord_model_tamil.keras"
        p_labels = p_model.with_suffix(".labels.json")
        results["Tamil"] = train_single_model(matched_ta, p_model, p_labels, epochs=epochs, seed=seed, model_name="Tamil")

    if language == "all":
        # Master multi-lingual unified model
        matched_all = gather_tracks_for_language(data_dir, "all")
        results["Master (Unified)"] = train_single_model(matched_all, MODEL_PATH, LABELS_PATH, epochs=epochs, seed=seed, model_name="Master (Unified)")

    print("\n=======================================================")
    print("All Requested TensorFlow ACR Models Trained Successfully!")
    print("=======================================================")
    for name, acc in results.items():
        print(f"  * {name} ACR Model: {acc * 100:.2f}% accuracy")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ChordLab's Multi-lingual TensorFlow Chord Models")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "backend/data", help="Directory for datasets")
    parser.add_argument("--language", choices=["english", "hindi", "tamil", "all"], default="all", help="Target language")
    parser.add_argument("--epochs", type=int, default=7, help="Number of training epochs")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--download", action="store_true", help="Download online datasets")
    args = parser.parse_args()

    if args.download:
        ensure_datasets(args.data_dir, download_guitar=True)
    train_acr_models(args.data_dir, epochs=args.epochs, seed=args.seed, language=args.language)


if __name__ == "__main__":
    main()
