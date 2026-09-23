#!/bin/bash
# STRENG LESEND: wer zieht die Lautstaerke der Vorgabe-Senke herunter?
#
# WOZU
# Am 23.08.2026 fiel die Vorgabe-Senke (klangwerk, Knoten 75) nach einem
# `wpctl set-volume 75 0.60` in Stufen auf 0.30 und blieb dort liegen. Ein
# Verdacht lautete: `mupi-lautstaerke.sh down 5`, ausgeloest ueber
# GET /volume/-5 am Abspieldienst (5005).
#
# DIESE PROBE WIDERLEGT ODER BESTAETIGT DAS, OHNE ETWAS ZU SETZEN. Sie zaehlt
# jede Ausfuehrung von mupi-lautstaerke.sh NACH UNTERBEFEHL und protokolliert
# jede Wertaenderung an der beobachteten Senke.
#
# ZWEI ZEUGEN, WEIL EINER NICHT REICHT
#   1. Die Prozesstabelle. Sie ist LUECKENHAFT: der 1-Sekunden-Takt des
#      Abspieldienstes ruft `get` 240x in 240 s auf, gesehen werden davon bei
#      0.3 s Abtastung nur rund 45. Ein einzelnes `down` kann also durchrutschen.
#   2. Der WERT selbst. Er ist der verlaessliche Zeuge: JEDES `down 5` senkt die
#      Senke um genau 5 Punkte und ist damit sichtbar, auch wenn der Prozess
#      nicht erwischt wurde. Bleibt der Wert stehen, hat kein `down` stattgefunden.
#
# DER ZWEITE FINGERABDRUCK (fuer die Gegenprobe von Hand)
# `setze()` in mupi-lautstaerke.sh ruft VOR dem Setzen `einheit_nachziehen`,
# und das stellt JEDE andere Audio/Sink mit Pegel < 0.999 auf 100 %. Wer also
# eine fremde Senke als Markierung auf 50 % stellt und beim naechsten Absacken
# nachsieht: steht sie auf 100 %, lief das Skript; steht sie noch auf 50 %,
# war es NICHT mupi-lautstaerke.sh — weder `down` noch `set`.
#
#   Aufruf:  bash tools/lautstaerke-zieher-probe.sh [sekunden] [knoten-id]
#   Auf der Box:  ssh dietpi@<box> 'bash -s' < tools/lautstaerke-zieher-probe.sh
set -u

DAUER="${1:-240}"
KNOTEN="${2:-75}"
SKRIPT="${MUPI_LAUTSTAERKE:-/usr/local/bin/mupibox/mupi-lautstaerke.sh}"

command -v wpctl >/dev/null 2>&1 || { echo "wpctl fehlt - hier gibt es nichts zu messen" >&2; exit 2; }

echo "Beobachte Knoten $KNOTEN fuer ${DAUER}s. Vorgabe-Senke: $(pactl get-default-sink 2>/dev/null)"
echo "Geltende Obergrenze laut Skript: $("$SKRIPT" grenze 2>/dev/null)"

ende=$(( $(date +%s) + DAUER ))
declare -A gesehen
n_get=0; n_down=0; n_up=0; n_set=0; n_wert=0
letzt_v=""

while [ "$(date +%s)" -lt "$ende" ]; do
  while read -r pid rest; do
    [ -z "$pid" ] && continue
    [ -n "${gesehen[$pid]:-}" ] && continue
    gesehen[$pid]=1
    case "$rest" in
      *"mupi-lautstaerke.sh down"*) n_down=$((n_down+1)); echo "$(date +%H:%M:%S) DOWN  $pid $rest" ;;
      *"mupi-lautstaerke.sh up"*)   n_up=$((n_up+1));     echo "$(date +%H:%M:%S) UP    $pid $rest" ;;
      *"mupi-lautstaerke.sh set"*)  n_set=$((n_set+1));   echo "$(date +%H:%M:%S) SET   $pid $rest" ;;
      *"mupi-lautstaerke.sh get"*)  n_get=$((n_get+1)) ;;
    esac
  done < <(ps -eo pid,cmd 2>/dev/null | grep -F "mupi-lautstaerke.sh" | grep -v grep)

  v="$(wpctl get-volume "$KNOTEN" 2>/dev/null)"
  if [ "$v" != "$letzt_v" ]; then
    [ -n "$letzt_v" ] && n_wert=$((n_wert+1))
    echo "$(date +%H:%M:%S) WERT  $v"
    letzt_v="$v"
  fi
  sleep 0.3
done

echo "SUMME nach ${DAUER}s: get=$n_get down=$n_down up=$n_up set=$n_set wertaenderungen=$n_wert"
echo "Andere Senken (Fingerabdruck von einheit_nachziehen - alles auf 1.000000 heisst: das Skript hat gesetzt):"
pw-dump 2>/dev/null | jq -r '.[] | select(.type=="PipeWire:Interface:Node")
  | select(.info.props["media.class"]=="Audio/Sink")
  | "  \(.id)\t\(.info.props["node.name"])\t\((.info.params.Props[0].channelVolumes // []) | tostring)"' 2>/dev/null
