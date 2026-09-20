"""
VoiceGuard USB Receiver — Laptop-side service

This script runs separately on the laptop and bridges the Android USB Bridge app
to the VoiceGuard backend.

Setup:
  1. Install Android USB Bridge APK on phone (see android_bridge/README.md)
  2. Connect phone to laptop via USB cable
  3. Enable USB Debugging on Android phone
  4. Run: adb reverse tcp:9876 tcp:9876
  5. Run this script: python usb_receiver/receiver.py
  6. Launch VoiceGuard and select Phone — USB

How it works:
  Android Bridge → USB cable → ADB reverse tunnel → This script → VoiceGuard Backend
  (Port 9876)                                       (Port 9876)   (Port 8000)

The ADB reverse command makes Android's port 9876 accessible on the phone as if it
were a local connection, through the USB cable. No Wi-Fi required.
"""

import asyncio
import logging
import os
import socket
import sys
import time
import wave
import tempfile
import urllib.request
import urllib.parse
import json

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [USB-RECEIVER] %(levelname)s — %(message)s",
)
log = logging.getLogger("usb_receiver")

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 9876             # ADB-forwarded port (must match Android bridge)
BACKEND_URL = os.getenv("VOICEGUARD_URL", "http://127.0.0.1:8000")

# Audio format constants (must match Android bridge)
SAMPLE_RATE    = 16000
CHANNELS       = 1
SAMPLE_WIDTH   = 2   # bytes per sample (int16)
WINDOW_SECONDS = 4   # seconds before flushing to backend


def register_with_backend():
    """Notify VoiceGuard backend that USB bridge is connected."""
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/usb/connect",
            data=b"",
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            log.info("Registered with backend: %s", r.status)
    except Exception as e:
        log.warning("Could not register with backend: %s", e)


def deregister_from_backend():
    """Notify VoiceGuard backend that USB bridge disconnected."""
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/usb/disconnect",
            data=b"",
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            log.info("Deregistered from backend: %s", r.status)
    except Exception as e:
        log.warning("Could not deregister from backend: %s", e)


def send_audio_to_backend(pcm_bytes: bytes):
    """Convert PCM bytes to WAV and POST to /api/usb/stream."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        wav_path = tf.name

    try:
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(CHANNELS)
            w.setsampwidth(SAMPLE_WIDTH)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm_bytes)

        with open(wav_path, "rb") as f:
            wav_bytes = f.read()

        boundary = "VoiceGuardUSBBoundary"
        body = (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"audio\"; filename=\"usb_audio.wav\"\r\n"
            f"Content-Type: audio/wav\r\n\r\n"
        ).encode() + wav_bytes + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(
            f"{BACKEND_URL}/api/usb/stream",
            data=body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
            log.info(
                "Analysis: %s  p_fake=%.4f  confidence=%.1f%%  quality=%s",
                result.get("classification"), result.get("p_fake", 0),
                result.get("confidence", 0), result.get("audio_quality", "?"),
            )
    except Exception as e:
        log.error("Failed to send audio to backend: %s", e)
    finally:
        try:
            os.unlink(wav_path)
        except Exception:
            pass


async def handle_android_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Handle one Android bridge connection."""
    peer = writer.get_extra_info("peername")
    log.info("Android bridge connected from %s", peer)
    register_with_backend()

    pcm_buffer = bytearray()
    WINDOW_BYTES = SAMPLE_RATE * SAMPLE_WIDTH * WINDOW_SECONDS

    # Simple protocol:
    # The Android bridge sends raw PCM Int16 LE samples @16kHz mono continuously.
    # First 4 bytes: magic "VGAB" (VoiceGuard Audio Bridge)
    # Then: continuous int16 PCM frames

    try:
        # Read handshake magic
        magic = await asyncio.wait_for(reader.read(4), timeout=5.0)
        if magic != b"VGAB":
            log.warning("Invalid handshake magic: %r — closing", magic)
            writer.close()
            return

        writer.write(b"VGOK")   # Acknowledge
        await writer.drain()
        log.info("Handshake OK with Android bridge")

        while True:
            chunk = await asyncio.wait_for(reader.read(4096), timeout=10.0)
            if not chunk:
                log.info("Android bridge disconnected")
                break

            pcm_buffer.extend(chunk)

            if len(pcm_buffer) >= WINDOW_BYTES:
                window = bytes(pcm_buffer[:WINDOW_BYTES])
                pcm_buffer = pcm_buffer[WINDOW_BYTES:]
                # Run in thread pool to avoid blocking event loop
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, send_audio_to_backend, window)

    except asyncio.TimeoutError:
        log.warning("Timeout reading from Android bridge %s", peer)
    except Exception as e:
        log.error("Error handling Android client: %s", e)
    finally:
        deregister_from_backend()
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        log.info("Connection to Android bridge %s closed", peer)


async def main():
    log.info("VoiceGuard USB Receiver starting on port %d", LISTEN_PORT)
    log.info("Forwarding audio to backend at %s", BACKEND_URL)
    log.info("")
    log.info("SETUP STEPS:")
    log.info("  1. Connect phone via USB")
    log.info("  2. Enable USB Debugging on phone")
    log.info("  3. Run: adb reverse tcp:9876 tcp:9876")
    log.info("  4. Launch VoiceGuard Android USB Bridge app on phone")
    log.info("  5. Select 'Phone — USB' in VoiceGuard web UI")
    log.info("")

    server = await asyncio.start_server(
        handle_android_client, LISTEN_HOST, LISTEN_PORT
    )

    async with server:
        log.info("USB Receiver listening on %s:%d", LISTEN_HOST, LISTEN_PORT)
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("USB Receiver stopped.")
