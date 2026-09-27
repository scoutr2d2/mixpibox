#!/usr/bin/env bash
# Den Rueckweg WIRKLICH fahren — nicht lesen, nicht trocken (BACKLOG E29/B1,B2).
#
# WARUM ES DAS GIBT
# Eine Sicherung, die nie zurueckgespielt wurde, ist keine. `--probe` faehrt
# den Rueckweg gegen ein WEGWERF-Verzeichnis — das beweist, dass sich das
# Archiv oeffnen und auspacken laesst, aber NICHT, dass die laufende Box
# danach wieder so dasteht wie vorher. Genau das misst dieses Werkzeug:
#
#   1. echten Stand sichern (angeheftet, faellt der Auslese nie zum Opfer)
#   2. einen harmlosen Darstellungsschalter WIRKLICH verstellen — ueber die
#      API, also auf demselben Weg, den auch die Verwaltung nimmt
#   3. nachsehen, dass die Verstellung angekommen ist (Datei UND API)
#   4. zurueckspielen
#   5. nachsehen, dass der ALTE Wert wieder dasteht — Byte fuer Byte
#   6. aufraeumen: die eigenen Staende wieder wegnehmen
#
# DER SCHALTER IST MIT BEDACHT GEWAEHLT: `aktuell.zeigeUhr` in
# darstellung.json. Er zeigt eine Uhr an oder nicht; er kann die Box weder
# stumm noch unerreichbar machen. Und `darstellungSchreiben` in server.ts
# schreibt daneben und benennt um — es gibt also nie eine halbe Datei.
#
# AUFRUF
#     tools/rueckweg-wirklich-fahren.sh [box]          # voll, mit Aufraeumen
#     tools/rueckweg-wirklich-fahren.sh [box] --lassen # Staende stehen lassen
#
# Der Rueckgabewert ist 0, wenn JEDER Schritt bestanden hat.
set -u

BOX="${1:-dietpi@192.168.178.169}"
[[ "${BOX}" == --* ]] && BOX="dietpi@192.168.178.169"
LASSEN=0
for a in "$@"; do [[ "$a" == "--lassen" ]] && LASSEN=1; done

S="ssh -o ConnectTimeout=10 ${BOX}"
KONF="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
DAR="${KONF}/darstellung.json"
WERK="/usr/local/bin/mupibox/mupibox-sicherung.py"
STAENDE="/home/dietpi/.mupibox/sicherungen"
GRUND="rueckweg-gegenlesen"

gut=0; schlecht=0
chk() {  # chk "was" "ist" "soll"
  if [[ "$2" == "$3" ]]; then printf '  OK     %s\n' "$1"; gut=$((gut+1))
  else printf '  FEHLT  %s\n           ist:  %s\n           soll: %s\n' "$1" "$2" "$3"; schlecht=$((schlecht+1)); fi
}
schritt() { printf '\n── %s ───────────────────────────────────────\n' "$1"; }

schritt "0. Ausgangslage"
$S "test -f ${DAR}" || { echo "FEHLER: ${DAR} gibt es nicht"; exit 2; }
M0=$($S "md5sum ${DAR} | cut -d' ' -f1")
UHR0=$($S "python3 -c \"import json;print(json.load(open('${DAR}'))['aktuell']['zeigeUhr'])\"")
STAENDE0=$($S "ls ${STAENDE}/*.tar.gz 2>/dev/null | wc -l")
echo "  darstellung.json md5=${M0}"
echo "  aktuell.zeigeUhr = ${UHR0}"
echo "  Staende vorher:   ${STAENDE0}"

schritt "1. Stand anlegen (angeheftet)"
$S "sudo -n ${WERK} --anlegen --grund ${GRUND} --behalten" || { echo "FEHLER beim Anlegen"; exit 2; }
STAND=$($S "ls -1 ${STAENDE} | grep -- '-${GRUND}\.behalten\.tar\.gz$' | sort | tail -1")
echo "  Stand: ${STAND}"
[[ -n "${STAND}" ]] || { echo "FEHLER: kein Stand entstanden"; exit 2; }

# Traegt der Stand WIRKLICH den Wert von vorher? Sonst beweist der Rest nichts.
M_IM_STAND=$($S "cd /tmp && sudo -n tar -xzOf ${STAENDE}/${STAND} server/config/darstellung.json | md5sum | cut -d' ' -f1")
chk "der Stand traegt darstellung.json Byte fuer Byte wie auf der Box" "${M_IM_STAND}" "${M0}"

schritt "2. Den Schalter WIRKLICH verstellen (ueber PUT /api/darstellung)"
# Umgedreht wird IN PYTHON (`not`), nicht in der Shell: `true`/`false` sind
# hier Zeichenketten und dort Schluesselwoerter, und ein durchgereichtes
# `true` ist in Python ein NameError. Der Lauf war deswegen schon einmal
# gruen an den falschen Stellen — nichts wurde verstellt, und Schritt 5
# verglich den alten Wert mit sich selbst.
NEU=$([[ "${UHR0}" == "True" ]] && echo False || echo True)
$S "python3 - <<'PY'
import json, urllib.request
p = '${KONF}/darstellung.json'
d = json.load(open(p))
d['aktuell']['zeigeUhr'] = not d['aktuell']['zeigeUhr']
r = urllib.request.Request('http://127.0.0.1:8200/api/darstellung',
                           data=json.dumps({'aktuell': d['aktuell'], 'themen': d['themen']}).encode(),
                           headers={'Content-Type': 'application/json'}, method='PUT')
print('  API sagt:', urllib.request.urlopen(r, timeout=10).read().decode())
PY"
sleep 1
M1=$($S "md5sum ${DAR} | cut -d' ' -f1")
UHR1=$($S "python3 -c \"import json;print(json.load(open('${DAR}'))['aktuell']['zeigeUhr'])\"")
API1=$($S "curl -s http://127.0.0.1:8200/api/darstellung | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"aktuell\"][\"zeigeUhr\"])'")
chk "die Datei hat sich geaendert" "$([[ "${M1}" != "${M0}" ]] && echo ja || echo nein)" "ja"
chk "in der Datei steht der NEUE Wert" "${UHR1}" "${NEU}"
chk "die API liefert den NEUEN Wert" "${API1}" "$([[ "${NEU}" == "True" ]] && echo True || echo False)"

schritt "3. Erst trocken — es darf nichts geschrieben werden"
$S "sudo -n ${WERK} --wiederherstellen ${STAND} --trocken" | sed 's/^/  /'
M_TROCKEN=$($S "md5sum ${DAR} | cut -d' ' -f1")
chk "--trocken hat die Datei NICHT angefasst" "${M_TROCKEN}" "${M1}"

schritt "4. Zurueckspielen — im Ernst"
$S "sudo -n ${WERK} --wiederherstellen ${STAND}" | sed 's/^/  /'
sleep 1
M2=$($S "md5sum ${DAR} | cut -d' ' -f1")
UHR2=$($S "python3 -c \"import json;print(json.load(open('${DAR}'))['aktuell']['zeigeUhr'])\"")
API2=$($S "curl -s http://127.0.0.1:8200/api/darstellung | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"aktuell\"][\"zeigeUhr\"])'")

schritt "5. Steht der ALTE Wert wieder da?"
chk "darstellung.json ist wieder Byte fuer Byte die alte" "${M2}" "${M0}"
chk "in der Datei steht wieder der alte Wert" "${UHR2}" "${UHR0}"
chk "die API liefert wieder den alten Wert" "${API2}" "$([[ "${UHR0}" == "True" ]] && echo True || echo False)"

# Der Rueckweg braucht selbst einen Rueckweg: waehrend des Zurueckspielens
# muss ein Stand «vor-wiederherstellung» entstanden sein, und der muss den
# VERSTELLTEN Wert tragen — sonst waere die Verstellung unwiederbringlich.
VOR=$($S "ls -1t ${STAENDE} | grep -- 'vor-wiederherstellung' | head -1")
if [[ -n "${VOR}" ]]; then
  M_VOR=$($S "cd /tmp && sudo -n tar -xzOf ${STAENDE}/${VOR} server/config/darstellung.json | md5sum | cut -d' ' -f1")
  chk "der Rueckweg hat selbst einen Rueckweg (${VOR})" "${M_VOR}" "${M1}"
else
  chk "der Rueckweg hat selbst einen Rueckweg" "keiner" "einer"
fi

schritt "6. Bibliothek und Dienste unveraendert?"
N=$($S "curl -s http://127.0.0.1:8200/api/data | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))'")
FAILED=$($S "systemctl list-units --state=failed --no-legend | wc -l")
echo "  Eintraege ueber /api/data: ${N}"
chk "kein Dienst auf failed" "${FAILED}" "0"

if [[ "${LASSEN}" == "0" ]]; then
  schritt "7. Aufraeumen — die eigenen Staende wieder wegnehmen"
  $S "sudo -n rm -f ${STAENDE}/${STAND} ${VOR:+${STAENDE}/${VOR}}"
  STAENDE1=$($S "ls ${STAENDE}/*.tar.gz 2>/dev/null | wc -l")
  chk "genauso viele Staende wie vorher" "${STAENDE1}" "${STAENDE0}"
fi

printf '\n═══ %s bestanden, %s fehlgeschlagen ═══\n' "${gut}" "${schlecht}"
exit $(( schlecht > 0 ))
