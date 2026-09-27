#!/usr/bin/env bash
# HALTEN DIE NEUEN TESTS UEBERHAUPT ETWAS?
#
# Ein gruener Test, der nichts haelt, ist schlimmer als kein Test: er sagt
# „geprueft" ueber eine Zeile, die man beliebig aendern kann. Dieses Werkzeug
# aendert je eine TRAGENDE Zeile und verlangt, dass der Lauf ROT wird.
#
# Es schreibt in Arbeitskopien und stellt sie mit `git checkout --` zurueck —
# deshalb bricht es ab, wenn die Datei schon geaendert ist.
#
#     bash tools/riegel-tests-haelt-was.sh
set -u
cd "$(dirname "$0")/.." || exit 2
BACK=src/backend-api

lauf() { # <specdatei>
  # NICHT `tail` VOR `grep`: bei einem roten Lauf steht am Ende der Stapelabzug,
  # und die Zusammenfassung rutscht aus dem Fenster. Genau so meldete dieses
  # Werkzeug im ersten Anlauf JEDE Zeile als „haelt nicht" — waehrend die Tests
  # in Wahrheit rot wurden. Ein Messwerkzeug, das immer dasselbe sagt, misst nichts.
  (cd "$BACK" && NODE_ENV=test npx tsx --test "src/$1" 2>&1 | grep -E '^(ℹ )?fail [0-9]+')
}

probe() { # <name> <datei> <spec> <sed-ausdruck>
  local name="$1" datei="$2" spec="$3" ausdruck="$4"
  if ! git diff --quiet -- "$BACK/src/$datei"; then
    echo "ABBRUCH: $datei ist schon geaendert — nicht anfassen."
    return
  fi
  sed -i "$ausdruck" "$BACK/src/$datei"
  if git diff --quiet -- "$BACK/src/$datei"; then
    echo " ROT  $name — der sed-Ausdruck hat NICHTS getroffen (Zeile nicht mehr da?)"
    return
  fi
  local ergebnis
  ergebnis="$(lauf "$spec")"
  git checkout -- "$BACK/src/$datei"
  local rot
  rot="$(echo "$ergebnis" | grep -oE 'fail [0-9]+' | grep -oE '[0-9]+' | head -1)"
  if [ "${rot:-0}" -gt 0 ]; then
    echo "  ok  $name -> $rot rot"
  else
    echo " ROT  $name -> NICHTS wurde rot. Der Test haelt diese Zeile nicht."
  fi
}

echo "── herkunft.ts ──"
probe "Port wird nicht mehr verglichen"        herkunft.ts  herkunft.spec.ts \
  "s/wer.rechner !== wir.rechner || wer.port !== wir.port/wer.rechner !== wir.rechner/"
probe "Origin: null wird durchgelassen"        herkunft.ts  herkunft.spec.ts \
  "s/if (origin.toLowerCase() === 'null')/if (false)/"
probe "Rechnername wird nicht mehr verglichen" herkunft.ts  herkunft.spec.ts \
  "s/wer.rechner !== wir.rechner || wer.port !== wir.port/wer.port !== wir.port/"
probe "cross-site ohne Origin kommt durch"     herkunft.ts  herkunft.spec.ts \
  "s/=== 'cross-site' \&\& !istSeitenwechsel(kopf)/=== 'niemals' \&\& !istSeitenwechsel(kopf)/"
probe "Rahmen zaehlt als Seitenwechsel"        herkunft.ts  herkunft.spec.ts \
  "s/=== 'navigate' \&\& String(kopf.ziel ?? '').toLowerCase() === 'document'/=== 'navigate'/"
probe "ACAO wird nicht mehr entfernt"          herkunft.ts  herkunft.spec.ts \
  "s/res.removeHeader('Access-Control-Allow-Origin')//"
probe "Vary: Origin faellt weg"                herkunft.ts  herkunft.spec.ts \
  "s/res.setHeader('Vary', 'Origin')//"

echo "── sicherung.ts: der verschluckte Kanal ──"
probe "Kopfzeile heisst anders"                sicherung.ts sicherung.spec.ts \
  "s/X-Mupi-Nicht-Eingeordnet/X-Mupi-Anders-Benannt/"
probe "das Feld unbekannt wird nicht gelesen"  sicherung.ts sicherung.spec.ts \
  "452s/d\['unbekannt'\]/d['gibtsnicht']/"

echo "── die eigene Reparatur: haelt der neue Test den Pfad? ──"
probe "der Pfad am r.use faellt wieder weg"    sicherung.ts sicherung.spec.ts \
  "s#r.use('/api/sicherung', (req: Request#r.use((req: Request#"
