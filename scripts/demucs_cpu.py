"""Run Demucs with CPU-friendly audio I/O that bypasses TorchCodec."""

import sys

import soundfile
import torch
import torchaudio


def load_audio(path: str, *args, **kwargs):
    """Load an audio file into a PyTorch tensor via soundfile (bypassing TorchCodec).

    Reads raw audio frames as 32-bit floats, transposes to channel-first format (channels, samples),
    and converts into a PyTorch Tensor. Monkey-patched onto `torchaudio.load`.

    Args:
        path: Path to the audio file on disk.
        *args: Variable length positional arguments forwarded from callers.
        **kwargs: Arbitrary keyword arguments forwarded from callers.

    Returns:
        tuple[torch.Tensor, int]: Audio tensor of shape (channels, samples) and sample rate.
    """
    samples, sample_rate = soundfile.read(path, dtype="float32", always_2d=True)
    return torch.from_numpy(samples.T.copy()), sample_rate


def save_audio(path: str, audio: torch.Tensor, sample_rate: int, *args, **kwargs):
    """Save an audio PyTorch tensor to disk as a 16-bit PCM WAV file via soundfile.

    Converts PyTorch tensor from channel-first (channels, samples) to sample-first (samples, channels),
    detaches from graph, and writes out via soundfile. Monkey-patched onto `torchaudio.save`.

    Args:
        path: Destination audio file path.
        audio: PyTorch tensor containing audio waveform data.
        sample_rate: Audio sampling frequency in Hz.
        *args: Variable length positional arguments.
        **kwargs: Arbitrary keyword arguments.
    """
    samples = audio.detach().cpu().numpy().T
    soundfile.write(path, samples, sample_rate, subtype="PCM_16")


torchaudio.load = load_audio
torchaudio.save = save_audio

from demucs.separate import main


if __name__ == "__main__":
    sys.exit(main())