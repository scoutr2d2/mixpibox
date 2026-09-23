#!/usr/bin/env bash
# PLUGIN-GEGENPROBE — machen die neuen Tests auch ROT?
#
# Ein gruener Test beweist nichts, solange niemand gesehen hat, wie er faellt.
# Diese Probe macht jede Schutzvorrichtung des Plugin-Skeletts EINZELN kaputt
# und verlangt, dass genau dann ein Test fehlschlaegt. Bleibt er gruen, deckt
# er die Vorrichtung nicht — dann ist sie ungeprueft, egal wie gruen der Lauf
# vorher aussah.
#
# ZWEI ARTEN ZU SCHEITERN, UND SIE BEDEUTEN NICHT DASSELBE:
#
#   rot     der Test lief und hat widersprochen. Der Normalfall.
#   haengt  der Test kam nicht zurueck. Bei der FRIST ist das der richtige
#           Befund und nicht etwa ein Mangel des Skripts: nimmt man die Frist
#           weg, wartet der Aufruf an einer Endlosschleife fuer immer. Genau
#           davor schuetzt sie. (Diese Probe hat beim ersten Bauen das Skript
#           selbst zum Haengen gebracht — daher die Zeitgrenze unten.)
#
# Aufruf:  bash tools/plugin-gegenprobe.sh
set -u

cd "$(dirname "$0")/.." || exit 1
API=src/backend-api
export MUPIBOX_PLUGIN_FRIST_MS=1500
# Grosszuegig: der langsamste ehrliche Lauf (plugin-wirt) braucht ~12 s.
FRIST=90
FEHLER=0

# EINE FALLE FUER DEN ABBRUCH. Ohne sie bleibt bei Strg-C eine absichtlich
# kaputtgemachte Quelldatei im Baum liegen — und der naechste Testlauf sucht
# einen Fehler, den dieses Skript hinterlassen hat.
aufraeumen() {
  for sicherung in "$API"/src/*.gegenprobe; do
    [ -e "$sicherung" ] && mv "$sicherung" "${sicherung%.gegenprobe}"
  done
}
trap aufraeumen EXIT INT TERM

# $1 Beschreibung, $2 Datei, $3 sed-Ausdruck, $4 Testdatei
probe() {
  local was="$1" datei="$2" schnitt="$3" test="$4" ausgang
  cp "$datei" "$datei.gegenprobe"
  sed -i "$schnitt" "$datei"

  if cmp -s "$datei" "$datei.gegenprobe"; then
    echo " FEHL  $was"
    echo "       der Schnitt griff gar nicht — sed-Ausdruck veraltet?"
    FEHLER=$((FEHLER + 1))
    mv "$datei.gegenprobe" "$datei"
    return
  fi

  (cd "$API" && timeout "$FRIST" npx tsx --test "$test" >/dev/null 2>&1)
  ausgang=$?
  mv "$datei.gegenprobe" "$datei"

  case "$ausgang" in
    0)
      echo " FEHL  $was"
      echo "       kaputtgemacht, und die Tests blieben GRUEN — ungeprueft."
      FEHLER=$((FEHLER + 1))
      ;;
    124)
      echo "  ok   $was"
      echo "       kaputtgemacht -> Test HAENGT (kommt nach ${FRIST}s nicht zurueck)."
      ;;
    *)
      echo "  ok   $was"
      echo "       kaputtgemacht -> Test wird rot."
      ;;
  esac
}

echo "Gegenprobe des Plugin-Skeletts"
echo

# 1. Die Kinderzeit VOR dem Aufloesen — der teuerste Fehler waere, sie zu
#    ueberspringen.
probe "Kinderzeit-Pruefung vor dem Aufloesen" \
  "$API/src/spielweg.ts" \
  's/if (!vorher.erlaubt) {/if (false) {/' \
  src/spielweg.spec.ts

# 2. Die ZWEITE Frage nach dem Aufloesen. Faellt sie weg, beginnt die
#    Wiedergabe nach dem Zubettgehen, wenn das Aufloesen lange genug dauerte.
probe "zweite Kinderzeit-Frage nach dem Aufloesen" \
  "$API/src/spielweg.ts" \
  's/if (!nachher.erlaubt) {/if (false) {/' \
  src/spielweg.spec.ts

# 3. Die Medienwurzel. Ohne sie ist /etc/shadow ein Abspielbefehl.
probe "Medienwurzel-Riegel in fundPruefen" \
  "$API/src/plugin-vertrag.ts" \
  's/^      if (rein !== wurzel/      if (false \&\& rein !== wurzel/' \
  src/plugin-vertrag.spec.ts

# 4. Der Rechte-Riegel: ohne ihn bekaeme jedes Plugin `holen`, egal was in
#    seinem Manifest steht.
probe "Rechte entscheiden ueber den Kontext" \
  "$API/src/plugin-laufwerk.ts" \
  "s/if (manifest.rechte.includes('netz')) {/if (true) {/" \
  src/plugin-wirt.spec.ts

# 5. Die Frist gegen die Endlosschleife. Erwartet wird HAENGT, nicht rot.
probe "Frist gegen die Endlosschleife" \
  "$API/src/plugin-wirt.ts" \
  's/^const FRIST_MS = .*/const FRIST_MS = 2_000_000_000/' \
  src/plugin-wirt.spec.ts

# 6. Der Zaun gegen den kurzen Weg zur eigenen Box.
probe "Zaun gegen 127.0.0.1 im Plugin-Netz" \
  "$API/src/plugin-laufwerk.ts" \
  "s/if (wirt === 'localhost' || wirt === '::1' || wirt.startsWith('127.')) {/if (false) {/" \
  src/plugin-wirt.spec.ts

# 7. Der Stapel bleibt drinnen. Dieser Fehler ist AM GERAET aufgefallen, nicht
#    hier — die alte Fassung schickte `e.stack` nach draussen und alle Tests
#    blieben gruen, weil jeder auf das prueft, was DRINSTEHT. Der Schnitt macht
#    genau die alte Fassung wieder.
probe "Stapel bleibt im Journal, nicht in der Antwort" \
  "$API/src/plugin-laufwerk.ts" \
  's/meldung: kurz(e), spur: spurVon(e) }/meldung: spurVon(e), spur: spurVon(e) }/' \
  src/plugin-wirt.spec.ts

# 8. Ein Abschalten, das sich selbst rueckgaengig macht. Der exit-Behandler
#    startet ein gestorbenes Plugin neu — kennt er den Zustand `aus` nicht,
#    faehrt er das gerade abgeschaltete sofort wieder hoch. Genau so war es,
#    und der Test hat es gefunden.
probe "Abschalten haelt gegen den Neustart-Behandler" \
  "$API/src/plugin-wirt.ts" \
  "s/if (code === 0 || e.zustand === 'gescheitert' || e.zustand === 'aus') return/if (code === 0 || e.zustand === 'gescheitert') return/" \
  src/plugin-wirt.spec.ts

echo
if [ "$FEHLER" -eq 0 ]; then
  echo "Alle Vorrichtungen sind wirklich geprueft."
else
  echo "$FEHLER Vorrichtung(en) ohne deckenden Test."
fi
exit "$FEHLER"
