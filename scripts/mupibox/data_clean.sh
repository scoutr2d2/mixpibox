#!/bin/bash
#
# data_clean.sh — raeumt Titelbilder und data.json auf.
#
# Aufgerufen von m3u_generator.sh, also von „Medien neu einlesen" in der
# Verwaltung UND von mupi_change_checker.service, sobald sich die
# Aenderungszeit eines Medienordners aendert. Es braucht keine Bedienung.
#
# ── DER FEHLER, DER HIER BIS ZUM 07.08.2026 STAND ───────────────────────────
#
# Fuer jeden Eintrag der eigenen Bibliothek stand hier unbedingt `add_item=0`;
# die Ordnerpruefung darueber war seit „Finalizing 2.0.0" (c0001b8b,
# 27.11.2022) auskommentiert. Jeder library-Eintrag flog also bei JEDEM Lauf
# aus data.json, und danach baute m3u_generator.sh nur wieder auf, was in
# diesem Augenblick als Ordner dastand. Zwei Folgen, beide ohne Weg zurueck:
#
#   1. Ein Werk, dessen Ordner gerade NICHT ERREICHBAR war — USB nicht
#      eingehaengt, Netzfreigabe weg, Ordner umbenannt — war danach spurlos
#      aus der Mediathek verschwunden.
#   2. Was wiederkam, kam NACKT zurueck: sortOrder, aPartOfAll, ein von Hand
#      korrigierter Titel, ein eigenes Titelbild — alles weg, weil neu
#      aufgebaut statt zusammengefuehrt wurde.
#
# ── WARUM DIE PRUEFUNG DAMALS AUSGESCHALTET WURDE, IST NICHT UEBERLIEFERT ───
#
# Der Commit heisst „Finalizing 2.0.0" und enthaelt sonst nur ein Bild; weder
# Nachricht noch Wiki noch Kommentar sagen etwas dazu. Sie ist deshalb NICHT
# einfach wieder eingeschaltet worden, sondern so gebaut, dass beide Faelle
# halten:
#
#   * Der einzige Schaden, den das BEHALTEN eines Eintrags gegenueber
#     `add_item=0` ueberhaupt anrichten kann, ist ein DOPPELTER Eintrag —
#     m3u_generator.sh erkannte „gibt es schon" an der Titelbild-Adresse, und
#     wessen Titelbild von Hand geaendert wurde, dessen Eintrag wurde nicht
#     wiedererkannt und ein zweites Mal angelegt. Das ist die einzige
#     Erklaerung, die zur Zeile passt. Genau dagegen prueft m3u_generator.sh
#     jetzt auf Kategorie/Interpret/Titel statt auf die Bildadresse.
#   * Und wenn es doch ein anderer Grund war: es faellt hier hoechstens noch
#     das weg, was WIRKLICH weg ist (siehe naechster Absatz) — nie mehr.
#
# ── „WEG" UND „GERADE NICHT DA" SIND VERSCHIEDENE DINGE ─────────────────────
#
# Ein Einhaengepunkt ohne Einhaengung sieht aus wie ein leerer Ordner. Eine
# Netzfreigabe, die nicht antwortet, sieht aus wie nichts — oder haengt. Wer
# das nicht unterscheidet, loescht die Mediathek, weil ein Stecker lose war.
# Unterschieden wird deshalb auf der Ebene der KATEGORIE, bevor ein einzelner
# Eintrag ueberhaupt beurteilt wird (siehe basis_taugt):
#
#     Kategorieordner fehlt      -> nichts faellt (die Basis ist weg)
#     Zugriff laeuft in die Frist-> nichts faellt (die Basis haengt)
#     Kategorieordner ist leer   -> nichts faellt (nicht unterscheidbar von
#                                   „nicht eingehaengt")
#     laut fstab Einhaengeziel,
#     aber nicht eingehaengt     -> nichts faellt
#     Kategorieordner hat Inhalt -> die Platte redet; JETZT darf ein einzelner
#                                   fehlender Ordner als geloescht gelten
#
# DIE GEGENPROBE GEHOERT DAZU: ein wirklich geloeschtes Werk MUSS weiterhin
# verschwinden. Ein Schutz, der auch das Richtige verhindert, wird umgangen.
# Deshalb faellt bei erreichbarer Basis ein fehlender Ordner wie bisher.
#
# ── UND VORHER WIRD GESICHERT ───────────────────────────────────────────────
#
# Faellt etwas, entsteht vorher `data-vor-aufraeumen-<zeit>.json` neben
# data.json — dieselbe Bauart, die /api/medien/aufraeumen benutzt (server.ts,
# aufraeumSicherungAnlegen), NICHT eine dritte. Damit ist der Rueckweg der
# gewohnte: die Verwaltung listet die Datei unter /api/medien/verfuegbarkeit
# und spielt sie ueber /api/medien/aufraeumen/zurueck wieder ein — am Geraet,
# ohne SSH.

set -u

# ── Die Orte ────────────────────────────────────────────────────────────────
# Ueberschreibbar AUSSCHLIESSLICH fuer die Probe (tools/medien-einlesen-probe.py).
# Auf der Box greift jedes Mal die Vorgabe.
CONFIG_DIR="${MUPI_CONFIG_DIR:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config}"
DATA="${MUPI_DATA:-${CONFIG_DIR}/data.json}"
COVER="${MUPI_COVER:-/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/cover}"
MEDIA="${MUPI_MEDIA:-/home/dietpi/MuPiBox/media}"
TMP_DATA="${MUPI_TMP_DATA:-/tmp/cleaned_data.json}"
SKRIPTE="${MUPI_SKRIPTE:-/usr/local/bin/mupibox}"
FSTAB="${MUPI_FSTAB:-/etc/fstab}"
MOUNTS="${MUPI_MOUNTS:-/proc/mounts}"
BESITZER="${MUPI_BESITZER:-dietpi:dietpi}"
# Wie lange ein Zugriff auf die Medienablage hoechstens dauern darf, bevor sie
# als „haengt" gilt. Eine tote NFS-Freigabe blockiert sonst bis zum Sankt-
# Nimmerleins-Tag, und der change_checker startet derweil den naechsten Lauf.
WARTE="${MUPI_WARTE:-5}"
# Drei genuegen — dieselbe Begruendung wie in server.ts: mehr ist auf einer
# SD-Karte Ballast.
SICHERUNGEN_BEHALTEN="${MUPI_SICHERUNGEN_BEHALTEN:-3}"

JQ="$(command -v jq || echo /usr/bin/jq)"

# ── Erreichbarkeit ──────────────────────────────────────────────────────────

# Ist der Pfad ein Ordner, und hat er innerhalb der Frist geantwortet?
# Rueckgabe 0 = ja. Alles andere (fehlt, ist kein Ordner, Frist abgelaufen)
# heisst hier NICHT „geloescht", sondern nur „kein Ja".
ordner_antwortet() {
	timeout "${WARTE}" test -d "$1"
}

# Steht der Pfad in /proc/mounts?
ist_eingehaengt() {
	local ziel="$1" quelle punkt rest
	[ -r "${MOUNTS}" ] || return 1
	while read -r quelle punkt rest; do
		[ -z "${punkt:-}" ] && continue
		if [ "${punkt//\\040/ }" = "${ziel}" ]; then
			return 0
		fi
	done < "${MOUNTS}"
	return 1
}

# Ist der Pfad als Einhaengeziel VORGESEHEN (fstab), aber gerade NICHT
# eingehaengt? Das ist der Fall, den man einem Ordner nicht ansieht: er ist
# da, er ist meistens leer, und was drin liegen sollte, liegt woanders.
einhaengeziel_ohne_einhaengung() {
	local ziel="$1" quelle punkt rest
	[ -r "${FSTAB}" ] || return 1
	while read -r quelle punkt rest; do
		[ -z "${punkt:-}" ] && continue
		case "${quelle}" in \#*) continue ;; esac
		if [ "${punkt//\\040/ }" = "${ziel}" ]; then
			ist_eingehaengt "${ziel}" && return 1
			return 0
		fi
	done < "${FSTAB}"
	return 1
}

# Hat der Ordner ueberhaupt einen Eintrag? Antwortet er nicht, gilt „nein".
hat_inhalt() {
	local gefunden
	gefunden=$(timeout "${WARTE}" find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)
	[ -n "${gefunden}" ]
}

# Taugt die Basis einer Kategorie als Grundlage fuer ein Urteil ueber einzelne
# Werke? Siehe die Tabelle im Kopf. Im Zweifel: NEIN — dann faellt nichts.
basis_taugt() {
	local d="${MEDIA}/$1"
	ordner_antwortet "${MEDIA}" || return 1
	einhaengeziel_ohne_einhaengung "${MEDIA}" && return 1
	ordner_antwortet "${d}" || return 1
	einhaengeziel_ohne_einhaengung "${d}" && return 1
	hat_inhalt "${d}" || return 1
	return 0
}

# Merker, damit basis_taugt nicht pro Eintrag erneut ueber eine lahme
# Freigabe stolpert.
declare -A BASIS_URTEIL=()
basis_taugt_gemerkt() {
	local kategorie="$1"
	if [ -z "${BASIS_URTEIL[${kategorie}]:-}" ]; then
		if basis_taugt "${kategorie}"; then
			BASIS_URTEIL[${kategorie}]="ja"
		else
			BASIS_URTEIL[${kategorie}]="nein"
		fi
	fi
	[ "${BASIS_URTEIL[${kategorie}]}" = "ja" ]
}

# ── Sicherung ───────────────────────────────────────────────────────────────
# Gleiche Bauart wie server.ts/aufraeumSicherungAnlegen — gleicher Name,
# gleiches Muster, gleiche Anzahl. Damit greift der vorhandene Rueckweg in der
# Verwaltung ohne eine einzige Zeile Zusatz.
sicherung_anlegen() {
	local stempel name
	stempel=$(date +%Y-%m-%dT%H-%M-%S)
	name="data-vor-aufraeumen-${stempel}.json"
	cp "${DATA}" "${CONFIG_DIR}/${name}" || return 1
	chown "${BESITZER}" "${CONFIG_DIR}/${name}" 2>/dev/null
	# Aeltere wegwerfen — erst NACH dem Anlegen, damit ein Fehlschlag oben nie
	# die vorhandenen Sicherungen mitnimmt.
	local alt
	while read -r alt; do
		[ -n "${alt}" ] && rm -f "${alt}"
	done < <(ls -1t "${CONFIG_DIR}"/data-vor-aufraeumen-*.json 2>/dev/null | tail -n +$((SICHERUNGEN_BEHALTEN + 1)))
	echo "[SICHERUNG] ${name}"
	return 0
}

# ── Titelbilder ─────────────────────────────────────────────────────────────
# Dieselbe Frage wie unten, derselbe Riegel: taugt die Basis nicht, wird auch
# kein Titelbild geloescht. Ein Bild, das ein Elternteil selbst hochgeladen
# hat, kommt nicht von allein zurueck.
echo "####    CHECKING COVER IMAGES    ####"
for kategorie in audiobook music; do
	if ! basis_taugt_gemerkt "${kategorie}"; then
		echo "[HALT]  ${kategorie}: Medienablage nicht beurteilbar — keine Titelbilder angefasst"
		continue
	fi
	for i in "${COVER}/${kategorie}/"* ; do
		[ -e "${i}" ] || continue
		artist=$(/usr/bin/basename "${i}")
		if [[ -d "${i}" ]]
		then
			echo "[OK]    ${artist}"
			for j in "${i}/"* ; do
				[ -e "${j}" ] || continue
				album=$(/usr/bin/basename "${j}")
				if [[ ! -f ${j} ]]
				then
					if ordner_antwortet "${MEDIA}/${kategorie}/${artist}/${album}"
					then
						echo "[OK]    ${artist}/${album}/"
					elif einhaengeziel_ohne_einhaengung "${MEDIA}/${kategorie}/${artist}/${album}" || einhaengeziel_ohne_einhaengung "${MEDIA}/${kategorie}/${artist}"
					then
						echo "[HALT]  ${artist}/${album}/ — Einhaengepunkt ohne Einhaengung"
					else
						echo "[DEL]   ${artist}/${album}/"
						rm -R "${j}"
					fi
				fi
			done
		else
			echo "[DEL]   ${i}"
			rm -R "${i}"
		fi
	done
done

# ── data.json ───────────────────────────────────────────────────────────────

if [ ! -f "${DATA}" ]; then
	echo "data.json fehlt (${DATA}) — nichts zu tun."
	exit 0
fi
if ! "${JQ}" -e 'type == "array"' "${DATA}" > /dev/null 2>&1; then
	# Kaputte oder halb geschriebene Datei: NICHT anfassen. Ein Lauf, der sie
	# jetzt „aufraeumt", macht aus einem Schreibfehler einen Datenverlust.
	echo "data.json ist keine brauchbare Liste — unangetastet gelassen."
	exit 1
fi

readarray -t my_array < <("${JQ}" -c '.[]' "${DATA}")
echo -e "\n####    CHECKING DATA.JSON    ####"

flags=""
faellt=0
for item in "${my_array[@]}"; do
	type=$("${JQ}" -r '.type // ""' <<< "$item")
	category=$("${JQ}" -r '.category // ""' <<< "$item")
	artist=$("${JQ}" -r '.artist // ""' <<< "$item")
	title=$("${JQ}" -r '.title // ""' <<< "$item")

	add_item=1
	grund=""
	if [ "${type}" = "library" ]; then
		if [ -z "${category}" ] || [ -z "${artist}" ] || [ -z "${title}" ]; then
			# Nicht beurteilbar — z. B. ein Eintrag, der fuer den ganzen
			# Interpreten steht. Ohne Pfad kein Urteil, also bleibt er.
			grund="unvollstaendig, nicht beurteilbar"
		elif ! basis_taugt_gemerkt "${category}"; then
			grund="Medienablage ${category} nicht beurteilbar"
		elif ordner_antwortet "${MEDIA}/${category}/${artist}/${title}"; then
			grund=""
		elif einhaengeziel_ohne_einhaengung "${MEDIA}/${category}/${artist}/${title}" \
			|| einhaengeziel_ohne_einhaengung "${MEDIA}/${category}/${artist}"; then
			grund="Einhaengepunkt ohne Einhaengung"
		else
			add_item=0
		fi
	fi

	if [ "${add_item}" -gt 0 ]; then
		flags="${flags}true,"
		if [ -n "${grund}" ]; then
			echo "[HALT]  ${type}    |    ${category}    |    ${artist}    |    ${title}    (${grund})"
		else
			echo "[OK]    ${type}    |    ${category}"
		fi
	else
		flags="${flags}false,"
		faellt=$((faellt + 1))
		echo "[DEL]   ${type}    |    ${category}    |    ${artist}    |    ${title}"
	fi
done
flags="[${flags%,}]"

if [ "${faellt}" -eq 0 ]; then
	echo "Nichts zu entfernen — data.json bleibt, wie sie ist."
else
	if ! sicherung_anlegen; then
		# Ohne Sicherung wird nicht geloescht. Lieber ein Eintrag zuviel als
		# einer, der nicht wiederkommt.
		echo "Sicherung fehlgeschlagen — es wird NICHTS entfernt."
		exit 1
	fi
	# Der Umbau geht ueber jq und nicht ueber Kommas von Hand: die Eintraege
	# werden UNVERAENDERT durchgereicht. Was ein Mensch gesetzt hat
	# (sortOrder, aPartOfAll, ein eigener Titel, ein eigenes Bild), bleibt
	# genau so stehen — der frueher hier gebaute Neuaufbau war der zweite
	# Verlustweg neben dem Loeschen.
	if ! "${JQ}" --argjson behalten "${flags}" \
		'[ to_entries[] | select($behalten[.key]) | .value ]' "${DATA}" > "${TMP_DATA}"; then
		echo "Umbau fehlgeschlagen — data.json unangetastet."
		exit 1
	fi
	if ! "${JQ}" -e 'type == "array"' "${TMP_DATA}" > /dev/null 2>&1; then
		echo "Ergebnis unbrauchbar — data.json unangetastet."
		exit 1
	fi
	cat "${TMP_DATA}" > "${DATA}"
	rm -f "${TMP_DATA}"
	chown "${BESITZER}" "${DATA}" 2>/dev/null
	echo "${faellt} Eintrag/Eintraege entfernt."
fi

bash "${SKRIPTE}/add_index.sh"
chown "${BESITZER}" "${DATA}" 2>/dev/null
