from __future__ import annotations

import argparse
import json
import os
import random
from pathlib import Path
from typing import Any

from backend.dataset_collector import SAMPLE_RATE, generate_stem_datasets

ROOT = Path(__file__).resolve().parent.parent
STEM_MODEL_PATH = Path(os.getenv("STEM_MODEL_PATH", ROOT / "backend/data/stem_classifier.keras"))
STEM_LABELS_PATH = STEM_MODEL_PATH.with_suffix(".labels.json")
STEM_NAMES = [
    "vocals",
    "piano",
    "drums",
    "bass_guitar",
    "acoustic_guitar",
    "electric_guitar",
    "flute",
    "violin",
    "ukulele",
]
N_MELS = 64
WINDOW_FRAMES = 64
HOP_LENGTH = 512
N_FFT = 2048


def build_stem_classifier(num_classes: int = len(STEM_NAMES)) -> Any:
    """Build and compile a 2D Convolutional neural network for stem audio classification."""
    import tensorflow as tf

    inputs = tf.keras.Input(shape=(WINDOW_FRAMES, N_MELS, 1))
    x = tf.keras.layers.Conv2D(32, (3, 3), padding="same", activation="relu")(inputs)
    x = tf.keras.layers.MaxPooling2D((2, 2))(x)
    x = tf.keras.layers.Dropout(0.2)(x)

    x = tf.keras.layers.Conv2D(64, (3, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPooling2D((2, 2))(x)
    x = tf.keras.layers.Dropout(0.25)(x)

    x = tf.keras.layers.Conv2D(128, (3, 3), padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)

    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)

    model = tf.keras.Model(inputs=inputs, outputs=outputs, name="chordlab_stem_classifier")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=[tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy")],
    )
    return model


def extract_mel_windows(audio_input: Any) -> Any:
    """Extract sliding log-mel spectrogram windows from an audio file or sample array."""
    import librosa
    import numpy as np

    if isinstance(audio_input, np.ndarray):
        samples = audio_input
    else:
        audio_path = Path(audio_input)
        try:
            samples, sr = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
        except Exception:
            import soundfile as sf
            samples, sr = sf.read(audio_path, dtype="float32", always_2d=False)
            if samples.ndim > 1:
                samples = np.mean(samples, axis=1)

    if len(samples) < N_FFT:
        return np.empty((0, WINDOW_FRAMES, N_MELS, 1), dtype=np.float32)

    mel = librosa.feature.melspectrogram(
        y=samples,
        sr=SAMPLE_RATE,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        n_mels=N_MELS,
        fmin=20,
        fmax=11000,
    )
    log_mel = librosa.power_to_db(mel, ref=np.max).T  # (frames, N_MELS)

    # Normalize to [0, 1] range approximately
    log_mel = (log_mel + 80.0) / 80.0
    log_mel = np.clip(log_mel, 0.0, 1.0)

    # Slice windows
    windows = []
    stride = 22  # frames stride
    for start in range(0, len(log_mel) - WINDOW_FRAMES + 1, stride):
        windows.append(log_mel[start : start + WINDOW_FRAMES])

    if not windows:
        # Pad if short
        padded = np.pad(log_mel, ((0, max(0, WINDOW_FRAMES - len(log_mel))), (0, 0)), mode="reflect")
        windows.append(padded[:WINDOW_FRAMES])

    return np.asarray(windows, dtype=np.float32)[..., np.newaxis]


def train_stem_classifier(data_dir: Path, epochs: int = 15, seed: int = 42) -> None:
    """Train the deep neural stem classifier on multi-track stem audio."""
    import numpy as np
    import tensorflow as tf

    random.seed(seed)
    np.random.seed(seed)
    tf.keras.utils.set_random_seed(seed)

    stems_dir = data_dir / "stems"
    wav_files_found = list(stems_dir.rglob("*.wav"))
    if not wav_files_found:
        print("Stem audio dataset not found; synthesizing multi-track stem corpus...")
        counts = generate_stem_datasets(stems_dir, num_stems_each=20)
        print("Generated stem datasets:", counts)

    all_windows = []
    all_labels = []

    print("Extracting acoustic features from stem datasets...")
    for class_id, stem_name in enumerate(STEM_NAMES):
        class_dir = stems_dir / stem_name
        files = sorted(class_dir.glob("*.wav"))
        print(f"  Processing stem '{stem_name}' ({len(files)} tracks)...")
        for f in files:
            windows = extract_mel_windows(f)
            if len(windows):
                all_windows.append(windows)
                all_labels.append(np.full((len(windows),), class_id, dtype=np.int32))

    if not all_windows:
        raise RuntimeError("No stem training data could be extracted")

    X = np.concatenate(all_windows, axis=0)
    y = np.concatenate(all_labels, axis=0)

    # Shuffle
    indices = np.arange(len(X))
    np.random.shuffle(indices)
    X = X[indices]
    y = y[indices]

    val_split = int(0.2 * len(X))
    X_val, y_val = X[:val_split], y[:val_split]
    X_train, y_train = X[val_split:], y[val_split:]

    print(f"Stem training data: {len(X_train)} samples, validation: {len(X_val)} samples.")

    model = build_stem_classifier(len(STEM_NAMES))
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=0.00005),
    ]

    print(f"Training deep neural stem classifier for {epochs} epochs...")
    model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=32,
        callbacks=callbacks,
        verbose=1,
    )

    loss, acc = model.evaluate(X_val, y_val, verbose=0)
    print(f"Stem model validation accuracy: {acc * 100:.2f}%, loss: {loss:.4f}")

    STEM_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save(STEM_MODEL_PATH)
    STEM_LABELS_PATH.write_text(json.dumps(STEM_NAMES, indent=2), encoding="utf-8")
    print(f"Successfully saved stem classifier to {STEM_MODEL_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ChordLab's Neural Stem Classifier")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "backend/data", help="Data directory")
    parser.add_argument("--epochs", type=int, default=15, help="Training epochs")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    train_stem_classifier(args.data_dir, epochs=args.epochs, seed=args.seed)


if __name__ == "__main__":
    main()
