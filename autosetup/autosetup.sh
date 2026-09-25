#!/bin/bash
#
# Script for MuPiBox Autosetup
# Start with: cd; curl https://raw.githubusercontent.com/splitti/MuPiBox/main/autosetup/autosetup-stable.sh | bash

RELEASE="stable"

# --- Self-contained / offline source (fork-free SD install) ------------------
# When MUPI_LOCAL_SRC points at a baked release tarball (MuPiBox-<ver>.tgz|.zip)
# or an already-extracted repo dir, autosetup uses THAT as the MuPiBox source
# instead of downloading a release from GitHub — so a boot SD can carry this
# exact code with no fork and no clone (distro/apt/node deps are still fetched
# online as usual). Set by scripts/make-boot-sd.sh via the DietPi first-boot
# script; empty = the normal upstream download path below runs unchanged.
MUPI_LOCAL_SRC="${MUPI_LOCAL_SRC:-}"
MUPI_VERSION="${MUPI_VERSION:-}"

LOG="/tmp/autosetup.log"
BOOT_DIR="/boot"
BOOT_CONFIG="/boot/config.txt"
BOOT_CMDLINE="/boot/cmdline.txt"

if [ -f "/boot/firmware/config.txt" ]; then
  BOOT_DIR="/boot/firmware"
  BOOT_CONFIG="/boot/firmware/config.txt"
fi

if [ -f "/boot/firmware/cmdline.txt" ]; then
  BOOT_CMDLINE="/boot/firmware/cmdline.txt"
fi
VER_JSON="/tmp/version.json"
CONFIG="/etc/mupibox/mupiboxconfig.json"
STEP=0

exec 3>${LOG}

OS=$(grep -E '^(VERSION_CODENAME)=' /etc/os-release)
OS=${OS:17}
ARCH=$(uname -m)
USER=$(/usr/bin/whoami)
RASPPI=$(/usr/bin/cat /sys/firmware/devicetree/base/model 2>/dev/null | tr -d '\0')

autosetup="$(grep autosetup /home/dietpi/.bashrc 2>/dev/null)"
if (( ${#autosetup} > 0 )); then
  head -n -2 /home/dietpi/.bashrc > /tmp/.bashrc && mv /tmp/.bashrc /home/dietpi/.bashrc
fi

rm -Rf /home/dietpi/mupibox.zip /home/dietpi/MuPiBox-* >&3 2>&3

{
	# TONSTAPEL: PIPEWIRE, NICHT PULSEAUDIO (BACKLOG E12/X6).
	#
	# Hier stand `pulseaudio-module-bluetooth`, und dieses eine Paket zog den
	# ganzen PulseAudio-Dienst mit auf die Karte. Das passte zu nichts:
	#   * config/services/librespot.service ist ausdruecklich fuer PipeWire
	#     geschrieben (User=dietpi, XDG_RUNTIME_DIR=/run/user/1000, wartet in
	#     ExecStartPre auf `pactl list short sinks`). Auf einer frischen Karte
	#     mit SYSTEM-PulseAudio gibt es kein /run/user/1000/pulse — die
	#     Warteschleife lief 20 s ins Leere und endete trotzdem mit exit 0.
	#   * Die laufende Box (192.168.178.169) faehrt seit dem 27.07.2026
	#     PipeWire 1.4.2 als BENUTZERdienst; PulseAudio ist dort von Hand
	#     entfernt worden (dpkg-Zustand "rc"). Am 04.08.2026 nur lesend
	#     nachgemessen.
	# Eine frische Karte bekam also einen Tonserver, fuer den die eigene
	# librespot-Unit nicht geschrieben war.
	#
	# `pulseaudio-utils` BLEIBT — daher kommt `pactl`, und genau darauf warten
	# librespot.service und chromium-autostart.sh. Es zieht den Dienst NICHT
	# mit; pipewire-pulse bedient die Schnittstelle.
	# `alsa-utils` bringt amixer/aplay: die Rueckfallebene von
	# mupi-lautstaerke.sh und der Abspielbefehl in shutdown_sound.sh.
	# `swh-plugins` (21.08.2026) TRAEGT DIE DYNAMIK DES KLANGWERKS: sc4 als
	# Kompressor, fast_lookahead_limiter als Begrenzer. PipeWire hat dafuer
	# nichts Eigenes — seine builtins kennen nur `clamp`, und das ist hartes
	# Clipping.
	#
	# WARUM ES HIER STEHEN MUSS UND NICHT NUR AUF DER LAUFENDEN BOX: es wurde
	# am 21.08. von Hand nachinstalliert. Ohne diese Zeile faellt es bei jeder
	# Neuinstallation weg — und zwar STILL: `ketteConfBauen` laesst ein Glied
	# ohne seine .so einfach heraus, damit die Kette nicht zerbricht. Der Ton
	# liefe also weiter, nur Kompressor und Begrenzer taeten nichts, und der
	# Regler stuende da, als wirke er. Genau die Sorte Fehler, die man erst
	# Wochen spaeter bemerkt. 6,7 MB.
	AUDIO_PAKETE="pipewire pipewire-bin pipewire-pulse pipewire-alsa wireplumber libspa-0.2-bluetooth pulseaudio-utils alsa-utils swh-plugins"
	# `gnupg` STEHT HIER NAMENTLICH, und das ist keine Vorsorge auf Verdacht.
	# Gemessen an .169 (05.08.2026, ctime der dpkg-Merkzettel): gpg kam dort
	# nur als LETZTER Zweig einer Alternativenkette in den Recommends von
	# build-essential/dpkg-dev herein —
	#     Recommends: sq | sqop | rsop | gosop | pgpainless-cli | gpg-sq | gnupg
	# Waehlt apt einmal einen frueheren Zweig, ist gnupg weg. Debians `apt`
	# haengt in Trixie ohnehin an `sqv`, nicht mehr an `gpgv` (gpgv ist auf
	# .169 gar nicht installiert) — die alte Gewissheit „gpg ist auf jedem
	# Debian" gilt nicht mehr.
	# Ohne gpg laesst sich der verschluesselte Behaelter einer Sicherung
	# (mupibox-sicherung.py --mit-zugangsdaten, E29/B6) NICHT mehr oeffnen,
	# und auffallen wuerde das erst beim Zurueckspielen — Monate spaeter.
	# [[e29b7-gpg-kann-doch-aead-und-gnupg-ist-nur-angeweht]]
	# `iw` braucht wifi-powersave-off.service (weiter unten): wireless-tools
	# liefert nur iwconfig, nicht iw. Auf DietPi meist schon da — meist.
	# `wireguard-tools` (wg, wg-quick) traegt den VPN-Heimweg der Verwaltung
	# (BACKLOG E30): ohne das Paket zeigt die VPN-Seite nur "Werkzeug fehlt".
	# Das Kernmodul bringt der Pi-Kern selbst mit; resolvconf braucht es NICHT,
	# weil die Verwaltung DNS-Zeilen beim Uebernehmen streicht.
	packages2install="gpiod git libasound2 mplayer ${AUDIO_PAKETE} pip id3tool bluez zip rrdtool scrot net-tools wireless-tools iw wireguard-tools autoconf automake bc build-essential gnupg python3-gpiozero python3-rpi-lgpio python3-lgpio python3-serial python3-requests python3-paho-mqtt libgles2-mesa mesa-utils libsdl2-dev preload python3-smbus2 pigpio libjson-c-dev i2c-tools libi2c-dev python3-smbus python3-alsaaudio python3-netifaces libwidevinecdm0 python3-flask avahi-daemon cifs-utils davfs2"

	###############################################################################################

	# NUR 64 BIT — UND ZWAR BEVOR IRGENDETWAS VERAENDERT WIRD.
	#
	# WARUM DAS TOR HIER STEHT und nicht bei der librespot-Zeile 300 Zeilen
	# weiter unten: dort waere die Karte schon halb aufgesetzt. Ein Abbruch
	# mitten in der Einrichtung hinterlaesst etwas, das man weder benutzen noch
	# gefahrlos noch einmal starten kann. Hier ist ausser `apt-get update` nichts
	# geschehen.
	#
	# WARUM 32 BIT RAUSFAELLT (entschieden 05.08.2026): Auf einem 32-Bit-System
	# gibt es kein librespot >= 0.8.0. Aeltere Staende fragen einen ueberholten
	# Metadaten-Endpunkt ab, der keine Tondatei mehr mitliefert — jeder Titel
	# meldet „not available", es kommt KEIN TON (A/B-Test 2026-07-28, gleiche
	# Anmeldung, gleiches Album: 0.6.0-dev stumm, 0.8.0 spielt). librespot-org
	# veroeffentlicht selbst keine fertigen Dateien.
	#
	# BIS HEUTE INSTALLIERTE DIESER ZWEIG TROTZDEM das stumme dev_0.6, schrieb
	# eine Warnung in ein Protokoll, das niemand liest, und die Box sah fertig
	# aus. Das ist die schlechteste aller Antworten: Der Fehler zeigt sich erst
	# beim ersten Spotify-Titel, und dann sucht man ihn ueberall, nur nicht in
	# der Architektur.
	#
	# ES GEHT NICHTS VERLOREN. Jeder Raspberry Pi ab dem 3er hat einen 64-Bit
	# Kern; nur-32-bittig sind Pi 1, Pi Zero/Zero W und die fruehe Pi 2 v1.1 —
	# Geraete, auf denen ein Chromium-Kiosk plus zwei Node-Dienste plus
	# librespot ohnehin nicht laufen. Ein 32-Bit-System entsteht hier allein
	# dadurch, dass beim Bespielen der Karte das falsche DietPi-Abbild gewaehlt
	# wurde. Das kostet zehn Minuten neu bespielen statt eines Abends Suche.
	#
	# Der Kreuzbau bleibt moeglich, falls sich das je aendert: librespot bringt
	# dafuer `contrib/Dockerfile` mit (Ziel armhf), und mit
	# `rustls-tls-webpki-roots` statt `native-tls` entfaellt OpenSSL fuer die
	# Fremdarchitektur. Siehe scripts/librespot/README.md.
	if [ "$(getconf LONG_BIT)" != "64" ]; then
		ABBRUCH="FEHLER: Diese Box braucht ein 64-Bit-System. Gefunden: $(getconf LONG_BIT) Bit auf $(uname -m).
Grund: Spotify braucht librespot 0.8.0 oder neuer, und dafuer gibt es kein 32-Bit-Programm.
Eine 32-Bit-Karte wuerde ohne Spotify-Ton laufen — deshalb wird hier abgebrochen statt es zu verschweigen.
Was zu tun ist: die Karte mit dem 64-Bit-Abbild von DietPi neu bespielen (arm64/aarch64) und noch einmal starten."
		echo "${ABBRUCH}" >&3 2>&3
		echo "${ABBRUCH}" > /dev/tty 2>/dev/null || echo "${ABBRUCH}" >&2
		exit 1
	fi

	###############################################################################################

	echo -e "XXX\n${STEP}\nUpdate package-list\nXXX"
	before=$(date +%s)
	apt-get update >&3 2>&3
	after=$(date +%s)
	echo -e "## apt-get update ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall jq 1.8.1 ... \nXXX"
	before=$(date +%s)
	rm -f /usr/bin/jq >&3 2>&3
	# Ohne Verzweigung: hinter dem 64-Bit-Tor weiter oben gibt es nur arm64.
	wget -q -O /usr/bin/jq https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-arm64 >&3 2>&3
	chmod 755 /usr/bin/jq >&3 2>&3
	after=$(date +%s)
	echo -e "## Install jq 1.8.1 ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	for package in ${packages2install}; do
		before=$(date +%s)
		echo -e "XXX\n${STEP}\nInstall ${package}\nXXX"
		PKG_OK=$(dpkg -l ${package} 2>/dev/null | egrep '^ii' | wc -l)
		if [ ${PKG_OK} -eq 0 ]; then
			# DEBIAN_FRONTEND=noninteractive, seit `davfs2` in der Liste steht
			# (20.09.2026, Netzlaufwerk E28/N6-N9): das Paket stellt beim
			# Einrichten eine debconf-Frage („mount.davfs setuid root?"). Ein
			# Dialog in einem Rezept, dessen Ausgabe nach >&3 laeuft und vor dem
			# niemand sitzt, ist kein Fehler, der auffaellt — es steht einfach.
			# Die Vorgabe (KEIN setuid) ist genau die, die hier gilt: eingehaengt
			# wird ueber eine systemd-Einheit, also als root.
			DEBIAN_FRONTEND=noninteractive apt-get --yes install ${package} >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## apt-get install ${package} ## finished after $((after - before)) seconds" >&3 2>&3
		STEP=$((STEP + 1))
	done

	###############################################################################################

	if [ "$OS" = "bullseye" ]; then
		echo -e "XXX\n${STEP}\nInstall package mutagen\nXXX"
		before=$(date +%s)
		pip install mutagen >&3 2>&3
		after=$(date +%s)
		echo -e "## pip install mutagen ## finished after $((after - before)) seconds" >&3 2>&3
		STEP=$((STEP + 1))

		echo -e "XXX\n${STEP}\nInstall package pip requests\nXXX"
		before=$(date +%s)
		installed=$(pip list | grep requests)
		if [ ${#installed} = 0 ]; then
			pip install requests --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install requests ## finished after $((after - before)) seconds" >&3 2>&3
		STEP=$((STEP + 1))

		echo -e "XXX\n${STEP}\nInstall package pip pyserial\nXXX"
		before=$(date +%s)
		installed=$(pip list | grep pyserial)
		if [ ${#installed} = 0 ]; then
			pip install pyserial --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install pyserial ## finished after $((after - before)) seconds" >&3 2>&3
		STEP=$((STEP + 1))
	else
		echo -e "XXX\n${STEP}\nInstall package python3-mutagen/python3-dev\nXXX"
		for package in python3-mutagen python3-dev; do
			before=$(date +%s)
			echo -e "XXX\n${STEP}\nInstall ${package}\nXXX"
			PKG_OK=$(dpkg -l ${package} 2>/dev/null | egrep '^ii' | wc -l)
			if [ ${PKG_OK} -eq 0 ]; then
				# DEBIAN_FRONTEND=noninteractive, seit `davfs2` in der Liste steht
				# (20.09.2026, Netzlaufwerk E28/N6-N9): das Paket stellt beim
				# Einrichten eine debconf-Frage („mount.davfs setuid root?"). Ein
				# Dialog in einem Rezept, dessen Ausgabe nach >&3 laeuft und vor dem
				# niemand sitzt, ist kein Fehler, der auffaellt — es steht einfach.
				# Die Vorgabe (KEIN setuid) ist genau die, die hier gilt: eingehaengt
				# wird ueber eine systemd-Einheit, also als root.
				DEBIAN_FRONTEND=noninteractive apt-get --yes install ${package} >&3 2>&3
			fi
			after=$(date +%s)
			echo -e "## apt-get install ${package} ## finished after $((after - before)) seconds" >&3 2>&3
			STEP=$((STEP + 1))
		done

		echo -e "XXX\n${STEP}\nInstall package pip telepot\nXXX"
		before=$(date +%s)
		installed=$(pip list | grep telepot)
		if [ ${#installed} = 0 ]; then
			pip install telepot --break-system-packages >&3 2>&3
		fi
		after=$(date +%s)
		echo -e "## pip install telepot ## finished after $((after - before)) seconds" >&3 2>&3
		STEP=$((STEP + 1))
	fi

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall DietPi software dependencies ...\nXXX"
	before=$(date +%s)
	su - -c "yes '' | /boot/dietpi/dietpi-software install 200" >&3 2>&3
	after=$(date +%s)
	echo -e "## DietPi software dependencies ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nPrepare MuPiBox Download ... \nXXX"
	before=$(date +%s)
	if [ -n "${MUPI_LOCAL_SRC}" ]; then
		# Local/offline source: derive the version without touching GitHub.
		VERSION="${MUPI_VERSION}"
		if [ -z "${VERSION}" ]; then
			VERSION=$(basename "${MUPI_LOCAL_SRC}" | sed -nE 's/^MuPiBox-(.+)\.(tgz|tar\.gz|zip)$/\1/p')
			[ -z "${VERSION}" ] && VERSION=$(basename "${MUPI_LOCAL_SRC}" | sed -nE 's/^MuPiBox-(.+)$/\1/p')
		fi
		[ -z "${VERSION}" ] && VERSION="local"
		MUPIBOX_URL="${MUPI_LOCAL_SRC}"
	else
		# ══ DERSELBE RIEGEL WIE IN update/start_mupibox_update.sh ══════════════
		#
		# WAS HIER OHNE IHN PASSIERT: Dieser Zweig holt version.json von
		# splitti/MuPiBox, zieht daraus MUPIBOX_URL, laedt sie (:295) und packt
		# sie aus (:304). Ergebnis ist eine Karte mit dem ORIGINAL — nicht mit
		# diesem Fork. Es ist die Install-Haelfte genau des Lochs, das am
		# 08.08.2026 im Update-Weg zugemacht wurde; dort war es sichtbar, weil
		# es `rm -R` machte, hier ist es unsichtbar, weil die Karte ja leer ist
		# und alles „funktioniert" — nur eben MuPiBox statt MixPiBox.
		#
		# DER GEDACHTE WEG SETZT MUPI_LOCAL_SRC. scripts/make-boot-sd.sh backt
		# den Baum als Tarball auf die Karte und exportiert die Variable (:128);
		# fehlt das Tarball, bricht es dort schon ab (:130). Der Rezept-Weg
		# (remote-step-installer) kommt hier gar nicht vorbei. Wer ohne die
		# Variable hier ankommt, hat also KEINEN Fork-Stand zum Installieren —
		# und dann ist Abbrechen die richtige Antwort, nicht Ersatzbeschaffung
		# beim Original.
		#
		# ES IST EINE FRAGE, KEIN VERBOT: Wer absichtlich die Serienfassung
		# aufsetzen will, setzt MUPI_ZURUECK_ZUM_ORIGINAL=1 — dieselbe Variable
		# wie im Update-Weg, damit es nur eine zu kennen gibt.
		if [ "${MUPI_ZURUECK_ZUM_ORIGINAL:-0}" != "1" ]; then
			echo "ABBRUCH: MUPI_LOCAL_SRC ist nicht gesetzt." >&2
			echo "Ohne sie wuerde dieser Installer den Code von splitti/MuPiBox holen" >&2
			echo "und eine Karte mit dem ORIGINAL aufsetzen statt mit diesem Fork." >&2
			echo >&2
			echo "Gedachter Weg: scripts/make-boot-sd.sh backt den Baum auf die Karte" >&2
			echo "und setzt MUPI_LOCAL_SRC selbst." >&2
			echo >&2
			echo "Wer ABSICHTLICH die Serienfassung aufsetzen will:" >&2
			echo "    MUPI_ZURUECK_ZUM_ORIGINAL=1 $0 $*" >&2
			exit 1
		fi
		wget -q -O ${VER_JSON} https://raw.githubusercontent.com/splitti/MuPiBox/main/version.json >&3 2>&3
		VERSION=$(/usr/bin/jq -r .release.${RELEASE}[-1].version ${VER_JSON})
		MUPIBOX_URL=$(/usr/bin/jq -r .release.${RELEASE}[-1].url ${VER_JSON})
	fi
	VERSION_LONG="${VERSION} ${RELEASE}"
	MUPI_SRC="/home/dietpi/MuPiBox-${VERSION}"
	after=$(date +%s)
	echo -e "## Prepare MuPiBox Download ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	echo "==========================================================================================" >&3 2>&3
	echo "= OS:               ${OS}" >&3 2>&3
	echo "= RasPi:            ${RASPPI}" >&3 2>&3
	echo "= Architecture:     ${ARCH}" >&3 2>&3
	echo "= User:             ${USER}" >&3 2>&3
	echo "= Release:          ${RELEASE}" >&3 2>&3
	echo "= Version:          ${VERSION_LONG}" >&3 2>&3
	echo "= Update-URL:       ${MUPIBOX_URL}" >&3 2>&3
	echo "= Unzip-Directory:  ${MUPI_SRC}" >&3 2>&3
	echo "==========================================================================================" >&3 2>&3

	###############################################################################################

	echo -e "XXX\n${STEP}\nDownload MuPiBox Version ${VERSION_LONG}... \nXXX"
	before=$(date +%s)
	if [ -n "${MUPI_LOCAL_SRC}" ]; then
		# Stage the baked-in source into ${MUPI_SRC} — no network.
		rm -Rf "${MUPI_SRC}" >&3 2>&3
		if [ -d "${MUPI_LOCAL_SRC}" ]; then
			cp -a "${MUPI_LOCAL_SRC}" "${MUPI_SRC}" >&3 2>&3
		else
			case "${MUPI_LOCAL_SRC}" in
				*.zip) unzip -q -d /home/dietpi/ "${MUPI_LOCAL_SRC}" >&3 2>&3 ;;
				*)     tar -xzf "${MUPI_LOCAL_SRC}" -C /home/dietpi/ >&3 2>&3 ;;
			esac
		fi
	else
		wget -q -O /home/dietpi/mupibox.zip ${MUPIBOX_URL} >&3 2>&3
	fi
	after=$(date +%s)
	echo -e "## MuPiBox Download ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	echo -e "XXX\n${STEP}\nUnzip MuPiBox Version ${VERSION_LONG}... \nXXX"
	before=$(date +%s)
	if [ -z "${MUPI_LOCAL_SRC}" ]; then
		unzip -q -d /home/dietpi/ /home/dietpi/mupibox.zip >&3 2>&3
		rm /home/dietpi/mupibox.zip >&3 2>&3
	fi
	after=$(date +%s)
	echo -e "## Unzip MuPiBox Sources ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall/Update Node.js 22 ... \nXXX"
	before=$(date +%s)
	NODEJS=$(nodejs --version 2>/dev/null)
	if [[ "$NODEJS" == "v22."* ]]; then
		echo "Node.js already at v22.*" >&3 2>&3
	else
		apt-get --yes remove nodejs >&3 2>&3
		curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >&3 2>&3
		apt-get install -y nodejs >&3 2>&3
	fi
	after=$(date +%s)
	echo -e "## Install/Update Node.js 22 ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall ionic... \nXXX"
	before=$(date +%s)
	npm install -g @ionic/cli >&3 2>&3
	after=$(date +%s)
	echo -e "## Install ionic ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	# ── HIER STANDEN ZWEI pm2-SCHRITTE — ENTFALLEN AM 14.08.2026 ──────────────
	#
	#     npm install pm2 -g
	#     pm2 startup   (+ das zurueckgelesene `sudo env …` ausfuehren)
	#
	# WARUM SIE WEG SIND: die Dienste dieser Box laufen seit dem 29.07.2026
	# unter systemd, nicht mehr unter pm2. Der Umbau geschah damals aber nur im
	# remote-step-installer — DIESES Skript, der Weg fuer eine FRISCH
	# GEFLASHTE KARTE, installierte pm2 weiter und startete den Server damit.
	# Eine neue Karte bekam also einen anderen Zustand als jede laufende Box:
	# andere Startzeit, andere Protokolle, andere Neustart-Regeln, und jeder
	# Handgriff aus der Verwaltung (`systemctl restart mupibox-player`) ging
	# ins Leere. Genau die Klasse Fehler, die [[pm2-reste-nach-der-systemd-umstellung]]
	# beschreibt: nichts schlaegt fehl, es geschieht nur nichts.
	#
	# WAS STATTDESSEN GESCHIEHT: die beiden Units mupibox-server.service und
	# mupibox-player.service werden weiter unten mit allen anderen Units
	# ausgelegt und eingeschaltet (Abschnitt "Finalizing setup").
	#
	# WAS DER UMBAU BRINGT (am Geraet gemessen, Pi 4, 2026-07-29): die App ist
	# 6,1 s nach dem Start bereit statt 23,5 s — pm2 selbst brauchte 3,4 s,
	# bevor server.js ueberhaupt anlief. Weil der Kiosk in seinem Autostart auf
	# localhost:8200 wartet, BEVOR er X startet, ist das direkt Zeit bis zum
	# Bild: Fenster ab 25,1 statt 34,9 s.
	#
	# HIER WIRD NICHTS DEINSTALLIERT. Dieses Skript laeuft auf einer frisch
	# geflashten Karte, auf der noch nie ein pm2 war — es gibt nichts
	# abzuraeumen. Das Abraeumen auf ALTEN Boxen macht der remote-step-installer
	# im Schritt `dienste-systemd`, und der braucht dafuer pm2s eigenes Binaer.
	# Nachgemessen an der laufenden Box .57 (14.08.2026, tools/pm2-bestand.sh):
	# pm2 ist dort weder installiert noch laeuft ein Verwalterprozess, ~/.pm2
	# existiert nicht, pm2-dietpi.service ist `not-found` — waehrend
	# mupibox-server und mupibox-player `enabled` und `active` sind und die
	# Ports 8200 und 5005 halten.

	###############################################################################################

	echo -e "XXX\n${STEP}\nClean and create directories... \nXXX"
	before=$(date +%s)
	rm -Rf /home/dietpi/.mupibox /home/dietpi/MuPiBox >&3 2>&3
	mkdir -p /home/dietpi/.mupibox/chromium_cache >&3 2>&3
	# tts_files gehoert zum ALTEN Google-Sprechweg. Er ist abgeloest (Piper,
	# siehe weiter unten), aber das ausgelieferte Bundle in bin/nodejs/deploy.zip
	# schreibt noch dorthin, und mupi.php raeumt es auf. Das Verzeichnis bleibt
	# deshalb, bis beide nachgezogen sind — sein Fehlen war genau der Fehler, an
	# dem das Vorlesen ueber Google still scheiterte (ENOENT, 04.08.2026).
	mkdir -p /home/dietpi/MuPiBox/tts_files >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/sysmedia/sound >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/sysmedia/images >&3 2>&3
	mkdir -p /home/dietpi/.cache/spotify >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/media/audiobook >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/media/music >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/media/other >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/media/cover >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/media/youtube-dl >&3 2>&3
	mkdir -p /home/dietpi/MuPiBox/themes >&3 2>&3
	mkdir -p /home/dietpi/.mupibox/Sonos-Kids-Controller-master/ >&3 2>&3
	mkdir -p /home/dietpi/.mupibox/spotifycontroller-main/config >&3 2>&3
	mkdir -p /usr/local/bin/mupibox >&3 2>&3
	mkdir -p /etc/mupibox >&3 2>&3
	mkdir -p /etc/librespot >&3 2>&3
	mkdir -p /var/log/mupibox/ >&3 2>&3
	chown -R dietpi:dietpi /home/dietpi/.mupibox /home/dietpi/MuPiBox >&3 2>&3
	after=$(date +%s)
	echo -e "## Clean and create directories ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCreate hushlogin and MuPiBox config... \nXXX"
	before=$(date +%s)
	touch /home/dietpi/.hushlogin >&3 2>&3
	mv -f ${MUPI_SRC}/config/templates/mupiboxconfig.json ${CONFIG} >&3 2>&3
	chown dietpi:dietpi ${CONFIG} >&3 2>&3
	chmod 775 ${CONFIG} >&3 2>&3
	after=$(date +%s)
	echo -e "## Create hushlogin and MuPiBox config ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall frontend, backend-api, and backend-player... \nXXX"
	before=$(date +%s)
	unzip ${MUPI_SRC}/bin/nodejs/deploy.zip -d /home/dietpi/.mupibox/Sonos-Kids-Controller-master/ >&3 2>&3
	cp ${MUPI_SRC}/config/templates/www.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/config.json >&3 2>&3
	cp ${MUPI_SRC}/config/templates/monitor.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/monitor.json >&3 2>&3
	cp /home/dietpi/.mupibox/Sonos-Kids-Controller-master/spotify-control.js /home/dietpi/.mupibox/spotifycontroller-main/spotify-control.js >&3 2>&3
	cp ${MUPI_SRC}/config/templates/spotifycontroller.json /home/dietpi/.mupibox/spotifycontroller-main/config/config.json >&3 2>&3
	ln -sf /etc/mupibox/mupiboxconfig.json /home/dietpi/.mupibox/spotifycontroller-main/config/mupiboxconfig.json >&3 2>&3
	chown -R dietpi:dietpi /home/dietpi/.mupibox >&3 2>&3
	after=$(date +%s)
	echo -e "## Install frontend, backend-api, and backend-player ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy binaries... \nXXX"
	before=$(date +%s)
	# LIBRESPOT: FASSUNG >= 0.8.0 IST PFLICHT (BACKLOG E12/X1, frueher P6).
	#
	# Bis hierher holte dieser Schritt in BEIDEN Zweigen `dev_0.6_20250806` —
	# und diese Fassung spielt KEINEN TON. Sie fragt einen ueberholten
	# Metadaten-Endpunkt ab, der keine Tondatei mehr mitliefert; jeder Titel
	# meldet "not available". Im A/B-Test belegt (2026-07-28, gleiche Anmeldung,
	# gleiches Album, siehe scripts/librespot/README.md): 0.6.0-dev stumm,
	# 0.8.0 spielt. Eine frische SD-Karte war damit als Spotify-Box tot,
	# waehrend beide laufenden Boxen laengst 0.8.0 haben (dorthin gebracht vom
	# remote-step-installer, Rezeptschritt `librespot`).
	#
	# 64 BIT: das fertige Binaer liegt IM REPO (bin/librespot/0.8.0/). Es wird
	# bevorzugt genommen — das spart den Bezug von einem fremden Zweig und
	# funktioniert auch auf einer Karte ohne Netz (MUPI_LOCAL_SRC).
	# Der wget-Rueckfall bleibt fuer den Fall, dass MUPI_SRC aus einem
	# Upstream-Release stammt, in dem diese Datei nicht liegt.
	#
	# 32 BIT GIBT ES HIER NICHT MEHR — das Tor am Anfang hat schon abgebrochen.
	#
	# UND DER RUECKFALL AUF dev_0.6 IST AUCH WEG. Er sprang ein, wenn die
	# 0.8.0-Datei im Paket fehlte, und holte dann ein librespot, das
	# NACHWEISLICH keinen Ton spielt — mit einer Warnung in einem Protokoll,
	# das niemand liest. Eine Box, die stumm bleibt, ist schlechter als eine,
	# die beim Aufsetzen sagt, was fehlt.
	rm -f /usr/bin/librespot >&3 2>&3
	if [ ! -f "${MUPI_SRC}/bin/librespot/0.8.0/librespot-arm64" ]; then
		ABBRUCH="FEHLER: bin/librespot/0.8.0/librespot-arm64 fehlt im Paket.
Ohne diese Datei gibt es keinen Spotify-Ton. Der frueher benutzte Rueckfall (dev_0.6) spielt nachweislich nichts.
Was zu tun ist: das vollstaendige Paket verwenden, oder librespot 0.8.0 selbst bauen (scripts/librespot/README.md)."
		echo "${ABBRUCH}" >&3 2>&3
		echo "${ABBRUCH}" > /dev/tty 2>/dev/null || echo "${ABBRUCH}" >&2
		exit 1
	fi
	cp "${MUPI_SRC}/bin/librespot/0.8.0/librespot-arm64" /usr/bin/librespot >&3 2>&3
	echo "## librespot 0.8.0 aus dem Paket ##" >&3 2>&3
	mv ${MUPI_SRC}/bin/fbv/fbv_64 /usr/bin/fbv >&3 2>&3
	chmod 755 /usr/bin/fbv /usr/bin/jq /usr/bin/librespot >&3 2>&3
	mkdir -p $(cat ${CONFIG} | jq -r .spotify.cachepath) >&3 2>&3
	chown dietpi:dietpi $(cat ${CONFIG} | jq -r .spotify.cachepath) >&3 2>&3
	after=$(date +%s)
	echo -e "## Copy binaries ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nSetup DietPi-Dashboard... \nXXX"
	before=$(date +%s)
	mkdir -p /opt/dietpi-dashboard >&3 2>&3
	rm -f /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	curl -fL "$(curl -sSf 'https://api.github.com/repos/nonnorm/DietPi-Dashboard/releases/latest' | mawk -F\" "/\"browser_download_url\": \".*dietpi-dashboard-$(uname -m)\"/{print \$4}")" -o /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	chmod +x /opt/dietpi-dashboard/dietpi-dashboard >&3 2>&3
	curl -sSfL https://raw.githubusercontent.com/nonnorm/DietPi-Dashboard/v0.6.2/config.toml -o /opt/dietpi-dashboard/config.toml >&3 2>&3
	sed -i 's/#terminal_user = "root"/terminal_user = "dietpi"/g' /opt/dietpi-dashboard/config.toml >&3 2>&3
	after=$(date +%s)
	echo -e "## Setup DietPi-Dashboard ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy DietPi config... \nXXX"
	before=$(date +%s)
	mv -f ${MUPI_SRC}/config/templates/asound.conf /etc/asound.conf >&3 2>&3
	# DIE WINDOWS-FREIGABE STEHT HIER NICHT MEHR (BACKLOG E12/X13(c)).
	# Hier stand `mv -f … config/templates/smb.conf /etc/samba/smb.conf`. Am
	# 04.08.2026 an der Box .169 gemessen: es gibt kein Verzeichnis /etc/samba,
	# das Paket `samba` ist nicht installiert (nur `samba-libs` als
	# Abhaengigkeit von etwas anderem), und `systemctl is-enabled smbd` sagt
	# `not-found`. Dieses Rezept hat samba auch nie installiert — weder in
	# `packages2install` noch ueber `dietpi-software`. Der Befehl ist also seit
	# jeher fehlgeschlagen, und weil er nach >&3 schreibt, hat es nie jemand
	# gesehen. Die Vorlage config/templates/smb.conf bleibt liegen: sie ist der
	# halbe Rueckweg, falls die Freigabe gewollt ist (siehe die Frage bei
	# `smbd` weiter unten in der Einschaltschleife).
	after=$(date +%s)
	echo -e "## Copy DietPi config ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy media files... \nXXX"
	before=$(date +%s)
	mv -f ${MUPI_SRC}/config/templates/splash.txt /boot/splash.txt >&3 2>&3
	wget https://gitlab.com/DarkElvenAngel/initramfs-splash/-/raw/master/boot/initramfs.img -O "${BOOT_DIR}/initramfs.img" >&3 2>&3
	cp ${MUPI_SRC}/media/images/goodbye.png /home/dietpi/MuPiBox/sysmedia/images/goodbye.png >&3 2>&3
	mv -f ${MUPI_SRC}/media/images/splash.png /boot/splash.png >&3 2>&3
	cp ${MUPI_SRC}/media/images/MuPiLogo.jpg /home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg >&3 2>&3
	cp ${MUPI_SRC}/media/sound/shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/shutdown.wav >&3 2>&3
	cp ${MUPI_SRC}/media/sound/startup.wav /home/dietpi/MuPiBox/sysmedia/sound/startup.wav >&3 2>&3
	cp ${MUPI_SRC}/media/sound/button_shutdown.wav /home/dietpi/MuPiBox/sysmedia/sound/button_shutdown.wav >&3 2>&3
	cp ${MUPI_SRC}/media/sound/low.wav /home/dietpi/MuPiBox/sysmedia/sound/low.wav >&3 2>&3
	cp ${MUPI_SRC}/media/images/installation.jpg /home/dietpi/MuPiBox/sysmedia/images/installation.jpg >&3 2>&3
	cp ${MUPI_SRC}/media/images/battery_low.jpg /home/dietpi/MuPiBox/sysmedia/images/battery_low.jpg >&3 2>&3
	after=$(date +%s)
	echo -e "## Copy media files ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy MuPiBox files and themes... \nXXX"
	before=$(date +%s)
	# Ohne pikachu, supermario, spiderman, clone-wars, enterprise, matrix (E47,
	# 19.08.2026): ihre Hintergruende zeigten geschuetzte Figuren.
	# HIER STAND die Verteilung der Theme-Beigaben (theme-data: Schriften,
	# Hintergruende) und der themes/*.css der ALTEN Oberflaeche - gefallen
	# mit E118/1e. Die neue Oberflaeche bringt ihre Bilder unter www/neu/
	# selbst mit; Farben kommen aus /farben.css (E118/1c).
	mv ${MUPI_SRC}/scripts/chromium-autostart.sh /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh >&3 2>&3
	mv ${MUPI_SRC}/scripts/mupibox/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/bluetooth/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/wled/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/telegram/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/mupihat/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/fan/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/wifi/* /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/mqtt/* /usr/local/bin/mupibox/ >&3 2>&3
	# ZWEI DATEIEN aus scripts/librespot/, nicht das ganze Verzeichnis:
	# librespot-start.sh und README.md werden von niemandem aufgerufen.
	#
	# OHNE DIESE ZEILEN ZEIGT DIE UNIT INS LEERE. Sie liegt seit langem in
	# config/services/, aber der Installationsweg kannte weder Skript noch Unit
	# (BACKLOG E12/X1). Was sie faengt: librespots Sitzung kann sterben,
	# waehrend der Prozess weiterlaeuft — die Box verschwindet dann aus
	# Spotifys Geraeteliste, systemd sieht einen gesunden Dienst, und niemand
	# merkt es, bis ein Kind auf ein Album tippt.
	#
	# UND DER WAECHTER BRAUCHT SEIN WERKZEUG. Beim Gegenlesen am 04.08.2026
	# gefunden: librespot-waechter.sh ruft in seinem Hauptzweig
	# /usr/local/bin/mupibox/librespot-konto.py auf (Zeilen 80/85). Fehlt die
	# Datei, faellt der Waechter durch bis zu `systemctl restart librespot` —
	# und genau das ist die FALSCHE Antwort auf den einen Fall, der am
	# 02.08.2026 gemessen wurde ([[librespot-fremdes-konto-uebernommen]]):
	# librespot war beim Konto eines fremden Handys angemeldet, jeder Neustart
	# meldete sich dort wieder an, alle fuenf Minuten von vorn. Auf den
	# laufenden Boxen liegt konto.py (vom remote-step-installer); eine frische
	# Karte haette den Waechter OHNE es bekommen — also einen Waechter, der
	# im Takt neu startet und nie hilft. Beide Dateien, nie einzeln.
	mv ${MUPI_SRC}/scripts/librespot/librespot-waechter.sh /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/librespot/librespot-konto.py /usr/local/bin/mupibox/ >&3 2>&3
	# E42: DIE ZWEITE TONMASCHINE — beide Soloist-Skripte, nie einzeln.
	# soloist.service ruft soloist-start.sh, der Updater-Timer ruft
	# soloist-updater.sh; eine Haelfte ohne die andere ist eine Unit, die ins
	# Leere zeigt (dieselbe Bauart wie der librespot-Waechter eine Zeile
	# weiter oben). Bis zum 22.08.2026 kannten nur das Installer-Rezept und
	# der Handweg (scripts/systemd/einrichten.sh) diese Dateien — eine
	# frische Karte aus DIESEM Skript hatte den Engine-Schalter schlicht
	# nicht (Kartierung 22.08.2026: null Treffer fuer "soloist").
	mv ${MUPI_SRC}/scripts/soloist/soloist-start.sh /usr/local/bin/mupibox/ >&3 2>&3
	mv ${MUPI_SRC}/scripts/soloist/soloist-updater.sh /usr/local/bin/mupibox/ >&3 2>&3
	# E104: die Anmeldewache heilt den nach Boot-Fehlanmeldung stummen Soloist
	# (30.08.2026 am Geraet: "login failed" 16 s nach dem Boot, danach fuer
	# immer stumm bei 16 % CPU — der Schluessel war gueltig).
	mv ${MUPI_SRC}/scripts/soloist/soloist-anmeldewache.sh /usr/local/bin/mupibox/ >&3 2>&3
	# MIXPI-SKRIPTE (Adapterwahl-Anwendung, Plugin-Nachzug) — gleicher Ort
	# wie alles andere, /usr/local/bin/mupibox (Begruendung in
	# tools/ausliefern.py: ein zweiter Skriptordner waere eine Stelle mehr,
	# an der etwas verschwindet).
	mv ${MUPI_SRC}/scripts/mixpi/* /usr/local/bin/mupibox/ >&3 2>&3
	# scripts/box/ — ZWEI WERKZEUGE, DIE BISHER KEIN WEG AUF EINE KARTE BRACHTE
	# (BACKLOG E12/X5, gefunden mit tools/ausrollweg-deckung.py).
	#
	# bt-reconnect.py lag seit langem im Repo, und KEIN Kopierblock hat
	# scripts/box/ je angefasst — dieselbe Bauart wie beim librespot-Waechter.
	# touch-bridge.py lag ueberhaupt nicht im Repo, obwohl die Verwaltung den
	# Dienst "Touchscreen-Bruecke" auffuehrt (src/backend-api/src/dienste.ts).
	# Beide kamen nur ueber den remote-step-installer auf die laufenden Boxen.
	#
	# ZIEL IST /opt/mupibox-tools/, NICHT /usr/local/bin/mupibox/ — und zwar
	# absichtlich: genau dorthin legt sie der remote-step-installer, und genau
	# diesen Pfad nennen die beiden Units. Ein anderer Pfad haette auf den
	# laufenden Boxen eine ZWEITE Fassung derselben Datei hinterlassen; zwei
	# Fassungen sind schlimmer als eine fehlende (dieselbe Falle wie bei
	# mupibox-boot-splash.py, siehe update/start_mupibox_update.sh).
	mkdir -p /opt/mupibox-tools >&3 2>&3
	mv ${MUPI_SRC}/scripts/box/* /opt/mupibox-tools/ >&3 2>&3
	chmod 755 /opt/mupibox-tools/* >&3 2>&3
	# Die Bruecke braucht i2c-dev und uinput. Die Unit laedt beide selbst
	# (ExecStartPre=-/sbin/modprobe …); der Eintrag hier sorgt dafuer, dass sie
	# schon beim Hochfahren da sind, statt beim ersten Dienststart.
	for m in i2c-dev uinput; do
		grep -qx "$m" /etc/modules-load.d/mupibox-touch.conf 2>/dev/null || echo "$m" >> /etc/modules-load.d/mupibox-touch.conf
	done
	mv ${MUPI_SRC}/config/templates/add_wifi.json /boot/add_wifi.json >&3 2>&3
	# Zweite Funk-Karte (USB-Stick, wlan1) — die MECHANIK ins Rezept (E131/D3;
	# Betreiber 05.09.2026: "am ende muss auch alles ins rezept fürs
	# neuaufsetzen!"). Bis dahin war die Stick-Einrichtung Handarbeit an der
	# Box und ueberlebte kein Neuaufsetzen. Zugangsdaten bleiben Handeingabe
	# je Haus (wpa-Geruest mit Beispielen); `cp -n` — NIE eine vorhandene
	# Datei ueberschreiben, dort stehen die Netze des Hauses. Ohne Stick ist
	# beides wirkungslos (allow-hotplug).
	cp -n ${MUPI_SRC}/config/templates/interfaces-wlan1 /etc/network/interfaces.d/wlan1 >&3 2>&3
	cp -n ${MUPI_SRC}/config/templates/wpa_supplicant-wlan1.conf /etc/wpa_supplicant/wpa_supplicant-wlan1.conf >&3 2>&3
	mv ${MUPI_SRC}/config/templates/.bashrc /home/dietpi/.bashrc >&3 2>&3
	chown -R dietpi:dietpi /home/dietpi/.mupibox/Sonos-Kids-Controller-master/ /home/dietpi/MuPiBox /home/dietpi/.bashrc >&3 2>&3
	chmod 755 /usr/local/bin/mupibox/* /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh >&3 2>&3
	# DHCP-RUECKFALL ENTSCHAERFEN — der groesste einzelne Bootzeit-Posten.
	#
	# Der Kiosk startet erst, wenn das WLAN eine Adresse hat (Kette:
	# ifup@wlan0 -> network.target -> systemd-user-sessions -> getty@tty1 ->
	# Autologin -> chromium-autostart.sh). Die Seite, die er zeigt, liegt aber
	# unter http://localhost:8200 und braucht keine Adresse.
	#
	# GEMESSEN an Box .169 am 04.08.2026 (tools/bootkette-schau.py): das WLAN
	# war bei 6,6 s verbunden, der naechste DHCP-Antrag ging erst bei 11,6 s
	# raus, und der Router antwortete darauf in 115 ms. 4,96 s Warten auf
	# nichts — bei 11,98 s Gesamtstart. Am Pi 4 brachte dieselbe Aenderung am
	# 29.07.2026 31,8 s -> 13,2 s (Wiki: mupi-boot-32s-auf-13s).
	#
	# Der Schritt lief bisher NUR im remote-step-installer; eine frisch aus
	# diesem Repo aufgesetzte Box wartete voll mit. Nicht fatal, wenn er
	# fehlschlaegt — dann bootet die Box eben so langsam wie bisher.
	/usr/local/bin/mupibox/dhcp-schneller.sh --einbauen >&3 2>&3 || echo "## dhcp-schneller failed - box boots as before ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Copy MuPiBox files and themes ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall Hifiberry-MiniAmp and Bluetooth support... \nXXX"
	before=$(date +%s)
	# Bluetooth can FREEZE the whole setup: dietpi-set_hardware waits on the BT
	# service, which stalls on some boards / on Trixie (observed hang at this
	# step). Bound both BT commands with a timeout so a stuck BT can't hang the
	# install — the box works fine without BT (kiosk + Spotify Web SDK). The
	# soundcard set is quick + made non-fatal too.
	timeout -k 15 240 /boot/dietpi/dietpi-software install 5 >&3 2>&3 || echo "## Bluetooth install timed out/failed - skipped ##" >&3 2>&3
	timeout -k 15 90 /boot/dietpi/func/dietpi-set_hardware bluetooth enable >&3 2>&3 || echo "## Bluetooth enable timed out/failed - skipped ##" >&3 2>&3
	/boot/dietpi/func/dietpi-set_hardware soundcard "hifiberry-dac" >&3 2>&3 || true
	# GRUPPE FUER GRUPPE, NICHT IN EINEM AUFRUF — SONST FEHLEN ALLE.
	#
	# Hier stand `usermod -a -G audio,bluetooth,pulse,pulse-access,gpio,dialout,tty dietpi`.
	# usermod ist alles-oder-nichts: fehlt EINE der genannten Gruppen, bricht es
	# ab und setzt KEINE. Mit dem Umstieg auf PipeWire (E12/X6) gibt es die
	# Gruppen `pulse` und `pulse-access` nicht mehr — die Zeile haette dietpi
	# ohne `audio` und ohne `tty` zurueckgelassen. Ohne `audio` stirbt der
	# Abspieldienst in einer Neustartschleife (Wiki:
	# mupi-kiosk-nutzer-ohne-gruppe-audio), ohne `tty` startet X gar nicht.
	# `input`, `video` und `render` kommen dazu: Touch und der KMS-Treiber
	# brauchen sie, seit der Kiosk als dietpi laeuft und nicht als root.
	for g in audio bluetooth gpio dialout tty input video render pulse pulse-access; do
		if getent group "$g" >/dev/null 2>&1; then usermod -a -G "$g" dietpi >&3 2>&3; fi
	done
	for g in gpio pulse pulse-access; do
		if getent group "$g" >/dev/null 2>&1; then usermod -a -G "$g" root >&3 2>&3; fi
	done
	# Die drei PulseAudio-Feineinstellungen nur, wenn es PulseAudio ueberhaupt
	# gibt. Ohne die Wache schreibt sed in Dateien, die nicht da sind, und das
	# sieht im Protokoll aus wie ein Fehler, obwohl es keiner ist.
	if [ -f /etc/pulse/daemon.conf ]; then
		usermod -g pulse -G audio --home /var/run/pulse pulse >&3 2>&3
		sed -i 's/; system-instance = no/system-instance = yes/g' /etc/pulse/daemon.conf >&3 2>&3
		sed -i 's/; default-server =/default-server = \/var\/run\/pulse\/native/g' /etc/pulse/client.conf >&3 2>&3
		sed -i 's/; autospawn = yes/autospawn = no/g' /etc/pulse/client.conf >&3 2>&3
	fi
	sed -i 's/ExecStart=\/usr\/libexec\/bluetooth\/bluetoothd/ExecStart=\/usr\/libexec\/bluetooth\/bluetoothd --noplugin=sap/g' /lib/systemd/system/bluetooth.service >&3 2>&3
	after=$(date +%s)
	echo -e "## Bluetooth support ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	# ══ HIER STAND DER PHP-ADMIN — AUSGEBAUT (E47, 19.08.2026) ══════════
	#
	# Dieser Schritt installierte lighttpd + PHP (dietpi-software 5 84 89)
	# und packte die alte Verwaltung nach /var/www — bedingungslos, auf
	# JEDER frischen Karte. Betreiber: "auch php und fallback kann weg …
	# ich denke das backend hat sich bewaehrt."
	#
	# AM GERAET GEMESSEN (19.08.2026): kein php-Paket, kein lighttpd,
	# /var/www leer, Port 80 tot — nur der Node-Server auf 8200. Die
	# Verwaltung laeuft dort unter /admin.
	#
	# MITGEGANGEN sind die beiden Symlinks, vor denen der alte Kommentar
	# an dieser Stelle ausdruecklich gewarnt hat — /var/www/images/mupif.png
	# (die ALTE Box-Oberflaeche holte ihr Maskottchen von dort; am Geraet
	# existiert der Link laengst nicht mehr) und /var/www/cover — sowie die
	# Zeile "www-data ALL=(ALL:ALL) NOPASSWD: ALL". Die groesste
	# Rechteausweitung der Box gab es NUR, weil der PHP-Admin sudo aufrief.
	#
	# Der Schritt-Zaehler STEP wird hier NICHT mehr erhoeht: es gibt keinen
	# Schritt mehr zu zaehlen.

	###############################################################################################

	# LED-CONTROL WIRD NICHT MEHR GEBAUT (29.08.2026). Das C-Kompilat wurde je
	# Setup UND je Update mit gcc+pigpio erzeugt — und sein einziger Aufruf in
	# mupi_start_led.sh war seit langem auskommentiert; es leuchtet
	# led_control.py (python3-lgpio). Uebrig bleibt das Aufraeumen: auf
	# Bestandsboxen liegt das Binaer noch unter /usr/local/bin/mupibox.
	echo -e "XXX\n${STEP}\nCleanup LED Control... \nXXX"
	rm -f /usr/local/bin/mupibox/led_control >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	# PIPER — OHNE DIESEN SCHRITT SPRICHT EINE FRISCHE SD-KARTE GAR NICHT.
	#
	# Seit dem 04.08.2026 spricht die Box ueber Piper (lokal, ohne Netz), und
	# Google TTS ist abgeloest — der lief ohnehin nie: er legte MP3s in
	# /home/dietpi/MuPiBox/tts_files ab, das auf der Box gar nicht existierte
	# (ENOENT im Protokoll, verschluckt von .catch(console.error)).
	#
	# Piper kam bis heute ueber KEINEN Installationsweg auf eine Box; er wurde
	# auf der Entwicklungsbox von Hand eingerichtet ([[vorlesen-tts]]). Solange
	# Vorlesen ein Zusatz war, fiel das nicht auf. Jetzt ist Sprechen ein
	# beworbenes Merkmal, und das ist der Unterschied.
	#
	# ZEITGRENZE, WEIL DIESER SCHRITT ALS EINZIGER GROSSES HERUNTERLAEDT: pip
	# holt onnxruntime und numpy, danach kommt die Stimme von HuggingFace. Auf
	# einer langsamen Leitung dauert das; haengen darf es nicht. Wie beim
	# Bluetooth-Schritt oben gilt: lieber ohne dieses Merkmal fertig werden als
	# gar nicht. Eine Box ohne Piper liest nicht vor — kaputt ist sie nicht,
	# und die Verwaltung sagt es offen ("bereit: false").
	#
	# NACHHOLBAR, ohne die Karte neu zu bespielen:
	#   sudo /usr/local/bin/mupibox/piper-einrichten.sh
	#   sudo /usr/local/bin/mupibox/piper-einrichten.sh --pruefen
	echo -e "XXX\n${STEP}\nInstall Piper (text-to-speech)... \nXXX"
	before=$(date +%s)
	timeout -k 30 1200 /usr/local/bin/mupibox/piper-einrichten.sh >&3 2>&3 \
		|| echo "## Piper setup failed/timed out - box will not read aloud ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Install Piper ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nSet environment... \nXXX"
	before=$(date +%s)
	# `smbpasswd -s -a dietpi` STEHT HIER NICHT MEHR (BACKLOG E12/X13(c)).
	# Es gehoerte zur Windows-Freigabe und scheiterte aus demselben Grund wie
	# die beiden anderen Stellen: ohne `samba` gibt es kein `smbpasswd`. Es
	# setzte ausserdem ein Passwort, das im Quelltext steht — wer die Freigabe
	# will, soll sie bewusst einrichten und dabei ein eigenes Passwort waehlen.
	# (Der active_theme.css-Symlink der alten Oberflaeche entfiel mit E118/1e.)
	mv -f ${MUPI_SRC}/config/templates/crontab.template /tmp/crontab.template >&3 2>&3
	chmod 755 /tmp/crontab.template >&3 2>&3
	chown dietpi:dietpi /tmp/crontab.template >&3 2>&3
	su dietpi -c "/usr/bin/crontab /tmp/crontab.template" >&3 2>&3
	ln -sf /tmp/network.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/network.json >&3 2>&3
	cat <<< $(jq --arg v "${VERSION_LONG}" '.mupibox.version = $v' ${CONFIG}) > ${CONFIG}
	chown dietpi:dietpi ${CONFIG} >&3 2>&3
	chmod 775 ${CONFIG} >&3 2>&3

	# E101 (leise Fassung 30.08.2026): Luefter-Kennlinie fuer den Pi 5.
	# Die Firmware-Vorgabe laesst die Box bis ~60 C treiben — die Drossel
	# traf dann das WLAN (E101). Die erste Kennlinie (150 ab 52 C) war fuer
	# eine Kinder-Hoerbox zu LAUT, und die im Geraetebaum fest verdrahtete
	# 5-C-Hysterese laesst eine erklommene Stufe erst unter (Schwelle-5 C)
	# wieder los. Deshalb: leise Grundstufe ab 42 C, hoehere erst ab
	# 59/62/64 C. Auf Nicht-Pi5 wird nichts geschrieben.
	if grep -q "Raspberry Pi 5" /proc/device-tree/model 2>/dev/null; then
	  if grep -q '^dtparam=fan_temp0=' "${BOOT_CONFIG}"; then
	    echo -e "mixpi-Luefter-Kennlinie already set" >&3 2>&3
	  else
	    {
	      echo ''
	      echo '# mixpi-luefter-kennlinie (E101, leise Fassung 30.08.2026)'
	      echo 'dtparam=fan_temp0=42000'
	      echo 'dtparam=fan_temp0_speed=90'
	      echo 'dtparam=fan_temp1=59000'
	      echo 'dtparam=fan_temp1_speed=110'
	      echo 'dtparam=fan_temp2=62000'
	      echo 'dtparam=fan_temp2_speed=220'
	      echo 'dtparam=fan_temp3=64000'
	      echo 'dtparam=fan_temp3_speed=255'
	    } | tee -a "${BOOT_CONFIG}" >&3 2>&3
	  fi
	fi

	if grep -q '^dtparam=gpio=on' "${BOOT_CONFIG}"; then
	  echo -e "dtparam=gpio=on already set" >&3 2>&3
	else
	  echo '' | tee -a "${BOOT_CONFIG}" >&3 2>&3
	  echo 'dtparam=gpio=on' | tee -a "${BOOT_CONFIG}" >&3 2>&3
	fi

	if grep -q '^dtoverlay=gpio-poweroff,gpiopin=4,active_low=1' "${BOOT_CONFIG}"; then
	  echo -e "dtoverlay=gpio-poweroff already set" >&3 2>&3
	else
	  echo '' | tee -a "${BOOT_CONFIG}" >&3 2>&3
	  echo 'dtoverlay=gpio-poweroff,gpiopin=4,active_low=1' | tee -a "${BOOT_CONFIG}" >&3 2>&3
	fi

	# NANO-SYNTAXFARBEN AUS DEM REPO, NICHT AUS DEM NETZ (06.09.2026,
	# AUDIT-2026-09-06 Rang 9).
	#
	# Hier stand `curl https://…/nanorc/master/install.sh | sh`. Das ist die
	# gefaehrlichste Zeile, die ein Aufsetzlauf haben kann: sie fuehrt aus,
	# was heute unter einer fremden Adresse liegt — ohne Fassung, ohne
	# Pruefsumme, als root. Aendert sich das Ziel (Uebernahme des Kontos,
	# Tippfehler im Namen, ein schlechter Tag beim Anbieter), fuehrt jede
	# frische Karte es mit aus. Und ohne Netz brach der Schritt hier ab.
	#
	# `config/.nano/` LIEGT SEIT JEHER IM REPO und wurde von niemandem
	# ausgerollt — drei nanorc-Dateien, die genau das tun, wofuer der
	# Fremdaufruf da war. Sie kosten nichts und sind nachlesbar.
	install -d -o dietpi -g dietpi /home/dietpi/.nano >&3 2>&3
	cp ${MUPI_SRC}/config/.nano/*.nanorc /home/dietpi/.nano/ >&3 2>&3
	chown dietpi:dietpi /home/dietpi/.nano/*.nanorc >&3 2>&3
	# `include` je Datei, aber nur einmal — ein zweiter Aufsetzlauf soll die
	# Zeilen nicht verdoppeln.
	for n in /home/dietpi/.nano/*.nanorc; do
		grep -qxF "include ${n}" /home/dietpi/.nanorc 2>/dev/null || echo "include ${n}" >> /home/dietpi/.nanorc
	done
	chown dietpi:dietpi /home/dietpi/.nanorc >&3 2>&3
	touch /home/dietpi/.mupi.install >&3 2>&3
	after=$(date +%s)
	echo -e "## Set environment ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nCopy OnOffShim scripts... \nXXX"
	before=$(date +%s)
	# ── DER AUSSCHALTER GEHT NICHT MEHR UEBER postboot.d ──────────────────
	#
	# HIER STAND:
	#     mv -f …/off_trigger.sh /var/lib/dietpi/postboot.d/off_trigger.sh
	# und genau das ist auf der Box .169 nie geschehen — AM GERAET NACHGESEHEN
	# (07.08.2026, nur lesend): /var/lib/dietpi/postboot.d/ enthaelt nichts
	# ausser readme.txt, und /usr/local/bin/mupibox/off_trigger.sh gibt es
	# nicht. Es hat NIEMAND GEMERKT, ueber Monate: der Knopf tat, was die
	# Platine von sich aus tut — bei 6 Sekunden den Strom hart wegnehmen —,
	# und das sah aus wie „so ist die Box eben".
	#
	# UND postboot.d KONNTE ES OHNEHIN NICHT TRAGEN. `/boot/dietpi/postboot`
	# ruft die Skripte dort nacheinander auf und WARTET auf ihr Ende;
	# off_trigger.sh endet nie (`while true`). Es haette den Rest von postboot
	# dauerhaft aufgehalten und dietpi-postboot.service auf „activating" stehen
	# lassen.
	#
	# JETZT: das Skript zu den anderen nach /usr/local/bin/mupibox/, gestartet
	# von mupi_offtrigger.service (weiter unten mit den uebrigen Units
	# ausgerollt und eingeschaltet). Das ist die Hausbauart, es steht in
	# `systemctl`, und ein Ausbleiben ist damit ZU SEHEN statt still.
	mv -f ${MUPI_SRC}/scripts/OnOffShim/off_trigger.sh /usr/local/bin/mupibox/off_trigger.sh >&3 2>&3
	# DER HELFER, DER DEN TASTER SIEHT. off_trigger.sh ruft kein `gpioget`
	# und kein `gpiomon` mehr — die kommen aus libgpiod 1.x, und Debian 13
	# liefert nur 2.x mit anderer Aufrufform (auf der Box .169 war `gpiod`
	# ueberhaupt nicht installiert, obwohl es in packages2install steht).
	# Der Helfer geht ueber python3-lgpio, dasselbe, worauf led_control.py
	# schon heute das Licht im Knopf treibt. Fehlt er, endet der Waechter
	# mit einer Meldung, statt still nichts zu tun.
	mv -f ${MUPI_SRC}/scripts/OnOffShim/taster_wache.py /usr/local/bin/mupibox/taster_wache.py >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/OnOffShim/poweroff.sh /usr/lib/systemd/system-shutdown/poweroff.sh >&3 2>&3
	chmod 775 /usr/lib/systemd/system-shutdown/poweroff.sh /usr/local/bin/mupibox/off_trigger.sh /usr/local/bin/mupibox/taster_wache.py >&3 2>&3
	# EIN ALTER STAND MUSS WEG. Auf einer Karte, die schon einmal mit dem
	# alten Rezept bespielt wurde, laege das Skript noch in postboot.d — dann
	# liefe der Waechter zweimal, zwei `gpiomon` straeuben sich um dieselbe
	# Leitung, und der Rest von postboot haengt weiter.
	rm -f /var/lib/dietpi/postboot.d/off_trigger.sh >&3 2>&3
	after=$(date +%s)
	echo -e "## Copy OnOffShim scripts ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nInstall Chromium-Kiosk... \nXXX"
	before=$(date +%s)
	echo -ne '\n' | /boot/dietpi/dietpi-software install 113 >&3 2>&3
	/boot/dietpi/dietpi-autostart 11 >&3 2>&3
	chmod +x /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh >&3 2>&3
	apt-get install xserver-xorg-legacy -y >&3 2>&3
	sed -i 's/allowed_users\=console/allowed_users\=anybody/g' /etc/X11/Xwrapper.config >&3 2>&3
	mv -f ${MUPI_SRC}/config/templates/98-dietpi-disable_dpms.conf /etc/X11/xorg.conf.d/98-dietpi-disable_dpms.conf >&3 2>&3
	sed -i 's/tty1/tty3 vt.global_cursor_default\=0 fastboot noatime nodiratime noram splash silent loglevel\=0 vt.default_red\=68,68,68,68,68,68,68,68 vt.default_grn\=175,175,175,175,175,175,175,175 vt.default_blu\=226,226,226,226,226,226,226,226/g' /boot/cmdline.txt >&3 2>&3
	sed -i 's/session    optional   pam_motd.so motd\=\/run\/motd.dynamic/#session    optional   pam_motd.so motd\=\/run\/motd.dynamic/g' /etc/pam.d/login >&3 2>&3
	sed -i 's/session    optional   pam_motd.so noupdate/#session    optional   pam_motd.so noupdate/g' /etc/pam.d/login >&3 2>&3
	sed -i 's/ExecStart\=-\/sbin\/agetty -a dietpi -J \%I \$TERM/ExecStart\=-\/sbin\/agetty --skip-login --noclear --noissue --login-options "-f dietpi" \%I \$TERM/g' /etc/systemd/system/getty@tty1.service.d/dietpi-autologin.conf >&3 2>&3
	/boot/dietpi/func/dietpi-set_hardware gpumemsplit 128 >&3 2>&3
	/boot/dietpi/func/dietpi-set_hardware headless 0 >&3 2>&3
	# The Pi 5 has ONLY the full-KMS driver (vc4-kms-v3d) and no legacy GL, so
	# disabling OpenGL there leaves it with no GPU driver -> a DSI panel stays
	# BLACK. Skip the disable on a Pi 5 (keeps KMS on); Pi 4 & older keep legacy.
	echo "${RASPPI}" | grep -qi 'Raspberry Pi 5' || /boot/dietpi/func/dietpi-set_hardware rpi-opengl disable >&3 2>&3
	su - -c ". /boot/dietpi/func/dietpi-globals && G_CHECK_ROOT_USER && G_CHECK_ROOTFS_RW && G_INIT && G_CONFIG_INJECT 'framebuffer_width=' \"framebuffer_width=800\" /boot/config.txt" >&3 2>&3
	su - -c ". /boot/dietpi/func/dietpi-globals && G_CHECK_ROOT_USER && G_CHECK_ROOTFS_RW && G_INIT && G_CONFIG_INJECT 'framebuffer_height=' \"framebuffer_height=480\" /boot/config.txt" >&3 2>&3
	after=$(date +%s)
	echo -e "## Install Chromium ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	# DER TONSTAPEL: PIPEWIRE STATT SYSTEM-PULSEAUDIO (BACKLOG E12/X6).
	#
	# WARUM DIESER SCHRITT HIER UNTEN STEHT UND NICHT OBEN BEI DEN PAKETEN:
	# alles, was vorher laeuft (dietpi-software 5/113, dietpi-set_hardware),
	# darf PulseAudio noch nachziehen. Erst wenn niemand mehr etwas
	# installiert, laesst sich sagen, was wirklich auf der Karte liegt.
	#
	# WAS DER UMSTIEG BRINGT (am Geraet erarbeitet 2026-07-27, seither auf dem
	# Pi 5 in Betrieb; Wiki mupi-pipewire-umstieg):
	#   * kein softvol-Startbehelf mehr. Der Regler "Master" aus
	#     /etc/asound.conf entsteht erst, wenn beim Booten etwas durch die
	#     Karte spielt — bei ausgeschaltetem Bluetooth-Lautsprecher also nie,
	#     und der Abspieldienst starb daran.
	#   * damit faellt auch die feste Verdrahtung `plughw:0` weg, die auf dem
	#     Pi 5 die falsche Karte treffen kann (Wiki: mupi-asound-hardcoded-card0).
	#   * ein ausgeschalteter Lautsprecher ist keine stumme Box mehr, sondern
	#     einfach keine Senke.
	#   * die pactl-Aufrufe in chromium-autostart.sh wirken wieder.
	#
	# DER RUECKWEG IST OFFEN, ABER ER HAT DREI SCHRITTE, NICHT ZWEI.
	# Hier stand, pulseaudio.service werde "weiter ausgeliefert (nur nicht mehr
	# eingeschaltet)", und der Rueckweg sei `systemctl enable --now
	# pulseaudio.service`. Das stimmt nur fuer die UNIT: die Datei kommt weiter
	# aus config/services/ (weiter unten), das PAKET aber wird ein paar Zeilen
	# tiefer entfernt. Ohne /usr/bin/pulseaudio endet der Rueckweg in einem
	# Dienst, der mit 203/EXEC scheitert — und wer ihn geht, hat gerade
	# asound.conf zurueckgeschoben und steht dann ganz ohne Ton da.
	# Vollstaendig ist er so (die Reihenfolge zaehlt: erst Paket, dann Dienst):
	#   apt-get install pulseaudio pulseaudio-module-bluetooth
	#   mv /etc/asound.conf.vor-pipewire /etc/asound.conf
	#   systemctl enable --now pulseaudio.service
	#   reboot
	# Die Feineinstellungen unter /etc/pulse/ bleiben beim `remove` erhalten
	# (kein `purge`), die sind also schon richtig.
	#
	# WENN PIPEWIRE NICHT DA IST, WIRD NICHTS UMGESTELLT. Dann bleibt
	# /etc/asound.conf liegen und die Karte faehrt wie bisher — eine halb
	# umgestellte Box waere schlimmer als eine unveraenderte.
	echo -e "XXX\n${STEP}\nSwitch audio stack to PipeWire... \nXXX"
	before=$(date +%s)
	if command -v wpctl >/dev/null 2>&1 && command -v pipewire >/dev/null 2>&1; then
		# PipeWire ist ein BENUTZERdienst. `--global` haengt die Sockets in die
		# Vorlage jeder kuenftigen Benutzersitzung — ohne das startet auf der
		# frischen Karte nie ein Tonserver, und librespot.service wartet seine
		# 20 s vergeblich (die Unit endet trotzdem mit exit 0).
		systemctl --global enable pipewire.socket pipewire-pulse.socket wireplumber.service >&3 2>&3
		# Bluetooth-Ton ohne aktive Sitzung erlauben. OHNE DIESE DATEI meldet
		# bluetoothctl 'br-connection-profile-unavailable', obwohl alles
		# installiert ist: die tty1-Anmeldung sitzt zwar auf seat0, ist aber
		# Active=no, weil X den Schirm auf tty2 uebernimmt (Wiki:
		# mupi-wireplumber-kein-bluetooth-ohne-seat).
		mkdir -p /etc/wireplumber/wireplumber.conf.d >&3 2>&3
		mv -f ${MUPI_SRC}/config/templates/80-bluez-ohne-seat.conf /etc/wireplumber/wireplumber.conf.d/80-bluez-ohne-seat.conf >&3 2>&3
		# Nur A2DP, kein Freisprech-Profil: HFP-Nachverbinde-Versuche hacken
		# den laufenden Ton ab (Begruendung in der Vorlage selbst).
		cp -f ${MUPI_SRC}/config/templates/81-bluez-nur-a2dp.conf /etc/wireplumber/wireplumber.conf.d/81-bluez-nur-a2dp.conf >&3 2>&3
		# Die Tonkarte regelt in Software — ihr Hardware-Regler ist eine
		# Attrappe (Begruendung in der Vorlage). Stand bis zum 25.09.2026 nur
		# im Rezept; eine autosetup-Box hatte den Regler, dessen Anzeige
		# stimmt und dessen Ton nicht.
		cp -f ${MUPI_SRC}/config/templates/82-karte-software-regler.conf /etc/wireplumber/wireplumber.conf.d/82-karte-software-regler.conf >&3 2>&3
		# /etc/asound.conf BEISEITE, nicht loeschen: erst dann greift
		# /usr/share/alsa/alsa.conf.d/99-pipewire-default.conf, und die legt
		# pcm.!default UND ctl.!default auf PipeWire. Genau deshalb wirkt auf
		# der laufenden Box auch das alte `amixer sset Master` ohne -c noch.
		if [ -f /etc/asound.conf ]; then mv /etc/asound.conf /etc/asound.conf.vor-pipewire >&3 2>&3; fi
		# OHNE LINGER STIRBT DER TON MIT DER SITZUNG (15.08.2026, Box .57,
		# einen Nachmittag lang gesucht): PipeWire ist ein BENUTZER-Dienst,
		# und der Benutzer-Manager von dietpi lebt nur, solange eine
		# logind-Sitzung offen ist. Der Kiosk zaehlt nicht als solche —
		# also lebte der Tonstapel exakt waehrend der SSH-Sitzungen der
		# Fehlersuche und starb mit deren Ende: Bluetooth-Endpunkte
		# flackerten, Verbinden schlug mit br-connection-profile-unavailable
		# fehl, und jede Messung "klappte", solange man hinsah. Linger haelt
		# systemd --user (und damit PipeWire/WirePlumber) dauerhaft am
		# Leben — der Standard-Handgriff fuer kopflosen Ton.
		loginctl enable-linger dietpi >&3 2>&3
		# Die Ueberall-Senke baut seit dem 15.08.2026 der SERVER als eigenen
		# pipewire-Prozess (die Mitglieder sind waehlbar, klang.json) — eine
		# statische 60-ueberall.conf DARF hier nicht mehr liegen, sonst gibt
		# es die Senke doppelt und die Auswahl greift ins Leere.
		mkdir -p /etc/pipewire/pipewire.conf.d >&3 2>&3
		rm -f /etc/pipewire/pipewire.conf.d/60-ueberall.conf >&3 2>&3
		# Der Equalizer ist eine Filterkette mit fuenf Baendern; die Regler
		# stellt der Server zur Laufzeit (Begruendung in der Vorlage selbst).
		cp -f ${MUPI_SRC}/config/templates/61-entzerrer.conf /etc/pipewire/pipewire.conf.d/61-entzerrer.conf >&3 2>&3
		# Die Leersenke des Mitschnitts (E66). Sie stand bis zum 25.09.2026 in
		# KEINEM Ausrollweg (AUDIT-2026-08-22 Rang 2) — der Leerlauf-Arbeiter
		# lief auf jeder ausgerollten Box ins Leere (Begruendung in der Vorlage).
		cp -f ${MUPI_SRC}/config/templates/62-mixpi-mitschnitt.conf /etc/pipewire/pipewire.conf.d/62-mixpi-mitschnitt.conf >&3 2>&3
		# DIE PLUGINS standen bis zum 22.08.2026 HIER, im PipeWire-Zweig —
		# eine Box, die bei ALSA/PulseAudio blieb, bekam gar keine
		# Erweiterungen. Der Aufruf steht jetzt NACH diesem if, wo er vom
		# Tonstapel unabhaengig ist.
		# PULSEAUDIO GANZ HERUNTER. Solange das Paket liegt, bringt es
		# /usr/lib/systemd/user/pulseaudio.{service,socket} mit — und die
		# beiden Verweise unter /etc/systemd/user/*.wants/ (siehe unten)
		# wuerden es in jeder Benutzersitzung hochziehen. Zwei Tonserver um
		# eine Soundkarte ist genau der Streit, den diese Box nur deshalb
		# nicht hat, weil PulseAudio dort von Hand entfernt wurde.
		systemctl disable --now pulseaudio.service >&3 2>&3
		apt-get --yes remove pulseaudio pulseaudio-module-bluetooth >&3 2>&3
		# INS LEERE ZEIGENDE VERWEISE WEGRAEUMEN (am 04.08.2026 auf der
		# laufenden Box gefunden). `[ -e ]` folgt dem Verweis: ist das Ziel
		# weg, ist die Bedingung falsch und der Verweis fliegt. Ein Verweis
		# auf eine VORHANDENE Unit bleibt unangetastet.
		for l in /etc/systemd/user/default.target.wants/pulseaudio.service \
		         /etc/systemd/user/sockets.target.wants/pulseaudio.socket; do
			[ -L "$l" ] && [ ! -e "$l" ] && rm -f "$l" >&3 2>&3
		done
		echo "## Tonstapel: PipeWire eingerichtet, wirkt nach dem Neustart ##" >&3 2>&3
	else
		echo "## WARNUNG: wpctl/pipewire fehlen - Tonstapel bleibt bei ALSA/PulseAudio, asound.conf bleibt liegen ##" >&3 2>&3
	fi
	# ── DIE PLUGINS: VERSIONIERT, UND UNABHAENGIG VOM TONSTAPEL (22.08.2026) ─
	#
	# Vorher stand die Kopie IM PipeWire-Zweig (eine ALSA-Box bekam nichts)
	# und arbeitete mit `cp -rn` — einmal ausgerollt wurde ein Plugin NIE
	# wieder aktualisiert, waehrend Server und Plugin-Vertrag weiterwanderten.
	# Beides erledigt jetzt mixpi-plugins-nachziehen.sh: kopiert Neues,
	# ersetzt bei hoeherer `fassung` (plugin.json), laesst Gleichstand und
	# Betreiber-Eigenes in Ruhe (Regeln + Probe: tools/mixpi-plugins-
	# nachziehen-probe.sh). KOPIERT IST NICHT AUFGERUFEN — deshalb steht der
	# Aufruf hier UND im Update-Weg; tools/ausrollweg-deckung.py prueft das.
	/usr/local/bin/mupibox/mixpi-plugins-nachziehen.sh "${MUPI_SRC}/plugins" >&3 2>&3 || echo "## plugin sync failed - Erweiterungen fehlen oder bleiben alt ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Audio stack ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nEnable and start services... \nXXX"
	before=$(date +%s)
	mv -f ${MUPI_SRC}/config/services/mupi_idle_shutdown.service /etc/systemd/system/mupi_idle_shutdown.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_splash.service /etc/systemd/system/mupi_splash.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/librespot.service /etc/systemd/system/librespot.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/templates/env-librespot /etc/librespot/env-librespot >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/pulseaudio.service /etc/systemd/system/pulseaudio.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_startstop.service /etc/systemd/system/mupi_startstop.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_wifi.service /etc/systemd/system/mupi_wifi.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_check_internet.service /etc/systemd/system/mupi_check_internet.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_check_monitor.service /etc/systemd/system/mupi_check_monitor.service >&3 2>&3
	# mupi_autoconnect_bt entfernt: das Skript wartete auf einen Prozess
	# "chromium-browser" (heisst hier "chromium", 0 Treffer) und rief
	# "bluetoothctl paired-devices", das BlueZ 5.82 nicht mehr kennt — an der
	# Box nachgemessen. Es war ausgeliefert-abgeschaltet und waere auch
	# eingeschaltet wirkungslos gewesen. Ersatz: mupibox-bt-reconnect.timer
	# aus dem remote-step-installer.
	mv -f ${MUPI_SRC}/config/services/mupi_vnc.service /etc/systemd/system/mupi_vnc.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_novnc.service /etc/systemd/system/mupi_novnc.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_powerled.service /etc/systemd/system/mupi_powerled.service >&3 2>&3
	# DER AUSSCHALTER AM KNOPF. Er loest die postboot.d-Zeile ab, die weiter
	# oben ausgebaut ist — die Begruendung steht dort und in der Unit selbst.
	mv -f ${MUPI_SRC}/config/services/mupi_offtrigger.service /etc/systemd/system/mupi_offtrigger.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_telegram.service /etc/systemd/system/mupi_telegram.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/dietpi-dashboard.service /etc/systemd/system/dietpi-dashboard.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_hat.service /etc/systemd/system/mupi_hat.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_hat_control.service /etc/systemd/system/mupi_hat_control.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_autoconnect-wifi.service /etc/systemd/system/mupi_autoconnect-wifi.service >&3 2>&3
	# WLAN-Energiesparmodus abschalten — sonst schlaeft das Funkmodul ein und
	# die Box faellt minutenlang aus dem Netz (Wiki mupi-wifi-powersave, am
	# Geraet 2026-07-25 dreimal erlebt). Der remote-step-installer setzt das
	# seit damals; dieser Weg hier liess es bis 2026-08-15 fallen — eine
	# frische autosetup-Karte hatte den Fehler also weiterhin.
	mv -f ${MUPI_SRC}/config/services/wifi-powersave-off.service /etc/systemd/system/wifi-powersave-off.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupi_mqtt.service /etc/systemd/system/mupi_mqtt.service >&3 2>&3
	# DIE FERNBEDIENUNG (E134, 06.09.2026). Sie greift das Eingabegeraet
	# exklusiv — ohne sie steuert eine gekoppelte BLE-Fernbedienung den
	# KIOSK-BROWSER: `Home` oeffnet dessen Startseite, auf der Box war das
	# google.com. Der Dienst startet auch ohne Fernbedienung sauber (er
	# endet dann und systemd wartet), kostet also nichts.
	mv -f ${MUPI_SRC}/config/services/mixpi-fernbedienung.service /etc/systemd/system/mixpi-fernbedienung.service >&3 2>&3
	# DIE KIOSK-REGELN (06.09.2026). Sie sperren den Browser auf die EIGENE
	# Adresse: eine durchgerutschte Home-Taste oeffnete sonst Chromiums
	# Startseite (auf der Box google.com), und von dort kam man mit einer
	# Fernbedienung nicht mehr weg. Die Datei lag bis dahin nur von Hand
	# auf der Box und haette kein Neuaufsetzen ueberlebt.
	mkdir -p /etc/chromium/policies/managed >&3 2>&3
	cp -f ${MUPI_SRC}/config/templates/chromium-kiosk-policy.json /etc/chromium/policies/managed/mixpibox-kiosk.json >&3 2>&3
	systemctl enable mixpi-fernbedienung.service >&3 2>&3
	# Die Zuordnung als VORLAGE, nie ueberschreibend: dort stehen die Tasten,
	# die jemand fuer SEINE Fernbedienung eingestellt hat.
	cp -n ${MUPI_SRC}/config/templates/fernbedienung.json /etc/mupibox/fernbedienung.json >&3 2>&3
	# DIE GERAETEPROFILE (E137, 09.09.2026): Vorbelegungen und SVG-Schemata
	# je Geraetesorte. Der Server liest sie aus /etc/mupibox/fernbedienungen
	# (/api/eingabegeraete/profile) — ohne dieses Verzeichnis ist die Liste
	# auf einer frischen Box leer. Anders als die Zuordnung eine Zeile
	# drueber sind das AUSGELIEFERTE Daten, keine Betreiber-Arbeit, deshalb
	# ueberschreibend (`cp -rf` wie bei den Kiosk-Regeln).
	mkdir -p /etc/mupibox/fernbedienungen >&3 2>&3
	cp -rf ${MUPI_SRC}/config/fernbedienungen/. /etc/mupibox/fernbedienungen/ >&3 2>&3
	# DER LUEFTER — gefunden beim Gegenlesen am 04.08.2026, mit
	# tools/ausrollweg-deckung.py, und es ist DIESELBE BAUART wie beim
	# librespot-Waechter eine Zeile weiter unten: die Unit lag seit langem in
	# config/services/, und KEIN Weg hat sie je ausgerollt — weder dieser noch
	# der Update-Weg. Das Skript kam an (scripts/fan/* geht oben mit), die Unit
	# nicht. Was daran schlimm ist, ist nicht die fehlende Datei, sondern der
	# SCHALTER, DER INS LEERE ZEIGT: AdminInterface/www/mupi.php ruft
	# `systemctl enable mupi_fan.service`, und src/backend-api/src/dienste.ts
	# fuehrt den Luefter ausdruecklich als ganz normale Wahlmoeglichkeit ("ein
	# 'abgeloest' daran waere eine Falschauskunft, die jemanden davon abhaelt,
	# den Luefter einzuschalten"). Auf einer frischen Karte hat systemd diese
	# Unit nicht, exec() wirft die Fehlermeldung weg, der Schalter sieht
	# danach aus wie an — und der Pi wird heiss.
	# NUR ANLEGEN, NICHT EINSCHALTEN: ein Luefter gehoert nicht an jede Box.
	# Die Unit ist inert, solange niemand sie enabled; genau so war es gedacht.
	mv -f ${MUPI_SRC}/config/services/mupi_fan.service /etc/systemd/system/mupi_fan.service >&3 2>&3
	# DER WAECHTER FUER LIBRESPOT (BACKLOG E12/X1). Beide Dateien lagen schon in
	# config/services/, aber kein Installationsweg hat sie je ausgerollt — nur
	# der remote-step-installer tat es, und damit hatten die laufenden Boxen
	# etwas, das eine frische SD nicht hatte.
	mv -f ${MUPI_SRC}/config/services/librespot-waechter.service /etc/systemd/system/librespot-waechter.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/librespot-waechter.timer /etc/systemd/system/librespot-waechter.timer >&3 2>&3
	# E42: SOLOIST-UNITS + ENGINE-DROP-IN. Die Unit-Quelle ist scripts/systemd/
	# — dort liegen sie seit dem 19.08. fuer Rezept und Handweg. EINE Quelle,
	# drei Wege; eine zweite Fassung unter config/services/ liefe auseinander
	# (tools/ausrollweg-deckung.py kennt beide Quellordner und meldet Doppel).
	mv -f ${MUPI_SRC}/scripts/systemd/soloist.service /etc/systemd/system/soloist.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-updater.service /etc/systemd/system/soloist-updater.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-updater.timer /etc/systemd/system/soloist-updater.timer >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-anmeldewache.service /etc/systemd/system/soloist-anmeldewache.service >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/soloist-anmeldewache.timer /etc/systemd/system/soloist-anmeldewache.timer >&3 2>&3
	# Das Drop-In haengt NUR die ExecCondition an librespot.service an, ohne
	# die Unit zu ersetzen — GENAU EINE Tonmaschine laeuft, der Schalter ist
	# spotify.engine in der Konfiguration (Vorgabe librespot, auch wenn der
	# Schluessel fehlt: der Rueckweg ist damit immer frei).
	mkdir -p /etc/systemd/system/librespot.service.d >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/librespot-engine.conf /etc/systemd/system/librespot.service.d/engine.conf >&3 2>&3
	# E131/C1: WLAN-ADAPTERWAHL — Unit + ifup-Riegel-Drop-in. Die Unit kannte
	# bis 06.09.2026 NUR der Handweg (scripts/systemd/einrichten.sh); eine
	# frische Karte verlor die Adapterwahl beim ersten Neustart. Der Riegel
	# laesst die ABGEWAEHLTE Karte gar nicht erst hochfahren (Bootzeit, kein
	# ARP-Flux-Fenster); seine Sicherheitsregel — nie die letzte Verbindung
	# sperren — beweist tools/mixpi-wlan-riegel.test.sh. Ohne Wahl-Datei
	# (/etc/mupibox/mixpi-wlan-adapter) sind beide wirkungslos.
	mv -f ${MUPI_SRC}/scripts/systemd/mixpi-wlan-adapter.service /etc/systemd/system/mixpi-wlan-adapter.service >&3 2>&3
	mkdir -p /etc/systemd/system/ifup@.service.d >&3 2>&3
	mv -f ${MUPI_SRC}/scripts/systemd/ifup-mixpi-wlan-riegel.conf /etc/systemd/system/ifup@.service.d/mixpi-wlan-riegel.conf >&3 2>&3
	systemctl enable mixpi-wlan-adapter.service >&3 2>&3
	# SICHTBARKEIT (BACKLOG E11c/S2 bis S4) — DIESELBE BAUART WIE DER LUEFTER
	# EINE ZEILE HOEHER, nur andersherum: hier lag nicht die Unit ohne Weg im
	# Repo, sondern sie lag ueberhaupt nicht im Repo. Die Boot-Animation stand
	# NUR im remote-step-installer, dort sogar als Zusatzschritt ([opt]). Am
	# 04.08.2026 am Geraet nachgesehen: beide Boxen haben
	# mupibox-boot-splash.service, mupi_splash.service haben sie gar nicht —
	# eine frisch aus diesem Repo bespielte Karte haette es genau umgekehrt.
	#
	# WAS SIE VERDECKT, IST GEMESSEN (tools/grundmessung.py, vier Kaltstarts):
	# 19,4 bis 23,8 s bis zum brauchbaren Bild, davon der Schirm durchgehend
	# SCHWARZ (heller Anteil 0,000). Eine Box, die im Kinderzimmer 20 Sekunden
	# nichts zeigt, ist fuer ein Kind kaputt.
	mv -f ${MUPI_SRC}/config/services/mupibox-boot-splash.service /etc/systemd/system/mupibox-boot-splash.service >&3 2>&3
	# ══ ANMELDUNGEN WARTEN NICHT AUFS WLAN (E59, 20.08.2026) ══════════════
	# VOLLE KOPIE der systemd-Unit, aus deren After= das network.target heraus
	# ist. Sie liegt in /etc/systemd/system/ und gewinnt damit gegen
	# /usr/lib/systemd/system/ — ein Drop-In genuegt NICHT, weil sich
	# Ordnungs-Abhaengigkeiten in systemd nicht leer zuruecksetzen lassen.
	# GEMESSEN an der Box: der Kiosk startete danach bei 2,98 s statt 8,17 s.
	# Er wartete zuvor ueber drei Ecken auf eine WLAN-Adresse (ifup@wlan0 ->
	# network.target -> systemd-user-sessions -> getty@tty1), um eine Seite
	# anzuzeigen, die auf localhost liegt.
	# KEIN `systemctl enable`: die Unit ersetzt eine bestehende, die systemd
	# ohnehin zieht. Nur ablegen und daemon-reload.
	mv -f ${MUPI_SRC}/config/services/systemd-user-sessions.service /etc/systemd/system/systemd-user-sessions.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-fehlerbild@.service /etc/systemd/system/mupibox-fehlerbild@.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-kioskwache.service /etc/systemd/system/mupibox-kioskwache.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-kioskwache.timer /etc/systemd/system/mupibox-kioskwache.timer >&3 2>&3
	# TOUCH-BRUECKE UND BT-WIEDERVERBINDEN (BACKLOG E12/X5) — beide Units lagen
	# bis heute NUR im remote-step-installer. Die Verwaltung fuehrt sie
	# trotzdem auf (src/backend-api/src/dienste.ts:249 und :266), also zeigten
	# zwei Schalter auf einer frischen Karte ins Leere.
	# mupibox-bt-reconnect.service hat bewusst KEIN [Install]: sie haengt am
	# Zeitgeber, genau wie librespot-waechter.service.
	mv -f ${MUPI_SRC}/config/services/mupibox-touch-bridge.service /etc/systemd/system/mupibox-touch-bridge.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-bt-reconnect.service /etc/systemd/system/mupibox-bt-reconnect.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-bt-reconnect.timer /etc/systemd/system/mupibox-bt-reconnect.timer >&3 2>&3
	# DIE BEIDEN DIENSTE, UM DIE SICH ALLES DREHT (neu hier am 14.08.2026).
	#
	# Sie lagen bis heute NUR im remote-step-installer, der sie im Schritt
	# `dienste-systemd` per Heredoc schrieb — `config/services/` kannte sie
	# nicht. Dieselbe Luecke wie bei der Touch-Bruecke ein paar Zeilen weiter
	# oben, nur folgenschwerer: es sind der Backend- und der Abspieldienst.
	# Solange sie fehlten, musste dieses Skript die App ueber pm2 starten, und
	# eine frische Karte lief dauerhaft anders als jede Box im Haus.
	# Nachzulesen in BACKLOG E12/X13(b), wo das Fehlen dieser beiden Dateien
	# schon einmal der Grund war, eine Zeile NICHT herausnehmen zu koennen.
	mv -f ${MUPI_SRC}/config/services/mupibox-server.service /etc/systemd/system/mupibox-server.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-player.service /etc/systemd/system/mupibox-player.service >&3 2>&3
	# SICHERN UND ZURUECKSPIELEN (BACKLOG E29). Sechs Units, vier Aufgaben:
	#   .service  legt einen Stand an und schiebt ihn auf die FAT-Partition
	#   .path     tut das, sobald sich mupiboxconfig.json aendert (B2 — das
	#             ist der einzige Weg, der auch dann greift, wenn der
	#             Update-Knopf sein Skript frisch von upstream holt)
	#   .timer    taeglich, als Boden fuer alles, was mupiboxconfig.json
	#             nicht anfasst (Bibliothek, gemerkte Stellen)
	#   mupibox-wiederherstellung.service  der Rueckweg von der Karte (B3)
	#   mupibox-sicherungsprobe.{service,timer}  faehrt diesen Rueckweg
	#             woechentlich gegen ein Wegwerf-Verzeichnis (B3, zweiter
	#             Halbsatz). Ohne sie merkt man einen unbrauchbar gewordenen
	#             Stand erst an dem Tag, an dem man ihn braucht.
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.service /etc/systemd/system/mupibox-sicherung.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.timer /etc/systemd/system/mupibox-sicherung.timer >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherung.path /etc/systemd/system/mupibox-sicherung.path >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-wiederherstellung.service /etc/systemd/system/mupibox-wiederherstellung.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherungsprobe.service /etc/systemd/system/mupibox-sicherungsprobe.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-sicherungsprobe.timer /etc/systemd/system/mupibox-sicherungsprobe.timer >&3 2>&3
	# DIE STANDWACHE — der Totmannschalter fuer die Auslieferung.
	#
	# `tools/ausliefern.py` legt beim Tausch eine Frist an; laeuft sie ab, ohne
	# dass jemand beweist, dass die Box laeuft, dreht diese Wache von selbst auf
	# den Stand von vorher zurueck. OHNE DEN ZEITGEBER IST DIE FRIST WERTLOS:
	# sie wird gestellt, und niemand sieht je nach. Deshalb steht das Anlegen
	# hier und das Einschalten weiter unten — beides gehoert auf JEDE frisch
	# bespielte Karte, nicht nur auf die eine Box, an der gerade jemand sitzt.
	mv -f ${MUPI_SRC}/config/services/mupibox-standwache.service /etc/systemd/system/mupibox-standwache.service >&3 2>&3
	mv -f ${MUPI_SRC}/config/services/mupibox-standwache.timer /etc/systemd/system/mupibox-standwache.timer >&3 2>&3
	# Das Verzeichnis, in dem die schwebende Frist und der mitgestellte Tauscher
	# liegen. root:root 755 ist Absicht — was hier steht, ist eine Anweisung, am
	# Betriebsstand zu drehen; der Webserver laeuft als dietpi und soll sie
	# nicht umschreiben koennen, auch nicht versehentlich.
	install -d -m 755 -o root -g root /var/lib/mupibox/stand >&3 2>&3
	systemctl daemon-reload >&3 2>&3
	# mupi_splash STEHT HIER NICHT MEHR. Es rief `fbv /boot/splash.png` auf und
	# zeigte EIN stehendes Bild; mupibox-boot-splash zeigt stattdessen einen
	# Balken aus erreichten Meilensteinen. Beide zugleich waere ein Streit um
	# /dev/fb0. Die Unit bleibt ausgeliefert, aber ausgeschaltet — wer das alte
	# Bild will, schaltet sie von Hand ein und die neue ab.
	# `pulseaudio` STEHT HIER NICHT MEHR (BACKLOG E12/X6). Die Unit-DATEI wird
	# weiter angelegt — sie ist der halbe Rueckweg; die andere Haelfte ist
	# `apt-get install pulseaudio`, denn das Paket ist oben entfernt worden
	# (die ganze Anleitung steht dort) —, aber eingeschaltet wird sie nicht. Beides
	# zugleich einzuschalten hiesse, zwei Tonserver um eine Soundkarte streiten
	# zu lassen; das ist genau der Zustand, den der Schritt oben verhindert.
	#
	# `smbd` STEHT HIER NICHT MEHR (BACKLOG E12/X13(c)) — und zwar nicht, weil
	# die Freigabe eine schlechte Idee waere, sondern weil sie NIE DA WAR.
	# AM GERAET GEMESSEN (04.08.2026, Box .169):
	#   systemctl is-enabled smbd  -> not-found
	#   ls /etc/samba              -> No such file or directory
	#   dpkg -l | grep samba       -> nur samba-libs (Abhaengigkeit), kein samba
	# Und im Rezept selbst: `packages2install` enthaelt kein samba, und es gibt
	# keinen `dietpi-software`-Aufruf dafuer. Alle drei samba-Schritte dieses
	# Skripts (smb.conf kopieren, smbpasswd setzen, smbd einschalten) sind also
	# seit jeher fehlgeschlagen — still, weil alles nach >&3 geht. Ein
	# `systemctl enable` auf eine Unit, die es nicht gibt, ist genau die Klasse
	# von E12/X10: ein Schalter, der ins Leere zeigt.
	#
	# WARUM HERAUSNEHMEN UND NICHT INSTALLIEREN: es waere nicht eine Zeile.
	# Es waere ein Paket, ein Dienst, der auf JEDER frisch bespielten Karte ins
	# Netz horcht, eine SCHREIBBARE Freigabe auf /home/dietpi/MuPiBox/media und
	# ein Passwort. Wem die Box gehoert, entscheidet das — nicht dieses Rezept.
	# DIE FRAGE AN DEN BETREIBER steht in BACKLOG E12/X13(c): soll die Box eine
	# Windows-Freigabe fuer die Medien anbieten? Wenn ja, gehoert `samba` in
	# `packages2install`, `config/templates/smb.conf` wieder nach /etc/samba,
	# und das Passwort in die Einrichtung statt in den Quelltext. Die Vorlage
	# bleibt bis dahin liegen; die Verwaltung kann `smbd`/`nmbd` weiterhin
	# schalten, sobald sie da sind (ERLAUBTE_EXTRA in dienste.ts).
	# `mupi_offtrigger` IST NEU IN DIESER REIHE (07.08.2026) und steht bewusst
	# in der Schleife, die auch STARTET: der Knopf soll noch waehrend der
	# Installation weich ausschalten koennen und nicht erst nach dem naechsten
	# Hochfahren. Es ist der einzige Dienst dieser Liste, dessen Fehlen man
	# nicht sieht, sondern spuert — man haelt den Knopf und es passiert nichts.
	# `wifi-powersave-off` steht in der Start-Schleife, weil der Energiespar-
	# modus SOFORT aus soll — die Installation haengt selbst am WLAN, und ein
	# einschlafendes Funkmodul wuerde sie mitten im Lauf abreissen.
	for service in mupi_wifi mupi_check_internet mupi_check_monitor mupi_idle_shutdown librespot mupi_startstop mupi_powerled mupi_offtrigger dietpi-dashboard wifi-powersave-off; do
		systemctl enable ${service}.service >&3 2>&3
		systemctl start ${service}.service >&3 2>&3
	done
	# NUR `enable`, EIGENE ZEILEN — und aus zwei verschiedenen Gruenden.
	# Die Touch-Bruecke gehoert an den naechsten Start: sie legt ein
	# Eingabegeraet an, und mitten in der Installation braucht das niemand.
	# Der Zeitgeber darf nicht in die Schleife oben, weil die ".service"
	# anhaengt — "mupibox-bt-reconnect.timer.service" gibt es nicht, und
	# systemctl sagt dazu nichts, was in >&3 noch auffiele.
	systemctl enable mupibox-touch-bridge.service >&3 2>&3
	systemctl enable mupibox-bt-reconnect.timer >&3 2>&3
	# DIE UHR MUSS SICH SELBST STELLEN (zeit-sync, 15.08.2026). Der Pi hat
	# keine Echtzeituhr: ohne NTP steht die Uhr nach jedem Einschalten auf dem
	# Stand des letzten Herunterfahrens (fake-hwclock). AM GERAET PASSIERT
	# (14.08.2026, Box .57): NTP war aus, die Box meldete zwei Tage alte
	# Zeitstempel, und die Frische-Pruefung der Sicherung hielt jede
	# Auslieferung auf — eine stehende Uhr sieht aus wie ein Werkzeugfehler
	# (Wiki: boxuhr-steht-ohne-ntp). Warum sie auf jener Box aus war, ist
	# offen; DIESE Zeile sorgt dafuer, dass es auf einer frischen Karte nicht
	# wieder vorkommt. `timedatectl set-ntp true` schaltet systemd-timesyncd
	# ein und uebersteht den Neustart.
	timedatectl set-ntp true >&3 2>&3
	# SICHERN (BACKLOG E29/B1). Das Verzeichnis zuerst — ein Dienst, der es
	# selbst anlegen muesste, laege als dietpi in einem Pfad, den es noch nicht
	# gibt. Erst danach einschalten, sonst faellt der erste Lauf durch.
	mkdir -p /home/dietpi/.mupibox/sicherungen >&3 2>&3
	chown dietpi:dietpi /home/dietpi/.mupibox/sicherungen >&3 2>&3
	chmod 700 /home/dietpi/.mupibox/sicherungen >&3 2>&3
	systemctl enable mupibox-sicherung.path >&3 2>&3
	systemctl enable mupibox-sicherung.timer >&3 2>&3
	# DER RUECKWEG VON DER KARTE (E29/B3): einschalten, aber nicht starten.
	# Ohne Marke auf der FAT-Partition tut die Unit ohnehin nichts
	# (ConditionPathExists) — sie muss nur DA sein, wenn sie einmal gebraucht
	# wird. Genau daran scheitern Rueckwege sonst: sie werden erst gebaut,
	# wenn man sie schon braucht, und dann kommt man nicht mehr an die Box.
	systemctl enable mupibox-wiederherstellung.service >&3 2>&3
	# DIE PROBE (E29/B3, zweiter Halbsatz): „eine Probe, die ihn REGELMAESSIG
	# faehrt — sonst merkt man den Fehler an dem Tag, an dem er nicht mehr zu
	# beheben ist." Woechentlich, sonntags nach dem taeglichen Stand.
	systemctl enable mupibox-sicherungsprobe.timer >&3 2>&3
	# EINEN ERSTEN STAND GLEICH JETZT. Eine frische Box hat sonst bis zum
	# ersten Zeitgeber-Lauf (4:17 Uhr) nichts, worauf sie zurueck koennte.
	sudo -u dietpi /usr/local/bin/mupibox/mupibox-sicherung.py --anlegen --grund erstinstallation --behalten >&3 2>&3
	/usr/local/bin/mupibox/mupibox-sicherung.py --auf-karte >&3 2>&3
	# … und ihn GLEICH PROBEN. Ein Rueckweg, der erst in einer Woche zum
	# ersten Mal gefahren wird, ist eine Woche lang unbelegt — und genau in
	# dieser Woche stellt sich heraus, ob die Installation ihn richtig
	# hingelegt hat. Faellt die Probe hier durch, sagt es das Protokoll.
	sudo -u dietpi /usr/local/bin/mupibox/mupibox-sicherungsprobe.sh >&3 2>&3 \
		|| echo "## Sicherungsprobe failed - Rueckweg NICHT belegt, siehe /home/dietpi/.mupibox/sicherungen/letzte-probe.txt ##" >&3 2>&3
	/usr/local/bin/mupibox/mupibox-sicherungsprobe.sh --auf-karte >&3 2>&3
	# NUR `enable`, NICHT `start` — und deshalb nicht in der Schleife oben:
	# Boot-Animation und Kioskwache gehoeren an den NAECHSTEN Start. Sie hier
	# zu starten hiesse, mitten in der Installation den Schirm zu uebernehmen —
	# und der zeigt gerade den Fortschrittsbalken der Installation.
	systemctl enable mupibox-boot-splash.service >&3 2>&3
	# EIGENE ZEILE FUER DEN ZEITGEBER — die Schleife oben haengt ".service" an;
	# ein Timer darin wuerde als "…timer.service" gesucht und still verfehlt.
	systemctl enable mupibox-kioskwache.timer >&3 2>&3
	# DIE STANDWACHE, aus demselben Grund in einer eigenen Zeile. Ohne dieses
	# `enable` waere die Frist, die `tools/ausliefern.py` beim Tausch stellt,
	# eine Frist, die niemand abwartet — ein toter Totmannschalter, und der ist
	# schlimmer als gar keiner, weil man sich auf ihn verlaesst.
	systemctl enable mupibox-standwache.timer >&3 2>&3
	# DAS FEHLERBILD ANHAENGEN (E11c/S3). KOPIERT IST NICHT AUFGERUFEN: das
	# Skript legt Zusatzstuecke (drop-ins) mit `OnFailure=` neben die Dienste.
	# Es muss NACH dem Anlegen der Units laufen — es ueberspringt, was es nicht
	# findet, und faende sonst nichts. Nicht fatal, wenn es fehlschlaegt: dann
	# gibt es eben kein Fehlerbild, aber eine Box.
	/usr/local/bin/mupibox/fehlerbild-anhaengen.sh >&3 2>&3 || echo "## fehlerbild-anhaengen failed - no error picture ##" >&3 2>&3
	# EIGENE ZEILE, WEIL DIE SCHLEIFE OBEN ".service" ANHAENGT. Ein Timer, den
	# man in diese Liste schreibt, wuerde als "librespot-waechter.timer.service"
	# gesucht — und stillschweigend nicht gefunden.
	systemctl enable librespot-waechter.timer >&3 2>&3
	systemctl start librespot-waechter.timer >&3 2>&3
	# E42: EIGENE ZEILEN AUS DEMSELBEN GRUND (der Zeitgeber!). soloist.service
	# wird NUR enabled, NIE gestartet: seine ExecCondition entscheidet, und
	# die Vorgabe ist librespot. Enabled sein muss er trotzdem — sonst wirkt
	# der Schalter in der Verwaltung nur bis zum naechsten Neustart
	# ("angelegt ist nicht eingeschaltet", dritte Etage).
	systemctl enable soloist.service >&3 2>&3
	systemctl enable soloist-updater.timer >&3 2>&3
	systemctl start soloist-updater.timer >&3 2>&3
	# E104: die Anmeldewache tickt IMMER mit (ihr Skript prueft selbst, ob
	# soloist ueberhaupt die gewaehlte Tonmaschine ist, und tut sonst nichts).
	systemctl enable soloist-anmeldewache.timer >&3 2>&3
	systemctl start soloist-anmeldewache.timer >&3 2>&3
	# Das Binary wird GEHOLT, nie mitgeliefert: jeder Soloist-Build verfaellt
	# 90 Tage nach dem BAU — ein eingefrorenes im Installationsbild waere bei
	# der Ankunft halb verfallen. Ohne Netz scheitert das laut und blockiert
	# nichts: die Vorgabe librespot braucht Soloist nicht, und der
	# woechentliche Timer versucht es wieder.
	[ -x /usr/local/bin/soloist ] || /usr/local/bin/mupibox/soloist-updater.sh >&3 2>&3 || echo "## soloist fetch failed - librespot bleibt die Tonmaschine ##" >&3 2>&3
	after=$(date +%s)
	echo -e "## Enable and start services ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nNetwork optimization... \nXXX"
	before=$(date +%s)
	cd /usr/local/bin/mupibox/ >&3 2>&3
	./optimize_wifi.sh >&3 2>&3
	after=$(date +%s)
	echo -e "## Network optimization ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nActivate SSL... \nXXX"
	before=$(date +%s)
	after=$(date +%s)
	echo -e "## Activate SSL ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n${STEP}\nFinalizing setup... \nXXX"
	before=$(date +%s)
	/usr/local/bin/mupibox/./m3u_generator.sh >&3 2>&3
	/usr/local/bin/mupibox/./setting_update.sh >&3 2>&3
	service librespot restart >&3 2>&3
	sudo -H -u dietpi bash -c "cd /home/dietpi/.mupibox/Sonos-Kids-Controller-master && npm install" >&3 2>&3
	# ── FRUEHER: `pm2 start server` + `pm2 save` (bis 14.08.2026) ─────────────
	#
	# Zwei Dinge waren daran falsch, und das zweite faellt erst spaeter auf:
	#
	# 1. pm2 statt systemd. Jede laufende Box faehrt Server und Abspieldienst
	#    seit dem 29.07.2026 als Units. Eine frische Karte tat es nicht.
	# 2. `pm2 start server` startete NUR den Server. Der Abspieldienst
	#    (spotify-control.js, Port 5005) wurde hier nie gestartet — obwohl das
	#    Skript sein Verzeichnis weiter oben anlegt und befuellt. Auf einer
	#    frisch bespielten Karte lief also bis zum ersten Neustart gar kein
	#    Abspieldienst, und danach nur, weil `pm2 save`/`pm2 startup` den
	#    Server wiederherstellten — den Player kannte pm2 gar nicht.
	#
	# `enable --now` ersetzt beides zugleich: es startet JETZT und traegt den
	# Dienst zugleich fuer den naechsten Start ein. Das ist genau die Aufgabe,
	# die bei pm2 auf `start` PLUS `save` PLUS `startup` verteilt war — drei
	# Schritte, von denen jeder einzeln vergessen werden konnte.
	#
	# NICHT in die `for`-Schleife weiter oben: die haengt ".service" an und
	# faehrt eine feste Liste; diese beiden gehoeren ans ENDE, wenn `npm
	# install` durch ist und die Dateien liegen. Ein Dienst, der startet,
	# bevor seine Abhaengigkeiten da sind, laeuft in Restart=on-failure.
	systemctl daemon-reload >&3 2>&3
	systemctl enable --now mupibox-server.service >&3 2>&3
	# ══ DIE BOX MUSS SICH IM NETZ MELDEN (20.09.2026) ════════════════════
	#
	# Betreiber: „es gibt immer wieder die frage welche ip, das muessen wir
	# doch besser hinbekommen." Die Antwort auf „welche IP" ist, dass man sie
	# gar nicht braucht: <name>.local findet die Box, egal welche Adresse der
	# DHCP gerade vergeben hat.
	#
	# INSTALLIERT WAR AVAHI BIS HEUTE AUF KEINEM DER BEIDEN WEGE. Dass die
	# Box im Haus trotzdem unter MixPiBox.local zu erreichen war, lag an
	# DietPi — also an Glueck, nicht an diesem Projekt. Auf einer frischen
	# Karte konnte es anders ausgehen, und niemand haette gewusst warum.
	#
	# `enable --now`, weil Installieren nicht Einschalten ist: ein Dienst, der
	# liegt und nicht laeuft, beantwortet keine einzige Anfrage.
	#
	# GEGENSTUECK: `remote-step-installer/recipes/perf-tune.yaml` bietet an,
	# avahi ABZUSCHALTEN — ausdruecklich „NUR wenn du die Box nicht per
	# <name>.local ansprichst". Wer das waehlt, nimmt sich die Auffindbarkeit;
	# das ist seine Entscheidung und steht dort so.
	systemctl enable --now avahi-daemon >&3 2>&3
	systemctl enable --now mupibox-player.service >&3 2>&3
	# LAUT SAGEN, WENN ES NICHT GEKLAPPT HAT. Alles hier geht nach >&3, also in
	# die Protokolldatei — ein stiller Fehlschlag an DIESER Stelle heisst: die
	# Box ist fertig installiert und zeigt trotzdem nichts an. Genau das war
	# der Fall, den [[pm2-reste-nach-der-systemd-umstellung]] „die teuerste
	# Sorte Umstellung" nennt.
	for dienst in mupibox-server mupibox-player; do
		systemctl is-active --quiet ${dienst}.service \
			|| echo "## ${dienst} is NOT active after enable --now - check 'journalctl -u ${dienst}' ##" >&3 2>&3
	done
	chown -R dietpi:dietpi /home/dietpi/.mupibox /home/dietpi/MuPiBox >&3 2>&3
	chown dietpi:dietpi ${CONFIG} >&3 2>&3
	after=$(date +%s)
	echo -e "## Finalizing setup ## finished after $((after - before)) seconds" >&3 2>&3
	STEP=$((STEP + 1))

	###############################################################################################

	echo -e "XXX\n100\nInstallation complete, please reboot the system... \nXXX"
	OS=$(grep -E '^(VERSION_CODENAME)=' /etc/os-release)
	OS=${OS:17}
	CPU=$(cat /proc/cpuinfo | grep Serial | cut -d ":" -f2 | sed 's/^ //')
	ARCH=$(uname -m)
	curl -X POST https://mupibox.de/mupi/ct.php -H "Content-Type: application/x-www-form-urlencoded" -d key1=${CPU} -d key2="Classic Installation" -d key3="${VERSION_LONG}" -d key4="${ARCH}" -d key5="${OS}" >&3 2>&3
	rm -Rf ${MUPI_SRC} >&3 2>&3
	mv ${LOG} /boot/autosetup.log > /dev/null 2>&3
	sleep 5

} | whiptail --title "MuPiBox Autosetup ${VERSION_LONG}" --gauge "Please wait while installing" 6 60 0

reboot
