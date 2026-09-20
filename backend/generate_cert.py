"""
VoiceGuard Local HTTPS Certificate Generator

Generates a local SSL/TLS certificate (cert.pem & key.pem) with SAN (Subject Alternative Name)
entries for local IP addresses (e.g. 10.83.191.174) and localhost.

This allows Android Chrome on the phone to accept HTTPS and grant microphone access.

Usage:
    python generate_cert.py [IP_ADDRESS]

Examples:
    python generate_cert.py 10.83.191.174
    python generate_cert.py               # Auto-detects local LAN IP

Requirements / mkcert Guide:
    For a fully trusted certificate on Android (no browser security warning):
    1. Install mkcert on Windows:
          choco install mkcert
       or download from https://github.com/FiloSottile/mkcert/releases
    2. Install Root CA on local machine:
          mkcert -install
    3. Generate cert with SAN:
          mkcert -cert-file cert.pem -key-file key.pem 10.83.191.174 localhost 127.0.0.1
    4. Copy rootCA.pem to your phone and install under Settings -> Security -> Install Certificate.
"""

import ipaddress
import os
import socket
import sys
from pathlib import Path


def get_local_ip() -> str:
    """Detect local LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def generate_self_signed_cert(ip_address: str, cert_path: str = "cert.pem", key_path: str = "key.pem"):
    """Generate self-signed X.509 certificate with IP SAN using cryptography library."""
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        import datetime
    except ImportError:
        print("[!] The 'cryptography' package is missing. Installing...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "cryptography"])
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        import datetime

    print(f"[*] Generating SSL certificate for IP: {ip_address}")

    # Generate key
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Subject & Issuer
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "State"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "City"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "VoiceGuard Local"),
        x509.NameAttribute(NameOID.COMMON_NAME, ip_address),
    ])

    # SANs (Subject Alternative Names)
    san_list = [
        x509.DNSName("localhost"),
        x509.DNSName("127.0.0.1"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    try:
        san_list.append(x509.IPAddress(ipaddress.ip_address(ip_address)))
    except ValueError:
        san_list.append(x509.DNSName(ip_address))

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    # Write key.pem
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    # Write cert.pem
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"[+] SSL Certificate created successfully:")
    print(f"    - Certificate: {Path(cert_path).resolve()}")
    print(f"    - Key:         {Path(key_path).resolve()}")
    print(f"    - IP SAN:      {ip_address}")


if __name__ == "__main__":
    target_ip = sys.argv[1] if len(sys.argv) > 1 else get_local_ip()
    generate_self_signed_cert(target_ip)
