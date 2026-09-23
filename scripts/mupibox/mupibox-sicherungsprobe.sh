#!/bin/bash
# Die Probe des Rueckwegs — REGELMAESSIG, nicht nur einmal (BACKLOG E29/B3).
#
# WOZU ES DIESE DATEI GIBT
# B3 verlangt zwei Dinge, und nur eines davon war da. Der Rueckweg selbst gibt
# es: `mupibox-sicherung.py --probe` oeffnet den juengsten Stand, spielt ihn in
# ein Wegwerf-Verzeichnis zurueck und vergleicht Byte fuer Byte. Was fehlte,
# ist der zweite Halbsatz aus dem BACKLOG:
#
#     „… und eine Probe, die ihn REGELMAESSIG faehrt — sonst merkt man den
#      Fehler an dem Tag, an dem er nicht mehr zu beheben ist."
#
# Genau das ist die Eigenart dieses Fehlers: eine Sicherung, die nicht mehr
# zurueckspielbar ist, sieht bis zum Ernstfall aus wie eine gute. Sie liegt da,
# sie hat die richtige Groesse, das Datum stimmt. Erst wer sie braucht, merkt
# es — und dann ist es zu spaet. Deshalb faehrt mupibox-sicherungsprobe.timer
# den Rueckweg woechentlich, ohne dass jemand daran denken muss.
#
# WARUM DAS URTEIL AUF DIE KARTE GEHT
# Ein Ergebnis, das nur im Journal steht, braucht SSH — und SSH ist genau das,
# was im Ernstfall fehlt (derselbe Grund, aus dem der Rueckweg selbst ohne SSH
# auskommt). Also landet das Urteil als `PROBE.txt` im Ordner
# `mupibox-sicherung/` der FAT-Partition, neben den Staenden und der
# LIESMICH.txt. Wer die Karte in einen beliebigen Rechner steckt, sieht in der
# ERSTEN ZEILE, ob der Rueckweg zuletzt gehalten hat.
#
# `--auf-karte` raeumt in diesem Ordner nur `*.tar.gz` weg; PROBE.txt bleibt
# also liegen und wird von jedem Lauf ueberschrieben.
#
# WAS DIE PROBE NICHT ANFASST
# Nichts. Sie schreibt ausschliesslich in ein Wegwerf-Verzeichnis unter /tmp
# (`tempfile.TemporaryDirectory` im Python-Teil), in die Urteilsdatei und auf
# die Karte. Weder /etc/mupibox noch server/config werden beruehrt — eine
# Probe, die die Box veraendert, waere ein neuer Weg, Daten zu verlieren.
#
# WARUM ES ZWEI AUFRUFE GIBT UND NICHT EINEN
# Die Probe laeuft als `dietpi` — sie liest nur Staende und schreibt nach
# /tmp. Die FAT-Partition gehoert aber root. Das Kopieren ist deshalb ein
# EIGENER Aufruf, den die Unit mit `+` als root nachschiebt. Und er haengt an
# `ExecStopPost=`, nicht an einem zweiten `ExecStart=`: faellt die Probe
# durch, bricht systemd die ExecStart-Kette ab — das Urteil käme dann
# ausgerechnet im Fehlerfall NICHT auf die Karte, also genau dann nicht, wenn
# es jemand braucht. ExecStopPost laeuft so oder so.
#
# AUFRUF
#     mupibox-sicherungsprobe.sh              # fahren, Urteil schreiben
#     mupibox-sicherungsprobe.sh --auf-karte  # nur das Urteil auf die Karte
#     mupibox-sicherungsprobe.sh --selbsttest # ohne Box, ohne echte Staende
#
# RUECKGABE: 0 bestanden, 1 nicht bestanden (die Unit steht dann auf „failed",
# und das ist gewollt — ein stiller Fehlschlag waere das Problem, nicht die
# Loesung).

set -u

# Diese drei stehen als Variable da, damit der Selbsttest sie umbiegen kann.
# Im Betrieb setzt sie NIEMAND: die Unit uebergibt keine Umgebung, und die
# Datei gehoert root. Wer sie doch setzt, weiss, was er tut.
SICHERUNG="${MUPI_SICHERUNG:-/usr/local/bin/mupibox/mupibox-sicherung.py}"
URTEIL="${MUPI_PROBE_URTEIL:-/home/dietpi/.mupibox/sicherungen/letzte-probe.txt}"
KARTE_ORDNER="${MUPI_KARTE_ORDNER:-/boot/firmware/mupibox-sicherung}"

kopf() {
	echo "MuPiBox — Probe des Rueckwegs (BACKLOG E29/B3)"
	echo
	echo "Diese Datei sagt, ob sich die juengste Sicherung zuletzt WIRKLICH"
	echo "zurueckspielen liess. Sie entsteht selbsttaetig einmal pro Woche."
	echo "Steht oben BESTANDEN, ist der Rueckweg gefahren worden und hat"
	echo "gehalten. Steht dort NICHT BESTANDEN, ist die Sicherung nicht mehr"
	echo "das, wofuer man sie haelt — dann bitte nachsehen, BEVOR man sie"
	echo "braucht."
	echo
	echo "Wie man von Hand zurueckspielt, steht in LIESMICH.txt daneben."
	echo "------------------------------------------------------------------"
}

haupt() {
	local aus rc zeit
	zeit="$(date -Is 2>/dev/null || date)"

	if [ ! -x "${SICHERUNG}" ]; then
		# Ohne das Werkzeug gibt es keine Probe — und das ist ein Befund,
		# kein Grund zu schweigen.
		aus="${SICHERUNG} gibt es nicht oder es ist nicht ausfuehrbar."
		rc=1
	else
		aus="$("${SICHERUNG}" --probe 2>&1)"
		rc=$?
	fi

	local urteilszeile
	if [ "${rc}" -eq 0 ]; then
		urteilszeile="URTEIL: BESTANDEN   (${zeit})"
	else
		urteilszeile="URTEIL: NICHT BESTANDEN   (${zeit})   -- siehe unten"
	fi

	# Danebenlegen und umbenennen ([[mupi-konfiguration-schreiben]]): eine
	# halb geschriebene Urteilsdatei behauptete sonst irgendetwas.
	local verz neben
	verz="$(dirname "${URTEIL}")"
	mkdir -p "${verz}" 2>/dev/null
	neben="${URTEIL}.neu"
	{
		echo "${urteilszeile}"
		echo
		kopf
		echo "${aus}"
	} > "${neben}" 2>/dev/null || {
		echo "${urteilszeile}"
		echo "${aus}"
		echo "(Urteil liess sich nicht nach ${URTEIL} schreiben)"
		return "${rc}"
	}
	sync 2>/dev/null
	mv -f "${neben}" "${URTEIL}"

	# Wenn dieser Lauf die Karte selbst beschreiben darf (von Hand als root),
	# dann gleich hier. Im Dienst kann er es nicht — dort schiebt
	# ExecStopPost= denselben Aufruf als root nach.
	auf_karte

	echo "${urteilszeile}"
	echo "${aus}"
	return "${rc}"
}

# Das Urteil auf die FAT-Partition legen. Eigener Aufruf, weil dafuer root
# noetig ist und die Probe selbst als dietpi laufen soll.
#
# Der Ordner wird hier NICHT angelegt: gibt es ihn nicht, lag auf dieser Karte
# noch nie eine Sicherung, und dann ist ein Urteil ueber Staende, die dort
# fehlen, nur verwirrend. Ihn anzulegen ist Sache von
# `mupibox-sicherung.py --auf-karte`.
auf_karte() {
	[ -f "${URTEIL}" ] || return 0
	[ -d "${KARTE_ORDNER}" ] || return 0
	[ -w "${KARTE_ORDNER}" ] || return 0
	# Danebenlegen und umbenennen — auch auf der Karte, und gerade dort:
	# eine FAT-Partition, der beim Schreiben der Strom ausgeht, ist der Fall,
	# fuer den es diesen ganzen Rueckweg gibt ([[mupi-stromausfall-bootdateien]]).
	cp -f "${URTEIL}" "${KARTE_ORDNER}/PROBE.txt.neu" 2>/dev/null || return 0
	sync 2>/dev/null
	mv -f "${KARTE_ORDNER}/PROBE.txt.neu" "${KARTE_ORDNER}/PROBE.txt"
	sync 2>/dev/null
	return 0
}

# ── Selbsttest ─────────────────────────────────────────────────────────────
# Kein Zugriff auf die Box, keine echten Staende: die Probe wird durch ein
# Stellvertreter-Skript ersetzt, das sich so verhaelt, wie sich
# `mupibox-sicherung.py --probe` verhalten kann.
selbsttest() {
	local gut=0 schlecht=0
	# tmp ist mit Absicht NICHT `local`: der EXIT-Trap laeuft, wenn die
	# Funktion laengst zurueck ist. Waere tmp lokal, faende er unter `set -u`
	# eine nicht gesetzte Variable — und der Selbsttest endete mit einer
	# Fehlermeldung, obwohl alles bestanden hat.
	tmp="$(mktemp -d -t mupibox-probe-selbsttest-XXXXXX)"
	trap 'rm -rf "${tmp}"' EXIT

	pruefe() { # <text> <bedingung-als-befehl…>
		local text="$1"; shift
		if "$@" >/dev/null 2>&1; then
			echo "  OK    ${text}"; gut=$((gut + 1))
		else
			echo "  FEHL  ${text}"; schlecht=$((schlecht + 1))
		fi
	}

	stellvertreter() { # <rueckgabe> <ausgabe>
		cat > "${tmp}/sicherung.py" <<-EOF
			#!/bin/sh
			echo "$2"
			exit $1
		EOF
		chmod +x "${tmp}/sicherung.py"
	}

	fahren() {
		MUPI_SICHERUNG="${tmp}/sicherung.py" \
		MUPI_PROBE_URTEIL="${tmp}/urteil.txt" \
		MUPI_KARTE_ORDNER="${tmp}/karte" \
		"$0" > "${tmp}/ausgabe.txt" 2>&1
		echo $? > "${tmp}/rc"
	}

	echo "Probe des Rueckwegs — Selbsttest"
	echo

	# 1. Bestanden
	stellvertreter 0 "3 von 3 Dateien deckungsgleich zurueckgespielt"
	fahren
	pruefe "bestanden -> Rueckgabe 0"            grep -qx 0 "${tmp}/rc"
	pruefe "bestanden -> URTEIL in der 1. Zeile" \
		bash -c "head -1 '${tmp}/urteil.txt' | grep -q '^URTEIL: BESTANDEN'"
	pruefe "die Ausgabe der Probe steht drin"    \
		grep -q "deckungsgleich" "${tmp}/urteil.txt"
	pruefe "die Anleitung steht drin"            \
		grep -q "LIESMICH.txt" "${tmp}/urteil.txt"
	pruefe "kein .neu bleibt liegen"             \
		bash -c "! ls '${tmp}'/urteil.txt.neu >/dev/null 2>&1"

	# 2. Nicht bestanden — der Fall, auf den es ankommt
	stellvertreter 1 "  ANDERS  server/config/data.json"
	fahren
	pruefe "durchgefallen -> Rueckgabe 1"        grep -qx 1 "${tmp}/rc"
	pruefe "durchgefallen -> NICHT BESTANDEN oben" \
		bash -c "head -1 '${tmp}/urteil.txt' | grep -q '^URTEIL: NICHT BESTANDEN'"
	pruefe "der Grund steht dabei"               \
		grep -q "ANDERS" "${tmp}/urteil.txt"

	# 3. Ein durchgefallener Lauf ueberschreibt den bestandenen — sonst
	#    glaubte man dem alten Urteil.
	stellvertreter 0 "alles gut"
	fahren
	pruefe "neuer Lauf ueberschreibt das alte Urteil" \
		bash -c "! grep -q 'ANDERS' '${tmp}/urteil.txt'"

	# 4. Die Karte
	mkdir -p "${tmp}/karte"
	stellvertreter 0 "alles gut"
	fahren
	pruefe "Urteil landet als PROBE.txt auf der Karte" \
		test -f "${tmp}/karte/PROBE.txt"
	pruefe "PROBE.txt sagt dasselbe"             \
		bash -c "cmp -s '${tmp}/urteil.txt' '${tmp}/karte/PROBE.txt'"
	pruefe "kein PROBE.txt.neu bleibt liegen"    \
		bash -c "! ls '${tmp}/karte'/PROBE.txt.neu >/dev/null 2>&1"

	# 5. Ohne Kartenordner faellt nichts durch — eine Box ohne FAT-Partition
	#    ist keine kaputte Sicherung.
	rm -rf "${tmp}/karte"
	stellvertreter 0 "alles gut"
	fahren
	pruefe "ohne Kartenordner trotzdem Rueckgabe 0" grep -qx 0 "${tmp}/rc"
	pruefe "ohne Kartenordner wird die Karte nicht angelegt" \
		bash -c "! test -d '${tmp}/karte'"

	# 5b. DER FALL, AUF DEN ES ANKOMMT: die Probe faellt durch, und das
	#     Urteil muss TROTZDEM auf die Karte. Genau hier bricht systemd die
	#     ExecStart-Kette ab — deshalb haengt das Kopieren an ExecStopPost=
	#     und ist ein eigener Aufruf, der auch nach einem Fehlschlag laeuft.
	mkdir -p "${tmp}/karte"
	stellvertreter 1 "  ANDERS  server/config/data.json"
	fahren
	pruefe "durchgefallen -> Rueckgabe 1 (Unit steht auf failed)" \
		grep -qx 1 "${tmp}/rc"
	rm -f "${tmp}/karte/PROBE.txt"
	MUPI_SICHERUNG="${tmp}/sicherung.py" \
	MUPI_PROBE_URTEIL="${tmp}/urteil.txt" \
	MUPI_KARTE_ORDNER="${tmp}/karte" \
	"$0" --auf-karte
	pruefe "--auf-karte laeuft NACH einem Fehlschlag und gibt 0" test $? -eq 0
	pruefe "und das durchgefallene Urteil liegt auf der Karte" \
		bash -c "head -1 '${tmp}/karte/PROBE.txt' | grep -q 'NICHT BESTANDEN'"

	# 5c. --auf-karte ohne Kartenordner darf nicht durchfallen: sonst stuende
	#     die Unit auf „failed", obwohl die Probe selbst bestanden hat.
	rm -rf "${tmp}/karte"
	MUPI_SICHERUNG="${tmp}/sicherung.py" \
	MUPI_PROBE_URTEIL="${tmp}/urteil.txt" \
	MUPI_KARTE_ORDNER="${tmp}/karte" \
	"$0" --auf-karte
	pruefe "--auf-karte ohne Kartenordner -> 0, und legt ihn nicht an" \
		bash -c "test $? -eq 0 && ! test -d '${tmp}/karte'"

	# 5d. --auf-karte ohne Urteilsdatei erfindet keines.
	mkdir -p "${tmp}/karte"
	MUPI_SICHERUNG="${tmp}/sicherung.py" \
	MUPI_PROBE_URTEIL="${tmp}/gibtsnicht.txt" \
	MUPI_KARTE_ORDNER="${tmp}/karte" \
	"$0" --auf-karte
	pruefe "--auf-karte ohne Urteil -> 0 und KEIN PROBE.txt" \
		bash -c "test $? -eq 0 && ! test -f '${tmp}/karte/PROBE.txt'"
	rm -rf "${tmp}/karte"

	# 6. Fehlt das Werkzeug, ist das ein Befund und kein stiller Erfolg.
	rm -f "${tmp}/sicherung.py"
	fahren
	pruefe "fehlendes Werkzeug -> Rueckgabe 1"   grep -qx 1 "${tmp}/rc"
	pruefe "fehlendes Werkzeug wird benannt"     \
		grep -q "nicht ausfuehrbar" "${tmp}/urteil.txt"

	# 7. Ist die Urteilsdatei nicht schreibbar, faellt die Probe nicht
	#    deswegen durch — das Ergebnis der Probe zaehlt, nicht der Ablageort.
	stellvertreter 0 "alles gut"
	MUPI_SICHERUNG="${tmp}/sicherung.py" \
	MUPI_PROBE_URTEIL="/nicht/vorhanden/urteil.txt" \
	MUPI_KARTE_ORDNER="${tmp}/karte" \
	"$0" > "${tmp}/ausgabe.txt" 2>&1
	pruefe "unschreibbarer Ablageort -> trotzdem Rueckgabe 0" test $? -eq 0
	pruefe "und es steht in der Ausgabe"         \
		grep -q "liess sich nicht" "${tmp}/ausgabe.txt"

	echo
	echo "Sicherungsprobe: ${gut} bestanden, ${schlecht} fehlgeschlagen"
	[ "${schlecht}" -eq 0 ]
}

case "${1:-}" in
	--selbsttest) selbsttest ;;
	--auf-karte)  auf_karte ;;
	"")           haupt ;;
	*)            echo "unbekannt: $1 — nur --auf-karte, --selbsttest oder" \
	                   "ohne Argument" >&2
	              exit 2 ;;
esac
