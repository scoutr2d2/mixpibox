#!/usr/bin/env bash
# ABLAGE-DOKU-DECKUNG — welche Datei auf der Box den Zustand traegt, ohne dass
# ein Handbuch sie kennt.
#
# WARUM ES DAS GIBT (23.08.2026): tools/doku-luecken-probe.sh prueft inzwischen
# Plugins, Rechte, Ereignisse, Konfigurationsfelder, Menuepunkte, Seiten, die
# 195 REST-Endpunkte und die 20 systemd-Dienste — und meldete an diesem Tag
# gruen. Was in KEINER dieser Pruefungen vorkam, ist die ABLAGE: die rund
# dreissig Dateien unter `server/config`, in denen der gesamte Bestand der Box
# liegt. Gemessen waren 27 von 34 Aufnahmen in KEINEM der beiden Handbuecher —
# darunter `data.json` (die Bibliothek), `profile.json` (das Verzeichnis der
# Kinder) und `resume.json` (die gemerkten Stellen). Das Wiki kannte sie
# laengst (102, 17 bzw. 113 Treffer): derselbe Fall wie schon dreimal zuvor,
# llmwiki `volles-wiki-ist-kein-beleg-fuer-gepflegte-doku`.
#
# WORAUS DIE LISTE KOMMT, und warum nicht aus `ls server/config`: dieses
# Verzeichnis gibt es im Repo gar nicht — es entsteht erst auf der Box. Ein
# `grep '\.json'` ueber den Quelltext faengt dagegen Testbeispiele mit ein
# (`ip.json` und `neuartige-ablage.json` stehen ausschliesslich in `*.spec.ts`
# und sind keine Ablage). Die MASSGEBLICHE Liste ist `HINEIN` in
# `scripts/mupibox/mupibox-sicherung.py`: sie ist von Hand gefuehrt, jede Zeile
# begruendet, und sie ist die einzige Stelle, die entscheidet, was einen
# Kartenschaden ueberlebt. Was dort steht, ist Bestand — und was Bestand ist,
# gehoert ins Handbuch.
#
# GEPRUEFT WIRD NUR DAS ARCHITEKTURHANDBUCH, nicht das Benutzerhandbuch. Ein
# Betreiber, der die Box bedient, muss `offline_resume.json` nicht kennen; eine
# Probe, die den Namen dort einfordert, meldet auf Dauer rot und wird zu Recht
# ignoriert. Dieselbe Falle wie `RECHTE` im Benutzerhandbuch, nur eine Ebene
# tiefer.
#
# Aufruf aus dem Wurzelverzeichnis:  bash tools/ablage-doku-deckung.sh
# Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.

set -u
cd "$(dirname "$0")/.." || exit 2

QUELLE=scripts/mupibox/mupibox-sicherung.py
DOKU=dokumentation/mixpibox.md

if [ ! -f "$QUELLE" ]; then
  echo "  WARNUNG: $QUELLE nicht gefunden — ist die Sicherung umgezogen?"
  exit 1
fi

# Die Aufnahmeliste steht zwischen `HINEIN = {` und der Zeile mit der
# schliessenden Klammer am Zeilenanfang.
#
# KOMMENTARE ZUERST WEG, und das ist keine Kosmetik: in den Begruendungen
# stehen Saetze in Anfuehrungszeichen („nicht eingeordnet"), und eine Extraktion
# ueber alle `"..."` haelt einen halben Absatz fuer einen Dateinamen. Die erste
# Fassung meldete auf diese Weise 40 Eintraege, von denen sechs Fliesstext
# waren.
#
# DIE ZWEI BAUMNAMEN FALLEN HERAUS (`etc/mupibox`, `server/config`): sie sind
# die Schluessel der Tabelle, keine Ablage.
namen=$(awk '/^HINEIN = \{/{drin=1; next} drin && /^\}/{exit} drin' "$QUELLE" |
  sed 's/#.*$//' |
  grep -oE '"[^"]+"' | tr -d '"' |
  grep -vxE 'etc/mupibox|server/config')

if [ -z "$namen" ]; then
  echo "  WARNUNG: 'HINEIN' nicht gefunden oder leer — hat sich $QUELLE geaendert?"
  exit 1
fi

# GESUCHT WIRD DER BLOSSE NAME, nicht das fnmatch-Muster. Kein Handbuch der
# Welt schreibt `profile/*/resume.json` — es schreibt `resume.json` und sagt
# daneben, dass die Datei je Kind liegt. Eine Probe auf das Muster meldete rot,
# obwohl die Sache dasteht. Aus `profile/*/verlauf.json` wird darum
# `verlauf.json`, aus `gespielt.*.json` ebenfalls `gespielt.json`, aus
# `plugin-daten/*` wird `plugin-daten`.
#
# DASS ZWEI MUSTER AUF DENSELBEN NAMEN FALLEN, ist gewollt: `gespielt.*.json`
# (alte flache Form) und `profile/*/gespielt.json` (heutige Form je Kind) sind
# dieselbe Ablage in zwei Formen. Ein Handbuch, das `gespielt.json` erklaert,
# hat beide erklaert — deshalb wird die Liste danach eindeutig gemacht.
gesucht=$(for n in $namen; do
  letztes=${n##*/}                 # profile/*/verlauf.json -> verlauf.json
  letztes=${letztes/.\*./.}        # gespielt.*.json        -> gespielt.json
  [ "$letztes" = '*' ] && letztes=${n%%/*}   # plugin-daten/*  -> plugin-daten
  echo "$letztes"
done | sort -u)

luecken=0
for g in $gesucht; do
  if ! grep -qF "$g" "$DOKU"; then
    echo "  FEHLT in $DOKU: $g"
    luecken=$((luecken + 1))
  fi
done

if [ "$luecken" -eq 0 ]; then
  echo "  Keine Luecke: alle $(echo "$gesucht" | wc -l) Ablagen stehen in $DOKU."
  exit 0
fi
echo "  $luecken Ablage(n) ohne Doku."
exit 1
