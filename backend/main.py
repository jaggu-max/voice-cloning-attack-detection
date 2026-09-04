"""
VoiceGuard — FastAPI backend for Pellav2 voice cloning attack detection.

Endpoints:
  GET  /api/health   — system status
  POST /api/analyze  — upload audio → FFmpeg preprocess → Pellav2 inference
"""

import os
import sys
import subprocess
import tempfile
import logging
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Paths ──────────────────────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).resolve().parent.parent   # voice-detector root
FFMPEG      = PROJECT_DIR / "ffmpeg.exe"
MODEL       = PROJECT_DIR / "pellav2_detector.pt"
INFER       = PROJECT_DIR / "pellav2_infer.py"

ALLOWED_MIME = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
                "audio/x-wav", "audio/vnd.wave", "audio/ogg", "audio/webm",
                "audio/flac", "audio/x-flac", "application/octet-stream"}
ALLOWED_EXT  = {".mp3", ".wav", ".ogg", ".flac", ".webm", ".m4a", ".aac"}
MAX_SIZE_MB  = 50

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("voiceguard")

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="VoiceGuard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # dev — restrict in production
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Response models ────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    model: str
    ffmpeg: bool
    model_file: bool


class AnalysisResponse(BaseModel):
    filename: str
    p_fake: float
    classification: str   # "likely_real" | "likely_ai_generated"
    label: str            # "Likely Real" | "Likely AI-Generated"


# ── Routes ────────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse)
def health():
    return {
        "status": "operational",
        "model": "pellav2",
        "ffmpeg": FFMPEG.exists(),
        "model_file": MODEL.exists(),
    }


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)):
    # ── validation ────────────────────────────────────────────────────────
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Accepted: MP3, WAV, OGG, FLAC, M4A.",
        )

    audio_bytes = await file.read()
    size_mb = len(audio_bytes) / (1024 * 1024)
    if size_mb > MAX_SIZE_MB:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_SIZE_MB} MB limit ({size_mb:.1f} MB received).",
        )

    if not FFMPEG.exists():
        raise HTTPException(status_code=503, detail="FFmpeg not found on server.")
    if not MODEL.exists():
        raise HTTPException(status_code=503, detail="Pellav2 model not found on server.")

    # ── write upload to temp file ─────────────────────────────────────────
    with tempfile.TemporaryDirectory() as tmp:
        in_path  = os.path.join(tmp, f"input{ext}")
        out_path = os.path.join(tmp, "converted.wav")

        with open(in_path, "wb") as f:
            f.write(audio_bytes)

        # ── FFmpeg: convert → 16 kHz mono PCM WAV ────────────────────────
        log.info("FFmpeg: converting %s → 16kHz mono WAV", filename)
        ffmpeg_cmd = [
            str(FFMPEG), "-y",
            "-i", in_path,
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            out_path,
        ]
        ff = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if ff.returncode != 0:
            log.error("FFmpeg error: %s", ff.stderr)
            raise HTTPException(
                status_code=422,
                detail="FFmpeg could not process this audio file. Ensure it is a valid audio recording.",
            )

        # ── Pellav2 inference ─────────────────────────────────────────────
        log.info("Pellav2: running inference on %s", out_path)
        infer_cmd = [sys.executable, str(INFER), str(MODEL), out_path]
        result = subprocess.run(infer_cmd, capture_output=True, text=True)

        if result.returncode != 0:
            log.error("Pellav2 error: %s", result.stderr)
            raise HTTPException(
                status_code=500,
                detail="Pellav2 inference failed. Please try again with a different recording.",
            )

        # ── parse output: "path: p_fake=0.104 -> real" ───────────────────
        output = result.stdout.strip()
        log.info("Pellav2 output: %s", output)

        p_fake = _parse_p_fake(output)
        if p_fake is None:
            log.error("Could not parse Pellav2 output: %s", output)
            raise HTTPException(
                status_code=500,
                detail="Could not parse Pellav2 output. Please try again.",
            )

    classification = "likely_ai_generated" if p_fake >= 0.5 else "likely_real"
    label          = "Likely AI-Generated"  if p_fake >= 0.5 else "Likely Real"

    return AnalysisResponse(
        filename=filename,
        p_fake=round(p_fake, 4),
        classification=classification,
        label=label,
    )


def _parse_p_fake(output: str) -> float | None:
    """Extract the numeric p_fake value from Pellav2's stdout line."""
    import re
    # expected format: "some/path.wav: p_fake=0.104 -> real"
    match = re.search(r"p_fake=([0-9]+\.[0-9]+)", output)
    if match:
        return float(match.group(1))
    return None
