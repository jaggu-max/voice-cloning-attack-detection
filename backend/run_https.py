"""
VoiceGuard Dual Server Launcher

Runs FastAPI on TWO ports simultaneously:
- Port 8000 (HTTP):  For local laptop frontend (http://localhost:5173), File Analysis, and API.
- Port 8443 (HTTPS): For mobile phone Chrome (https://10.83.191.174:8443/mobile) with secure microphone WSS.
"""

import os
import sys
import time
import subprocess
import threading
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent


def free_ports():
    """Kill any process holding port 8000 or 8443."""
    if sys.platform == "win32":
        cmd = (
            "Get-NetTCPConnection -LocalPort 8000,8443 -ErrorAction SilentlyContinue | "
            "ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(["powershell", "-Command", cmd], capture_output=True)


def run_http_server():
    """Run HTTP Uvicorn server on port 8000."""
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="warning",
    )


def run_https_server(cert_path: Path, key_path: Path):
    """Run HTTPS Uvicorn server on port 8443."""
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8443,
        ssl_keyfile=str(key_path),
        ssl_certfile=str(cert_path),
        reload=False,
        log_level="warning",
    )


def main():
    os.chdir(BACKEND_DIR)
    free_ports()

    cert_path = BACKEND_DIR / "cert.pem"
    key_path = BACKEND_DIR / "key.pem"

    if not cert_path.exists() or not key_path.exists():
        print("[*] SSL certificate not found. Auto-generating local SSL cert...")
        gen_script = BACKEND_DIR / "generate_cert.py"
        subprocess.run([sys.executable, str(gen_script)], check=True)

    print("\n" + "=" * 65)
    print("  VOICEGUARD DUAL BACKEND SERVER IS RUNNING")
    print("=" * 65)
    print("  1. Laptop HTTP API:   http://localhost:8000")
    print("  2. Phone HTTPS URL:   https://10.83.191.174:8443/mobile")
    print("=" * 65 + "\n")

    # Start HTTP server on port 8000 in background thread
    t_http = threading.Thread(target=run_http_server, daemon=True)
    t_http.start()

    # Run HTTPS server on port 8443 in main thread
    run_https_server(cert_path, key_path)


if __name__ == "__main__":
    main()
