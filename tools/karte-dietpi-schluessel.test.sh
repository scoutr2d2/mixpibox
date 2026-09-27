#!/bin/bash
# Test fuer scripts/make-boot-sd.sh — die Schluessel, die auf der KARTE landen.
#
# WOZU, und der Befund, aus dem dieser Test entstand (Gegenlesen 04.08.2026):
#
#   config/templates/dietpi.txt trug seit dem 04.08.2026
#   AUTO_SETUP_SWAPFILE_LOCATION=zram, und BACKLOG E5/B7 stand auf FERTIG.
#   Nur: DIESE VORLAGE KAM AUF KEINEM WEG DIESES REPOS AUF EINE KARTE.
#   make-boot-sd.sh aendert die dietpi.txt der Karte an Ort und Stelle und
#   kannte genau zwei Schluessel (CUSTOM_SCRIPT_EXEC, WLAN); autosetup.sh
#   laeuft erst NACH DietPis Erstlauf, wenn der Swap schon angelegt ist. Eine
#   frische Karte haette /var/swap bekommen — und tools/bootkette-schau.py
#   haette "Repo ja" gemeldet, weil es die VORLAGE liest, nicht die Karte.
#
#   Die Lehre ist nicht "eine Zeile vergessen", sondern: EINE VORLAGE IM REPO
#   IST KEIN AUSROLLWEG. Geprueft wird, was auf der Karte steht.
#
# WAS GEPRUEFT WIRD, und jeder Punkt hat einen Grund:
#   1. Vorhandene Schluessel werden GEAENDERT, nicht ein zweites Mal
#      angehaengt — DietPi liest sonst je nach Reihenfolge den falschen.
#   2. Auch AUSKOMMENTIERTE Schluessel werden gesetzt (so liefert DietPi sie
#      teilweise aus).
#   3. Fehlende Schluessel werden angehaengt.
#   4. Fremde Schluessel bleiben unberuehrt — die Karte traegt Sprache,
#      Tastatur und Netz, und die gehoeren uns nicht.
#   5. Zweimal fahren aendert nichts mehr (die Karte wird beim Nachlegen
#      einer neuen Fassung erneut bespielt).
#
# AUFRUF
#   tools/karte-dietpi-schluessel.test.sh
#
# DAUER: das Skript baut jedes Mal den Release-Tarball aus HEAD (~50 MB), also
# ein paar Sekunden je Lauf. Absichtlich: geprueft wird der ECHTE Weg, nicht
# ein herausgeloester Ausschnitt davon — genau dieser Ausschnitt war der Fehler.

set -u
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
SKRIPT="${WURZEL}/scripts/make-boot-sd.sh"
ARBEIT="$(mktemp -d /tmp/karte-dietpi-test.XXXXXX)"
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

# So sieht die dietpi.txt aus, die DietPi ausliefert (gekuerzt): der
# Erstlauf-Schalter auskommentiert, die Swap-Schluessel gesetzt, und
# dazwischen Zeilen, die uns nichts angehen.
karte() {
	KARTE="$ARBEIT/$1"
	mkdir -p "$KARTE"
	cat >"$KARTE/dietpi.txt" <<'ENDE'
AUTO_SETUP_AUTOMATED=1
#AUTO_SETUP_CUSTOM_SCRIPT_EXEC=0
AUTO_SETUP_LOCALE=de_DE.UTF-8
AUTO_SETUP_NET_HOSTNAME=MuPiBox
AUTO_SETUP_SWAPFILE_SIZE=0
AUTO_SETUP_SWAPFILE_LOCATION=/var/swap
CONFIG_CPU_GOVERNOR=ondemand
ENDE
}

fahren() { (cd "$WURZEL" && bash "$SKRIPT" "$KARTE" --yes) >/dev/null 2>&1; echo $?; }

echo
echo "make-boot-sd.sh — was auf der Karte landet"

# ── 1. Der Normalfall: Schluessel stehen drin und werden geaendert ────────
karte normal
pruefe "Lauf meldet Erfolg" "$(fahren)" "0"
pruefe "Swap-Ort ist zram" \
	"$(grep -c '^AUTO_SETUP_SWAPFILE_LOCATION=zram$' "$KARTE/dietpi.txt")" "1"
pruefe "Swap-Groesse ist 1 (auto = 50 % RAM)" \
	"$(grep -c '^AUTO_SETUP_SWAPFILE_SIZE=1$' "$KARTE/dietpi.txt")" "1"
pruefe "kein zweiter Swap-Ort-Eintrag" \
	"$(grep -c '^[#[:space:]]*AUTO_SETUP_SWAPFILE_LOCATION=' "$KARTE/dietpi.txt")" "1"
pruefe "/var/swap ist weg" \
	"$(grep -c '/var/swap' "$KARTE/dietpi.txt")" "0"
pruefe "der auskommentierte Erstlauf-Schalter steht jetzt auf 1" \
	"$(grep -c '^AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1$' "$KARTE/dietpi.txt")" "1"
pruefe "fremde Schluessel ueberleben (Sprache)" \
	"$(grep -c '^AUTO_SETUP_LOCALE=de_DE.UTF-8$' "$KARTE/dietpi.txt")" "1"
pruefe "fremde Schluessel ueberleben (Taktregler)" \
	"$(grep -c '^CONFIG_CPU_GOVERNOR=ondemand$' "$KARTE/dietpi.txt")" "1"

# ── 2. Zweimal fahren aendert nichts mehr ─────────────────────────────────
VORHER="$(cat "$KARTE/dietpi.txt")"
pruefe "zweiter Lauf meldet Erfolg" "$(fahren)" "0"
pruefe "die dietpi.txt ist danach unveraendert" \
	"$([ "$VORHER" = "$(cat "$KARTE/dietpi.txt")" ] && echo gleich || echo anders)" "gleich"

# ── 3. Fehlen die Schluessel ganz, werden sie angehaengt ──────────────────
# Kommt vor, wenn DietPi eine Fassung ohne sie ausliefert oder jemand die
# Datei gekuerzt hat. Eine Karte ohne Swap-Ort bekaeme sonst still /var/swap.
karte ohne
cat >"$KARTE/dietpi.txt" <<'ENDE'
AUTO_SETUP_AUTOMATED=1
AUTO_SETUP_LOCALE=de_DE.UTF-8
ENDE
pruefe "Lauf ohne Swap-Schluessel meldet Erfolg" "$(fahren)" "0"
pruefe "Swap-Ort wurde angehaengt" \
	"$(grep -c '^AUTO_SETUP_SWAPFILE_LOCATION=zram$' "$KARTE/dietpi.txt")" "1"
pruefe "Swap-Groesse wurde angehaengt" \
	"$(grep -c '^AUTO_SETUP_SWAPFILE_SIZE=1$' "$KARTE/dietpi.txt")" "1"
pruefe "und die Sprache steht immer noch da" \
	"$(grep -c '^AUTO_SETUP_LOCALE=de_DE.UTF-8$' "$KARTE/dietpi.txt")" "1"

echo
if [ "$FEHLER" = "0" ]; then
	echo "alles in Ordnung."
else
	echo "$FEHLER Punkt(e) gebrochen."
fi
exit "$FEHLER"
