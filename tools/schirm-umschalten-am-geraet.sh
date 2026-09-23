#!/usr/bin/env bash
# Schaltet den Schirm AN DER BOX aus und wieder an und misst, ob die Kette
# dahinter wirklich mitgeht.
#
# WOFUER
# ======
# tools/knopflicht-dimmweg-am-geraet.py sieht nur ZU: es liest, was gerade
# dasteht. Solange sich der Schirmzustand nicht aendert, sieht ein toter
# Auswerter genauso aus wie ein heiler — beide liefern denselben Wert.
# Diese Probe erzeugt die Aenderung selbst und schaut, ob sie ankommt:
#
#   /sys/class/backlight/*/bl_power   (gestellt: 0 = an, 4 = aus)
#        -> mupi_start_led.sh         -> /tmp/.power_led  led_dim_mode
#        -> get_monitor.sh            -> monitor.json     "monitor"
#
# Gemessen wird nicht nur der WERT, sondern auch die AENDERUNGSZEIT von
# monitor.json. Der alte Fehler bestand ja gerade darin, dass die Datei
# einfror, waehrend die Schleife jede Sekunde weiterlief.
#
# SICHERHEIT
# ==========
# bl_power wird gestellt — das ist ein Eingriff. Deshalb:
#   * Die HELLIGKEIT wird nicht angefasst, nur mitgeschrieben (vorher/nachher).
#   * Auf der Box laeuft eine WACHE mit: ein losgeloester Prozess, der
#     bl_power nach WACHE_S Sekunden bedingungslos auf den Ausgangswert
#     zurueckstellt. Bricht die Verbindung ab, bleibt der Schirm nicht dunkel.
#   * Am Ende wird zurueckgestellt und das Zurueckstellen NACHGELESEN.
#
#   bash tools/schirm-umschalten-am-geraet.sh [--box mupibox] [--runden 2]
#
# Rueckgabe 0 = die Kette geht mit, 1 = mindestens eine Stufe blieb stehen.

set -u

BOX="mupibox"
BENUTZER="dietpi"
RUNDEN=2
WARTEN=8      # Sekunden zwischen Stellen und Nachlesen
WACHE_S=180   # Not-Rueckstellung, falls die Verbindung abreisst

while [ $# -gt 0 ]; do
	case "$1" in
		--box)    BOX="$2"; shift 2 ;;
		--nutzer) BENUTZER="$2"; shift 2 ;;
		--runden) RUNDEN="$2"; shift 2 ;;
		--warten) WARTEN="$2"; shift 2 ;;
		*) echo "Unbekannt: $1" >&2; exit 2 ;;
	esac
done

SSH="ssh -o BatchMode=yes -o ConnectTimeout=8 ${BENUTZER}@${BOX}"

# Das Ferngeschehen liegt in EINER Datei auf der Box, nicht in einer
# ssh-Befehlszeile: sonst muesste jedes Anfuehrungszeichen zweimal durch die
# Shell, und die Wache liesse sich nicht sauber loesen.
cat >/tmp/schirm-umschalten-fern.sh <<'FERN'
#!/usr/bin/env bash
set -u

PWR=""
for d in /sys/class/backlight/*/; do PWR="${d}bl_power"; HELL="${d}brightness"; break; done
if [ -z "$PWR" ]; then echo "KEIN_BACKLIGHT"; exit 3; fi

MON="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/monitor.json"
LED="/tmp/.power_led"

lies() {   # $1 = Marke
	local bp mt mv dm
	bp=$(cat "$PWR" 2>/dev/null)
	mt=$(stat -c %Y "$MON" 2>/dev/null)
	mv=$(sed -n 's/.*"monitor"[^"]*"\([^"]*\)".*/\1/p' "$MON" 2>/dev/null)
	dm=$(sed -n 's/.*"led_dim_mode"[^0-9]*\([0-9]*\).*/\1/p' "$LED" 2>/dev/null)
	echo "MESS|$1|bl_power=${bp}|dim=${dm}|monitor=${mv}|mtime=${mt}|hell=$(cat "$HELL")"
}

stelle() {  # $1 = Wert
	echo "$1" | sudo -n tee "$PWR" >/dev/null
}

AUSGANG=$(cat "$PWR")
echo "AUSGANG|bl_power=${AUSGANG}|hell=$(cat "$HELL")"

# WACHE: stellt bedingungslos zurueck, egal was hier passiert. Sie haengt an
# einer Fahne — verschwindet die Fahne (regulaeres Ende), hoert die Wache von
# selbst auf. Kein pkill: `pkill -x sleep` traefe auf dieser Box die
# Sekundenschleifen aller Dienste mit.
FAHNE="/tmp/schirm-probe-laeuft"
: >"$FAHNE"
sudo -n nohup bash -c "
	for _ in \$(seq 1 ${WACHE_S}); do
		[ -e '${FAHNE}' ] || exit 0
		sleep 1
	done
	echo ${AUSGANG} > ${PWR}
" >/dev/null 2>&1 </dev/null &
echo "WACHE|fahne=${FAHNE}|nach=${WACHE_S}s|zurueck_auf=${AUSGANG}"

lies "start"

r=1
while [ "$r" -le "$RUNDEN" ]; do
	# Phase AUS
	stelle 4
	sleep "$WARTEN"
	lies "runde${r}-aus"
	# Phase AN
	stelle 0
	sleep "$WARTEN"
	lies "runde${r}-an"
	r=$((r+1))
done

# Zurueckstellen, dann die Fahne einholen — daran hoert die Wache auf.
stelle "$AUSGANG"
sleep 2
lies "ende"
rm -f "$FAHNE"
echo "ENDE|bl_power=$(cat "$PWR")|hell=$(cat "$HELL")|erwartet=${AUSGANG}"
FERN

echo "== Probe auf ${BOX} ablegen =="
scp -q -o BatchMode=yes /tmp/schirm-umschalten-fern.sh "${BENUTZER}@${BOX}:/tmp/" || {
	echo "Konnte die Probe nicht ablegen." >&2; exit 2; }

AUSGABE=$($SSH "RUNDEN=${RUNDEN} WARTEN=${WARTEN} WACHE_S=${WACHE_S} bash /tmp/schirm-umschalten-fern.sh" 2>&1)
echo "$AUSGABE"

echo
echo "== Auswertung =="
FEHLER=0

hole() { echo "$AUSGABE" | grep "^MESS|$1|" | head -1; }
feld() { echo "$1" | tr '|' '\n' | grep "^$2=" | cut -d= -f2-; }

r=1
while [ "$r" -le "$RUNDEN" ]; do
	AUS=$(hole "runde${r}-aus"); AN=$(hole "runde${r}-an")
	if [ -z "$AUS" ] || [ -z "$AN" ]; then
		echo "FEHLT: Runde ${r} wurde nicht gemessen"; FEHLER=1; r=$((r+1)); continue
	fi
	for paar in "dim:1:0" "monitor:Off:On"; do
		NAME=${paar%%:*}; REST=${paar#*:}; SOLL_AUS=${REST%%:*}; SOLL_AN=${REST#*:}
		IST_AUS=$(feld "$AUS" "$NAME"); IST_AN=$(feld "$AN" "$NAME")
		if [ "$IST_AUS" = "$SOLL_AUS" ] && [ "$IST_AN" = "$SOLL_AN" ]; then
			echo "  OK   Runde ${r} ${NAME}: aus=${IST_AUS} an=${IST_AN}"
		else
			echo "  ROT  Runde ${r} ${NAME}: aus=${IST_AUS} (soll ${SOLL_AUS}) an=${IST_AN} (soll ${SOLL_AN})"
			FEHLER=1
		fi
	done
	# Die Aenderungszeit muss sich bewegen — ein eingefrorenes monitor.json
	# mit zufaellig richtigem Inhalt ist KEIN Beweis.
	M1=$(feld "$AUS" mtime); M2=$(feld "$AN" mtime)
	if [ -n "$M1" ] && [ -n "$M2" ] && [ "$M1" != "$M2" ]; then
		echo "  OK   Runde ${r} monitor.json wird fortgeschrieben (mtime ${M1} -> ${M2})"
	else
		echo "  ROT  Runde ${r} monitor.json mtime steht still (${M1} / ${M2})"; FEHLER=1
	fi
	r=$((r+1))
done

ST=$(hole start); EN=$(hole ende)
H1=$(feld "$ST" hell); H2=$(feld "$EN" hell)
B2=$(feld "$EN" bl_power)
if [ "$H1" = "$H2" ]; then echo "  OK   Helligkeit unveraendert (${H1})"
else echo "  ROT  Helligkeit veraendert: ${H1} -> ${H2}"; FEHLER=1; fi
if [ "$B2" = "0" ]; then echo "  OK   bl_power zurueckgestellt (0)"
else echo "  ROT  bl_power steht auf ${B2}, nicht 0"; FEHLER=1; fi

echo
[ "$FEHLER" -eq 0 ] && echo "ALLES GRUEN" || echo "BEFUNDE VORHANDEN"
exit "$FEHLER"
