import os
import sys
import subprocess
import tempfile

# Project folder
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

# FFmpeg is directly inside the project folder
FFMPEG = os.path.join(PROJECT_DIR, "ffmpeg.exe")

# Existing Pellav2 files
MODEL = os.path.join(PROJECT_DIR, "pellav2_detector.pt")
INFER = os.path.join(PROJECT_DIR, "pellav2_infer.py")


def convert_and_test(input_audio):
    if not os.path.exists(input_audio):
        print(f"❌ Audio file not found: {input_audio}")
        return

    if not os.path.exists(FFMPEG):
        print("❌ ffmpeg.exe not found!")
        return

    print("🔄 Converting audio to 16 kHz mono WAV...")

    # Temporary WAV file
    temp_wav = tempfile.NamedTemporaryFile(
        suffix=".wav",
        delete=False
    ).name

    try:
        # Convert MP3/WAV/etc. → 16kHz mono PCM WAV
        command = [
            FFMPEG,
            "-y",
            "-i", input_audio,
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            temp_wav
        ]

        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        if result.returncode != 0:
            print("❌ FFmpeg conversion failed.")
            print(result.stderr)
            return

        print("✅ Conversion successful!")
        print("🤖 Testing with your existing Pellav2 detector...\n")

        # DON'T modify pellav2_infer.py
        subprocess.run([
            sys.executable,
            INFER,
            MODEL,
            temp_wav
        ])

    finally:
        # Remove temporary WAV
        if os.path.exists(temp_wav):
            os.remove(temp_wav)


if __name__ == "__main__":

    if len(sys.argv) != 2:
        print('Usage: python convert_and_test.py "audio.mp3"')
        sys.exit(1)

    audio_file = sys.argv[1]

    convert_and_test(audio_file)