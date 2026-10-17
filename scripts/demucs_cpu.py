"""Run Demucs with CPU-friendly audio I/O that bypasses TorchCodec and external FFmpeg dependencies."""

import os
import shutil
import sys

import soundfile as sf
import torch
import torchaudio

# Add bundled ffmpeg to PATH if available from imageio_ffmpeg
try:
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
    target_ffmpeg = os.path.join(ffmpeg_dir, "ffmpeg.exe")
    if not os.path.exists(target_ffmpeg):
        shutil.copyfile(ffmpeg_exe, target_ffmpeg)
    if ffmpeg_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass


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
    samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
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
    sf.write(path, samples, sample_rate, subtype="PCM_16")


torchaudio.load = load_audio
torchaudio.save = save_audio

# Monkey-patch Demucs Separator._load_audio to load via soundfile and avoid ffmpeg dependency
try:
    import demucs.api
    from demucs.audio import convert_audio

    orig_load_audio = demucs.api.Separator._load_audio

    def robust_load_audio(self, track):
        """Robust audio loader using SoundFile to decode audio files without requiring external FFmpeg."""
        # 1. Primary: Load via soundfile (supports WAV, MP3, FLAC, OGG without external ffmpeg)
        try:
            samples, sr = sf.read(str(track), dtype="float32", always_2d=True)
            if samples.shape[1] == 1:
                import numpy as np

                samples = np.tile(samples, (1, 2))
            wav = torch.from_numpy(samples.T.copy())
            return convert_audio(wav, int(sr), self._samplerate, self._audio_channels)
        except Exception:
            pass

        # 2. Secondary: Fall back to sphn
        try:
            import sphn

            data, sr = sphn.read(str(track))
            wav = torch.from_numpy(data)
            if wav.ndim == 1:
                wav = wav.unsqueeze(0)
            return convert_audio(wav, int(sr), self._samplerate, self._audio_channels)
        except Exception:
            pass

        # 3. Fall back to native Demucs implementation (which calls ffmpeg)
        return orig_load_audio(self, track)

    demucs.api.Separator._load_audio = robust_load_audio
except Exception:
    pass

from demucs.separate import main


if __name__ == "__main__":
    sys.exit(main())