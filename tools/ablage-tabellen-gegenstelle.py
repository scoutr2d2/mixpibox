#!/usr/bin/env python3
"""ABLAGE-TABELLEN-GEGENSTELLE — eine Ablage, die an ZWEI Orten liegt, und eine
Tabellenzeile, die den anderen nicht nennt.

WARUM ES DAS GIBT: Abschnitt „Wo der Bestand liegt" in
`dokumentation/mixpibox.md` fuehrt zwei Tabellen — **Box-weit**
(`server/config/`) und **Je Kind** (`server/config/profile/<kennung>/`). Eine
Tabelle wird GESCANNT, nicht gelesen: wer einen Dateinamen in der einen findet,
hoert dort auf zu suchen. Steht dieselbe Datei auch in der anderen, ist die
Zeile still unvollstaendig — und zwar in die teure Richtung, weil sie richtig
aussieht.

DAS MUSTER HAT ZWEIMAL GETROFFEN:
  23./24.08.2026 (Commit b104094d) `listen.json` stand in beiden Tabellen,
    obwohl es seit E18/S3 NUR noch je Kind liegt. Die box-weite Zeile war ein
    Ueberbleibsel des Umzugs — falscher Ort, gar keine Gegenstelle.
  24.08.2026 `darstellung.json` stand in beiden Tabellen zu RECHT (sie ist die
    einzige Ablage, die beim Start nicht umzieht, `OHNE_UMZUG`) — und keine
    der beiden Zeilen erwaehnte die andere. Wer die box-weite Datei fuer einen
    Rest hielt, haette allen Kindern die Farbsaetze genommen.

Beide Faelle sehen fuer eine zaehlende Wache gleich aus: der Name steht da,
`ablage-doku-deckung.sh` meldet gruen. Die Frage ist nicht „steht der Name da?",
sondern „weiss diese Zeile, dass es die andere gibt?".

WARUM NICHT AUS DEM CODE ABGELEITET: die massgebliche Liste der Je-Kind-Ablagen
ist `BEREICH_ABLAGEN` in `src/backend-api/src/profile.ts` — aber die box-weite
Tabelle hat keine Entsprechung im Baum (`server/config` entsteht erst auf der
Box). Geprueft wird deshalb die DOKU gegen sich selbst; das ist genau die
Konsistenz, die hier schiefging.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/ablage-tabellen-gegenstelle.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

DOKU = Path("dokumentation/mixpibox.md")

# Die Ueberschriften, an denen die beiden Tabellen haengen. Fett gesetzt, mit
# dem Pfad in Klammern dahinter — auf den PFAD zu greppen waere bruechiger, er
# steht auch im Fliesstext.
KOPF_BOX = re.compile(r"^\*\*Box-weit\*\*")
KOPF_KIND = re.compile(r"^\*\*Je Kind\*\*")

# Ein Dateiname in Backticks. Eine Zeile darf mehrere nennen
# (`network.json`, `wlan.json`) — dann gilt jeder als dort abgelegt.
NAME = re.compile(r"`([A-Za-z0-9_.-]+\.(?:json|jsonl|yaml|yml|db))`")

# Woran man erkennt, dass eine Zeile ihre Gegenstelle kennt. Absichtlich weit
# gefasst: die Wache soll erzwingen, dass der Leser WEITERGESCHICKT wird, nicht
# eine bestimmte Formulierung.
HINWEIS_AUF_KIND = re.compile(r"je Kind|dieses Kindes|siehe unten|pro Profil|je Profil", re.I)
HINWEIS_AUF_BOX = re.compile(r"box-weit|siehe oben|boxweit|fuer alle Kinder|für alle Kinder", re.I)


def tabelle_ab(zeilen: list[str], start: int) -> list[tuple[int, str]]:
    """Die Tabellenzeilen, die auf eine Ueberschrift folgen — mit Zeilennummer.

    Gesammelt wird ab der Ueberschrift bis zur ersten Zeile, die nach dem
    Tabellenbeginn keine Tabellenzeile mehr ist. Kopf- und Trennzeile fallen
    raus (die Trennzeile ueber `---`, der Kopf, weil er keinen Dateinamen in
    Backticks traegt).
    """
    treffer: list[tuple[int, str]] = []
    begonnen = False

    for i in range(start + 1, len(zeilen)):
        zeile = zeilen[i].rstrip("\n")
        ist_tabelle = zeile.startswith("|")
        if ist_tabelle:
            begonnen = True
            if set(zeile) <= set("| -:"):
                continue
            treffer.append((i + 1, zeile))
        elif begonnen and zeile.strip() == "":
            # Eine Leerzeile beendet die Tabelle. Text zwischen Ueberschrift
            # und Tabelle (die Vorbemerkung ueber `BEREICH_ABLAGEN`) darf
            # dagegen stehen bleiben.
            break
    return treffer


def main() -> int:
    if not DOKU.exists():
        print(f"  {DOKU} nicht gefunden — aus dem Wurzelverzeichnis aufrufen", file=sys.stderr)
        return 2

    zeilen = DOKU.read_text(encoding="utf-8").splitlines(keepends=True)

    start_box = next((i for i, z in enumerate(zeilen) if KOPF_BOX.match(z)), None)
    start_kind = next((i for i, z in enumerate(zeilen) if KOPF_KIND.match(z)), None)
    if start_box is None or start_kind is None:
        # Verschwindet eine Ueberschrift beim Umbauen, meldet diese Wache
        # sonst ewig gruen — dieselbe Falle wie eine Liste aus der falschen
        # Quelle.
        print("  UEBERSCHRIFT WEG: 'Box-weit' oder 'Je Kind' steht nicht mehr in mixpibox.md")
        return 1

    def abgelegt(start: int) -> dict[str, tuple[int, str]]:
        """Was in dieser Tabelle LIEGT — gelesen aus der ersten Spalte.

        NUR die Spalte „Datei", nicht die ganze Zeile: im Beschreibungstext
        stehen Dateinamen als ABGRENZUNG oder GEGENBEISPIEL, und die erste
        Fassung dieser Wache hielt sie fuer Ablagen. `kinderzeit.json` sagt
        box-weit „**Nicht** die Zeitkonten: die liegen je Kind in
        `kinderzeit-verbrauch.json`" — daraus wurde ein Phantom-Eintrag der
        box-weiten Tabelle. Und die Je-Kind-Zeile von `listen.json` nennt
        `resume.json` als Gegenbeispiel; sie ueberschrieb dessen echte Zeile
        und deckte damit eine ECHTE Luecke zu. Ein Name im Fliesstext ist ein
        Verweis, kein Ort.
        """
        gefunden: dict[str, tuple[int, str]] = {}
        for nr, zeile in tabelle_ab(zeilen, start):
            spalten = zeile.split("|")
            erste = spalten[1] if len(spalten) > 1 else ""
            for name in NAME.findall(erste):
                gefunden[name] = (nr, zeile)
        return gefunden

    box = abgelegt(start_box)
    kind = abgelegt(start_kind)

    luecken = 0
    for name in sorted(set(box) & set(kind)):
        nr_box, zeile_box = box[name]
        nr_kind, zeile_kind = kind[name]
        if not HINWEIS_AUF_KIND.search(zeile_box):
            print(f"  OHNE GEGENSTELLE: `{name}` steht box-weit (Zeile {nr_box}) "
                  f"UND je Kind (Zeile {nr_kind}) — die box-weite Zeile sagt es nicht")
            luecken += 1
        if not HINWEIS_AUF_BOX.search(zeile_kind):
            print(f"  OHNE GEGENSTELLE: `{name}` steht je Kind (Zeile {nr_kind}) "
                  f"UND box-weit (Zeile {nr_box}) — die Je-Kind-Zeile sagt es nicht")
            luecken += 1

    return 1 if luecken else 0


if __name__ == "__main__":
    sys.exit(main())
