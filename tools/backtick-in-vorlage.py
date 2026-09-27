#!/usr/bin/env python3
"""Sucht Backticks INNERHALB von Angular-Vorlagen — bevor der Compiler es tut.

WARUM (15.08.2026, an einem Tag ZWEIMAL passiert): In einem Kommentar innerhalb
von `template:` oder `styles:` schreibt man beilaeufig einen Bezeichner in
Anfuehrung — `flex-basis`, `aria-hidden`, `overflow: hidden`. Der Backtick
BEENDET das Template-Literal. Danach ist die Datei syntaktisch Unsinn, und der
Compiler meldet Fehler an voellig anderer Stelle:

    NG1001: Decorator argument must be literal.    <- Zeile 149, wo nichts ist
    TS2362: left-hand side of an arithmetic ...    <- Zeile 149
    TS1005: ',' expected                           <- HIER steht der Backtick

Man sucht dann in Zeile 149. Der Fehler steht 170 Zeilen weiter unten.

DIE REGEL: In Kommentaren innerhalb einer Vorlage keine Backticks. Namen ohne
Anfuehrung schreiben oder „…" verwenden.

Aufruf:
    python3 tools/backtick-in-vorlage.py                     # alle Seiten
    python3 tools/backtick-in-vorlage.py pfad/zur/datei.ts   # eine
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

BASIS = Path(__file__).resolve().parent.parent / "src/frontend-admin/src/app"
FELDER = ("template", "styles")


def pruefe(datei: Path) -> list[tuple[str, int, str]]:
    """Fundstellen als (feld, zeilennummer, zeile)."""
    text = datei.read_text(encoding="utf-8")
    funde: list[tuple[str, int, str]] = []
    for feld in FELDER:
        # Der Anfang einer Vorlage: `  template: ` + Backtick am Zeilenende.
        for anfang in re.finditer(rf"^(\s*){feld}: `\s*$", text, re.M):
            einzug = anfang.group(1)
            # Das Ende ist der Backtick auf eigener Einrueckung, gefolgt von
            # Komma oder Klammer — dieselbe Form, die Prettier hier schreibt.
            ende = re.search(rf"^{einzug}`[,)]", text[anfang.end():], re.M)
            if not ende:
                continue
            inhalt = text[anfang.end():anfang.end() + ende.start()]
            if "`" not in inhalt:
                continue
            # Zeilennummer bestimmen, damit der Fund anklickbar ist.
            vorher = text[: anfang.end()].count("\n")
            for i, zeile in enumerate(inhalt.split("\n")):
                if "`" in zeile:
                    funde.append((feld, vorher + i + 1, zeile.strip()))
    return funde


def main() -> int:
    ziele = [Path(a) for a in sys.argv[1:]] or sorted(BASIS.rglob("*.ts"))
    ziele = [z for z in ziele if z.suffix == ".ts" and not z.name.endswith(".spec.ts")]
    gesamt = 0
    for datei in ziele:
        for feld, nr, zeile in pruefe(datei):
            gesamt += 1
            print(f"{datei}:{nr}  FUND im {feld}: {zeile[:90]}")
    print()
    if gesamt:
        print(f"{gesamt} Backtick(s) innerhalb einer Vorlage.")
        print("Sie beenden das Template-Literal — der Compiler meldet den Fehler")
        print("dann an ganz anderer Stelle. Namen ohne Anfuehrung schreiben.")
        return 1
    print(f"{len(ziele)} Dateien geprueft, keine Backticks innerhalb einer Vorlage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
