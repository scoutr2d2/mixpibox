#!/bin/bash
# Nach einem Testlauf die Oberflaeche der Box wieder auf Anfang bringen.
#
# WOFUER: ein Testlauf laesst die Box irgendwo mitten in der Bibliothek stehen -
# in einer Titelliste, mit offenem Player, mit gestoppter Wiedergabe. Wer danach
# hinschaut, sieht einen Zustand, den niemand gewollt hat, und haelt ihn leicht
# fuer einen Fehler.
#
# WIE: NICHT ueber ein F5 von aussen (dafuer muesste ein Fernwartungs-Port offen
# stehen, den hier niemand offen haben will) und NICHT ueber einen
# Kiosk-Neustart (`restart_kiosk.sh` toetet X, und aus einem Dienst heraus kommt
# es genauso wenig zurueck - am Geraet zweimal erlebt, schwarzer Bildschirm bis
# zum Neustart der ganzen Box).
#
# Stattdessen ueber den Weg, den die Box ohnehin geht: sie fragt einmal je
# Minute `GET /api/oberflaeche/stand` und laedt neu, wenn sich der Wert AENDERT.
# `POST /api/oberflaeche/neuladen` aendert ihn. Die Box entscheidet weiterhin
# selbst; wir geben ihr nur einen Grund.
#
# WAS DAS NICHT KANN: eine EINGEFRORENE Seite retten. Steht deren JavaScript,
# steht auch ihr Zeitgeber, und dann fragt sie nie wieder nach. Dagegen hilft
# nur `sudo systemctl reboot` auf der Box (rund 20 s, der Weg, den sie taeglich
# geht). Dieses Skript raeumt auf, es rettet nicht.
#
# Die Musik laeuft weiter: sie spielt in librespot bzw. mpv, nicht im Browser.
#
# AUFRUF
#   tools/aufraeumen.sh                  gegen mupibox
#   tools/aufraeumen.sh 192.168.178.48   gegen eine andere Adresse
#   MUPI_HOST=... tools/aufraeumen.sh

set -u
HOST="${1:-${MUPI_HOST:-mupibox}}"

antwort=$(curl -s --max-time 8 -X POST "http://${HOST}:8200/api/oberflaeche/neuladen" 2>/dev/null)

if [ -z "$antwort" ]; then
  echo "  Aufraeumen: Box nicht erreichbar ($HOST) - nichts angefordert"
  exit 0            # kein Fehler: der Testlauf selbst war ja erfolgreich
fi

echo "  Aufraeumen: Neuladen angefordert - die Box laedt binnen einer Minute neu"
