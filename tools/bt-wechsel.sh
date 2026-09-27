#!/bin/bash
# Bluetooth-Adapter bewerten und den Lautsprecher umziehen - umkehrbar.
#
# WOFUER (am Geraet gemessen, 2026-07-28): der Ton laeuft ueber einen
# USB-Stick, und der ist das schwaechste Glied. `mupi-ton` hat gezeigt: was
# PipeWire hinausschickt, ist SAUBER (8,00 von 8 s, keine Spruenge, keine
# Luecken, keine xruns) - gehoert wird es trotzdem mit Aussetzern. Der Fehler
# liegt also HINTER PipeWire, auf der Funkstrecke.
#
# DER VERDAECHTIGE: ein CSR8510-A10-Klon (0a12:0001), Bluetooth 4.0, ACL-MTU
# 310 Byte bei 10 Puffern, an USB mit Full Speed (12 Mbit/s). Der eingebaute
# Funk des Pi kann 1021 Byte. Dreimal so viele Pakete fuer dieselbe Musik -
# genau daran bricht A2DP zuerst.
#
# WARUM DER STICK TROTZDEM DA IST: er wurde ABSICHTLICH gesteckt, damit
# Bluetooth nicht mit dem WLAN um Chip und Antenne konkurriert - beim Pi
# teilen sich beide dasselbe Funkmodul. "Zurueck auf den eingebauten Funk"
# waere deshalb ein Rueckschritt, kein Fix. Der Weg ist ein BESSERER STICK.
#
# WORAUF ES BEI EINEM STICK ANKOMMT, in dieser Reihenfolge:
#   1. ACL-MTU. Groesser ist besser; unter 400 Byte wird A2DP eng.
#   2. Bluetooth-Fassung. 5.x hat mehr Luft als 4.0.
#   3. Chip. Realtek RTL8761B/BU (0bda:8771 / 0bda:8761) gilt als solide und
#      wird von neueren Kerneln gut unterstuetzt. `0a12:0001` ist der billige
#      CSR-Klon, den es an jeder Ecke gibt - der haeufigste Grund fuer
#      stotterndes A2DP unter Linux.
#
# WARUM ES EIN EIGENES SKRIPT IST: die Box hat KEINEN eingebauten Lautsprecher.
# Bluetooth ist der einzige Tonweg. Jeder Versuch trennt also den Ton, und dann
# will man ihn schnell und vollstaendig wiederherstellen koennen - nicht mit
# halb erinnerten bluetoothctl-Befehlen dastehen. Die alte Kopplung wird NIE
# geloescht, ein Umzug ist immer umkehrbar.
#
# AUFRUF
#   bt-wechsel.sh                 alle Adapter bewerten, nichts aendern
#   bt-wechsel.sh --auf hci2      Lautsprecher an diesen Adapter umziehen
#   bt-wechsel.sh --auf usb-neu   an den zuletzt eingesteckten USB-Adapter
#
# Danach IMMER messen (mupi-ton --sek 8) UND HINHOEREN - die Mitschrift war
# schon vorher sauber, entschieden wird das am Ohr.

set -u
LS="${MUPI_LAUTSPRECHER:-7C:96:D2:89:35:CC}"   # Teufel ROCKSTER Cross
export XDG_RUNTIME_DIR=/run/user/1000

GRUEN='\033[32m'; ROT='\033[31m'; GELB='\033[33m'; GRAU='\033[90m'; AUS='\033[0m'

adr_von() { hciconfig "$1" 2>/dev/null | awk '/BD Address/{print $3}'; }

# Welcher USB-Stick ist welcher Adapter? Ueber den Pfad im sysfs, nicht ueber
# die hci-Nummer - die vertauscht sich beim Neustart je nachdem, was zuerst da
# ist. Genau daran waere ein Skript sonst still falsch.
usb_kennung() {
  local h="$1" pfad
  pfad=$(readlink -f "/sys/class/bluetooth/$h/device" 2>/dev/null)
  [ -z "$pfad" ] && return
  local d="$pfad"
  for _ in 1 2 3 4; do
    if [ -f "$d/idVendor" ] && [ -f "$d/idProduct" ]; then
      echo "$(cat "$d/idVendor"):$(cat "$d/idProduct")"
      return
    fi
    d=$(dirname "$d")
  done
}

# Bewertung nach dem, was fuer A2DP zaehlt - MTU zuerst.
#
# DER EINGEBAUTE ZAEHLT HIER WENIGER, obwohl seine Zahlen gut sind: beim Pi
# teilen sich WLAN und Bluetooth dasselbe Funkmodul. Genau deshalb wurde ein
# Stick gesteckt. Ein Vorschlag "nimm den eingebauten" waere fuer DIESE Box
# ein Rueckschritt, auch wenn die Tabelle ihn gut aussehen laesst.
note() {
  local mtu="$1" fassung="$2" kennung="$3" bus="$4"
  local punkte=0
  [ "$mtu" -ge 1000 ] 2>/dev/null && punkte=$((punkte + 3))
  [ "$mtu" -ge 600 ] 2>/dev/null && [ "$mtu" -lt 1000 ] && punkte=$((punkte + 2))
  [ "$mtu" -ge 400 ] 2>/dev/null && [ "$mtu" -lt 600 ] && punkte=$((punkte + 1))
  case "$fassung" in 5.1|5.2|5.3|5.4) punkte=$((punkte + 3)) ;; 5.*) punkte=$((punkte + 2)) ;; esac
  case "$kennung" in
    0a12:0001) punkte=$((punkte - 2)) ;;   # der billige CSR-Klon
    0bda:87*|0b05:190e) punkte=$((punkte + 1)) ;;  # Realtek RTL8761, u.a. ASUS BT500
  esac
  [ "$bus" = "UART" ] && punkte=$((punkte - 2))   # teilt das Funkmodul mit dem WLAN
  echo "$punkte"
}

zeigen() {
  echo
  echo "Bluetooth-Adapter dieser Box"
  echo "───────────────────────────────────────────────────────────────────"
  local bester="" bestnote=-99
  for h in $(ls /sys/class/bluetooth/ 2>/dev/null | grep -E '^hci[0-9]+$'); do
    local roh mtu puf bus fassung kennung marke n hinweis
    roh=$(hciconfig -a "$h" 2>/dev/null)
    local paar
    paar=$(echo "$roh" | sed -n 's/.*ACL MTU: \([0-9]*:[0-9]*\).*/\1/p' | head -1)
    mtu=${paar%%:*}
    puf=${paar##*:}
    bus=$(echo "$roh" | awk '/Type: Primary/{print $NF; exit}')
    fassung=$(echo "$roh" | awk '/HCI Version:/{print $3; exit}')
    kennung=$(usb_kennung "$h")
    : "${mtu:=0}"; : "${puf:=?}"; : "${bus:=?}"; : "${fassung:=?}"

    marke=""
    hcitool -i "$h" con 2>/dev/null | grep -qi "$LS" && marke="${GRUEN}  <- traegt den Ton${AUS}"
    n=$(note "$mtu" "$fassung" "$kennung" "$bus")
    if [ "$n" -gt "$bestnote" ]; then bestnote="$n"; bester="$h"; fi

    hinweis=""
    case "$kennung" in
      0a12:0001) hinweis="${ROT}CSR-Klon - haeufigste Ursache fuer stotterndes A2DP${AUS}" ;;
      0bda:87*)  hinweis="${GRUEN}Realtek RTL8761 - gilt als solide${AUS}" ;;
      0b05:190e) hinweis="${GRUEN}ASUS USB-BT500 (Realtek RTL8761B) - gute Wahl fuer A2DP${AUS}" ;;
    esac
    [ "$mtu" -lt 400 ] 2>/dev/null && [ -z "$hinweis" ] && hinweis="${GELB}kleine Pakete - eng fuer A2DP${AUS}"
    [ "$bus" = "UART" ] && [ -z "$hinweis" ] && hinweis="${GELB}eingebaut - teilt Chip und Antenne mit dem WLAN${AUS}"

    printf "  %-5s %-5s BT %-4s ACL-MTU %-5s Byte, %-3s Puffer  %-11s%b\n" \
      "$h" "$bus" "$fassung" "$mtu" "$puf" "${kennung:--}" "$marke"
    [ -n "$hinweis" ] && printf "        %b\n" "$hinweis"
  done

  echo
  echo "  Gekoppelt ist der Lautsprecher bei:"
  local irgendwo=0
  for d in $(sudo -n ls /var/lib/bluetooth/ 2>/dev/null); do
    if sudo -n ls "/var/lib/bluetooth/$d/" 2>/dev/null | grep -qi "$LS"; then
      for h in $(ls /sys/class/bluetooth/ 2>/dev/null | grep -E '^hci[0-9]+$'); do
        [ "$(adr_von "$h")" = "$d" ] && { echo "    $h ($d)"; irgendwo=1; }
      done
    fi
  done
  [ "$irgendwo" = "0" ] && echo -e "    ${GELB}(nirgends)${AUS}"

  [ -n "$bester" ] && echo -e "\n  Nach diesen Zahlen am geeignetsten: ${GRUEN}$bester${AUS}"
  echo -e "  ${GRAU}Umziehen mit: bt-wechsel.sh --auf <hciN>${AUS}"
}

umziehen() {
  local ziel="$1"
  [ -d "/sys/class/bluetooth/$ziel" ] || { echo -e "${ROT}$ziel gibt es nicht.${AUS}"; return 1; }
  local adr; adr=$(adr_von "$ziel")
  echo -e "\nUmzug auf $ziel ($adr)"
  echo "───────────────────────────────────────────────────────────────────"

  # Ueberall trennen - sonst haelt der alte Adapter die Verbindung fest.
  for h in $(ls /sys/class/bluetooth/ 2>/dev/null | grep -E '^hci[0-9]+$'); do
    bluetoothctl -- select "$(adr_von "$h")" >/dev/null 2>&1
    bluetoothctl -- disconnect "$LS" >/dev/null 2>&1
  done
  sleep 2

  bluetoothctl -- select "$adr" >/dev/null 2>&1
  bluetoothctl -- power on >/dev/null 2>&1

  if sudo -n ls "/var/lib/bluetooth/$adr/" 2>/dev/null | grep -qi "$LS"; then
    echo "  schon gekoppelt, verbinde …"
  else
    echo "  noch nicht gekoppelt - suche und koppele"
    echo -e "  ${GRAU}(der Lautsprecher muss dafuer anmeldebereit sein)${AUS}"
    bluetoothctl -- scan on >/dev/null 2>&1 &
    local sucher=$!
    sleep 8
    bluetoothctl -- pair "$LS" 2>&1 | tail -2 | sed 's/^/    /'
    bluetoothctl -- trust "$LS" >/dev/null 2>&1
    kill "$sucher" 2>/dev/null
  fi

  bluetoothctl -- connect "$LS" 2>&1 | tail -2 | sed 's/^/    /'
  sleep 4

  local sink; sink=$(pactl list sinks short 2>/dev/null | awk '/bluez_output/{print $2; exit}')
  if [ -n "$sink" ]; then
    pactl set-default-sink "$sink" >/dev/null 2>&1
    echo -e "  ${GRUEN}Ausgang steht auf $sink${AUS}"
  else
    echo -e "  ${ROT}Kein Bluetooth-Ausgang - der Umzug hat nicht geklappt.${AUS}"
    echo -e "  ${GELB}Die alte Kopplung ist unangetastet: bt-wechsel.sh --auf <alter hciN>${AUS}"
    return 1
  fi

  zeigen
  echo
  echo "  Jetzt messen:  mupi-ton --sek 8"
  echo "  Und HINHOEREN - die Mitschrift war schon vorher sauber."
}

case "${1:-}" in
  ''|--zeigen) zeigen ;;
  --auf)       umziehen "${2:-}" ;;
  *)           sed -n '2,40p' "$0" ;;
esac
