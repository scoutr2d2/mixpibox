#!/bin/bash
#
# ══════════════════════════════════════════════════════════════════════════════
#  STILLGELEGT AM 31.08.2026 — DIESES SKRIPT MACHT AUS EINER KARTE DAS ORIGINAL
# ══════════════════════════════════════════════════════════════════════════════
#
# WAS ES TUT, wenn man es laesst: Es haengt in die `.bashrc` der frischen Box
# ein `curl -L …/splitti/MuPiBox/main/autosetup/autosetup.sh | sudo bash` und
# startet neu. Beim naechsten Anmelden laedt die Box also UPSTREAMS Installer
# und richtet sich damit ein.
#
# UND DAS IST DIE GEFAEHRLICHE SORTE: Der Riegel, der seit dem 31.08.2026 in
# `autosetup/autosetup.sh` steht, greift hier NICHT — dieses Skript benutzt die
# Datei ja nicht, es holt sich das Original frisch von GitHub. Ein Riegel in
# einer lokalen Datei haelt niemanden auf, der die Datei gar nicht anfasst.
# Dieselbe Bauart machte den Update-Knopf des alten PHP-Admins so teuer
# (`curl … start_mupibox_update.sh | sudo bash`).
#
# WARUM ES UEBERHAUPT NOCH DASTEHT: Es ruft niemand mehr — kein Ausrollweg,
# kein Rezept, kein Skript nennt es (nachgesehen am 31.08.2026; die Treffer auf
# „autostart" im Baum meinen alle `chromium-autostart.sh`, eine andere Datei).
# Es ist Erbe aus dem Ursprungsprojekt. Geloescht waere es aus der Historie
# schwerer zu erklaeren als hier mit dem Grund daneben.
#
# DER WEG FUER EINE FRISCHE KARTE liegt woanders und braucht kein Netz:
#     scripts/make-boot-sd.sh      # backt diesen Baum auf die Karte und
#                                  # setzt MUPI_LOCAL_SRC selbst
#
# DER RIEGEL IST EINE FRAGE UND KEIN VERBOT: Wer eine Box absichtlich mit der
# Serienfassung aufsetzen will, setzt MUPI_ZURUECK_ZUM_ORIGINAL=1 — dieselbe
# Variable wie in den beiden anderen Wegen, damit es nur eine zu kennen gibt.
#
if [ "${MUPI_ZURUECK_ZUM_ORIGINAL:-0}" != "1" ]; then
	echo "STILLGELEGT. Dieses Skript traegt einen Installer-Aufruf auf" >&2
	echo "splitti/MuPiBox in die .bashrc ein -- die Karte wuerde sich als" >&2
	echo "Serienfassung einrichten, nicht als MixPiBox." >&2
	echo >&2
	echo "Frische Karte statt dessen mit: scripts/make-boot-sd.sh" >&2
	echo >&2
	echo "Wer ABSICHTLICH das Original aufsetzen will:" >&2
	echo "    MUPI_ZURUECK_ZUM_ORIGINAL=1 $0 $*" >&2
	exit 1
fi

echo "echo '' && echo '' && echo 'Please wait, MuPiBox-Installer starts soon...' && sleep 10" >> /home/dietpi/.bashrc
echo "cd; curl -L https://raw.githubusercontent.com/splitti/MuPiBox/main/autosetup/autosetup.sh | sudo bash" >> /home/dietpi/.bashrc
reboot
