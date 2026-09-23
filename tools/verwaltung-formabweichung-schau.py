#!/usr/bin/env python3
"""Verwaltung: Stellen finden, die einer 200-Antwort die FORM glauben.

══ DER FUND, AUS DEM DIESE WACHE KOMMT (QA-Lauf 07.09.2026) ════════════════

Die System-Seite der Verwaltung warf am Stub zwei unbehandelte TypeErrors:

    ERROR TypeError: Cannot read properties of undefined (reading 'filter')
    ERROR TypeError: Cannot read properties of undefined (reading 'length')

Ursache Nummer eins (seiten/system.ts):

    computed(() => this.lage()?.aktionen.filter((a) => a.einschneidend) ?? [])

Das `?.` schuetzt nur gegen `lage() == null`. Antwortet der Server 200 mit
einem Rumpf OHNE `aktionen` (aelterer/nagelneuer Server, Stub, Fehlerseite
mit 200), liest `.filter` auf undefined — und weil es in einem computed()
passiert, wirft es bei JEDER Change Detection erneut. Dieselbe Bauart, die
in der klassischen Oberflaeche als „toSignal speichert den Fehler" einen
halben Tag gekostet hat (llmwiki: klick-sturm-laedt-nichts-mehr, Weg 1).

Ursache Nummer zwei ist die Schwester dazu (`this.schrauben.set(a.schrauben)`
bei einer Antwort ohne Feld — danach wirft `schrauben().length` im Template).
Diese zweite Sorte laesst sich nicht treffsicher greppen (zu viele legitime
`set(x.feld)`), sie steht hier als Fundgeschichte: Wer die erste Sorte
behebt, behebe die Setz-Stelle im selben Zug mit.

══ WAS DIE WACHE PRUEFT ════════════════════════════════════════════════════

Alle *.ts unter src/frontend-admin/src/app (ohne *.spec.ts) auf das Muster

    ?.<feld>.(filter|map|length|some|find|forEach|slice)

Bekannte Stellen stehen mit Datum in AUSNAHMEN und gelten als GEMELDET
(QA-Bericht 07.09.2026), nicht als erlaubt. Die Wache faellt um, wenn
  * eine NEUE Stelle dazukommt (Meldung: absichern statt glauben), oder
  * eine bekannte VERSCHWUNDEN ist (Meldung: Ausnahme austragen) — so
    rostet die Liste nicht (llmwiki: dauerrote-wache-ist-keine).

Aufruf:  python3 tools/verwaltung-formabweichung-schau.py
Exit 0 = Stand wie gemeldet. Exit 1 = neue Stelle oder veraltete Ausnahme.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ORDNER = WURZEL / "src/frontend-admin/src/app"

MUSTER = re.compile(r"\?\.[A-Za-z_$][\w$]*\.(filter|map|length|some|find|forEach|slice)\b")

# Bekannt und GEMELDET (QA-Lauf 07.09.2026) — Datei + eindeutiger
# Zeilen-Teilstring, absichtlich ohne Zeilennummer: die wandert.
AUSNAHMEN = [
    ("seiten/system.ts", "this.lage()?.aktionen.filter"),
    ("seiten/mupihat.ts", "this.diagnose()?.revisionen.find"),
]


def main() -> int:
    funde: list[tuple[str, int, str]] = []
    for datei in sorted(ORDNER.rglob("*.ts")):
        if datei.name.endswith(".spec.ts"):
            continue
        rel = datei.relative_to(ORDNER).as_posix()
        for nr, zeile in enumerate(datei.read_text(encoding="utf-8").splitlines(), 1):
            if MUSTER.search(zeile):
                funde.append((rel, nr, zeile.strip()))

    bekannt_gesehen = set()
    neue = []
    for rel, nr, zeile in funde:
        passt = next((a for a in AUSNAHMEN if a[0] == rel and a[1] in zeile), None)
        if passt:
            bekannt_gesehen.add(passt)
        else:
            neue.append((rel, nr, zeile))

    veraltet = [a for a in AUSNAHMEN if tuple(a) not in bekannt_gesehen]

    for rel, nr, zeile in neue:
        print(f"NEU:      {rel}:{nr}  {zeile[:90]}")
        print("          `?.` schuetzt nur vor null am ANFANG der Kette. Fehlt der Antwort")
        print("          das Feld, wirft die Methode — bei computed() dauerhaft. Form pruefen")
        print("          (Array.isArray) oder `?? []` VOR dem Methodenaufruf setzen.")
    for rel, teil in veraltet:
        print(f"VERALTET: Ausnahme ({rel}, {teil!r}) trifft nichts mehr — austragen.")

    print(
        f"{len(funde)} Stelle(n) gefunden, {len(bekannt_gesehen)} bekannt/gemeldet, "
        f"{len(neue)} neu, {len(veraltet)} veraltete Ausnahme(n)."
    )
    return 1 if neue or veraltet else 0


if __name__ == "__main__":
    sys.exit(main())
