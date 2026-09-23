#!/bin/bash
# Test fuer scripts/mixpi/mixpi-wlan-adapter.sh — vor allem fuer die RETTUNG.
#
# WOZU DIESER TEST UND KEIN GERAETELAUF: Der Rettungszweig feuert genau dann,
# wenn die gewaehlte Karte NICHT traegt. Um ihn an der Box auszuloesen,
# muesste man die tragende Verbindung kaputtmachen — und genau das ist der
# Fall, in dem ein Fehler die Box aussperrt. Am 06.09.2026 wurde deshalb am
# Geraet nur der Normalfall und die Wahl-weg-Gegenprobe gefahren; der
# Rettungszweig steht hier, mit Attrappen fuer `ip`, `ifup` und `ifdown`.
#
# WAS GEPRUEFT WIRD:
#   1. Normalfall: die Gewaehlte traegt -> die andere wird hingelegt (ifdown),
#      NICHTS wird hochgefahren.
#   2. RETTUNG: die Gewaehlte traegt nicht, die andere auch nicht -> die
#      andere wird per `ifup` hochgefahren (sonst steht die Box ohne Netz da).
#   3. KEINE unnoetige Rettung: die Gewaehlte traegt nicht, die andere hat
#      aber schon eine Adresse -> kein zweites `ifup`.
#   4. Ohne Wahl-Datei passiert gar nichts (weder ifdown noch ifup).
#
# AUFRUF
#   tools/mixpi-wlan-adapter.test.sh

set -u
SKRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/mixpi/mixpi-wlan-adapter.sh"
ARBEIT="$(mktemp -d /tmp/mixpi-wlan-adapter-test.XXXXXX)"
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

WAHL="$ARBEIT/mixpi-wlan-adapter"
ATTRAPPEN="$ARBEIT/bin"
PROTOKOLL="$ARBEIT/getan"
mkdir -p "$ATTRAPPEN" "$ARBEIT/leases"

# ── DIE ATTRAPPEN ──────────────────────────────────────────────────────────
# `ip` liest seine Antworten aus Dateien, die der jeweilige Fall vorher legt
# ($ARBEIT/addr.<karte>); `ifup`/`ifdown` schreiben nur mit, was sie taeten.
cat >"$ATTRAPPEN/ip" <<'ENDE'
#!/bin/bash
if [ "$1" = "-br" ] && [ "$2" = "addr" ]; then
	karte="$4"
	cat "${ARBEIT}/addr.${karte}" 2>/dev/null
	exit 0
fi
if [ "$1" = "-br" ] && [ "$2" = "link" ]; then
	karte="$4"
	[ -e "${ARBEIT}/da.${karte}" ] && { echo "${karte} UP"; exit 0; }
	exit 1
fi
if [ "$1" = "route" ] && [ "$#" = "1" ]; then
	echo "default via 192.168.178.1 dev wlan1"
	exit 0
fi
echo "ip $*" >>"${ARBEIT}/getan"
exit 0
ENDE
for befehl in ifup ifdown; do
	printf '#!/bin/bash\necho "%s $*" >>"${ARBEIT}/getan"\nexit 0\n' "$befehl" >"$ATTRAPPEN/$befehl"
done
chmod +x "$ATTRAPPEN"/*

lauf() { # der Adapter mit Attrappen im Pfad und kurzer Frist
	: >"$PROTOKOLL"
	env PATH="$ATTRAPPEN:$PATH" ARBEIT="$ARBEIT" \
		MIXPI_WLAN_WAHL="$WAHL" MIXPI_WLAN_WARTEN=1 \
		MIXPI_WLAN_VERTRAGSORDNER="$ARBEIT/leases" \
		bash "$SKRIPT" >/dev/null 2>&1
}
# `grep -c` DRUCKT die 0 selbst und gibt trotzdem Exit 1 — ein `|| echo 0`
# haengt deshalb eine ZWEITE Null an, und der Vergleich bekommt "0\n0"
# (beim ersten Lauf dieses Tests genau so passiert).
getan() { grep -c "^$1" "$PROTOKOLL" 2>/dev/null; true; }

# Beide Karten existieren in allen Faellen.
touch "$ARBEIT/da.wlan0" "$ARBEIT/da.wlan1"

# 1. Normalfall: Wahl extern, wlan1 traegt.
echo "extern" >"$WAHL"
echo "wlan1 UP 192.168.178.62/24" >"$ARBEIT/addr.wlan1"
: >"$ARBEIT/addr.wlan0"
lauf
pruefe "Normalfall: wlan0 wird hingelegt" "$(getan 'ifdown wlan0')" "1"
pruefe "Normalfall: NICHTS wird hochgefahren" "$(getan 'ifup')" "0"

# 2. DIE RETTUNG: die gewaehlte traegt nicht, die andere auch nicht.
: >"$ARBEIT/addr.wlan1"
: >"$ARBEIT/addr.wlan0"
lauf
pruefe "Rettung: wlan0 wird hochgefahren, wenn wlan1 nicht traegt" "$(getan 'ifup wlan0')" "1"
pruefe "Rettung: es wird NICHTS hingelegt" "$(getan 'ifdown')" "0"

# 3. Keine unnoetige Rettung: die andere haelt die Box schon.
: >"$ARBEIT/addr.wlan1"
echo "wlan0 UP 192.168.178.57/24" >"$ARBEIT/addr.wlan0"
lauf
pruefe "keine doppelte Rettung, wenn wlan0 schon traegt" "$(getan 'ifup')" "0"

# 4. Ohne Wahl-Datei: gar nichts.
rm -f "$WAHL"
echo "wlan1 UP 192.168.178.62/24" >"$ARBEIT/addr.wlan1"
lauf
pruefe "ohne Wahl-Datei wird nichts angefasst" "$(( $(getan 'ifup') + $(getan 'ifdown') ))" "0"

echo
if [ "$FEHLER" -eq 0 ]; then
	echo "ALLE PROBEN BESTANDEN."
	exit 0
fi
echo "${FEHLER} PROBE(N) GESCHEITERT."
exit 1
