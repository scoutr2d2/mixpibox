#!/bin/bash
# HABEN WIR ZU VIEL ZUGEMACHT? — das Update gegen Boeden, die es nicht erwartet.
#
# tools/update-bestand-probe.py fragt: „kommt der Bestand heil durch?"
# DIESES Werkzeug fragt die andere Haelfte:
#
#     Faellt das Update jetzt um, wo es frueher durchgelaufen waere?
#
# Der neue Block bricht an zwei Stellen ausdruecklich ab (`exit 1`), wo vorher
# ein fehlgeschlagenes `mv` bloss nach /dev/null lief und es weiterging. Jeder
# dieser Abbrueche ist richtig, WENN Daten auf dem Spiel stehen — und ein
# Rueckschritt, wenn eine Box, die nichts zu verlieren hat, deshalb kein
# Update mehr bekommt. Eine frisch aufgesetzte Box hat die meisten dieser
# Dateien NICHT.
#
# WIE GEMESSEN WIRD: die MARKIERTEN BLOECKE werden aus dem echten Skript
# geschnitten (dieselben Marken, die update-bestand-probe.py liest) und in
# einem Sandkasten unter $TMPDIR ausgefuehrt. Keine Nacherzaehlung. Danach
# wird nachgesehen, was im Baum steht.
#
# BERUEHRT DIE BOX NICHT: alles laeuft unter mktemp -d; MUPI_BAUM, MUPI_HORT
# und MUPI_ABBRUCH zeigen dorthin. Es wird kein Dienst geschaltet.
#
#     bash tools/update-frische-box-probe.sh
#
# Rueckgabewert 0, wenn jede Lage so ausging wie hier beschrieben.
set -u

SKRIPT="${MUPI_UPDATE_SKRIPT:-$(dirname "$0")/../update/start_mupibox_update.sh}"
[ -r "${SKRIPT}" ] || { echo "Skript nicht lesbar: ${SKRIPT}" >&2; exit 2; }

# DER RIEGEL VOR DER ERSTEN MESSUNG. `quelle()` packt den neuen Stand mit
# `zip` in eine deploy.zip; fehlt der Befehl, entsteht die Datei nicht, das
# Update findet nichts zum Auspacken — und die Probe meldete das als
# „ROT der neue Code ist ausgepackt", also als Befund am Update. Genau so
# stand sie am 25.08.2026 auf diesem Rechner: 19 gruen, 1 rot, und das Rot war
# ein fehlendes Paket. Ein fehlendes Werkzeug ist kein Befund; es ist ein
# Grund, gar nicht erst zu messen (llmwiki: `sonde-ohne-erreichbarkeitsriegel-urteilt-ueber-nichts`,
# dieselbe Regel wie fuer die Box-Sonden, nur fuer den Werkzeugkasten).
command -v zip >/dev/null 2>&1 || {
  echo "zip fehlt — ohne zip laesst sich der neue Stand nicht packen und die" >&2
  echo "Probe wuerde das Fehlen als roten Schritt am Update ausgeben." >&2
  echo "  Debian/DietPi:  sudo apt install zip" >&2
  exit 2
}

WERKSTATT="$(mktemp -d "${TMPDIR:-/tmp}/mupi-frische-box-XXXXXX")" || exit 2
case "${WERKSTATT}" in
	/tmp/*|/var/tmp/*|"${TMPDIR:-/tmp}"/*) : ;;
	*) echo "Sandkasten liegt nicht im Temp-Verzeichnis: ${WERKSTATT}" >&2; exit 2 ;;
esac
trap '[ -n "${MUPI_BEHALTEN:-}" ] || rm -rf "${WERKSTATT}"' EXIT

GRUEN=0; ROT=0

# ── DIE BLOECKE AUS DEM ECHTEN SKRIPT ────────────────────────────────────────
block() { # $1 = Markenname
	awk -v m="$1" '
		$0 ~ ">>> MUPI-BESTAND-" m "-ANFANG >>>" { an=1; next }
		$0 ~ "<<< MUPI-BESTAND-" m "-ENDE <<<"   { an=0 }
		an { print }
	' "${SKRIPT}"
}
for m in WERKZEUG WIEDERAUFNAHME BEISEITE TAUSCH; do
	if [ -z "$(block "$m")" ]; then
		echo "Block ${m} nicht gefunden — sind die Marken umbenannt worden?" >&2
		exit 2
	fi
done

# ── EIN LAUF ─────────────────────────────────────────────────────────────────
#
# $1 Name der Lage, $2 Funktion, die den Baum aufbaut, $3 die Bloecke,
# die gefahren werden (Leerzeichen-getrennt).
lauf() {
	local lage="$1" bauen="$2" bloecke="$3"
	local ort="${WERKSTATT}/${lage}"
	mkdir -p "${ort}"
	MUPI_ORT="${ort}" "${bauen}" "${ort}"

	local laeufer="${ort}/laeufer.sh"
	{
		echo '#!/bin/bash'
		echo 'set -u'
		echo "LOG=\"${ort}/log\""
		echo 'exec 3>${LOG}'
		echo "MUPI_BAUM=\"${ort}/baum\""
		echo "MUPI_HORT=\"${ort}/hort\""
		echo "MUPI_ABBRUCH=\"${ort}/.abgebrochen\""
		echo "MUPI_SRC=\"${ort}/quelle\""
		block WERKZEUG
		for b in ${bloecke}; do block "$b"; done
		echo 'exit 0'
	} > "${laeufer}"
	bash "${laeufer}" >"${ort}/aus" 2>"${ort}/err"
	echo $?
}

# ── DIE LAGEN ────────────────────────────────────────────────────────────────

# Eine BENUTZTE Box: server/config voll, active_theme.css als Verweis.
baue_benutzt() {
	local o="$1"
	mkdir -p "${o}/baum/server/config/profile/kalea" "${o}/baum/www/themes"
	echo '{"kinder":1}' > "${o}/baum/server/config/profile.json"
	echo '{"weiter":1}' > "${o}/baum/server/config/profile/kalea/resume.json"
	echo '[]'           > "${o}/baum/server/config/data.json"
	echo 'body{}'       > "${o}/baum/www/themes/lines.css"
	ln -s themes/lines.css "${o}/baum/www/active_theme.css"
	quelle "${o}"
}

# Eine FRISCH BESPIELTE Box: deploy.zip ist ausgepackt, aber server/config
# gibt es noch nicht — deploy.zip bringt darunter NICHTS mit (nachgesehen:
# nur server.js, spotify-control.js, www/, www-admin/), und autosetup legt
# es erst mit dem ersten `cp` an. Vor dem ersten Start des Servers ist dieser
# Zustand also echt.
baue_frisch() {
	local o="$1"
	mkdir -p "${o}/baum/www"
	echo 'alt' > "${o}/baum/server.js"
	quelle "${o}"
}

# Eine Box, der jemand server/config von Hand weggeraeumt hat — und die
# genau deshalb ein Update versucht.
baue_ohne_config() {
	local o="$1"
	mkdir -p "${o}/baum/server" "${o}/baum/www/themes"
	echo 'alt' > "${o}/baum/server.js"
	ln -s themes/lines.css "${o}/baum/www/active_theme.css"
	quelle "${o}"
}

# Der Baum ist ganz weg (Karte halb gestorben, Ordner umbenannt).
baue_kein_baum() {
	local o="$1"
	quelle "${o}"
}

# Ein abgebrochener frueherer Lauf: der Bestand liegt im Hort.
baue_abgebrochen() {
	local o="$1"
	mkdir -p "${o}/baum/www" "${o}/hort/config"
	echo '{"kinder":1}' > "${o}/hort/config/profile.json"
	ln -s themes/lines.css "${o}/hort/www_active_theme.css"
	quelle "${o}"
}

# Der neue Stand, den das Update auspacken wuerde.
quelle() {
	local o="$1"
	mkdir -p "${o}/quelle/config/templates" "${o}/quelle/bin/nodejs" "${o}/neu/www"
	echo '{}' > "${o}/quelle/config/templates/monitor.json"
	echo '{}' > "${o}/quelle/config/templates/www.json"
	echo 'neu' > "${o}/neu/server.js"
	( cd "${o}/neu" && zip -q -r "${o}/quelle/bin/nodejs/deploy.zip" . )
}

pruefe() { # $1 Text, $2 Bedingung-Ergebnis (0=gut)
	if [ "$2" = 0 ]; then echo "  ok    $1"; GRUEN=$((GRUEN+1))
	else echo "  ROT   $1"; ROT=$((ROT+1)); fi
}

echo "FAELLT DAS UPDATE JETZT UM, WO ES FRUEHER DURCHLIEF?"
echo

# ── 1. Die Gegenprobe: eine benutzte Box laeuft durch ────────────────────────
code=$(lauf benutzt baue_benutzt "BEISEITE TAUSCH")
o="${WERKSTATT}/benutzt"
echo "1. BENUTZTE BOX (die Gegenprobe — hier MUSS es durchlaufen)"
pruefe "das Skript laeuft durch (Rueckgabe ${code})" "$([ "${code}" = 0 ] && echo 0 || echo 1)"
pruefe "profile.json steht wieder im Baum" "$([ -f "${o}/baum/server/config/profile.json" ] && echo 0 || echo 1)"
pruefe "das Weiterhoeren des Kindes steht wieder im Baum" \
	"$([ -f "${o}/baum/server/config/profile/kalea/resume.json" ] && echo 0 || echo 1)"
pruefe "der Themenverweis steht wieder im Baum" "$([ -L "${o}/baum/www/active_theme.css" ] && echo 0 || echo 1)"
pruefe "der neue Code ist ausgepackt" "$(grep -q neu "${o}/baum/server.js" 2>/dev/null && echo 0 || echo 1)"
pruefe "kein Abbruchmerker" "$([ ! -e "${o}/.abgebrochen" ] && echo 0 || echo 1)"
echo

# ── 2. Frisch bespielte Box, server/config gibt es noch nicht ────────────────
code=$(lauf frisch baue_frisch "BEISEITE TAUSCH")
o="${WERKSTATT}/frisch"
echo "2. FRISCH BESPIELTE BOX (kein server/config — deploy.zip bringt keines mit)"
echo "   Rueckgabe ${code}; Meldung: $(head -c 120 "${o}/err" | tr '\n' ' ')"
pruefe "das Update BRICHT AB, statt weiterzumachen" "$([ "${code}" != 0 ] && echo 0 || echo 1)"
pruefe "es wurde NICHTS geloescht (der alte Baum steht noch)" \
	"$([ -f "${o}/baum/server.js" ] && echo 0 || echo 1)"
pruefe "der neue Code ist NICHT ausgepackt — die Box bleibt alt" \
	"$(grep -q alt "${o}/baum/server.js" 2>/dev/null && echo 0 || echo 1)"
pruefe "der Abbruch ist vermerkt, „Update finished\" kommt nicht" \
	"$([ -e "${o}/.abgebrochen" ] && echo 0 || echo 1)"
# DER SATZ MUSS SAGEN, WORAN ES LAG. Bis 07.08.2026 stand hier in JEDER der
# vier Abbruchlagen „server/config liess sich nicht … legen" — auch dann, wenn
# es schlicht keines gab. Wer das las, suchte Rechte und volle Datentraeger.
pruefe "der Satz nennt den WIRKLICHEN Grund (\"Es gibt kein …/server/config\")" \
	"$(grep -q 'Es gibt kein' "${o}/err" && echo 0 || echo 1)"
pruefe "der Satz sagt NICHT faelschlich, ein Verschieben sei gescheitert" \
	"$(grep -q 'liess sich nicht nach' "${o}/err" && echo 1 || echo 0)"
pruefe "der Satz nennt einen Schritt, den man tun kann" \
	"$(grep -qE 'einmaliger Start|legt ein leeres' "${o}/err" && echo 0 || echo 1)"
echo "   BEWERTUNG: Rueckschritt gegenueber vorher — dort lief das Update durch"
echo "   (das alte \`mv … /tmp/data.json\` scheiterte still) und die Box wurde neu."
echo "   Jetzt bekommt sie GAR KEIN Update mehr, obwohl es nichts zu verlieren gibt."
echo

# ── 3. Box, der jemand server/config weggeraeumt hat ─────────────────────────
code=$(lauf ohne_config baue_ohne_config "BEISEITE TAUSCH")
o="${WERKSTATT}/ohne_config"
echo "3. server/ GIBT ES, server/config NICHT"
pruefe "das Update bricht ab" "$([ "${code}" != 0 ] && echo 0 || echo 1)"
pruefe "nichts geloescht" "$([ -f "${o}/baum/server.js" ] && echo 0 || echo 1)"
echo

# ── 4. Der Baum ist ganz weg ─────────────────────────────────────────────────
code=$(lauf kein_baum baue_kein_baum "BEISEITE TAUSCH")
o="${WERKSTATT}/kein_baum"
echo "4. DEN BAUM GIBT ES GAR NICHT MEHR"
pruefe "das Update bricht ab, statt einen halben Baum zu bauen" \
	"$([ "${code}" != 0 ] && echo 0 || echo 1)"
pruefe "es wurde kein Baum angelegt" "$([ ! -d "${o}/baum" ] && echo 0 || echo 1)"
echo

# ── 5. Ein frueherer Lauf ist stehengeblieben ────────────────────────────────
code=$(lauf abgebrochen baue_abgebrochen "WIEDERAUFNAHME BEISEITE TAUSCH")
o="${WERKSTATT}/abgebrochen"
echo "5. EIN FRUEHERER LAUF IST STEHENGEBLIEBEN (Bestand liegt im Hort)"
pruefe "das Skript laeuft durch (Rueckgabe ${code})" "$([ "${code}" = 0 ] && echo 0 || echo 1)"
pruefe "profile.json ist zurueck im Baum" "$([ -f "${o}/baum/server/config/profile.json" ] && echo 0 || echo 1)"
pruefe "der Hort ist aufgeraeumt" "$([ ! -d "${o}/hort" ] && echo 0 || echo 1)"
echo

echo "${GRUEN} gruen, ${ROT} rot."
[ "${ROT}" = 0 ] || exit 1
exit 0
