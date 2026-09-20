# VoiceGuard Android USB Bridge

This directory contains the Android companion app that enables Phone — USB mode in VoiceGuard.

## Architecture

```
Android Phone
  └── VoiceGuardBridge.kt
        └── AudioRecord @16kHz mono
              └── TCP socket → localhost:9876
                                    │
                    USB cable (ADB reverse tunnel)
                                    │
              Laptop: usb_receiver/receiver.py
                    └── localhost:9876
                          └── POST /api/usb/stream → VoiceGuard backend
```

## Requirements

- Android 5.0+ (API 21)
- USB cable (data-capable — not charge-only)
- ADB installed on laptop
- USB Debugging enabled on Android phone

## Setup Steps

### 1. Enable USB Debugging on Android

1. Open **Settings → About phone**
2. Tap **Build number** 7 times to enable Developer Options
3. Go to **Settings → Developer Options**
4. Enable **USB Debugging**
5. When prompted on phone, allow this computer

### 2. Build the Android App

```bash
# Prerequisites: Android Studio installed, JDK 17+

# Open android_bridge/ in Android Studio as a new project
# Or create a new Empty Activity project and replace MainActivity.kt

# Required permissions in AndroidManifest.xml:
# <uses-permission android:name="android.permission.RECORD_AUDIO" />
# <uses-permission android:name="android.permission.INTERNET" />

# Build → Generate Signed APK (or use debug build for SIH demo)
```

### 3. Connect Phone and Set Up ADB Tunnel

```bash
# Install ADB (if not already):
# Windows: https://developer.android.com/studio/releases/platform-tools
# Or: choco install adb

# Verify phone detected:
adb devices
# Expected output:
# List of devices attached
# XXXXXX    device

# Set up reverse tunnel (phone port 9876 → laptop port 9876):
adb reverse tcp:9876 tcp:9876
# Expected: 9876
```

### 4. Start Services

```bash
# Terminal 1: Start VoiceGuard backend
cd c:\Users\HP\Downloads\voice-detector\backend
..\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2: Start USB Receiver
cd c:\Users\HP\Downloads\voice-detector
.\venv\Scripts\activate
python usb_receiver/receiver.py
```

### 5. Use the App

1. Launch VoiceGuard Android USB Bridge on phone
2. Tap **START AUDIO**
3. In VoiceGuard web UI, select **Phone — USB**
4. VoiceGuard will show 🟢 **USB Bridge: Connected**

## Protocol

The bridge uses a simple binary protocol over TCP:

```
Phone → Laptop:  "VGAB"            (4-byte handshake magic)
Laptop → Phone:  "VGOK"            (4-byte ACK)
Phone → Laptop:  [PCM Int16 LE]    (continuous raw audio @16kHz mono)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `adb devices` shows no devices | Check USB cable supports data, enable USB Debugging |
| App says "Error: Connection refused" | ADB tunnel not set up (`adb reverse tcp:9876 tcp:9876`) |
| App says "Error: Invalid server ACK" | USB receiver not running |
| Audio quality poor | Use USB-C to USB-A cable; avoid long cables |
| Bridge disconnects | Disable phone screen timeout during recording |

## Security Notes

- Audio is transmitted locally over USB only — never leaves the device pair
- No internet connection required for USB mode
- No root access required
- USB Debugging can be disabled after SIH demo
