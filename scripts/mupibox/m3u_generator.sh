#!/bin/bash
#
# m3u_generator.sh — Titelbilder, Wiedergabelisten und data.json aufbauen.
#
# Das ist „Medien neu einlesen" aus der Verwaltung — und dasselbe, was
# mupi_change_checker.service von selbst ruft, sobald sich die Aenderungszeit
# eines Medienordners aendert.
#
# ── ZWEI DINGE HABEN SICH AM 07.08.2026 GEAENDERT ───────────────────────────
#
# 1. data_clean.sh entfernt library-Eintraege nicht mehr bedingungslos (dort
#    steht die lange Begruendung). Eintraege UEBERLEBEN also jetzt einen Lauf.
#    Damit wird die Frage, die hier gestellt wird, erst wichtig: „gibt es den
#    Eintrag schon?" Sie wurde bisher an der TITELBILD-ADRESSE beantwortet
#    (grep auf .../cover.jpg). Wer sein eigenes Titelbild gesetzt hatte, dessen
#    Eintrag wurde damit nicht wiedererkannt — und ein zweiter, nackter Eintrag
#    kam daneben. Genau dieses Doppel ist die einzige Erklaerung, die dazu
#    passt, dass die Ordnerpruefung in data_clean.sh 2022 auskommentiert wurde.
#    Gefragt wird deshalb jetzt nach der IDENTITAET: Kategorie, Interpret,
#    Titel. Danach heisst „schon da" auch dann „schon da", wenn ein Mensch das
#    Bild, die Sortierung oder den Titel geaendert hat.
# 2. Die Orte stehen in Variablen. Damit laesst sich das Skript in einem
#    Sandkasten wirklich AUSFUEHREN (tools/medien-einlesen-probe.py) statt nur
#    gelesen zu werden.

DATA="${MUPI_DATA:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json}"
COVER="${MUPI_COVER:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/cover}"
MEDIA="${MUPI_MEDIA:-/home/dietpi/MuPiBox/media}"
SKRIPTE="${MUPI_SKRIPTE:-/usr/local/bin/mupibox}"
# ══ DAS ERSATZ-COVER ZEIGTE INS LEERE (20.08.2026) ═══════════════════════════
#
# Hier stand allein die MuPiLogo.jpg — und die gibt es auf dieser Box NICHT:
#
#     ls /home/dietpi/MuPiBox/sysmedia/images/
#     -> No such file or directory
#
# Sie kommt aus dem Ursprungsprojekt und wird nur von einer VOLLSTAENDIGEN
# autosetup-Installation dorthin kopiert; diese Box ist mit dem
# remote-step-installer gebaut. Ergebnis: `cp` scheiterte still, das Album
# blieb ohne cover.jpg — und genau das wurde am 20.08. gemeldet („es läd auch
# kein cover").
#
# DER RUECKFALL IST JETZT EIN MIXPI-BILD AUS DER OBERFLAECHE, das auf JEDER
# Box liegt, weil die Box ohne sie gar nicht anzeigt. Damit haengt das
# Ersatz-Cover an etwas, das da ist, statt an etwas, das da sein sollte.
LOGO="${MUPI_LOGO:-/home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg}"
[ -f "${LOGO}" ] || LOGO="/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/neu/bilder/mixpi-spielt.png"
BESITZER="${MUPI_BESITZER:-dietpi:dietpi}"
DATA_LOCK="${MUPI_DATA_LOCK:-/tmp/.data.lock}"
HN=`hostname`

# root ist noetig, WEIL in /home/dietpi/... geschrieben und chownt wird. Zeigen
# die Pfade woandershin, ist es ein Sandkasten und kein Systemlauf — dann
# nicht. Der Aufruf aus der Verwaltung geht ueber sudo mit festem Pfad
# (system.ts, AKTIONEN['medien-neu']) und bringt keine Umgebung mit.
if [ "$EUID" -ne 0 ] && [ -z "${MUPI_MEDIA:-}" ]
  then echo "Please run as root"
  exit
fi

# Gibt es zu diesem Werk schon einen Eintrag? Gefragt wird nach der Identitaet
# und NICHT nach der Bildadresse — sonst legt ein geaendertes Titelbild einen
# zweiten Eintrag daneben.
eintrag_vorhanden() {
	/usr/bin/jq -e --arg c "$1" --arg a "$2" --arg t "$3" \
		'any(.[]; .type == "library" and .category == $c and .artist == $a and .title == $t)' \
		"${DATA}" > /dev/null 2>&1
}

# ── Einen Eintrag anhaengen — der Ordnername geht als WERT hinein ────────────
#
# BIS ZUM 07.08.2026 WURDE ER IN DEN JQ-PROGRAMMTEXT GESPLEISST:
#
#   jq '. += [{… "artist": "'"${artist}"'" …}]'
#
# Ein Ordner, der ein Anfuehrungszeichen, einen Rueckstrich oder einen
# Zeilenumbruch im Namen traegt, macht daraus ein unvollstaendiges Programm.
# jq bricht ab, `$(…)` ist leer, und `cat <<< "" > ${DATA}` schreibt EINE
# LEERE ZEILE in data.json: die GANZE Bibliothek ist weg, auch alles, was mit
# diesem Ordner nichts zu tun hat. Gemessen an einem Ordner namens
#   Die "Kleine Hexe"
# in einem Sandkasten (tools/ordnername-angriff.py): data.json vorher mit
# Bestand, nachher 1 Byte. Es braucht dafuer keine Bedienung —
# mupi_change_checker ruft diesen Weg von selbst, sobald sich die
# Aenderungszeit eines Medienordners aendert. Ein Elternteil, das einen
# USB-Stick ansteckt, kommt am Geraet aus diesem Zustand nicht zurueck.
#
# EINE SHELL WAR ES NIE: der Name steht in doppelten Anfuehrungszeichen, und
# das Ergebnis einer Ersetzung wird nicht noch einmal nach Befehlen abgesucht.
# Der Schaden geht ausschliesslich ueber jq — und deshalb wird er hier
# ausschliesslich mit `--arg` behoben: `$a` ist ein WERT, kein Programmtext.
#
# Geschrieben wird ausserdem ueber eine Nebendatei und `mv`. `cat <<< $(…)`
# haelt die ganze Datei in einer Ersetzung, schneidet den letzten Zeilenumbruch
# ab und leert das Ziel schon beim Umlenken — auch dann, wenn das jq davor
# scheitert. Genau das war der Weg, auf dem die Bibliothek verschwand.
eintrag_anhaengen() {
	local kategorie="$1" artist="$2" titel="$3" mit_interpretenbild="$4"
	local neben="${DATA}.neu"
	if /usr/bin/jq \
		--arg c "${kategorie}" --arg a "${artist}" --arg t "${titel}" \
		--arg cover "http://${HN}:8200/cover/${kategorie}/${artist}/${titel}/cover.jpg" \
		--arg acover "http://${HN}:8200/cover/${kategorie}/${artist}/cover.jpg" \
		--argjson mitbild "${mit_interpretenbild}" \
		'. += [ {"type": "library", "category": $c, "artist": $a, "title": $t,
		         "cover": $cover}
		        + (if $mitbild == 1 then {"artistcover": $acover} else {} end) ]' \
		"${DATA}" > "${neben}"
	then
		mv "${neben}" "${DATA}"
	else
		# NICHTS ANFASSEN. Ein gescheitertes jq darf die Bibliothek nicht
		# kosten — lieber fehlt ein Eintrag, als dass alle fehlen.
		echo "[FEHLER] Eintrag ${kategorie}/${artist}/${titel} konnte nicht angehaengt werden — data.json bleibt unveraendert."
		rm -f "${neben}"
	fi
}

if [ -f "${DATA_LOCK}" ]; then
	echo "Data-file locked."
    exit
else
	touch ${DATA_LOCK}

	if [ ! -f "$DATA" ]; then
		echo "[]" > ${DATA}
	fi

	bash ${SKRIPTE}/data_clean.sh	

	for topFolder in "${MEDIA}/audiobook/"* ; do
		artist=$(/usr/bin/basename "${topFolder}")
		setArtistCover=0
		test4images=$(ls -1v "${topFolder}" | grep .jp*g)
		if [ ${#test4images} != 0 ]
		then
			/usr/bin/mkdir -p "${COVER}/audiobook/${artist}/" > /dev/null
			for i in "${topFolder}"/*.jp*g; do cp "$i" "${COVER}/audiobook/${artist}/cover.jpg"; break; done
			#/usr/bin/cp --update "${topFolder}"/*.jp*g "${COVER}/audiobook/${artist}/cover.jpg"
			setArtistCover=1
		fi	

		for i in "${topFolder}/"* ; do
			if [[ -d ${i} ]]
			then
				title=$(/usr/bin/basename "${i}")
				ls -1v "${i}" | grep '.mp3\|.flac\|.wav\|.wma\|.ogg\|.m4a' > /tmp/playlist.m3u
				mv /tmp/playlist.m3u "${i}"
				test4images=$(ls -1v "${i}" | grep .jp*g)
				if [ ${#test4images} != 0 ]
				then
					/usr/bin/mkdir -p "${COVER}/audiobook/${artist}/${title}/" > /dev/null
					for j in "${i}"/*.jp*g; do cp "$j" "${COVER}/audiobook/${artist}/${title}/cover.jpg"; break; done
					#/usr/bin/cp --update "${i}"/*.jp*g "${COVER}/audiobook/${artist}/${title}/cover.jpg"
				else
					if [ $setArtistCover == 1 ]
					then
						/usr/bin/mkdir -p "${COVER}/audiobook/${artist}/${title}/" > /dev/null
						for q in "${topFolder}"/*.jp*g; do cp "$q" "${COVER}/audiobook/${artist}/${title}/cover.jpg"; break; done
					else
						/usr/bin/mkdir -p "${COVER}/audiobook/${artist}/${title}/" > /dev/null
						[ -f "${LOGO}" ] && /usr/bin/cp "${LOGO}" "${COVER}/audiobook/${artist}/${title}/cover.jpg"
					fi
				fi


				# GEFRAGT WIRD NUR NOCH NACH DER IDENTITAET. Danebenstand bis
				# zum 07.08.2026 ein `grep` auf die Titelbild-Adresse, in das
				# der Ordnername als MUSTER ging: ein Punkt oder eine eckige
				# Klammer im Namen traf damit auch den Nachbarn, und das Werk
				# wurde still nie angelegt. Zwei Kriterien fuer dieselbe Frage
				# sind eines zu viel.
				if ! eintrag_vorhanden "audiobook" "${artist}" "${title}"
				then
					eintrag_anhaengen "audiobook" "${artist}" "${title}" "${setArtistCover}"
				fi
			fi
		done
	done

	for topFolder in "${MEDIA}/music/"* ; do
		artist=$(/usr/bin/basename "${topFolder}")
		setArtistCover=0
		test4images=$(ls -1v "${topFolder}" | grep .jp*g)
		if [ ${#test4images} != 0 ]
		then
			/usr/bin/mkdir -p "${COVER}/music/${artist}/" > /dev/null
			for i in "${topFolder}"/*.jp*g; do cp "$i" "${COVER}/music/${artist}/cover.jpg"; break; done
			#/usr/bin/cp --update "${topFolder}"/*.jp*g "${COVER}/music/${artist}/cover.jpg"
			setArtistCover=1
		fi	

		for i in "${topFolder}/"* ; do
			if [[ -d ${i} ]]
			then
				title=$(/usr/bin/basename "${i}")
				ls -1v "${i}" | grep '.mp3\|.flac\|.wav\|.wma\|.ogg\|.m4a' > /tmp/playlist.m3u
				mv /tmp/playlist.m3u "${i}"
				test4images=$(ls -1v "${i}" | grep .jp*g)
				if [ ${#test4images} != 0 ]
				then
					/usr/bin/mkdir -p "${COVER}/music/${artist}/${title}/" > /dev/null
					for j in "${i}"/*.jp*g; do cp "$j" "${COVER}/music/${artist}/${title}/cover.jpg"; break; done
					#/usr/bin/cp --update "${i}"/*.jp*g "${COVER}/music/${artist}/${title}/cover.jpg"
				else
					if [ $setArtistCover == 1 ]
					then
						/usr/bin/mkdir -p "${COVER}/music/${artist}/${title}/" > /dev/null
						for q in "${topFolder}"/*.jp*g; do cp "$q" "${COVER}/music/${artist}/${title}/cover.jpg"; break; done
					else
						/usr/bin/mkdir -p "${COVER}/music/${artist}/${title}/" > /dev/null
						[ -f "${LOGO}" ] && /usr/bin/cp "${LOGO}" "${COVER}/music/${artist}/${title}/cover.jpg"
					fi
				fi


				# GEFRAGT WIRD NUR NOCH NACH DER IDENTITAET. Danebenstand bis
				# zum 07.08.2026 ein `grep` auf die Titelbild-Adresse, in das
				# der Ordnername als MUSTER ging: ein Punkt oder eine eckige
				# Klammer im Namen traf damit auch den Nachbarn, und das Werk
				# wurde still nie angelegt. Zwei Kriterien fuer dieselbe Frage
				# sind eines zu viel.
				if ! eintrag_vorhanden "music" "${artist}" "${title}"
				then
					eintrag_anhaengen "music" "${artist}" "${title}" "${setArtistCover}"
				fi
			fi
		done
	done

	for topFolder in "${MEDIA}/other/"* ; do
		artist=$(/usr/bin/basename "${topFolder}")
		setArtistCover=0
		test4images=$(ls -1v "${topFolder}" | grep .jp*g)
		if [ ${#test4images} != 0 ]
		then
			/usr/bin/mkdir -p "${COVER}/other/${artist}/" > /dev/null
			for i in "${topFolder}"/*.jp*g; do cp "$i" "${COVER}/other/${artist}/cover.jpg"; break; done
			#/usr/bin/cp --update "${topFolder}"/*.jp*g "${COVER}/other/${artist}/cover.jpg"
			setArtistCover=1
		fi	

		for i in "${topFolder}/"* ; do
			if [[ -d ${i} ]]
			then
				title=$(/usr/bin/basename "${i}")
				ls -1v "${i}" | grep '.mp3\|.flac\|.wav\|.wma\|.ogg\|.m4a' > /tmp/playlist.m3u
				mv /tmp/playlist.m3u "${i}"
				test4images=$(ls -1v "${i}" | grep .jp*g)
				if [ ${#test4images} != 0 ]
				then
					/usr/bin/mkdir -p "${COVER}/other/${artist}/${title}/" > /dev/null
					for j in "${i}"/*.jp*g; do cp "$j" "${COVER}/other/${artist}/${title}/cover.jpg"; break; done
					#/usr/bin/cp --update "${i}"/*.jp*g "${COVER}/other/${artist}/${title}/cover.jpg"
				else
					if [ $setArtistCover == 1 ]
					then
						/usr/bin/mkdir -p "${COVER}/other/${artist}/${title}/" > /dev/null
						for q in "${topFolder}"/*.jp*g; do cp "$q" "${COVER}/other/${artist}/${title}/cover.jpg"; break; done
					else
						/usr/bin/mkdir -p "${COVER}/other/${artist}/${title}/" > /dev/null
						[ -f "${LOGO}" ] && /usr/bin/cp "${LOGO}" "${COVER}/other/${artist}/${title}/cover.jpg"
					fi
				fi


				# GEFRAGT WIRD NUR NOCH NACH DER IDENTITAET. Danebenstand bis
				# zum 07.08.2026 ein `grep` auf die Titelbild-Adresse, in das
				# der Ordnername als MUSTER ging: ein Punkt oder eine eckige
				# Klammer im Namen traf damit auch den Nachbarn, und das Werk
				# wurde still nie angelegt. Zwei Kriterien fuer dieselbe Frage
				# sind eines zu viel.
				if ! eintrag_vorhanden "other" "${artist}" "${title}"
				then
					eintrag_anhaengen "other" "${artist}" "${title}" "${setArtistCover}"
				fi
			fi
		done
	done

	/usr/bin/chown -R "${BESITZER}" "${MEDIA}/" 2>/dev/null
	/usr/bin/chown -R "${BESITZER}" "${COVER}/" 2>/dev/null
	/usr/bin/chown "${BESITZER}" ${DATA} 2>/dev/null
	rm ${DATA_LOCK}

	bash ${SKRIPTE}/add_index.sh

	echo "Cover & Playlists generated"
fi