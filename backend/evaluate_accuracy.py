"""
Evaluate accuracy for:
1. TensorFlow ACR Models (English, Hindi, Tamil, Master)
2. In-System ACR Model (Client-side template matching + HMM transition logic)
3. Stem Classifier / Separation Model (Vocals, Piano, Drums, Bass Guitar, Acoustic Guitar, Electric Guitar, Flute, Violin, Ukulele)
"""
import glob
import json
import os
import sys
from pathlib import Path
import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
import tensorflow as tf
import librosa

ROOT = Path(__file__).resolve().parent.parent
from backend.chord_model import analyze_audio, _load_model, get_model_paths
from backend.stem_model import classify_stem, STEM_MODEL_PATH, STEM_LABELS_PATH
from backend.train_stem_model import extract_mel_windows

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def parse_chord(label: str) -> tuple[str, str]:
    """Parse chord label into (root, quality_family).
    Root: C, C#, D, etc.
    Quality: 'maj', 'min', '7', 'maj7', 'min7', 'sus', 'dim', 'aug'
    """
    token = label.strip()
    if token in ("N", "X", "NC", ""):
        return "N", "N"
    for r in ["C#", "Db", "D#", "Eb", "F#", "Gb", "G#", "Ab", "A#", "Bb", "C", "D", "E", "F", "G", "A", "B"]:
        if token.startswith(r):
            suffix = token[len(r):].lower()
            if "dim" in suffix:
                qual = "dim"
            elif "aug" in suffix:
                qual = "aug"
            elif "sus" in suffix:
                qual = "sus"
            elif "maj7" in suffix:
                qual = "maj7"
            elif "m7" in suffix or "min7" in suffix:
                qual = "min7"
            elif "7" in suffix:
                qual = "7"
            elif "m" in suffix or "min" in suffix:
                qual = "min"
            else:
                qual = "maj"
            return r, qual
    return token, "maj"


def chords_match(p_label: str, gt_label: str) -> tuple[bool, bool]:
    """Check (chord_match, root_match) under standard MIREX triad & root evaluation criteria."""
    if p_label == gt_label:
        return True, True
    p_root, p_qual = parse_chord(p_label)
    gt_root, gt_qual = parse_chord(gt_label)
    if p_root == "N" or gt_root == "N":
        return p_root == gt_root, p_root == gt_root
    root_match = (p_root == gt_root)
    # Triad equivalence
    p_triad = "min" if "min" in p_qual or p_qual == "dim" else "maj"
    gt_triad = "min" if "min" in gt_qual or gt_qual == "dim" else "maj"
    chord_match = root_match and (p_qual == gt_qual or p_triad == gt_triad)
    return chord_match, root_match


def evaluate_tensorflow_acr():
    print("=" * 60)
    print("EVALUATING TENSORFLOW ACR MODELS")
    print("=" * 60)
    
    results = {}
    
    for lang in ["english", "hindi", "tamil"]:
        ann_files = sorted(glob.glob(f"backend/data/datasets/{lang}/annotations/*.json"))
        # Split 20% test set
        test_files = ann_files[int(len(ann_files) * 0.8):]
        if not test_files:
            test_files = ann_files[:5]
            
        total_time = 0.0
        correct_time = 0.0
        root_correct_time = 0.0
        
        for ann_path in test_files:
            with open(ann_path, "r", encoding="utf-8") as f:
                ann = json.load(f)
            wav_path = Path(ann_path).parent.parent / "audio" / (Path(ann_path).stem + ".wav")
            if not wav_path.is_file():
                continue
                
            with open(wav_path, "rb") as f:
                audio_bytes = f.read()
                
            pred = analyze_audio(audio_bytes, language=lang)
            pred_events = pred.get("chords", [])
            gt_events = ann.get("events", [])
            
            # Sample at 10 Hz across duration
            duration = min(pred.get("duration", 0), ann.get("duration", 0))
            if duration <= 0:
                continue
                
            time_points = np.arange(0, duration, 0.1)
            for t in time_points:
                gt_label = next((ge["chord"] for ge in gt_events if ge["start"] <= t < ge["end"]), "N")
                p_label = next((pe["label"] for pe in pred_events if pe["start"] <= t < pe["end"]), "N")
                
                ch_m, r_m = chords_match(p_label, gt_label)
                total_time += 0.1
                if ch_m:
                    correct_time += 0.1
                if r_m:
                    root_correct_time += 0.1

        acc_pct = (correct_time / total_time * 100) if total_time > 0 else 0.0
        root_acc_pct = (root_correct_time / total_time * 100) if total_time > 0 else 0.0
        results[lang] = {
            "test_tracks": len(test_files),
            "chord_accuracy_pct": round(acc_pct, 2),
            "root_accuracy_pct": round(root_acc_pct, 2),
        }
        print(f"[{lang.upper()}] Test Tracks: {len(test_files)} | Chord Accuracy: {acc_pct:.1f}% | Root Accuracy: {root_acc_pct:.1f}%")

    # Evaluate master model on all languages combined
    all_test = []
    for lang in ["english", "hindi", "tamil"]:
        ann_files = sorted(glob.glob(f"backend/data/datasets/{lang}/annotations/*.json"))
        all_test.extend(ann_files[int(len(ann_files) * 0.8):])
        
    m_total = 0.0
    m_correct = 0.0
    m_root = 0.0
    for ann_path in all_test:
        with open(ann_path, "r", encoding="utf-8") as f:
            ann = json.load(f)
        wav_path = Path(ann_path).parent.parent / "audio" / (Path(ann_path).stem + ".wav")
        if not wav_path.is_file():
            continue
        with open(wav_path, "rb") as f:
            audio_bytes = f.read()
        pred = analyze_audio(audio_bytes, language="auto")
        pred_events = pred.get("chords", [])
        gt_events = ann.get("events", [])
        duration = min(pred.get("duration", 0), ann.get("duration", 0))
        for t in np.arange(0, duration, 0.1):
            gt_label = next((ge["chord"] for ge in gt_events if ge["start"] <= t < ge["end"]), "N")
            p_label = next((pe["label"] for pe in pred_events if pe["start"] <= t < pe["end"]), "N")
            ch_m, r_m = chords_match(p_label, gt_label)
            m_total += 0.1
            if ch_m:
                m_correct += 0.1
            if r_m:
                m_root += 0.1

    m_acc = (m_correct / m_total * 100) if m_total > 0 else 0.0
    m_root_acc = (m_root / m_total * 100) if m_total > 0 else 0.0
    results["master"] = {
        "test_tracks": len(all_test),
        "chord_accuracy_pct": round(m_acc, 2),
        "root_accuracy_pct": round(m_root_acc, 2),
    }
    print(f"[MASTER] Test Tracks: {len(all_test)} | Chord Accuracy: {m_acc:.1f}% | Root Accuracy: {m_root_acc:.1f}%\n")
    return results


def evaluate_stem_classifier():
    print("=" * 60)
    print("EVALUATING 9-INSTRUMENT STEM CLASSIFICATION MODEL")
    print("=" * 60)
    
    stem_files = sorted(glob.glob("backend/data/stems/*/*.wav"))
    if not stem_files:
        print("No stem audio files found.")
        return {}
        
    labels = json.loads(STEM_LABELS_PATH.read_text(encoding="utf-8"))
    model = tf.keras.models.load_model(STEM_MODEL_PATH)
    
    correct_by_stem = {s: 0 for s in labels}
    total_by_stem = {s: 0 for s in labels}
    
    for wav_path in stem_files:
        p = Path(wav_path)
        true_stem = p.parent.name
        if true_stem not in labels:
            continue
            
        windows = extract_mel_windows(p)
        if len(windows) == 0:
            continue
            
        probs = model.predict(windows, verbose=0)
        avg_prob = np.mean(probs, axis=0)
        pred_stem = labels[int(np.argmax(avg_prob))]
        
        total_by_stem[true_stem] += 1
        if pred_stem == true_stem:
            correct_by_stem[true_stem] += 1
            
    total_samples = sum(total_by_stem.values())
    total_correct = sum(correct_by_stem.values())
    overall_acc = (total_correct / total_samples * 100) if total_samples > 0 else 0.0
    
    per_stem_acc = {}
    for s in labels:
        s_acc = (correct_by_stem[s] / total_by_stem[s] * 100) if total_by_stem[s] > 0 else 0.0
        per_stem_acc[s] = {
            "correct": correct_by_stem[s],
            "total": total_by_stem[s],
            "accuracy_pct": round(s_acc, 1)
        }
        print(f"[{s.upper()}] {correct_by_stem[s]}/{total_by_stem[s]} ({s_acc:.1f}%)")
        
    print(f"\n[OVERALL STEM ACCURACY] {total_correct}/{total_samples} = {overall_acc:.2f}%\n")
    return {
        "overall_accuracy_pct": round(overall_acc, 2),
        "per_stem": per_stem_acc
    }


def evaluate_in_system_acr():
    print("=" * 60)
    print("EVALUATING IN-SYSTEM (WEB AUDIO CHROMA HMM) ACR")
    print("=" * 60)

    QUALITIES = [
        ("", [0, 4, 7], 1.05),
        ("m", [0, 3, 7], 1.05),
        ("7", [0, 4, 7, 10], 0.88),
        ("m7", [0, 3, 7, 10], 0.87),
        ("maj7", [0, 4, 7, 11], 0.85),
        ("sus4", [0, 5, 7], 0.85),
        ("sus2", [0, 2, 7], 0.83),
        ("dim", [0, 3, 6], 0.80),
    ]
    templates = []
    template_labels = []
    weights = []
    for root in range(12):
        for suffix, ivs, w in QUALITIES:
            vec = np.zeros(12, dtype=np.float32)
            for idx, iv in enumerate(ivs):
                vec[(root + iv) % 12] = 1.25 if idx == 0 else 1.0
            vec = vec / (np.linalg.norm(vec) or 1.0)
            templates.append(vec)
            template_labels.append(NOTE_NAMES[root] + suffix)
            weights.append(w)
    templates = np.array(templates)
    weights = np.array(weights)

    from scipy.ndimage import median_filter

    sys_results = {}

    for lang in ["english", "hindi", "tamil"]:
        ann_files = sorted(glob.glob(f"backend/data/datasets/{lang}/annotations/*.json"))
        test_files = ann_files[int(len(ann_files) * 0.8):]
        if not test_files:
            test_files = ann_files[:5]
            
        total_time = 0.0
        correct_time = 0.0
        root_correct_time = 0.0
        
        for ann_path in test_files:
            with open(ann_path, "r", encoding="utf-8") as f:
                ann = json.load(f)
            wav_path = Path(ann_path).parent.parent / "audio" / (Path(ann_path).stem + ".wav")
            if not wav_path.is_file():
                continue
                
            y, sr = librosa.load(wav_path, sr=22050, mono=True)
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=1024, n_chroma=12).T
            
            # Stationary drone suppression (essential for modal Hindustani/Carnatic drone textures)
            drone = np.percentile(chroma, 15, axis=0, keepdims=True)
            chroma = np.maximum(0.0, chroma - 0.6 * drone)
            
            # 7-frame median smoothing to model chord duration persistence
            chroma = median_filter(chroma, size=(7, 1))
            
            chroma_norm = chroma / (np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-6)
            scores = np.dot(chroma_norm, templates.T) * weights
            best_idx = np.argmax(scores, axis=1)
            
            hop_time = 1024 / sr
            gt_events = ann.get("events", [])
            for frame_idx, b_idx in enumerate(best_idx):
                t = frame_idx * hop_time
                gt_label = next((ge["chord"] for ge in gt_events if ge["start"] <= t < ge["end"]), "N")
                p_label = template_labels[b_idx]
                
                ch_m, r_m = chords_match(p_label, gt_label)
                total_time += hop_time
                if ch_m:
                    correct_time += hop_time
                if r_m:
                    root_correct_time += hop_time

        acc = (correct_time / total_time * 100) if total_time > 0 else 0.0
        root_acc = (root_correct_time / total_time * 100) if total_time > 0 else 0.0
        sys_results[lang] = {
            "chord_accuracy_pct": round(acc, 2),
            "root_accuracy_pct": round(root_acc, 2),
        }
        print(f"[{lang.upper()} IN-SYSTEM] Chord Accuracy: {acc:.1f}% | Root Accuracy: {root_acc:.1f}%")

    print()
    return sys_results


if __name__ == "__main__":
    tf_acc = evaluate_tensorflow_acr()
    sys_acc = evaluate_in_system_acr()
    stem_acc = evaluate_stem_classifier()
    
    summary = {
        "tensorflow_acr": tf_acc,
        "insystem_acr": sys_acc,
        "stem_classifier": stem_acc,
    }
    with open("backend/data/evaluation_metrics.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print("Saved all metrics to backend/data/evaluation_metrics.json")
