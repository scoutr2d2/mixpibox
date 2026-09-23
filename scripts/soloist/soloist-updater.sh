#!/bin/bash
#
# DER 90-TAGE-WAECHTER (E42/S4) — holt neue Soloist-Builds, bevor der alte
# verfaellt.
#
# ══ WARUM ES IHN GEBEN MUSS ═════════════════════════════════════════════════
#
# Jeder Soloist-Build stellt 90 Tage nach seinem BAU-Datum die Arbeit ein —
# eingebaut, dokumentiert, von Spotify so gewollt. Eine Box, die nur in der
# Ecke steht, verloere Spotify nach drei Monaten, und niemand wuesste warum.
# Ohne diesen Waechter darf Soloist deshalb NIE die Vorgabe sein (E42).
#
# ══ WIE ER PRUEFT — GEMESSEN AM 19.08.2026 ══════════════════════════════════
#
# Der CDN traegt ETag und Last-Modified; ein HEAD-Abruf kostet nichts. Der
# ETag ist praktisch die Pruefsumme des Archivs: unser 17:04-Download und der
# 17:43-Stand desselben Tages hatten VERSCHIEDENE — Spotify baut rollierend,
# es gibt also fast immer etwas Frisches. Verglichen wird der ETag mit dem
# gemerkten Stand; nur bei Unterschied wird geladen.
#
# ══ WAS ER NIE TUT ══════════════════════════════════════════════════════════
#
#   · Er startet den Dienst NICHT neu, waehrend etwas spielt. Ein Update ist
#     kein Grund, einem Kind das Hoerspiel abzuschneiden — dann eben beim
#     naechsten Lauf.
#   · Er ersetzt das Binary nur, wenn das neue sich ausweisen kann
#     (`soloist -V` am entpackten Stueck). Ein kaputter Download bleibt im
#     Zwischenordner liegen und faellt im Journal auf.
#
# Aufruf: von soloist-updater.timer (woechentlich), oder von Hand:
#     sudo /usr/local/bin/mupibox/soloist-updater.sh

set -u

CDN="https://soloist-builds.spotifycdn.com/soloist_release_arm64.tar.gz"
BINARY="/usr/local/bin/soloist"
STAND="/var/lib/soloist"
MERK="${STAND}/.installiert-etag"
WARNUNG="${STAND}/update-warnung.txt"
CONFIG="/etc/mupibox/mupiboxconfig.json"
# 90 Tage Verfall, 14 Tage Vorlauf: ab Tag 76 wird ein Scheitern zur Warnung.
WARN_AB_TAGEN=76

sag() { echo "$(date '+%F %T') $*"; }

mkdir -p "${STAND}"

# ── Wie alt ist der eingebaute Build? ────────────────────────────────────────
# `soloist -V` nennt das Bau-Datum als (YYYYMMDD). Daraus das Alter — die
# Grundlage der Warnung, unabhaengig davon, ob das Netz gerade traegt.
alter_tage=""
if [ -x "${BINARY}" ]; then
    baudatum=$("${BINARY}" -V 2>/dev/null | grep -oE '\(20[0-9]{6}\)' | tr -d '()' | head -1)
    if [ -n "${baudatum}" ]; then
        alter_tage=$(( ( $(date +%s) - $(date -d "${baudatum}" +%s) ) / 86400 ))
        sag "eingebauter Build vom ${baudatum} (${alter_tage} Tage alt)"
    fi
fi

# ── Gibt es etwas Neues? — HEAD, kein Download ──────────────────────────────
etag=$(curl -sI --max-time 30 "${CDN}" | tr -d '\r' | awk -F'"' 'tolower($0) ~ /^etag:/ {print $2}')
if [ -z "${etag}" ]; then
    sag "CDN nicht erreichbar oder ohne ETag - kein Update moeglich"
    if [ -n "${alter_tage}" ] && [ "${alter_tage}" -ge "${WARN_AB_TAGEN}" ]; then
        echo "Soloist-Build ist ${alter_tage} Tage alt (Verfall bei 90) und das Update scheitert: CDN nicht erreichbar ($(date '+%F %T'))" > "${WARNUNG}"
        sag "WARNUNG geschrieben: ${WARNUNG}"
    fi
    exit 1
fi

if [ -f "${MERK}" ] && [ "$(cat "${MERK}")" = "${etag}" ]; then
    sag "kein neuer Build (ETag unveraendert: ${etag})"
    # Auch ohne Neues gilt die Alterswarnung: wenn Spotify aufhoert zu bauen,
    # aendert sich der ETag nie wieder - genau dann muss es hier laut werden.
    if [ -n "${alter_tage}" ] && [ "${alter_tage}" -ge "${WARN_AB_TAGEN}" ]; then
        echo "Soloist-Build ist ${alter_tage} Tage alt (Verfall bei 90) und der CDN bietet nichts Neueres an ($(date '+%F %T'))" > "${WARNUNG}"
        sag "WARNUNG geschrieben: ${WARNUNG}"
    fi
    exit 0
fi

# ── Holen, pruefen, atomar einsetzen ────────────────────────────────────────
sag "neuer Build (ETag ${etag}) - lade"
ZWISCHEN=$(mktemp -d /var/tmp/soloist-update.XXXXXX)
trap 'rm -rf "${ZWISCHEN}"' EXIT

if ! curl --fail --location --silent --max-time 300 -o "${ZWISCHEN}/soloist.tar.gz" "${CDN}"; then
    sag "Download gescheitert"
    exit 1
fi
tar -xzf "${ZWISCHEN}/soloist.tar.gz" -C "${ZWISCHEN}" || { sag "Archiv nicht entpackbar"; exit 1; }

# DAS NEUE MUSS SICH AUSWEISEN, bevor es das alte ersetzt.
neu_version=$("${ZWISCHEN}/soloist" -V 2>/dev/null | head -1)
if [ -z "${neu_version}" ]; then
    sag "das entpackte Binary antwortet nicht auf -V - es wird NICHT eingesetzt"
    exit 1
fi
sag "neu: ${neu_version}"

install -m 755 "${ZWISCHEN}/soloist" "${BINARY}.neu"
mv -f "${BINARY}.neu" "${BINARY}"
echo "${etag}" > "${MERK}"
rm -f "${WARNUNG}"
sag "eingesetzt nach ${BINARY}"

# ── Neustart nur, wenn Soloist die gewaehlte Maschine ist UND nichts spielt ─
engine=$(jq -r '.spotify.engine // "librespot"' "${CONFIG}" 2>/dev/null)
if [ "${engine}" != "soloist" ]; then
    sag "engine=${engine} - kein Neustart noetig, der naechste Start nimmt den neuen Build"
    exit 0
fi
status=$(sudo -u dietpi "${BINARY}" ctl now --json -D "${STAND}" 2>/dev/null | jq -r '.status // "unbekannt"' 2>/dev/null)
if [ "${status}" = "playing" ]; then
    sag "es spielt gerade - der Neustart wartet auf den naechsten Lauf"
    exit 0
fi
systemctl restart soloist.service && sag "soloist.service neu gestartet (Status war: ${status})"
