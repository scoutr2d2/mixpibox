#!/usr/bin/env python3
"""Findet Schluessel, die in EINEM Eintrag des Wissenspakets zweimal stehen.

WARUM ES DIESE WACHE GIBT: YAML erlaubt denselben Schluessel mehrfach in einer
Abbildung und `yaml.safe_load` behaelt kommentarlos den LETZTEN. Am 29.08.2026
wurde `related: [verschmelzung-abspielen-stufe3]` an
`kachel-sieht-richtig-aus-und-spielt-nicht` angehaengt -- oben, direkt hinter
`tags:`. Der Eintrag fuehrte ein zweites `related:` sechzig Zeilen weiter
unten. Die Ergaenzung stand in der Datei, war im Diff zu sehen, wurde
committet und war fuer JEDEN LESER DES PAKETS unsichtbar. Aufgefallen ist es
nur, weil eine andere Wache danach unveraendert rot blieb.

DAS IST DIE GEFAEHRLICHE FORM: nicht ein Fehler, der meldet, sondern eine
Aenderung, die stillschweigend nicht stattfindet. Verwandt mit dem schon
gebuchten Fall doppelter IDs ([[wiki-doppelte-id-faellt-durch-safe-load]]) --
dort verschwindet ein ganzer Eintrag, hier ein Feld.

Gelesen wird der TEXT, nicht das geladene Paket: safe_load hat die Doppelung
zu diesem Zeitpunkt bereits aufgeloest und kann sie nicht mehr zeigen.

Ausgang 0 = keine Doppelung, 1 = Fund, 2 = unmessbar.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "llmwiki" / "pack.yaml"

# Ein Eintrag beginnt an seinem ersten Schluessel auf Listenebene.
EINTRAGSANFANG = re.compile(r"^  - ([a-z_]+):(.*)$")
# Ein Feld des Eintrags steht vier Zeichen eingerueckt. Tiefer Eingerficktes
# gehoert zu einem Unterbaum und darf gleich heissen.
FELD = re.compile(r"^    ([a-z_]+):")


def main():
    if not PAKET.exists():
        print(f"UNMESSBAR: {PAKET} fehlt", file=sys.stderr)
        return 2
    try:
        zeilen = PAKET.read_text(encoding="utf-8").split("\n")
    except OSError as fehler:
        print(f"UNMESSBAR: {PAKET} nicht lesbar: {fehler}", file=sys.stderr)
        return 2

    eintrag = "(vor dem ersten Eintrag)"
    gesehen = {}
    in_block = False        # innerhalb eines '|'- oder '>'-Blocks
    block_tiefe = 0
    funde = []
    eintraege = 0

    for nummer, zeile in enumerate(zeilen, 1):
        # Blocktext darf alles enthalten, auch Zeilen, die wie Schluessel
        # aussehen. Ohne diese Unterscheidung meldet die Wache Prosa.
        if in_block:
            if zeile.strip() == "" or (len(zeile) - len(zeile.lstrip())) > block_tiefe:
                continue
            in_block = False

        anfang = EINTRAGSANFANG.match(zeile)
        if anfang:
            eintraege += 1
            schluessel, rest = anfang.groups()
            # Nicht jeder Eintrag beginnt mit `id:` -- manche fuehren `kind:`
            # zuerst. Bis die Kennung auftaucht, dient die erste Zeile als
            # Notbehelf; danach wird sie ersetzt (eintrag ist eine Liste, damit
            # schon gebuchte Funde die Kennung nachtraeglich mitbekommen).
            eintrag = [f"{schluessel}: {rest.strip()}" if rest.strip() else schluessel]
            if schluessel == "id" and rest.strip():
                eintrag[0] = rest.strip()
            gesehen = {schluessel: nummer}
            if rest.strip() in ("|", ">"):
                in_block, block_tiefe = True, 4
            continue

        feld = FELD.match(zeile)
        if feld:
            name = feld.group(1)
            if name == "id" and name not in gesehen:
                kennung = zeile.split(":", 1)[1].strip().strip("\"'")
                if kennung:
                    eintrag[0] = kennung
            if name in gesehen:
                funde.append((eintrag, name, gesehen[name], nummer))
            gesehen[name] = nummer
            if zeile.rstrip().endswith(("|", ">", "|-", ">-")):
                in_block, block_tiefe = True, 4

    if not funde:
        print(f"      {eintraege} Eintraege geprueft, kein Schluessel doppelt.")
        return 0

    for eintrag, name, erste, zweite in funde:
        print(f"DOPPELT  {eintrag[0]}")
        print(f"         Schluessel \"{name}\" steht in Zeile {erste} UND {zweite}")
        print(f"         -> safe_load behaelt Zeile {zweite}; Zeile {erste} ist wirkungslos")
    print()
    print(f"{len(funde)} doppelte(r) Schluessel.")
    print("Beheben: die beiden Vorkommen zu EINEM zusammenfuehren -- nicht das")
    print("obere loeschen, sein Inhalt fehlt sonst.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
