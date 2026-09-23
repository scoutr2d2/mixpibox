#!/usr/bin/env bash
# PLUGIN-GERUEST-PROBE — taugt das Geruest, das wir Fremdentwicklern hinstellen?
#
# WARUM ES DIESE PROBE GIBT UND KEIN EINGECHECKTES BEISPIEL-PLUGIN: ein
# zweites Musterplugin im Baum waere eine KOPIE der Geruest-Vorlage — und
# Kopien driften. Nach der dritten Aenderung an der Vorlage waere das Beispiel
# das, was niemand mehr anfasst, und ein Fremdentwickler haette zwei Vorbilder,
# die sich widersprechen.
#
# Stattdessen wird das Geruest bei jedem Lauf frisch erzeugt, in einen
# Wegwerf-Ordner, und dort geprueft:
#
#   1. es entsteht ueberhaupt etwas
#   2. seine mitgelieferten Tests sind GRUEN — sofort, ohne eine Zeile Arbeit
#   3. der Kern nimmt es an (echter Worker, echtes Laufwerk, echte Riegel)
#   4. eine unbrauchbare Kennung wird abgewiesen, nicht kleingeschrieben
#
# Punkt 2 ist der eigentliche: ein Geruest, dessen Tests beim ersten Aufruf rot
# sind, kostet jeden Anfaenger den Abend mit der Frage, ob er selbst schuld ist.
#
# Aufruf:  bash tools/plugin-geruest-probe.sh
set -u

cd "$(dirname "$0")/.." || exit 1
WERK="$(mktemp -d /tmp/geruest-probe-XXXXXX)"
trap 'rm -rf "$WERK"' EXIT INT TERM
FEHLER=0

sagen() {
  if [ "$1" = "ok" ]; then echo "  ok   $2"; else echo " FEHL  $2"; FEHLER=$((FEHLER + 1)); fi
  [ -n "${3:-}" ] && echo "         $3"
  return 0
}

echo "Geruest-Probe"
echo

# ── 1. Anlegen ────────────────────────────────────────────────────────────
if node tools/plugin-geruest.mjs mupibox-probeling --name "Probeling" --ordner "$WERK" >/dev/null 2>&1; then
  sagen ok "Geruest angelegt"
else
  sagen fehl "Geruest angelegt" "der Aufruf endete mit einem Fehler"
  exit 1
fi

for d in plugin.json index.mjs index.spec.mjs; do
  if [ -f "$WERK/mupibox-probeling/$d" ]; then
    sagen ok "$d da"
  else
    sagen fehl "$d da" "fehlt"
  fi
done

# ── 2. Sind die mitgelieferten Tests GRUEN? ───────────────────────────────
AUSGABE="$(node --test "$WERK/mupibox-probeling/index.spec.mjs" 2>&1)"
if echo "$AUSGABE" | grep -qE "^(#|ℹ) fail 0"; then
  sagen ok "die mitgelieferten Tests sind sofort gruen" \
    "$(echo "$AUSGABE" | grep -E '^(#|ℹ) pass' | tr -d '#ℹ')"
else
  sagen fehl "die mitgelieferten Tests sind sofort gruen" \
    "$(echo "$AUSGABE" | grep -E "^(#|ℹ) (pass|fail)|not ok" | head -5)"
fi

# ── 3. Nimmt der KERN es an? ──────────────────────────────────────────────
# Das ist der Unterschied zwischen "meine Nachbildung ist zufrieden" und
# "die Box wuerde es laden".
if npx tsx tools/plugin-pruefen.mjs "$WERK/mupibox-probeling" >"$WERK/pruef.log" 2>&1; then
  sagen ok "der Kern nimmt es an (echter Worker)" "$(grep -c '^  ok' "$WERK/pruef.log") Pruefungen bestanden"
else
  sagen fehl "der Kern nimmt es an (echter Worker)" "$(grep -E '^ FEHL' "$WERK/pruef.log" | head -3)"
fi

# ── 4. Weist es Unsinn ab? ────────────────────────────────────────────────
# Eine Kennung wird zu einem Ordnernamen UND zu einem Stueck URL. Wer sie
# stillschweigend zurechtbiegt, legt ein Plugin an, das anders heisst als
# bestellt — und der Entwickler sucht den Unterschied spaeter im Betrieb.
UNSINN=0
for k in "Mupibox-Gross" "mit leerzeichen" ".." "ab" "1zahlvorn" "mupi/box"; do
  if node tools/plugin-geruest.mjs "$k" --ordner "$WERK" >/dev/null 2>&1; then
    echo "         ANGENOMMEN, haette abgewiesen werden muessen: \"$k\""
    UNSINN=$((UNSINN + 1))
  fi
done
if [ "$UNSINN" -eq 0 ]; then
  sagen ok "unbrauchbare Kennungen werden abgewiesen" "sechs Formen geprueft"
else
  sagen fehl "unbrauchbare Kennungen werden abgewiesen" "$UNSINN von 6 durchgelassen"
fi

# ── 5. Legt es nichts ueber Bestehendes ───────────────────────────────────
if node tools/plugin-geruest.mjs mupibox-probeling --ordner "$WERK" >/dev/null 2>&1; then
  sagen fehl "vorhandener Ordner bleibt unberuehrt" "es hat ein zweites Mal hineingeschrieben"
else
  sagen ok "vorhandener Ordner bleibt unberuehrt"
fi

echo
if [ "$FEHLER" -eq 0 ]; then
  echo "Das Geruest taugt."
else
  echo "$FEHLER Beanstandung(en)."
fi
exit "$FEHLER"
