#!/usr/bin/env bash
# dietpi-txt-vergleich.sh — Was steht in der dietpi.txt der Box ANDERS als in
# unserer Vorlage config/templates/dietpi.txt?
#
# WARUM ES DIESES WERKZEUG GIBT
# Die dietpi.txt wirkt fast nur bei der ERSTINSTALLATION. Wer spaeter an der
# laufenden Box misst, sieht dort Werte stehen, die nie gewirkt haben (Beispiel
# BACKLOG X2/E5: SWAPFILE_LOCATION=/var/swap in der Datei, zram im Betrieb).
# Deshalb vergleicht dieses Werkzeug NUR Datei gegen Datei und sagt ausdruecklich
# dazu, dass der Betriebszustand woanders steht.
#
# Aufruf:
#   tools/dietpi-txt-vergleich.sh                       # gegen dietpi@192.168.178.57
#   tools/dietpi-txt-vergleich.sh dietpi@192.168.178.99
#   BOX_DATEI=/pfad/zu/dietpi.txt tools/dietpi-txt-vergleich.sh
#
# Nur lesend: holt die Datei per ssh cat, schreibt nichts auf die Box.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VORLAGE="${REPO}/config/templates/dietpi.txt"
ZIEL="${1:-dietpi@192.168.178.57}"

[ -f "${VORLAGE}" ] || { echo "FEHLT: ${VORLAGE}" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

if [ -n "${BOX_DATEI:-}" ]; then
  cp "${BOX_DATEI}" "${TMP}/box.txt" || exit 1
else
  ssh -o ConnectTimeout=8 "${ZIEL}" 'cat /boot/dietpi.txt' >"${TMP}/box.txt" || {
    echo "Box ${ZIEL} nicht erreichbar." >&2; exit 1; }
fi

# Nur gesetzte Zeilen (kein Kommentar, kein Leerraum), auf SCHLUESSEL=WERT reduziert.
schluessel_werte() {
  grep -vE '^[[:space:]]*(#|$)' "$1" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | sort -t= -k1,1
}

schluessel_werte "${VORLAGE}" >"${TMP}/vorlage.kv"
schluessel_werte "${TMP}/box.txt" >"${TMP}/box.kv"

echo "Vorlage : ${VORLAGE}"
echo "Box     : ${ZIEL}:/boot/dietpi.txt"
echo
echo "=== ABWEICHUNGEN (Schluessel steht in beiden, Wert unterschiedlich) ==="
join -t= -j1 -o 0,1.2,2.2 \
  <(cut -d= -f1 "${TMP}/vorlage.kv" | paste -d= - <(cut -d= -f2- "${TMP}/vorlage.kv")) \
  <(cut -d= -f1 "${TMP}/box.kv"     | paste -d= - <(cut -d= -f2- "${TMP}/box.kv")) 2>/dev/null \
| awk -F= 'NF>=3 { schl=$1; v=$2; b=$3; if (v != b) printf "%-42s Vorlage=%-45s Box=%s\n", schl, v, b }'

echo
echo "=== NUR IN DER VORLAGE (Box kennt den Schluessel nicht) ==="
comm -23 <(cut -d= -f1 "${TMP}/vorlage.kv" | sort -u) <(cut -d= -f1 "${TMP}/box.kv" | sort -u)

echo
echo "=== NUR AUF DER BOX (unsere Vorlage setzt ihn nicht) ==="
comm -13 <(cut -d= -f1 "${TMP}/vorlage.kv" | sort -u) <(cut -d= -f1 "${TMP}/box.kv" | sort -u)

echo
echo "HINWEIS: dietpi.txt wirkt im Wesentlichen nur beim ERSTEN Start."
echo "Den Betriebszustand sagen: /boot/dietpi/.installed (Softwaretitel),"
echo "/boot/dietpi/.dietpi-autostart_index (Autostart), systemctl, findmnt /var/log."
