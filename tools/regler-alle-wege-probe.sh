#!/usr/bin/env bash
# JEDER Lautstaerke-Weg der Box, einzeln belegt — die Probe zum "endlosen Thema".
#
# WOZU (05.09.2026)
# Der Betreiber, nach dem dritten Fund an einem Vormittag: "Bitte teste alles
# von reglern, ich bekomme hier nur unfertiges was mir als fertig verkauft
# wird." Recht hat er: jeder Regler ging einen eigenen Weg, und jeder Weg
# hatte seine eigene Luecke. Diese Probe fasst ALLE Wege in eine Tabelle:
#
#   Skript   mupi-lautstaerke.sh set/up/down/get  (Tasten der Box, Player)
#   Server   POST /api/ton/senke                  (TON-Seite: Gesamt + je Ausgabe)
#   Server   POST /api/ton/deckel                 (rote Ausgabe-Regler, Waechter)
#   Server   POST /api/konfiguration              (rote Grenze maxVolume)
#   Daemon   :5005/<raum>/setvolume:N             (Regler im Player)
#
# DIE EINE REGEL, DIE ALLES PRUEFT: Die Karte steht NIE ueber der wirksamen
# Grenze min(maxVolume, Deckel der Ausgabe) — egal welcher Weg gestellt hat,
# und auch dann nicht, wenn die Grenze GESENKT wurde, waehrend die Karte oben
# stand. Und: Durchreichen (klangwerk, entzerrer, mixpi-mitschnitt) stehen
# fest auf 100 — der Mitschnitt bleibt pur.
#
# LAUTLOS: Die Karte wird fuer die Dauer der Probe STUMM geschaltet und am
# Ende wiederhergestellt (auch bei Abbruch — trap). Es aendert Werte, keine
# Ohren. Deshalb darf sie auch tagsueber laufen, waehrend Kinder testen —
# es gibt nur eine kurze Stille, keinen Lärm.
#
# Aufruf:  tools/regler-alle-wege-probe.sh dietpi@192.168.178.62
# Exit 0 = alle Faelle ok, 1 = mindestens einer rot, 2 = nicht messbar.
set -u

BOX="${1:-}"
[ -z "$BOX" ] && { echo "Aufruf: $0 <benutzer@box>" >&2; exit 2; }

# Alles laeuft in EINEM Remote-Skript: eine SSH-Sitzung, ein trap, eine
# Wiederherstellung. Viele einzelne ssh-Aufrufe koennten zwischen zwei
# Schritten sterben und die Box stumm oder verstellt zuruecklassen.
# WARTUNG_EXTERN=1 heisst: ein Dachwerkzeug (ton-gesamtcheck) haelt den
# Wartungsbildschirm schon — dann schaltet die Probe ihn nicht selbst,
# sonst risse ihr Ende das Tuch weg, waehrend das Dach noch misst.
ssh -o ConnectTimeout=10 -o BatchMode=yes "$BOX" "WARTUNG_EXTERN='${WARTUNG_EXTERN:-}' bash -s" <<'REMOTE'
set -u

# ── Wartungs-Schirm: kein Kinderfinger verfaelscht die Messung ────────────
# (05.09.2026: zweimal drehte ein Tester mitten in den ersten Probenfall.)
# Der Schirm existiert seit dem 29.08.: das NewDesign pollt GET /api/wartung
# alle 10 s; die Wahrheit ist die Datei /tmp/.mixpi-wartung (der POST-Weg
# steht hinter dem Anmelde-Tor — die Datei nicht, und wer hier laeuft, IST
# schon auf der Box). Die 11 s Wartezeit sind der Poll-Takt: sofort messen
# hiesse ohne Schirm messen. Das AUS wohnt in wiederherstellen() — ein
# eigener trap wuerde den dortigen EXIT-trap ersetzen.
if [ -z "${WARTUNG_EXTERN:-}" ]; then
  printf '{"seit":"%s"}' "$(date -Is)" > /tmp/.mixpi-wartung 2>/dev/null
  sleep 11
fi
S=/usr/local/bin/mupibox/mupi-lautstaerke.sh
KONF=/etc/mupibox/mupiboxconfig.json
KARTE="$(pactl list sinks short | awk "/alsa_output/ {print \$2; exit}")"
[ -z "$KARTE" ] && { echo "X  keine Tonkarte gefunden"; exit 2; }

kartenwert() { pactl get-sink-volume "$KARTE" | grep -o '[0-9]\+%' | head -1 | tr -d '%'; }
senkenwert() { pactl get-sink-volume "$1" 2>/dev/null | grep -o '[0-9]\+%' | head -1 | tr -d '%'; }

# ── Ausgangszustand festhalten und Wiederherstellung STELLEN, bevor
#    irgendetwas verstellt wird ────────────────────────────────────────────
NUTZER_VORHER="$($S get)"
MAX_VORHER="$(jq -r '.mupibox.maxVolume // "100"' "$KONF" | grep -o '^[0-9]*')"
DECKEL_VORHER="$(curl -s -m 8 http://localhost:8200/api/ton/klang | jq -r '.deckel.intern // empty')"
MUTE_VORHER="$(pactl get-sink-mute "$KARTE" | awk '{print $2}')"
wiederherstellen() {
  curl -s -m 8 -X POST http://localhost:8200/api/konfiguration \
    -H 'Content-Type: application/json' \
    -d "{\"aenderungen\":{\"maxLautstaerke\":${MAX_VORHER:-100}}}" >/dev/null
  if [ -n "$DECKEL_VORHER" ]; then
    curl -s -m 8 -X POST http://localhost:8200/api/ton/deckel \
      -H 'Content-Type: application/json' \
      -d "{\"ziel\":\"intern\",\"prozent\":${DECKEL_VORHER}}" >/dev/null
  else
    curl -s -m 8 -X POST http://localhost:8200/api/ton/deckel \
      -H 'Content-Type: application/json' -d '{"ziel":"intern","prozent":125}' >/dev/null
  fi
  "$S" set "${NUTZER_VORHER:-8}" >/dev/null 2>&1
  [ "$MUTE_VORHER" = "no" ] && pactl set-sink-mute "$KARTE" 0
  [ -z "${WARTUNG_EXTERN:-}" ] && rm -f /tmp/.mixpi-wartung 2>/dev/null
  echo "── wiederhergestellt: Nutzer ${NUTZER_VORHER}, maxVolume ${MAX_VORHER}, Deckel ${DECKEL_VORHER:-keiner}, mute ${MUTE_VORHER} ──"
}
trap wiederherstellen EXIT

pactl set-sink-mute "$KARTE" 1   # lautlos ab hier

# ── RUHE-WACHE (05.09.2026): direkt nach einer Server-Auslieferung baut die
# Klangwache die Kette neu und stellt dabei die gemerkte Hoerlautstaerke
# zurueck — mitten in die ersten Probenfaelle (zweimal gemessen: set 100,
# get 10). Deshalb: warten, bis das Klangwerk steht UND die Karte drei
# Sekunden lang niemand anfasst. Erst dann ist die Buehne wirklich leer.
for _ in $(seq 1 12); do
  pactl list sinks short | grep -q "	klangwerk	" && break
  sleep 5
done
for _ in 1 2 3 4 5 6; do
  r1="$(kartenwert)"; sleep 3; r2="$(kartenwert)"
  [ "$r1" = "$r2" ] && break
  echo "  (warte: ein fremder Schreiber bewegt die Karte: $r1 -> $r2)"
done

fehler=0
pruefe() { # name bedingung istwert
  if [ "$2" = ja ]; then printf '  ok   %-58s %s\n' "$1" "$3"
  else printf '  X    %-58s %s\n' "$1" "$3"; fehler=$((fehler+1)); fi
}
# Ein Prozent Kulanz: pactl rundet zwischen Prozent und internem Bruch.
etwa() { [ "$(( $1 > $2 ? $1 - $2 : $2 - $1 ))" -le 1 ] && echo ja || echo nein; }

# ── Bekannte Buehne: maxVolume 60, Deckel intern 70 (Deckel > Grenze,
#    damit sichtbar wird, WER klemmt) ──────────────────────────────────────
curl -s -m 8 -X POST http://localhost:8200/api/konfiguration \
  -H 'Content-Type: application/json' -d '{"aenderungen":{"maxLautstaerke":60}}' >/dev/null
curl -s -m 8 -X POST http://localhost:8200/api/ton/deckel \
  -H 'Content-Type: application/json' -d '{"ziel":"intern","prozent":70}' >/dev/null
sleep 1

echo "── Skript (Nutzerskala, maxVolume 60) ──"
$S set 100 >/dev/null 2>&1; sleep 0.4
pruefe "set 100 -> Karte steht auf der Grenze (60)" "$(etwa "$(kartenwert)" 60)" "Karte $(kartenwert)%"
pruefe "set 100 -> get meldet 100" "$([ "$($S get)" = 100 ] && echo ja || echo nein)" "get $($S get)"
$S set 150 >/dev/null 2>&1; sleep 0.4
pruefe "set 150 -> klemmt bei 100/60" "$(etwa "$(kartenwert)" 60)" "Karte $(kartenwert)%"
$S set 50 >/dev/null 2>&1; sleep 0.4
pruefe "set 50 -> Karte 30 (Haelfte der Erlaubnis)" "$(etwa "$(kartenwert)" 30)" "Karte $(kartenwert)%"
$S up 5 >/dev/null 2>&1; sleep 0.4
pruefe "up 5 von 50 -> get 55" "$([ "$($S get)" = 55 ] && echo ja || echo nein)" "get $($S get)"
$S set 100 >/dev/null 2>&1; $S up 5 >/dev/null 2>&1; sleep 0.4
pruefe "up 5 von 100 -> bleibt 100" "$([ "$($S get)" = 100 ] && echo ja || echo nein)" "get $($S get)"
$S set 0 >/dev/null 2>&1; $S down 5 >/dev/null 2>&1; sleep 0.4
pruefe "down 5 von 0 -> bleibt 0" "$([ "$($S get)" = 0 ] && echo ja || echo nein)" "get $($S get)"

echo "── Server: POST /api/ton/senke (Karten-Prozent) ──"
A="$(curl -s -m 8 -X POST http://localhost:8200/api/ton/senke \
  -H 'Content-Type: application/json' \
  -d "{\"sinkName\":\"$KARTE\",\"prozent\":120}")"
AP="$(echo "$A" | jq -r '.prozent // empty')"
sleep 0.6
pruefe "120% angefragt -> Antwort klemmt auf 60" "$(etwa "${AP:-999}" 60)" "Antwort ${AP:-?}%"
pruefe "120% angefragt -> Karte steht auf 60" "$(etwa "$(kartenwert)" 60)" "Karte $(kartenwert)%"
C1="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST http://localhost:8200/api/ton/senke \
  -H 'Content-Type: application/json' -d '{"sinkName":"mixpi-mitschnitt","prozent":50}')"
pruefe "Durchreiche mixpi-mitschnitt -> 409" "$([ "$C1" = 409 ] && echo ja || echo nein)" "HTTP $C1"
C2="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST http://localhost:8200/api/ton/senke \
  -H 'Content-Type: application/json' -d '{"sinkName":"ueberall","prozent":50}')"
pruefe "Kombi ueberall -> 409" "$([ "$C2" = 409 ] && echo ja || echo nein)" "HTTP $C2"

echo "── Waechter: Karte VON HAND ueber die Grenze, dann Trigger ──"
pactl set-sink-volume "$KARTE" 90%
curl -s -m 8 -X POST http://localhost:8200/api/ton/deckel \
  -H 'Content-Type: application/json' -d '{"ziel":"intern","prozent":70}' >/dev/null
sleep 1.5
pruefe "pactl 90% -> Waechter drueckt auf 60" "$(etwa "$(kartenwert)" 60)" "Karte $(kartenwert)%"
for s in mixpi-mitschnitt klangwerk entzerrer; do
  w="$(senkenwert "$s")"
  [ -z "$w" ] && continue
  pruefe "Durchreiche $s bleibt auf 100" "$(etwa "$w" 100)" "${w}%"
done

echo "── Grenze SENKEN, waehrend die Karte oben steht (der Fund von heute) ──"
$S set 100 >/dev/null 2>&1; sleep 0.4   # Karte auf 60
curl -s -m 8 -X POST http://localhost:8200/api/konfiguration \
  -H 'Content-Type: application/json' -d '{"aenderungen":{"maxLautstaerke":30}}' >/dev/null
ok=nein
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  [ "$(etwa "$(kartenwert)" 30)" = ja ] && { ok=ja; break; }
done
pruefe "maxVolume 60->30 -> Karte folgt binnen 5 s" "$ok" "Karte $(kartenwert)%"

echo "── Player-Daemon (:5005, der Regler im Player) ──"
# DERSELBE AUFRUF WIE DER ECHTE REGLER: NewDesign/app.js setzt fest
# RAUM = 'current' (spielerBefehl). Die Probe geht keinen eigenen Weg —
# sonst prueft sie etwas, das kein Kind je zieht.
curl -s -m 12 "http://localhost:5005/current/setvolume:120" >/dev/null 2>&1
sleep 1.2
pruefe "setvolume:120 -> Karte hoechstens auf der Grenze (30)" "$(etwa "$(kartenwert)" 30)" "Karte $(kartenwert)%"

echo
if [ "$fehler" -eq 0 ]; then echo "OK   alle Wege halten die Grenze."; else echo "X    $fehler Fall/Faelle rot."; fi
exit "$fehler"
REMOTE
rc=$?
# 0 = gruen. 255 = SSH selbst scheiterte (nicht messbar). Alles andere ist
# eine Fehlerzahl aus der Tabelle — nach aussen einheitlich 1.
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 255 ] && exit 2
exit 1
