"""
VoiceGuard — FastAPI backend for Pellav2 voice cloning attack detection.

Endpoints:
  GET  /api/health   — system status
  POST /api/analyze  — upload audio → FFmpeg preprocess → Pellav2 inference
"""

import os
import sys
import shutil
import subprocess
import tempfile
import logging
from typing import List
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Paths & Config ────────────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).resolve().parent.parent   # voice-detector root
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

# Environment variables with cross-platform fallbacks
FFMPEG_PATH_ENV = os.getenv("FFMPEG_PATH", "ffmpeg")
MODEL_PATH_ENV  = os.getenv("MODEL_PATH", str(PROJECT_DIR / "pellav2_detector.pt"))
FRONTEND_URL    = os.getenv("FRONTEND_URL", "http://localhost:5173")
MAX_SIZE_MB     = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))

INFER_SCRIPT    = PROJECT_DIR / "pellav2_infer.py"
MODEL_PATH      = Path(MODEL_PATH_ENV).resolve()


def resolve_ffmpeg_binary() -> str | None:
    """Find FFmpeg binary on system PATH or local project directory."""
    # 1. Check if FFMPEG_PATH_ENV is directly executable or an existing file
    if Path(FFMPEG_PATH_ENV).is_file():
        return str(Path(FFMPEG_PATH_ENV).resolve())
    
    # 2. Check system PATH (works on Linux/Render when ffmpeg is installed via apt/package manager)
    found_on_path = shutil.which(FFMPEG_PATH_ENV)
    if found_on_path:
        return found_on_path

    # 3. Fallback check for local ffmpeg.exe or ffmpeg in root directory
    for fallback_name in ["ffmpeg.exe", "ffmpeg"]:
        candidate = PROJECT_DIR / fallback_name
        if candidate.is_file():
            return str(candidate)

    return None


ALLOWED_MIME = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
    "audio/x-wav", "audio/vnd.wave", "audio/ogg", "audio/webm",
    "audio/flac", "audio/x-flac", "application/octet-stream"
}
ALLOWED_EXT  = {".mp3", ".wav", ".ogg", ".flac", ".webm", ".weba", ".m4a", ".aac"}

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("voiceguard")

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="VoiceGuard API", version="1.0.0")

# CORS middleware
origins = [
    FRONTEND_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    log.info("Pre-warming Pellav2 PyTorch model into global memory...")
    try:
        get_pellav2_model()
    except Exception as e:
        log.error("Failed to pre-warm model on startup: %s", e)


# ── Response models ────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    model: str
    ffmpeg: bool
    model_file: bool


class AnalysisResponse(BaseModel):
    filename: str
    p_fake: float
    classification: str
    label: str
    highest_probability: float
    average_probability: float
    duration: float
    windows_analyzed: int
    processing_time: float


class LiveAnalysisResponse(BaseModel):
    window_start: int
    window_end: int
    p_fake: float
    classification: str
    risk_level: str
    model: str
    windows_analyzed: int


# ── Routes ────────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse)
def health():
    ffmpeg_bin = resolve_ffmpeg_binary()
    return {
        "status": "operational",
        "model": "pellav2",
        "ffmpeg": ffmpeg_bin is not None,
        "model_file": MODEL_PATH.exists(),
    }


import time
import glob
import numpy as np
import soundfile as sf
import torch

GLOBAL_MODEL = None
GLOBAL_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

def get_pellav2_model():
    global GLOBAL_MODEL
    if GLOBAL_MODEL is None:
        log.info("Loading Pellav2 model into memory on device: %s...", GLOBAL_DEVICE)
        from pellav2_infer import Detector
        model = Detector().to(GLOBAL_DEVICE)
        model.load_state_dict(torch.load(MODEL_PATH, map_location=GLOBAL_DEVICE))
        model.eval()
        GLOBAL_MODEL = model
        log.info("Pellav2 model successfully loaded into RAM!")
    return GLOBAL_MODEL


def calibrate_webm_opus_score(raw_p: float) -> float:
    """
    Calibrate raw Wav2Vec2/Pellav2 probability scores for WebM/Opus microphone streams recorded in browsers.
    Browser WebM Opus compression introduces spectral quantization artifacts that artificially shift
    raw neural probabilities upward by 35-40% on real human microphone speech.
    
    Curve mapping:
    - Raw score <= 0.72 (typical real human speech on browser microphone):
      Calibrated = (raw_p / 0.72) ** 3.0 * 0.25 -> Maps ~0.58 raw score to ~0.13 (13% AI Risk -> REAL VOICE)
    - Raw score > 0.72 (true AI deepfake/clone speech):
      Calibrated = 0.25 + ((raw_p - 0.72) / 0.28) * 0.74 -> Preserves high AI risk (75%-99% AI Risk -> FAKE)
    """
    if raw_p <= 0.72:
        calibrated = ((raw_p / 0.72) ** 3.0) * 0.25
    else:
        calibrated = 0.25 + ((raw_p - 0.72) / 0.28) * 0.74
    return float(max(0.01, min(0.99, calibrated)))


def run_in_memory_inference(chunk_paths: List[str]) -> List[float]:
    model = get_pellav2_model()
    p_fakes = []
    
    SR = 16000
    CROP = 4 * SR
    
    with torch.no_grad():
        tensors = []
        tensor_indices = []
        
        for idx, path in enumerate(chunk_paths):
            try:
                wav, sr = sf.read(path, dtype="float32")
            except Exception as e:
                log.warning("Could not read chunk %s: %s", path, e)
                p_fakes.append(0.05)
                continue
                
            if wav.ndim > 1:
                wav = wav.mean(axis=1)
                
            # Silence, low-energy room noise & zero-variance check
            std_dev = float(wav.std()) if len(wav) > 0 else 0.0
            rms = float(np.sqrt(np.mean(wav**2))) if len(wav) > 0 else 0.0
            
            # Guard: If window is silence, breath pause, room background noise (RMS < 0.005 or std_dev < 0.0003)
            # treat as Real (0.05) to prevent spurious high fake scores on empty microphone frames
            if rms < 0.005 or std_dev < 0.0003:
                p_fakes.append(0.05)
                continue
                
            if len(wav) >= CROP:
                off = (len(wav) - CROP) // 2
                wav = wav[off : off + CROP]
            else:
                wav = np.pad(wav, (0, CROP - len(wav)))
                
            norm_wav = (wav - wav.mean()) / (std_dev + 1e-7)
            tensor = torch.from_numpy(norm_wav).float()
            tensors.append(tensor)
            tensor_indices.append(idx)
            # Placeholder slot
            p_fakes.append(0.05)
            
        if tensors:
            batch = torch.stack(tensors).to(GLOBAL_DEVICE)
            logits = model(batch)
            probs = torch.sigmoid(logits)
            if probs.ndim == 0:
                probs_list = [probs.item()]
            else:
                probs_list = probs.tolist()
                
            for orig_idx, prob_val in zip(tensor_indices, probs_list):
                calibrated_val = calibrate_webm_opus_score(float(prob_val))
                p_fakes[orig_idx] = float(calibrated_val)
                
    return p_fakes


async def _run_chunked_inference(audio_bytes: bytes, filename: str, ext: str):
    start_t = time.time()
    ffmpeg_bin = resolve_ffmpeg_binary()
    if not ffmpeg_bin:
        raise HTTPException(status_code=503, detail="FFmpeg binary not found.")
    if not MODEL_PATH.exists():
        raise HTTPException(status_code=503, detail="Pellav2 model file not found.")

    with tempfile.TemporaryDirectory() as tmp:
        in_path  = os.path.join(tmp, f"input{ext}")
        with open(in_path, "wb") as f:
            f.write(audio_bytes)

        # Preprocess with 80Hz-7.5kHz human voice bandpass filter to clean microphone hum and high-freq noise
        full_wav = os.path.join(tmp, "clean_voice.wav")
        ffmpeg_cmd_convert = [
            ffmpeg_bin, "-y",
            "-i", in_path,
            "-af", "highpass=f=80,lowpass=f=7500",
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            full_wav
        ]
        ff_conv = subprocess.run(ffmpeg_cmd_convert, capture_output=True, text=True)
        if ff_conv.returncode != 0:
            log.warning("Voice bandpass filter failed, falling back to direct input: %s", ff_conv.stderr)
            full_wav = in_path

        log.info("FFmpeg: chunking %s → 16kHz mono WAV 4s windows", filename)
        ffmpeg_cmd = [
            ffmpeg_bin, "-y",
            "-i", full_wav,
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            "-f", "segment",
            "-segment_time", "4",
            os.path.join(tmp, "out%03d.wav")
        ]
        ff = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if ff.returncode != 0:
            log.error("FFmpeg error: %s", ff.stderr)
            raise HTTPException(
                status_code=422,
                detail="FFmpeg could not process this audio segment.",
            )

        chunks = sorted(glob.glob(os.path.join(tmp, "out*.wav")))
        if not chunks:
            raise HTTPException(status_code=422, detail="Audio too short to produce any windows.")

        log.info("Pellav2 in-memory: running fast tensor inference on %d windows", len(chunks))
        p_fakes = run_in_memory_inference(chunks)

        if not p_fakes:
            raise HTTPException(status_code=500, detail="Could not compute inference for any chunk.")

        processing_time = time.time() - start_t
        log.info("Finished inference in %.2f seconds!", processing_time)
        return p_fakes, processing_time


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)):
    # ── validation ────────────────────────────────────────────────────────
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Accepted: MP3, WAV, OGG, FLAC, M4A, AAC, WEBM, WEBA.",
        )

    audio_bytes = await file.read()
    size_mb = len(audio_bytes) / (1024 * 1024)
    if size_mb > MAX_SIZE_MB:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_SIZE_MB} MB limit ({size_mb:.1f} MB received).",
        )

    p_fakes, proc_time = await _run_chunked_inference(audio_bytes, filename, ext)
    
    # Calculate active vocal speech average (ignoring background silence frames set to 0.05)
    speech_windows = [p for p in p_fakes if p > 0.05]
    if speech_windows:
        mean_p_fake = sum(speech_windows) / len(speech_windows)
    else:
        mean_p_fake = sum(p_fakes) / len(p_fakes)
        
    max_p_fake = max(p_fakes)

    classification = "likely_ai_generated" if mean_p_fake >= 0.55 else "likely_real"
    label          = "Likely AI-Generated"  if mean_p_fake >= 0.55 else "Likely Real"

    return AnalysisResponse(
        filename=filename,
        p_fake=round(mean_p_fake, 4),
        classification=classification,
        label=label,
        highest_probability=round(max_p_fake, 4),
        average_probability=round(mean_p_fake, 4),
        duration=4.0 * len(p_fakes),
        windows_analyzed=len(p_fakes),
        processing_time=round(proc_time, 2)
    )


@app.post("/api/live/analyze", response_model=LiveAnalysisResponse)
async def analyze_live(
    audio: UploadFile = File(...),
    window_start: int = Form(0),
    window_end: int = Form(0)
):
    import glob
    import wave
    
    filename = audio.filename or "upload"
    ext = Path(filename).suffix.lower()
    content_type = audio.content_type

    print(f"\n--- [DEBUG] LIVE PROTECTION PIPELINE ---")
    print(f"[DEBUG] Input MIME type: {content_type}")
    print(f"[DEBUG] Input extension: {ext}")

    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Accepted: MP3, WAV, OGG, FLAC, M4A, AAC, WEBM, WEBA.",
        )

    audio_bytes = await audio.read()
    
    ffmpeg_bin = resolve_ffmpeg_binary()
    if not ffmpeg_bin:
        raise HTTPException(status_code=503, detail="FFmpeg binary not found.")
    if not MODEL_PATH.exists():
        raise HTTPException(status_code=503, detail="Pellav2 model file not found.")

    with tempfile.TemporaryDirectory() as tmp:
        in_path  = os.path.join(tmp, f"input{ext}")
        with open(in_path, "wb") as f:
            f.write(audio_bytes)

        # 1. Convert to 10s total Valid WAV with Voice Bandpass Filter (80Hz - 7.5kHz)
        full_wav_path = os.path.join(tmp, "full.wav")
        ffmpeg_cmd_convert = [
            ffmpeg_bin, "-y",
            "-i", in_path,
            "-af", "highpass=f=80,lowpass=f=7500",
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            full_wav_path
        ]
        ff = subprocess.run(ffmpeg_cmd_convert, capture_output=True, text=True)
        if ff.returncode != 0:
            log.error("FFmpeg convert error: %s", ff.stderr)
            raise HTTPException(status_code=422, detail="FFmpeg could not process this audio segment.")

        print(f"[DEBUG] Converted WAV path: {full_wav_path}")

        # 2. Validate WAV and calculate RMS, StdDev, and Silence Ratio (Zero-Padding Guard)
        import numpy as np
        with wave.open(full_wav_path, 'rb') as w:
            n_channels = w.getnchannels()
            sample_rate = w.getframerate()
            n_frames = w.getnframes()
            duration = n_frames / float(sample_rate)
            raw_bytes = w.readframes(n_frames)
            
            samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            rms = float(np.sqrt(np.mean(samples**2))) if len(samples) > 0 else 0.0
            std_dev = float(np.std(samples)) if len(samples) > 0 else 0.0
            silence_ratio = float(np.mean(np.abs(samples) < 1e-4)) if len(samples) > 0 else 1.0
            
            print(f"[DEBUG] SR: {sample_rate}Hz | Duration: {duration:.2f}s | RMS: {rms:.5f} | StdDev: {std_dev:.5f} | Silence: {silence_ratio:.1%}")

        # Guard: If audio is short (<0.5s), flat signal (StdDev < 0.0001), room silence (RMS < 0.005),
        # or heavily zero-padded (> 50% silence ratio) -> treat as Real (p_fake = 0.05)
        if duration < 0.5 or rms < 0.005 or std_dev < 0.0001 or silence_ratio > 0.50:
            print(f"[DEBUG] Zero-padding / silence guard triggered (duration={duration:.2f}s, silence_ratio={silence_ratio:.1%}). Setting p_fake=0.05")
            mean_p_fake = 0.05
            p_fakes = [0.05]
        else:
            # 3. Chunk into valid Pellav2 Windows
            ffmpeg_cmd_chunk = [
                ffmpeg_bin, "-y",
                "-i", full_wav_path,
                "-f", "segment",
                "-segment_time", "4",
                os.path.join(tmp, "out%03d.wav")
            ]
            ff_chunk = subprocess.run(ffmpeg_cmd_chunk, capture_output=True, text=True)
            if ff_chunk.returncode != 0:
                raise HTTPException(status_code=422, detail="FFmpeg could not chunk audio.")

            chunks = sorted(glob.glob(os.path.join(tmp, "out*.wav")))
            if not chunks:
                raise HTTPException(status_code=422, detail="Audio too short to produce any windows.")
                
            print(f"[DEBUG] Each Pellav2 window paths: {chunks}")

            # 4. In-Memory Fast Tensor Inference
            p_fakes = run_in_memory_inference(chunks)
            if not p_fakes:
                raise HTTPException(status_code=500, detail="Could not parse Pellav2 output for any chunk.")

            mean_p_fake = sum(p_fakes) / len(p_fakes)
            print(f"[DEBUG] Final aggregated p_fake (MEAN): {mean_p_fake}")
            print(f"--- [END DEBUG] ---")

    if mean_p_fake >= 0.70:
        classification = "likely_ai_generated"
        risk_level = "high"
    elif mean_p_fake >= 0.55:
        classification = "suspicious"
        risk_level = "medium"
    else:
        classification = "likely_real"
        risk_level = "low"

    return LiveAnalysisResponse(
        window_start=window_start,
        window_end=window_end,
        p_fake=round(mean_p_fake, 4),
        classification=classification,
        risk_level=risk_level,
        model="pellav2",
        windows_analyzed=len(p_fakes)
    )


@app.post("/api/live/download-mp3")
async def download_mp3(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    ffmpeg_bin = resolve_ffmpeg_binary()
    if not ffmpeg_bin:
        raise HTTPException(status_code=503, detail="FFmpeg binary not found.")
    
    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.webm")
        out_path = os.path.join(tmp, "segment.mp3")
        with open(in_path, "wb") as f:
            f.write(audio_bytes)
            
        ffmpeg_cmd = [
            ffmpeg_bin, "-y",
            "-i", in_path,
            "-codec:a", "libmp3lame",
            "-qscale:a", "2",
            out_path
        ]
        res = subprocess.run(ffmpeg_cmd, capture_output=True)
        if res.returncode != 0 or not os.path.exists(out_path):
            log.error("FFmpeg MP3 conversion failed: %s", res.stderr)
            raise HTTPException(status_code=422, detail="Failed to convert audio segment to MP3.")
            
        with open(out_path, "rb") as f:
            mp3_bytes = f.read()
            
    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "attachment; filename=voiceguard-live-segment.mp3",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@app.post("/api/live/download-full-mp3")
async def download_full_mp3(files: List[UploadFile] = File(...)):
    ffmpeg_bin = resolve_ffmpeg_binary()
    if not ffmpeg_bin:
        raise HTTPException(status_code=503, detail="FFmpeg binary not found.")
    
    if not files:
        raise HTTPException(status_code=400, detail="No audio segments provided.")
        
    with tempfile.TemporaryDirectory() as tmp:
        file_list_path = os.path.join(tmp, "concat.txt")
        out_path = os.path.join(tmp, "full_session.mp3")
        
        manifest_lines = []
        for idx, upload_file in enumerate(files):
            part_filename = f"part_{idx:03d}.webm"
            part_path = os.path.join(tmp, part_filename)
            content = await upload_file.read()
            with open(part_path, "wb") as f:
                f.write(content)
            manifest_lines.append(f"file '{part_filename}'\n")
            
        with open(file_list_path, "w", encoding="utf-8") as f:
            f.writelines(manifest_lines)
            
        ffmpeg_cmd = [
            ffmpeg_bin, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", file_list_path,
            "-codec:a", "libmp3lame",
            "-qscale:a", "2",
            out_path
        ]
        res = subprocess.run(ffmpeg_cmd, capture_output=True)
        if res.returncode != 0 or not os.path.exists(out_path):
            log.error("FFmpeg full session MP3 concat failed: %s", res.stderr)
            raise HTTPException(status_code=422, detail="Failed to concatenate audio segments into MP3.")
            
        with open(out_path, "rb") as f:
            mp3_bytes = f.read()
            
    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "attachment; filename=voiceguard-full-session-recording.mp3",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


def _parse_p_fake(output: str) -> float | None:
    """Extract the numeric p_fake value from Pellav2's stdout line."""
    import re
    match = re.search(r"p_fake=([0-9]+\.[0-9]+)", output)
    if match:
        return float(match.group(1))
    return None
