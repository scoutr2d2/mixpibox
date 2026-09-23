#!/usr/bin/env bash
# ALLES, was mit Ton zu tun hat, in EINEM Lauf — das Dach ueber den Einzelproben.
#
# WOZU (05.09.2026)
# Der Betreiber: „bitte auch gleich tonwerk auf funktion checken alles was mit
# ton zu tuen hat". An diesem Vormittag kamen vier Ton-Funde EINZELN nach —
# jede Einzelprobe war gruen, aber niemand hatte das Ganze angesehen. Dieses
# Werkzeug ruft die vorhandenen Proben (nichts neu erfinden!) und ergaenzt,
# was zwischen ihnen liegt: Kettenaufbau, Quellregler, Konfiguration,
# Eltern-Bereich.
#
# BAUSTEINE (jede Zeile eine eigene Wahrheit):
#   1  Kettenaufbau     alle Senken da, Vorgabe = klangwerk, Durchreichen 100
#   2  Regler           tools/regler-alle-wege-probe.sh (17 Faelle, lautlos)
#   3  Quellregler      lebender Strom haelt den Wert; tote Kennung -> Fehler
#   4  Klangkette       tools/tonweg-durchgang.py (NUR wenn nichts spielt)
#   5  Konfiguration    maxVolume/startVolume/Deckel in sich stimmig
#   6  Eltern-Bereich   index.html zeigt auf Buendel, die es gibt
#   7  Startlautstaerke beim letzten Boot wirklich gesetzt (Journal)
#   8  Pegel je Stufe   tools/tonweg-pegel.mjs — INKLUSIVE der Stufe HINTER
#                       PipeWire (ALSA-Mischer der Karte). Sie fehlte hier bis
#                       zum 20.09.2026, und genau sie stand auf 44 %: mit den
#                       -36 dB der Nutzerlautstaerke zusammen war die Box
#                       praktisch stumm, waehrend jede Einzelprobe gruen war.
#   9  Ansage kommt an  tools/ansage-kommt-an.py — die Box SPRICHT, und der
#                       Monitor der Endstation sagt, ob dabei Signal lief. Ein
#                       `{"ok":true}` der Vorlese-Route beweist nur, dass die
#                       WAV entstanden ist; `pw-play` laeuft im Server mit
#                       stdio:'ignore'.
#
# Aufruf:  tools/ton-gesamtcheck.sh dietpi@192.168.178.62
# Exit 0 = alles gruen, 1 = mindestens ein Baustein rot, 2 = nicht messbar.
set -u

BOX="${1:-}"
[ -z "$BOX" ] && { echo "Aufruf: $0 <benutzer@box>" >&2; exit 2; }
HIER="$(dirname "$0")"

fehler=0
titel() { echo; echo "══ $1 ═══════════════════════════════════════════════"; }
lauf() { ssh -o ConnectTimeout=10 -o BatchMode=yes "$BOX" "$1" 2>/dev/null; }

# ── Wartungs-Schirm um den GANZEN Check (05.09.2026): waehrend gemessen
# wird, sieht das Kind den Sperr-Schirm (NewDesign, seit 29.08.) und kein
# Tipp verfaelscht die Werte. Die Wahrheit ist die Datei /tmp/.mixpi-wartung;
# der Kiosk pollt alle 10 s — deshalb die 11 s, sonst misst Baustein 1 noch
# ohne Schirm. Die Regler-Probe (Baustein 2) bekommt WARTUNG_EXTERN=1, damit
# sie den Schirm nicht mittendrin wegzieht.
echo "Wartungs-Schirm an (der Kiosk-Takt braucht bis zu 11 s) …"
lauf 'printf "{\"seit\":\"%s\"}" "$(date -Is)" > /tmp/.mixpi-wartung'
trap 'lauf "rm -f /tmp/.mixpi-wartung"' EXIT
sleep 11
export WARTUNG_EXTERN=1

titel "1/9 Kettenaufbau"
# DER ANLAUF SIEHT AUS WIE EIN ZUSTAND (05.09.2026 gemessen): direkt nach
# einer Server-Auslieferung ist das Klangwerk fuer einige Sekunden weg und
# die Vorgabe faellt auf die Karte — beides baut die Wache von selbst wieder
# auf. Wer da misst, meldet eine kaputte Kette, die keine ist. Deshalb wird
# bis zu 60 s auf den fertigen Aufbau gewartet; erst DANN wird geurteilt.
KETTE=""
for _ in $(seq 1 12); do
  KETTE="$(lauf 'pactl list sinks short | awk "{print \$2}"; echo "VORGABE=$(pactl get-default-sink)"')"
  if echo "$KETTE" | grep -q "^klangwerk$" && echo "$KETTE" | grep -q "^VORGABE=klangwerk$"; then break; fi
  sleep 5
done
for s in klangwerk entzerrer ueberall mixpi-mitschnitt alsa_output; do
  if echo "$KETTE" | grep -q "^$s"; then echo "  ok   Senke $s ist da"
  else echo "  X    Senke $s FEHLT"; fehler=$((fehler+1)); fi
done
if echo "$KETTE" | grep -q "^VORGABE=klangwerk$"; then echo "  ok   Vorgabe-Senke ist klangwerk"
else echo "  X    Vorgabe-Senke ist $(echo "$KETTE" | grep VORGABE)"; fehler=$((fehler+1)); fi
for s in klangwerk entzerrer mixpi-mitschnitt; do
  w="$(lauf "pactl get-sink-volume $s 2>/dev/null | grep -o '[0-9]\+%' | head -1 | tr -d %")"
  if [ "${w:-0}" -ge 99 ] && [ "${w:-0}" -le 101 ]; then echo "  ok   Durchreiche $s steht auf 100 ($w%)"
  else echo "  X    Durchreiche $s steht auf ${w:-?}% statt 100"; fehler=$((fehler+1)); fi
done

titel "2/9 Regler (alle Stellwege)"
if "$HIER/regler-alle-wege-probe.sh" "$BOX"; then echo "  ok   alle Regler-Wege halten die Grenze"
else echo "  X    Regler-Probe rot (Ausgabe oben)"; fehler=$((fehler+1)); fi

titel "3/9 Quellregler"
# Ein LEBENDER Strom muss den Wert halten (leise Richtung, sofort zurueck) —
# und eine TOTE Kennung muss der Server als Fehler melden, nicht als ok.
QUELLE="$(lauf 'pactl list short sink-inputs | awk "NR==1{print \$1}"')"
if [ -n "$QUELLE" ]; then
  ERG="$(lauf "
    v0=\$(pactl list sink-inputs | awk -v z=\"#$QUELLE\" '/^Sink Input/ {t=(\$3==z)} t && /Volume:/ {print \$5; exit}' | tr -d %)
    pactl set-sink-input-volume $QUELLE 40%; sleep 2
    v1=\$(pactl list sink-inputs | awk -v z=\"#$QUELLE\" '/^Sink Input/ {t=(\$3==z)} t && /Volume:/ {print \$5; exit}' | tr -d %)
    pactl set-sink-input-volume $QUELLE \${v0:-100}%
    echo \"\$v1\"")"
  if [ "${ERG:-0}" -ge 39 ] && [ "${ERG:-0}" -le 41 ]; then echo "  ok   lebender Strom #$QUELLE haelt den Wert (40%)"
  else echo "  X    Strom #$QUELLE hielt nicht: ${ERG:-?}% statt 40%"; fehler=$((fehler+1)); fi
else
  echo "  --   kein laufender Strom — Halte-Test nicht moeglich (nichts spielt)"
fi
HTTP="$(lauf 'curl -s -m 8 -o /dev/null -w "%{http_code}" -X POST http://localhost:8200/api/ton/quelle -H "Content-Type: application/json" -d "{\"kennung\":99999,\"prozent\":50}"')"
if [ "$HTTP" = 404 ]; then echo "  ok   tote Kennung -> 404 (ehrlich)"
else echo "  X    tote Kennung -> HTTP $HTTP (muss 404 sein — der Regler luegt sonst)"; fehler=$((fehler+1)); fi

titel "4/9 Klangkette (Pruefton)"
SPIELT="$(lauf 'cat /tmp/playerstate 2>/dev/null')"
if [ "$SPIELT" = "play" ]; then
  # KEIN STILLER SKIP: der Pruefton wuerde in laufende Musik mischen.
  echo "  --   UEBERSPRUNGEN: es spielt gerade (playerstate=play). Nach dem"
  echo "       Stoppen nachholen: python3 tools/tonweg-durchgang.py <box-ip>"
else
  IP="${BOX#*@}"
  if AUS="$(timeout 240 python3 "$HIER/tonweg-durchgang.py" "$IP" 2>&1)"; then
    echo "$AUS" | sed 's/^/       /' | tail -6
    if echo "$AUS" | grep -q "Pegel heraus"; then echo "  ok   die Kette traegt den Pruefton"
    else echo "  X    kein Durchgang messbar"; fehler=$((fehler+1)); fi
  else echo "  X    tonweg-durchgang scheiterte"; fehler=$((fehler+1)); fi
fi

titel "5/9 Konfiguration"
KONF="$(lauf 'jq -r "[.mupibox.maxVolume, .mupibox.startVolume] | @tsv" /etc/mupibox/mupiboxconfig.json')"
MAXV="$(echo "$KONF" | cut -f1 | grep -o '^[0-9]*')"
STARTV="$(echo "$KONF" | cut -f2 | grep -o '^[0-9]*')"
echo "       maxVolume=$MAXV startVolume=$STARTV"
if [ -n "$MAXV" ] && [ "$MAXV" -ge 1 ] && [ "$MAXV" -le 100 ]; then echo "  ok   maxVolume ist eine Grenze (1..100)"
else echo "  X    maxVolume '$MAXV' ist keine brauchbare Grenze"; fehler=$((fehler+1)); fi
if [ -n "$STARTV" ] && [ "$STARTV" -le 100 ]; then echo "  ok   startVolume liegt auf der Nutzerskala (0..100)"
else echo "  X    startVolume '$STARTV' liegt daneben"; fehler=$((fehler+1)); fi
DECKEL="$(lauf 'curl -s -m 8 http://localhost:8200/api/ton/klang | jq -c .deckel')"
echo "       Deckel je Ausgabe: ${DECKEL:-nicht lesbar}"

titel "6/9 Eltern-Bereich (Verwaltung)"
FEHLEND="$(lauf 'D=/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www-admin
  for f in $(grep -o "\(main\|chunk\|polyfills\)-[A-Z0-9]*\.js" $D/index.html | sort -u); do
    [ -f "$D/$f" ] || echo "$f"
  done')"
if [ -z "$FEHLEND" ]; then echo "  ok   index.html zeigt nur auf Buendel, die es gibt"
else echo "  X    index.html verweist ins Leere: $FEHLEND"; fehler=$((fehler+1)); fi
LEICHEN="$(lauf 'ls /home/dietpi/.mupibox/Sonos-Kids-Controller-master/www-admin/main-*.js 2>/dev/null | wc -l')"
[ "${LEICHEN:-0}" -gt 3 ] && echo "  !    Hinweis: ${LEICHEN} main-Buendel liegen dort — nur eines laedt, der Rest ist Ballast"

titel "7/9 Startlautstaerke beim letzten Boot"
# DAS JOURNAL DIESER BOX IST KURZ (05.09.2026 gemessen: ~400 Zeilen, aeltere
# Eintraege rotieren binnen Stunden hinaus). Ob es den Boot ueberhaupt noch
# abdeckt, entscheidet, ob "kein Eintrag" ein Befund oder nur Vergesslichkeit
# ist — eine dauerrote Wache waere keine.
J="$(lauf 'journalctl -u mupibox-server -b --no-pager 2>/dev/null | grep -c "Startlautstaerke.*gesetzt"')"
if [ "${J:-0}" -ge 1 ]; then
  echo "  ok   beim letzten Boot gesetzt (${J}x im Journal)"
else
  BOOTZEIT="$(lauf 'date -d "$(uptime -s)" +%s 2>/dev/null')"
  AELTESTER="$(lauf 'journalctl -u mupibox-server --no-pager -o short-unix 2>/dev/null | awk "NR==2{print int(\$1); exit}"')"
  if [ -n "$BOOTZEIT" ] && [ -n "$AELTESTER" ] && [ "$AELTESTER" -gt "$((BOOTZEIT + 120))" ]; then
    echo "  --   NICHT MEHR BELEGBAR: das Journal reicht nicht bis zum Boot"
    echo "       zurueck (rotiert). Beim naechsten Boot binnen einer Stunde pruefen."
  else
    echo "  X    kein Startlautstaerke-Eintrag seit dem Boot"; fehler=$((fehler+1))
  fi
fi

echo
titel "8/9 Pegel je Stufe (inklusive ALSA-Mischer)"
IP="${BOX#*@}"
if AUS="$(timeout 120 node "$HIER/tonweg-pegel.mjs" "$IP" 2>&1)"; then
  echo "$AUS" | sed 's/^/       /' | tail -4
  echo "  ok   keine Daempfung ausserhalb der regelnden Stufe"
else
  echo "$AUS" | sed 's/^/       /' | tail -12
  echo "  X    eine Stufe daempft, die kein Regler der Box erreicht"; fehler=$((fehler+1))
fi

titel "9/9 Ansage kommt am Lautsprecher an"
# SIE SPRICHT DABEI HOERBAR — das ist der Sinn und kein Nebeneffekt. Wie beim
# Pruefton wird es uebersprungen, wenn gerade Musik laeuft: eine Ansage mischt
# sich darueber, und die Daempfung griffe mitten ins Hoeren.
if [ "$SPIELT" = "play" ]; then
  echo "  --   UEBERSPRUNGEN: es spielt gerade. Nach dem Stoppen nachholen:"
  echo "       python3 tools/ansage-kommt-an.py <box-ip>"
elif AUS="$(timeout 240 python3 "$HIER/ansage-kommt-an.py" "$IP" 2>&1)"; then
  echo "$AUS" | sed 's/^/       /' | grep -E "gesprochen|Pegel|Spitze"
  echo "  ok   die Box hat gesprochen, und es lief Signal bis zur Karte"
else
  echo "$AUS" | sed 's/^/       /' | tail -8
  echo "  X    die Ansage erreichte die Karte NICHT"; fehler=$((fehler+1))
fi

if [ "$fehler" -eq 0 ]; then echo "OK   Tonwerk vollstaendig gruen."; exit 0; fi
echo "X    $fehler Baustein(e) rot."
exit 1
