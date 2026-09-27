#!/bin/bash
#
# Die Wiedergabedienste neu starten — und SAGEN, ob es geklappt hat.
#
# FRUEHER lief das ueber pm2:
#     [ -e /usr/bin/pm2 ] && su - dietpi -s /usr/bin/pm2 restart server …
#     echo "Spotify Services restarted"
#
# Seit die Dienste als systemd-Units laufen (llmwiki mupi-startzeiten-gemessen)
# hat pm2 keine Prozesse mehr. Die beiden `if`-Zweige trafen also entweder gar
# nicht zu, oder sie starteten etwas neu, das es nicht gab — und die letzte
# Zeile meldete in JEDEM Fall Erfolg. Am Geraet belegt (2026-08-02): die
# pm2-Protokolle stehen seit dem 29.07. still.
#
# Eine Erfolgsmeldung, die auch ohne Erfolg kommt, ist schlimmer als gar keine:
# sie beendet die Fehlersuche an der falschen Stelle. Deshalb meldet dieses
# Skript, WAS es neu gestartet hat, und endet mit != 0, wenn nichts ging.
set -u

DIENSTE="mupibox-server mupibox-player"
getan=""
fehler=0

for dienst in $DIENSTE; do
  # `systemctl cat` statt is-active: der Dienst soll auch dann neu gestartet
  # werden, wenn er gerade steht.
  systemctl cat "$dienst" >/dev/null 2>&1 || continue
  if systemctl restart "$dienst" 2>/dev/null; then
    getan="$getan $dienst"
  else
    echo "FEHLER: $dienst liess sich nicht neu starten" >&2
    fehler=1
  fi
done

# HIER STAND EIN RUECKFALL AUF pm2 — ENTFERNT AM 14.08.2026.
#
# Er war fuer „aeltere Boxen" gedacht, auf denen die App noch unter pm2 lief.
# Solche Boxen kann dieses Repo nicht mehr erzeugen: autosetup.sh (frische
# Karte) und start_mupibox_update.sh (laufende Box) fahren seit heute beide
# die systemd-Units, und der remote-step-installer tat es schon vorher.
# An der laufenden Box .57 nachgemessen (tools/pm2-bestand.sh): pm2 ist nicht
# installiert, kein Verwalterprozess, ~/.pm2 existiert nicht.
#
# Der Rueckfall haette dort also nie ausgeloest — `command -v pm2` faellt
# durch. Was bleibt, wenn er weg ist, ist der ehrlichere Fall: findet sich
# keine Unit, sagt das Skript das und endet mit != 0, statt einen Verwalter zu
# suchen, den niemand mehr installiert.

if [ -n "$getan" ]; then
  echo "Neu gestartet:$getan"
else
  echo "NICHTS neu gestartet — keine der Units $DIENSTE gefunden" >&2
  fehler=1
fi

exit $fehler
