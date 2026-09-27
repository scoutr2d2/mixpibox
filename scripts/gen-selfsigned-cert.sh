#!/usr/bin/env bash
# Generate a self-signed TLS certificate for MuPiBox.
#
# MuPiBox has no public DNS name, so HTTPS uses a self-signed cert. Both backends
# (backend-api :8200, backend-player :5005) serve HTTPS when <dir>/cert.pem +
# <dir>/key.pem exist, and fall back to HTTP otherwise — so this is OPT-IN: run
# this to turn HTTPS on, delete the files to turn it off.
#
# Usage:  gen-selfsigned-cert.sh [DIR] [EXTRA_SAN]
#   DIR        output dir (default /etc/mupibox/tls)
#   EXTRA_SAN  extra subjectAltName, e.g. "IP:192.168.1.50" or "DNS:mupibox.local"
#              (add the box's LAN IP so other devices can reach it over HTTPS)
#
# The cert always covers localhost + 127.0.0.1 (the loopback the kiosk uses).
set -euo pipefail

DIR="${1:-/etc/mupibox/tls}"
EXTRA_SAN="${2:-}"

SAN="DNS:localhost,IP:127.0.0.1"
[ -n "$EXTRA_SAN" ] && SAN="${SAN},${EXTRA_SAN}"

mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${DIR}/key.pem" -out "${DIR}/cert.pem" -days 3650 \
  -subj "/CN=MuPiBox" \
  -addext "subjectAltName=${SAN}" >/dev/null 2>&1

chmod 600 "${DIR}/key.pem" 2>/dev/null || true
echo "MuPiBox TLS cert written to ${DIR} (cert.pem + key.pem)"
echo "  subjectAltName: ${SAN}"
echo "  Restart the backends to pick it up; open the app via https://127.0.0.1:<port>"
