#!/usr/bin/env bash
# Springt die Lautstaerke nach dem Boot? — der Nachweis, den man sonst nur fuehlt.
#
# WOZU
# Der Betreiber meldete am 05.09.2026: „der Regler springt nach etwa 35
# Sekunden". Am Geraet gemessen war die Ursache die Klangwache: sie laeuft bei
# 4 s, 8 s, 12 s und danach nur noch alle 30 s. War die Tonkarte in den ersten
# Sekunden noch nicht da, fiel der erste erfolgreiche Lauf auf ~38 s — und
# setzte dort die Startlautstaerke ueber einen bereits gedrehten Wert.
#
# DIESE PROBE ZEIGT DEN VERLAUF, NICHT NUR DAS ERGEBNIS. Ein einzelner Blick
# nach dem Boot kann einen Sprung nicht widerlegen: er sieht nur, wo der Wert
# GERADE steht [[einmal-hinsehen-ist-keine-messung]]. Deshalb wird im Takt
# gestempelt und JEDE Aenderung ausgewiesen.
#
# STRENG LESEND. Sie setzt nichts und rebootet nichts — wer den Boot ausloesen
# will, tut das selbst und startet die Probe direkt danach.
#
# Aufruf:
#   tools/startlautstaerke-boot-probe.sh dietpi@192.168.178.62 [sekunden]
set -u

BOX="${1:-}"
DAUER="${2:-120}"
if [ -z "$BOX" ]; then
  echo "Aufruf: $0 <benutzer@box> [sekunden]" >&2
  exit 2
fi

SKRIPT=/usr/local/bin/mupibox/mupi-lautstaerke.sh

echo "Warte auf die Box (bis zu 180 s) …"
wach=0
for _ in $(seq 1 90); do
  if ssh -o ConnectTimeout=4 -o BatchMode=yes "$BOX" true 2>/dev/null; then
    wach=1
    break
  fi
  sleep 2
done
if [ "$wach" -eq 0 ]; then
  echo "X  Box kam nicht zurueck."
  exit 2
fi

echo "Box ist da. Messe ${DAUER} s …"
echo

# Die Schleife laeuft AUF DER BOX: jede Runde ueber SSH waere langsamer als der
# Takt, den sie messen soll, und wuerde genau die Sekunden verfehlen, um die es
# geht.
ssh -o ConnectTimeout=10 -o BatchMode=yes "$BOX" "
  S=$SKRIPT
  ende=\$(( \$(date +%s) + $DAUER ))
  letzt=''
  while [ \"\$(date +%s)\" -lt \"\$ende\" ]; do
    auf=\$(cut -d' ' -f1 /proc/uptime)
    n=\$(\$S get 2>/dev/null)
    k=\$(pactl list sinks short 2>/dev/null | grep alsa_output | awk '{print \$1}')
    kv=\$(pactl get-sink-volume \"\$k\" 2>/dev/null | grep -o '[0-9]\\+%' | head -1)
    jetzt=\"\${n:-?}|\${kv:-?}\"
    if [ \"\$jetzt\" != \"\$letzt\" ]; then
      printf 'up %7ss   Nutzerskala: %-5s Karte: %s\n' \"\$auf\" \"\${n:-?}\" \"\${kv:-?}\"
      letzt=\"\$jetzt\"
    fi
    sleep 2
  done
  echo '--- Ende der Messung ---'
  echo 'Journal (Startlautstaerke):'
  journalctl -u mupibox-server --since '-5 min' --no-pager 2>/dev/null | grep -i 'startlautst' | tail -3
" 2>&1 | grep -v 'cookie file'
