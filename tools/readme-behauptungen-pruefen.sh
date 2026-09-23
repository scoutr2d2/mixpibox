#!/usr/bin/env bash
# WOZU: Prueft die pruefbaren Behauptungen der README.md — und die zaehlenden
#   Behauptungen von dokumentation/mixpibox.md (Abschnitt 3b) — gegen den Baum.
#   Eine README, die eine Funktion verspricht, die es nicht gibt, ist schlimmer
#   als eine veraltete. Alle Pfade, Zahlen, Befehle und Wiki-Verweise, die in
#   README.md stehen, werden hier einzeln nachgesehen.
#
# AUFRUF:  tools/readme-behauptungen-pruefen.sh
#          (aus dem Wurzelverzeichnis oder von ueberall — findet sich selbst)
#
# WAS ES NICHT TUT: Es liest die README nicht, es kennt die Behauptungen
#   fest verdrahtet. Aendert sich die README, muss dieses Werkzeug mit.
#   Es faellt auch nicht um, wenn etwas fehlt — es zaehlt und meldet am Ende.

set -u
WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# ══ SEIT DEM 08.08.2026 LIEGT DAS WISSENSPAKET IM BAUM ══════════════════════
#
# Betreiber: „ich möchte das wiki llm und auch die werkzeuge wie das zum sd
# karte schreiben mit ins repository aufnehmen dass alles beisammen ist."
# Es steht seither unter `llmwiki/` (per `git subtree`, siehe ZUGEZOGEN.md).
#
# DER ALTE PFAD BLEIBT ALS RUECKFALL, und zwar nicht aus Bequemlichkeit: Wer
# einen Stand von vor diesem Tag ausgecheckt hat, hat kein `llmwiki/` — und
# ein Werkzeug, das dann bloss abbricht, ist schlechter als eines, das den
# alten Ort noch kennt. Gefunden wird, was zuerst dasteht.
if   [ -f "$WURZEL/llmwiki/pack.yaml" ]; then WIKI="$WURZEL/llmwiki/pack.yaml"
else WIKI="/home/achim/Downloads/llmwiki_mupibox/pack.yaml"; fi
FEHLER=0

ok()   { printf '  OK    %s\n' "$1"; }
weg()  { printf '  FEHLT %s\n' "$1"; FEHLER=$((FEHLER+1)); }
# ══ WARUM DIESE FUNKTION SEIT DEM 23.08.2026 AUCH URTEILT ═══════════════════
#
# Sie hat bis dahin nur GEDRUCKT. Der Lauf an diesem Tag zeigte SECHS Zahlen,
# und alle sechs waren falsch — `tools/` mit 71 statt 438 (Faktor 6),
# NewDesign mit ~9100 statt 38 734 (Faktor 4), das Wissenspaket mit ">370"
# statt 796, dazu 51/113 Testdateien, 16/21 Seiten, 22/41 Units. Der Lauf
# endete trotzdem mit „1 Behauptung ohne Beleg" und meinte damit etwas ganz
# anderes. Eine Wache, die den Befund druckt und dann gruen meldet, wird nach
# der zweiten Woche ueberlesen — dieselbe Klasse wie die Tabelle mit sieben
# von zwanzig Diensten in `tools/doku-luecken-probe.sh`.
#
# GEPRUEFT WIRD EIN BAND, KEINE ZAHL. Eine README, die „438 Werkzeuge" sagt,
# ist am naechsten Tag falsch, und eine Wache, die darauf besteht, zwingt zu
# einer Zeile Doku je neuem Skript — die schreibt niemand, und dann wird die
# Wache abgeschaltet. Gemeldet wird deshalb erst, wenn die Abweichung die
# Toleranz reisst: gefangen wird „um ein Vielfaches daneben", nicht „drei
# mehr als gestern". Vorgabe 15 %, viertes Argument setzt sie hoeher fuer
# das, was schnell waechst.
#
# `>370` UND `~9100` SIND ZAHLEN: die README schreibt Groessenordnungen mit
# Vorsatzzeichen, und ein blosses `$(( ))` darauf bricht die Datei ab. Alles
# ausser Ziffern faellt darum vor dem Rechnen weg.
zahl() {
  local name="$1" behauptet="$2" gemessen="$3" toleranz="${4:-15}"
  local roh
  roh=$(printf '%s' "$behauptet" | tr -cd '0-9')
  if [ -z "$roh" ] || [ "$roh" -eq 0 ] || ! [ "$gemessen" -eq "$gemessen" ] 2>/dev/null; then
    printf '  ZAHL  %-46s behauptet: %-8s gemessen: %s\n' "$name" "$behauptet" "$gemessen"
    return
  fi
  local ab=$(( gemessen > roh ? gemessen - roh : roh - gemessen ))
  if [ $(( ab * 100 / roh )) -gt "$toleranz" ]; then
    printf '  VERALTET %-43s behauptet: %-8s gemessen: %s  (%d %% daneben, erlaubt %d %%)\n' \
      "$name" "$behauptet" "$gemessen" $(( ab * 100 / roh )) "$toleranz"
    FEHLER=$((FEHLER+1))
  else
    printf '  ZAHL  %-46s behauptet: %-8s gemessen: %s\n' "$name" "$behauptet" "$gemessen"
  fi
}

pfad() {  # $1 = Pfad relativ zur Wurzel
  if [ -e "$WURZEL/$1" ]; then ok "$1"; else weg "$1"; fi
}

echo "== 1. Pfade, die die README nennt =="
for p in \
  NewDesign/bilder/mixpi-hoert.png \
  NewDesign/maskottchen.json \
  NewDesign/apps.js \
  NewDesign/video.js \
  NewDesign/schriften \
  AGENTS.md \
  BACKLOG.md \
  LICENSE.md \
  ZUGEZOGEN.md \
  plugins/README.md \
  dokumentation/mixpibox.md \
  documentation \
  tools/pruefen.sh \
  tools/doku-luecken-probe.sh \
  tools/neu-vorschau.mjs \
  tools/admin-vorschau.mjs \
  tools/schirmbilder-readme.mjs \
  tools/schirmbilder-verwaltung.mjs \
  tools/wiki-suche.py \
  tools/plugin-geruest.mjs \
  tools/plugin-pruefen.mjs \
  tools/mixpi-paketfrische-pruefen.py \
  tools/git-hooks \
  tools/github-veroeffentlichen.py \
  tools/github-ausschluss.txt \
  src/deploy.sh \
  src/frontend-box/LIESMICH.md \
  src/backend-api/src/interpretenseite.ts \
  src/backend-api/src/weiterhoeren.ts \
  src/backend-api/src/verschmelzung.ts \
  src/backend-api/src/profile.ts \
  src/backend-api/src/kinderzeit.ts \
  src/backend-api/src/spiele.ts \
  src/backend-api/src/server.ts \
  src/frontend-admin \
  src/backend-player \
  scripts/box/fernbedienung.py \
  scripts/chromium-autostart.sh \
  config/services \
  config/fernbedienungen \
  config/templates/61-entzerrer.conf \
  plugins/mixpi-klang \
  plugins/mixpi-mitschnitt \
  autosetup/autosetup.sh \
  update \
  harness \
  mupictl \
  bin/nodejs/deploy.zip \
  media \
  llmwiki/pack.yaml \
  ; do pfad "$p"; done
# `AdminInterface` STAND HIER BIS ZUM 23.08.2026 und meldete FEHLT — zu Recht,
# aber gegen die falsche Datei: das Verzeichnis ist mit E47 (19.08.2026)
# ausgebaut worden, und die README nennt es seither nicht mehr. Gemeldet wurde
# also nicht eine Luecke in der README, sondern eine im PRUEFER, und der
# einzige rote Punkt des Laufs zeigte vier Tage lang auf nichts. Wer eine
# Zeile aus der README nimmt, nehme sie auch hier heraus.

echo
# ══ DIE BILDER DER README ═══════════════════════════════════════════════════
#
# Seit dem 23.09.2026 zeigt die README Schirmbilder. Ein Bild, das fehlt, ist
# auf GitHub ein kaputtes Kaestchen — und nichts sagt es einem. Geprueft wird
# deshalb NICHT gegen eine Liste hier (die veraltete beim naechsten Bild),
# sondern gegen die README selbst: jede `![...](pfad)`-Zeile wird nachgesehen.
echo "== 1b. Bilder, die die README einbettet =="
_bilder=$(grep -oE '!\[[^]]*\]\(([^)]+)\)' "$WURZEL/README.md" | sed -E 's/.*\((.*)\)/\1/' | sort -u)
_bz=0
for b in $_bilder; do
  case "$b" in http*) continue ;; esac
  _bz=$((_bz + 1))
  pfad "$b"
done
if [ "$_bz" -eq 0 ]; then
  weg "die README bettet gar kein Bild mehr ein (frueher waren es elf)"
fi
# Die englische Fassung bettet dieselben Bilder ein — hier nur: gibt es sie?
# Ob es DIESELBEN sind, prueft tools/readme-paritaet-pruefen.py.
if [ -f "$WURZEL/README.en.md" ]; then
  for b in $(grep -oE '!\[[^]]*\]\(([^)]+)\)' "$WURZEL/README.en.md" | sed -E 's/.*\((.*)\)/\1/' | sort -u); do
    case "$b" in http*) continue ;; esac
    pfad "$b"
  done
else
  weg "README.en.md (die deutsche README kuendigt eine englische Fassung an)"
fi

echo
# SEIT DEM 08.08.2026 IST DAS EINE ANDERE BEHAUPTUNG. Hier stand „eigenes Repo,
# ausserhalb des Baums", und geprueft wurde, ob ~/Downloads/remote-step-installer
# existiert. Beides gilt nicht mehr: Installer und Wissenspaket liegen im Baum
# (ZUGEZOGEN.md). Ein Pruefer, der die alte Behauptung belegt, belegt eine
# Aussage, die in der README gar nicht mehr steht.
echo "== 2. Installer und Wissenspaket liegen IM Baum =="
for p in remote-step-installer/sdprep remote-step-installer/sdstart \
         remote-step-installer/sdstart.cmd remote-step-installer/sdgui \
         remote-step-installer/sdtui remote-step-installer/setup-controller.sh \
         remote-step-installer/tui remote-step-installer/stepctl \
         remote-step-installer/agent/install-agent.sh \
         remote-step-installer/recipes/mupibox.yaml \
         remote-step-installer/recipes/mupibox-app.yaml \
         remote-step-installer/recipes llmwiki/pack.yaml; do
  if [ -e "$WURZEL/$p" ]; then ok "$p"; else weg "$p"; fi
done
# Der alte Nachbarordner DARF noch daliegen (er ist die Herkunft), aber er ist
# nicht mehr noetig — deshalb ist sein Fehlen hier kein Fehler.
if [ -d "$HOME/Downloads/remote-step-installer" ]; then
  printf '  ----  ~/Downloads/remote-step-installer liegt noch da (Herkunft, nicht mehr noetig)\n'
fi

echo
echo "== 3. Zahlen =="
# FALLE (03.08.2026 beim Gegenlesen): mitgezaehlt wuerden sonst die Zeilen von
# MixPiBox-standalone.html, einer Vorfuehrdatei, die NICHT ausgeliefert wird.
# Gezaehlt wird, was auf der Box landet.
#
# DIE ZAHL WAECHST SCHNELL — darum die weite Toleranz: am 03.08. waren es rund
# 9100 Zeilen, am 23.08. 38 734. `dokumentation/mixpibox.md` §4.2 haelt fest,
# dass allein am 21.08. zwischen Vormittag und Nachmittag 1720 dazukamen. Die
# Zahl steht fuer die Groessenordnung, nicht fuer einen Wert.
#
# NACHGEZAEHLT AM 23.09.2026: gemessen wurden bis dahin DREI Dateien, aus-
# geliefert sind FUENF. `apps.js` (die Schublade) und `video.js` kamen im
# September dazu und haengen in `index.html` (Zeilen 1826-1828), `video.css`
# neben `app.css` (Zeile 141). Die Wache zaehlte also 47 806 Zeilen, waehrend
# 50 064 auf die Box gehen — sie hat die neuen Dateien schlicht nicht gekannt.
# WER EINE DATEI IN index.html HAENGT, HAENGT SIE AUCH HIER EIN.
n=$(cat "$WURZEL/NewDesign/app.js" "$WURZEL/NewDesign/app.css" \
       "$WURZEL/NewDesign/apps.js" "$WURZEL/NewDesign/video.js" \
       "$WURZEL/NewDesign/video.css" \
       "$WURZEL/NewDesign/index.html" 2>/dev/null | wc -l)
zahl "NewDesign ausgeliefert (app+apps+video+index)" "rund 50000" "$n" 25

n=$(find "$WURZEL/src/backend-api/src" -name '*.spec.ts' -o -name '*.test.ts' | wc -l)
zahl "backend-api Testdateien" "142" "$n" 20

n=$(find "$WURZEL/src/backend-player/src" -name '*.spec.ts' -o -name '*.test.ts' 2>/dev/null | wc -l)
zahl "backend-player Testdateien" "15" "$n" 20

# DIE REZEPTSCHRITTE stehen seit dem 23.09.2026 in der README (Abschnitt 4.5:
# „30 + 24 Schritte"). Sie sind die Laenge der Installation, und sie waechst
# mit jedem neuen Schritt — gezaehlt wird die Kennung am Listenanfang, wie sie
# `laufpaket.py` auch einsammelt.
n=$(grep -cE '^  - id:' "$WURZEL/remote-step-installer/recipes/mupibox.yaml" 2>/dev/null)
zahl "Schritte in recipes/mupibox.yaml" "30" "$n" 10
n=$(grep -cE '^  - id:' "$WURZEL/remote-step-installer/recipes/mupibox-app.yaml" 2>/dev/null)
zahl "Schritte in recipes/mupibox-app.yaml" "24" "$n" 10

# DIE PLUGINZAHL: die README nennt „14 Plugins im Baum" an drei Stellen.
n=$(find "$WURZEL/plugins" -mindepth 1 -maxdepth 1 -type d | wc -l)
zahl "Plugins in plugins/" "14" "$n" 10

# GEZAEHLT WIRD DIE ROUTE, NICHT DIE DATEI (umgestellt 23.08.2026). Zuvor lief
# hier `find seiten/ -name '*.ts' -not -name '*.spec.ts'` und kam auf 28,
# waehrend die Verwaltung 21 Seiten hat: unter `seiten/` liegen auch Bausteine,
# die keine Seite sind (`mixpi-plugin-abschnitt.ts`, `systemkurve.ts`,
# `spotify-assistent.ts`, `spotify-maschine.ts`, `spotify-stroeme.ts`,
# `jellyfin-schnellverbindung.ts`). Die Zahl war damit auch dann falsch, wenn
# die README stimmte — und ein Pruefer, der eine richtige Aussage anmeckert,
# wird zu Recht ignoriert. `app.routes.ts` fuehrt die Seiten selbst; abgezogen
# wird `anmeldung`, weil die README sie getrennt nennt ("+ Anmeldung").
n=$(grep -cE "^[[:space:]]+title: " "$WURZEL/src/frontend-admin/src/app/app.routes.ts" 2>/dev/null)
n=$(( n - 1 ))
zahl "frontend-admin Seiten (Routen mit title:, ohne Anmeldung)" "27" "$n" 10

# NACHGEZAEHLT AM 23.09.2026: gezaehlt wurden `.service` und `.timer` — die
# `.path`-Einheit (mupibox-sicherung.path) fiel durch, und die README sagte
# deshalb 41 statt 42. Eine Einheit ist eine Einheit; wer eine neue Sorte
# dazulegt, zaehlt sie hier mit.
n=$(find "$WURZEL/config/services" \( -name '*.service' -o -name '*.timer' -o -name '*.path' \) 2>/dev/null | wc -l)
zahl "systemd-Einheiten in config/services" "42" "$n" 10

# tools/IDEEN.md ist kein Werkzeug, und dieses Skript hier zaehlt sich selbst
# mit — beides abziehen, sonst waechst die Zahl bei jedem Gegenlesen.
n=$(find "$WURZEL/tools" -maxdepth 1 -type f \
      \( -name '*.sh' -o -name '*.mjs' -o -name '*.py' -o -name '*.js' \) | wc -l)
zahl "Werkzeuge in tools/ (Skripte, inkl. dieses)" "ueber 560" "$n" 25

# DIE PAKETZAHL WIRD HIER NICHT MEHR MIT `zahl` GEPRUEFT (27.08.2026).
#
# Sie stand als Literal `"796"` im Aufruf — also NICHT als das, was die README
# sagt, sondern als das, was ihr Autor beim Bau der Wache abgeschrieben hatte.
# Gemessen wurde damit das Paket gegen eine Kopie IN DIESER DATEI; die README
# selbst wurde nie gelesen. Sie fuehrte am 27.08. 799 Eintraege, das Paket 857
# — 7,7 % auseinander und damit innerhalb der 20 % Toleranz. Dauerhaft gruen,
# dauerhaft falsch, und eine Korrektur an der README haette hier nichts
# geaendert (llmwiki `wache-prueft-ihre-eigene-abschrift`).
#
# Eine abgeleitete Zahl braucht ausserdem keine Toleranz: sie ist gleich oder
# veraltet. Zustaendig ist jetzt `tools/paket-angaben-nachziehen.py` — es
# LIEST die Behauptung aus jeder Datei, die sie fuehrt, und vergleicht exakt.
if [ -x "$WURZEL/tools/paket-angaben-nachziehen.py" ]; then
  if ! ausgabe=$(python3 "$WURZEL/tools/paket-angaben-nachziehen.py" --pruefen 2>&1); then
    printf '%s\n' "$ausgabe" | sed 's/^/  /'
    FEHLER=$((FEHLER+1))
  else
    printf '  ZAHL  %-46s %s\n' "Umfang des Wissenspakets (alle Fundstellen)" "exakt geprueft"
  fi
else
  echo "  WARNUNG: tools/paket-angaben-nachziehen.py fehlt — Paketzahl UNGEPRUEFT"
  FEHLER=$((FEHLER+1))
fi

echo
# ══ WARUM HIER EINE ZWEITE DATEI STEHT (24.08.2026) ═════════════════════════
#
# Diese Wache hiess bis heute nach EINER Datei und pruefte auch nur die. Am
# 23.08. korrigierte sie „51 Testdateien" in der README auf 113 — und derselbe
# Wert stand unkorrigiert in `dokumentation/mixpibox.md` §7.3, in einem Block,
# dessen SECHS Zeilen alle falsch waren (backend-api 51/113, frontend-admin
# 8/18, NewDesign 7/28). Er hat dort einundzwanzig Tage ueberlebt, waehrend
# vierzehn Wachen gruen meldeten.
#
# DER FEHLER WAR NICHT DIE ZAHL, SONDERN DER GELTUNGSBEREICH: eine Wache, die
# eine Ablage nicht kennt, meldet dort ewig gruen — und ausgerechnet
# `mixpibox.md` haengt regelmaessig hinterher, weil es als einziges Handbuch
# nicht im Entwicklerpfad liegt. Wer die naechste zaehlende Behauptung
# irgendwo hinschreibt, traegt sie HIER ein und nicht in eine dritte Datei.
echo "== 3b. Zahlen, die dokumentation/mixpibox.md nennt =="
# GEZAEHLT WIRD WIE IM BLOCK: `src/<teil>/src` mit `*.spec.ts`/`*.test.ts` —
# dieselbe Erhebung wie bei „backend-api Testdateien" oben, damit die beiden
# Abschnitte nicht auseinanderlaufen koennen.
for teil in backend-api:142 frontend-box:1 frontend-admin:27 backend-player:15; do
  n=$(find "$WURZEL/src/${teil%%:*}/src" -name '*.spec.ts' -o -name '*.test.ts' 2>/dev/null | wc -l)
  zahl "mixpibox.md §7.3  src/${teil%%:*} Testdateien" "${teil##*:}" "$n" 20
done
# NICHT `grep -c 'test('`: die Datei ruft in ihren Faellen selbst Hilfsnamen
# auf, die auf `test` enden. Gezaehlt wird der Fall am Zeilenanfang.
n=$(grep -cE "^[[:space:]]*(test|it)\(" "$WURZEL/tools/e2e/neu-oberflaeche.test.mjs" 2>/dev/null)
zahl "mixpibox.md §7.3  NewDesign Verhaltenstests" "33" "$n" 20
# `find … -type f` waere hier falsch: unter `tests/` liegt ein `__pycache__`
# und ein paar Helfer ohne `_test`-Endung. Der Block nennt die Testdateien.
n=$(find "$WURZEL/remote-step-installer/tests" -maxdepth 1 -name '*_test.py' 2>/dev/null | wc -l)
zahl "mixpibox.md §7.3  remote-step-installer Testdateien" "27" "$n" 20

# ══ DIE KOPFLEISTE, UND WARUM SIE HIER STEHT ════════════════════════════════
#
# §4 rechnete „21 Seiten − 17 Leisteneintraege = vier, die niemand im Menue
# findet". Gemessen sind es 18: die Uebersicht steht als einzige AUSSERHALB der
# `<section class="gruppe">`-Bloecke, und wer die Gruppen zaehlt, uebersieht
# sie. Die Differenz ging auf, die Aussage war falsch — die Startseite wurde
# als unauffindbar gefuehrt. Eine Rechnung, deren Ergebnis passt, belegt nicht,
# dass ihre Summanden stimmen; genau deshalb braucht JEDE der beiden Zahlen
# hier ihre eigene Zeile. Toleranz 0, ein Eintrag mehr ist hier ein Ereignis.
n=$(grep -cE "<a routerLink=" "$WURZEL/src/frontend-admin/src/app/rahmen.ts" 2>/dev/null)
zahl "mixpibox.md §4   Eintraege der Kopfleiste (rahmen.ts)" "24" "$n" 0

echo
echo "== 4. Wiki-Eintraege, die die README beim Namen nennt =="
# DER EINTRAG `plugin-system` STAND HIER NIE — und die README nannte ihn
# trotzdem, vom 03.08. bis zum 23.09.2026. Es gibt ihn im Paket nicht (1104
# Eintraege, keiner heisst so). Gefunden erst, als diese Liste fuer die neue
# README nachgezogen wurde: ein Verweis, den niemand prueft, ist eine
# Behauptung ohne Beleg wie jede andere. Wer einen Eintrag in der README
# nennt, traegt ihn HIER ein.
# `mixpi-die-geschichte`, `mixpi-maskottchen-familie` und
# `benennung-mixpibox-drei-toepfe` standen hier bis zum 23.09.2026 — der
# Abschnitt „Woher der Name kommt" ist auf Wunsch des Betreibers aus der README
# gefallen („die geschichte der wesen muss nicht drin sein"). Die Eintraege
# bleiben im Paket; nur die README nennt sie nicht mehr.
for id in pruefen-sh-haengt-auf-auth-integration \
          mupi-wlan-selbstdiagnose-per-karte \
          sicherung-rueckweg-ueber-die-karte \
          mupi-startzeiten-gemessen mupi-boot-32s-auf-13s \
          grundmessung-zeit-bis-zum-bild; do
  if grep -q "id: $id\$" "$WIKI" 2>/dev/null; then ok "wiki: $id"; else weg "wiki: $id"; fi
done

echo
echo "== 5. BACKLOG-Verweise =="
for m in 'Fork-Status' 'E18' 'E24' 'E47' 'E118'; do
  if grep -q "$m" "$WURZEL/BACKLOG.md" 2>/dev/null; then ok "BACKLOG: $m"; else weg "BACKLOG: $m"; fi
done
if grep -qE '^#+ *7\.' "$WURZEL/dokumentation/mixpibox.md" 2>/dev/null; then
  ok "dokumentation/mixpibox.md Abschnitt 7"
else weg "dokumentation/mixpibox.md Abschnitt 7"; fi

echo
echo "== 6. Befehle, die die README zum Nachmachen anbietet =="
for f in --schnell --box; do
  if grep -q -- "$f" "$WURZEL/tools/pruefen.sh" 2>/dev/null; then ok "pruefen.sh kennt $f"
  else weg "pruefen.sh kennt $f"; fi
done
# `serve:frontend-box` IST HIER RAUS (23.09.2026) — UND ZWAR NICHT, WEIL DAS
# SKRIPT FEHLT, SONDERN WEIL ES LAEUFT UND SCHEITERT. In package.json steht es
# noch; es ruft `npm run serve --workspace=mupibox-frontend-box`, und diesen
# Arbeitsbereich gibt es seit E118/1e nicht mehr (src/frontend-box hat kein
# package.json, siehe dessen LIESMICH.md). Gemessen am 23.09.2026:
#     $ npm run serve:frontend-box
#     npm error No workspaces found: --workspace=mupibox-frontend-box   (exit 1)
# Die alte Pruefung sah nur den NAMEN in package.json und meldete gruen —
# dieselbe Klasse wie [[readme-befehl-der-nichts-startet]], nur andersherum:
# dort tat der Befehl nichts, hier faellt er um, und beide Male stand er in
# der README. Geprueft wird deshalb ab jetzt AUCH, dass die README ihn nicht
# mehr anbietet; wer den Arbeitsbereich zurueckholt, nimmt beides zurueck.
for s in serve:backend-api serve:frontend-admin serve:backend-player; do
  if grep -q "\"$s\"" "$WURZEL/package.json" 2>/dev/null; then ok "npm run $s"
  else weg "npm run $s"; fi
done
if grep -q 'serve:frontend-box' "$WURZEL/README.md"; then
  weg "README bietet 'serve:frontend-box' wieder an (Arbeitsbereich ist weg)"
else ok "README bietet den toten 'serve:frontend-box' nicht an"; fi

# DIE BEFEHLE DES NEUEN ABSCHNITTS 4 (Installation von Grund auf).
for c in './sdstart' './sdgui' './sdtui' './setup-controller.sh' './tui' './stepctl'; do
  f="$WURZEL/remote-step-installer/${c#./}"
  if [ -x "$f" ]; then ok "ausfuehrbar: remote-step-installer/${c#./}"
  else weg "ausfuehrbar: remote-step-installer/${c#./}"; fi
done
# Die Karte faehrt die Installation nur dann selbst, wenn sdstart das Paket
# mitgibt. Steht das `lauf_paket=True` nicht mehr da, ist Abschnitt 4.5 falsch.
if grep -q 'lauf_paket=True' "$WURZEL/remote-step-installer/controller/sdstart.py" 2>/dev/null; then
  ok "sdstart backt das Installationspaket mit (Selbstlauf)"
else weg "sdstart backt das Installationspaket mit (Selbstlauf)"; fi
# Abschnitt 4.2 behauptet, der Installer FINDE den Fork selbst — vier Quellen in
# einer Reihenfolge. Faellt das weg, steht in der README wieder eine Huerde, die
# es nicht mehr gibt (oder schlimmer: eine, die es wieder gibt).
# DER FINDER IST AM 23.09.2026 NACH core.py GEZOGEN — dorthin, wo `repo_root()`
# steht, und weil seither auch `expand_path()` ihn braucht (der ferngesteuerte
# Lauf loest `${MUPI_REPO:-…}` darueber auf). Geprueft wird BEIDES: dass es ihn
# gibt, und dass `sdprep` ihn weiterreicht — die Kartenwerkzeuge rufen ihn dort.
if grep -q 'def fork_wurzel' "$WURZEL/remote-step-installer/controller/core.py" 2>/dev/null; then
  ok "Installer findet den Fork selbst (core.fork_wurzel)"
else weg "Installer findet den Fork selbst (core.fork_wurzel)"; fi
if grep -q 'from core import FORK_MERKMALE, fork_wurzel, ist_fork' "$WURZEL/remote-step-installer/controller/sdprep.py" 2>/dev/null; then
  ok "sdprep reicht den Finder weiter"
else weg "sdprep reicht den Finder weiter"; fi
# Und der ferngesteuerte Lauf fragt denselben Finder — sonst stimmt Abschnitt 4.2
# nur fuer die Karte und nicht fuer den Controller.
if grep -q 'var == "MUPI_REPO"' "$WURZEL/remote-step-installer/controller/core.py" 2>/dev/null; then
  ok "auch der ferngesteuerte Lauf fragt den Finder (expand_path)"
else weg "auch der ferngesteuerte Lauf fragt den Finder (expand_path)"; fi
if grep -qF "'--fork' in argv" "$WURZEL/remote-step-installer/controller/sdstart.py" 2>/dev/null; then
  ok "sdstart nimmt --fork"
else weg "sdstart nimmt --fork"; fi
# Abschnitt 7 nennt die Veroeffentlichungs-Werkzeuge beim Namen.
for p in tools/github-veroeffentlichen.py tools/github-ausschluss.txt; do
  if [ -e "$WURZEL/$p" ]; then ok "$p"; else weg "$p"; fi
done

# Der Windows-Zweig, den Abschnitt 4.6 behauptet.
if grep -q 'def windows_schreiben' "$WURZEL/remote-step-installer/controller/geraete.py" 2>/dev/null; then
  ok "Windows-Schreibweg vorhanden (geraete.windows_schreiben)"
else weg "Windows-Schreibweg vorhanden (geraete.windows_schreiben)"; fi

echo
echo "== 7. Konfigurationsschluessel und Zustaende =="
# `oberflaeche` WURDE HIER VERLANGT UND FEHLTE — ZU RECHT FEHLTE ES. Der
# Umschalter ist mit E118/1d gefallen (05.09.2026), die Vorlage hat den
# Schluessel seither nicht mehr, und die README behauptet ihn auch nicht mehr.
# Gemeldet wurde also eine Luecke im PRUEFER, nicht in der README — dieselbe
# Sorte wie `AdminInterface` weiter oben, und wieder war es der einzige rote
# Punkt des Laufs.
# EINE SCHLEIFE UEBER EIN EINZIGES WORT ist keine Schleife — shellcheck sagt
# das zu Recht (SC2041), und die Commit-Ratsche blockt es. Geblieben ist der
# eine Schluessel, also steht er da, wo er hingehoert: in der Zeile.
if grep -rq 'host' "$WURZEL/config/templates/mupiboxconfig.json" 2>/dev/null; then
  ok "mupibox.host in der Vorlage"; else weg "mupibox.host in der Vorlage"; fi
if grep -rq 'oberflaeche' "$WURZEL/config/templates/mupiboxconfig.json" 2>/dev/null; then
  weg "mupibox.oberflaeche ist in der Vorlage zurueck — README Abschnitt 3 pruefen"
else ok "mupibox.oberflaeche ist weg (E118/1d), wie die README sagt"; fi
for z in hoert spielt schlaeft sucht passwort; do
  if grep -q "\"$z\"" "$WURZEL/NewDesign/maskottchen.json" 2>/dev/null; then ok "Maskottchen-Zustand $z"
  else weg "Maskottchen-Zustand $z"; fi
done

echo
echo "== 8. Die zwei Befunde vom 03.08.2026 — duerfen nicht zurueckkommen =="
# BEFUND 1: `node tools/verwaltung-vorschau.mjs` startet NICHTS. Die Datei ist
# eine Angular-Proxy-Konfiguration (default export = Array); node fuehrt sie
# aus, definiert das Array und endet still mit 0. Wer der alten README folgte,
# sah keine Ausgabe, keine Adresse — und hielt das Projekt fuer kaputt.
if grep -qE '^\s*node tools/verwaltung-vorschau\.mjs\s*($|#)' "$WURZEL/README.md"; then
  weg "README bietet 'node tools/verwaltung-vorschau.mjs' wieder als Befehl an"
else ok "verwaltung-vorschau.mjs nicht als Server angepriesen"; fi
# DER WEG ZUR VERWALTUNGS-VORSCHAU IST SEIT DEM 23.09.2026 EIN ANDERER: statt
# `ng serve --proxy-config` (zwei Fenster, Angular-Entwicklungsserver) nennt die
# README `tools/admin-vorschau.mjs` — den Stub, der die GEBAUTE Verwaltung
# ausliefert. Geprueft wird jetzt der Weg, der dort steht.
if grep -q 'node tools/admin-vorschau.mjs' "$WURZEL/README.md"; then
  ok "README nennt den Weg zur Verwaltungs-Vorschau (admin-vorschau.mjs)"
else weg "README nennt den Weg zur Verwaltungs-Vorschau (admin-vorschau.mjs)"; fi
if grep -q 'npm run build:frontend-admin' "$WURZEL/README.md"; then
  ok "und sagt dazu, dass vorher gebaut werden muss"
else weg "und sagt dazu, dass vorher gebaut werden muss"; fi

# BEFUND 2, NACHGEZOGEN AM 23.09.2026: Die Spalte "Wo" des Umschalters zeigte
# damals auf src/backend-api/src/oberflaeche.ts — dort steht aber nur das
# Neulade-Signal. Der Umschalter selbst ist seit E118/1d GANZ WEG; die README
# sagt das jetzt und behauptet stattdessen, der Kiosk lade FEST `/neu/`.
# Genau das wird hier geprueft — eine Wache, die den alten Zustand belegt,
# belegt eine Aussage, die in der README nicht mehr steht.
# `-F` IST HIER NICHT KOSMETIK: das Muster enthaelt `${...}`, und das ist je
# nach grep etwas anderes. GNU-grep nimmt die Klammern woertlich, ugrep (das
# in manchen Sitzungen als `grep` liegt) nicht — dieselbe Zeile meldete dann
# gruen im Skript und rot von Hand. Eine Wache, deren Urteil davon abhaengt,
# WER sie ruft, ist keine. Feste Zeichenkette, fertig.
if grep -qF 'MUPI_URL="${MUPI_URL}/neu/"' "$WURZEL/scripts/chromium-autostart.sh" 2>/dev/null; then
  ok "Kiosk laedt fest /neu/ (chromium-autostart.sh)"
else weg "Kiosk laedt fest /neu/ (chromium-autostart.sh)"; fi
# Und die geloeschte Oberflaeche bleibt geloescht: uebrig sind LIESMICH.md und
# das Nachzuegler-Modul. Kaeme ein package.json zurueck, waere sie wieder ein
# Arbeitsbereich — dann stimmen Abschnitt 3 und 6 der README nicht mehr.
if [ -e "$WURZEL/src/frontend-box/package.json" ]; then
  weg "src/frontend-box ist wieder ein Arbeitsbereich — README Abschnitt 3 pruefen"
else ok "src/frontend-box ist nur noch Nachzuegler (kein package.json)"; fi

echo
# ══ `exit 0` STAND HIER — BEDINGUNGSLOS (gefunden 23.08.2026) ════════════════
#
# Das ist der aeltere und der schlimmere der beiden Befunde dieses Tages. Die
# Datei zaehlte in `FEHLER` sauber mit, druckte am Ende „N Behauptung(en) ohne
# Beleg" — und endete danach mit 0. Sie hat damit seit ihrem ersten Tag
# GRUEN GEMELDET, egal was sie fand. Aufgefallen ist es erst bei der
# Gegenprobe: die alte Zahl 71 wieder eingesetzt, die neue Wache meldete
# „516 % daneben" — und der Rueckgabestand blieb 0.
#
# WORAN ES HAENGT: der Doku-Lauf ruft diese Datei mit `if ! bash …` auf
# (tools/doku-luecken-probe.sh, letzte Pruefung). Ein Werkzeug, das nie
# scheitert, macht aus jedem solchen Aufrufer eine Attrappe — der Aufrufer
# sieht aus, als pruefe er, und prueft nichts. Dieselbe Klasse wie die Zahlen
# darueber, nur eine Ebene tiefer: gedruckt statt geurteilt.
#
# WER HIER WIEDER `exit 0` HINSCHREIBT, nehme auch den Aufruf im Doku-Lauf
# heraus — sonst steht dort eine Zeile, die nichts tut.
if [ "$FEHLER" -eq 0 ]; then
  echo "ALLES BELEGT."
  exit 0
fi
echo "$FEHLER Behauptung(en) ohne Beleg."
exit 1
