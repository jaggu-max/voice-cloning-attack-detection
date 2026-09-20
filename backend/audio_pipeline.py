"""
VoiceGuard — Shared Audio Processing Pipeline

All audio inputs (laptop mic, phone Wi-Fi, phone USB, file upload, recording)
pass through this single module to ensure identical preprocessing and inference.

Pipeline:
    Raw audio bytes
        ↓ decode_and_preprocess()  (FFmpeg)
        ↓ 16 kHz, mono, s16 WAV
        ↓ detect_silence()
        ↓ segment_audio()          (4-second windows)
        ↓ run_inference()          (Pellav2 model)
        ↓ aggregate_predictions()
        → PipelineResult
"""

from __future__ import annotations

import glob
import logging
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np
import soundfile as sf
import torch

log = logging.getLogger("voiceguard.pipeline")

# ── Model constants (from pellav2_infer.py) ──────────────────────────────────
SR = 16_000          # Required sample rate
WINDOW_SAMPLES = 4 * SR   # 4-second window (64 000 samples)
RAW_THRESHOLD = 0.50  # Model's native decision threshold (sigmoid output)

# ── Quality thresholds ────────────────────────────────────────────────────────
MIN_DURATION_S = 1.0       # Skip windows shorter than this
MIN_RMS = 0.003            # Silence guard: root mean square energy floor
MIN_STD = 0.0002           # Silence guard: standard deviation floor
MAX_SILENCE_RATIO = 0.60   # Reject windows with >60% near-zero samples

# ── Detection thresholds (file / recorded audio — uncalibrated) ───────────────
DETECTION_THRESHOLD = 0.50   # Raw model threshold for non-live audio
SUSPICIOUS_THRESHOLD = 0.42  # Borderline band (between real and fake)

# Minimum windows with valid speech before producing a confident result
MIN_GOOD_WINDOWS = 2


@dataclass
class WindowResult:
    index: int
    p_fake: float          # Raw model output (0=human, 1=AI)
    quality: str           # 'good' | 'silence' | 'low_energy'
    is_speech: bool


@dataclass
class PipelineResult:
    classification: str    # 'likely_real' | 'suspicious' | 'likely_ai_generated' | 'insufficient'
    label: str
    p_fake: float          # Aggregated score
    confidence: float      # 0–100 %
    windows_total: int
    windows_speech: int
    windows_rejected: int
    duration_s: float
    audio_quality: str     # 'good' | 'low' | 'insufficient'
    window_results: List[WindowResult] = field(default_factory=list)
    debug: dict = field(default_factory=dict)


# ── Global model cache ────────────────────────────────────────────────────────
_GLOBAL_MODEL = None
_GLOBAL_DEVICE: str = "cuda" if torch.cuda.is_available() else "cpu"


def get_model():
    """Load Pellav2 model once and cache globally."""
    global _GLOBAL_MODEL
    if _GLOBAL_MODEL is None:
        project_dir = Path(__file__).resolve().parent.parent
        model_path_env = os.getenv("MODEL_PATH", str(project_dir / "pellav2_detector.pt"))
        model_path = Path(model_path_env).resolve()

        log.info("Loading Pellav2 model on %s from %s", _GLOBAL_DEVICE, model_path)
        import sys
        if str(project_dir) not in sys.path:
            sys.path.insert(0, str(project_dir))
        from pellav2_infer import Detector
        model = Detector().to(_GLOBAL_DEVICE)
        model.load_state_dict(torch.load(model_path, map_location=_GLOBAL_DEVICE))
        model.eval()
        _GLOBAL_MODEL = model
        log.info("Pellav2 model loaded.")
    return _GLOBAL_MODEL


# ── FFmpeg helper ─────────────────────────────────────────────────────────────
def _resolve_ffmpeg() -> str:
    """Find FFmpeg binary (system PATH or local project directory)."""
    from pathlib import Path
    import shutil

    env_path = os.getenv("FFMPEG_PATH", "ffmpeg")
    if Path(env_path).is_file():
        return str(Path(env_path).resolve())
    found = shutil.which(env_path)
    if found:
        return found
    project_dir = Path(__file__).resolve().parent.parent
    for name in ("ffmpeg.exe", "ffmpeg"):
        candidate = project_dir / name
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("FFmpeg not found. Set FFMPEG_PATH env or place ffmpeg.exe in project root.")


# ── Core pipeline steps ───────────────────────────────────────────────────────

def decode_and_preprocess(audio_bytes: bytes, ext: str, tmpdir: str) -> tuple[str, dict]:
    """
    Convert any audio format to 16 kHz mono s16 WAV with voice bandpass filter.
    Returns (wav_path, metadata_dict).
    """
    ffmpeg = _resolve_ffmpeg()
    in_path = os.path.join(tmpdir, f"input{ext}")
    with open(in_path, "wb") as f:
        f.write(audio_bytes)

    out_path = os.path.join(tmpdir, "preprocessed.wav")

    cmd = [
        ffmpeg, "-y", "-i", in_path,
        "-af", "highpass=f=80,lowpass=f=7500",
        "-ar", str(SR),
        "-ac", "1",
        "-sample_fmt", "s16",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log.warning("Bandpass filter failed, falling back: %s", result.stderr[:300])
        # Fallback: plain resample without filter
        cmd2 = [ffmpeg, "-y", "-i", in_path, "-ar", str(SR), "-ac", "1", "-sample_fmt", "s16", out_path]
        result2 = subprocess.run(cmd2, capture_output=True, text=True)
        if result2.returncode != 0:
            raise ValueError(f"FFmpeg could not decode audio: {result2.stderr[:300]}")

    # Read metadata
    meta = _read_wav_metadata(out_path)
    log.debug("Decoded: %s", meta)
    return out_path, meta


def _read_wav_metadata(wav_path: str) -> dict:
    """Read WAV file and return metadata + raw samples."""
    import wave
    with wave.open(wav_path, "rb") as w:
        n_ch = w.getnchannels()
        sr = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)

    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    duration = n_frames / sr if sr > 0 else 0.0
    rms = float(np.sqrt(np.mean(samples ** 2))) if len(samples) > 0 else 0.0
    peak = float(np.max(np.abs(samples))) if len(samples) > 0 else 0.0
    std = float(samples.std()) if len(samples) > 0 else 0.0
    silence_ratio = float(np.mean(np.abs(samples) < 1e-4)) if len(samples) > 0 else 1.0

    return {
        "sample_rate": sr,
        "channels": n_ch,
        "n_frames": n_frames,
        "duration_s": duration,
        "rms": rms,
        "peak": peak,
        "std": std,
        "silence_ratio": silence_ratio,
        "samples": samples,
    }


def segment_audio(samples: np.ndarray, sr: int = SR) -> List[np.ndarray]:
    """
    Segment a 1-D float32 audio array into non-overlapping 4-second windows.
    Each window is exactly WINDOW_SAMPLES long.
    - Windows shorter than MIN_DURATION_S at the end are dropped.
    """
    windows = []
    step = WINDOW_SAMPLES
    n = len(samples)

    for start in range(0, n, step):
        chunk = samples[start: start + step]
        chunk_dur = len(chunk) / sr
        if chunk_dur < MIN_DURATION_S:
            log.debug("Dropping short tail window: %.2f s", chunk_dur)
            continue
        if len(chunk) < step:
            chunk = np.pad(chunk, (0, step - len(chunk)))
        windows.append(chunk.astype(np.float32))

    return windows


def detect_silence(chunk: np.ndarray) -> tuple[bool, str]:
    """
    Return (is_speech, quality_label) for a single audio chunk.
    - is_speech=False means window should be skipped for inference.
    """
    if len(chunk) == 0:
        return False, "empty"
    rms = float(np.sqrt(np.mean(chunk ** 2)))
    std = float(chunk.std())
    silence_ratio = float(np.mean(np.abs(chunk) < 1e-4))

    if rms < MIN_RMS or std < MIN_STD:
        return False, "silence"
    if silence_ratio > MAX_SILENCE_RATIO:
        return False, "low_energy"
    return True, "good"


def run_inference(windows: List[np.ndarray]) -> List[WindowResult]:
    """
    Run Pellav2 inference on a list of 4-second windows.
    Returns WindowResult per window including quality gate.
    """
    model = get_model()
    results: List[WindowResult] = []
    tensors = []
    tensor_map: List[int] = []  # maps batch index → window index

    # Pre-screen for silence
    for idx, chunk in enumerate(windows):
        is_speech, quality = detect_silence(chunk)
        results.append(WindowResult(index=idx, p_fake=0.0, quality=quality, is_speech=is_speech))
        if is_speech:
            # Normalize
            std = float(chunk.std())
            norm = (chunk - chunk.mean()) / (std + 1e-7)
            tensors.append(torch.from_numpy(norm).float())
            tensor_map.append(idx)

    if not tensors:
        return results

    with torch.no_grad():
        batch = torch.stack(tensors).to(_GLOBAL_DEVICE)
        logits = model(batch)
        probs = torch.sigmoid(logits)
        if probs.ndim == 0:
            probs_list = [probs.item()]
        else:
            probs_list = [float(p) for p in probs.tolist()]

    for batch_idx, (win_idx, p_raw) in enumerate(zip(tensor_map, probs_list)):
        results[win_idx].p_fake = float(p_raw)
        log.debug("Window %02d → p_fake=%.4f (%s)",
                  win_idx, p_raw,
                  "AI" if p_raw >= RAW_THRESHOLD else "human")

    return results


def aggregate_predictions(
    window_results: List[WindowResult],
    is_live: bool = False,
) -> PipelineResult:
    """
    Aggregate per-window predictions into a final classification.

    For live audio:  apply calibration (WebM/Opus codec compensation).
    For file/recorded audio: use raw model output directly.
    """
    total = len(window_results)
    speech_results = [w for w in window_results if w.is_speech]
    rejected = total - len(speech_results)
    duration_s = total * 4.0

    if len(speech_results) < MIN_GOOD_WINDOWS:
        # Not enough usable speech to classify confidently
        return PipelineResult(
            classification="insufficient",
            label="Insufficient Audio",
            p_fake=0.0,
            confidence=0.0,
            windows_total=total,
            windows_speech=len(speech_results),
            windows_rejected=rejected,
            duration_s=duration_s,
            audio_quality="insufficient",
            window_results=window_results,
            debug={"reason": f"Only {len(speech_results)} speech window(s) found (min={MIN_GOOD_WINDOWS})"},
        )

    p_fakes = [w.p_fake for w in speech_results]

    if is_live:
        # Apply calibration for live WebM/Opus browser streams
        p_fakes = [_calibrate_live(p) for p in p_fakes]

    mean_p = float(np.mean(p_fakes))
    max_p = float(np.max(p_fakes))

    # Audio quality assessment
    if len(speech_results) >= 5 or (len(speech_results) / max(1, total)) >= 0.7:
        audio_quality = "good"
    elif len(speech_results) >= MIN_GOOD_WINDOWS:
        audio_quality = "low"
    else:
        audio_quality = "insufficient"

    # Classification
    threshold = RAW_THRESHOLD if not is_live else 0.55
    suspicious_t = SUSPICIOUS_THRESHOLD if not is_live else 0.42

    if mean_p >= threshold:
        classification = "likely_ai_generated"
        label = "AI-Generated Audio"
        confidence = round(mean_p * 100, 1)
    elif mean_p >= suspicious_t:
        classification = "suspicious"
        label = "Suspicious / Inconclusive"
        confidence = round(50.0 + abs(mean_p - 0.46) * 100, 1)
    else:
        classification = "likely_real"
        label = "Human Speech"
        # Confidence = how far below the threshold
        confidence = round((1.0 - mean_p) * 100, 1)

    # Cap confidence
    confidence = min(99.0, max(1.0, confidence))

    debug_info = {
        "window_p_fakes": [round(w.p_fake, 4) for w in speech_results],
        "mean_p_fake": round(mean_p, 4),
        "max_p_fake": round(max_p, 4),
        "is_live": is_live,
        "threshold_used": threshold,
    }
    log.info(
        "Aggregation: classification=%s mean_p=%.4f speech_wins=%d total=%d",
        classification, mean_p, len(speech_results), total,
    )

    return PipelineResult(
        classification=classification,
        label=label,
        p_fake=round(mean_p, 4),
        confidence=confidence,
        windows_total=total,
        windows_speech=len(speech_results),
        windows_rejected=rejected,
        duration_s=duration_s,
        audio_quality=audio_quality,
        window_results=window_results,
        debug=debug_info,
    )


def _calibrate_live(raw_p: float) -> float:
    """
    Calibrate raw Pellav2 probability for live WebM/Opus browser streams.

    Browser WebM/Opus compression introduces spectral quantization artifacts
    that artificially shift real-human-speech scores upward by ~35-40%.
    This calibration is ONLY applied to live streaming audio (is_live=True),
    NOT to file uploads or full recordings.

    Curve:
      raw ≤ 0.72 → compress heavily into [0, 0.25]  (maps ~0.58 → ~0.13)
      raw > 0.72 → scale into [0.25, 0.99]           (preserves high fake scores)
    """
    if raw_p <= 0.72:
        calibrated = ((raw_p / 0.72) ** 3.0) * 0.25
    else:
        calibrated = 0.25 + ((raw_p - 0.72) / 0.28) * 0.74
    return float(max(0.01, min(0.99, calibrated)))


# ── High-level entry points ───────────────────────────────────────────────────

def analyze_audio_bytes(
    audio_bytes: bytes,
    ext: str,
    filename: str = "audio",
    is_live: bool = False,
) -> tuple[PipelineResult, float]:
    """
    Full pipeline: bytes → PipelineResult.
    Returns (result, processing_time_seconds).

    is_live=True  → apply live calibration (for /api/live/analyze)
    is_live=False → raw model output     (for /api/analyze and /api/usb/stream)
    """
    t0 = time.time()

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path, meta = decode_and_preprocess(audio_bytes, ext, tmpdir)

        log.info(
            "Input [%s] decoded: sr=%d  dur=%.2fs  rms=%.5f  silence=%.1f%%",
            filename, meta["sample_rate"], meta["duration_s"],
            meta["rms"], meta["silence_ratio"] * 100,
        )

        samples: np.ndarray = meta["samples"]
        windows = segment_audio(samples, SR)

        log.info("Segmented into %d windows (4s each)", len(windows))

        if not windows:
            proc_time = time.time() - t0
            return PipelineResult(
                classification="insufficient",
                label="Insufficient Audio",
                p_fake=0.0,
                confidence=0.0,
                windows_total=0,
                windows_speech=0,
                windows_rejected=0,
                duration_s=meta["duration_s"],
                audio_quality="insufficient",
                debug={"reason": "Audio too short to produce any windows"},
            ), proc_time

        window_results = run_inference(windows)
        result = aggregate_predictions(window_results, is_live=is_live)
        result.duration_s = meta["duration_s"]  # Use actual decoded duration

    proc_time = time.time() - t0
    log.info("Pipeline complete: %s (%.2fs)", result.classification, proc_time)
    return result, proc_time
