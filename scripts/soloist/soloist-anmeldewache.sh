#!/bin/bash
#
# DIE ANMELDEWACHE (E104, 30.08.2026) — heilt den stummen Soloist.
#
# Am Geraet passiert: Box bootet 17:58, soloist startet, versucht EINMAL die
# Anmeldung — 16 s nach dem Boot, Uhr und Netz noch beim Sortieren — und
# bekommt "login failed: make sure --api-key is valid". Danach laeuft der
# Prozess einfach weiter (kein Exit, Restart=always greift also nie), haelt
# ~16 % CPU, und die Box meldet "keine Verbindung zu Spotify", bis jemand
# von Hand neu startet. Der Schluessel war die ganze Zeit gueltig: derselbe
# Dienst meldete sich nach einem Neustart um 18:18 in fuenf Sekunden an.
#
# Diese Wache liest das Logbuch DES LAUFENDEN Dienststarts (ab
# ActiveEnterTimestamp — der Fehlversuch von vorgestern zaehlt nicht):
# steht dort "login failed" und KEIN "logged in as", wird genau ein
# Neustart angestossen. Beide Suchtexte sind am Geraet gemessene
# Soloist-Ausgaben (1.3.7.485), keine Vermutungen.
#
# Ein dauerhaft kaputter Schluessel fuehrt zu einem 2-Minuten-Kreisel,
# der im Logbuch laut sagt, warum — das ist gewollt: eine Box ohne
# gueltigen Schluessel hat ohnehin kein Spotify, und der woechentliche
# soloist-updater ist die Stelle, die verfallene Builds erneuert.
set -u

CONFIG="/etc/mupibox/mupiboxconfig.json"

ENGINE=$(/usr/bin/jq -r '.spotify.engine // "librespot"' "${CONFIG}" 2>/dev/null)
[ "${ENGINE}" = "soloist" ] || exit 0
systemctl is-active --quiet soloist || exit 0

SEIT=$(systemctl show -p ActiveEnterTimestamp --value soloist)
[ -n "${SEIT}" ] || exit 0

LOGBUCH=$(journalctl -u soloist --since "${SEIT}" --no-pager 2>/dev/null)
if grep -q "logged in as" <<<"${LOGBUCH}"; then
    exit 0
fi
if ! grep -q "login failed" <<<"${LOGBUCH}"; then
    # Noch kein Urteil — Dienst frisch gestartet, die Anmeldung laeuft
    # vielleicht gerade. Nicht dazwischenfunken.
    exit 0
fi

echo "anmeldewache: soloist seit ${SEIT} ohne Anmeldung ('login failed' im Logbuch) — Neustart"
systemctl restart soloist
