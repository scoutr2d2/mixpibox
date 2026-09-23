#!/bin/bash
# dhcp-schneller.sh — dhclient soll direkt nach der WLAN-Assoziation nochmal fragen.
#
# WOZU
#   Der Kiosk startet erst, wenn das WLAN eine Adresse hat. Die Kette dahinter
#   ist die normale Debian-Ordnung und nichts MuPiBox-Eigenes:
#
#       ifup@wlan0.service -> network.target -> systemd-user-sessions.service
#                          -> getty@tty1 -> Autologin -> chromium-autostart.sh
#
#   Nur: die Seite, die der Kiosk zeigt, liegt unter http://localhost:8200 und
#   braucht gar keine Adresse. Gewartet wird also auf nichts.
#
# DAS GEMESSENE (Box .169, Pi 5 / DietPi Trixie, 04.08.2026,
# tools/bootkette-schau.py — jede Zeile aus `journalctl -b -o short-monotonic`):
#
#       [ 4,120]  DHCPDISCOVER auf wlan0, interval 8     <- ins Leere: nicht assoziiert
#       [ 6,595]  wlan0: Associated with dc:39:6f:xx:xx:xx
#       [ 6,609]  CTRL-EVENT-CONNECTED                   <- ab hier ginge alles
#       [11,560]  DHCPDISCOVER, interval 14              <- erst jetzt wieder gefragt
#       [11,675]  DHCPOFFER von 192.168.178.1            <- Antwort nach 115 ms
#       [11,792]  bound
#       [11,809]  ifup@wlan0 aktiv
#       [11,896]  getty@tty1 aktiv (+0,087 s)            <- jetzt erst faengt der Kiosk an
#
#   ZURUECKHOLBAR: 11,560 - 6,595 = 4,96 s Warten auf NICHTS. Das Netz stand,
#   der Router antwortete in 115 ms, und dhclient sass sein Rueckfall-Intervall
#   ab, weil sein ERSTER Antrag 2,5 s VOR der Assoziation rausging.
#
#   Realistisch zurueckgeholt werden davon 3 bis 4 s (nach der Assoziation
#   vergeht noch bis zu `backoff-cutoff`). Wichtiger als die Sekunden ist, dass
#   die STREUUNG verschwindet: ueber vier Kaltstarts meldete systemd-analyze
#   6,9 s bis 14,3 s, und diese Spanne war fast vollstaendig ifup@wlan0
#   (5,5 bis 10,7 s).
#
# DIE DREI ZEILEN SIND NICHT NEU. Dieselbe Aenderung wurde am 29.07.2026 am
# Pi 4 gemessen: Boot 31,8 s -> 13,2 s, ifup@wlan0 23,1 s -> 5,0 s (Wiki:
# mupi-boot-32s-auf-13s). Sie lebte seither NUR im remote-step-installer; eine
# frisch aus diesem Repo aufgesetzte Box hatte sie nicht.
#
# WARUM ANHAENGEN UND NICHT ERSETZEN — DIE FALLE
#   /etc/dhcp/dhclient.conf ist NICHT leer. Darin stehen die
#   `option rfc3442-classless-static-routes`-Definition und die `request`-Liste
#   (domain-name-servers, ntp-servers, …). Wer die Datei durch eine Vorlage mit
#   drei Zeilen ERSETZT, nimmt der Box ihre DNS-Server — und sucht den Fehler
#   danach ueberall, nur nicht hier. Deshalb: Sicherung anlegen, Block mit
#   Marken anhaengen, beim Zuruecknehmen genau diesen Block wieder entfernen.
#
# WARUM DIESE DREI WERTE
#   initial-interval 1   erster Nachschlag nach ~1 s statt nach ~4-8 s
#   backoff-cutoff   2   das Intervall waechst nie ueber 2 s (Vorgabe: 16 s)
#   retry            5   naechster Anlauf nach 5 s statt nach 5 MINUTEN
#   Alle drei machen dhclient HARTNAECKIGER, nicht ungeduldiger. Eine Box, die
#   keine Adresse bekommt, bekommt danach auch keine — sie fragt nur oefter.
#
# RUECKWEG — und der ist der Grund, warum das hier ein Skript ist und kein sed:
#       sudo /usr/local/bin/mupibox/dhcp-schneller.sh --zuruecknehmen
#   Das stellt den Zustand von vor dem Einbau her (Sicherung
#   /etc/dhcp/dhclient.conf.vor-mupibox) und ruft sync(1) — eine
#   Wiederherstellung, die nur im Zwischenspeicher steht, war schon einmal der
#   Grund, warum die Box beim naechsten Start wieder die alte Fassung hatte.
#   Wirksam wird beides erst beim naechsten `ifup wlan0` bzw. Neustart; die
#   laufende Verbindung bleibt unberuehrt.
#
# AUFRUF
#       dhcp-schneller.sh --pruefen         steht der Block drin? (0 = ja)
#       dhcp-schneller.sh --einbauen        anhaengen (mehrfach gefahrlos)
#       dhcp-schneller.sh --zuruecknehmen   Sicherung zurueck
#
# NACHMESSEN (nach dem naechsten Neustart, vom Arbeitsplatz aus):
#       tools/bootkette-schau.py 192.168.178.169
#       tools/grundmessung.py    192.168.178.169 --kalt

set -eu

DATEI="${DHCLIENT_CONF:-/etc/dhcp/dhclient.conf}"
SICHERUNG="${DATEI}.vor-mupibox"
ANFANG="# ---- MuPiBox: schneller Rueckfall nach der WLAN-Assoziation ----"
ENDE="# ---- MuPiBox Ende ----"

meldung() { echo "dhcp-schneller: $*"; }

pruefen() {
	[ -f "${DATEI}" ] || { meldung "${DATEI} gibt es nicht."; return 2; }
	if grep -qF "${ANFANG}" "${DATEI}"; then
		meldung "Block steht in ${DATEI}."
		return 0
	fi
	meldung "Block steht NICHT in ${DATEI}."
	return 1
}

einbauen() {
	if [ ! -f "${DATEI}" ]; then
		meldung "${DATEI} gibt es nicht — nichts getan."
		return 2
	fi
	if grep -qF "${ANFANG}" "${DATEI}"; then
		meldung "Block steht schon drin — nichts getan."
		return 0
	fi
	# Die Sicherung wird NUR EINMAL angelegt. Wer zweimal einbaut und dazwischen
	# von Hand etwas aendert, soll beim Zuruecknehmen den URSPRUNG bekommen und
	# nicht einen Zwischenstand mit halbem Block darin.
	if [ ! -f "${SICHERUNG}" ]; then
		cp -p "${DATEI}" "${SICHERUNG}"
		meldung "Sicherung angelegt: ${SICHERUNG}"
	fi
	# ZEILENUMBRUCH SICHERSTELLEN, ABER KEINE LEERZEILE ANHAENGEN.
	# Der erste Entwurf schrieb `echo ""` vor die Anfangsmarke — huebscher zu
	# lesen, aber der Rueckweg OHNE Sicherung bekam sie nicht wieder weg (awk
	# entfernt nur zwischen den Marken). Der Test hat genau das gefunden: die
	# Datei war nach dem Zuruecknehmen um eine Leerzeile laenger als vorher.
	# Ein Rueckweg, der "fast" den Ausgangszustand herstellt, ist keiner.
	# Angehaengt wird ein Umbruch daher nur, wenn die Datei ohne einen endet —
	# sonst klebte die Marke an der letzten Zeile fest.
	if [ -n "$(tail -c 1 "${DATEI}")" ]; then
		echo "" >>"${DATEI}"
	fi
	{
		echo "${ANFANG}"
		echo "# Gemessen 04.08.2026 an Box .169: zwischen 'CTRL-EVENT-CONNECTED' (6,6 s)"
		echo "# und dem naechsten DHCPDISCOVER (11,6 s) lagen 4,96 s Warten auf nichts."
		echo "# Der Router antwortete danach in 115 ms. Am Pi 4 brachte dieselbe"
		echo "# Aenderung 31,8 s -> 13,2 s Bootzeit (Wiki: mupi-boot-32s-auf-13s)."
		echo "# Zuruecknehmen: /usr/local/bin/mupibox/dhcp-schneller.sh --zuruecknehmen"
		echo "initial-interval 1;"
		echo "backoff-cutoff 2;"
		echo "retry 5;"
		echo "${ENDE}"
	} >>"${DATEI}"
	sync
	meldung "Block angehaengt. Wirksam beim naechsten ifup/Neustart."
	return 0
}

zuruecknehmen() {
	if [ -f "${SICHERUNG}" ]; then
		cp -p "${SICHERUNG}" "${DATEI}"
		rm -f "${SICHERUNG}"
		sync
		meldung "Sicherung zurueckgespielt, ${DATEI} ist wieder wie vorher."
		return 0
	fi
	if ! grep -qF "${ANFANG}" "${DATEI}" 2>/dev/null; then
		meldung "Weder Sicherung noch Block gefunden — nichts zu tun."
		return 0
	fi
	# Keine Sicherung, aber der Block ist da: dann eben den Block herausnehmen.
	# awk statt sed, weil die Marken Bindestriche enthalten und ein
	# Adressbereich in sed daran haengenbleibt.
	awk -v a="${ANFANG}" -v e="${ENDE}" '
		$0 == a { drin = 1; next }
		drin && $0 == e { drin = 0; next }
		!drin { print }
	' "${DATEI}" >"${DATEI}.neu"
	mv "${DATEI}.neu" "${DATEI}"
	sync
	meldung "Block entfernt (es gab keine Sicherung)."
	return 0
}

case "${1:-}" in
	--pruefen) pruefen ;;
	--einbauen) einbauen ;;
	--zuruecknehmen) zuruecknehmen ;;
	*)
		echo "Aufruf: $0 --pruefen | --einbauen | --zuruecknehmen" >&2
		exit 64
		;;
esac
