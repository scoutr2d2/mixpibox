#!/bin/bash
# Test fuer `piper-einrichten.sh --ab-werk-an` (BACKLOG E12/X12).
#
# WOZU: Der Schalter schaltet Vorlesen auf einer FRISCHEN Box ein. Er darf das
# aber nur unter drei Bedingungen, und jede davon ist eine eigene Falle:
#   * nur mit dem Schalter — der Update-Weg ruft das Skript OHNE ihn, und eine
#     laufende Box ohne vorlesen.json darf danach nicht ploetzlich sprechen
#     (llmwiki `ein-neuer-schalter-darf-nichts-wegnehmen`);
#   * nur ohne vorhandene vorlesen.json — wer „aus" gewaehlt hat, bleibt aus;
#   * nur wenn Piper danach wirklich spricht — sonst hiesse „an" auf 32 Bit
#     (kein onnxruntime-Rad) einen Schalter, der an steht und nichts tut.
# Ein Geraetelauf braucht dafuer eine frische Karte und 20 Minuten Download.
# Hier laeuft das ECHTE Skript gegen einen Attrappen-venv: python und piper
# sind Stuempfe, die Stimme sind zwei leere Dateien.
#
# AUFRUF
#   tools/piper-ab-werk.test.sh

set -u
# PIPER_SKRIPT ist die Naht fuer die Gegenprobe: eine sabotierte KOPIE pruefen,
# statt das echte Skript anzufassen.
SKRIPT="${PIPER_SKRIPT:-$(cd "$(dirname "$0")/.." && pwd)/scripts/mupibox/piper-einrichten.sh}"
ARBEIT="$(mktemp -d /tmp/piper-ab-werk-test.XXXXXX)"
trap 'rm -rf "$ARBEIT"' EXIT

FEHLER=0
pruefe() {
	if [ "$2" = "$3" ]; then
		printf '  ok    %s\n' "$1"
	else
		printf '  NEIN  %s\n       erwartet: %s\n       bekommen: %s\n' "$1" "$3" "$2"
		FEHLER=$((FEHLER + 1))
	fi
}

STIMME=de_DE-ramona-low

# Ein Fall = ein eigener Baum. `bereit` = die Vorgabestimme liegt schon da;
# sonst scheitert der Download-Stumpf, und `bericht` zaehlt null Stimmen.
baum() {
	local fall="$ARBEIT/$1" bereit="$2"
	mkdir -p "$fall/venv/bin" "$fall/stimmen" "$fall/konfig"
	cat >"$fall/venv/bin/python" <<'ENDE'
#!/bin/bash
# `-c 'import flask'` gelingt; `-m piper.download_voices` scheitert (kein Netz).
[ "${1:-}" = "-c" ] && exit 0
exit 1
ENDE
	printf '#!/bin/bash\nexit 0\n' >"$fall/venv/bin/piper"
	chmod +x "$fall/venv/bin/python" "$fall/venv/bin/piper"
	if [ "$bereit" = ja ]; then
		: >"$fall/stimmen/$STIMME.onnx"
		: >"$fall/stimmen/$STIMME.onnx.json"
	fi
}

lauf() { # $1 = Fall, Rest = Argumente ans Skript; gibt den Rueckgabewert aus
	local fall="$ARBEIT/$1"
	shift
	env MUPIBOX_PIPER_VENV="$fall/venv" MUPIBOX_PIPER_STIMMEN="$fall/stimmen" \
		MUPIBOX_CONFIG_DIR="$fall/konfig" \
		MUPIBOX_PIPER_BESITZER="$(id -un):$(id -gn)" \
		bash "$SKRIPT" "$@" >"$fall/ausgabe" 2>&1
	echo $?
}

modus() { # der Modus, den die Datei traegt — oder `keine Datei`
	local f="$ARBEIT/$1/konfig/vorlesen.json"
	[ -e "$f" ] || { echo "keine Datei"; return; }
	python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["modus"])' "$f" 2>&1
}

echo "── 1. Frische Box, Piper spricht: Vorlesen ist danach an"
baum frisch ja
pruefe "Rueckgabe 0" "$(lauf frisch --ab-werk-an)" 0
pruefe "vorlesen.json traegt modus antippen" "$(modus frisch)" antippen
pruefe "und NUR den Modus (Stimme, Tempo kommen aus vorlesen.ts)" \
	"$(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$ARBEIT/frisch/konfig/vorlesen.json")" \
	"['modus']"
pruefe "keine halbe Datei liegen geblieben" "$(find "$ARBEIT/frisch/konfig" -name '*.neu.*' | wc -l)" 0

echo "── 2. Update-Weg: OHNE Schalter bleibt alles, wie es ist"
baum update ja
pruefe "Rueckgabe 0" "$(lauf update)" 0
pruefe "keine vorlesen.json angelegt" "$(modus update)" "keine Datei"

echo "── 3. Wer 'aus' gewaehlt hat, bleibt aus — auch mit Schalter"
baum gewaehlt ja
printf '{"modus":"aus","stimme":"%s","interpret":false,"tempo":1.3}\n' "$STIMME" \
	>"$ARBEIT/gewaehlt/konfig/vorlesen.json"
vorher=$(sha256sum <"$ARBEIT/gewaehlt/konfig/vorlesen.json")
pruefe "Rueckgabe 0" "$(lauf gewaehlt --ab-werk-an)" 0
pruefe "Datei byte-gleich" "$(sha256sum <"$ARBEIT/gewaehlt/konfig/vorlesen.json")" "$vorher"

echo "── 4. Piper spricht NICHT (keine Stimme): kein Schalter, der nichts tut"
baum stumm nein
pruefe "Rueckgabe 1 (wie bisher)" "$(lauf stumm --ab-werk-an)" 1
pruefe "keine vorlesen.json angelegt" "$(modus stumm)" "keine Datei"

echo "── 5. Kein Konfigurationsordner: nichts anlegen, nichts erfinden"
baum ohneordner ja
rmdir "$ARBEIT/ohneordner/konfig"
pruefe "Rueckgabe 0" "$(lauf ohneordner --ab-werk-an)" 0
pruefe "Ordner nicht angelegt" "$([ -e "$ARBEIT/ohneordner/konfig" ] && echo da || echo fehlt)" fehlt

echo "── 6. Die Pruefung bleibt Pruefung: --pruefen legt nichts an"
baum pruefen ja
pruefe "Rueckgabe 0" "$(lauf pruefen --pruefen)" 0
pruefe "keine vorlesen.json angelegt" "$(modus pruefen)" "keine Datei"

echo
if [ "$FEHLER" -eq 0 ]; then
	echo "piper-ab-werk: alle Faelle bestanden"
	exit 0
fi
echo "piper-ab-werk: ${FEHLER} Fall/Faelle NICHT bestanden"
exit 1
