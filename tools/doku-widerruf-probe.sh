#!/usr/bin/env bash
# DOKU-WIDERRUF-PROBE — Saetze, die einmal richtig waren und es nicht mehr sind.
#
# WARUM ES DAS GIBT: doku-luecken-probe.sh vergleicht AUFZAEHLUNGEN gegen ihre
# Quelle im Code (Plugins, RECHTE, EREIGNISSE, FELDER). Sie findet, was FEHLT.
# Sie findet nicht, was DASTEHT und falsch ist — dafuer gibt es keine Liste im
# Code, gegen die sich zaehlen liesse.
#
# DER FALL, DER SIE AUSGELOEST HAT (22.08.2026): die Aussage „ein
# medienquelle-Plugin kann keine Kachel in die Medienliste legen" stand an DREI
# Stellen (plugins/README.md, BACKLOG.md, dokumentation/mixpibox.md). E87/E88
# haben sie um 18:58 widerlegt. Der Doku-Lauf um 19:11 korrigierte ZWEI davon
# und nannte sie im Commit namentlich — die dritte stand noch vier Stunden
# spaeter unveraendert da und sagte einem Leser, der Weg sei gesperrt.
#
# DIE LEHRE, DIE HIER FEST WIRD: wer eine falsche Aussage korrigiert, muss nach
# dem SATZ suchen, nicht nach dem THEMA. Das Thema war in allen drei Dateien
# praesent; deshalb sah jede Datei „behandelt" aus.
#
# WIE SIE ARBEITET: fuer jede widerrufene Aussage steht unten ein Muster. Ein
# Treffer gilt als markiert, wenn EINE von zwei Formen greift:
#
#   INLINE   in der Trefferzeile selbst oder den FENSTER Zeilen davor steht ein
#            Wort, das ihn als historisch kennzeichnet — „ueberholt",
#            „NACHTRAG", „Stand vor", „Bis dahin", „galt bis", „VOR E".
#            So korrigiert: plugins/README.md („Bis dahin hatte das Plugin …").
#
#   ABSCHNITT irgendwo zwischen Treffer und dem naechsten `#`-Titel steht ein
#            BLOCKWIDERRUF — „Alles oberhalb dieses Absatzes beschreibt den
#            Stand VOR E87". So korrigiert: BACKLOG.md, wo der Nachtrag den
#            ganzen Abschnitt ueber sich zurueckzieht, statt jeden Satz
#            einzeln anzufassen.
#
# BEIDE FORMEN SIND RICHTIG, und die Probe muss beide kennen: bei ihrem ersten
# Lauf kannte sie nur INLINE und meldete die zwei Saetze im BACKLOG, die
# ordentlich zurueckgezogen waren. Ein Pruefer, der sauber gefuehrte
# Historie als Fehler meldet, wird zu Recht ignoriert.
#
# BEWUSST UEBER ZEILENNAEHE STATT UEBER EINE AUSNAHMELISTE mit Dateinamen und
# Zeilennummern: Zeilennummern wandern beim naechsten Absatz, und eine Wache,
# die nach jeder Textaenderung von Hand nachgezogen werden muss, wird nicht
# nachgezogen.
#
# Aufruf aus dem Wurzelverzeichnis:  bash tools/doku-widerruf-probe.sh
# Rueckgabe: 0 = kein unmarkierter Widerruf, 1 = mindestens einer.

set -u
cd "$(dirname "$0")/.." || exit 2

# Wo gesucht wird. Das Wiki ist ABSICHTLICH dabei: ein Eintrag altert dort
# genauso, und pack.yaml ist die Datei, die kuenftige Sitzungen zuerst lesen.
DATEIEN=(
  plugins/README.md
  dokumentation/mixpibox.md
  dokumentation/benutzerhandbuch.html
  BACKLOG.md
  llmwiki/pack.yaml
  README.md
)

# benutzerhandbuch.html KAM ERST AM 22.08.2026 DAZU, und das ist derselbe
# Fehler noch einmal, den diese Probe ueberhaupt erst ausgeloest hat: die
# Korrektur war unvollstaendig. Als sie entstand, fuehrte sie FUENF Dateien und
# fasste das dritte Handbuch nicht an — genauso wie der Doku-Lauf um 19:11 zwei
# von drei Stellen anfasste. Drei Commit-Nachrichten in Folge schrieben "beide
# Handbuecher" und meinten plugins/README.md und mixpibox.md; das Handbuch, das
# ein Betreiber tatsaechlich liest, stand in keiner einzigen Probe.
# Wer hier eine Datei ergaenzt, zaehle vorher `ls dokumentation/`.

# Wie viele Zeilen VOR dem Treffer nach der Markierung abgesucht werden.
# Sechs, weil ein Blockzitat in diesen Handbuechern ueblich vier bis fuenf
# Zeilen Vorlauf hat, ehe die Aussage faellt.
FENSTER=6

MARKER='überholt|ueberholt|NACHTRAG|Nachtrag|Stand vor|Bis dahin|Bis hierher|galt bis|VOR E8|vor E8|nicht mehr|gefallen|widerlegt|widerruf|Widerruf'

# Der BLOCKWIDERRUF zieht alles ueber sich bis zum vorigen `#`-Titel zurueck.
# ABSICHTLICH ENG GEFASST und nicht mit $MARKER identisch: „Nachtrag" allein
# darf keinen Abschnitt entlasten, sonst entschuldigt jede spaetere Ergaenzung
# rueckwirkend jeden falschen Satz darueber. Es braucht den ausdruecklichen
# Satz, dass das Obige historisch ist.
BLOCKWIDERRUF='Alles oberhalb|Alles darüber|Alles daruber|Alles vor diesem|beschreibt den Stand VOR|beschreibt den Stand vor'

# ── DIE WIDERRUFENEN AUSSAGEN stehen unten als `pruefe`-Aufrufe ───────────
# Je Aufruf drei Argumente: Muster (grep -E), seit wann falsch, heutiger Stand.
#
# EIN AUFRUF HIER IST EINE SCHULD, KEINE VERZIERUNG. Wer eine Aussage
# widerruft, traegt sie ein; wer sie ueberall korrigiert hat, laesst sie
# trotzdem stehen — die Probe schuetzt dann davor, dass jemand sie WIEDER
# hinschreibt, etwa beim Zurueckholen eines alten Absatzes aus einem toten
# Zweig (siehe stillgelegtes-repo-lebt-im-fetch-cache-weiter).

luecken=0

pruefe() {
  local muster="$1" seit="$2" heute="$3"
  local gemeldet=0
  for datei in "${DATEIEN[@]}"; do
    [ -f "$datei" ] || continue
    while IFS=: read -r nr _rest; do
      [ -z "$nr" ] && continue
      local ab=$((nr - FENSTER))
      [ "$ab" -lt 1 ] && ab=1
      # Das Fenster schliesst die Trefferzeile SELBST ein: „Bis dahin hatte das
      # Plugin bewusst keinen Aufnehmen-Knopf" markiert sich in einer Zeile.
      local inline=1 block=1
      sed -n "${ab},${nr}p" "$datei" | grep -qE "$MARKER" && inline=0
      # Abschnittsende = naechste Zeile ab dem Treffer, die mit `#` beginnt.
      # Findet sich keine, gilt der Rest der Datei.
      local ende
      ende=$(awk -v ab="$((nr + 1))" 'NR>=ab && /^#/ {print NR; exit}' "$datei")
      [ -z "$ende" ] && ende=$(wc -l <"$datei")
      sed -n "${nr},${ende}p" "$datei" | grep -qE "$BLOCKWIDERRUF" && block=0
      if [ "$inline" -ne 0 ] && [ "$block" -ne 0 ]; then
        if [ "$gemeldet" -eq 0 ]; then
          echo "  WIDERRUFEN seit $seit — heutiger Stand: $heute"
          gemeldet=1
        fi
        echo "    unmarkiert: $datei:$nr"
        luecken=$((luecken + 1))
      fi
    done < <(grep -nE "$muster" "$datei" 2>/dev/null | cut -d: -f1 | sed 's/$/:/')
  done
}

echo "── Aussagen, die widerrufen sind und trotzdem unmarkiert dastehen ──"

pruefe \
  "kann heute \*\*keine Kachel in die Medienliste|keine Kachel in die Medienliste legen|es gibt keinen Empfänger|keinen allgemeinen Plugin-Weg in die Medienliste|bewusst keinen Aufnehmen-Knopf" \
  "22.08.2026, E87/E88" \
  "type: \"plugin\" + volle Kennung in id; plugins/README.md „Ein Medien-Plugin kommt generisch in die Medienliste\""

pruefe \
  "wartet auf den Tag, an dem die Medienliste Plugin-Inhalte kennt|Sperre vor der gesamten Anbieterliste|Nächster sinnvoller Schritt ist deshalb nicht das nächste Plugin" \
  "22.08.2026, E87/E88" \
  "der generische Weg ist gebaut und begehbar; BACKLOG E84, Nachtrag"

# 23.08.2026: Der Satz „`--target` luegt" war RICHTIG gemessen (mit der Id) und
# wurde trotzdem zur Ursache — im Code stand danach GAR KEIN `--target`, und
# `pw-record` griff den Lautsprecher-Monitor ab. Eine Doku, die nur sagt, was
# NICHT hilft, wird als „weglassen" gelesen. Deshalb steht der Satz hier: er
# darf nur noch mit der Ergaenzung „mit <object.serial> ist er Pflicht"
# auftauchen.
pruefe \
  '`--target` lügt|--target luegt, PIPEWIRE_NODE|nur `pw-link` trifft|nur pw-link trifft' \
  "23.08.2026, Mitschnitt-Abgriff" \
  "pw-link fuer die Verkabelung UND --target <object.serial> gegen den stillen Rueckfall auf die Standardquelle"

# Derselbe Fall, zweite Haelfte: „die Daten sind heil" galt fuer die
# Stummel-Kacheln und wurde zur Blankoaussage ueber jeden Mitschnitt-Befund.
# Vier Dateien mit gueltigem FLAC-Kopf enthalten digitale Null.
pruefe \
  'Die Daten sind dabei \*\*nicht\*\* kaputt|Die Daten sind dabei heil' \
  "23.08.2026, Mitschnitt-Abgriff" \
  "gilt NUR fuer die drei Stummel-Symptome; ein gueltiger FLAC-Kopf ist kein Beleg fuer Ton"

# 24.08.2026: dieselbe Klasse, eine Stufe schwaecher — der Satz ist WAHR, aber
# zu weit gelesen. „Es fehlt eine Flaeche, die der Kinderschirm erreicht" meint
# eine Flaeche fuer EIGENEN Plugin-Code; gelesen wird „Plugin-Inhalte kommen
# nicht auf den Kinderschirm", und das ist seit E87 falsch. Die Muster hier
# treffen genau die UNVERENGTEN Fassungen — die heutigen Saetze tragen „eigene"
# und den Verweis auf den E87-Weg in derselben Zeile. llmwiki
# `fehlt-noch-verdeckt-den-weg-der-schon-geht`.
pruefe \
  'Was noch fehlt, ist eine Fläche, die der Kinderschirm|fehlt noch \*\*eine Fläche, die der Kinderschirm|Eine Route, die der Kinderschirm erreicht, ist damit|`UiExtension` \(Widgets\) gibt es nicht\. Ereignisse' \
  "24.08.2026, E87/E90 (Nachlese zu E87)" \
  "zu ist nur der Weg fuer EIGENEN Code; Inhalte tragen ueber type: \"plugin\" + /api/werke/<s>/inhalt (Zweig plugin) + spielweg.ts bis auf den Kinderschirm — und die Steckleiste (icon/befinden/aktionen/felder) ist die Flaeche ohne fremdes JS"

# 24.08.2026, zweiter Lauf: DIESELBE KLASSE, ABER DER GEGENSTAND IST EIN
# ENDPUNKT statt einer Flaeche. „Die Regeln der Kinderzeit sind box-weit" war am
# 05.08. gemessen und richtig — drei Tage NACH d66ee6fc, das
# `GET/PUT /api/kinderzeit?profil=<kennung>` gebaut hatte. Die Messung sah die
# VERWALTUNGSSEITE (die den Anhang nicht mitschickt) und schrieb den Befund dem
# SERVER zu. Wer das las, um zu entscheiden, ob er etwas bauen muss, haette den
# Endpunkt nachgebaut. Ebenso „`resume.json`/`listen.json` sind box-weit" —
# beide stehen seit E18/S3 in `BEREICH_ABLAGEN`.
# Merksatz: EIN BEFUND GEHOERT DER SCHICHT, IN DER GEMESSEN WURDE.
# llmwiki `befund-der-oberflaeche-dem-server-zugeschrieben`.
pruefe \
  'ZEITBUDGET ist noch box-weit|die REGELN nicht|Regeln bleiben boxweit|REGELN BLEIBEN BOXWEIT|kinderzeit` \(die Wochentabelle\) kennt.{0,12}kein Profil|teilen sich also dieselben Grenzen' \
  "24.08.2026 (falsch seit 02.08.2026, d66ee6fc)" \
  "der Server kann Regeln je Kind (?profil=, RegelSatz.je, regelnFuer); box-weit ist allein die Kinderzeit-Seite der Verwaltung, die wemAnhang() nicht anhaengt"

pruefe \
  '`resume.json` \(Weiterhören\) ist noch box-weit|resume.json` ist nachweislich weiter box-weit|Eigene Listen sind noch box-weit|`listen.json`, ohne Kennung' \
  "24.08.2026 (erledigt durch E18/S3)" \
  "resume.json und listen.json stehen in BEREICH_ABLAGEN und liegen unter profile/<kennung>/"

echo
if [ "$luecken" -eq 0 ]; then
  echo "KEIN UNMARKIERTER WIDERRUF."
  exit 0
fi
echo "$luecken UNMARKIERTE STELLE(N)."
exit 1
