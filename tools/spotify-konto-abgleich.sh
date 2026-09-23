#!/bin/sh
# Fragt eine Box, ob sie und librespot beim selben Spotify-Konto angemeldet sind.
#
# Das Wissen steckt NICHT hier, sondern in scripts/librespot/librespot-konto.py
# — demselben Skript, das auch auf der Box liegt und vom Waechter benutzt wird.
# Dieses Werkzeug speist es nur ueber ssh ein. So gibt es keine zweite Fassung,
# die irgendwann anders urteilt als die, die im Betrieb laeuft.
#
# AUFRUF
#     tools/spotify-konto-abgleich.sh 192.168.178.169
#     tools/spotify-konto-abgleich.sh 192.168.178.169 --reparieren
#
# Rueckgabe: 0 = dasselbe Konto, 1 = verschieden, 2 = nicht feststellbar.
set -eu

BOX="${1:-}"
if [ -z "$BOX" ]; then
  echo "Aufruf: $(basename "$0") <box> [--reparieren]" >&2
  exit 2
fi
shift

HIER=$(dirname "$0")
exec ssh -o BatchMode=yes -o ConnectTimeout=8 "dietpi@${BOX}" "sudo python3 - $*" \
  < "${HIER}/../scripts/librespot/librespot-konto.py"
