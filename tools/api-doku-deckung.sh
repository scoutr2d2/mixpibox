#!/usr/bin/env bash
# API-DOKU-DECKUNG — welche REST-Endpunkte des Backends in keiner Doku stehen.
#
# WARUM ES DAS GIBT (23.08.2026): tools/doku-luecken-probe.sh prueft Plugins,
# Rechte, Ereignisse, Konfigurationsfelder und Verwaltungsseiten — also alles,
# was ein MENSCH in der Oberflaeche sieht. Die REST-Schnittstelle stand in
# KEINER Probe. Sie ist aber das Einzige, was ein LLM oder ein Skript benutzt,
# um die Box ohne die Verwaltung zu steuern: 195 Endpunkte, und
# dokumentation/mixpibox.md nennt genau sieben davon (alle aus `/api/stroeme`).
# Ein eigenes Kapitel zur Schnittstelle gab es dort nicht.
#
# DIE FALLE, DIE DIE ERSTE FASSUNG STELLTE: Express schreibt Platzhalter als
# `:kennung`, die Handbuecher schreiben BEISPIELE. plugins/README.md fuehrt
# `/api/plugins/mupibox-wled/einstellungen` — ein wortwoertlicher Vergleich
# mit `/api/plugins/:kennung/einstellungen` findet das nicht und meldet eine
# Luecke, die keine ist. Darum wird jeder `:xyz`-Abschnitt zu `[^/]+`
# aufgeweitet und mit grep -E gesucht.
#
# EIN TREFFER IN EINER DER VIER DATEIEN REICHT, anders als bei den Rechten in
# der grossen Probe. Ein Endpunkt ist kein Kapitel: wo er steht, ist zweitrangig,
# solange er ueberhaupt irgendwo steht. Wer je Datei getrennt pruefte, verlangte
# `/api/mupihat/batterie` auch vom Benutzerhandbuch und meldete auf Dauer rot.
#
# Aufruf aus dem Wurzelverzeichnis:  bash tools/api-doku-deckung.sh
# Rueckgabe: 0 = alle Endpunkte genannt, 1 = mindestens einer fehlt.

set -u
cd "$(dirname "$0")/.." || exit 2

QUELLEN="src/backend-api/src"
DOKUS=(
  dokumentation/mixpibox.md
  dokumentation/benutzerhandbuch.html
  plugins/README.md
  llmwiki/pack.yaml
)

for d in "${DOKUS[@]}"; do
  if [ ! -f "$d" ]; then
    echo "  WARNUNG: $d nicht gefunden — ist die Doku umgezogen?"
    exit 2
  fi
done

# app.get('/api/x', …) / r.post("/api/y", …) — die Backticks sind dabei,
# weil einzelne Routen als Template-Literal geschrieben sind.
#
# ZWEI ERWEITERUNGEN AM 25.08.2026, beide an einem Fund gemessen (siehe Kopf):
#   * JEDER EMPFAENGER, nicht nur `app` und `router`. `sicherung.ts` haengt
#     seine Wege an einen Router, der schlicht `r` heisst — vier Routen waren
#     unsichtbar, und die Wache meldete darueber "195 von 195 genannt".
#     Gegen Falschtreffer (`map.get('env')`) schuetzt jetzt der verlangte
#     Schraegstrich am Anfang; er hat nebenbei `env` aus der Liste geworfen.
#   * UEBER ZEILENGRENZEN (perl -0777 statt grep). `/api/sicherung/pruefen`
#     steht als eigene Zeile hinter der offenen Klammer — die fuenfte
#     unsichtbare Route, und die einzige, die ein ARCHIV entgegennimmt.
#
# DIE ANFUEHRUNGSZEICHEN STEHEN ALS \x27\x22\x60 DA, nicht als Zeichen: der
# erste Versuch schrieb sie aus und wurde von der Shell zerlegt, das Muster
# fiel auf `(` und `}` zurueck und die Wache meldete den halben Baum als
# fehlenden Endpunkt.
#
# UND DIE DOLLARZEICHEN SIND MASKIERT: `[\w$]` liest Perl als die Variable
# `$]` (die Perl-Version) und setzt sie ein — das Muster zerfiel still und
# meldete 21 231 „ungenannte Endpunkte", die Kommentarzeilen waren. Ein Muster,
# das ploetzlich Tausende findet, ist kaputt und nicht fleissig.
endpunkte=$(perl -0777 -ne 'while(/[A-Za-z_\$][\w\$]*\.(?:get|post|put|delete|patch|all)\(\s*[\x27\x22\x60](\/[^\x27\x22\x60]*)/gs){print "$1\n"}' \
  "$QUELLEN"/*.ts | sort -u)

if [ -z "$endpunkte" ]; then
  echo "  WARNUNG: keine Route gefunden — hat sich die Schreibweise geaendert?"
  exit 2
fi

gesamt=0
fehlt=0
fehlende=""
while read -r e; do
  [ -z "$e" ] && continue
  gesamt=$((gesamt + 1))
  # /api/plugins/:kennung/icon  ->  /api/plugins/[^/]+/icon
  muster=$(printf '%s' "$e" | sed -E 's/:[a-zA-Z0-9_]+/[^\/]+/g')
  if ! grep -qE -- "$muster" "${DOKUS[@]}" 2>/dev/null; then
    fehlt=$((fehlt + 1))
    fehlende="$fehlende$e"$'\n'
  fi
done <<<"$endpunkte"

echo "── REST-Endpunkte, die in keiner Doku stehen ──"
if [ -n "$fehlende" ]; then
  # OHNE ANFUEHRUNGSZEICHEN GLOBBT DIE SHELL das `/` einer Route zum
  # Verzeichnisinhalt — beim Fehlversuch oben ist genau das passiert.
  printf '%s' "$fehlende" | sed 's/^/  FEHLT: /'
fi
echo
echo "$((gesamt - fehlt)) von $gesamt Endpunkten genannt, $fehlt ungenannt."
[ "$fehlt" -eq 0 ] && exit 0
exit 1
