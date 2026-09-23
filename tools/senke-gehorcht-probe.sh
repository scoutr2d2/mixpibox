#!/usr/bin/env bash
# Nimmt eine Senke Lautstaerke an? — die Frage, die seit dem 15.08. immer
# wiederkommt.
#
# WARUM ES DIESE PROBE GIBT: Eine Filter-Kette (`libpipewire-module-filter-chain`)
# meldet `set-volume` mit Exit 0 und tut NICHTS, wenn ihr `capture.volumes`
# fehlt. Man sieht den Fehler also nicht am Befehl, sondern nur daran, dass
# der zurueckgelesene Wert der alte ist. Genau das misst diese Probe.
#
# NICHT RATEN, SONDERN ZURUECKLESEN — und zwar mit Abstand: PipeWire uebernimmt
# den Wert asynchron. Ohne die Pause misst man den Zustand VOR dem Setzen und
# haelt eine taube Senke faelschlich fuer gehorsam.
#
# Aufruf:
#   tools/senke-gehorcht-probe.sh                      # Vorgabe-Senke, lokal
#   tools/senke-gehorcht-probe.sh klangwerk            # benannte Senke
#   BOX=dietpi@192.168.178.62 tools/senke-gehorcht-probe.sh klangwerk
#
# Exit 0 = gehorcht, 1 = taub, 2 = nicht messbar.
set -u

SENKE="${1:-}"
BOX="${BOX:-}"

# Auf der Box ODER lokal — derselbe Code, nur ein anderer Vorspann. So misst
# die Probe garantiert dasselbe, egal von wo sie gerufen wird.
lauf() {
  if [ -n "$BOX" ]; then
    ssh -o ConnectTimeout=8 -o BatchMode=yes "$BOX" "$1" 2>/dev/null
  else
    bash -c "$1" 2>/dev/null
  fi
}

[ -z "$SENKE" ] && SENKE="$(lauf 'pactl get-default-sink' | tr -d '\r')"
if [ -z "$SENKE" ]; then
  echo "X  keine Senke gefunden (laeuft PipeWire?)"
  exit 2
fi

vorher="$(lauf "pactl get-sink-volume '$SENKE'" | grep -o '[0-9]\+%' | head -1 | tr -d '%')"
if [ -z "$vorher" ]; then
  echo "X  Senke '$SENKE' liefert keinen Pegel"
  exit 2
fi

# Ein Zielwert, der SICHER ein anderer ist: sonst kann eine taube Senke
# zufaellig richtig aussehen, weil sie schon auf dem Wunschwert stand.
ziel=42
[ "$vorher" = "$ziel" ] && ziel=57

lauf "pactl set-sink-volume '$SENKE' ${ziel}%" >/dev/null
sleep 0.4
nachher="$(lauf "pactl get-sink-volume '$SENKE'" | grep -o '[0-9]\+%' | head -1 | tr -d '%')"

# Immer zuruecksetzen — eine Messung darf die Box nicht lauter zuruecklassen,
# als sie war. Auch im Fehlerfall (deshalb vor der Auswertung).
lauf "pactl set-sink-volume '$SENKE' ${vorher}%" >/dev/null

echo "Senke:   $SENKE"
echo "vorher:  ${vorher}%   gesetzt: ${ziel}%   zurueckgelesen: ${nachher:-?}%"

# Ein Prozent Toleranz: pactl rundet zwischen seiner Prozent- und der
# internen Bruchdarstellung.
if [ -n "$nachher" ] && [ "$((nachher > ziel ? nachher - ziel : ziel - nachher))" -le 1 ]; then
  echo "OK   '$SENKE' GEHORCHT — der Wert kam an."
  exit 0
fi
echo "X    '$SENKE' IST TAUB — set-volume meldete Erfolg, der Wert blieb bei ${nachher:-?}%."
echo "     Bei einer Filter-Kette heisst das: es fehlt 'capture.volumes'."
exit 1
