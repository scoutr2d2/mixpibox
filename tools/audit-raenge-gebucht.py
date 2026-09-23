#!/usr/bin/env python3
"""AUDIT-RAENGE GEGEN DEN BACKLOG — existiert jeder Rang fuer das Projekt?

WOFUER (die Schwester-Wache aus AUDIT-26 §6 Rang 1, gebaut 29.08.2026):
Acht Kritiker-Laeufe hintereinander stellten dieselbe Forderung an die
Spitze ihrer Rangliste: die Raenge muessen E-Nummern bekommen, sonst
"existieren alle uebrigen Zeilen dieser Tabelle fuer das Projekt nicht".
Neun Tage lang passierte es nicht — weil keine Wache dahinterstand.

DIE KONVENTION, DIE DIESE WACHE HAELT: Fuer jede Rangzeile einer
AUDIT-Rangliste (ab 21.08.2026 — davor hatten die Laeufe kein
einheitliches Ranglisten-Format) muss BACKLOG.md die woertliche Marke

    AUDIT-<datum> Rang <n>:

tragen. Was hinter dem Doppelpunkt steht (erledigt am/verworfen
weil/offen als E-Nummer), entscheidet der Mensch — die Wache erzwingt nur,
DASS entschieden wurde. Ein kuenftiger Audit-Lauf wird damit am Tag danach
rot, bis seine Raenge gebucht sind: die Wache steht VOR dem naechsten
Wiederkehren, nicht dahinter.

AUFRUF
    python3 tools/audit-raenge-gebucht.py             Bericht
    python3 tools/audit-raenge-gebucht.py --pruefen   still bei gruen, Exit 1 sonst
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
AB = "2026-08-21"


def ranglisten():
    """(datum, rang) fuer jede Rangzeile jeder Audit-Rangliste ab AB."""
    paare = []
    for datei in sorted(WURZEL.glob("AUDIT-*.md")):
        m = re.match(r"AUDIT-(\d{4}-\d{2}-\d{2})\.md", datei.name)
        if not m or m.group(1) < AB:
            continue
        datum = m.group(1)
        text = datei.read_text(encoding="utf-8", errors="replace")
        # ALLE Abschnitte, deren Ueberschrift "Rangliste" oder
        # "Vorschlagsliste" traegt — nicht nur der erste Treffer: die
        # Rueckstands-Bilanz (§0) NENNT die Ranglisten oft und hat selbst
        # keine; wer nur den ersten Treffer nimmt, findet dort null Raenge
        # und meldet den Tag still als gebucht (so uebersah die Erstfassung
        # dieser Wache die Tage 22., 23. und 27.).
        gefunden = set()
        for a in re.finditer(r"^##.*(?:Rangliste|Vorschlagsliste).*$", text, re.M):
            rest = text[a.end():]
            ende = re.search(r"^## ", rest, re.M)
            abschnitt = rest[: ende.start()] if ende else rest
            # DREI Formen im Bestand — und die dritte fehlte bis zum
            # 06.09.2026, obwohl die Laeufe seit dem 04.09. NUR noch so
            # schreiben: von den 12 Raengen des 05.09. sah diese Wache
            # KEINEN und meldete den Tag still als gebucht. Eine Wache, die
            # die falsche Form bewacht, ist gruen auf die gefaehrlichste Art
            # (AUDIT-2026-09-06 Rang 2; dieselbe Klasse wie
            # llmwiki kommentar-und-kompilat-sind-keine-gegenstelle).
            #
            #   1. Tabellenzeile   "| 3 | ..."
            #   2. Nummernliste    "3. **...**"      (so schreibt der 22.08.)
            #   3. Ueberschrift    "### Rang 3 — ..." (seit 04.09.)
            for z in re.finditer(r"^\|\s*(\d+)\s*\|", abschnitt, re.M):
                gefunden.add(int(z.group(1)))
            for z in re.finditer(r"^#{3,}\s*Rang\s+(\d+)\b", abschnitt, re.M):
                gefunden.add(int(z.group(1)))
            # NUMMERNLISTE NUR AUSSERHALB VON FLIESSTEXT: Ein Satz wie
            # "Erstweg 114 Ablagen, Updateweg 105." bricht so um, dass
            # "105." am Zeilenanfang steht — und sah fuer die Erstfassung
            # wie eine Listen-Nummer aus (Phantom-"Rang 105", 05.09.).
            # Zwei Schranken dagegen: die Zahl muss klein sein (Ranglisten
            # haben keine 105 Eintraege), und die Zeile davor muss LEER
            # sein — eine echte Listen-Nummer beginnt einen Absatz,
            # umgebrochene Prosa nie.
            zeilen = abschnitt.splitlines()
            for i, zeile in enumerate(zeilen):
                z = re.match(r"^(\d{1,2})\.\s+\*\*", zeile)
                if not z:
                    continue
                if i > 0 and zeilen[i - 1].strip():
                    continue
                gefunden.add(int(z.group(1)))
        paare.extend((datum, r) for r in sorted(gefunden))
    return paare


def main() -> int:
    still = "--pruefen" in sys.argv
    backlog = (WURZEL / "BACKLOG.md").read_text(encoding="utf-8", errors="replace")
    fehlend = [
        (datum, rang)
        for datum, rang in ranglisten()
        if f"AUDIT-{datum} Rang {rang}:" not in backlog
    ]
    if not fehlend:
        if not still:
            n = len(ranglisten())
            print(f"Alle {n} Audit-Raenge (ab {AB}) sind im Backlog gebucht.")
        return 0
    print(f"{len(fehlend)} Audit-Rang/Raenge ohne Backlog-Buchung (Marke 'AUDIT-<datum> Rang <n>:'):")
    for datum, rang in fehlend:
        print(f"  AUDIT-{datum} Rang {rang}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
