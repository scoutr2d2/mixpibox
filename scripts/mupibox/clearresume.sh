#!/bin/bash
#
# lösche alle Einträge mit Category resume.

DATA="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/resume.json"
DATA_LOCK="/tmp/.resume.lock"

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

if [ -f "${DATA_LOCK}" ]; then
	echo "Resume-file locked."
    exit
else
	touch ${DATA_LOCK}

	# ══ `cat >` UND NICHT `mv` (gerichtet 19.09.2026) ═══════════════════════
	#
	# HIER STAND `… > ${DATA}.tmp && mv ${DATA}.tmp ${DATA}`, und das war die
	# Ursache dafuer, dass ein Kind beim naechsten Profilwechsel seine
	# gemerkten Stellen verlor und fremde dazubekam.
	#
	# DIE KETTE, von tools/wer-hoert-wechsel-fremde-stellen.mjs nachgestellt:
	#   1. `server/config/resume.json` ist ein VERWEIS auf
	#      `profile/<aktiv>/resume.json`.
	#   2. `mv` ersetzt den VERWEIS durch eine gewoehnliche Datei — mit dem
	#      Bestand des Kindes, das gerade dran war.
	#   3. Beim naechsten `POST /api/profil/aktiv` richtet die Bruecke sich
	#      nach der schon gesetzten NEUEN Kennung und holt diese echte Datei
	#      in den Ordner des NEUEN Kindes. Das neue Kind erbt damit fremde
	#      Stellen und verliert seine eigenen.
	#
	# `cat >` FOLGT dem Verweis und schreibt in die Datei dahinter. Genau
	# deswegen steht es seit laengerem in `remove_max_resume.sh`; dort ist der
	# Grund ausfuehrlich aufgeschrieben. Dieses Skript wurde damals vergessen.
	#
	# DIE ZWISCHENDATEI BLEIBT: `jq` liest ${DATA}, und `cat > ${DATA}` im
	# selben Zug wuerde die Quelle leeren, bevor jq sie gelesen hat.
	jq 'map(select(.category != "resume"))' ${DATA} > ${DATA}.tmp \
		&& cat ${DATA}.tmp > ${DATA} \
		&& rm -f ${DATA}.tmp

	/usr/bin/chown dietpi:dietpi ${DATA}
	echo "Resume.json cleaned from resume"
	rm ${DATA_LOCK}
fi