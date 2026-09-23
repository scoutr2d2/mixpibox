#!/bin/bash
# Waechter fuer librespot.
#
# DAS PROBLEM, das er loest (am Geraet gemessen, 2026-07-28): librespots
# Sitzung kann sterben, waehrend der Prozess weiterlaeuft -
#
#   ERROR librespot_core::session] Connection to server closed.
#
# Danach ist die Box aus Spotifys Geraeteliste VERSCHWUNDEN, aber systemd
# sieht einen gesunden Dienst: Restart=always greift nicht, NRestarts bleibt 0.
# Niemand merkt es, bis ein Kind auf ein Album tippt und nichts passiert.
# (Bekannt auch im Projekt selbst: librespot-org Issues #1700 und #1726.)
#
# Gemessen wird deshalb das SYMPTOM, nicht der Prozess: steht die Box in
# Spotifys Geraeteliste? Die Liste holt die Box ueber ihre eigene Durchreiche,
# es wird also kein Token im Skript gebraucht.
#
# ZWEI SICHERUNGEN gegen unnoetige Neustarts:
#   * WAEHREND DER WIEDERGABE NIE. Ein Neustart mitten im Lied ist genau der
#     Schaden, den der Waechter verhindern soll.
#   * ERST BEIM ZWEITEN MAL. Ein einzelner Fehlversuch (Netz kurz weg,
#     Spotify langsam) ist kein Grund - sonst startet der Waechter bei jeder
#     Stoerung neu und macht es schlimmer.

set -u

MERKER=/run/mupibox-librespot-waechter.fehlt
ZUSTAND=/tmp/playerstate
DURCHREICHE=http://localhost:8200/api/spotify/web/me/player/devices
NAME=$(/usr/bin/jq -r '.mupibox.host // "MuPiBox"' /etc/mupibox/mupiboxconfig.json 2>/dev/null)

melde() { echo "$(date '+%F %T') librespot-waechter: $*"; }

# Laeuft der Dienst ueberhaupt? Dann ist systemd zustaendig, nicht wir.
if ! systemctl is-active --quiet librespot; then
  melde "Dienst ist nicht aktiv - systemd ist am Zug, nichts zu tun"
  rm -f "$MERKER"
  exit 0
fi

# Waehrend der Wiedergabe fassen wir nichts an.
if [ "$(cat "$ZUSTAND" 2>/dev/null || true)" = "play" ]; then
  exit 0
fi

antwort=$(curl -s --max-time 20 "$DURCHREICHE" 2>/dev/null)
# Keine Antwort heisst NICHT "Geraet weg" - da ist eher die Box selbst noch
# nicht so weit (Start) oder das Netz kurz weg. Kein Grund fuer einen Neustart.
if [ -z "$antwort" ] || ! printf '%s' "$antwort" | grep -q '"devices"'; then
  exit 0
fi

if printf '%s' "$antwort" | grep -q "\"$NAME\""; then
  rm -f "$MERKER"
  exit 0
fi

# Geraet fehlt. Beim ersten Mal nur merken.
if [ ! -f "$MERKER" ]; then
  melde "Geraet \"$NAME\" fehlt in Spotifys Liste - beim naechsten Mal wird nachgesehen"
  : > "$MERKER"
  exit 0
fi
rm -f "$MERKER"

# ZWEITES MAL: erst nachsehen WARUM, dann handeln.
#
# Ein blosser Neustart ist die richtige Antwort auf nur EINE der beiden
# Ursachen. Am 2026-08-02 war es die andere: librespot lief tadellos, war bei
# Spotify angemeldet und hielt seine Verbindung - nur eben mit einem FREMDEN
# Konto. Jemand hatte per Spotify Connect vom Handy auf die Box gespielt, und
# dabei hatte librespot dessen Anmeldung uebernommen und credentials.json
# ueberschrieben. In der Geraeteliste der Box stand deshalb nichts, waehrend
# die Box in der Liste des fremden Kontos stand.
#
# Der Waechter startete daraufhin neu - und der Neustart meldete sich wieder
# beim fremden Konto an, denn die uebernommene credentials.json blieb ja. Alle
# fuenf Minuten von vorn, ohne dass sich je etwas geaendert haette. Ein
# Waechter, der immer dasselbe tut und nie nachsieht, ob es hilft, ist keiner.
#
# ══ DIE ZWEITE URSACHE, GEMESSEN AM 2026-08-11 ═══════════════════════════
# Betreiber: "spotify spielt nicht ab hat aber zugang". Diesmal war librespot
# NICHT beim fremden Konto - es wurde ueberhaupt nicht hereingelassen:
#
#     Login request was denied: INVALID_CREDENTIALS
#
# im Neustartkreis, 21 Mal. Der Kontovergleich sah davon nichts: er liest den
# Namen aus credentials.json, und das ist ein Dateizugriff, keine Anmeldung.
# Er meldete "dasselbe Konto", der Waechter startete also nur neu - und nach
# jedem Neustart dieselbe Absage.
#
# WARUM DIE UNTERSCHEIDUNG NICHT HIERHER GEHOERT: Von aussen sind beide Faelle
# identisch - die Box fehlt in Spotifys Geraeteliste. Ob sie fehlt, weil
# librespot woanders angemeldet ist, oder weil es gar nicht angemeldet ist,
# steht im Dienstzustand und im Protokoll. Beides liest --heilen, und beides
# heilt es gleich: frischer Token, alte Anmeldung beiseite, neu starten.
#
# --heilen STATT --reparieren, und das ist der Punkt: es fasst hoechstens alle
# 30 Minuten an. Der Waechter laeuft alle fuenf. Eine Abweisung, die sich nicht
# heilen laesst (Premium abgelaufen, Zugang zurueckgezogen), wuerde sonst
# sechsmal pro Stunde einen Token bei Spotify holen.
if [ -x /usr/local/bin/mupibox/librespot-konto.py ]; then
  /usr/bin/python3 /usr/local/bin/mupibox/librespot-konto.py --heilen --leise
  stand=$?
  if [ "$stand" != "0" ]; then
    melde "Geraet \"$NAME\" fehlt - librespot wurde neu angemeldet (oder es liegt nicht am Token, siehe journalctl -u librespot-waechter)"
    exit 0
  fi
  # 0 heisst hier: nichts zu heilen. Dann ist der Neustart unten die richtige
  # Antwort - librespot gehoert zum richtigen Konto und wird hereingelassen,
  # haengt aber trotzdem.
fi

melde "Geraet \"$NAME\" fehlt zum zweiten Mal, Konto stimmt - librespot wird neu gestartet"
systemctl restart librespot
