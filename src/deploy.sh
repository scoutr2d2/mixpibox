#!/bin/bash

# ══ ERST IN DEN EIGENEN ORDNER, DANN LOESCHEN ════════════════════════════
#
# Dieses Skript arbeitet durchweg mit RELATIVEN Pfaden (`./deploy`,
# `./backend-player/README.md`, `../bin/nodejs/deploy.zip`). Es funktioniert
# also nur, wenn es aus `src/` gerufen wird — und die Anleitung, die
# tools/mixpi-paketfrische-pruefen.py ausgibt, sagt `bash src/deploy.sh`,
# also aus der WURZEL.
#
# AM 20.09.2026 GENAU SO HINEINGELAUFEN: Aus der Wurzel gerufen, meldete es
# „cp: ./backend-player/README.md nicht gefunden" und danach „FEHLER:
# ./deploy/www-admin/index.html fehlt" — obwohl der Bau eine Zeile darueber
# gemeldet hatte, dass er www-admin erzeugt hat. Zwei widerspruechliche
# Meldungen, und keine sagt, was wirklich fehlt: das Verzeichnis, aus dem
# man ruft.
#
# UND DIE ERSTE ZEILE WAR EIN `rm -rf` AUF EINEN RELATIVEN PFAD. Aus der
# Wurzel traf es `./deploy`, das es dort nicht gibt — diesmal folgenlos. Ein
# Skript, das mit Loeschen beginnt und seinen Ort nicht kennt, ist eine
# Falle, die irgendwann zuschnappt.
#
# `cd` auf das eigene Verzeichnis kostet zwei Zeilen und macht jeden
# Aufrufweg richtig. Bricht es ab, wird NICHT geloescht.
cd "$(dirname "${BASH_SOURCE[0]}")" || { echo "FEHLER: eigenes Verzeichnis nicht erreichbar."; exit 1; }

rm -rf ./deploy
npm run build || { echo "FEHLER: der Bau ist gescheitert — nichts gepackt."; exit 1; }

# Anhalten, damit man den Bau ansieht, ehe er ins Zip wandert.
#
# WARUM DAS EINEN SCHALTER BRAUCHT: `read` ohne Terminal liest sofort EOF und
# laeuft durch — das ist harmlos. Der Schaden entsteht andersherum: haengt hier
# jemand an der Rueckfrage und geht weg, steht der Bau FERTIG in ./deploy, aber
# bin/nodejs/deploy.zip bleibt der alte. Genau so entstand der 10-Tage-Abstand
# vom 08.08.2026: gebaut um 17:47, gezippt nie. Danach rollt der Installer
# stillschweigend den alten Stand aus, und gesucht wird der Fehler in der Box.
#
# Deshalb: die Rueckfrage nur, wenn wirklich jemand davorsitzt, und mit -t ein
# Zeitlimit, damit sie niemanden mehr auf Dauer aufhaelt.
if [ -t 0 ] && [ -z "${MUPI_OHNE_RUECKFRAGE:-}" ]; then
  read -t 300 -p "Bau ansehen — Enter packt das Zip (5 min, dann weiter): " || echo
fi

# SEIT E118/1e GIBT ES KEINEN ANGULAR-BAU DER BOX-OBERFLAECHE MEHR — www/
# entsteht komplett aus dem NewDesign-Kopierschritt unten (das browser/-
# Abflachen der alten App ist mit ihr gefallen). Der Ordner wird hier
# angelegt, damit der Kopierschritt und die Waechter ein Ziel haben.
mkdir -p ./deploy/www
cp ./backend-player/README.md ./deploy/

# Die Verwaltung MUSS mit ins Paket: das Backend liefert sie als
# path.join(__dirname,'www-admin') aus, also als Nachbar von server.js.
# Fehlt sie, startet die Box mit einer Verwaltung, die 404 antwortet — und
# das faellt erst am Geraet auf. Deshalb hier hart abbrechen.
if [ ! -f ./deploy/www-admin/index.html ]; then
  echo "FEHLER: ./deploy/www-admin/index.html fehlt."
  echo "  Die neue Verwaltung wurde nicht gebaut. 'npm run build --workspaces'"
  echo "  im Wurzelverzeichnis baut sie mit."
  exit 1
fi

# Die NEUE Box-Oberflaeche kopiert seit E118/1b ein EIGENES Werkzeug — sie
# reist NICHT mehr als Angular-Asset der alten App mit (die Kopierregel in
# frontend-box/angular.json ist weg). Damit haengt ihre Auslieferung nicht
# mehr am Bau der Oberflaeche, die geloescht werden soll. Das Werkzeug
# traegt die Ausschlussliste (Werkstatt bleibt draussen) und prueft seine
# Kernstuecke selbst; die Wache tools/newdesign-mitlieferung-deckung.py
# haelt Liste und Rufer zusammen.
python3 ../tools/newdesign-kopieren.py ./deploy/www/neu \
  || { echo "FEHLER: NewDesign liess sich nicht kopieren — nichts gepackt."; exit 1; }

# Der Waechter dahinter bleibt trotzdem stehen: er prueft das ERGEBNIS am
# Ort, an dem es das Zip erwartet — unabhaengig davon, wer kopiert hat.
# (Altpunkt seit dem Audit vom 03.08.2026, Punkt 10; die erste Fassung
# zeigte auf www/browser/neu/, die Ebene VOR dem Abflachen, und brach den
# ersten frischen Bau faelschlich ab: auch ein Waechter braucht seine
# Gegenprobe.)
if [ ! -f ./deploy/www/neu/index.html ]; then
  echo "FEHLER: ./deploy/www/neu/index.html fehlt."
  echo "  Die neue Box-Oberflaeche (NewDesign/) kam nicht mit in den Bau."
  exit 1
fi

# Das Plugin-Laufwerk MUSS als eigene Datei mitreisen — es ist der Einstieg der
# Worker und darf deshalb NICHT in server.js hineingebuendelt werden (ein
# Worker braucht eine Datei auf der Platte).
#
# DIESELBE GEFAHR WIE OBEN, NUR LEISER: fehlt sie, startet die Box tadellos und
# laedt einfach KEIN Plugin. plugin-wirt.ts schreibt eine Zeile ins Journal, und
# das war es — nichts wird rot, niemand sucht. Genau dafuer stehen diese
# Waechter hier.
if [ ! -f ./deploy/plugin-laufwerk.js ]; then
  echo "FEHLER: ./deploy/plugin-laufwerk.js fehlt."
  echo "  Der zweite esbuild-Ausgang von backend-api lief nicht."
  echo "  'npm run build --workspace=mupibox-backend-api' baut ihn mit."
  exit 1
fi

# Herkunft einstempeln — das Fundament der Aktualisierung.
#
# Ohne diese Datei kann die Box nicht sagen, WOHER ihre Software stammt, und
# jede Update-Frage wird zur Raterei. Genau daran haengt der Unterschied
# zwischen "es gibt eine neuere Fassung" und "hier wird gleich dein Fork durch
# etwas anderes ersetzt". Der PHP-Admin konnte das nicht unterscheiden und bot
# stets Upstream an.
QUELLE=$(git -C .. remote get-url origin 2>/dev/null || echo "")
COMMIT=$(git -C .. rev-parse HEAD 2>/dev/null || echo "")
ZWEIG=$(git -C .. rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || echo "")
# Wie weit ist dieser Baum von seiner Quelle entfernt? Das ist die Angabe, auf
# die es wirklich ankommt: die Adresse kann stimmen und die Arbeit trotzdem
# nur hier liegen. Beim Schreiben dieser Zeilen waren es 98 Commits — ein
# Update von origin haette sie alle verworfen.
EIGENE=$(git -C .. rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo "0")
# `grep -c` gibt bei NULL Treffern "0" aus UND endet mit Code 1 — ein
# angehaengtes `|| echo 0` liefert dann ZWEI Zeilen und zerreisst das JSON.
# Am Geraet passiert: die Box hatte einen sauberen Baum, herkunft.json war
# unlesbar, und die Aktualisierungsseite meldete "Herkunft unbekannt".
# `wc -l` endet immer mit 0.
UNSAUBER=$(git -C .. status --porcelain 2>/dev/null | grep -v "^??" | wc -l)
cat > ./deploy/herkunft.json <<HERKUNFT
{
  "quelle": "${QUELLE}",
  "commit": "${COMMIT}",
  "zweig": "${ZWEIG}",
  "version": "${VERSION}",
  "eigeneCommits": ${EIGENE:-0},
  "unsauber": ${UNSAUBER:-0},
  "gebautAm": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
HERKUNFT
echo "Herkunft: ${QUELLE:-unbekannt} @ ${COMMIT:0:8} (${ZWEIG})"
if [ "${EIGENE:-0}" -gt 0 ] || [ "${UNSAUBER:-0}" -gt 0 ]; then
  echo "  EIGENBAU: ${EIGENE} Commits vor der Quelle, ${UNSAUBER} Datei(en) geaendert."
  echo "  Ein Update aus dieser Quelle wuerde diese Arbeit verwerfen."
fi

# Packen — und danach NACHWEISEN, statt einem Rueckgabewert zu glauben.
#
# ══ HIER LOG DAS SKRIPT BIS ZUM 31.08.2026 ══════════════════════════════════
# Es gibt kein `set -e`. Schlug `zip` fehl, lief es weiter: `cp` fand nichts,
# `rm -rf deploy` raeumte den frischen Bau weg, und das Skript endete mit 0.
# Der Aufrufer bekam "fertig", `bin/nodejs/deploy.zip` blieb der ALTE, und der
# naechste Installer rollte den alten Stand auf eine frische Karte aus.
#
# Am 31.08.2026 nachgemessen, auf genau diesem Rechner: `zip` ist gar nicht
# installiert ("Kommando nicht gefunden"), der Lauf endete trotzdem mit 0 und
# deploy.zip war unveraendert. Das ist dieselbe Sorte, gegen die drei
# Zeilen weiter oben harte Abbrueche stehen (fehlende www-admin, fehlende
# www/neu, fehlendes plugin-laufwerk.js) — nur ausgerechnet an dem Schritt,
# der das Ergebnis ueberhaupt herstellt, stand keiner.
#
# ZWEI ANTWORTEN, weil eine nicht reicht:
#   * `zip` ist nicht mehr Bedingung. python3 kann dasselbe und ist da, wo
#     gebaut wird — ein Bauweg, der an einem fehlenden Hilfsprogramm haengt,
#     wird von Hand umgangen, und von Hand gebaute Artefakte sind der Grund,
#     warum es diese Datei gibt.
#   * Der Nachweis kommt NACH dem Packen und prueft das Ergebnis, nicht den
#     Rueckgabewert: Datei da, nicht leer, lesbar, und die vier Stuecke drin,
#     auf die es ankommt.
ZIEL="../bin/nodejs/deploy.zip"
rm -f deploy.zip

if command -v zip >/dev/null 2>&1; then
  ( cd deploy && zip -qr ../deploy.zip . ) \
    || { echo "FEHLER: zip ist gescheitert — nichts ausgeliefert."; exit 1; }
else
  echo "HINWEIS: kein zip vorhanden, python3 packt."
  python3 - "$PWD/deploy" "$PWD/deploy.zip" <<'PACKEN' \
    || { echo "FEHLER: python3 konnte nicht packen — nichts ausgeliefert."; exit 1; }
import os, sys, zipfile
quelle, ziel = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
    for ordner, unter, dateien in os.walk(quelle):
        unter.sort()
        for d in sorted(dateien):
            p = os.path.join(ordner, d)
            name = os.path.relpath(p, quelle)
            # Die Rechte muessen mit: `zip` erhaelt sie, und ein Paket, dessen
            # Dateien nach dem Auspacken andere Rechte haben als bisher, faellt
            # erst an der Box auf.
            info = zipfile.ZipInfo.from_file(p, name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (os.stat(p).st_mode & 0xFFFF) << 16
            with open(p, "rb") as f, z.open(info, "w") as ziel_datei:
                ziel_datei.write(f.read())
PACKEN
fi

# DER NACHWEIS. Bis hierher kann alles "gutgegangen" sein und trotzdem nichts
# Brauchbares dastehen.
[ -s deploy.zip ] || { echo "FEHLER: deploy.zip fehlt oder ist leer."; exit 1; }
if command -v unzip >/dev/null 2>&1; then
  unzip -tqq deploy.zip >/dev/null 2>&1 \
    || { echo "FEHLER: deploy.zip ist nicht lesbar."; exit 1; }
fi
for STUECK in server.js plugin-laufwerk.js herkunft.json www-admin/index.html www/neu/index.html; do
  python3 -c "import sys,zipfile;sys.exit(0 if sys.argv[2] in zipfile.ZipFile(sys.argv[1]).namelist() else 1)" \
    deploy.zip "${STUECK}" \
    || { echo "FEHLER: ${STUECK} fehlt im Paket — nichts ausgeliefert."; exit 1; }
done

cp -f deploy.zip "${ZIEL}" || { echo "FEHLER: ${ZIEL} liess sich nicht schreiben."; exit 1; }
echo "Paket: $(du -h "${ZIEL}" | cut -f1) nach ${ZIEL}"

# Cleanup
rm -rf deploy
rm -rf deploy.zip
