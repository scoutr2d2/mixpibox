#!/usr/bin/env bash
# GEGENLESEN: HALTEN DIE NEUEN PRUEFUNGEN WIRKLICH ETWAS?
#
# Ein gruener Test, der nichts haelt, ist schlimmer als kein Test — er meldet
# Sicherheit, wo keine ist. Dieses Werkzeug kehrt die Frage um: es AENDERT
# genau die Zeile, die eine Pruefung schuetzen soll, und verlangt, dass sie
# daraufhin ROT wird. Bleibt sie gruen, ist die Pruefung eine Attrappe.
#
# Es wird IMMER zurueckgesetzt (trap), auch bei Abbruch — sonst bliebe eine
# mutierte Datei im Baum stehen.
set -u
cd /home/achim/Downloads/MuPiBox/src/backend-api || exit 1

EN=src/eigene-namen.ts
HK=src/herkunft.ts
SI=src/sicherung.ts
SICHER=$(mktemp -d)
cp "$EN" "$SICHER/en" ; cp "$HK" "$SICHER/hk" ; cp "$SI" "$SICHER/si"
zurueck() { cp "$SICHER/en" "$EN"; cp "$SICHER/hk" "$HK"; cp "$SICHER/si" "$SI"; }
trap zurueck EXIT INT TERM

SPECS="src/eigene-namen.spec.ts src/herkunft.spec.ts src/sicherung.spec.ts"
GRUEN=0; ROT=0

# $1 Beschreibung  $2 Datei  $3 alt  $4 neu
mutiere() {
  local was="$1" datei="$2" alt="$3" neu="$4"
  zurueck
  python3 - "$datei" "$alt" "$neu" <<'PY' || { echo "  !! Stelle nicht gefunden: $was"; ROT=$((ROT+1)); return; }
import sys
p, alt, neu = sys.argv[1], sys.argv[2], sys.argv[3]
t = open(p, encoding='utf-8').read()
if t.count(alt) != 1:
    sys.exit(1)
open(p, 'w', encoding='utf-8').write(t.replace(alt, neu))
PY
  if NODE_ENV=test npx tsx --test $SPECS >/dev/null 2>&1; then
    echo "  GRUEN GEBLIEBEN (die Pruefung haelt NICHTS): $was"
    GRUEN=$((GRUEN+1))
  else
    echo "  rot, wie es sein muss: $was"
    ROT=$((ROT+1))
  fi
}

echo "== Mutationen am Namensriegel =="

mutiere "Endungsregel oeffnet sich fuer JEDE Endung" "$EN" \
  "return RESERVIERTE_ENDUNGEN.includes(endung)" \
  "return endung.length > 0"

mutiere "der Punkt am Ende wird nicht mehr entfernt" "$EN" \
  "return t.replace(/\\.+\$/, '')" \
  "return t"

mutiere "verlaesslich ist immer wahr (auch ohne jedes Wissen)" "$EN" \
  "verlaesslich: netzGelesen && etwasGelernt," \
  "verlaesslich: true,"

mutiere "die Rueckschleife wird nicht mehr bedingungslos eingetragen" "$EN" \
  "  namen.add('localhost')" \
  "  if (q.rechnername) namen.add('localhost')"

mutiere "Zusatz MIT Punkt zaehlt doch als Marke" "$EN" \
  "if (n) dazu(n, !n.includes('.'))" \
  "if (n) dazu(n, true)"

mutiere "der Namensteil des Riegels faellt ganz aus" "$HK" \
  "if (eigene?.verlaesslich && wirSelbst && !istEigenerName(wirSelbst.rechner, eigene)) {" \
  "if (false && eigene?.verlaesslich && wirSelbst && !istEigenerName(wirSelbst.rechner, eigene)) {"

mutiere "ohne lesbaren Host wird doch abgewiesen" "$HK" \
  "if (eigene?.verlaesslich && wirSelbst && !istEigenerName(wirSelbst.rechner, eigene)) {" \
  "if (eigene?.verlaesslich && !(wirSelbst && istEigenerName(wirSelbst.rechner, eigene))) {"

echo
echo "GRUEN GEBLIEBEN (schlecht): $GRUEN   rot geworden (gut): $ROT"
[ "$GRUEN" -eq 0 ]
