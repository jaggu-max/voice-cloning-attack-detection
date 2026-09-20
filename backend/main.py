"""
VoiceGuard — FastAPI backend for Pellav2 voice cloning attack detection.

Endpoints:
  GET  /api/health            — system status
  GET  /api/session-token     — generate secure session token & QR URL
  POST /api/analyze           — upload audio → shared pipeline → Pellav2 result
  POST /api/live/analyze      — live 10s WebM chunk → shared pipeline (with live calibration)
  POST /api/live/download-mp3 — convert segment to MP3
  POST /api/live/download-full-mp3 — concatenate segments → MP3

  WS   /ws/phone              — Phone Wi-Fi WebSocket audio stream & real-time telemetry
  GET  /api/phone/status      — Phone Wi-Fi connection state & live telemetry counters
  GET  /api/phone/latest-wav  — Download accumulated phone PCM as WAV file (Record & Test)
  POST /api/phone/analyze-recording — Run Pellav2 detection on accumulated phone audio

  GET  /api/usb/status        — USB bridge connection state
  POST /api/usb/stream        — USB bridge audio ingestion
  GET  /mobile                — Phone browser UI (served HTML)
  GET  /api/local-ip          — Returns laptop LAN IP & dynamic HTTPS/HTTP mobile URL
"""

import asyncio
import json
import logging
import math
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import uuid
import wave as wavmod
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

# ── Config ─────────────────────────────────────────────────────────────────────
PROJECT_DIR   = Path(__file__).resolve().parent.parent
FRONTEND_URL  = os.getenv("FRONTEND_URL", "http://localhost:5173")
MAX_SIZE_MB   = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
MOBILE_HTML   = Path(__file__).resolve().parent / "mobile.html"

ALLOWED_EXT  = {".mp3", ".wav", ".ogg", ".flac", ".webm", ".weba", ".m4a", ".aac"}

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("voiceguard")

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="VoiceGuard API", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    log.info("Pre-warming Pellav2 model...")
    try:
        from audio_pipeline import get_model
        get_model()
    except Exception as e:
        log.error("Model pre-warm failed: %s", e)


# ── FFmpeg helper ──────────────────────────────────────────────────────────────
def resolve_ffmpeg() -> Optional[str]:
    env = os.getenv("FFMPEG_PATH", "ffmpeg")
    if Path(env).is_file():
        return str(Path(env).resolve())
    found = shutil.which(env)
    if found:
        return found
    for name in ("ffmpeg.exe", "ffmpeg"):
        c = PROJECT_DIR / name
        if c.is_file():
            return str(c)
    return None


# ── Response models ────────────────────────────────────────────────────────────
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
    windows_speech: int
    processing_time: float
    audio_quality: str
    confidence: float


class LiveAnalysisResponse(BaseModel):
    window_start: int
    window_end: int
    p_fake: float
    classification: str
    risk_level: str
    model: str
    windows_analyzed: int
    windows_speech: int
    confidence: float


class PhoneTelemetry(BaseModel):
    state: str           # disconnected | connected | mic_ready | streaming | stopped
    client_count: int
    frames: int
    bytes: int
    level: int
    duration_s: float
    token: Optional[str] = None


class UsbStatusResponse(BaseModel):
    state: str         # disconnected | connected | streaming
    last_audio_ts: Optional[float] = None


# ── State management ──────────────────────────────────────────────────────────
# Active WebSockets: 'phone_clients' (mobile browsers) and 'laptop_clients' (UI subscribers)
_phone_ws: Dict[str, WebSocket] = {}
_laptop_ws: Dict[str, WebSocket] = {}

# Session tokens mapping token → metadata
_session_tokens: Dict[str, dict] = {}

# Active phone telemetry data
_phone_telemetry = {
    "state": "disconnected",
    "client_count": 0,
    "frames": 0,
    "bytes": 0,
    "level": 0,
    "start_time": 0.0,
    "duration_s": 0.0,
    "token": None,
}

# Buffer for accumulating raw PCM audio for Record & Test
_phone_pcm_buffer = bytearray()


# ── Helpers ───────────────────────────────────────────────────────────────────
def get_lan_ip() -> str:
    """Returns the laptop's primary LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


async def broadcast_telemetry():
    """Send current telemetry update to all connected laptop clients."""
    dur = time.time() - _phone_telemetry["start_time"] if _phone_telemetry["state"] == "streaming" else _phone_telemetry["duration_s"]
    payload = {
        "type": "TELEMETRY",
        "state": _phone_telemetry["state"],
        "client_count": len(_phone_ws),
        "frames": _phone_telemetry["frames"],
        "bytes": _phone_telemetry["bytes"],
        "level": _phone_telemetry["level"],
        "duration_s": round(dur, 1),
        "token": _phone_telemetry["token"],
    }
    dead = []
    for cid, ws in _laptop_ws.items():
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead.append(cid)
    for cid in dead:
        _laptop_ws.pop(cid, None)


# ── Routes: Health & Config ────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse)
def health():
    model_path = Path(os.getenv("MODEL_PATH", str(PROJECT_DIR / "pellav2_detector.pt"))).resolve()
    return {
        "status": "operational",
        "model": "pellav2",
        "ffmpeg": resolve_ffmpeg() is not None,
        "model_file": model_path.exists(),
    }


@app.get("/api/local-ip")
def get_local_ip():
    """Returns the laptop's current LAN IP & dynamic HTTPS/HTTP URL."""
    ip = get_lan_ip()
    port = int(os.getenv("HTTPS_PORT", "8443"))
    scheme = "https"
    token = str(uuid.uuid4())[:8]

    return {
        "ip": ip,
        "port": port,
        "scheme": scheme,
        "token": token,
        "mobile_url": f"{scheme}://{ip}:{port}/mobile?token={token}",
    }


@app.get("/api/session-token")
def get_session_token():
    """Generate session token for QR code."""
    token = str(uuid.uuid4())
    _session_tokens[token] = {"created_at": time.time()}
    ip = get_lan_ip()
    port = int(os.getenv("HTTPS_PORT", "8443"))
    scheme = "https"

    return {
        "token": token,
        "mobile_url": f"{scheme}://{ip}:{port}/mobile?token={token}",
    }


# ── Routes: File Analysis & Live ──────────────────────────────────────────────
@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)):
    """Analyze uploaded audio file through shared pipeline (raw model output, uncalibrated)."""
    filename = file.filename or "upload"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=415, detail=f"Unsupported file type '{ext}'.")

    audio_bytes = await file.read()
    if len(audio_bytes) / (1024 * 1024) > MAX_SIZE_MB:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_SIZE_MB} MB limit.")

    from audio_pipeline import analyze_audio_bytes
    result, proc_time = analyze_audio_bytes(audio_bytes, ext, filename=filename, is_live=False)

    speech_pf = [w.p_fake for w in result.window_results if w.is_speech]
    highest = max(speech_pf) if speech_pf else 0.0

    return AnalysisResponse(
        filename=filename,
        p_fake=result.p_fake,
        classification=result.classification,
        label=result.label,
        highest_probability=round(highest, 4),
        average_probability=result.p_fake,
        duration=round(result.duration_s, 2),
        windows_analyzed=result.windows_total,
        windows_speech=result.windows_speech,
        processing_time=round(proc_time, 2),
        audio_quality=result.audio_quality,
        confidence=result.confidence,
    )


@app.post("/api/live/analyze", response_model=LiveAnalysisResponse)
async def analyze_live(
    audio: UploadFile = File(...),
    window_start: int = Form(0),
    window_end: int = Form(0),
):
    """Analyze a live 10s audio chunk with live codec calibration applied."""
    filename = audio.filename or "live_segment.webm"
    ext = Path(filename).suffix.lower()
    audio_bytes = await audio.read()

    from audio_pipeline import analyze_audio_bytes
    result, _ = analyze_audio_bytes(audio_bytes, ext, filename=filename, is_live=True)

    risk_level = "high" if result.classification == "likely_ai_generated" else (
        "medium" if result.classification == "suspicious" else "low"
    )

    return LiveAnalysisResponse(
        window_start=window_start,
        window_end=window_end,
        p_fake=result.p_fake,
        classification=result.classification,
        risk_level=risk_level,
        model="pellav2",
        windows_analyzed=result.windows_total,
        windows_speech=result.windows_speech,
        confidence=result.confidence,
    )


# ── Routes: MP3 Exports ───────────────────────────────────────────────────────
@app.post("/api/live/download-mp3")
async def download_mp3(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    ffmpeg_bin = resolve_ffmpeg()
    if not ffmpeg_bin:
        raise HTTPException(status_code=503, detail="FFmpeg not found.")

    with tempfile.TemporaryDirectory() as tmp:
        in_path  = os.path.join(tmp, "input.webm")
        out_path = os.path.join(tmp, "segment.mp3")
        with open(in_path, "wb") as f:
            f.write(audio_bytes)
        res = subprocess.run(
            [ffmpeg_bin, "-y", "-i", in_path, "-codec:a", "libmp3lame", "-qscale:a", "2", out_path],
            capture_output=True,
        )
        if res.returncode != 0 or not os.path.exists(out_path):
            raise HTTPException(status_code=422, detail="MP3 conversion failed.")
        with open(out_path, "rb") as f:
            mp3_bytes = f.read()

    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "attachment; filename=voiceguard-segment.mp3"},
    )


@app.post("/api/live/download-full-mp3")
async def download_full_mp3(files: List[UploadFile] = File(...)):
    ffmpeg_bin = resolve_ffmpeg()
    if not ffmpeg_bin or not files:
        raise HTTPException(status_code=400, detail="Invalid request or FFmpeg missing.")

    with tempfile.TemporaryDirectory() as tmp:
        manifest = []
        for idx, uf in enumerate(files):
            part_path = os.path.join(tmp, f"part_{idx:03d}.webm")
            content = await uf.read()
            with open(part_path, "wb") as f:
                f.write(content)
            manifest.append(f"file '{os.path.basename(part_path)}'\n")

        list_path = os.path.join(tmp, "concat.txt")
        out_path  = os.path.join(tmp, "full_session.mp3")
        with open(list_path, "w") as f:
            f.writelines(manifest)

        res = subprocess.run(
            [ffmpeg_bin, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
             "-codec:a", "libmp3lame", "-qscale:a", "2", out_path],
            capture_output=True,
        )
        if res.returncode != 0 or not os.path.exists(out_path):
            raise HTTPException(status_code=422, detail="MP3 concatenation failed.")
        with open(out_path, "rb") as f:
            mp3_bytes = f.read()

    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "attachment; filename=voiceguard-full-session.mp3"},
    )


# ── Phone Wi-Fi — WebSocket Endpoint & Status ────────────────────────────────
@app.get("/api/phone/status", response_model=PhoneTelemetry)
def phone_status():
    dur = time.time() - _phone_telemetry["start_time"] if _phone_telemetry["state"] == "streaming" else _phone_telemetry["duration_s"]
    return PhoneTelemetry(
        state=_phone_telemetry["state"],
        client_count=len(_phone_ws),
        frames=_phone_telemetry["frames"],
        bytes=_phone_telemetry["bytes"],
        level=_phone_telemetry["level"],
        duration_s=round(dur, 1),
        token=_phone_telemetry["token"],
    )


@app.websocket("/ws/phone")
async def phone_websocket(
    ws: WebSocket,
    token: Optional[str] = Query(None),
    role: Optional[str] = Query("phone"),
):
    """
    WebSocket endpoint for Phone Wi-Fi streaming.
    Supports role='phone' (audio publisher) and role='laptop' (telemetry subscriber).
    """
    await ws.accept()
    client_id = str(uuid.uuid4())

    if role == "laptop":
        _laptop_ws[client_id] = ws
        log.info("Laptop telemetry subscriber connected: %s", client_id)
        await broadcast_telemetry()
        try:
            while True:
                msg = await ws.receive_text()
                # Laptop can request telemetry ping
        except WebSocketDisconnect:
            _laptop_ws.pop(client_id, None)
        return

    # Role is phone
    _phone_ws[client_id] = ws
    _phone_telemetry["client_count"] = len(_phone_ws)
    _phone_telemetry["state"] = "connected"
    if token:
        _phone_telemetry["token"] = token

    log.info("Phone client connected: %s (token=%s)", client_id, token)
    await ws.send_text(json.dumps({"type": "ACK", "clientId": client_id, "state": "connected"}))
    await broadcast_telemetry()

    WINDOW_BYTES = 16000 * 2 * 10  # 10s of 16kHz Int16 LE audio (320,000 bytes)
    live_window_pcm = bytearray()

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"type": "PING"}))
                continue

            if "text" in msg:
                data = json.loads(msg["text"])
                msg_type = data.get("type", "")

                if msg_type == "MIC_READY":
                    _phone_telemetry["state"] = "mic_ready"
                    await ws.send_text(json.dumps({"type": "STATUS", "state": "mic_ready"}))
                    await broadcast_telemetry()

                elif msg_type == "START":
                    _phone_telemetry["state"] = "streaming"
                    _phone_telemetry["frames"] = 0
                    _phone_telemetry["bytes"] = 0
                    _phone_telemetry["level"] = 0
                    _phone_telemetry["start_time"] = time.time()
                    _phone_pcm_buffer.clear()
                    live_window_pcm.clear()
                    await ws.send_text(json.dumps({"type": "STATUS", "state": "streaming"}))
                    await broadcast_telemetry()

                elif msg_type == "STOP":
                    dur = time.time() - _phone_telemetry["start_time"] if _phone_telemetry["start_time"] > 0 else 0
                    _phone_telemetry["duration_s"] = round(dur, 1)
                    _phone_telemetry["state"] = "stopped"
                    await ws.send_text(json.dumps({"type": "STATUS", "state": "stopped"}))
                    await broadcast_telemetry()

                    # Analyze whatever audio was recorded during this session
                    if len(_phone_pcm_buffer) >= 16000 * 2 * 2:  # at least 2s
                        asyncio.create_task(_analyze_phone_pcm(bytes(_phone_pcm_buffer), ws))

                elif msg_type == "HEARTBEAT":
                    await ws.send_text(json.dumps({"type": "PONG"}))

            elif "bytes" in msg:
                # Real 16-bit Int16 LE PCM frames from phone microphone
                pcm_chunk = msg["bytes"]
                _phone_pcm_buffer.extend(pcm_chunk)
                live_window_pcm.extend(pcm_chunk)

                # Real telemetry metrics
                _phone_telemetry["frames"] += 1
                _phone_telemetry["bytes"] += len(pcm_chunk)

                # Calculate real RMS audio level
                samples = np.frombuffer(pcm_chunk, dtype=np.int16).astype(np.float32) / 32768.0
                if len(samples) > 0:
                    rms = float(np.sqrt(np.mean(samples ** 2)))
                    _phone_telemetry["level"] = min(100, int(rms * 400))

                await broadcast_telemetry()

                # When accumulated live window >= 10s, analyze window
                if len(live_window_pcm) >= WINDOW_BYTES:
                    chunk_to_analyze = bytes(live_window_pcm[:WINDOW_BYTES])
                    live_window_pcm = live_window_pcm[WINDOW_BYTES // 2:]  # 50% overlap
                    asyncio.create_task(_analyze_phone_pcm(chunk_to_analyze, ws))

    except WebSocketDisconnect:
        log.info("Phone client disconnected: %s", client_id)
    except Exception as e:
        log.error("Phone WebSocket error: %s", e)
    finally:
        _phone_ws.pop(client_id, None)
        _phone_telemetry["client_count"] = len(_phone_ws)
        if len(_phone_ws) == 0:
            _phone_telemetry["state"] = "disconnected"
        await broadcast_telemetry()


async def _analyze_phone_pcm(pcm_bytes: bytes, ws: WebSocket):
    """Convert raw PCM bytes to WAV and analyze through shared pipeline."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            wav_path = tf.name

        with wavmod.open(wav_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(pcm_bytes)

        with open(wav_path, "rb") as f:
            wav_bytes = f.read()
        os.unlink(wav_path)

        from audio_pipeline import analyze_audio_bytes
        result, _ = analyze_audio_bytes(wav_bytes, ".wav", filename="phone_stream.wav", is_live=True)

        risk_level = "high" if result.classification == "likely_ai_generated" else (
            "medium" if result.classification == "suspicious" else "low"
        )

        resp = {
            "type": "RESULT",
            "classification": result.classification,
            "label": result.label,
            "p_fake": result.p_fake,
            "confidence": result.confidence,
            "risk_level": risk_level,
            "windows_analyzed": result.windows_total,
            "windows_speech": result.windows_speech,
            "audio_quality": result.audio_quality,
        }

        # Send to phone
        try:
            await ws.send_text(json.dumps(resp))
        except Exception:
            pass

        # Broadcast to laptop subscribers
        for lws in list(_laptop_ws.values()):
            try:
                await lws.send_text(json.dumps(resp))
            except Exception:
                pass

    except Exception as e:
        log.error("Phone PCM analysis error: %s", e)


# ── Routes: Record & Test Integration for Phone Audio ───────────────────────
@app.get("/api/phone/latest-wav")
def download_latest_phone_wav():
    """Download the accumulated phone PCM buffer as a 16kHz mono WAV file."""
    if len(_phone_pcm_buffer) == 0:
        raise HTTPException(status_code=404, detail="No phone audio recorded yet.")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav_path = tf.name

    with wavmod.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(bytes(_phone_pcm_buffer))

    with open(wav_path, "rb") as f:
        wav_bytes = f.read()
    os.unlink(wav_path)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=voiceguard-phone-recording.wav"},
    )


@app.post("/api/phone/analyze-recording", response_model=AnalysisResponse)
def analyze_phone_recording():
    """Run Pellav2 detection on the recorded phone PCM buffer (Record & Test mode)."""
    if len(_phone_pcm_buffer) < 16000 * 2 * 1:  # min 1 second
        raise HTTPException(status_code=400, detail="Recorded phone audio is too short (min 1 second).")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav_path = tf.name

    with wavmod.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(bytes(_phone_pcm_buffer))

    with open(wav_path, "rb") as f:
        wav_bytes = f.read()
    os.unlink(wav_path)

    from audio_pipeline import analyze_audio_bytes
    result, proc_time = analyze_audio_bytes(wav_bytes, ".wav", filename="phone_recorded.wav", is_live=False)

    speech_pf = [w.p_fake for w in result.window_results if w.is_speech]
    highest = max(speech_pf) if speech_pf else 0.0

    return AnalysisResponse(
        filename="phone_recorded.wav",
        p_fake=result.p_fake,
        classification=result.classification,
        label=result.label,
        highest_probability=round(highest, 4),
        average_probability=result.p_fake,
        duration=round(result.duration_s, 2),
        windows_analyzed=result.windows_total,
        windows_speech=result.windows_speech,
        processing_time=round(proc_time, 2),
        audio_quality=result.audio_quality,
        confidence=result.confidence,
    )


# ── Routes: USB Bridge ────────────────────────────────────────────────────────
_usb_state: dict = {"state": "disconnected", "last_audio_ts": None}

@app.get("/api/usb/status", response_model=UsbStatusResponse)
def usb_status():
    return UsbStatusResponse(state=_usb_state["state"], last_audio_ts=_usb_state["last_audio_ts"])


@app.post("/api/usb/stream")
async def usb_stream(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    filename = audio.filename or "usb_audio.wav"
    ext = Path(filename).suffix.lower() or ".wav"

    _usb_state["state"] = "streaming"
    _usb_state["last_audio_ts"] = time.time()

    from audio_pipeline import analyze_audio_bytes
    result, proc_time = analyze_audio_bytes(audio_bytes, ext, filename=filename, is_live=False)

    risk_level = "high" if result.classification == "likely_ai_generated" else (
        "medium" if result.classification == "suspicious" else "low"
    )

    return {
        "classification": result.classification,
        "label": result.label,
        "p_fake": result.p_fake,
        "confidence": result.confidence,
        "risk_level": risk_level,
        "windows_analyzed": result.windows_total,
        "windows_speech": result.windows_speech,
        "audio_quality": result.audio_quality,
        "processing_time": round(proc_time, 2),
    }


# ── Mobile Browser UI Route ───────────────────────────────────────────────────
@app.get("/mobile", response_class=HTMLResponse)
def mobile_page():
    if MOBILE_HTML.exists():
        return HTMLResponse(content=MOBILE_HTML.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Mobile page not found</h1>", status_code=404)
