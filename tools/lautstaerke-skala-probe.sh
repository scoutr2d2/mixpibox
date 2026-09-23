#!/usr/bin/env bash
# Die Nutzerskala von mupi-lautstaerke.sh — rein geprueft, ohne Box.
#
# WAS HIER AUF DEM SPIEL STEHT
# Seit dem 05.09.2026 bedeutet 100 auf der Nutzerskala nicht mehr „100 % der
# Karte", sondern `mupibox.maxVolume`. Der Betreiber hatte gemeldet: „die
# abstufung ist zu grob, es wird zu schnell laut" — mit der Streckung
# verteilen sich dieselben Tastenschritte ueber den ERLAUBTEN Bereich. Rechnet
# eine der beiden Richtungen falsch, ist entweder das Limit wirkungslos oder
# der angezeigte Wert luegt.
#
# WARUM DER CASE-BLOCK ABGESCHNITTEN WIRD
# `source` auf das ganze Skript fuehrt dessen Unterbefehl-Auswertung MIT aus —
# die endet in `exit 2` und beendet die pruefende Shell. Alle Faelle meldeten
# dann „leer" statt „falsch". Deshalb wird nur der Teil VOR dem case geladen.
#
# `hoechstwert` wird bewusst ersetzt: es liest Konfiguration und fragt pactl.
# Geprueft wird die RECHNUNG, nicht die Herkunft der Zahl.
set -u

# Der Pfad ist ueberschreibbar, damit die GEGENPROBE auf einer Wegwerfkopie
# laufen kann: eine Sabotage am echten Skript wuerde ungesicherte Arbeit
# treffen, und ein `git checkout` danach wuerde sie wegwerfen.
SKRIPT="${LAUTSTAERKE_SKRIPT:-$(dirname "$0")/../scripts/mupibox/mupi-lautstaerke.sh}"
[ -r "$SKRIPT" ] || { echo "X  $SKRIPT nicht lesbar"; exit 2; }

# shellcheck disable=SC1090
source <(sed '/^case "\${1:-}" in/,$d' "$SKRIPT")

MAX=60
hoechstwert() { echo "$MAX"; }

fehler=0
pruefe() { # name erwartet ist
  if [ "$2" = "$3" ]; then
    printf '  ok   %-46s %s\n' "$1" "$3"
  else
    printf '  X    %-46s erwartet %s, war %s\n' "$1" "$2" "$3"
    fehler=$((fehler + 1))
  fi
}

echo "── nutzer_zu_echt (max=$MAX) ──"
pruefe "100 ist das Limit, nicht der Anschlag" 60 "$(nutzer_zu_echt 100)"
pruefe "die Haelfte ist die halbe Erlaubnis"   30 "$(nutzer_zu_echt 50)"
pruefe "0 bleibt 0"                             0 "$(nutzer_zu_echt 0)"
pruefe "10 -> 6"                                6 "$(nutzer_zu_echt 10)"

echo "── echt_zu_nutzer (max=$MAX) ──"
pruefe "das Limit zeigt sich als 100"         100 "$(echt_zu_nutzer 60)"
pruefe "die halbe Erlaubnis als 50"            50 "$(echt_zu_nutzer 30)"
pruefe "0 bleibt 0"                             0 "$(echt_zu_nutzer 0)"

# DER FALL, DER DEN REGLER LUEGEN LIESSE: steht die Karte von Hand UEBER dem
# Limit, darf die Anzeige nicht ueber 100 hinauslaufen.
pruefe "ueber dem Limit wird auf 100 geklemmt" 100 "$(echt_zu_nutzer 70)"

echo "── hin und zurueck ──"
for n in 0 8 15 33 50 77 100; do
  pruefe "aus $n wird wieder $n" "$n" "$(echt_zu_nutzer "$(nutzer_zu_echt "$n")")"
done

# EIN ANDERES LIMIT MUSS AUCH TRAGEN — sonst prueft die Probe nur die 60.
MAX=100
echo "── ohne echtes Limit (max=100) bleibt alles 1:1 ──"
pruefe "100 -> 100" 100 "$(nutzer_zu_echt 100)"
pruefe "37 -> 37"    37 "$(nutzer_zu_echt 37)"
pruefe "37 zurueck"  37 "$(echt_zu_nutzer 37)"

MAX=0
echo "── Grenzfall: Limit 0 darf nicht durch Null teilen ──"
pruefe "echt_zu_nutzer faellt auf 0" 0 "$(echt_zu_nutzer 5)"

echo
if [ "$fehler" -eq 0 ]; then
  echo "OK   alle Faelle."
  exit 0
fi
echo "X    $fehler Fall/Faelle falsch."
exit 1
