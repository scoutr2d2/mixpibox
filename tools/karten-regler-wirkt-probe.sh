#!/usr/bin/env bash
# Wirkt der Lautstaerke-Regler WIRKLICH auf die Karte? — nicht die Anzeige fragen.
#
# WOZU (05.09.2026)
# Alle Proben dieses Baums lasen bis heute nur ZURUECK, was pactl meldet —
# und pactl meldet, was gestellt wurde, nicht was die Karte anwendet. Der
# Betreiber hoerte den Unterschied: "angeblich ist es 7% aber es ist 100
# laut". Diese Probe fragt die Karte selbst (pw-dump, Props):
#
#   channelVolumes  = was der Regler gestellt hat
#   softVolumes     = was die Karte WIRKLICH in Software anwendet
#
# Sie stellt zwei verschiedene Werte und prueft BEIDE Male, dass die zwei
# Zahlen zusammenfallen UND dem Regler folgen. Faellt das auseinander, haelt
# PipeWire den Hardware-Mixer der Karte fuer echt (MAX98357A hat keinen) —
# dann fehlt config/templates/82-karte-software-regler.conf auf der Box.
#
# LAUTLOS: Karte stumm waehrend der zwei Stellungen, danach alles zurueck.
#
# Aufruf:  tools/karten-regler-wirkt-probe.sh dietpi@192.168.178.62
# Exit 0 = Regler wirkt, 1 = Attrappe erkannt, 2 = nicht messbar.
set -u

BOX="${1:-}"
[ -z "$BOX" ] && { echo "Aufruf: $0 <benutzer@box>" >&2; exit 2; }
HIER="$(dirname "$0")"

lauf() { ssh -o ConnectTimeout=8 -o BatchMode=yes "$BOX" "$1" 2>/dev/null; }
karten_stand() { python3 "$HIER/tonlage-schau.py" "$BOX" --nur-karte; }

S=/usr/local/bin/mupibox/mupi-lautstaerke.sh
VORHER="$(lauf "$S get")"
KARTE="$(lauf 'pactl list sinks short | awk "/alsa_output/ {print \$2; exit}"')"
[ -z "$KARTE" ] && { echo "X  keine Karte"; exit 2; }
MUTE="$(lauf "pactl get-sink-mute $KARTE" | awk '{print $2}')"
wiederher() {
  lauf "$S set ${VORHER:-8}" >/dev/null
  [ "$MUTE" = "no" ] && lauf "pactl set-sink-mute $KARTE 0"
}
trap wiederher EXIT
lauf "pactl set-sink-mute $KARTE 1"

fehler=0
pruefe_stand() { # nutzerwert
  lauf "$S set $1" >/dev/null
  sleep 0.8
  Z="$(karten_stand)"
  CH="$(echo "$Z" | sed -n 's/^KARTE channel=\([^ ]*\) soft=.*/\1/p')"
  SO="$(echo "$Z" | sed -n 's/^KARTE channel=[^ ]* soft=\([^ ]*\) .*/\1/p')"
  # LEER HEISST NICHT MESSBAR, NIE "ok" (05.09.2026): ein WLAN-Aussetzer
  # liess beide Werte leer, float('' or 0) machte daraus 0==0 und die Probe
  # meldete "deckungsgleich" fuer eine Messung, die nie stattfand.
  if [ -z "$CH" ] || [ -z "$SO" ]; then
    printf '  X    Nutzer %-4s -> NICHT MESSBAR (keine Werte von der Box)\n' "$1" >&2
    echo "0 messfehler"
    return
  fi
  URTEIL="$(python3 - "$CH" "$SO" <<'PY'
import sys
ch, so = float(sys.argv[1] or 0), float(sys.argv[2] or 0)
# 5 Prozent Kulanz auf der kubischen Skala; darunter ist es dieselbe Zahl.
print("ja" if abs(ch - so) <= max(ch, so, 1e-9) * 0.05 + 1e-9 else "nein")
PY
)"
  # Tabellenzeile auf stderr, damit der Rueckgabewert allein auf stdout
  # bleibt. Das URTEIL wandert MIT nach draussen: der Fehlerzaehler einer
  # Funktion, die in $(...) laeuft, verpufft in der Subshell.
  if [ "$URTEIL" = ja ]; then
    printf '  ok   Nutzer %-4s -> gestellt %-12s angewandt %-12s (deckungsgleich)\n' "$1" "$CH" "$SO" >&2
  else
    printf '  X    Nutzer %-4s -> gestellt %-12s angewandt %-12s SCHERE!\n' "$1" "$CH" "$SO" >&2
  fi
  echo "$CH $URTEIL"
}

echo "── zwei Stellungen, jeweils gestellt vs. angewandt ──"
E1="$(pruefe_stand 20)"; A="${E1%% *}"; [ "${E1##* }" = ja ] || fehler=$((fehler+1))
E2="$(pruefe_stand 60)"; B="${E2%% *}"; [ "${E2##* }" = ja ] || fehler=$((fehler+1))
# Der Regler muss auch BEWEGEN: zwei gleiche Zahlen bei 20 und 60 hiessen,
# das Stellen verpufft komplett (die alte klangwerk-Taubheit).
BEWEGT="$(python3 -c "import sys; a,b=float('$A' or 0),float('$B' or 0); print('ja' if b > a*2 else 'nein')")"
if [ "$BEWEGT" = ja ]; then echo "  ok   60 wendet deutlich mehr an als 20 — der Regler bewegt die Karte"
else echo "  X    20 und 60 wenden dasselbe an — der Regler verpufft"; fehler=$((fehler+1)); fi

echo
if [ "$fehler" -eq 0 ]; then echo "OK   der Regler wirkt wirklich."; exit 0; fi
echo "X    $fehler Befund(e) — die Karte wendet nicht an, was der Regler stellt."
exit 1
