#!/bin/bash
# Test fuer scripts/mixpi/mixpi-wlan-riegel.sh — die Sicherheitsregel muss
# BEWIESEN sein, nicht behauptet.
#
# WOZU: Der Riegel haengt als ExecStartPre an ifup@. Rueckgabe 1 heisst
# „diese Funkkarte kommt nicht hoch". Ein Riegel, der im falschen Moment 1
# sagt, sperrt eine Box im Kinderzimmer aus — deshalb wird hier vor allem
# das DURCHLASSEN geprueft: jeder unklare Fall MUSS 0 geben.
#
# WAS GEPRUEFT WIRD, und jeder Punkt hat einen Grund:
#   1. Ohne Wahl-Datei: durchlassen (keine Wahl heisst „keine Wahl getroffen").
#   2. Fremde Schnittstellen (eth0): immer durchlassen — der Riegel regelt
#      nur wlan0/wlan1.
#   3. Die GEWAEHLTE Karte: immer durchlassen.
#   4. Die ABGEWAEHLTE Karte, Gewaehlte als Geraet DA: verriegeln (exit 1)
#      — der eine Fall, fuer den es den Riegel gibt.
#   5. Die ABGEWAEHLTE Karte, Gewaehlte FEHLT (Stick gezogen): durchlassen —
#      DIE Sicherheitsregel; wer hier 1 sagt, sperrt die Box aus.
#   6. Unlesbarer Wahl-Inhalt („quatsch"): durchlassen.
#   7. Ohne Argument: durchlassen (halb verdrahteter Drop-in darf nicht sperren).
#   8. Wahl „intern" spiegelt alles: wlan1 verriegelt, wlan0 durch.
#
# AUFRUF
#   tools/mixpi-wlan-riegel.test.sh

set -u
SKRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/mixpi/mixpi-wlan-riegel.sh"
ARBEIT="$(mktemp -d /tmp/mixpi-wlan-riegel-test.XXXXXX)"
trap 'rm -rf "$ARBEIT"' EXIT

FEHLER=0
pruefe() {
	if [ "$2" = "$3" ]; then
		printf '  ok    %s\n' "$1"
	else
		printf '  NEIN  %s\n       erwartet: %s\n       bekommen: %s\n' "$1" "$3" "$2"
		FEHLER=$((FEHLER + 1))
	fi
}

# Attrappen: Wahl-Datei und ein Wegwerf-/sys/class/net mit Geraete-Ordnern.
WAHL="$ARBEIT/mixpi-wlan-adapter"
NETZ="$ARBEIT/net"
mkdir -p "$NETZ"

riegel() { # <schnittstelle...> — Rueckgabewert ist das Urteil
	env MIXPI_WLAN_WAHL="$WAHL" MIXPI_WLAN_NETZKLASSE="$NETZ" MIXPI_WLAN_STICK_WARTEN="${WARTEN:-0}" bash "$SKRIPT" "$@" >/dev/null 2>&1
	echo $?
}

# 1. Ohne Wahl-Datei: alles durch.
rm -f "$WAHL"
mkdir -p "$NETZ/wlan0" "$NETZ/wlan1"
pruefe "ohne Wahl-Datei geht wlan0 durch" "$(riegel wlan0)" "0"
pruefe "ohne Wahl-Datei geht wlan1 durch" "$(riegel wlan1)" "0"

# Ab hier: Wahl = extern (der Stick soll tragen).
echo "extern" > "$WAHL"

# 2. Fremde Schnittstelle.
pruefe "eth0 geht immer durch" "$(riegel eth0)" "0"

# 3. Die Gewaehlte.
pruefe "die gewaehlte wlan1 geht durch" "$(riegel wlan1)" "0"

# 4. DER Verriegelungsfall: wlan0 bleibt unten, wlan1 ist da.
pruefe "wlan0 wird verriegelt, wenn wlan1 da ist" "$(riegel wlan0)" "1"

# 5. DIE SICHERHEITSREGEL: Stick gezogen -> wlan0 muss hoch duerfen.
rmdir "$NETZ/wlan1"
pruefe "Stick gezogen: wlan0 geht durch (nie die letzte Verbindung sperren)" "$(riegel wlan0)" "0"
mkdir -p "$NETZ/wlan1"

# 6. Unlesbarer Wahl-Inhalt.
echo "quatsch" > "$WAHL"
pruefe "unbekannte Wahl laesst alles durch" "$(riegel wlan0)" "0"

# 7. Ohne Argument.
echo "extern" > "$WAHL"
pruefe "ohne Argument wird nicht gesperrt" "$(riegel)" "0"

# 8. Wahl intern spiegelt.
echo "intern" > "$WAHL"
pruefe "Wahl intern: wlan1 wird verriegelt" "$(riegel wlan1)" "1"
pruefe "Wahl intern: wlan0 geht durch" "$(riegel wlan0)" "0"
# ... und auch gespiegelt gilt die Sicherheitsregel:
rmdir "$NETZ/wlan0"
pruefe "Wahl intern, wlan0 fehlt: wlan1 geht durch" "$(riegel wlan1)" "0"

# 9. DER BOOT-WETTLAUF (am Geraet gefunden, 06.09.2026, Boot 10:17): die
#    gewaehlte Karte ist ein USB-Stick und erscheint SPAETER als die
#    eingebaute. Der Riegel muss kurz warten und DANN verriegeln.
echo "extern" > "$WAHL"
rmdir "$NETZ/wlan1"
( sleep 1; mkdir -p "$NETZ/wlan1" ) &
NACHZUEGLER=$!
WARTEN=3
pruefe "Stick erscheint waehrend der Wartezeit: wlan0 wird verriegelt" "$(riegel wlan0)" "1"
wait "$NACHZUEGLER" 2>/dev/null
unset WARTEN

echo
if [ "$FEHLER" -eq 0 ]; then
	echo "ALLE PROBEN BESTANDEN."
	exit 0
fi
echo "${FEHLER} PROBE(N) GESCHEITERT."
exit 1
