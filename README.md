# VoiceGuard — Voice Cloning Attack Detection

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React_18_--_Vite_--_TypeScript-61DAFB?logo=react)](https://react.dev/)
[![PyTorch](https://img.shields.io/badge/ML-PyTorch_--_Wav2Vec2-EE4C2C?logo=pytorch)](https://pytorch.org/)
[![Render](https://img.shields.io/badge/Deploy-Render_Ready-46E3B7?logo=render)](https://render.com/)

An enterprise-grade, high-precision detection system engineered to identify synthetic and AI-generated voice recordings to mitigate voice cloning impersonation threats.

---

## 🏗️ System Architecture

```text
User
↓
React + TypeScript
↓
FastAPI
↓
Audio Validation
↓
FFmpeg
↓
16 kHz Mono WAV
↓
Pellav2
↓
p_fake
↓
Likely Real / Likely AI-Generated
```

### Data Pipeline Overview

1. **User Interaction**: User selects or drops an audio file (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`) on the React + TypeScript frontend dashboard.
2. **REST API Transmission**: Frontend posts binary file payload to `/api/analyze` on the FastAPI backend server.
3. **Audio Validation & Preprocessing**: Backend enforces file format and size limits, then calls `FFmpeg` to convert audio to a standard **16 kHz mono 16-bit PCM WAV** stream.
4. **Pellav2 Inference**: PyTorch loads hidden-state outputs from a **Wav2Vec2** backbone (`pellav2_detector.pt`) to compute synthetic speech probability $p_{\text{fake}} \in [0.0, 1.0]$.
5. **Classification**: System returns structured classification label (`Likely Real` or `Likely AI-Generated`) and confidence score.

---

## ⚙️ Environment Variables

The application is completely configurable via environment variables on both local setups and cloud hosting platforms like Render.

| Variable | Scope | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `FRONTEND_URL` | Backend | `http://localhost:5173` | Allowed CORS origin for incoming web requests |
| `MODEL_PATH` | Backend | `../pellav2_detector.pt` | Path to PyTorch model weights file (`pellav2_detector.pt`) |
| `FFMPEG_PATH` | Backend | `ffmpeg` | Path or executable name for FFmpeg (checks system `PATH`) |
| `MAX_UPLOAD_SIZE_MB` | Backend | `25` | Maximum permitted file upload size in megabytes |
| `VITE_API_URL` | Frontend | `http://127.0.0.1:8000` | Backend API base URL consumed by the Vite React app |

### Configuration Templates

- **Backend**: `backend/.env.example`
  ```env
  FRONTEND_URL=http://localhost:5173
  MODEL_PATH=../pellav2_detector.pt
  FFMPEG_PATH=ffmpeg
  MAX_UPLOAD_SIZE_MB=25
  ```

- **Frontend**: `frontend/.env.example`
  ```env
  VITE_API_URL=http://127.0.0.1:8000
  ```

---

## 🚀 Deployment Instructions for Render

### Backend Web Service (Render)

1. **Create New Web Service** on Render dashboard.
2. Connect your GitHub repository.
3. **Configure Service Settings**:
   - **Service Type**: Web Service
   - **Environment**: Python
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. **Environment Variables**:
   - Set `FRONTEND_URL` to your published frontend Render URL (e.g. `https://voiceguard-frontend.onrender.com`).
   - Set `MODEL_PATH` to the location of `pellav2_detector.pt` (e.g. `/var/data/pellav2_detector.pt`).
   - Set `FFMPEG_PATH` to `ffmpeg`.
   - Set `MAX_UPLOAD_SIZE_MB` to `25`.

---

### Frontend Static Site (Render)

1. **Create New Static Site** on Render dashboard.
2. Connect your GitHub repository.
3. **Configure Site Settings**:
   - **Service Type**: Static Site
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. **Environment Variables**:
   - Set `VITE_API_URL` to your backend Render URL (e.g. `https://voiceguard-backend.onrender.com`).

---

## 📦 Pellav2 Model Storage Requirement for Render

The `pellav2_detector.pt` model file is **~1.26 GB**. Because git repositories should not store large binary artifacts (>100MB), the model is excluded from Git via `.gitignore`.

### Recommended Strategies for Render:

1. **Render Persistent Disk (Recommended for Dedicated/Standard instances)**:
   - Attach a Persistent Disk mounted at `/var/data` in your Render Web Service settings.
   - Upload `pellav2_detector.pt` directly to `/var/data/pellav2_detector.pt`.
   - Set `MODEL_PATH=/var/data/pellav2_detector.pt`.

2. **Cloud Storage / S3 / Hugging Face Direct Download**:
   - Host `pellav2_detector.pt` on AWS S3, Cloudflare R2, or Hugging Face.
   - Configure a pre-start script to download the model file to the container if not present before running `uvicorn`.

---

## 💻 Local Development Setup

### Backend

```bash
cd backend
python -m venv venv
# Windows: .\venv\Scripts\activate | macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🖼️ UI Snapshots Captured During Automated Testing

Below is the interface captured during local automated testing:

![VoiceGuard Landing Page UI](file:///C:/Users/HP/.gemini/antigravity/brain/dc8f3505-db08-478e-aed9-690b8e8e0a45/voiceguard_landing_page_1788526118042.png)

---

## ⚖️ Probabilistic Detection Disclaimer

Voice analysis returns a statistical likelihood score ($p_{\text{fake}}$) based on hidden-state neural representations. Detection results are probabilistic and must not be treated as absolute proof of caller identity.
