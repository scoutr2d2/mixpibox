#!/bin/bash
#
# Haengt das Fehlerbild als Auffangloesung unter die Dienste (BACKLOG E11c/S3).
#
# WOZU
# Wenn ein Dienst der Box aufgibt, merkt systemd das sofort und schreibt es ins
# Protokoll. Vor der Box steht dann trotzdem jemand vor einem schwarzen Schirm,
# denn das Protokoll braucht SSH — und wer SSH hat, hat das Problem ohnehin
# schon halb geloest. `OnFailure=` ist die eine Stelle, an der systemd bereit
# ist, uns zu sagen "es ist schiefgegangen", bevor irgendjemand fragt.
#
# WARUM EIN SKRIPT UND KEINE ZEILE IN JEDER UNIT
# Der urspruengliche Grund war: die wichtigsten Units liegen gar nicht in
# diesem Repo. Am 04.08.2026 an Box .169 nachgesehen liefen
# `mupibox-server.service` und `mupibox-player.service` beide aus dem
# remote-step-installer, waehrend dieses Repo dieselbe Anwendung ueber pm2
# startete und fuer sie ueberhaupt keine Unit hatte.
#
# DIESE HAELFTE GILT SEIT DEM 14.08.2026 NICHT MEHR: beide Units liegen jetzt
# in config/services/, und autosetup.sh legt sie aus (pm2 ist raus).
#
# DAS SKRIPT BLEIBT TROTZDEM RICHTIG, aus dem zweiten Grund, der nie vom
# Ablageort abhing: ein Zusatzstueck wird NEBEN die Unit gelegt, egal WER sie
# geliefert hat. Boxen aus dem remote-step-installer bekommen ihre Units
# weiterhin von dort — und auf denen wuerde eine `OnFailure=`-Zeile, die nur
# in unserer Fassung der Datei steht, beim naechsten Rezeptlauf ueberschrieben.
#
# Ein Zusatzstueck (drop-in) loest das: es wird NEBEN die Unit gelegt, egal wer
# sie geliefert hat, und es verschwindet nicht beim naechsten Update dieser
# Unit.
#
# WAS ES NICHT TUT
# Es legt keine Unit an und schaltet keine ein. Existiert eine Unit nicht, wird
# sie uebersprungen und genannt — eine Box ohne MuPiHAT soll keinen Eintrag
# fuer einen Dienst bekommen, den sie nicht hat.
#
# DAS FEHLERBILD SELBST HAELT SICH ZURUECK: laeuft Chromium, malt es nicht.
# Ein Dienst kann Stunden nach dem Start scheitern; ein Bild ueber die laufende
# Oberflaeche zu legen waere aus einem kleinen Fehler ein grosser gemacht.
#
# AUFRUF
#   sudo /usr/local/bin/mupibox/fehlerbild-anhaengen.sh
#   sudo /usr/local/bin/mupibox/fehlerbild-anhaengen.sh --zuruecknehmen
#   sudo /usr/local/bin/mupibox/fehlerbild-anhaengen.sh --pruefen

set -u

ZUSATZ="50-mupibox-fehlerbild.conf"
DROPIN_WURZEL="/etc/systemd/system"

# WELCHE DIENSTE. Zwei Sorten, und beide muessen hier stehen:
#   * aus diesem Repo (config/services/)
#   * aus dem remote-step-installer — die laufen auf JEDER Box im Haus
# Nicht dabei sind Dienste, deren Ausfall niemand vor der Box merkt
# (mupi_telegram, dietpi-dashboard, VNC): ein Fehlerbild dafuer waere ein
# Fehlalarm, und der naechste echte faellt dann nicht mehr auf.
DIENSTE=(
	mupibox-server.service
	mupibox-player.service
	mupi_check_internet.service
	librespot.service
	pulseaudio.service
	mupi_wifi.service
)

modus="einbauen"
for a in "$@"; do
	case "$a" in
		--zuruecknehmen) modus="zuruecknehmen" ;;
		--pruefen) modus="pruefen" ;;
		-h|--help) sed -n '2,40p' "$0"; exit 0 ;;
	esac
done

fehlt=0
gemacht=0
# WIE VIELE DER ERWARTETEN DIENSTE ES UEBERHAUPT GIBT.
#
# Gefunden beim Gegenlesen am 04.08.2026: ohne diesen Zaehler meldete
# `--pruefen` "Jeder vorhandene Dienst hat sein Fehlerbild" und gab 0 zurueck,
# obwohl KEIN EINZIGER der sechs Dienste existierte — am Entwicklungsrechner
# nachgestellt, dort sind alle sechs weg. Eine Pruefung, die gruen wird, weil
# sie nichts zu pruefen fand, ist genau die Sorte Attrappe, die durch
# WEGLASSEN luegt: sie sagt "in Ordnung" fuer den Zustand "gar nichts da".
gefunden=0

for unit in "${DIENSTE[@]}"; do
	if ! systemctl cat "${unit}" >/dev/null 2>&1; then
		echo "  ${unit}: gibt es auf dieser Box nicht — uebersprungen"
		continue
	fi
	gefunden=$((gefunden + 1))
	verzeichnis="${DROPIN_WURZEL}/${unit}.d"
	datei="${verzeichnis}/${ZUSATZ}"
	case "${modus}" in
		pruefen)
			if [ -f "${datei}" ]; then
				echo "  ${unit}: Fehlerbild haengt dran"
			else
				echo "  ${unit}: OHNE Fehlerbild"
				fehlt=$((fehlt + 1))
			fi
			;;
		zuruecknehmen)
			rm -f "${datei}"
			rmdir "${verzeichnis}" 2>/dev/null
			gemacht=$((gemacht + 1))
			;;
		einbauen)
			mkdir -p "${verzeichnis}" || continue
			# %n ist der volle Name der GESCHEITERTEN Unit. Er wird zum
			# Instanznamen der Vorlage, damit auf dem Bild steht, WAS ausgefallen
			# ist — und nicht nur, DASS etwas ausgefallen ist.
			cat > "${datei}" <<-'ENDE'
			# Von /usr/local/bin/mupibox/fehlerbild-anhaengen.sh angelegt
			# (BACKLOG E11c/S3). Zuruecknehmen: --zuruecknehmen.
			[Unit]
			OnFailure=mupibox-fehlerbild@%n.service
			ENDE
			gemacht=$((gemacht + 1))
			;;
	esac
done

case "${modus}" in
	pruefen)
		if [ "${gefunden}" -eq 0 ]; then
			echo "KEINER der ${#DIENSTE[@]} erwarteten Dienste existiert hier — das ist keine MuPiBox, oder die Namen stimmen nicht mehr"
			exit 1
		fi
		if [ "${fehlt}" -gt 0 ]; then
			echo "${fehlt} von ${gefunden} vorhandenen Dienst(en) ohne Fehlerbild"
			exit 1
		fi
		echo "Alle ${gefunden} vorhandenen Dienste haben ihr Fehlerbild"
		;;
	*)
		systemctl daemon-reload
		echo "${gemacht} Dienst(e) bearbeitet (${modus})"
		;;
esac
exit 0
