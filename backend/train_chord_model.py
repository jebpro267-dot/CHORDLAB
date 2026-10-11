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

ROOT = Path(__file__).resolve().parent.parent
TRAIN_STRIDE_FRAMES = 44
GUITARSET_URLS = {
    "annotation.zip": (
        "https://zenodo.org/api/records/3371780/files/annotation.zip/content",
        "b39b78e63d3446f2e54ddb7a54df9b10",
    ),
    "audio_mono-mic.zip": (
        "https://zenodo.org/api/records/3371780/files/audio_mono-mic.zip/content",
        "275966d6610ac34999b58426beb119c3",
    ),
}


def download(url: str, target: Path, expected_md5: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and _md5(target) == expected_md5:
        print(f"Already downloaded and verified {target.name}")
        return
    partial = target.with_suffix(target.suffix + ".part")
    digest = hashlib.md5()
    request = urllib.request.Request(url, headers={"User-Agent": "ChordLab/1.0"})
    print(f"Downloading {target.name}")
    with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
        total = int(response.headers.get("Content-Length", 0))
        received = 0
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
            received += len(chunk)
            if total:
                print(f"\r  {received * 100 // total}% ({received // 1024**2} MiB)", end="", flush=True)
    print()
    if digest.hexdigest() != expected_md5:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Checksum verification failed for {target.name}")
    partial.replace(target)


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"Unsafe path in dataset archive: {member.filename}")
            target = (destination / Path(*relative.parts)).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError(f"Unsafe path in dataset archive: {member.filename}")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def download_guitarset(data_dir: Path) -> None:
    raw_dir = data_dir / "downloads"
    for filename, (url, checksum) in GUITARSET_URLS.items():
        archive = raw_dir / filename
        download(url, archive, checksum)
        safe_extract(archive, data_dir)


def _quality_labels() -> list[str]:
    return ["N"] + [
        pitch + quality for pitch in PITCH_NAMES for quality in QUALITIES
    ]


def _windows_for_track(audio_path: Path, annotation_path: Path) -> tuple[Any, Any]:
    import librosa
    import numpy as np

    with annotation_path.open(encoding="utf-8") as source:
        jams = json.load(source)
    chord_annotations = [
        annotation
        for annotation in jams.get("annotations", [])
        if annotation.get("namespace") == "chord"
    ]
    if not chord_annotations:
        return np.empty((0, WINDOW_FRAMES, 12, 1), np.float32), np.empty((0,), np.int32)

    samples, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
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
    annotation = chord_annotations[-1]
    for event in annotation.get("data", []):
        label_id = chord_label_id(str(event.get("value", "")))
        if label_id is None:
            continue
        start_frame = max(0, int(float(event.get("time", 0)) / (HOP_LENGTH / SAMPLE_RATE)))
        end_frame = min(
            len(chroma),
            int((float(event.get("time", 0)) + float(event.get("duration", 0))) / (HOP_LENGTH / SAMPLE_RATE)),
        )
        if end_frame - start_frame < WINDOW_FRAMES:
            continue
        for center in range(
            start_frame + half, end_frame - half + 1, TRAIN_STRIDE_FRAMES
        ):
            start = center
            windows.append(padded[start : start + WINDOW_FRAMES])
            labels.append(label_id)
    if not windows:
        return np.empty((0, WINDOW_FRAMES, 12, 1), np.float32), np.empty((0,), np.int32)
    return np.asarray(windows, dtype=np.float32)[..., np.newaxis], np.asarray(labels, dtype=np.int32)


def build_model(num_labels: int) -> Any:
    import tensorflow as tf

    inputs = tf.keras.Input(shape=(WINDOW_FRAMES, 12, 1))
    x = tf.keras.layers.Conv2D(32, (5, 3), padding="same", activation="relu")(inputs)
    x = tf.keras.layers.MaxPooling2D((2, 1))(x)
    x = tf.keras.layers.Conv2D(64, (5, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPooling2D((2, 1))(x)
    x = tf.keras.layers.Conv2D(96, (3, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.35)(x)
    outputs = tf.keras.layers.Dense(num_labels, activation="softmax")(x)
    model = tf.keras.Model(inputs=inputs, outputs=outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def train(data_dir: Path, epochs: int, seed: int, max_groups: int | None) -> None:
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    import numpy as np
    import tensorflow as tf

    tf.config.threading.set_intra_op_parallelism_threads(1)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    random.seed(seed)
    np.random.seed(seed)
    tf.keras.utils.set_random_seed(seed)
    annotation_files = sorted(data_dir.rglob("*.jams"))
    audio_files = {
        path.stem.removesuffix("_mic"): path
        for path in data_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".wav", ".flac"}
    }
    if not annotation_files or not audio_files:
        raise RuntimeError(
            f"No GuitarSet audio and annotations found under {data_dir}; "
            "run with --download or place the extracted dataset there"
        )

    matched = [
        (annotation, audio_files[annotation.stem], annotation.stem[3:].rsplit("_", 1)[0])
        for annotation in annotation_files
        if annotation.stem in audio_files
    ]
    group_names = sorted({group for _, _, group in matched})
    available_group_count = len(group_names)
    if max_groups is not None:
        if max_groups < 2:
            raise ValueError("--max-groups must be at least 2 for a held-out validation split")
        random.Random(seed).shuffle(group_names)
        selected_groups = set(group_names[:max_groups])
        matched = [item for item in matched if item[2] in selected_groups]
        print(f"Using {len(selected_groups)} of {available_group_count} song groups")

    tracks: dict[str, list[tuple[Any, Any]]] = {}
    for index, (annotation, audio_path, group) in enumerate(matched, start=1):
        print(f"\rPreparing track {index}/{len(matched)}: {annotation.stem}", end="", flush=True)
        track_windows, track_labels = _windows_for_track(audio_path, annotation)
        if len(track_labels):
            tracks.setdefault(group, []).append((track_windows, track_labels))
    print()
    if len(tracks) < 2:
        raise RuntimeError("At least two annotated GuitarSet tracks with matching audio are required")

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

    augmented_x = [train_x]
    augmented_y = [train_y]
    for shift in (-2, 2):
        augmented_x.append(np.roll(train_x, shift, axis=2))
        roots = np.where(train_y == 0, 0, (train_y - 1) // len(QUALITIES))
        families = np.where(train_y == 0, 0, (train_y - 1) % len(QUALITIES))
        shifted_roots = (roots + shift) % 12
        augmented_y.append(
            np.where(train_y == 0, 0, 1 + shifted_roots * len(QUALITIES) + families).astype(np.int32)
        )
    train_x = np.concatenate(augmented_x)
    train_y = np.concatenate(augmented_y)
    labels = _quality_labels()
    class_counts = np.bincount(train_y, minlength=len(labels))
    class_weights = {
        class_id: min(5.0, float(np.sqrt(len(train_y) / (len(labels) * count))))
        for class_id, count in enumerate(class_counts)
        if count
    }

    model = build_model(len(labels))
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=7, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=3, min_lr=0.00005
        ),
    ]
    model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        epochs=epochs,
        batch_size=128,
        class_weight=class_weights,
        callbacks=callbacks,
        verbose=2,
    )
    loss, accuracy = model.evaluate(validation_x, validation_y, verbose=0)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_model = MODEL_PATH.with_name(MODEL_PATH.stem + ".tmp.keras")
    model.save(temporary_model)
    temporary_model.replace(MODEL_PATH)
    temporary_labels = LABELS_PATH.with_suffix(".tmp.json")
    temporary_labels.write_text(json.dumps(labels), encoding="utf-8")
    temporary_labels.replace(LABELS_PATH)
    print(
        f"Saved {MODEL_PATH}; track-held-out validation accuracy={accuracy:.3f}, "
        f"loss={loss:.3f} ({len(training_groups)} train / {len(validation_groups)} validation groups)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ChordLab's TensorFlow chord recognizer")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=ROOT / "backend/data/guitarset",
        help="Directory for the extracted GuitarSet audio and annotation archives",
    )
    parser.add_argument("--download", action="store_true", help="Download GuitarSet from Zenodo (~700 MB)")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--max-groups",
        type=int,
        help="Use a reproducible subset of song groups for a faster initial training run",
    )
    args = parser.parse_args()
    if args.epochs < 1:
        parser.error("--epochs must be positive")
    if args.download:
        download_guitarset(args.data_dir)
    train(args.data_dir, args.epochs, args.seed, args.max_groups)


if __name__ == "__main__":
    main()
