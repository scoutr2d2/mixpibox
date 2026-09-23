#!/bin/bash
# WER SCHREIBT DIE LAUTSTAERKE? — rein lesende Wache fuer die laufende Box.
#
# WOZU
# Am 23.08.2026 sackte die Senke "klangwerk" nach jedem `wpctl set-volume`
# in Stufen ab (0.60 -> 0.50 -> 0.30 in ~10 s) und blieb dann liegen. Kein
# Rechteproblem, kein Kettenneubau — irgendetwas schrieb dazwischen.
#
# Die Schwierigkeit: PipeWire verraet NICHT, welcher Client einen Prop
# gesetzt hat. `pw-mon` zeigt die Aenderung, nicht den Urheber. Wer den
# Urheber sucht, muss ihn am Prozessbaum erwischen, solange er lebt — und
# ein `wpctl set-volume` lebt Millisekunden.
#
# WIE
# Zwei Spuren gleichzeitig, mit derselben Uhr:
#   VOL   — Prozesstabelle im 50-ms-Takt nach Lautstaerke-Befehlen absuchen;
#           mitgeschrieben wird PID, PPID und die ganze Befehlszeile. Ueber
#           den PPID-Weg steht danach fest, WER den Befehl abgesetzt hat.
#   TOUCH — die uinput-Tastspur der Touch-Bruecke passiv mitlesen. Sie sagt,
#           ob ein Griff auf den Bildschirm dahinterstand (Geisterberuehrung,
#           Kind, Wischgeste) oder eben NICHT.
#
# Erst die Gleichzeitigkeit entscheidet: ein `down 5` OHNE Tastspur kommt aus
# der Oberflaeche selbst oder von einem Dienst, ein `down 5` MIT Tastspur ist
# ein Druck auf den Leiser-Knopf im Kiosk.
#
# ES AENDERT NICHTS. Keine Lautstaerke, kein Dienst, kein Neustart — die Box
# steht in einem Kinderzimmer. `head -c` auf das Ereignisgeraet ist passiv:
# evdev gibt jedem Leser eine eigene Abschrift, dem Kiosk fehlt nichts.
#
#   ./lautstaerke-schreiber-finden.sh [sekunden] [ereignisgeraet]
set -u

DAUER="${1:-180}"
TASTSPUR="${2:-/dev/input/event5}"

echo "# Wache laeuft ${DAUER} s. Tastspur: ${TASTSPUR}"
echo "# Spalten: uhrzeit  spur  inhalt"

# Die Tastspur passiv mitlesen. Ein evdev-Ereignis ist auf 64-bit-arm 24 Byte;
# `od` mit -w24 gibt also eine Zeile je Ereignis. Ohne stdbuf haelt od die
# Ausgabe in einem 4-KB-Puffer zurueck — die Zeitstempel waeren dann alle
# gleich und die ganze Gegenueberstellung wertlos.
if [ -r "$TASTSPUR" ]; then
  ( timeout "$DAUER" stdbuf -o0 od -An -tu1 -w24 -v "$TASTSPUR" 2>/dev/null \
      | while IFS= read -r _zeile; do echo "$(date +%T)  TOUCH  Ereignis"; done ) &
else
  echo "# (Tastspur nicht lesbar — nur die Prozessspur)"
fi

# Die Prozessspur. 50 ms sind gemessen eng genug: ein `mupi-lautstaerke.sh`
# ist ein bash-Skript und lebt mehrere hundert Millisekunden.
ende=$((SECONDS + DAUER))
while [ "$SECONDS" -lt "$ende" ]; do
  ps -eo pid,ppid,args --no-headers 2>/dev/null \
    | grep -aiE "lautstaerke\.sh (set|up|down)|wpctl set-volume|pactl set-sink-volume|amixer .*sset" \
    | grep -av "grep -" \
    | while IFS= read -r zeile; do echo "$(date +%T)  VOL    $zeile"; done
  sleep 0.05
done

wait
