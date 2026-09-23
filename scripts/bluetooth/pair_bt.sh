#!/bin/bash
# Ein Bluetooth-Geraet koppeln, ihm vertrauen und verbinden.
#
# ══ ZWEI FEHLER, AM GERAET GEFUNDEN (06.09.2026) ═══════════════════════════
# Beim Koppeln einer Fire-TV-Fernbedienung an Box .81 scheiterte jeder Versuch
# mit `org.bluez.Error.AuthenticationFailed`. Ursache waren zwei alte Zeilen —
# dieselben zwei, die am 31.08.2026 in den VIER Nachbarskripten behoben wurden
# (siehe Kopf von start_bt.sh). Dieses Skript lag schon laenger im Baum und
# ging bei der Reparatur durch:
#
#   1. `defaut-agent` statt `default-agent`. bluetoothctl verwirft den
#      unbekannten Befehl STILL — es wird kein Standard-Agent registriert, und
#      ohne Agent nimmt der Adapter keine Kopplung an. Das ist die eigentliche
#      Ursache des AuthenticationFailed.
#   2. `ouput=$(...)` gefolgt von `echo $output` — die Zuweisung ging in eine
#      Variable, gelesen wurde eine andere (leere). Die Ausgabe war IMMER leer,
#      also sah jeder Aufruf erfolgreich aus, auch der gescheiterte.
#
# ══ WARUM ERST VERTRAUEN, DANN KOPPELN ═════════════════════════════════════
# `trust` VOR `pair` ist Absicht und bleibt so: eine Fernbedienung schlaeft
# nach kurzer Zeit ein und meldet sich spaeter von selbst zurueck. Ohne
# gesetztes Vertrauen lehnt BlueZ diese Rueckkehr ab, und das Kind muesste die
# Fernbedienung jedes Mal neu koppeln.
#
# AUFRUF
#     pair_bt.sh <MAC>
#
# Rueckgabe 0, wenn am Ende eine Verbindung steht; sonst 1. Die Ausgabe von
# bluetoothctl geht mit — sie ist die einzige Diagnose, die es hier gibt.

set -u

MAC="${1:-}"
if [ -z "$MAC" ]; then
	echo "Aufruf: $(basename "$0") <MAC>" >&2
	exit 2
fi

coproc bluetoothctl
echo -e "power on\n" >&"${COPROC[1]}"
# ══ `NoInputNoOutput` UND NICHT `agent on` (06.09.2026, am Geraet gelernt) ══
#
# `agent on` nimmt die Faehigkeiten des Adapters an, und der meldet sich als
# eines mit Anzeige. Dann verlangt BlueZ bei einer Fernbedienung den
# ZAHLENVERGLEICH — im Protokoll steht woertlich:
#
#     [agent] Confirm passkey 747168 (yes/no):
#
# Diese Frage kommt SEKUNDEN nach `pair`, das `yes` weiter unten war da laengst
# verschickt und verpuffte. Ergebnis: `AuthenticationFailed`, jedes Mal.
#
# Eine Fernbedienung hat weder Anzeige noch Tastatur. `NoInputNoOutput` sagt
# genau das — dann koppelt BlueZ ohne Rueckfrage („Just Works"). Das ist keine
# Abkuerzung, sondern die richtige Auskunft ueber ein Geraet mit sechs Tasten.
echo -e "agent NoInputNoOutput\n" >&"${COPROC[1]}"
sleep 1
echo -e "default-agent\n" >&"${COPROC[1]}"
sleep 1
echo -e "scan on\n" >&"${COPROC[1]}"
sleep 10
echo -e "scan off\n" >&"${COPROC[1]}"
echo -e "trust ${MAC}\n" >&"${COPROC[1]}"
sleep 2
echo -e "pair ${MAC}\n" >&"${COPROC[1]}"
# NACH der Kopplung noch ein `yes` — falls der Adapter doch fragt (andere
# Fernbedienung, andere Faehigkeiten). Kommt keine Frage, ist es ein
# unbekannter Befehl und wird verworfen; das schadet nicht.
sleep 8
echo -e "yes\n" >&"${COPROC[1]}"
sleep 2
echo -e "connect ${MAC}\n" >&"${COPROC[1]}"
sleep 5
echo -e 'exit' >&"${COPROC[1]}"
# EINE Variable, nicht zwei — siehe Fehler 2 im Kopf.
ausgabe=$(cat <&"${COPROC[0]}")
echo "$ausgabe"

# DAS URTEIL KOMMT VOM ADAPTER, NICHT VOM PROTOKOLL: `bluetoothctl info` sagt,
# was WIRKLICH steht. Die Zeilen oben sagen nur, was versucht wurde — und ein
# Skript, das immer 0 zurueckgibt, ist keine Auskunft (Fehler 2 hat genau das
# jahrelang getan).
if bluetoothctl info "${MAC}" 2>/dev/null | grep -qE '^\s*Connected:\s*yes'; then
	exit 0
fi
exit 1
