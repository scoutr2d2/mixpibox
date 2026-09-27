#!/bin/bash
# Test fuer scripts/mupibox/dhcp-schneller.sh — der Rueckweg muss BEWIESEN sein.
#
# WOZU: Das Skript fasst /etc/dhcp/dhclient.conf an. Faellt der Rueckweg aus,
# steht eine Box im Kinderzimmer ohne Netz. Ein Rueckweg, der nur behauptet
# ist, ist keiner — also wird er hier gefahren, nicht beschrieben.
#
# WAS GEPRUEFT WIRD, und jeder Punkt hat einen Grund:
#   1. Einbauen haengt den Block an — und laesst den vorhandenen Inhalt STEHEN.
#      Die Falle: /etc/dhcp/dhclient.conf enthaelt die request-Liste mit den
#      DNS-Servern. Wer sie durch eine Vorlage ersetzt, nimmt der Box die
#      Namensaufloesung und sucht den Fehler danach ueberall sonst.
#   2. Zweimal einbauen aendert nichts mehr (das Rezept laeuft bei jedem
#      Update erneut).
#   3. Zuruecknehmen stellt Byte fuer Byte den Ausgangszustand her.
#   4. Zuruecknehmen OHNE Sicherung nimmt trotzdem nur den Block heraus und
#      laesst alles andere in Ruhe.
#   5. Zuruecknehmen ohne alles ist ein no-op und kein Fehler.
#   6. --pruefen sagt vorher/nachher das Richtige (Rueckgabewert, nicht Text).
#
# AUFRUF
#   tools/dhcp-schneller.test.sh

set -u
SKRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/mupibox/dhcp-schneller.sh"
ARBEIT="$(mktemp -d /tmp/dhcp-schneller-test.XXXXXX)"
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

# So sieht die Datei auf der Box aus (gekuerzt, aber mit dem Teil, der
# verlorengehen KOENNTE, wenn man ersetzt statt anzuhaengt).
frisch() {
	cat >"$ARBEIT/dhclient.conf" <<'ENDE'
option rfc3442-classless-static-routes code 121 = array of unsigned integer 8;
send host-name = gethostname();
request subnet-mask, broadcast-address, time-offset, routers,
	domain-name, domain-name-servers, domain-search, host-name,
	rfc3442-classless-static-routes, ntp-servers;
ENDE
	rm -f "$ARBEIT/dhclient.conf.vor-mupibox"
	cp "$ARBEIT/dhclient.conf" "$ARBEIT/urzustand"
}

lauf() { DHCLIENT_CONF="$ARBEIT/dhclient.conf" "$SKRIPT" "$1" >/dev/null 2>&1; echo $?; }

echo
echo "dhcp-schneller.sh"

# ── 1. Einbauen: Block da, Altbestand unberuehrt ──────────────────────────
frisch
pruefe "einbauen meldet Erfolg" "$(lauf --einbauen)" "0"
pruefe "backoff-cutoff steht drin" \
	"$(grep -c '^backoff-cutoff 2;$' "$ARBEIT/dhclient.conf")" "1"
pruefe "initial-interval steht drin" \
	"$(grep -c '^initial-interval 1;$' "$ARBEIT/dhclient.conf")" "1"
pruefe "retry steht drin" "$(grep -c '^retry 5;$' "$ARBEIT/dhclient.conf")" "1"
pruefe "die request-Liste ueberlebt" \
	"$(grep -c 'domain-name-servers' "$ARBEIT/dhclient.conf")" "1"
pruefe "Sicherung wurde angelegt" \
	"$([ -f "$ARBEIT/dhclient.conf.vor-mupibox" ] && echo ja || echo nein)" "ja"

# ── 2. Zweimal einbauen bleibt einmal ─────────────────────────────────────
pruefe "zweiter Einbau meldet Erfolg" "$(lauf --einbauen)" "0"
pruefe "backoff-cutoff steht GENAU EINMAL drin" \
	"$(grep -c '^backoff-cutoff 2;$' "$ARBEIT/dhclient.conf")" "1"

# ── 3. Der Rueckweg, gefahren statt behauptet ─────────────────────────────
pruefe "zuruecknehmen meldet Erfolg" "$(lauf --zuruecknehmen)" "0"
pruefe "Datei ist Byte fuer Byte wie vorher" \
	"$(cmp -s "$ARBEIT/dhclient.conf" "$ARBEIT/urzustand" && echo gleich || echo anders)" "gleich"
pruefe "Sicherung ist aufgeraeumt" \
	"$([ -f "$ARBEIT/dhclient.conf.vor-mupibox" ] && echo ja || echo nein)" "nein"

# ── 4. Rueckweg OHNE Sicherung: Block raus, Rest bleibt ───────────────────
# Kommt vor, wenn jemand die Sicherung aufraeumt oder von Hand einbaut.
frisch
lauf --einbauen >/dev/null
rm -f "$ARBEIT/dhclient.conf.vor-mupibox"
pruefe "zuruecknehmen ohne Sicherung meldet Erfolg" "$(lauf --zuruecknehmen)" "0"
pruefe "Block ist trotzdem weg" \
	"$(grep -c 'backoff-cutoff' "$ARBEIT/dhclient.conf")" "0"
pruefe "Marke ist mit weg" \
	"$(grep -c 'MuPiBox' "$ARBEIT/dhclient.conf")" "0"
pruefe "der Rest ist unberuehrt" \
	"$(cmp -s "$ARBEIT/dhclient.conf" "$ARBEIT/urzustand" && echo gleich || echo anders)" "gleich"

# ── 4b. Datei ohne Zeilenumbruch am Ende ──────────────────────────────────
# Kommt vor, wenn jemand die Datei von Hand bearbeitet hat. Ohne Vorkehrung
# klebt die Anfangsmarke an der letzten Zeile — und die Zeile davor wird
# dadurch zu einem Kommentar oder zu Unsinn.
printf 'send host-name = gethostname();' >"$ARBEIT/dhclient.conf"
rm -f "$ARBEIT/dhclient.conf.vor-mupibox"
lauf --einbauen >/dev/null
pruefe "letzte Zeile bleibt eine eigene Zeile" \
	"$(grep -c '^send host-name = gethostname();$' "$ARBEIT/dhclient.conf")" "1"

# ── 5. Zuruecknehmen ohne alles ist kein Fehler ───────────────────────────
frisch
pruefe "zuruecknehmen im Urzustand ist ein no-op" "$(lauf --zuruecknehmen)" "0"
pruefe "und aendert nichts" \
	"$(cmp -s "$ARBEIT/dhclient.conf" "$ARBEIT/urzustand" && echo gleich || echo anders)" "gleich"

# ── 6. --pruefen sagt die Wahrheit ueber den Rueckgabewert ────────────────
pruefe "pruefen im Urzustand: 1" "$(lauf --pruefen)" "1"
lauf --einbauen >/dev/null
pruefe "pruefen nach Einbau: 0" "$(lauf --pruefen)" "0"

# ── 7. Fehlende Datei wird nicht angelegt ─────────────────────────────────
# Eine Box ohne dhclient (statische Adresse, systemd-networkd) darf hier keine
# halbe Konfiguration bekommen.
rm -f "$ARBEIT/dhclient.conf"
pruefe "einbauen ohne Datei: 2 statt Erfolg" "$(lauf --einbauen)" "2"
pruefe "und legt keine Datei an" \
	"$([ -f "$ARBEIT/dhclient.conf" ] && echo ja || echo nein)" "nein"

echo
if [ "$FEHLER" = "0" ]; then
	echo "alles in Ordnung."
else
	echo "$FEHLER Punkt(e) gebrochen."
fi
exit "$FEHLER"
