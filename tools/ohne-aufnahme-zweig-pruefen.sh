#!/usr/bin/env bash
# OHNE-AUFNAHME-ZWEIG PRUEFEN — die CI-Schritte auf dem Zweig fahren, aus dem
# tools/github-ohne-aufnahme.patch entsteht, BEVOR `--patch-aus` ihn einfriert.
#
# WARUM ES DAS GIBT (29.09.2026): Der Zweig `github-ohne-aufnahme` traegt EINEN
# Commit, der die Aufnahme-Erweiterung samt Verdrahtung entfernt (Wiki
# `github-fassung-ohne-aufnahme-per-patch`). Passt der Patch nicht mehr, bricht
# die Veroeffentlichung ab; dann wird der Zweig auf main neu aufgesetzt, auf
# ihm geprueft „wie die CI", und erst danach der Patch erneuert. Dieses Pruefen
# geschah bis heute von Hand — dreimal in zwei Tagen, jedes Mal mit einer
# anders zusammengetippten Befehlsliste. Was die CI auf GitHub prueft, steht in
# .github/workflows/ci.yml; genau das faehrt dieses Werkzeug, dazu die
# Typpruefung der Verwaltung (die CI baut sie nur).
#
# AUFRUF (aus dem Wurzelverzeichnis):
#     bash tools/ohne-aufnahme-zweig-pruefen.sh <arbeitsbaum-des-zweigs>
#     bash tools/ohne-aufnahme-zweig-pruefen.sh <arbeitsbaum> --mit-bau
#
# Den Arbeitsbaum legt man selbst an, NICHT im Hauptbaum auschecken (dort
# arbeiten parallele Sitzungen):
#     git worktree add <scratch>/ohne-aufnahme github-ohne-aufnahme
#     git -C <scratch>/ohne-aufnahme rebase main    # Konflikte: siehe Wiki
# Fehlen dort die node_modules, verlinkt das Werkzeug die des Hauptbaums
# (nur Links, nichts wird kopiert oder installiert).
#
# Rueckgabe 0 = alle Schritte gruen. Die Bilanzzeile am Ende lesen — hinter
# einer Pipe gehoert der Rueckgabewert `tail`.
set -u

HAUPT="$(cd "$(dirname "$0")/.." && pwd)"
BAUM="${1:-}"
MIT_BAU=0
[ "${2:-}" = "--mit-bau" ] && MIT_BAU=1

if [ -z "$BAUM" ] || [ ! -e "$BAUM/.git" ]; then
  echo "Aufruf: bash tools/ohne-aufnahme-zweig-pruefen.sh <arbeitsbaum-des-zweigs> [--mit-bau]" >&2
  exit 2
fi
BAUM="$(cd "$BAUM" && pwd)"
if [ "$BAUM" = "$HAUPT" ]; then
  echo "ABBRUCH: das ist der Hauptbaum. Den Zweig in einem eigenen Arbeitsbaum pruefen." >&2
  exit 2
fi

zweig=$(git -C "$BAUM" rev-parse --abbrev-ref HEAD)
# Der Zweig bildet die oeffentliche Fassung nur ab, wenn jede zurueckgehaltene
# ERWEITERUNG darin fehlt — sonst testet er Plugins mit, die GitHub nie sieht,
# und ihre Specs laufen ohne die Dateien, die der Zweig geloescht hat. Die
# Ordner kommen aus der Ausschlussliste selbst, nicht aus diesem Skript: wer
# dort eine Erweiterung nachtraegt, bekommt die Pruefung mit. Der typische
# Fall: main hat im Ordner der Erweiterung eine Datei NEU angelegt, und das
# Neu-Aufsetzen bringt sie ohne Konflikt in den Zweig (29.09.2026: zwei Specs).
rest=$(for ordner in $(grep -oE '^plugins/[a-z0-9-]+/' "$HAUPT/tools/github-ausschluss.txt"); do
  git -C "$BAUM" ls-files "$ordner"
done)
if [ -n "$rest" ]; then
  echo "ABBRUCH: im Zweig $zweig liegen noch Dateien zurueckgehaltener Erweiterungen:" >&2
  echo "$rest" | sed 's/^/    /' >&2
  echo "  Im Zweig per git rm loeschen und den Commit ergaenzen (git commit --amend)." >&2
  exit 1
fi

for d in node_modules src/backend-api/node_modules src/backend-player/node_modules src/frontend-admin/node_modules; do
  if [ ! -e "$BAUM/$d" ] && [ -d "$HAUPT/$d" ]; then
    ln -s "$HAUPT/$d" "$BAUM/$d"
  fi
done

FEHLER=0
GEBROCHEN=()
schritt() {
  local name="$1"; shift
  printf '%-44s' "$name"
  local ausgabe
  if ausgabe=$(cd "$BAUM" && "$@" 2>&1); then
    echo "ok"
  else
    echo "FEHLER"
    echo "$ausgabe" | tail -15 | sed 's/^/    /'
    FEHLER=$((FEHLER + 1))
    GEBROCHEN+=("$name")
  fi
}

browser_finden() {
  local k
  for k in "${CHROME_BIN:-}" \
           "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
           /usr/bin/chromium /usr/bin/chromium-browser \
           /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
    [ -n "$k" ] && [ -x "$k" ] && { echo "$k"; return 0; }
  done
  return 1
}
verwaltung_tests() {
  local browser
  if browser=$(browser_finden); then
    (cd src/frontend-admin && env CHROME_BIN="$browser" npx ng test --configuration ci --watch=false 2>&1) \
      | grep -qE "TOTAL: [0-9]+ SUCCESS"
  else
    echo "kein Browser gefunden - Verwaltungstests uebersprungen"
  fi
}

echo "Ohne-Aufnahme-Zweig $zweig ($(git -C "$BAUM" rev-parse --short HEAD)) in $BAUM"
echo "──────────────────────────────────────────────────────────────"
# Reihenfolge wie .github/workflows/ci.yml
schritt "Lint (Biome)"                     npm run lint
schritt "Typen backend-player"             npm run check-types --workspace=mupibox-backend-player
schritt "Typen backend-api"                npm run check-types --workspace=mupibox-backend-api
schritt "Typen Verwaltung"                 npx --prefix src/frontend-admin tsc --noEmit -p src/frontend-admin/tsconfig.app.json
schritt "Tests backend-api"                npm run test --workspace=mupibox-backend-api
schritt "Tests backend-player"             npm run test --workspace=mupibox-backend-player
schritt "Tests Plugins"                    npm run test:plugins
schritt "Fassungen/Signaturen --selbsttest" python3 tools/mixpi-github-fassung.py --selbsttest
schritt "Zieher-Sandkasten"                python3 tools/mixpi-zieher-probe.py
schritt "Gestalter: Formatkopie"           node tools/gestalter-format-bauen.mjs --pruefen
schritt "Gestalter: Katalog"               node tools/gestalter-katalog-deckung.mjs
schritt "Tests Verwaltung (Karma)"         verwaltung_tests
[ "$MIT_BAU" = 1 ] && schritt "Bau aller Bereiche" npm run build

echo "──────────────────────────────────────────────────────────────"
if [ "$FEHLER" = 0 ]; then
  echo "Zweig gruen. Weiter: python3 tools/github-veroeffentlichen.py --patch-aus $zweig, dann Trockenlauf."
else
  echo "$FEHLER Schritt(e) rot: ${GEBROCHEN[*]}"
fi
exit "$FEHLER"
