#!/bin/bash
# Alles Pruefbare in EINEM Lauf — die Leitplanke gegen "hier gebaut, dort
# zerschossen".
#
# WOFUER: die Teile dieses Projekts haengen weiter zusammen, als es aussieht.
# Eine Aenderung am Server bricht die Oberflaeche, eine Aenderung an der
# Oberflaeche bricht den Bau, und gemerkt hat man es bisher erst auf der Box.
# Dieses Skript stellt genau diese Fragen hintereinander und sagt am Ende EINE
# Zeile: geht oder geht nicht.
#
# WARUM DER BAU MITGEPRUEFT WIRD: esbuild meldet "Done" und Exitcode 0, auch
# wenn es die Ausgabedatei gar nicht schreiben konnte (src/deploy gehoert root).
# Genau so wurde hier schon eine unveraenderte Datei ausgeliefert und stundenlang
# gesucht. Deshalb wird nicht der Exitcode geglaubt, sondern nachgesehen, ob die
# Datei wirklich neu ist.
#
# AUFRUF
#   tools/pruefen.sh            alles ausser der Box
#   tools/pruefen.sh --box      zusaetzlich mupi-check auf dem Geraet
#   tools/pruefen.sh --schnell  nur die Kerntests (wenige Sekunden)

set -u
cd "$(dirname "$0")/.." || exit 1

BOX=0
SCHNELL=0
for a in "$@"; do
  case "$a" in
    --box) BOX=1 ;;
    --schnell) SCHNELL=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
  esac
done

# An einen Ort bauen, der uns gehoert. src/deploy gehoert root, und esbuild
# verschweigt das (siehe oben).
BAU=$(mktemp -d /tmp/mupi-pruefen.XXXXXX)
trap 'rm -rf "$BAU"' EXIT

GRUEN='\033[32m'; ROT='\033[31m'; GRAU='\033[90m'; AUS='\033[0m'
FEHLER=0
declare -a GEBROCHEN

schritt() {
  local name="$1"; shift
  printf '%-34s' "$name"
  local start ende ausgabe
  start=$(date +%s)
  if ausgabe=$("$@" 2>&1); then
    ende=$(date +%s)
    printf "${GRUEN}ok${AUS} ${GRAU}%ss${AUS}\n" "$((ende - start))"
  else
    ende=$(date +%s)
    printf "${ROT}FEHLER${AUS} ${GRAU}%ss${AUS}\n" "$((ende - start))"
    echo "$ausgabe" | tail -18 | sed 's/^/    /'
    FEHLER=$((FEHLER + 1))
    GEBROCHEN+=("$name")
  fi
}

echo
echo "MuPiBox — Pruefung"
echo "──────────────────────────────────────────────────────"

# ── Kerntests: reine Logik, keine Umgebung, in Sekunden durch ──────────────
schritt "Kerntests backend-api" npm --prefix src/backend-api run test
schritt "Kerntests backend-player" npm --prefix src/backend-player run test

# WARUM DIESE ZEILE HIER STEHT (26.08.2026): die 14 Dateien unter `plugins/*/`
# — 367 Tests, 230 Millisekunden — liefen in KEINEM Laeufer. Das Wurzel-Skript
# `npm run test` haengt sie hinter `npm run test --workspaces`, und das bleibt
# bei `ng test` im Beobachtungsmodus stehen: das `&&` wird nie erreicht. Die CI
# ruft nur die beiden Backends. Hier oben, weil sie zu den Kerntests gehoeren:
# reine Logik, kein Netz, kein Browser. Siehe dokumentation/mixpibox.md 7.5.
schritt "Kerntests Plugins" npm run test:plugins

# WAS LEGT DIE VERSCHMELZUNG ZUSAMMEN, DAS NICHT ZUSAMMENGEHOERT?
#
# Die echten Daten der Box beantworten das NICHT: dort stehen 26 Eintraege mit
# genau zwei Ueberschneidungen, und beide sind richtig. Die teuren Faelle sind
# die knapp danebenliegenden — Live gegen Studio, „Die drei ???" gegen „Die
# drei ??? Kids", Musik gegen Hoerbuch, eine Datei ohne Interpret. Zwei davon
# waren am 03.08.2026 echte Ueberverschmelzungen und sind behoben; die uebrigen
# sind im Werkzeug als bekannt markiert und begruendet. Kein Netz, kein
# Browser, unter einer Sekunde.
schritt "Grenzfaelle der Verschmelzung" npx tsx tools/verschmelzung-grenzfaelle.mjs

# ── Die Box-Oberflaeche ───────────────────────────────────────────────────
#
# `ng test` braucht Karma und damit einen Chrome. Der ist oft NICHT eigens
# installiert - liegt aber meist schon irgendwo herum (Playwright bringt einen
# mit, Vivaldi ist Chromium). Deshalb wird gesucht statt verlangt.
#
# WARUM DAS UEBERHAUPT NOETIG WAR: diese Tests liefen gar nicht. Erst scheiterte
# `.angular/cache` an Rechten (EACCES, gehoerte root), dann fehlte der Browser.
# Beides zusammen sah aus wie "Tests kaputt" statt "Testumgebung kaputt" -
# und zwei Tests waren derweil veraltet und schlugen fehl, ohne dass es auffiel.
browser_finden() {
  local k
  for k in "${CHROME_BIN:-}" \
           "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome \
           /usr/bin/chromium /usr/bin/chromium-browser \
           /usr/bin/google-chrome /usr/bin/google-chrome-stable \
           /usr/bin/vivaldi /usr/bin/vivaldi-stable; do
    [ -n "$k" ] && [ -x "$k" ] && { echo "$k"; return 0; }
  done
  return 1
}

# HIER STANDEN box_nur_logik (vitest) und box_vollstaendig (Karma/ng test)
# der alten Angular-Oberflaeche — gefallen mit E118/1e, es gibt EINE
# Oberflaeche (NewDesign, geprueft weiter unten mit eigenem Browser-Test).
# NACHZUEGLER: src/frontend-box/src/app/now-playing.ts (+spec) liegt noch
# dort, weil eine parallele Sitzung daran baut (E84/B2); ihre Spec faehrt
# erst wieder, wenn die Datei nach dem Nachbar-Commit umgezogen ist —
# LIESMICH.md im Ordner traegt die Regel.

if [ "$SCHNELL" = "1" ]; then
  echo "──────────────────────────────────────────────────────"
  [ "$FEHLER" = "0" ] && echo -e "${GRUEN}Kerntests in Ordnung.${AUS}" || echo -e "${ROT}$FEHLER Schritt(e) gebrochen: ${GEBROCHEN[*]}${AUS}"
  exit "$FEHLER"
fi

# (Der Schritt „Alle Tests Box-Oberflaeche" fiel mit der alten App, E118/1e.)

# ── Bausteine der Oberflaechen, die im Browser NICHT laufen koennen ───────
#
# Ein paar Teile der Oberflaechen sind pure Rechnerei und mit dem
# NODE-Testlaeufer geschrieben (`import { describe, it } from 'node:test'`).
# Karma kann das nicht laden - und ein EINZIGER solcher Import riss frueher den
# ganzen Browserlauf mit sich, mit der Meldung "Found 1 load error", die den
# Grund nicht nennt.
#
# Sie tragen deshalb die Endung `.node.spec.ts` und sind in der angular.json
# des jeweiligen Frontends vom Karma-Lauf ausgenommen. Damit sie nicht STILL
# verschwinden - ein Test, der nirgends laeuft, ist teurer als keiner - laufen
# sie hier. NICHT vitest, sondern `tsx --test`.
#
# Mit vitest sieht es RICHTIG aus und ist es nicht: Der Import von `node:test`
# meldet die Tests bei Nodes eigenem Laeufer an, der sie nebenher abspult und
# seine Zusammenfassung druckt ("pass 19"). Vitest selbst findet dabei NULL
# Tests, meldet "no tests" und endet mit 1. Wer nur auf die gedruckten Zahlen
# schaut, haelt den Schritt fuer bestanden, waehrend er bricht - oder umgekehrt.
node_specs() {
  local wurzel="$1" f fehler=0 gefunden=0
  while IFS= read -r f; do
    gefunden=1
    (cd "$wurzel" && npx tsx --test "${f#"$wurzel"/}") >/dev/null 2>&1 || fehler=1
  done < <(find "$wurzel/src" -name '*.node.spec.ts' 2>/dev/null)
  [ "$gefunden" = 1 ] || echo "keine .node.spec.ts gefunden"
  return "$fehler"
}
# (Der Schritt „Node-Tests Box-Oberflaeche" fiel mit der alten App, E118/1e.)

# ── Schickt die neue Oberflaeche nur Befehle, die es GIBT? ─────────────────
#
# Ein Schritt gegen eine ganze Fehlerklasse, die sonst nur am Geraet auffaellt
# — und dort auch erst spaet. Der Abspieldienst quittiert einen UNBEKANNTEN
# Befehl mit HTTP 200 und tut nichts; es gibt keinen Zweig, der ihn
# bemaengelt. So ging `playpause` durch: erfunden, nirgends abgewiesen, und
# der Play-Knopf tat monatelang nichts.
#
# Der Abgleich liest beide Seiten am Quelltext: was der Verteiler kennt und
# was die Oberflaeche schickt. Er braucht keine Box, keinen Browser und keinen
# Ton — deshalb kann er hier stehen und nicht nur im Kopf.
schritt "Befehle der neuen Oberflaeche" python3 tools/player-befehle.py --oberflaeche

# ── DIE REINEN REGELN DER NEUEN OBERFLAECHE ───────────────────────────────
#
# Zwei Entscheidungen, die auf dem Bildschirm richtig AUSSEHEN, wenn sie
# falsch sind:
#   boxnameTeilen      teilt „MixPiBox" in „MixPi" / „Box". Eine falsche
#                      Grenze macht aus „MixPiZwei" ein „MixPiZ" und ein „wei",
#                      und niemand sieht die beiden Stellen je nebeneinander —
#                      genau der Zustand, in dem die Kopfzeile schon einmal ein
#                      Jahr lang „MuPiBox" behauptete.
#   naechsterRueckweg  entscheidet, welche Ebene der eine Rueckweg verlaesst.
#                      Eine vertauschte Zeile schliesst etwas, das gerade
#                      niemand sieht.
# Der Auszug wird bei jedem Lauf AUS app.js neu erzeugt (app.js ist eine IIFE
# ohne Exporte). Kein Browser, keine Box, Sekundenbruchteile.
schritt "Regeln der neuen Oberflaeche" node tools/pruef-neu-regeln.js

# ── Und tut die neue Oberflaeche auch, was sie soll? ───────────────────────
#
# Der Schritt darueber prueft nur die NAMEN der Befehle am Quelltext. Ob die
# Seite ueberhaupt Alben zeigt, ob sie bei einem 500er ewig laedt statt etwas
# zu sagen, ob der Mini-Player erscheint - davon weiss er nichts. Gezaehlt am
# 2026-08-02 hatte NewDesign/ bei 3609 Zeilen KEINE einzige Testdatei.
#
# Der Test faehrt die echte Seite in einem echten Browser gegen die
# vorhandene Attrappe (tools/neu-vorschau.mjs) und braucht rund 2 s. Ohne
# Browser ueberspringt er sich selbst, statt rot zu werden.
schritt "Tests neue Oberflaeche" node --test tools/e2e/neu-oberflaeche.test.mjs

# Die PKCE-Logik der eigenstaendigen Spotify-Anmeldeseite (E118/1a). Die
# Faelle stammen aus dem Karma-Spec der alten Angular-Seite und sind teuer
# erkauft (BACKLOG E22: fester Rueckweg, Einfuegefeld, RFC-Testvektor) —
# sie muessen den Wegfall der alten App ueberleben. Reine Logik, kein Browser.
schritt "Spotify-Anmeldelogik" node --test tools/e2e/spotify-anmeldung-logik.test.mjs

# Der Farbkanal der neuen Oberflaeche (E118/1c): PUT /api/farbthema ->
# mixpi-farben.css -> GET /farben.css -> Blatt VOR app.css. Reisst ein Glied,
# speichert der Waehler brav und faerbt STILL nichts — genau so sah der alte
# Symlink-Weg zweimal kaputt aus, ehe er fiel.
schritt "Farbkanal-Verdrahtung" python3 tools/farbkanal-verdrahtung.py

# ── Und greifen die Gesten? ────────────────────────────────────────────────
#
# WARUM EIN EIGENER SCHRITT UND NICHT EIN PAAR ZEILEN IM TEST DARUEBER: Die
# Geste haengt an `touch*` und an der FINGERZAHL, und die gibt es nur in
# echten Beruehrungen. Jeder andere Schritt dieser Datei kommt mit einem Klick
# aus; dieser schickt `Input.dispatchTouchEvent` mit ein, zwei und drei
# Punkten.
#
# DIE FALLE, GEGEN DIE ER STEHT, IST BELEGT: Die aeltere Randgeste
# (`randwisch`, holt die Leiste zurueck) hat mit der MAUS immer funktioniert
# und mit dem FINGER nie — monatelang, weil alle Messungen mit der Maus liefen
# (llmwiki randwisch-holt-die-leiste-zurueck). Derselbe Fehler waere hier
# doppelt teuer: Eine Geste, die man nicht sieht, meldet ihr Ausbleiben nicht.
#
# ER MISST AUCH DAS GEGENTEIL, und das ist der wichtigere Teil: dass ein
# senkrechtes Rollen dicht am rechten Rand NICHTS ausloest. Griffe die Geste
# dort, waere die Titelliste auf der Box nicht mehr zu bedienen, ohne dass die
# Lautstaerke springt.
#
# Er verstellt acht Darstellungsfelder und legt sie zurueck; ohne Browser
# ueberspringt er sich selbst. Rund 60 s.
schritt "Gesten der Box" node tools/wischrand-schau.mjs

# ── Blendet die Verwaltung das Richtige aus? ────────────────────────────────
#
# Die Darstellungsseite zeigt nur, was auf der GERADE LAUFENDEN Oberflaeche
# etwas tut — 30 der 59 Felder liest die neue nicht, 16 die klassische nicht.
# Welche das sind, steht dort in zwei Listen von Hand.
#
# DIE GEFAEHRLICHE RICHTUNG IST NICHT DIE OFFENSICHTLICHE: Ein Feld, das
# faelschlich in der Liste steht, wird AUSGEBLENDET, obwohl es wirkt — der
# Schalter ist dann einfach weg, und niemand sucht einen Schalter, von dem er
# nicht weiss, dass es ihn gab. Dieser Schritt misst beide Oberflaechen neu
# und meldet jede Abweichung. Unter einer Sekunde, kein Browser noetig.
schritt "Darstellung: nur wirksame Felder" node tools/darstellung-felder-wer.mjs --pruefen

# ── Und steht jeder Schalter der Box AUCH in der Verwaltung? ────────────────
#
# Der Schritt darueber fragt, ob ein Feld der Verwaltung ueberhaupt WIRKT. Die
# andere Haelfte derselben Achse ist: Was am Geraet stellbar ist, muss die
# Verwaltung auch koennen — „ich moechte einen schalter in BEIDEN menues haben"
# (20.09.2026). Ein Schalter, den es nur an einem Ort gibt, ist eine
# Einstellung, die je nach Standpunkt zu existieren scheint oder nicht.
#
# Gesucht wird die SCHREIBNAHT `setz({ feld` und nicht der Name irgendwo: Jedes
# Feld steht in darstellung.ts dreimal, und bei `verschmelzen` sind Feld und
# Vorgabe da, ein Knopf war es nie. Fuenf solche Einseitigen sind im Werkzeug
# datiert vermerkt, damit die Wache heute gruen sein kann, ohne die Luecke zu
# verschweigen.
schritt "Schalter in beiden Menues" python3 tools/menue-schalter-deckung.py --pruefen

# ── Und sagt die Uhr die Zeit, wenn man sie antippt? ────────────────────────
#
# Die zwei Schritte darueber pruefen, dass es den Schalter GIBT. Ob ein Tipp
# auf die Uhr wirklich etwas sagt, weiss keiner von beiden — und es sind drei
# Dinge, die man hier glauben kann, ohne sie zu sehen: dass der Tipp bei
# `pointer-events: none` der Kopfmitte ueberhaupt ankommt, dass ueberhaupt
# etwas gesagt wird (Sprache bewegt kein Pixel — das Vorlesen war hier schon
# einmal eingebaut, verdrahtet und stumm) und dass der Satz zur Anzeige passt.
#
# Mit einem echten Finger gegen die Attrappe, drei Lagen und drei Gegenproben,
# die am 20.09.2026 alle auf der richtigen Zeile anschlugen. Ohne Browser
# ueberspringt es sich selbst.
schritt "Uhr sagt die Zeit" node tools/uhr-sagt-die-zeit.mjs --pruefen

# ── Spricht sie? ───────────────────────────────────────────────────────────
#
# SPRACHE IST DER EINZIGE AUSGANG DIESER BOX, DER KEIN PIXEL BEWEGT. Bis zum
# 04.08.2026 enthielt NewDesign/app.js keinen einzigen Sprech-Aufruf, waehrend
# die klassische Oberflaeche sprach — gemerkt hat das niemand, weil man es
# nicht SIEHT. Jede andere Pruefung hier waere gruen geblieben.
#
# Der Schritt tippt in einem echten Browser an und liest an der Attrappe ab,
# was gesagt worden waere. Er dauert rund 70 s: der Vorlauf haengt am
# 15-s-Takt der Seite, und die Gegenprobe („waehrend der Wiedergabe wird NICHT
# vorproduziert") braucht denselben Takt noch einmal. Ohne Browser
# ueberspringt er sich selbst.
schritt "Die neue Oberflaeche spricht" node tools/neu-sprechen-schau.mjs --pruefen

# ── Und die neue Verwaltung? ───────────────────────────────────────────────
#
# Sie hatte bis 2026-08-02 ebenfalls KEINEN Test - bei 23 Dateien. Angefangen
# wird dort, wo es weh taete: beim Anmeldezustand und der Wache. Faellt der
# Fehlerzweig des Anmeldedienstes um, steht die Verwaltung offen, sobald das
# Backend hustet - das sieht man einem `try/catch` nicht an.
#
# Das test-Ziel in src/frontend-admin/angular.json fehlte und wurde ergaenzt
# (Karma-Baumeister ohne src/test.ts und ohne karma.conf.js - ab Angular 16
# sucht er die *.spec.ts selbst).
admin_tests() {
  local browser
  if browser=$(browser_finden); then
    (cd src/frontend-admin && CHROME_BIN="$browser" npx ng test --configuration ci --watch=false 2>&1) \
      | grep -qE "TOTAL: [0-9]+ SUCCESS"
  else
    echo "kein Browser gefunden - Verwaltungstests uebersprungen"
    return 0
  fi
}
schritt "Tests neue Verwaltung" admin_tests

# Auch die Verwaltung hat pure Rechnerei ohne DOM (systemverlauf.node.spec.ts)
# - dasselbe Muster und dieselbe Falle wie bei den Node-Tests der
# Box-Oberflaeche oben: ein Karma-fremder Import risse den Browserlauf mit.
schritt "Node-Tests neue Verwaltung" node_specs src/frontend-admin

# Und der leiseste Fehler der Verwaltung: die Suche kennt einen Schalter nicht.
#
# Ihr Bestand (src/frontend-admin/src/app/such-bestand.ts) wird AUS DEN SEITEN
# erhoben und liegt als Datei daneben. Erneuert sie jemand nicht, geht nichts
# kaputt — der neue Schalter ist bloss nicht mehr zu finden, und gemerkt wird
# das erst, wenn jemand ihn sucht. Hier wird der Bestand neu erhoben und
# Zeichen fuer Zeichen mit der abgelegten Datei verglichen.
# Schlaegt der Schritt an: node tools/verwaltung-suchbestand.mjs --schreiben
schritt "Suchbestand der Verwaltung" node --test tools/verwaltung-suche-vollstaendig.test.mjs

# UND DER FEHLER DANEBEN: die Suche kennt den Knopf, schickt aber auf die
# falsche Seite.
#
# Die Titel der Systemaktionen stehen NICHT im erhobenen Bestand — sie
# entstehen erst zur Laufzeit (AKTIONEN in backend-api/src/system.ts, ueber
# GET /api/system), und die Suche holt sie selbst. Welche SEITE dazu gehoert,
# sagt das Feld `bereich` ('medien' | 'box'); AKTION_ORT in suche.ts macht
# daraus den Weg. Traegt jemand im Backend einen dritten Bereich ein, ist
# beides fuer sich richtig — und die Suche schickt trotzdem irgendwohin.
# Auffallen kann das nur an einer ECHTEN Box; ohne Box endet der Schritt
# still mit 0 (ein Arbeitsplatz ohne Geraet soll nicht rot werden).
schritt "Systemaktionen in der Suche" node tools/verwaltung-suche-aktionen.mjs --pruefen
schritt "Aktionsleser der Suche" node --test tools/verwaltung-suche-aktionen.test.mjs

# UND DER ZWEITLEISESTE: man kommt hin, aber nicht zurueck.
#
# Seit dem 03.08.2026 gibt es UNTERSEITEN („Doppelte" und „Interpreten" unter
# „Medien"). Damit steht man zum ersten Mal auf einer Seite, auf der KEIN
# Eintrag der Kopfleiste leuchtet — und beim Gegenlesen fehlte auf beiden der
# Weg zurueck. Nichts war kaputt, nichts wurde rot: die Seiten luden, die
# Tests liefen, der Suchbestand stimmte. Nur wer ueber Lesezeichen oder Suche
# hereinkam, sass auf einer Seite, deren Name in der Leiste nicht vorkommt.
# Geprueft wird ausserdem, dass kein routerLink auf einen Pfad zeigt, den
# app.routes.ts nicht kennt (Angular leitet still auf die Uebersicht um).
schritt "Wege der Verwaltung" node --test tools/verwaltung-wege-schau.test.mjs

# UND DER LEISESTE VON ALLEN: der Eintrag ist da, die Liste stimmt, und er
# leuchtet trotzdem nicht.
#
# Seit dem 05.08.2026 wird EIN Leisteneintrag gerechnet statt von der Direktive
# gesetzt („Medien" soll auf seinen Unterseiten mitleuchten). Steht daneben
# wieder ein routerLinkActive, schreiben ZWEI Stellen dieselbe Klasse und die
# Bindung loescht, was die Direktive setzt. Nachgestellt am 05.08.2026 in einer
# Wegwerf-Arbeitskopie: auf /verschmelzung und /interpreten leuchtet danach
# NICHTS mehr — und alle Pruefungen darueber bleiben gruen, weil keine von
# ihnen eine gezeichnete Klasse sieht. Der Schritt darueber findet die
# Schreibweise am Quelltext (ZWEI SCHREIBER); dieser hier misst die WIRKUNG im
# Browser, faehrt jeden Weg der Verwaltung an und klickt die Rueckwege wirklich
# an. Er baut sich seine Oberflaeche selbst (sonst maesse er einen alten Stand)
# und meldet sich ohne Browser ab, statt rot zu werden. Rund eine Minute.
schritt "Leiste leuchtet auf jedem Weg" node tools/leiste-leuchtet-schau.mjs --pruefen

# KEIN BACKTICK IN EINER ANGULAR-VORLAGE.
#
# Die Vorlagen stehen in Template-Literalen; ein Backtick darin beendet die
# Zeichenkette mitten im HTML. Der Uebersetzer meldet das NICHT zwangslaeufig —
# am 03.08.2026 fiel so der Suchbestand der Medienseite von 28 auf 4 Eintraege,
# ohne dass irgendetwas rot wurde. Die Regel stand bis dahin nur im Wiki, und
# eine Regel ohne Pruefung ist eine Bitte.
schritt "Backticks in Vorlagen" node --test tools/vorlagen-backticks.test.mjs

# VERLIERT EINE BOX DURCH EIN UPDATE EINE EINSTELLUNG?
#
# Die leiseste Fehlerklasse dieses Projekts, und die einzige, die GAR NICHTS
# meldet. Alle Schritte darueber lesen Quelltext gegen Quelltext; der Weg zu
# einer LAUFENDEN Box heisst aber update/conf_update.sh, und der stand bis zum
# 03.08.2026 in keinem Pruefschritt. Genau dort sass der Befund: Zeile 10
# loeschte bei jedem Update `.mupibox.mediaCheckTimer` ersatzlos — einen
# Schluessel, den change_checker.sh in `sleep ${CHECK_TIMER}` einsetzt. Aus
# der Warteschleife wurde eine Dauerschleife, und am Bildschirm stand nichts.
#
# Das Werkzeug fuehrt das Skript WIRKLICH aus, gegen eine nachgebaute Box, auf
# der jede Einstellung von Hand verstellt ist, und prueft dazu, dass Vorgabe im
# Code, Vorlage fuer neue Installationen und Nachlegen fuer laufende Boxen
# dasselbe sagen. Kein Netz, keine Box, ein paar Sekunden (der Anlauf von tsx
# dominiert).
schritt "Kein Verlust beim Konfig-Umzug" python3 tools/konfig-umzug-probe.py --pruefen

# KOMMT DAS, WAS DIE ANWENDUNG BRAUCHT, UEBERHAUPT AUF EINE BOX?
#
# Dieselbe leise Fehlerklasse, eine Etage tiefer: der Server erwartet Piper
# unter ~/.mupibox/piper-venv — dorthin gebracht hat ihn bis zum 04.08.2026
# NIEMAND. Er lag nur auf der Entwicklungsbox, von Hand eingerichtet. Solange
# Vorlesen ein Zusatz war, fiel das nicht auf; seit Google TTS abgeloest ist,
# waere eine frische SD-Karte stumm gewesen. `bereit` haengt an der Existenz
# EINER Datei, ein verschobener Pfad sieht also genauso aus wie „gar nicht
# installiert". Geprueft wird deshalb nicht der Inhalt, sondern die Deckung:
# vier Stellen, ein Pfad.
schritt "Piper kommt auf die Box" python3 tools/piper-installationsweg-abgleich.py --pruefen

# DIE TEUERSTE RICHTUNG DERSELBEN FRAGE: beide Ausrollwege holten librespot in
# der Fassung dev_0.6 — die spielt KEINEN Ton (A/B belegt 2026-07-28). Auf den
# laufenden Boxen liegt laengst 0.8.0; ein Update haette es ueberschrieben und
# eine Box stillgelegt, die vorher spielte. Mitgeprueft wird der Waechter:
# Unit und Timer lagen lange in config/services/, ausgerollt hat sie nie
# jemand — eine Unit ohne ihr Skript sieht eingerichtet aus und ist es nicht.
schritt "librespot-Ausrollweg" python3 tools/librespot-ausrollweg-abgleich.py --pruefen

# UND DIE ZWEITE HAELFTE DESSELBEN AUSROLLWEGS: `mupi_mqtt` starb auf jeder
# frischen Box in der ersten Sekunde an einem Konfigurationsschluessel, den
# niemand anlegte (mqtt.name, KeyError) — und `Restart=on-abort` griff dabei
# nicht, der Dienst blieb tot und meldete sich nie. Repariert war das seit dem
# 30.07.2026 nur auf den Geraeten und im remote-step-installer. Das Werkzeug
# meldet ausdruecklich auch den HALBFERTIGEN Stand: Schluessel da, aber keine
# ExecCondition — dann laeuft der Dienst statt gegen nichts gegen den
# Beispiel-Broker, und das ist kein Fortschritt.
schritt "MQTT-Schluessel und -Schalter" python3 tools/mqtt-schluessel-abgleich.py

# UND JETZT DIESELBE FRAGE FUER ALLES AUF EINMAL.
#
# Die drei Schritte darueber sind je EIN Fund derselben Bauart, jeder einzeln
# und jeder durch Zufall: Piper, der librespot-Waechter, MQTT. Am 04.08.2026
# kam beim Gegenlesen ein vierter dazu (mupi_fan.service) — und zwar nicht
# durch Zufall, sondern weil die Frage endlich einmal fuer JEDE Unit und JEDES
# Skriptverzeichnis gestellt wurde. Was dieser Schritt faengt, ist nicht "eine
# Datei fehlt", sondern "die Verwaltung bietet einen Schalter an, der ins
# Leere zeigt": auf einer frischen Karte laeuft `systemctl enable
# mupi_fan.service` gegen eine Unit, die es nicht gibt, und exec() im PHP-Admin
# wirft die Fehlermeldung weg.
schritt "Ausrollweg-Deckung" python3 tools/ausrollweg-deckung.py --pruefen

# DIESELBE FRAGE FUER PAKETE STATT FUER DATEIEN — und sie hat gefehlt.
#
# Die Deckung darueber fragt, ob eine DATEI auf beiden Wegen ankommt. Die
# APT-Listen der beiden Wege sah bis zum 19.09.2026 niemand nach: `autosetup.sh`
# trug `python3-rpi-lgpio` (auf dem Pi 5 die einzige Fassung, die ueberhaupt
# GPIO kann), der Update-Weg das alte `python3-rpi.gpio` — eine per Update
# gepflegte Pi-5-Box bekam den kaputten Zustand ZURUECK. Dieselbe Abweichung
# stand schon im AUDIT-2026-08-24 und wurde am 19.09. ein zweites Mal von Hand
# gefunden; `wireguard-tools` (VPN-Heimweg E30) fehlte dem Update-Weg ganz.
# Ein Befund, der zweimal von Hand kommt, ist ein Ablauffehler — ab hier wacht
# das Werkzeug. Es prueft zusaetzlich die Richtung der Entfernen-Schleife, die
# von der Install-Schleife kopiert worden war und deshalb nie etwas entfernte.
schritt "Paketlisten-Deckung" python3 tools/paketlisten-deckung.py

# Die Ausrollweg-Deckung fragt, ob eine Datei irgendwo ANKOMMT. Die beiden
# hier fragen das, was davor liegt und was sie beide nicht sehen:
#   * Kommt der Code ueberhaupt von UNS? Ein Weg, der sich beim Original
#     bedient, deckt jede Datei ab — nur eben die falsche (31.08.2026: zwei
#     offene Stellen ausser der bekannten im Update-Weg).
#   * Ist das eingecheckte Paket so neu wie der Quelltext? Der Installer laedt
#     `bin/nodejs/deploy.zip` hoch, wie es im Baum liegt. Ist es alt, bekommt
#     jede frische Karte einen alten Stand — und nichts wird rot.
schritt "Fremdbezug" python3 tools/mixpi-fremdbezug-pruefen.py
schritt "Paketfrische" python3 tools/mixpi-paketfrische-pruefen.py

# Und der Weg, auf dem die Box sich selbst versorgt: er tauscht als root den
# Anwendungsbaum, laesst sich also auf keinem Arbeitsrechner „mal eben"
# ausprobieren. Die Probe baut dafuer eine Schein-Box unter /tmp und faehrt den
# ECHTEN Zieher darin — samt gestellter Abbrueche (halbes Archiv, Rest-`.neu`).
schritt "Zieher im Sandkasten" python3 tools/mixpi-zieher-probe.py

# Und die Naht zwischen beiden: Fassungsnummern werden an ZWEI Orten
# verglichen (aktualisierung.ts fuer die Seite, mixpi-zieher.py fuer die Box).
# Die TS-Tests pruefen die eine Seite, die Zieher-Probe die andere — keine von
# beiden fragt, ob sie DASSELBE sagen. Genau dort ist am 31.08.2026 zweimal
# etwas auseinandergelaufen (erst das fuehrende `v`, dann die Vorabmarken).
schritt "Fassungsvergleich-Deckung" python3 tools/mixpi-fassungsvergleich-deckung.py

# Die Auslieferprobe haelt die frische Karte fuer moeglich: jede
# ${MUPI_SRC}-Quelle existiert, kein Programm gehoert zwei Units, die
# Crontab ruft nur Abgelegtes, poweroff/reboot nur in benannten Endstufen.
schritt "Auslieferprobe" python3 tools/auslieferprobe.py --pruefen

# Das Raeumwerkzeug fuer die Altstaende auf der Box entscheidet an EINER Stelle
# ueber Loeschen — und der gefaehrliche Fall (der Abspieldienst hat keine eigene
# spotify-control.js mehr, also ist die daneben womoeglich die einzige) laesst
# sich an der laufenden Box nicht herstellen, ohne genau den Schaden
# anzurichten. Diese Zeugen stellen die Box nach und brauchen weder SSH noch Netz.
schritt "Altlasten-Raeumwerkzeug urteilt richtig" python3 tools/mixpi-box-altlasten-probe.py

# Das Wartungs-POST muss HINTER dem Anmelde-Tor stehen (Express entscheidet
# nach Reihenfolge; die Erstfassung stand davor, und jeder im Netz haette
# die Box sperren koennen). supertest sieht das nicht (Rueckschleife ist
# immer offen) — diese Probe bindet an 0.0.0.0 und misst von der LAN-Seite,
# mit Kontrollroute gegen Blindheit.
schritt "Wartungs-Tor von der LAN-Seite" npx tsx tools/wartung-tor-probe.ts

# ── Zwillingsdateien: box-Repo <-> remote-step-installer ──────────────────
#
# Rund ein Dutzend Dateien liegt in BEIDEN Baeumen und landet an derselben
# Stelle auf der Box — der Installer bespielt frische Karten, das box-Repo
# aktualisiert laufende. Wer nur eine Seite aendert, bekommt die alte Fassung
# ueber den anderen Weg zurueck: am 13.08.2026 so beim Lautstaerke-Boden
# (maxVolume 0 -> LAUTESTE Box auf frischer Karte), am 05.08. bei
# touch-bridge. Das Werkzeug lag seit dem 05.08. fertig auf einem Seitenzweig
# und war NIE gemerged — waehrend ein main-Commit es bereits als Gegenprobe
# empfahl. Jetzt liegt es im Baum und laeuft hier.
schritt "Zwillingsdateien box/installer" python3 tools/zwillingsdateien-abgleich.py --pruefen

# ── Dieselben Zwillinge, aber ueber das ZIEL statt ueber die Aehnlichkeit ──
#
# Der Schritt darueber urteilt ueber `SCHWELLE = 0.5`. Aehnlichkeit ist aber
# das GEGENTEIL von Schwere: je weiter zwei Fassungen auseinandergelaufen sind,
# desto sicherer faellt das Paar unter jede Schwelle. Am 27.08.2026
# nachgemessen — von drei Zwillingen meldete der Schritt darueber genau den
# MILDESTEN (boot-splash.py, 90 %), waehrend /etc/asound.conf (6 %) als
# "namensgleiches Rauschen" durchging und /opt/mupibox-tools/bootwache.py
# (3 %, 197 gegen 808 Zeilen) gar nicht erst Kandidat wurde.
# Dieser Schritt macht das Ziel auf der Box zum Merkmal: es verschwindet nicht,
# wenn der Fehler groesser wird. Beide Schritte bleiben — der eine findet
# umbenannte Paare ueber den Inhalt, der andere die, die durch die Schwelle
# fallen.
schritt "Zwillinge nach Ziel" python3 tools/zwillinge-nach-ziel.py --pruefen

# ── fetch ohne Frist: die Ratsche ─────────────────────────────────────────
#
# Die Klasse wuchs seit zwei Audits nach (12 -> 10+4 -> 14 Stellen), weil kein
# Schritt sie zaehlte. Die Ratsche bricht bei ZUWACHS und meldet sich, wenn
# eine Altlast behoben wurde (dann die Zahl im Werkzeug herabsetzen).
schritt "fetch mit Frist (Ratsche)" node tools/fetch-frist-schau.mjs --pruefen

# ── Dienstwissen in der UI: die Ratsche von E95/V ─────────────────────────
#
# Das Abnahmekriterium von E95/V heisst "ein neuer Dienst kostet null Zeilen
# UI-Verhalten". Gemessen wird es an den Dienstnamen-Vorkommen in
# NewDesign/app.js; der Deckel ist der Stand vom 30.08.2026 (558), und er
# darf nur SINKEN. Ein neuer `spotify`/`ARD`/`mpv`-Zweig in der Oberflaeche
# wird damit rot, statt still neben dem Kriterium herzuwachsen.
#
# Warum hier und nicht erst nach Stufe 2: das Werkzeug gab es seit dem
# sechsten Doku-Lauf, es urteilte (--deckel, Ausstieg 1) und hing in keinem
# Laeufer — `ungerufene-wachen.py` meldete es am 30.08. als einzige Luecke.
# Eine Ratsche, die erst nach dem Rueckbau eingehaengt wird, hat waehrend des
# Rueckbaus genau dann nicht gewacht, als es darauf ankam.
schritt "Dienstwissen in der UI (Ratsche E95/V)" node tools/ui-spiellogik-messen.mjs --deckel 558

# ── Zusammengesetzte Stilnamen: die Bauteile muessen dastehen ─────────────
#
# WOZU GENAU DIESE RICHTUNG: Beim Abbau des toten CSS am 19.09.2026 (Rang 6)
# war die teure Falle nicht das Uebersehene, sondern das FAELSCHLICH
# Geloeschte. `.marke-plugin`, `.pwf-3` und ihre Geschwister stehen in
# app.js NIE woertlich — sie entstehen als `marke-${d}` bzw. `pwf-${i}`. Eine
# Textsuche nach dem vollen Klassennamen findet null Treffer und sieht aus
# wie ein Beweis.
#
# Der Schritt prueft deshalb die Gegenrichtung: er LIEST, welche Werte die
# Zusammensetzungen bauen koennen (DIENST_MARKEN, PW_FARBEN — aus dem Code,
# nicht aus einer Namensliste) und verlangt fuer jeden eine Regel in app.css.
# Gegengeprueft am selben Tag: beide Sabotagen (`.marke-plugin` weg, `.pwf-3`
# weg) machen ihn rot, beide wurden per gezieltem Edit zurueckgenommen.
#
# Der BEFUND-Teil des Werkzeugs (tote Klassen, tote Token, tote id) urteilt
# bewusst NICHT und laeuft hier nicht mit: er soll gelesen werden, wenn
# jemand aufraeumt, und nicht als Dauerrot ueber jedem Entwurf stehen.
schritt "Zusammengesetzte Stilnamen" python3 tools/tote-stile-schau.py --pruefen

# ── Groessen der neuen Oberflaeche ────────────────────────────────────────
#
# app.js wuchs zwischen zwei Audits von 418 auf 1204 kB, ohne dass etwas rot
# wurde. Der Deckel (Stand 13.08. + ~10 %) macht Wachstum zur Frage "war das
# Absicht?" — gestellt, solange sie beantwortbar ist.
schritt "Groessen der neuen Oberflaeche" node tools/neu-groessen-schau.mjs --pruefen

# DIE BEIDEN SICHTBARKEITS-SKRIPTE (BACKLOG E11c/S3 und S4).
#
# Ihre Selbsttests liegen NEBEN der Sache statt hier in tools/, und das ist
# Absicht: beide muessen auf einer Box laufen koennen, auf der gerade etwas
# kaputt ist (`mupibox-fehlerbild.py --selbsttest` braucht weder Framebuffer
# noch die Konsolenschriften der Box). Aufgerufen wurden sie bis zum
# 04.08.2026 trotzdem von nirgends — geschrieben ist nicht geprueft, und ein
# Selbsttest, den keine Pruefung startet, wird beim naechsten Umbau still rot.
#
# Was sie festhalten, ist jeweils eine Entscheidungstabelle: WANN die Wache
# eingreift (und dass sie es vor 130 s NIE tut, solange die Boot-Animation
# laeuft) und WANN das Fehlerbild ueberhaupt malen darf.
schritt "Fehlerbild (Selbsttest)" python3 scripts/mupibox/mupibox-fehlerbild.py --selbsttest
schritt "Kioskwache (Selbsttest)" python3 scripts/mupibox/mupibox-kioskwache.py --selbsttest

# Dieselbe Bauart, andere Fehlerklasse: die Dienst-Zeichen der Kacheln stehen
# an ZWEI Stellen — die Figur in app.js (DIENST_MARKEN), die Farbe in app.css
# (.marke-<dienst>). Kommt ein neuer Dienst nur an einer davon an, faellt er
# STILL durch: die Plakette bleibt grau oder leer, und auf einem Cover sieht
# das nach Absicht aus. Der Abgleich liest beide Seiten am Quelltext.
schritt "Dienst-Zeichen der Kacheln" node tools/dienst-marken-schau.mjs --pruefen

# UND DIESELBE FRAGE FUER DIE GANZE DIENSTLISTE — der Schritt darueber ist nur
# ihr kleinster Fall.
#
# Am 04.08.2026 gemessen: die ARD war im Backend fertig gebaut und kam an FUENF
# Stellen nicht an. Keine davon hat sich gemeldet — kein Test rot, kein Bau
# gebrochen, keine Meldung. Ein Dienst, der irgendwo fehlt, sieht ueberall aus
# wie Absicht.
#
# Eine gemeinsame Datei geht nicht fuer alle: NewDesign/app.js laeuft ohne
# Bauschritt im Kiosk-Browser, app.css ist CSS, und die Verwaltung ist eine
# eigene Angular-App ohne eine Zeile aus backend-api. Wo es GING, ist es
# gemacht (werke.ts leitet seine Liste von `ReturnType<typeof dienstVon>` ab);
# fuer den Rest haelt dieser Schritt die eine Quelle gegen alle Verbraucher.
# Bewusste Auslassungen stehen im Werkzeug mit GRUND — wer weglassen will,
# traegt es ein; wer vergisst, wird rot.
schritt "Deckung der Dienstliste" node tools/dienste-deckung.mjs --pruefen

# UND DIE FRAGE, DIE KEIN QUELLTEXTABGLEICH BEANTWORTET: spielt die Kachel auch?
#
# Am 04.08.2026 beim Gegenlesen gemessen: Die ARD-Kachel der neuen Oberflaeche
# war vollstaendig richtig — Plakette, Farbe, Titel, Cover, alle Abgleiche
# oben gruen. Ein Tipp darauf antwortete „Das kann die Box hier noch nicht
# abspielen", weil `abspielBefehl()` ein `switch (q.dienst)` mit `default:
# return null` WAR (app.js, bis E95/V Stufe 3; heute `startPlan` im Server)
# und `ard` dort hineinfiel. Eine Kachel kann also in JEDER
# geprueften Eigenschaft stimmen und trotzdem nichts tun.
#
# Dieser Schritt tippt deshalb je Dienst auf eine Kachel und liest MIT, was auf
# die Leitung geht. Er war beim Bauen echt rot.
schritt "Jede Kachel spielt" node tools/kachel-spielt-je-dienst.mjs --pruefen

# E108: die Dienst-Plakette am Player-Cover — sagt sie die Wahrheit ueber die
# QUELLE des laufenden Titels (Spotify-Lage, ARD-Folgenliste, Titelwechsel)
# und verschwindet sie bei Unwissen, statt zu raten? Gegenprobe beim Bauen:
# totgelegtes Sichtbarmachen macht drei Messungen rot.
schritt "Quellen-Plakette sagt die Wahrheit" node tools/quellen-plakette-schau.mjs --pruefen

# UND DIE FRAGE EINE ETAGE TIEFER: spielt sie die RICHTIGE Folge?
#
# „Jede Kachel spielt" fragt, ob ueberhaupt ein Startbefehl herauskommt. Am
# 05.08.2026 lautete die Antwort fuer `ard` JA — und der Benutzer meldete
# trotzdem „ard sounds zeigt nur alben loest aber nicht auf einzelne tracks".
# Der Befehl kam, er galt nur immer der ganzen Sendung.
#
# Dieser Schritt tippt in die Folgen-Lane hinein und liest mit, WOHIN
# gesprungen wird. Er faengt vor allem die Falle, die keine Fehlermeldung hat:
# Die Folgenliste der ARD ROLLT (llmwiki ard-folgenliste-rollt), also darf
# weder die Lane noch die gemerkte Stelle mit einer NUMMER rechnen — und die
# mpv-Warteschlange muss die ganze Sendung sein, sonst zaehlt `currentTracknr`
# gegen eine andere Liste als der Server.
schritt "ARD: einzelne Folgen" node tools/ard-folgen-lane.mjs --pruefen

# UND DIESELBE FRAGE FUER EIN ALBUM (E112, 31.08.2026).
#
# Betreiber: „ich kann auch die alben nicht mehr aufklappen und die titel
# sehen" — und dazu „ich hätte erwartet es gemischt zu sehen lokal und
# spotify". Beides war KEINE Regression: Ein Album spielte im Raster beim
# Tippen (die Weiche in `kachelBauen` liess nur Playlist und ARD aufklappen),
# und die Herkunft je Titel liefert der Server zwar seit E108 mit (`quelle`,
# `quellen`), gelesen hat sie aber nur die Plakette am Player.
#
# WARUM EIN EIGENER SCHRITT NEBEN DEN ZWEI DARUEBER: „Quellen-Plakette" misst
# die EINE Plakette am laufenden Titel, „ARD: einzelne Folgen" eine Lane, die
# es schon gab. Hier ist die Frage, ob ein Tipp auf eine ALBUM-Kachel oeffnet
# statt zu starten — und ob dann JEDE Titelkachel genau die Dienste zeigt, die
# der Server zu diesem Titel nennt, mit der geltenden Quelle kraeftig und den
# weiteren blass. Der Fall „gemischt" wird ausdruecklich mitgezaehlt: ohne ihn
# hiesse „alle Plaketten stimmen" nur „eine Plakette je Titel stimmt".
#
# Gegenprobe beim Bauen: die Album-Weiche totgelegt -> fuenf Messungen rot;
# die geltende Quelle nicht mehr hervorgehoben -> „plaketten" rot; die
# Attrappe um `quellen` gebracht -> „gemischt" rot.
schritt "Album: Titel und ihre Herkunft" node tools/album-titel-lane.mjs --pruefen

# Und noch einmal dieselbe Bauart, seit der Mehrbenutzer-Vorbereitung: die
# Formel `mupibox_p_<kennung>_<schluessel>` steht an DREI Stellen (Backend,
# neue Oberflaeche, klassische Oberflaeche). Laufen sie auseinander, sieht ein
# Kind hier seine Sachen und dort die des Geschwisters — ohne Fehlermeldung.
# Geprueft wird ausserdem, dass kein Speicherschluessel wieder in zwei Dateien
# steht; genau daran haette der Umzug der Favoriten scheitern koennen, die
# vorher an SECHS Stellen roh im Quelltext standen.
schritt "Namensraum der Profile" node tools/namensraum-schau.mjs --pruefen

# WO DIE BIBLIOTHEK DEN SERVER VERLAESST — die Vorarbeit fuer E18 Stufe 2.
#
# Die Zuweisung „wer sieht welchen Eintrag" darf es nur an EINER Stelle geben
# (BACKLOG E18: „Gefiltert wird im SERVER … sonst gibt es zwei Antworten auf
# dieselbe Frage, und die zweite ist ueber einen anderen Weg erreichbar").
# Welche Stelle das ist, laesst sich nicht raten: die Bibliothek verlaesst
# server.ts an 25 Umgebungen, und die tun DREI verschiedene Dinge (was ein
# Kind sieht / ein technischer Griff wie der Jellyfin-Zugang / die
# Elternseite). Dieser Schritt wird rot, sobald eine Stelle dazukommt, die
# nicht eingeordnet ist — der Unterschied zwischen „bewusst ungefiltert" und
# „vergessen" steht damit im Quelltext statt in jemandes Erinnerung.
schritt "Ausgaenge der Bibliothek" node tools/bibliothek-ausgaenge.mjs --pruefen

# SICHERT DIE SICHERUNG NOCH, WAS EINEM KIND GEHOERT?
#
# Seit E18 Stufe 2 liegt es in `server/config/profile/<kennung>/`. Die
# Sicherung sammelte FLACH ein — der ganze Bereich fiel heraus, und gemerkt
# haette man es erst beim Zurueckspielen. Das ist die schlimmste Reihenfolge,
# die ein Fehler haben kann: er faellt genau in dem Augenblick auf, in dem man
# sich auf die Sicherung verlaesst.
#
# DER SCHRITT STEHT HIER ERST, SEIT ER GRUEN IST (05.08.2026). Ihn vorher
# aufzuhaengen haette ein Dauerrot ergeben, und ein Dauerrot erzieht dazu,
# ueber rote Zeilen hinwegzulesen.
#
# Er wird wieder rot, sobald `BEREICH_ABLAGEN` (profile.ts) um eine Ablage
# waechst, die in der Sicherung nicht nachgetragen wurde — die Liste steht an
# zwei Orten, und dieser Schritt ist der Grund, dass sie nicht auseinanderlaufen.
#
# GENAU DAS WAR AM 05.08.2026 ABENDS DER FALL, absichtlich: E18 Stufe 3 hatte
# `resume.json` in die Liste gestellt, und in `mupibox-sicherung.py` fehlte das
# Muster `profile/*/resume.json`. Die gemerkten Stellen fielen damit aus der
# Sicherung heraus — der alte Ort ist seitdem ein Verweis, und Verweise sammelt
# sie als Verweis ein, nicht als Inhalt (`if os.path.islink(voll)`). Am selben
# Abend nachgetragen und am Modul mit dem echten Bestand von .169 nachgemessen;
# der Schritt ist wieder gruen.
schritt "Sicherung deckt den Profil-Bereich" python3 tools/bereich-sicherung-deckung.py

# DIE VIER ROOT-SKRIPTE GEGEN DIE BRUECKE (E18 Stufe 3).
#
# Seit dem Umzug steht am alten Ort von resume.json ein Verweis auf den Bereich
# des aktiven Profils. Ob check_network.sh, get_network.sh, clearresume.sh und
# remove_max_resume.sh damit klarkommen, ist eine Behauptung ueber FREMDEN Code,
# den niemand aendern darf — jedes Update von upstream tauscht ihn ohnehin
# zurueck. Der Lauf nimmt deshalb die ECHTEN Skripte aus dem Baum und misst.
schritt "Bruecke haelt den root-Skripten stand" python3 tools/resume-bruecke-probe.py --pruefen

# UND DIESELBE FRAGE FUER DIE FASSUNG, DIE EIN UPDATE ZURUECKSCHIEBT.
#
# `update/start_mupibox_update.sh` und `autosetup/autosetup.sh` tauschen mit
# `mv ${MUPI_SRC}/scripts/mupibox/*` alle vier Skripte gegen ihren
# Upstream-Stand. Der Schritt darueber misst die Fassung AUS DEM BAUM; dieser
# hier holt die Fassung aus `5f9c7d8e~1` und misst sie genauso. Nur die beiden
# zusammen beantworten „haelt die Bruecke auch nach dem naechsten Update?".
# Teil B (das Rennen) und Teil C (echter Bestand) haengen NICHT hier: der eine
# startet Server und braucht eine Minute, der andere eine Datei von einer Box.
schritt "Bruecke haelt auch der Upstream-Fassung stand" python3 tools/e18s3-gegenprobe.py --nur A

# DER UMZUG AM ECHTEN BESTAND EINER BOX — nur, wenn er danebenliegt.
#
# `bereich.integration.spec.ts` schreibt sich seine Ausgangslage selbst und
# prueft damit, was der Bauende sich GEDACHT hat. Dieser Lauf nimmt den
# wirklichen Stand einer Box (Verweise, leere Dateien, kein profile.json) und
# zaehlt vorher/nachher. Ohne den Ordner wird er UEBERSPRUNGEN statt rot —
# ein Schritt, der auf jedem fremden Rechner rot ist, wird nicht gelesen.
if [ -d "${MUPIBOX_ECHTBESTAND:-}" ]; then
  schritt "Umzug am echten Bestand" env NODE_ENV=test \
    npx tsx --test tools/bereich-echtbestand-probe.ts
fi

# SIEHT EIN KIND, WAS EINEM ANDEREN GEHOERT?
#
# Nicht nur ueber /api/werke — die Frage lautet „ueber IRGENDEINEN Weg".
# Der Lauf legt fuer jede Route fest, was herauskommen DARF — seit E18
# Stufe 3 auch fuer die gemerkten Stellen (resume.json liegt je Kind im
# Bereich; box-weit ist nur noch die Bibliothek). Wird eine dieser Zeilen
# rot, ist entweder eine Trennung gefallen oder eine dazugekommen — beides
# gehoert angesehen, bevor es ausgeliefert wird.
schritt "Profiltrennung ueber alle Routen" env NODE_ENV=test \
  npx tsx --test tools/profiltrennung-lecksuche.ts

# DIE NAHT ZWISCHEN DEN BEIDEN OBERFLAECHEN — `--mupi-*`.
#
# Wieder dieselbe Bauart, und diesmal mit einem Schalter davor, den ein Elter
# sieht: Der Theme-Designer der Box (darstellung.service.ts) setzt 28 dieser
# Variablen, NewDesign/app.js zehn. Was nur die eine Seite setzt, bleibt auf
# der anderen ein Schalter, der SICHTBAR IST und NICHTS TUT. Nichts wird rot,
# nichts faellt, der Bau ist gruen — E23 nennt das „Falle 1" und verlangt
# diesen Schritt VOR dem Umbau des Eltern-Bereichs.
#
# Was der Schritt zusaetzlich kann, und weshalb ein grep nicht genuegt haette:
# der Dienst setzt sechs Variablen in einer SCHLEIFE
# (`--mupi-${k}-f`). Ein Muster findet dort gar nichts — genau daran hat sich
# AUDIT-2026-08-03.md §5.4 verzaehlt (es nennt 12 statt 28 und haelt
# --mupi-cover-f faelschlich fuer „nur neu"). Das Werkzeug loest die Schleifen
# auf und sagt laut, wenn es eine Form NICHT aufloesen kann.
# HIER STANDEN „Naht der Darstellungsvariablen" und ihr Aufloeser
# (tools/mupi-variablen-abgleich.mjs + .test.mjs): sie verglichen die
# --mupi-*-Setzer der ALTEN Oberflaeche mit denen der neuen. Mit E118/1e
# gibt es die Naht nicht mehr — eine Oberflaeche, ein Setzer (anwenden()).
# Die verwandte, WEITER offene Frage — „setzt app.js eine Variable, die
# app.css nie liest (und umgekehrt)?" — gehoert zum Bloecke-Format und
# steht als Wachen-Kandidat bei BACKLOG E119.

# DER ELTERN-BEREICH AUF DER BOX — bleibt er erreichbar und bewacht?
#
# Gemessen 2026-08-04, beim Erheben der Bestandsliste zu E23: DREI Seiten
# (/favorites, /jellyfin, /spotify) haben einen Rueckweg nach /settings, aber
# NICHTS navigiert hin — sie sind nur ueber die Adresszeile erreichbar. Zwei
# davon tragen Zugangsdaten und stehen zugleich OHNE Waechter in
# app.routes.ts. Das ist dieselbe Fehlerklasse wie [[unterseite-ohne-rueckweg]]
# in der Verwaltung, nur auf der Box und mit Schluesseln dahinter.
#
# Der Schritt prueft gegen die Liste BEKANNTE_MAENGEL im Werkzeug: neue
# Maengel machen ihn rot — behobene ebenfalls, damit die Liste nicht zur
# Behauptung wird.
# HIER STAND „Wege des Eltern-Bereichs" (tools/eltern-bereich-inventur.mjs):
# er inventarisierte die Routen des Eltern-Bereichs der ALTEN App gegen
# app.routes.ts und eine Maengel-Liste — beide sind mit E118/1e gefallen.
# Das Muster des NEUEN Eltern-Bereichs prueft der Schritt direkt darunter.

# SPERRT DIE SPERRE WIRKLICH? — der Schritt zum Muster des Eltern-Bereichs in
# der neuen Oberflaeche (E23, 04.08.2026).
#
# WARUM ER DIE WIRKUNG MISST UND NICHT DAS VORHANDENSEIN: Der Waechter der
# Angular-App ist eine `CanActivateFn` an fuenf Routen. Die neue Oberflaeche
# hat KEINEN Router — ihre Bildschirme sind Zustand, keine Adresse; ein Bereich,
# der dort entsteht, hat gar kein `canActivate`. Und der Ausfall ist STILL: die
# Vorgabe der Sperre ist „aus", eine Sperre, die nicht mehr sperrt, sieht am
# Bildschirm EXAKT so aus wie eine, die niemand eingeschaltet hat. Ein Tor, das
# da ist und nichts zurueckhaelt, besteht jede Pruefung, die nur nach ihm sucht.
# Deshalb fragt dieser Schritt: „Sperre an, keine PIN — stehen die
# Bluetooth-Zeilen im Baum?"
#
# Er prueft ausserdem, dass der ALTE Weg weiter funktioniert (kurzer Tipp aufs
# Zahnrad geht nach /settings), dass jedes Bedienelement 64 px misst UND
# getroffen wird, und dass der eine Rueckweg nicht auf der Ueberschrift liegt —
# letzteres kam nachtraeglich dazu, weil genau das passiert war und alle Zahlen
# trotzdem gruen waren. Ohne Browser meldet er sich ab, statt rot zu werden.
schritt "Sperre des Eltern-Bereichs" node tools/eltern-muster-schau.mjs --pruefen

# UND WAS PASSIERT NACH DEM ZUSPERREN? Der Schritt darueber prueft, dass die
# Sperre zurueckhaelt. Dieser prueft die andere Haelfte derselben Regel („Was
# hinter einer Sperre liegt, wird beim Zusperren WEGGERAEUMT, nicht zugedeckt"):
# dass niemand das Geraeumte hinterher ZURUECKSCHREIBT.
#
# Zwei Audits hintereinander fanden dafuer je eine Stelle — 14.09. die Holer
# ohne Lebenszeichen-Wache, 19.09. den WPS-Takt, der in einer Ortsvariablen lag
# und nach dem Zusperren weiterschlug (sein Endzweig holt die Netzliste). Beide
# Male war die Lage: vierzig Stellen machen es richtig, eine nicht. Genau das
# kann eine Wache zaehlen — und eine Datei mit 33.600 Zeilen wird nicht jeden
# Monat zweimal von Hand gelesen. Er liest nur den Quelltext, braucht also
# keinen Browser und keine Box.
schritt "Naht am Zusperren (neue Oberflaeche)" node tools/zusperren-naht-schau.mjs --pruefen

# DIE ERLAUBNISLISTE ALS EINZIGES TOR. `nachrichten.ts` nimmt Nachrichten von
# draussen an und legt sie auf einen KINDERSCHIRM; wer nicht auf der Liste
# steht, darf dem Kind nicht schreiben. Die Unit-Tests pruefen die DREI Wege,
# die es heute gibt — der teure Fehler ist der VIERTE, der sich sein
# Nachrichten-Objekt selbst zusammenbaut und an der Pruefung vorbeigeht.
# Jeder bestehende Test bliebe dabei gruen. Die Wache sucht deshalb JEDE
# exportierte `aus…`-Funktion, nicht drei bekannte Namen.
schritt "Nachrichten: Erlaubnisliste als einziges Tor" node tools/nachrichten-erlaubnis-schau.mjs

# WELCHEN BEFEHL LOEST EIN TIPP AUS? Die Reihe „In deiner Box" der
# Interpretenseite entschied bis zum 02.08.2026 an der FORM der Kennung, ob ein
# Werk ein Spotify-Album ist — und eine Playlist hat genau dieselbe Form. Der
# Spielknopf schickte deshalb `spotify:album:<playlist-id>`, Spotify quittierte
# und spielte NICHTS. So etwas steht in keinem Protokoll; es steht nur auf der
# Leitung. Dieser Schritt tippt in einem eigenen Browser gegen die Vorschau und
# liest mit. Ohne Browser meldet er sich ab, statt rot zu werden.
schritt "Befehle der Interpretenseite" node tools/interpretseite-befehle.mjs --pruefen

# FOLGT „WEITERHOEREN" DER AUSWAHL? Die Reihe zeigte bis zum 02.08.2026, was
# der Server schickte — im Regal eines Hoerspiel-Interpreten also auch einen
# Musiktitel („die zukunft wird gross", gemeldet vom Benutzer). Am Quelltext
# ist das nicht zu sehen: „in etwas drin sein" gibt es in dieser Oberflaeche in
# fuenf Bauarten (Kategorie, Regal, Lane, Interpretenseite, Uebersicht), jede an
# einem eigenen Stueck Zustand. Dieser Schritt tippt sie alle durch und
# vergleicht mit dem, was /api/werke und /api/weiterhoeren hergeben — die
# zweite Meinung kommt also nicht aus app.js. Ohne Browser meldet er sich ab.
schritt "Weiterhoeren folgt der Auswahl" node tools/weiter-auswahl-schau.mjs --pruefen

# DIESELBE FRAGE FUER DIE RUNDE INTERPRETEN-REIHE (03.08.2026). Sie kam bis
# dahin ungefiltert vom Server: unter „Hörbuch" standen auch die Musiker.
# EIGENER SCHRITT UND NICHT ANGEHAENGT, weil er eine Frage stellt, die es bei
# „Weiterhoeren" gar nicht gibt — ein Interpret gehoert zu MEHREREN Werken,
# eine gemerkte Stelle nur zu einem. Er prueft ausdruecklich, dass „ein Werk
# genuegt" gilt, und bricht ab, wenn in der Attrappe kein Interpret mehr in
# zwei Kategorien liegt (dann waere die Frage nicht messbar).
schritt "Interpreten folgen der Auswahl" node tools/interpreten-auswahl-schau.mjs --pruefen

# DER ABSTAND ZWISCHEN `stop` UND DEM SPOTIFY-START (03./04.08.2026).
#
# Gemeldet: „manchmal kann man ein eintrag anwaehlen es spielt aber zeigt
# keinen fortschritt der player steht noch auf play". AM GERAET gefunden
# (tools/weiterhoeren-wettlauf.mjs, Box .169): ohne Atempause waren 3 von 4
# Runden fehlerhaft, mit 1500 ms 0 von 4 — und der Ton lief in allen acht.
#
# ZWEI SCHRITTE, WEIL ES ZWEI SEITEN SIND — und die Reparatur seit dem
# 04.08.2026 auf der HINTEREN sitzt (BACKLOG E24/O2):
#
#   der DIENST     `stop` antwortet erst, wenn Spotify die Pause bestaetigt
#                  hat, hoechstens aber nach ANHALTE_FRIST_MS. Gemessen am
#                  wirklich gestarteten Dienst, nicht am Quelltext.
#   die OBERFLAECHE haelt nur noch dann selbst Abstand, wenn die Pause noch
#                  unterwegs sein koennte — und zwar auf BEIDEN Wegen, dem
#                  Weiterhoeren-Tipp und dem gewoehnlichen Kacheltipp (O1).
#
# KEINER VON BEIDEN PRUEFT DIE WIRKUNG. Der Schaden entsteht bei Spotify; die
# misst tools/weiterhoeren-am-geraet.mjs, und die braucht die Box.
schritt "Anhalten am Abspieldienst" node tools/anhalten-am-dienst.mjs --pruefen
schritt "Abstand vor dem Spotify-Start" node tools/weiterhoeren-atempause.mjs --pruefen

# UND DER PREIS DIESER REPARATUR: der Befehlsverteiler musste dafuer `async`
# werden. Express 4 faengt einen Wurf aus einem SYNCHRONEN Zuhoerer ab (500);
# eine Ablehnung aus einem `async`-Zuhoerer faengt es NICHT — dann geht gar
# keine Antwort hinaus, und `spielerBefehl` (ohne Frist) haengt fuer immer.
# Gemessen am 05.08.2026: vorher 500 nach 6 ms, nachher keine Antwort nach
# 5000 ms. Seither liegt ein Auffangnetz darunter; dieser Schritt haelt es
# fest, denn ein Netz, das niemand prueft, ist nach dem naechsten Umbau weg.
schritt "Auffangnetz unter dem Verteiler" node tools/verteiler-wirft-messen.mjs --pruefen

# ── DIE MESSWERKZEUGE DER LANES UND DER LEISTE ────────────────────────────
#
# WARUM SIE HIER DAZUKOMMEN (03.08.2026, beim Gegenlesen aufgefallen): Die
# Commit-Nachrichten vom 02. und 03.08. fuehren „GEPRUEFT: lane-marken-schau
# --pruefen, kontrast --pruefen, leiste-platz-schau, album-gross-schau" auf —
# und keines dieser Werkzeuge hing an diesem Skript. Ein Lauf, den nur der
# Erbauer von Hand macht, ist beim naechsten Mal keiner. Genau die Sorte
# Aussage, die man glaubt, ohne sie nachzusehen; dasselbe war bei
# tools/wiki-schau.py schon einmal so.
#
# WAS SIE FANGEN, das kein anderer Schritt sieht:
#   kontrast            Farben, die nebeneinander liegen und trotzdem
#                       dasselbe bedeuten koennten (blau/neutral/gelb,
#                       zusaetzlich Deuteranopie und Protanopie).
#   lane-marken-schau   den Auswahl-Umriss, seinen Beschnitt in der rollenden
#                       Reihe und den WIRKLICH abgeschickten Abspielbefehl
#                       (die +1-Falle steht sonst nur im Kommentar).
#   album-gross-schau   dass das grosse Cover unverdeckt bleibt — gemessen
#                       wird die BEMALTE Flaeche, hell und dunkel.
#   lane-nachlese       die Reste des Gegenlesens: die verwaiste Lane der
#                       Interpretenseite, die LETZTE Kachel einer gerollten
#                       Reihe, das Blaettern nach einem Randwisch und vier
#                       Durchgaenge ein/aus gegen das Zappeln.
#   leiste-platz-schau  beide Klemmzustaende der einfahrenden Leiste, die
#                       Ruhezeiten und den Hoehengewinn des Kissens.
#   laut-fenster-schau  ob das Lautstaerke-Fenster ganz auf dem Schirm steht —
#                       AUS- und EINGEFAHREN, waehrend der Bewegung und bei
#                       verstellter Kissenbreite. Der Nachbar darueber prueft
#                       nur den eingefahrenen Fall; in der Luecke sass die
#                       Regression vom 03.08.2026.
#
# ZUSAMMEN RUND DREI MINUTEN, davon anderthalb auf leiste-platz-schau: Es sind
# Zeitmessungen, die auf echte Ruhezeiten warten muessen. Ohne Browser melden
# sich alle fuenf ab, statt rot zu werden.
# VOR den Messungen selbst, und in Millisekunden: Borgt sich eines der
# Werkzeuge unten die Vorschau, ohne sie wieder hinzulegen? Am 04.08.2026 stand
# genau das hinter zwei Fehlern, die es nicht gab — tools/marke-tanzt.mjs liess
# die geliehene Vorschau auf `marke-ruhig` stehen, und tools/raster-marke-
# schau.mjs meldete daraufhin, die Marke im Raster bewege sich nicht. Dieselbe
# Pruefung faengt auch feste Debug-Ports; davon lagen vier auf 9361, vier auf
# 9351, drei auf 9357 und drei auf 9347. Steht sie VOR den Messungen, sagt sie
# beim naechsten Mal, WARUM sie rot sind.
schritt "Geliehenes zurueckgelegt" node tools/leihgabe-pruefen.mjs --pruefen
# Passt die Liste der einstellbaren Farben (thema-felder.ts) noch zu app.css?
# Sie speist die Verwaltungsseite UND tools/thema-werkstatt.mjs; laeuft sie der
# Datei davon, bietet beides einen Regler an, der entweder nichts faerbt oder
# ins Leere schreibt. Der Schritt startet nichts und braucht keinen Browser.
schritt "Themenfelder gegen app.css" npx tsx tools/thema-werkstatt.mjs --pruefen
# Die Gegenrichtung dazu: jedes `var(--x)` OHNE Ersatzwert braucht ein `--x:`,
# sonst malt die Zeile nichts. Das Werkzeug lag seit dem 08.08.2026 im Baum und
# wurde von KEINEM Laeufer gerufen — weder hier noch in der Doku-Probe. Es war
# darum seit dem Bildwahl-Umbau rot, und zwar auf einen FEHLALARM: `--fp-bild`
# kommt aus `anwenden()` in app.js und stand nicht in der damals handgepflegten
# Ausnahmeliste. Gemerkt hat es niemand, weil es nirgends lief. Jetzt laeuft es
# hier, und die Liste wird aus den `setProperty`-Stellen gelesen statt gepflegt.
schritt "Stilnamen ohne Erklaerung" python3 tools/stilnamen-pruefen.py
# DIESELBE GESCHICHTE, eine Wache weiter (24.08.2026): auch
# `grenzruf-verb-deckung.py` lag ungerufen im Baum und meldete zwei
# Abweichungen — beide Fehlalarme aus zur Laufzeit gebauten Pfaden
# (`API + '/funk/' + was` wurde zu `/api/funk/X` und passte auf keine Route;
# der Abfrageteil `?q=` steckte in einem Bedingungsausdruck und klebte als
# `/api/medienX` am Pfad). Sie prueft die Grenze Oberflaeche->Server nach VERB,
# nicht nur nach Pfad: ein GET auf eine reine POST-Route faellt in den
# Catch-all und liefert HTML statt JSON. Genau das findet keine andere Wache.
schritt "Grenzrufe nach Verb" python3 tools/grenzruf-verb-deckung.py
# UND DIE DRITTE FOLGE DERSELBEN GESCHICHTE (24.08.2026): der Lauf davor gab
# drei Box-Sonden einen Erreichbarkeitsriegel und schrieb die Regel auf — die
# SUCHE lief aber ueber die Namen `*deckung*`/`*pruefen*`/`*halten*`, und die
# Geschwister heissen `*-probe`, `*-messen`, `*-wer`. Drei davon urteilten an
# der abgeschalteten Box weiter, eine mit Ausgang 0. Diese Wache haelt die
# Regel jetzt selbst, statt sie einer Namenssuche zu ueberlassen.
schritt "Riegel der Box-Sonden" python3 tools/sonden-riegel-deckung.py
# UND DIE VIERTE FOLGE (24.08.2026): `antworttext-ausgewertet.py` lag ebenfalls
# ungerufen im Baum und gab bei jedem Fund trotzdem 0 zurueck — eine Wache, die
# nirgends laeuft und nie rot wird, ist zweimal keine. Sie prueft die
# Endpunkte, die mit HTTP 200 UND einem Wort im Rumpf antworten ('locked',
# 'error'): dort sagt der Statuscode nichts, und wer den Text nicht liest,
# unterscheidet Fehlschlag nicht von Erfolg. Drei solche Stellen sind offen und
# stehen in BEKANNT_BLIND; --pruefen wird rot bei einer NEUEN und ebenso, wenn
# jemand eine bekannte schliesst, ohne sie auszutragen.
# HIER STAND „Antworttexte werden gelesen" (tools/antworttext-ausgewertet.py):
# die Fehlerklasse — media.service.ts legte jede Antwort in EIN gemeinsames
# response-Feld, das getResponse() beim Lesen leert; wer nicht las, verlor
# und verstopfte — war eine Eigenheit der ALTEN Angular-App und fiel mit ihr
# (E118/1e). Das NewDesign wertet fetch-Antworten an Ort und Stelle aus.
schritt "Farben der Bedienzeichen" node tools/kontrast.mjs --pruefen
schritt "Marken und Umriss der Lanes" node tools/lane-marken-schau.mjs --pruefen
# Die tanzende Marke: dass sie SICH BEWEGT und dass der Schalter aus der
# Verwaltung sie anhaelt. Beides ist an einem Standbild nicht zu sehen —
# gemessen wird die Balkenhoehe zweimal im Abstand von 250 ms.
schritt "Marke tanzt (und laesst sich anhalten)" node tools/marke-tanzt.mjs --pruefen
schritt "Wellen-Regler wirken" node tools/wellen-regler-schau.mjs --pruefen
# UND DIE ZWEI GROESSEN-REGLER (E113). Sie stehen hier, weil sie aus demselben
# Befund kommen wie der Schritt darueber, aber aus der GEGENRICHTUNG:
# `--mupi-cover-f` und `--mupi-titel-f` wurden seit dem ersten Tag GELESEN und
# von niemandem geschrieben — zwei Variablen ohne Bedienelement, und der
# Betreiber suchte die Cover-Groesse im Menue. Deshalb misst dieser Schritt
# BEIDE Haelften: den Weg per PUT bis zur Kante am Schirm (170/200/260 px) und
# den Weg durch die Oberflaeche (Admin auf, Zeile antippen, am Server
# nachsehen, was in `skalen` steht). Nur die erste Haelfte waere am Baum VOR
# E113 ebenso gruen gewesen.
schritt "Groessen-Regler wirken" node tools/groessen-regler-schau.mjs --pruefen
# Dieselbe Marke, andere Ebene: seit 03.08.2026 steht sie auch im RASTER
# („der playing indikator muss noch auf oberster ebene sichtbar sein"). Der
# Vergleich dahinter ist derselbe wie in der Lane und liegt an EINER Stelle —
# dieser Schritt bewacht genau das: dass die Klasse `spielt` an genau einer
# Stelle gesetzt wird, dass die Marke bei fremder Wiedergabe und nach dem Ende
# verschwindet, und dass sie in der Ecke weder die Dienst-Plakette noch den
# Play-Knopf noch die Fehlt-Schaerpe verdeckt.
schritt "Marke im Raster" node tools/raster-marke-schau.mjs --pruefen
# UND IHRE RAENDER. Die beiden Schritte darueber messen eindeutige Lagen; die
# teuren Faelle liegen daneben und sind beim Gegenlesen aufgefallen: ein
# verschmolzenes Werk, das ueber seine ZWEITE Quelle laeuft, und der Nachlauf
# (mpv spielt, /player/state traegt den alten Spotify-Zustand noch weiter).
# Der zweite Fall hatte Raster und Lane zu verschiedenen Antworten gebracht —
# genau das, wogegen der Umbau gebaut war. Dazu wird die Zahl der gleichzeitig
# tanzenden Marken gezaehlt statt geschaetzt. Seit 03.08.2026 dazu der Fall,
# der alle drei Schritte darueber ausgelassen hatten: ein laufender Titel, der
# zu KEINEM ganzen Album gehoert.
schritt "Marke an den Raendern" node tools/marke-grenzfaelle.mjs --pruefen
# UND EINMAL GEGEN DIE BOX, wenn sie erreichbar ist. Alle Schritte darueber
# messen gegen tools/neu-vorschau.mjs, also gegen erfundene Antworten — und
# genau so ist am 03.08.2026 eine Regression durchgerutscht: „Attrappe gruen,
# Geraet rot". Dieser Schritt nimmt die ECHTEN Antworten der Box (nur lesend;
# jedes Schreiben endet im Spiegel) und ueberspringt sich selbst, wenn keine
# Box antwortet.
schritt "Marke am Geraet (wenn erreichbar)" node tools/marke-am-geraet.mjs --pruefen
schritt "Grosse Albumansicht" node tools/album-gross-schau.mjs --pruefen
# DER EINE RUECKWEG UND DAS WAPPEN (seit 03.08.2026).
#
# „Systemweit" ist eine Aussage ueber ALLE Ebenen — und der teure Fehler ist
# nicht der Knopf, der fehlt, sondern der, der auf fuenf Ebenen richtig sitzt
# und auf der sechsten unter einer Vollbild-Ansicht liegt. Am Quelltext sieht
# man das nicht. Dieser Schritt sucht deshalb JEDE Sorte von Ebene auf
# (Startseite, Regal, Lane, Titelliste, Interpretenseite, grosser Player,
# grosses Cover), misst dort Groesse, Ausgegrautsein und ob der Knopf wirklich
# GETROFFEN wird, und prueft, dass EIN Tipp genau EINE Ebene verlaesst. Dazu
# der Waechter gegen den siebten Ausgang und die drei Sorten Boxname (mit
# „Box" am Ende, ohne, und einer, der umbrechen muss). Ohne Browser meldet er
# sich ab, statt rot zu werden.
# ERST DIE GEGENSTELLE, DANN DIE MESSUNGEN GEGEN SIE.
#
# Die Vorschau ist die Gegenstelle JEDER Browser-Messung hier unten. Kennt
# sie eine Route nicht, die die Oberflaeche liest, rauscht eine 404 in jeder
# einzelnen mit — und im 19.09.2026 gemessenen Fall waren es 203 Meldungen in
# EINEM Lauf der Nachlese, deren Zweck gerade das Finden einer stillen
# Ausnahme im 250-ms-Takt ist. Deshalb steht diese Wache VOR den Messungen:
# Wer hier rot ist, weiss, dass die Befunde darunter Rauschen enthalten.
schritt "Vorschau beantwortet, was die Oberflaeche liest" node tools/vorschau-routen-deckung.mjs --pruefen
schritt "Der eine Rueckweg und das Wappen" node tools/rueckweg-schau.mjs --pruefen
# DIE NACHLESE DAZU — die Ecken, die der Schritt darueber offen laesst und die
# beim Gegenlesen am 03.08.2026 je einen Befund hatten: die Titelliste auf der
# INTERPRETENSEITE (sie entsteht in einer anderen Funktion als die im Raster),
# die Meldung (sie liegt ueber allem und wird durch einen Tipp irgendwohin
# geschlossen — der Rueckweg darf ihr das nicht wegnehmen), die Fusszeile bei
# einem Bau aus geaendertem Baum, der Kontrast des Knopfes auf jedem seiner
# drei Untergruende und die Konsole auf dem ganzen Weg.
schritt "Nachlese zum Rueckweg" node tools/rueckweg-nachlese.mjs --pruefen
# DER SPIELE-SCHALTER (19.09.2026). Er geht durch vier Haende —
# Verwaltungsseite, PUT/GET /api/vorlesen, `stimme.laden()`, die Tuer in
# `spieleckeOeffnen()`. Die Zeugen in vorlesen.spec.ts messen das MODELL;
# dieser Schritt misst die KETTE, und zwar ueber den ECHTEN Weg (eine
# Anweisung der Fernbedienung), weil nur im Browser steht, ob die Tuer
# wirklich zu ist. Er misst auch die Gegenrichtung und die Gegenkontrolle:
# eine Seite, auf der gar nichts mehr geht, besteht „bleibt zu" muehelos.
schritt "Der Spiele-Schalter wirkt (und sofort)" node tools/spiele-schalter-schau.mjs --pruefen
# DIE SPIELELISTE STEHT AN DREI ORTEN (20.09.2026): Server (die Wahrheit),
# app.js (was wirklich spielbar ist), Vorschau (die Attrappe). Die Kennung
# ist der Speicherschluessel der Einzelschalter — laufen die Listen
# auseinander, laesst sich ein Spiel nicht mehr abschalten, oder ein
# Schalter zeigt auf nichts. Beides ohne Fehlermeldung, beides beim Bauen
# unsichtbar.
schritt "Spieleliste an drei Orten" python3 tools/spiele-liste-deckung.py --pruefen
# WAS BEIM EINSCHALTEN PASSIERT (20.09.2026). Drei Verhalten, die sich nur im
# Browser zeigen: fragen -> „Wer hoert?"; letztes ohne Passwort -> gar kein
# Fenster; letztes mit Passwort -> das Schloss DIESES Profils. Mitgemessen
# wird der Ausweg („Ich bin jemand anderes") — ohne ihn haengt ein
# Geschwisterkind fest — und die Ecke aus E39: das eigene, schon aktive
# Profil kam bis dahin ohne Passwort durch.
# EIGENE VORSCHAU: der Schritt setzt ein Passwort und schaltet den Gast ab;
# in einer geliehenen bliebe beides stehen und traefe den naechsten Lauf.
schritt "Was beim Einschalten passiert" node tools/start-modus-schau.mjs --pruefen
# BLEIBT DIE BOX AUFFINDBAR (20.09.2026)? Drei Teile, von denen jeder still
# wegbrechen kann: avahi auf beiden Ausrollwegen (installiert UND
# eingeschaltet), die Kennmarke `GET /api/box`, und dass tools/box-finden.py
# wirklich auf sie prueft. Bis heute war avahi auf KEINEM der beiden Wege
# installiert — dass MixPiBox.local trotzdem ging, lag an DietPi, also an
# Glueck. Die Wache liest Quelltext, keine laufende Box: sie darf auch dann
# gruen sein, wenn gerade keine Box am Netz haengt.
schritt "Bleibt die Box auffindbar" python3 tools/auffindbarkeit-deckung.py --pruefen
# DIE SCHUBLADE ZEIGT IHREN INHALT NICHT VOR SICH HER (20.09.2026). Betreiber:
# „die apps sind zuerst sichtbar und dann erscheint die schublade". Gemessen
# wird der UEBERSTAND — wie weit die sichtbare Kante der App-Spalte rechts
# ueber die Kante der Flaeche hinausragt. In jeder Lage 0; vorher waren es am
# ersten Pixel des Zuges 84 px. Mit Gegenkontrolle (offen MUSS die Spalte
# sichtbar sein, sonst ist „Ueberstand 0" trivial wahr).
schritt "Die Schublade deckt auf, statt vorzuzeigen" node tools/schublade-deckt-auf.mjs --pruefen
# DIE BELOHNUNGS-VIDEOS (20.09.2026). Betreiber: „ard videos einzelne videos
# freischalten mit abspiel haeufigkeit". Gemessen werden die drei Zusagen der
# Oberflaeche, die man nicht sieht, wenn sie gebrochen sind: aufgebrauchtes
# verschwindet, EIN Durchlauf verbraucht GENAU EINS (nicht null, nicht zwei —
# dieselbe Laufkennung zaehlt nicht doppelt), und eine Absage kommt mit GRUND
# an. Die Attrappe liefert dafuer ein zwei Sekunden langes Video, der Lauf
# dauert also Sekunden und nicht 27 Minuten.
schritt "Belohnungs-Videos auf dem Kinderschirm" node tools/video-belohnung-schau.mjs --pruefen
# DER RING SAGT AN, OHNE AUSZUWAEHLEN (19.09.2026) — DAS WERKZEUG DAZU HAENGT
# HIER BEWUSST NICHT.
#
# `tools/auswahl-sagt-sich-an.mjs` misst die richtige Sache, aber es FLATTERT:
# am 20.09.2026 dreimal hintereinander gelaufen, dreimal ein anderes Ergebnis
# (ohne Abweichung / 1 / 2), ohne dass sich eine Zeile Code dazwischen
# geaendert haette. Drei Ursachen wurden gefunden und behoben (Warmlauf zaehlte
# als Ansage; auf eine Aenderung statt auf „irgendwas da" warten; die Messung
# stand auf einem Filter statt auf einer Kachel), eine vierte nicht: Phasen
# beeinflussen sich ueber liegengebliebene Tastendruecke und ueber die
# geliehene Vorschau, und in einzelnen Laeufen taucht ein Start auf, der nicht
# zu erklaeren war.
#
# EINE WACHE, DIE MAL ROT UND MAL GRUEN IST, IST KEINE. Sie verbraucht das
# Vertrauen, das die naechste echte Meldung braucht — dieselbe Krankheit wie
# eine dauerrote. Bis das geklaert ist, wird das Werkzeug von Hand gerufen:
#     node tools/auswahl-sagt-sich-an.mjs
# Seine Grenzen stehen in seinem eigenen Kopf. Wer es wieder einhaengt, muss
# es vorher DREIMAL hintereinander gleich gruen bekommen.
# Die verschmolzene Kachel: zwei Plaketten, der Tipp an die BEVORZUGTE Quelle,
# die gemerkte Stelle in DEREN Einheit und das Ausweichen, wenn sie nicht kann.
# Es stellt die Vorschau dafuer auf `verschmolzen-an` und legt sie danach
# zurueck — sonst faende der naechste Schritt eine Lage vor, die niemand
# bestellt hat (am 03.08.2026 genau so passiert).
schritt "Verschmolzene Kachel spielt" node tools/verschmelzung-befehle.mjs --pruefen
schritt "Nachlese Lanes und Leiste" node tools/lane-nachlese.mjs --pruefen
schritt "Platz der einfahrenden Leiste" node tools/leiste-platz-schau.mjs --pruefen
# ER HAENGT HIER, WEIL DER SCHRITT DARUEBER DIE LUECKE HATTE (03.08.2026):
# leiste-platz-schau misst das Lautstaerke-Fenster nur EINGEFAHREN. Genau
# deshalb konnte es rechts aus dem Schirm wandern, ohne dass etwas rot wurde —
# gemeldet wurde es vom Geraet, nicht vom Gesamtlauf. Dieser Schritt misst
# beide Zustaende, die Bewegung dazwischen und die zwei Verwaltungsregler, die
# die Kissenbreite veraendern. Rund 40 Sekunden.
schritt "Lautstaerke-Fenster auf dem Schirm" node tools/laut-fenster-schau.mjs --pruefen

# DAS WISSENSPAKET IST TEIL DES BESTANDS, also wird es auch geprueft.
# `tools/wiki-schau.py` sagt im Kopf seit jeher, es haenge hier — es hing
# aber nie. Genau die Sorte Aussage, die man glaubt, ohne sie nachzusehen:
# Jeder gruene Gesamtlauf las sich, als sei auch das Wiki in Ordnung, und
# geprueft hatte es niemand. Beim ERSTEN wirklichen Lauf, am 02.08.2026,
# meldete der Schritt sofort drei Verweise ins Leere.
#
# Was er faengt, sieht `yaml.safe_load` NICHT: doppelte ids (die id
# `mupi-kiosk-als-dietpi` war zwei Wochen lang doppelt vergeben), Verweise
# ins Leere und doppelte Schluessel innerhalb eines Eintrags. Reine
# Textpruefung, Sekundenbruchteile, keine Box. Fehlt das Nachbarrepo,
# meldet er sich ab, statt rot zu werden.
schritt "Wissenspaket (llmwiki)" python3 tools/wiki-schau.py --pruefen

# DIE SCHRITTZAHL DIESES SKRIPTS, GEMESSEN VON DIESEM SKRIPT (31.08.2026)
#
# `tools/leitplanken-zahl-pruefen.py` gibt es seit dem 24.08.2026, es hing
# aber NUR in `tools/doku-luecken-probe.sh`. Das ist die Wache hinter dem
# Ereignis: Die Zahl in `dokumentation/mixpibox.md` 7.1 laeuft in dem
# Moment davon, in dem hier eine `schritt`-Zeile dazukommt — gemerkt wird
# es erst beim naechsten Doku-Lauf, Stunden bis Tage spaeter. Die Historie
# zeigt den Ablauffehler: 17->79, ->94, ->95, ->96, jedes Mal von einem
# Doku-Lauf nachgetragen, nie vom Bauenden.
#
# Ab jetzt wird derjenige rot, der den Schritt hinzufuegt, und zwar vor dem
# Ausliefern. Reine Textpruefung, keine Box, Sekundenbruchteile.
schritt "Schrittzahl der Leitplanke" python3 tools/leitplanken-zahl-pruefen.py

# BEKOMMT EINE FRISCHE SD-KARTE, WAS IM QUELLTEXT STEHT?
#
# Ausgeliefert wird AdminInterface/release/www.zip (autosetup.sh entpackt es
# nach /var/www/), NICHT das Verzeichnis AdminInterface/www/. Wer nur die
# .php-Dateien aendert, hat auf einer frischen Karte GAR NICHTS geaendert —
# `git diff` zeigt die Aenderung, die Box bekommt die alte Seite. Nichts wird
# dabei rot; das ist die ganze Gefahr.
#
# GEMESSEN, ZWEIMAL: am 03.08.2026 lag spotify.php im Zip drei Monate zurueck.
# Am 04.08.2026 war es wieder so weit — diesmal mit dem MQTT-Fix vom selben
# Tag (smart.php) und der neuen Spotify-Redirect-URI (spotify.php). Zwei
# Vorfaelle in zwei Tagen sind kein Zufall, sondern eine fehlende Pruefung.
# Schlaegt der Schritt an:
#   python3 tools/php-admin-fremdbezug-schau.py --zip-neu
schritt "PHP-Admin: Zip gegen Quelle" python3 tools/php-admin-fremdbezug-schau.py

# ── Wachen, die es laengst gab und die niemand rief (25.08.2026) ──────────
#
# Die vier Laeufe davor haben je EINE ungerufene Wache gefunden und
# eingehaengt — stilnamen-pruefen, grenzruf-verb-deckung, sonden-riegel-deckung,
# antworttext-ausgewertet. Jedes Mal war der Fund ein Zufall beim
# Danebenschauen. `tools/ungerufene-wachen.py` stellt die Frage jetzt
# systematisch (Werkzeuge, deren AUSGANG von einem Fund abhaengt, die aber von
# keinem Laeufer aus erreichbar sind) und fand 52 Stueck. Die folgenden sind
# die hermetischen davon: kein Geraet, kein Browser, kein Netz, zusammen unter
# einer halben Minute. Gemessen liefen sie alle gruen — bis auf die zwei
# darunter, die auf einen Fehlalarm gedriftet waren.
schritt "Sicherungsring ohne SSH (73 Aussagen)" npx tsx tools/sicherung-ohne-ssh-ring.ts
schritt "Papierkorb unter Beschuss" npx tsx tools/durchkommen-loeschen.ts
schritt "Leerlaufuhr unter Beschuss" bash tools/durchkommen-leerlauf.sh
schritt "Update-Bestand unter Beschuss" bash tools/durchkommen-update.sh
schritt "Genau eine Lautstaerkestufe regelt" bash tools/lautstaerke-einheit-probe.sh
schritt "Plugin-Geruest fuer Fremde" bash tools/plugin-geruest-probe.sh
schritt "Plugins nachziehen (jede Regel)" bash tools/mixpi-plugins-nachziehen-probe.sh
schritt "Verwaltung haelt den Vertrag" node tools/verwaltung-vertrag-probe.mjs
schritt "Malpaare (holt/zeichnet)" node tools/malpaare-schau.mjs
# DIESE HIER WAR ROT, und zwar auf einen Fehlalarm: `kiosk_laeuft` in
# mupi_start_led.sh fragt seit dem Zwei-Browser-Umbau mit `pgrep -f` statt mit
# `pidof`, der Sandkasten stellte weiter nur `pidof` nach, der Befehl fehlte
# also ganz — das Skript haengte in der Startschleife und die Probe meldete den
# Stillstand als zwei Befunde an der NEUEN Fassung. Die Attrappe ist nachgezogen,
# und ein Riegel bricht die Probe jetzt ab, statt rot zu melden, wenn das
# Skript nach einem Prozessbefehl fragt, den der Sandkasten nicht kennt.
schritt "Sieht die Box ihren Schirm" python3 tools/schirm-sandkasten.py
# BEIDE HINGEN IN KEINEM LAEUFER und starben still: sie schnitten den Boxhelfer
# an der Naht `BOXHELFER = r'''` aus ausliefern.py, und mit E42 zog der in
# scripts/box/mupibox-tauscher.py um. Neun Tage lang ValueError statt Urteil.
# Sie fassen die Box nicht an — alles laeuft unter /tmp.
schritt "Skriptweg (Hinweg im Sandkasten)" python3 tools/skriptweg-sandkasten.py
schritt "Skriptweg (was der Rueckweg liegen laesst)" python3 tools/skriptweg-rueckweg-luecken.py
# UND DIE WACHE UEBER DEN WACHEN. Rot wird sie bei einem NEUEN Werkzeug, das
# urteilt und nirgends laeuft, und ebenso, wenn ein Eintrag ihrer BEKANNT-Liste
# geloescht wurde oder inzwischen doch gerufen wird.
# Die Ratsche prueft ALLE getrackten .sh gegen die eingefrorene Baseline —
# hier hart: ohne installiertes shellcheck bricht der Schritt und nennt den
# Installationsweg. Der pre-commit-Hook prueft dieselbe Ratsche am Index,
# laesst aber ohne Werkzeug mit Warnung durch; die Pflicht wohnt hier.
schritt "Shellcheck-Ratsche" bash tools/shellcheck-ratsche.sh --pruefen

# `--pruefen` ist seit dem 19.09.2026 PFLICHT: der blinde Fleck der Wache ist
# geschlossen (sie erkennt jetzt auch `sys.exit(main())` und
# `process.exit(fehler ? 1 : 0)`), und damit meldet der blanke Aufruf ehrliche
# 252 Luecken statt 9 — also Exit 1 bei jedem Lauf. Eine dauerrote Wache ist
# keine (llmwiki: dauerrote-wache-ist-keine), deshalb urteilt hier die RATSCHE
# gegen tools/ungerufene-wachen-baseline.txt: der Bestand darf schlecht sein,
# er darf nur nicht schlechter werden. Die 252 stehen weiter in der Bilanzzeile.
schritt "Ungerufene Wachen" python3 tools/ungerufene-wachen.py --pruefen

# ── Die Untergrenze der Bildschirmhelligkeit (19.09.2026) ────────────────
#
# 0 % ist ein schwarzes Display, und ein schwarzes Display ist eine Box, die
# sich am Geraet nicht mehr zuruecknehmen laesst — der Regler ist dann selbst
# unsichtbar. Beide Wachen gab es seit 07.08.2026, gerufen hat sie nie jemand;
# mit E47 (PHP raus, 19.08.) verloren sie ihren zweiten Gegenstand, die eine
# brach seitdem bei jedem Lauf ab, die andere stuerzte. Umgebaut auf den
# Gegenstand, den es heute gibt: EINE Grenze in schirmhelligkeit.ts — und die
# Frage, ob ein zweiter Ort zurueckkommt (ein PHP-Admin aus einem Backup
# braechte die sudo-Regel wieder mit, die E47 losgeworden ist).
#
# Zusammen unter einer Sekunde, kein Geraet, kein Netz, kein Browser.
schritt "Untergrenze Bildschirmhelligkeit" python3 tools/helligkeit-untergrenze-vergleich.py
# UND DIE PROBE DARAUF: wird der Waechter bei jeder der acht Aenderungen
# wirklich rot — und bricht er bei fehlendem Gegenstand ab, statt gruen zu
# sagen? Gemessen wird in einem Spiegel unter /tmp, der Baum wird nicht
# angefasst.
schritt "Haelt der Untergrenzen-Waechter" python3 tools/untergrenzen-waechter-probe.py

# ── Der Rueckstand der Abschnitts-Deckung, in Prosa (19.09.2026) ─────────
#
# Dieselbe Tatsache steht an drei Orten (Werkzeugkopf, Wissenspaket, BACKLOG).
# Am 03.09.2026 war sie an allen falsch abgeschrieben, und keine Wache hat es
# gemerkt. Seit dem 05.09. stand im BACKLOG „Einhaengen steht aus" — zu Recht:
# die erste Fassung verlangte die HEUTE gemessene Zahl und war damit ab dem
# ersten neuen `<h2>` dauerrot. Sie prueft jetzt die FORM (datiert, und zum
# selben Datum ueberall dasselbe) und druckt die Drift zur heutigen Messung,
# ohne sie zum Urteil zu machen. Die Messung selbst wird dabei von
# tools/admin-abschnitte-deckung.py geliehen — die haengt in keinem Laeufer
# und laeuft ueber diesen Schritt zum ersten Mal regelmaessig mit.
schritt "Rueckstands-Zahl (Prosa gegen Prosa)" python3 tools/rueckstands-zahl-pruefen.py

# ── Ungerufene Wachen, dritte Welle (19.09.2026) ──────────────────────────
#
# AUDIT-2026-09-19 Rang 9 hinterliess 240 Werkzeuge, die ein Urteil faellen und
# in keinem Laeufer haengen. Sie wurden EINGEFROREN, nicht geschlossen — die
# Ratsche oben verriegelt sie nur gegen Verschlechterung. Hier stehen die, die
# aus dem Bestand nachgemessen wurden und den Laeufer nicht vergiften:
# kein Geraet, kein Netz, kein Browser, keine Karte, kein Bildschirm.
#
# JEDE EINZELNE LIEF VORHER EINMAL IN GENAU DIESER FORM UND WAR GRUEN. Das ist
# keine Hoeflichkeit, sondern die Bedingung: eine rote Wache einzuhaengen macht
# den Laeufer dauerrot und verdeckt den naechsten echten Fund (llmwiki:
# dauerrote-wache-ist-keine) — genau der Fehler, der dieses Rang-9-Aufraeumen
# ueberhaupt noetig gemacht hat. Die gemessene Laufzeit steht dahinter; die
# dreizehn hier zusammen kosten 34,3 Sekunden (eine vierzehnte,
# mixpi-vertrag-doku-abgleich.mjs, haengt in tools/doku-luecken-probe.sh —
# sie stellt eine Doku-Frage und gehoert darum dorthin).
#
# WAS BEWUSST DRAUSSEN BLIEB, mit Grund, damit es niemand nachtraegt:
#   drehung-sandkasten.py, sackgassen-schirm-ton-eingabe.mjs  — gemessen ROT
#                                           mit ECHTEN Befunden (bei der
#                                           zweiten: 5 offene Sackgassen,
#                                           3 zu; ihr Gegenstand ist am
#                                           19.09. umgehaengt worden, das Rot
#                                           kommt jetzt aus der Sache)
#   (zeichen-ohne-schrift.py und wer-hoert-wechsel-fremde-stellen.mjs standen
#    hier ebenfalls — beide sind am 19.09. gruen geworden, weil ihre Befunde
#    behoben wurden; weiterhoeren-schwellen-gleich.py ist gefallen, ihre
#    zweite Stelle gibt es nicht mehr.)
#   aussagen-halten.py (34 s), karte-dietpi-schluessel.test.sh (20 s),
#   systemverlauf-am-server.ts, similar-gegenprobe.sh (beide > 45 s; die
#   zweite sabotiert dabei verfolgten Quelltext)  — zu langsam
#   die zehn karten*-Proben, vorschlag-knopfsperre-nebenwirkung.py — tkinter
#   braucht ein DISPLAY, und ohne gesteckte Karte gaebe es nichts zu messen
#   ico-inhalt-schau.py, favicon-vergleich.py, farbmuster-unterschied.py,
#   kachel-*-nachmessen/-loecher/-gegenprobe  — Messgeraete: sie drucken
#   Zahlen, ihr Ausgang traegt kein Urteil
#   loeschdialog-ueberschrift-probe.py, kartenleser-luns-probe.py — waeren
#   gruen OHNE GEGENSTAND (kein Wechseldatentraeger, kein DISPLAY); eine gruene
#   Zeile ohne Gegenstand ist schlimmer als gar keine.
#
# UND EINE, DIE ERST HEUTE HEREINDURFTE — der lehrreichste Fund dieser
# Runde, deshalb bleibt er aufgeschrieben, obwohl er erledigt ist:
# `tools/systemkurve-gleich.py` laeuft in 61 ms sauber durch und blieb
# trotzdem draussen. Haengte man sie ein, meldete die Meta-Wache PROMPT auch
# `weiterhoeren-schwellen-gleich.py` als gedeckt — allein deshalb, weil deren
# Name im Docstring von systemkurve-gleich.py als PROSA stand. Das war der
# blinde Fleck, den tools/ungerufene-wachen.py im Kopf selbst benannte: die
# Erreichbarkeit zaehlte Prosa als Ruf. Jene Wache war gemessen ROT (ihr
# Gegenstand merkposition.ts gab es nicht mehr). Eingehaengt haette dieser
# Schritt also eine KAPUTTE Wache als „laeuft" eingefroren, ohne dass sie je
# laeuft.
#
# BEIDES IST AM 19.09.2026 BEHOBEN: `rufe()` verlangt jetzt Wortform UND
# grammatische Stellung — eine Nennung in Prosa, in einem Satz-Literal oder
# in einer Datenliste zaehlt nicht mehr (228 solcher Nennungen sind
# weggefallen, KEIN einziger echter Ruf). Und die kaputte Wache ist foermlich
# gefallen, weil ihre zweite Stelle mit der alten Oberflaeche verschwand.
# Damit deckt diese Zeile nur noch sich selbst — sie darf herein.
# Erst die drei unter einer Zehntelsekunde — reiner Quelltextvergleich.
schritt "Systemkurven an zwei Orten" python3 tools/systemkurve-gleich.py
# Wer Ton macht, braucht XDG_RUNTIME_DIR — sonst findet der PipeWire-Klient
# seinen Socket nicht, faellt auf Pulse zurueck und scheitert dort mit einer
# Meldung ueber RECHTE, die den wahren Grund verdeckt. Genau so fiel am
# 19.09.2026 das Vorlesen aus, waehrend Musik weiterspielte.
schritt "Tonweg: XDG_RUNTIME_DIR" python3 tools/tonweg-umgebung-deckung.py --pruefen
schritt "Backticks IN der Vorlage" python3 tools/backtick-in-vorlage.py
schritt "Kanalnamen an drei Orten" python3 tools/kanal-liste-gegenstelle.py
schritt "Kuerzungen der Zeitanzeige" node tools/pruef-zeitformate.js
schritt "Nutzerskala der Lautstaerke" bash tools/lautstaerke-skala-probe.sh
schritt "Farbsaetze: jede Paarung" node tools/farbsaetze-messen.mjs
# Diese drei starten einen EIGENEN Server auf einem eigenen Port (9951 / 9975 /
# 9931) und stoeren damit weder die Vorschau noch die Box — so steht es in
# ihren Koepfen, und so ist es gemessen. Zusammen rund drei Sekunden.
schritt "Fehlerbehandler am Server" node tools/fehlerbehandler-probe.mjs
schritt "Sagt der Helligkeitsregler wahr" node tools/schirm-regler-wahrheit.mjs
schritt "Helligkeitsweg am Server" node tools/schirmhelligkeit-am-server.mjs
schritt "Papierkorb gegen echte Namen" npx tsx tools/loeschen-echte-namen.ts
schritt "Medien neu einlesen (Probe)" python3 tools/medien-einlesen-probe.py
# DIE GESCHWISTER, DIE STEHENGEBLIEBEN WAREN: `durchkommen-loeschen`,
# `-leerlauf` und `-update` haengen seit dem 25.08. oben im Laeufer, `-merken`
# und `-minute` nicht — dieselbe Familie, dieselbe Bauart, nur ein anderer
# Name (llmwiki: namenssuche-nach-wachen-laesst-die-geschwister-stehen).
# Beide fassen die Box nicht an; acht bzw. neun Sekunden.
schritt "Merktiefe unter Beschuss" python3 tools/durchkommen-merken.py
schritt "Minute und Lautstaerkeboden" node tools/durchkommen-minute.mjs
# DIE TEUERSTE DER FUENFZEHN (12 s) und die einzige, die ihren Platz trotzdem
# verdient: sie schiesst den Server mit SIGKILL mitten aus dem Profil-Umzug
# und zaehlt danach nach, dass jede Ablage entweder am alten Ort oder im
# Bereich liegt — nie halb, nie nirgends. Das ist die Fehlerklasse, die am
# Bildschirm gar nichts meldet, und zwar an Nutzerdaten.
schritt "Bereichs-Umzug mit SIGKILL" env NODE_ENV=test npx tsx tools/bereich-umzug-abbruch.ts

# ── Typpruefung: faengt, was die Tests nicht sehen ────────────────────────
schritt "Typen backend-api" npx --prefix src/backend-api tsc --noEmit -p src/backend-api/tsconfig.json
schritt "Typen backend-player" npx --prefix src/backend-player tsc --noEmit -p src/backend-player/tsconfig.json

# ── Bau: baut es ueberhaupt, und ist das Ergebnis wirklich da? ─────────────
bau_server() {
  # --log-level=error IST HIER PFLICHT, nicht Geschmack.
  #
  # esbuild-wasm STUERZT AB, wenn es seine Warnungen in eine umgeleitete
  # Ausgabe schreibt: `RangeError: Invalid array length` in fs.writeSync
  # (esbuild-wasm/bin/esbuild:69, Node 26). Der Bau selbst gelingt — nur das
  # Ausgeben der Warnungen bringt den Prozess um, und dieser Schritt meldete
  # deshalb DAUERHAFT einen Fehler, obwohl nichts kaputt war. Am Bildschirm
  # (ohne Umleitung) lief derselbe Aufruf durch, was die Suche verschleppt hat.
  #
  # Ein Pruefschritt, der immer rot ist, ist schlimmer als keiner: Man gewoehnt
  # sich an ihn und uebersieht den Tag, an dem er zu Recht rot wird.
  #
  # FEHLER bleiben sichtbar und brechen weiter ab — nur die Warnungen fallen
  # weg. Dass die Datei wirklich entstanden ist, wird darunter ohnehin geprueft.
  npx --prefix src/backend-api esbuild src/backend-api/src/server.ts \
    --bundle --minify --platform=node --target=node22 --log-level=error \
    --outfile="$BAU/server.js" >/dev/null 2>&1 || return 1
  # NICHT dem Exitcode glauben — nachsehen (siehe Kopf).
  [ -s "$BAU/server.js" ] || { echo "server.js wurde nicht geschrieben"; return 1; }
}
schritt "Bau Server" bau_server

bau_admin() {
  (cd src/frontend-admin && npx ng build --configuration production --output-path "$BAU/admin" >/dev/null 2>&1) || return 1
  [ -f "$BAU/admin/browser/index.html" ] || { echo "index.html fehlt — die Verwaltung waere nach dem Tausch tot"; return 1; }
}
schritt "Bau Verwaltung" bau_admin

# (bau_box fiel mit der alten App, E118/1e — die Box-Oberflaeche wird nicht
# mehr GEBAUT, sondern von tools/newdesign-kopieren.py kopiert; deren Wache
# ist newdesign-mitlieferung-deckung.py weiter oben.)

# ── Der DRITTE Ausrollweg: das Installer-Rezept ───────────────────────────
#
# "Ausrollweg-Deckung" und "Paketlisten-Deckung" weiter oben vergleichen die
# ZWEI Shell-Wege miteinander. Beide uebersehen denselben dritten, und
# paketlisten-deckung.py sagt das in seinem eigenen Kopf ausdruecklich: die
# Rezepte des remote-step-installers sieht es NICHT. Genau die sind aber der
# Weg, ueber den heute eine frische Karte entsteht (ausrollweg-deckung.py haelt
# das seit dem 31.08.2026 fest).
#
# WAS AM 19.09.2026 DORT LAG, beides von Hand gefunden: `wireguard-tools` fehlte
# dem Rezept, nachdem es am selben Tag in den Update-Weg nachgezogen worden war
# (f97fcbce) — eine frisch bespielte Karte bekam eine VPN-Seite, die nur
# "Das Werkzeug fehlt" sagt. Und der Schritt `app-paket` beschrieb deploy.zip
# mit vier Stuecken, drin liegen sieben; unter den ungenannten
# `plugin-laufwerk.js`, dessen Fehlen die Box NICHT kaputtmacht, sondern nur
# still kein Plugin laden laesst.
#
# Die Wache liest deploy.sh und das Zip, statt eine vierte Handliste zu fuehren.
schritt "Rezept-Deckung (dritter Ausrollweg)" python3 tools/rezept-deckung.py --pruefen

# ZWEI GEWOHNHEITEN, EIN URSPRUNG (AUDIT-2026-09-19, Raenge 3 und 10f): eine
# Zwischendatei, die nur die Prozesskennung traegt, und ein roher Fehler in
# einer Antwort nach draussen. Beides entsteht beim Nachbauen von Hand statt
# beim Anhaengen an die vorhandene Naht.
#
# Der teure Ausgang ist der STILLE: am 19.09.2026 an /api/vpn/konfiguration
# gemessen — zwei ueberlappende Uebernahmen meldeten BEIDE 200, und beide
# Male ging DIESELBE Konfiguration nach /etc/wireguard, die des jeweils
# anderen. Nichts davon stand im Journal.
schritt "Zwischendatei und Fehlerleck" python3 tools/schreibstelle-und-fehlerleck.py

# ── Tote Funktionen in der buendlerlosen Oberflaeche (19.09.2026) ─────────
#
# `NewDesign/app.js` ist 1,6 MB in EINER Datei ohne Module. Fuer diese Form
# gibt es kein Fertigwerkzeug (AUDIT-2026-09-19 Rang 12: knip urteilt auf
# Export-Ebene und greift ohne Module nicht). Die toten Funktionen wurden
# deshalb bisher VON HAND gefunden, und zwar viermal dieselben — `wischWort`
# am 22.08., `hinueberDurchsTor` am 21.08. und noch einmal am 31.08.,
# `sprichImBrowser` am 19.09. Derselbe Befund ueber mehrere Laeufe ist ein
# Ablauffehler, kein Fleiss (llmwiki: wiederkehrender-befund-ist-ablauffehler).
#
# HIER LAEUFT `--pruefen`, NICHT DER BERICHT. Die Befundliste ist ein BESTAND
# (heute 3 tot, 6 mit Grund daneben), und mehrere Eintraege stehen auf
# erklaerte Absicht im Baum. Als Urteil waere sie ab Tag eins dauerrot und
# damit keine Wache mehr (llmwiki: dauerrote-wache-ist-keine). Die Ratsche
# gegen tools/tote-funktionen-baseline.txt blockt nur die Verschlechterung:
# eine Funktion, die NEU ohne Aufrufer dasteht. Der volle Bericht:
#   node tools/tote-funktionen-schau.mjs        (und --lang)
schritt "Tote Funktionen (Ratsche)" node tools/tote-funktionen-schau.mjs --pruefen
# UND DIE PROBE DARAUF, zweiseitig: eine Wegwerf-Funktion, die niemand ruft,
# MUSS im Befund stehen — und sobald jemand sie ruft, MUSS sie verschwinden.
# Dazu die Gegenkontrolle, ohne die der Treffer nichts beweist: was nur
# ZUSAMMENGESETZT gerufen wird (`tafel['praefix' + x]()`), darf in KEINER
# Richtung als tot gelten. Das Wegwerfziel liegt unter /tmp, der Baum wird
# nicht angefasst.
schritt "Haelt die Tote-Funktionen-Wache" node tools/tote-funktionen-schau.mjs --gegenprobe

# DIE LISTE DER KIOSK-BROWSER STEHT AN DREI ORTEN, und sie muessen sich
# decken: was der Eltern-Bereich anbietet (konfiguration.ts, Feld
# `kioskBrowser`), wofuer mixpi-kiosk-pakete.sh Pakete nachholt, und dass
# chromium-autostart.sh einen Rueckfall auf Chromium behaelt.
#
# WARUM DAS EINE WACHE BRAUCHT (19.09.2026): Cog ist abgekuendigt
# (Igalia/cog#799 — keine stabilen Releases ueber 0.18.x), der Nachfolger
# WPEPlatform ist seit WPE 2.54.0 stabil. Der naechste, der hier einen
# dritten Wert eintraegt, traegt ihn in die Oberflaeche ein und vergisst
# den Paketholer — dann zeigt der Schalter auf ein Programm, das die Box
# nie installiert. Und faellt dabei der Rueckfall weg, steht ein Kind vor
# einem schwarzen Schirm an einer Box OHNE TASTATUR (llmwiki
# kiosk-browser-umschaltbar-mit-rueckfall). Die Wache ist offline, braucht
# weder Netz noch Geraet. Die Messungen dazu:
#   python3 tools/wpe-nachfolge-pruefen.py --quellen --stellen
schritt "Kiosk-Browser: Wahl, Pakete, Rueckfall" python3 tools/wpe-nachfolge-pruefen.py

# NewDesign/app.js IST 33 000 ZEILEN UND STAND IN KEINEM SCHRITT. Zwei
# Raenge des Audits vom 19.09.2026 lagen beide dort, und beide sind dieselbe
# Sorte: eine Regel an mehreren Stellen laeuft auseinander, und die
# ABWEICHUNG ist dann der Fehler.
#
# GEMESSEN an dem Tag, mit diesem Werkzeug: 26 der 44 aendernden `fetch`
# hatten keine Frist — die Trennlinie war die Entstehungszeit, nicht die
# Gefahr (die Netz- und Profil-Gruppen komplett ohne, die Dienste-Gruppe
# komplett mit). Dazu stand `helligkeitSetzen` doppelt mit vier
# Abweichungen, die /mupihat-Deutung dreimal, und ein Laufzeit-Formatierer
# konnte „seit -5 s" anzeigen.
#
# WARUM NICHT IN `fetch-frist-schau.mjs`: Das Werkzeug zaehlt nur die vier
# Server-Dateien und urteilt ueber ein FENSTER von 12 Zeilen — in der
# gefaehrlichen Richtung zaehlt dort das `signal:` eines TIEFER stehenden
# Aufrufs fuer den darueber. Dieses hier liest von Klammer zu Gegenklammer.
#
# Die sechs Regeln stehen im Kopf des Werkzeugs, jede ist einzeln rot zu
# bekommen (am 19.09.2026 alle sechs nachgestellt; zwei blieben beim ersten
# Anlauf gruen und wurden daraufhin nachgeschaerft). Der volle Bericht:
#   node tools/app-eine-stelle-schau.mjs --alle
schritt "app.js: eine Regel, eine Stelle" node tools/app-eine-stelle-schau.mjs --pruefen

# ── Die Box selbst: laeuft dort noch alles? ───────────────────────────────
if [ "$BOX" = "1" ]; then
  # WIE LANGE DAUERT EIN SATZ WIRKLICH? Das entscheidet, ob das Vorlesen
  # bedienbar ist, und es haengt an der EINGESTELLTEN STIMME — eine Zahl, die
  # keine Pruefung am Schreibtisch kennen kann. Am 04.08.2026 stand
  # de_DE-thorsten-high bei Tempo 2, und ein neuer Satz brauchte 5,1 s: mehr
  # als der Zaun von 4 s, den die Oberflaeche einhaelt. Der Schritt faellt
  # dann rot — und das ist richtig so, es ist ein Befund, kein Programmfehler.
  schritt "Vorlesen am Geraet" node tools/vorlesen-am-geraet.mjs --pruefen

  # Der Wechsel klein -> gross -> klein im ECHTEN Browser gegen die ECHTE Box.
  # Die reinen Tests pruefen die REGEL, welches Bild gewaehlt wird - dieser
  # Test, ob am Ende wirklich eines auf dem Bildschirm steht. Genau dazwischen
  # lag der Fehler: unten ein Bild, oben ein Symbol.
  e2e_player() {
    node tools/e2e/player-gross-klein.mjs "${MUPI_URL:-https://mupibox:8443}"
  }
  schritt "Player klein/gross (echter Browser)" e2e_player

  # Springt der Balken? In BEIDEN Ansichten gemessen - der Fehler zeigte sich
  # nur in der grossen, weil beide getrennt rechneten.
  e2e_fortschritt() {
    node tools/e2e/fortschritt-klein-gross.mjs "${MUPI_URL:-https://mupibox:8443}"
  }
  schritt "Fortschritt klein/gross" e2e_fortschritt

  # Wann steht welches Element? Die kleine Leiste ist der Massstab: beide
  # bekommen dieselben Daten, ein Unterschied je Element zeigt also, WO die
  # Zeit verlorengeht - statt nur, dass es sich langsam anfuehlt.
  e2e_anlauf() {
    node tools/e2e/player-anlauf.mjs "${MUPI_URL:-https://mupibox:8443}"
  }
  schritt "Anlauf klein/gross" e2e_anlauf

  box_check() {
    ssh -o ConnectTimeout=10 -o BatchMode=yes dietpi@mupibox 'sudo -n mupi-check' 2>&1 | tee /tmp/mupi-check.txt | tail -1
    # Warnungen sind erlaubt, Fehler nicht. Die Zeile lautet
    # "N Pruefungen: 0 Fehler, M Warnungen" — auf die 0 vor "Fehler" pruefen.
    grep -qE ':[[:space:]]*0 Fehler' /tmp/mupi-check.txt
  }
  schritt "Geraetepruefung (mupi-check)" box_check

  # Wie viele ausgelieferte Cover sind in Wahrheit das Rueckfallbild? Die
  # Wache vergleicht INHALTE (Pruefsummen), nicht Status/Typ/Groesse — genau
  # der Unterschied, an dem die erste Cover-Analyse vorbeilief (llmwiki
  # rueckfallbild-macht-den-fehler-unsichtbar). Sie braucht die laufende Box
  # und steht darum hier und nicht in der Doku-Probe (dort seit 09.09.2026
  # ihre Schwester fernbedienung-bild-deckung.py).
  #
  # SIE IST NICHT MEHR DAUERROT (10.09.2026). Der Kritiker-Lauf desselben
  # Tages hatte zu Recht geruegt, dass ein „erwartet rot" zum Rot-Ueberlesen
  # erzieht. Die Schuld ist abgetragen: `tools/mixpi-cover-nachfuellen.py`
  # hat 65 Cover nachgeholt, gemessen 68 -> 3 Rueckfallbilder. Von den drei
  # Resten sind ZWEI leere Ordner (nur playlist.m3u, kein Ton — ein fehlendes
  # Cover ist dort kein Fehler, sondern die Spur einer geloeschten Aufnahme),
  # der dritte steht in keiner Vormerkung. Wird der Schritt wieder rot,
  # nimmt ein Aufnahmeweg erneut ohne Bild auf — das ist dann ein Befund.
  cover_platzhalter() {
    python3 tools/cover-platzhalter-probe.py --box dietpi@mupibox
  }
  schritt "Cover gegen das Rueckfallbild (cover-platzhalter-probe)" cover_platzhalter

  # AUFRAEUMEN: die Tests lassen die Box irgendwo mitten in der Bibliothek
  # stehen - mit offenem Player, gestoppter Wiedergabe, in einer Titelliste.
  # Wer danach hinschaut, haelt das leicht fuer einen Fehler. Kein eigener
  # Schritt in der Liste: es ist Hausputz, kein Befund.
  MUPI_HOST="$(echo "${MUPI_URL:-https://mupibox:8443}" | sed -E 's#^[a-z]+://##; s#[:/].*##')" \
    tools/aufraeumen.sh
fi

# ── Routen ohne Rufer (19.09.2026, AUDIT-2026-09-19 Rang 7) ────────────────
#
# An diesem Tag sind sieben Endpunkte gefallen, weil sie niemand rief —
# darunter einer, der ungeprueft in die WLAN-Konfiguration schrieb und vor dem
# Anmeldetor lag. Keiner davon ist ueber Nacht tot geworden: sie starben, als
# ihre Klienten gingen (alte Oberflaeche mit E118, PHP-Admin mit E47), und
# gemerkt hat es niemand, weil nichts danach fragt. Genau dafuer steht die
# Wache hier — sie meldet, wenn eine NEUE Route ohne Rufer dazukommt.
#
# OHNE `--geraet`, und das ist Absicht: die Geraetehaelfte braucht ssh zur
# laufenden Box und gehoert damit nicht in einen Laeufer, der auch ohne Box
# gruen sein muss. Wer loeschen will, ruft sie einzeln mit `--geraet` — ohne
# diese Haelfte traegt der Befund keine Entscheidung (E47-Erbe).
routen_ohne_rufer() {
  python3 tools/routen-ohne-rufer.py
}
schritt "Routen ohne Rufer (routen-ohne-rufer)" routen_ohne_rufer

# ── Hat sich die WPEPlatform-Lage gedreht? (19.09.2026) ────────────────────
#
# Der Satz „WPEPlatform gibt es fuer Trixie nicht" stimmt heute und HAT EIN
# HALTBARKEITSDATUM: er kippt, sobald ein Backport erscheint, die
# Raspberry-Pi-Quelle etwas liefert oder die Box auf das naechste
# Debian-Stable zieht. Als Prosa in AUDIT-2026-09-19-WPE.md altert er still —
# und die uebernaechste Sitzung graebt dieselbe Machbarkeit noch einmal aus
# (llmwiki `wiki-zustand-hat-haltbarkeit`). Deshalb steht er hier als Wache.
#
# SIE IST NICHT DAUERROT UND SOLL ES NIE WERDEN (llmwiki
# `dauerrote-wache-ist-keine`): solange WPEPlatform fehlt, ist das der
# ERWARTETE Zustand und kein Befund — sie schweigt. Rot wird sie genau dann,
# wenn die Nachfolge zum ersten Mal beschaffbar ist. Das ist dann kein
# Programmfehler, sondern die Nachricht, auf die dieser Baum wartet.
#
# OHNE NETZ GRUEN, mit Ansage: jeder der vier Messorte, der nicht erreichbar
# ist, wird als NICHT GEMESSEN gemeldet und NICHT als „unveraendert"
# verbucht. Eine Wache, die im Zug rot wird, erzieht zum Ueberlesen.
#
# `--gegenprobe` laeuft mit, weil eine Wache, die nur im erwarteten Zustand
# geprueft wurde, ungeprueft ist (llmwiki `gegenprobe-statt-gruen-glauben`):
# drei Richtungen an Attrappen echter Paketindizes — Lage wie heute
# (muss schweigen), WPEPlatform aufgetaucht (muss anschlagen), kein Netz
# (muss schweigen und alle vier Stellen als NICHT GEMESSEN nennen). Offline
# und in unter einer Sekunde durch.
#
# Die ausfuehrliche Messung dazu:
#   python3 tools/wpe-nachfolge-pruefen.py --quellen --stellen
wpe_lage() {
  python3 tools/wpe-nachfolge-pruefen.py --gegenprobe --lage
}
schritt "WPEPlatform-Lage (meldet Aenderung)" wpe_lage

# tools/kiosk-pss-messen.py braucht die laufende Box und kann darum in keinem
# Laeufer stehen, der auch ohne Geraet gruen sein muss — genau so verrottet
# ein Werkzeug aber unbemerkt (llmwiki `skript-das-niemand-ruft-verrottet-
# lautlos`). Diese Zeile ist kein Ersatz fuer eine Messung und behauptet auch
# keine: sie ruft nur `--help` und faellt damit auf, wenn die Datei
# syntaktisch bricht oder ein Import stirbt. Die echte Messung steht in
# AUDIT-2026-09-19-WPE.md §7 und geht so:
#   python3 tools/kiosk-pss-messen.py --box dietpi@192.168.178.62 --wdh 2 --abstand 600
pss_werkzeug_laeuft() {
  python3 tools/kiosk-pss-messen.py --help >/dev/null
}
schritt "Kiosk-PSS-Werkzeug ist aufrufbar" pss_werkzeug_laeuft

echo "──────────────────────────────────────────────────────"
if [ "$FEHLER" = "0" ]; then
  echo -e "${GRUEN}Alles in Ordnung.${AUS}"
else
  echo -e "${ROT}$FEHLER Schritt(e) gebrochen:${AUS} ${GEBROCHEN[*]}"
fi
exit "$FEHLER"
