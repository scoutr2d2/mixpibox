#!/bin/bash
#
# Get monitor blank information to block inputs if the screen is blank.
#
# ── WAS HIER LANGE SCHIEFLIEF (behoben 08.08.2026) ─────────────────────────
#
# Diese Schleife fragte jede Sekunde `vcgencmd display_power`. DEN BEFEHL GIBT
# ES AUF DEM PI 5 NICHT MEHR. Er antwortet zweizeilig — und zwar auf STDOUT,
# nicht auf stderr:
#
#     vc_gencmd_read_response returned -1
#     error=1 error_msg="Command not registered"
#
# `${MONITOR##*=}` schnitt daraus das Wort `"Command` heraus. Das ist weder
# "0" noch "1" noch "-1", also wurde WEDER der Rueckfall auf `bl_power`
# betreten (der richtige Weg stand schon da und war toter Code) NOCH eine der
# beiden Schreib-Verzweigungen. monitor.json fror auf seinem letzten Wert ein:
# am 08.08.2026 gemessen war die Datei VIER TAGE alt, waehrend die Schleife
# jede Sekunde lief. Sie stand auf "On" — stuende dort "Off", ignorierte die
# Box jede Beruehrung, ohne eine einzige Fehlermeldung.
#
# DAZU KAM DER LAERM: `sudo -H -u root bash -c "..."` — dieser Dienst laeuft
# laut Unit ohnehin schon als root. Es war also root, der sudo ruft, um root
# zu werden: drei Prozesse je Sekunde fuer nichts, und je Aufruf drei Zeilen
# ins Journal (COMMAND=..., session opened, session closed). Gemessen waren
# das 618 von 1677 Journalzeilen in drei Minuten.
#
# ── WIE ES JETZT GEHT ──────────────────────────────────────────────────────
#
# `schirm_zustand` unten fragt zuerst /sys/class/backlight/*/bl_power (ein
# Dateizugriff, kein Prozess, kein sudo) und faellt nur dann auf `vcgencmd`
# zurueck, wenn es ueberhaupt keine backlight-Klasse gibt — das ist der Pi 3/4
# am HDMI-Schirm, wo der Befehl noch etwas weiss.
#
# GESCHRIEBEN WIRD NUR NOCH BEI EINER AENDERUNG, und dann atomar. Vorher stand
# hier `cat <<< $(jq ...) > DATEI`, was die Datei ZUERST LEERT. Solange der
# Rueckfall tot war, passierte das nie; jetzt, wo die Auswertung wieder
# traegt, waere es ein Schreiben pro Sekunde auf eine Datei, die der Server
# ueber /api/monitor ausliefert — ein Treffer ins leere Fenster, auf den man
# nur warten muesste. Genau dagegen stand die `minimumsize`-Reparatur.
#
# VERGLICHEN WIRD MIT DEM, WAS WIRKLICH IN DER DATEI STEHT, nicht mit einer
# gemerkten Variablen: schreibt jemand anders die Datei um oder geht sie
# kaputt, faellt das beim naechsten Durchlauf auf und wird berichtigt. Gelesen
# wird sie mit `read`, also ohne einen Prozess zu starten.
#
# ── UND WAS DABEI ZUERST UEBERSEHEN WURDE ──────────────────────────────────
#
# Die Reparatur oben machte die Schleife LEISE — aber an zwei Stellen auch
# STUMM, und das ist derselbe Fehler noch einmal:
#
# 1. BEI "unbekannt" WURDE NICHTS GEAENDERT UND NICHTS GESAGT. Nachgemessen:
#    bl_power unlesbar (Rechte weg), Muell in der Datei, leere Datei, kein
#    Verzeichnis — jedes Mal "unbekannt", und in keinem Fall ein einziges
#    Zeichen auf stdout oder stderr. Stand monitor.json in diesem Moment auf
#    "Off", blieb es dort DAUERHAFT stehen: die Oberflaeche schliesst dann
#    jede Beruehrung aus, und ohne Messwert kommt der Wert nie zurueck. Genau
#    das Bild, gegen das oben repariert wurde — eingefrorene Datei, keine
#    Meldung —, nur ueber einen anderen Weg erreicht.
#    JETZT: eine Zeile je WECHSEL (nicht je Durchlauf), und nach
#    UNBEKANNT_GRENZE Durchlaeufen ohne Messwert wird ein stehengebliebenes
#    "Off" auf "On" geloest, damit die Box bedienbar bleibt.
#
# 2. `monitor_schreiben` HATTE `2>/dev/null` UND EIN FESTES `return 0`. Ein
#    Schreiben, das jede Sekunde scheitert, waere unsichtbar geblieben.
#    JETZT: der Grund wird aufgehoben und EINMAL gesagt, und noch einmal,
#    wenn es wieder geht.
#
# LEISER, NICHT STILLER: im Normalbetrieb sind das zwei Zeilen, wenn der
# Schirm einschlaeft und wieder aufwacht. Gemessen: 3 Zeilen fuer 3 Wechsel
# in 10 Sekunden, 3 Zeilen in 46 Sekunden Dauerstoerung, 1 Zeile fuer einen
# Schreibfehler, der 8 Sekunden lang anhielt.

MONITOR_FILE="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/monitor.json"

# Ist der Schirm an? Setzt die Variable SCHIRM auf "an", "aus" oder
# "unbekannt". Kein `echo` und keine Kommandoersetzung, damit die Schleife im
# Normalfall OHNE einen einzigen zusaetzlichen Prozess auskommt — sie laeuft
# einmal pro Sekunde auf einer Box, die am Akku haengt.
#
# ZWEI WEGE, IN DIESER REIHENFOLGE:
#
#   1. /sys/class/backlight/*/bl_power — 0 heisst an, alles andere (ueblich
#      ist 4) heisst aus. Auf dem Pi 5 mit DSI-Panel ist das der einzige Weg,
#      der noch etwas weiss. Lesbar auch ohne root (nachgemessen als dietpi).
#
#   2. `vcgencmd display_power` — NUR, wenn es gar keine backlight-Klasse
#      gibt. DEN RUECKGABEWERT DARF MAN NICHT FRAGEN: der Befehl schreibt
#      seine Fehlermeldung nach stdout und endet hier mit 255, in der alten
#      Rohrleitung stand aber `grep` am Ende und lieferte 0. Geprueft wird
#      deshalb die FORM: nur genau `display_power=0` oder `display_power=1`
#      gilt. Alles andere ist "unbekannt" — und bei "unbekannt" wird NICHTS
#      geaendert, damit eine unlesbare Quelle nicht als "Schirm aus"
#      durchgeht und die Box sich gegen jede Beruehrung sperrt.
#
# >>> schirm_zustand (diese Marke sucht tools/schirm-sandkasten.py)
schirm_zustand() {
	local datei wert
	for datei in /sys/class/backlight/*/bl_power; do
		[ -r "${datei}" ] || continue
		IFS= read -r wert < "${datei}" || continue
		case "${wert}" in
			0) SCHIRM="an"; return ;;
			*[0-9]*) SCHIRM="aus"; return ;;
		esac
	done

	if command -v vcgencmd >/dev/null 2>&1; then
		case "$(vcgencmd display_power 2>/dev/null)" in
			display_power=1) SCHIRM="an"; return ;;
			display_power=0) SCHIRM="aus"; return ;;
		esac
	fi

	SCHIRM="unbekannt"
}
# <<< schirm_zustand

# Was steht gerade in monitor.json? Setzt GELESEN auf "On", "Off" oder "" —
# leer heisst: Datei fehlt, ist leer oder enthaelt keinen brauchbaren Wert.
# Ohne Prozess, die Datei ist drei Zeilen lang.
monitor_gelesen() {
	local zeile
	GELESEN=""
	[ -f "${MONITOR_FILE}" ] || return
	while IFS= read -r zeile || [ -n "${zeile}" ]; do
		case "${zeile}" in
			*'"Off"'*) GELESEN="Off"; return ;;
			*'"On"'*)  GELESEN="On";  return ;;
		esac
	done < "${MONITOR_FILE}"
}

# Eine Zeile ins Journal. Ein `printf` ist ein eingebauter Befehl — kein
# Prozess. Gerufen wird das NUR bei einem WECHSEL, nie je Durchlauf: eine
# Warnung pro Sekunde loescht die Vorgeschichte genauso zuverlaessig wie der
# Fehler, den sie meldet.
melden() {
	printf '%s\n' "$*"
}

# Atomar schreiben: erst in eine Nebendatei, dann umbenennen. `mv` innerhalb
# desselben Verzeichnisses ist ein Umhaengen, kein Kopieren — der Server sieht
# entweder den alten oder den neuen Stand, nie eine halbe oder leere Datei.
# Der Dienst laeuft als root, der Server als dietpi; ihm gehoert die Datei.
#
# DER GRUND WIRD AUFGEHOBEN, NICHT WEGGEWORFEN: hier stand `2>/dev/null` und
# ein festes `return 0`. Damit konnte das Schreiben jede Sekunde scheitern,
# ohne dass irgendwo ein Zeichen davon ankam — monitor.json waere auf seinem
# alten Wert eingefroren, also genau der Zustand, gegen den diese Datei am
# 08.08.2026 repariert wurde. Jetzt landet die Meldung in SCHREIBGRUND und
# der Aufrufer sagt sie EINMAL. `chown` darf scheitern (dann gehoert die
# Datei bereits dietpi) und entscheidet deshalb nicht ueber den Erfolg.
monitor_schreiben() {
	SCHREIBGRUND=""
	if ! SCHREIBGRUND=$(/usr/bin/jq -n --arg v "$1" '.monitor = $v' 2>&1 > "${MONITOR_FILE}.neu"); then
		return 1
	fi
	if ! SCHREIBGRUND=$(/bin/mv -f "${MONITOR_FILE}.neu" "${MONITOR_FILE}" 2>&1); then
		return 1
	fi
	chown dietpi:dietpi "${MONITOR_FILE}" 2>/dev/null
	return 0
}

# Wie lange sagt die Quelle schon nichts mehr, und was wurde davon bereits
# gemeldet? "" heisst: beim ersten Durchlauf wird der Zustand einmal genannt.
SCHIRM_ALT=""
UNBEKANNT_SEIT=0
FREIGABE_GEMELDET=0
SCHREIBFEHLER=0

# Nach so vielen Durchlaeufen ohne Messwert wird die Sperre geloest. 30 x
# `sleep 1` sind eine gute halbe Minute — lang genug, dass ein einzelner
# Aussetzer beim Umschalten des Panels nicht sofort etwas ausloest.
UNBEKANNT_GRENZE=30

while true
do
	schirm_zustand
	monitor_gelesen

	# EINE Zeile je WECHSEL. Im Normalbetrieb sind das zwei Zeilen, wenn der
	# Schirm einschlaeft und wieder aufwacht — nicht 3600 je Stunde.
	if [ "${SCHIRM}" != "${SCHIRM_ALT}" ]; then
		if [ "${SCHIRM}" = "unbekannt" ]; then
			melden "Schirmzustand nicht mehr lesbar: weder /sys/class/backlight/*/bl_power noch vcgencmd geben eine brauchbare Antwort. monitor.json steht auf '${GELESEN:-nichts}'."
		else
			melden "Schirm ${SCHIRM}."
		fi
		SCHIRM_ALT="${SCHIRM}"
	fi

	if [ "${SCHIRM}" = "unbekannt" ]; then
		UNBEKANNT_SEIT=$((UNBEKANNT_SEIT + 1))
	else
		UNBEKANNT_SEIT=0
		FREIGABE_GEMELDET=0
	fi

	ZIEL=""
	if [ -z "${GELESEN}" ]; then
		# Datei fehlt, ist leer oder unbrauchbar geworden — neu anlegen.
		# Ist der Schirm gerade unlesbar, gilt "On": ein Kind, das nichts
		# mehr antippen kann, ist schlimmer als ein Schirm, der als an gilt.
		if [ "${SCHIRM}" = "aus" ]; then
			ZIEL="Off"
		else
			ZIEL="On"
		fi
	elif [ "${SCHIRM}" = "aus" ] && [ "${GELESEN}" != "Off" ]; then
		ZIEL="Off"
	elif [ "${SCHIRM}" = "an" ] && [ "${GELESEN}" != "On" ]; then
		ZIEL="On"
	elif [ "${UNBEKANNT_SEIT}" -ge "${UNBEKANNT_GRENZE}" ] && [ "${GELESEN}" = "Off" ]; then
		# AUSSPERRSCHUTZ. Bei "unbekannt" wird sonst nichts geaendert — das
		# ist richtig, solange "On" dasteht. Steht aber "Off" da, sperrt die
		# Oberflaeche jede Beruehrung aus, und ohne Messwert kommt der Wert
		# nie wieder zurueck: die Box waere dauerhaft taub, ohne ein Zeichen.
		# Dieselbe Abwaegung wie oben beim fehlenden File, nur eine halbe
		# Minute spaeter: lieber ein Schirm, der faelschlich als an gilt,
		# als ein Kind, das nichts mehr antippen kann.
		ZIEL="On"
		if [ "${FREIGABE_GEMELDET}" != 1 ]; then
			melden "Seit ${UNBEKANNT_SEIT} Durchlaeufen kein Messwert und monitor.json steht auf 'Off' — die Box wuerde jede Beruehrung ausschliessen. Wird auf 'On' gesetzt, damit sie bedienbar bleibt."
			FREIGABE_GEMELDET=1
		fi
	fi

	if [ -n "${ZIEL}" ]; then
		if monitor_schreiben "${ZIEL}"; then
			if [ "${SCHREIBFEHLER}" != 0 ]; then
				melden "monitor.json laesst sich wieder schreiben."
				SCHREIBFEHLER=0
			fi
		else
			SCHREIBFEHLER=$((SCHREIBFEHLER + 1))
			if [ "${SCHREIBFEHLER}" = 1 ]; then
				melden "monitor.json laesst sich nicht schreiben: ${SCHREIBGRUND:-kein Grund genannt}. Weitere Versuche werden erst wieder gemeldet, wenn es geklappt hat."
			fi
		fi
	fi

	sleep 1
done
