#!/usr/bin/env bash
# WOZU: Nachweisen, dass ein SPRECHBEFEHL im Abspieldienst in die
#       Befehlskette DURCHFAELLT — und dort als Steuerbefehl gedeutet wird.
#
# DER VERDACHT (aus dem Quelltext): Der Handler zerlegt den Pfad mit
# `path.parse`. Bei `/current/say/<TEXT>` ist `command.name` der TEXT selbst.
# Weiter unten schaltet eine lange else-if-Kette auf genau dieses
# `command.name` — `stop`, `pause`, `reboot`, `recordon`, `shutoff`, …
# Eine Kachel, die „stop" heisst, saegt sich damit selbst ab.
#
# DER BEWEIS OHNE TON UND OHNE SCHADEN: `recordon` setzt nur ein Flag in
# `/local` (`recording`). Es ist am Zustand ablesbar, macht kein Geraeusch,
# und `recordoff` nimmt es zurueck. Deshalb wird GENAU DIESER Befehl benutzt
# und nicht `stop` oder gar `reboot`.
#
# FALLE (kostete hier einen Lauf): der Zustand der Box steht unter `/local`,
#       NICHT unter `/state` — `/state` liefert eine Spotify-foermige Antwort
#       ohne `recording`, und ein fehlender Schluessel sieht aus wie „kein
#       Durchfall". Ein Nein aus dem falschen Endpunkt ist kein Nein.
#
# AUFRUF:  tools/say-befehl-durchfall.sh [BOX]
#
# ZURUECKSTELLEN: im `trap`, nicht am Ende des Erfolgswegs — bricht das
# Skript in der Mitte ab, darf die Box nicht mit gesetztem Flag zurueckbleiben.

set -u
BOX="${1:-192.168.178.169}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=6 dietpi@${BOX}"

stand() { $SSH "curl -s -m 4 http://127.0.0.1:5005/local" 2>/dev/null | python3 -c \
  'import json,sys
try: print(json.load(sys.stdin).get("recording"))
except Exception: print("?")'; }

zurueck() {
  echo "-- zuruecksetzen (recordoff) --"
  $SSH "curl -s -o /dev/null -m 4 http://127.0.0.1:5005/current/recordoff" 2>/dev/null
  echo "   recording jetzt: $(stand)"
}
trap zurueck EXIT

echo "== Box ${BOX} =="
echo "vorher                        recording = $(stand)"

echo
echo "-- /current/say/recordon  (ein SPRECHBEFEHL, kein Steuerbefehl) --"
$SSH "curl -s -o /dev/null -m 5 http://127.0.0.1:5005/current/say/recordon" 2>/dev/null
sleep 1
NACHHER=$(stand)
echo "nachher                       recording = ${NACHHER}"

echo
if [ "$NACHHER" = "True" ] || [ "$NACHHER" = "true" ]; then
  echo "BELEGT: der Sprechbefehl ist in die Steuerkette durchgefallen."
  echo "        Eine Kachel namens „recordon\" haette den Aufnahmezustand gesetzt;"
  echo "        eine namens „stop\" haette die Wiedergabe angehalten."
else
  echo "NICHT belegt: das Flag blieb unveraendert (Stand ${NACHHER})."
  echo "        Entweder ist der Dienst schon gefixt, oder /local meldet anders."
fi
