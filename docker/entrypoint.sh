#!/bin/bash
#
# Startpunkt des Entwicklungs-Abbilds (Dockerfile im Wurzelverzeichnis).
#
# HIER STAND BIS ZUM 14.08.2026 pm2:
#     cd …/Sonos-Kids-Controller-master && pm2 start server.js
#     cd …/spotifycontroller-main       && pm2 start spotify-control.js
#
# Auf der Box laufen beide seit dem 29.07.2026 als systemd-Units. Der nahe
# liegende Schluss waere, hier `systemctl start mupibox-server` zu schreiben —
# DAS WAERE FALSCH. In diesem Abbild ist systemd nicht PID 1 (es ist gar nicht
# installiert); `systemctl` faende keinen Bus und das Abbild startete nichts
# mehr. Ein Container hat bereits eine Prozessverwaltung: den Container selbst.
#
# Deshalb wird hier genau das ausgefuehrt, was in den `ExecStart=`-Zeilen von
# config/services/mupibox-server.service und mupibox-player.service steht —
# dieselben zwei Programme, nur ohne Verwalter dazwischen. Wer die Units
# aendert, muss diese Datei mitziehen; die Kommentare dort und hier verweisen
# aufeinander.
#
# XDG_RUNTIME_DIR bleibt hier ABSICHTLICH weg. In der Unit des Abspieldienstes
# steht es, weil PipeWire ein Sitzungsdienst ist — in diesem Abbild gibt es
# weder PipeWire noch eine Sitzung noch eine Soundkarte. Es zu setzen wuerde
# auf ein Verzeichnis zeigen, das nicht existiert.

set -u

cd /home/dietpi/.mupibox/Sonos-Kids-Controller-master || exit 1
/usr/bin/node server.js &

cd /home/dietpi/.mupibox/spotifycontroller-main || exit 1
/usr/bin/node spotify-control.js &


# Run cmd with forwarded args.
exec "$@"
