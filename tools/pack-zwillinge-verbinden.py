#!/usr/bin/env python3
"""Verbindet zwei Eintraege des Wissenspakets GEGENSEITIG in `related:`.

Der Anlass: `tools/symptom-kollision-probe.py` findet Paare, die sich ein
Symptom teilen, ohne voneinander zu wissen. Das Nachtragen von Hand ist der
Schritt, an dem es bisher haengen blieb -- 412 `related:` in 881 Eintraegen,
in ZWEI Schreibweisen (Fluss `[a, b]` und Block `- a`), teils gar nicht
vorhanden, und der Eintrag kann seinen `body:` als Literalblock hinter oder
vor `related:` fuehren.

WARUM NICHT `yaml.safe_dump`: das Paket fuehrt 53 Kommentarzeilen und
Anfuehrungszeichen, die ein Rundlauf durch PyYAML alle verliert (einmal
passiert, zurueckgenommen). Deshalb wird der Text ZEILENWEISE bearbeitet und
danach mit `safe_load` gegengelesen.

WAS ES NICHT TUT: den `body:` anfassen. Der Satz, der zwischen den Zwillingen
entscheidet, ist Handarbeit -- ein Verweis ohne ihn ist die billige Erfuellung
der Wache, nicht ihre Absicht.

    python3 tools/pack-zwillinge-verbinden.py <id-a> <id-b> [<id-c> ...]
    python3 tools/pack-zwillinge-verbinden.py --pruefen <id-a> <id-b>

Mehr als zwei Kennungen werden zu einer Gruppe verbunden, in der JEDER JEDEN
nennt -- so, wie die Wache es verlangt.

Ausgang 0 = geschrieben (oder nichts zu tun), 1 = Fund/Fehler, 2 = unmessbar.
"""

import argparse
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "llmwiki" / "pack.yaml"

EINTRAG_ANFANG = "  - "
SCHLUESSEL_TIEFE = "    "


def eintrag_grenzen(zeilen):
    """{kennung: (erste Zeile, letzte Zeile exklusive)} ueber den Rohtext.

    Gelesen wird der Text, nicht das geladene YAML: die Zeilennummern werden
    zum Schreiben gebraucht, und ein Eintrag kann `id:` an beliebiger Stelle
    seines Blocks fuehren (gemessen: 881 Eintraege, `id` mal vor, mal hinter
    `kind`).
    """
    bloecke = []
    for nummer, zeile in enumerate(zeilen):
        if zeile.startswith(EINTRAG_ANFANG):
            bloecke.append(nummer)
    grenzen = {}
    for i, anfang in enumerate(bloecke):
        ende = bloecke[i + 1] if i + 1 < len(bloecke) else len(zeilen)
        kennung = None
        for zeile in zeilen[anfang:ende]:
            roh = zeile.strip()
            if roh.startswith("- id:"):
                kennung = roh[len("- id:"):].strip()
                break
            if roh.startswith("id:") and (
                zeile.startswith(SCHLUESSEL_TIEFE + "id:")
                or zeile.startswith(EINTRAG_ANFANG + "id:")
            ):
                kennung = roh[len("id:"):].strip()
                break
        if kennung:
            grenzen[kennung.strip("\"'")] = (anfang, ende)
    return grenzen


def related_zeile(zeilen, anfang, ende):
    """Nummer der `related:`-Zeile des Blocks, oder None.

    Nur auf SCHLUESSEL_TIEFE -- ein `related:` weiter eingerueckt steht im
    Fliesstext eines `body:` und ist kein Feld.
    """
    for nummer in range(anfang, ende):
        if zeilen[nummer].startswith(SCHLUESSEL_TIEFE + "related:"):
            return nummer
    return None


def letzte_inhaltszeile(zeilen, anfang, ende):
    """Letzte nicht-leere Zeile des Blocks -- dahinter wird angehaengt."""
    for nummer in range(ende - 1, anfang - 1, -1):
        if zeilen[nummer].strip():
            return nummer
    return ende - 1


def eintragen(zeilen, grenzen, kennung, ziele):
    """Traegt `ziele` in `related:` von `kennung` ein. Gibt die neuen Zeilen
    und die Zahl der wirklich ergaenzten Verweise zurueck."""
    anfang, ende = grenzen[kennung]
    nummer = related_zeile(zeilen, anfang, ende)

    if nummer is None:
        neu = [z for z in ziele if z != kennung]
        if not neu:
            return zeilen, 0
        stelle = letzte_inhaltszeile(zeilen, anfang, ende) + 1
        zeile = SCHLUESSEL_TIEFE + "related: [" + ", ".join(neu) + "]"
        return zeilen[:stelle] + [zeile] + zeilen[stelle:], len(neu)

    rest = zeilen[nummer][len(SCHLUESSEL_TIEFE + "related:"):].strip()

    if rest.startswith("["):
        vorhanden = [
            t.strip().strip("\"'")
            for t in rest.strip("[]").split(",")
            if t.strip()
        ]
        neu = [z for z in ziele if z != kennung and z not in vorhanden]
        if not neu:
            return zeilen, 0
        zeilen = list(zeilen)
        zeilen[nummer] = (
            SCHLUESSEL_TIEFE + "related: ["
            + ", ".join(vorhanden + neu) + "]"
        )
        return zeilen, len(neu)

    # Blockform: die folgenden '      - '-Zeilen gehoeren dazu.
    letzte = nummer
    vorhanden = []
    einrueckung = None
    for lauf in range(nummer + 1, ende):
        roh = zeilen[lauf]
        if not roh.strip():
            continue
        if roh.lstrip().startswith("- ") and (
            len(roh) - len(roh.lstrip())
        ) > len(SCHLUESSEL_TIEFE):
            einrueckung = roh[: len(roh) - len(roh.lstrip())]
            vorhanden.append(roh.strip()[2:].strip().strip("\"'"))
            letzte = lauf
            continue
        break
    neu = [z for z in ziele if z != kennung and z not in vorhanden]
    if not neu:
        return zeilen, 0
    einrueckung = einrueckung or (SCHLUESSEL_TIEFE + "  ")
    eingefuegt = [einrueckung + "- " + z for z in neu]
    return zeilen[:letzte + 1] + eingefuegt + zeilen[letzte + 1:], len(neu)


def main():
    zerleger = argparse.ArgumentParser(add_help=True)
    zerleger.add_argument("kennungen", nargs="+")
    zerleger.add_argument(
        "--pruefen", action="store_true",
        help="nur melden, was fehlt -- nichts schreiben",
    )
    argumente = zerleger.parse_args()

    if len(argumente.kennungen) < 2:
        print("UNMESSBAR: mindestens zwei Kennungen noetig", file=sys.stderr)
        return 2
    try:
        import yaml
    except ImportError:
        print("UNMESSBAR: PyYAML fehlt", file=sys.stderr)
        return 2
    if not PAKET.exists():
        print(f"UNMESSBAR: {PAKET} fehlt", file=sys.stderr)
        return 2

    text = PAKET.read_text(encoding="utf-8")
    zeilen = text.split("\n")
    kommentare_vorher = sum(1 for z in zeilen if z.lstrip().startswith("#"))
    grenzen = eintrag_grenzen(zeilen)

    fehlend = [k for k in argumente.kennungen if k not in grenzen]
    if fehlend:
        print("UNMESSBAR: nicht im Paket: " + ", ".join(fehlend),
              file=sys.stderr)
        return 2

    if argumente.pruefen:
        paket = yaml.safe_load(text)
        haben = {
            e["id"]: set(e.get("related") or [])
            for e in paket["entries"] if e.get("id")
        }
        offen = 0
        for a in argumente.kennungen:
            for b in argumente.kennungen:
                if a != b and b not in haben.get(a, ()):
                    print(f"{a} nennt {b} nicht")
                    offen += 1
        print(f"{offen} Verweis(e) fehlen.")
        return 1 if offen else 0

    ergaenzt = 0
    # Von hinten nach vorn schreiben: eine Einfuegung verschiebt alle
    # Zeilennummern DAHINTER, nie die davor.
    for kennung in sorted(argumente.kennungen,
                          key=lambda k: grenzen[k][0], reverse=True):
        zeilen, zahl = eintragen(
            zeilen, grenzen, kennung, list(argumente.kennungen)
        )
        ergaenzt += zahl

    if not ergaenzt:
        print("Nichts zu tun -- die Gruppe ist bereits vollstaendig verbunden.")
        return 0

    neuer_text = "\n".join(zeilen)
    try:
        gegengelesen = yaml.safe_load(neuer_text)
    except yaml.YAMLError as fehler:
        print(f"NICHT GESCHRIEBEN: das Ergebnis ist kein YAML mehr: {fehler}",
              file=sys.stderr)
        return 1

    kommentare_nachher = sum(
        1 for z in neuer_text.split("\n") if z.lstrip().startswith("#")
    )
    if kommentare_nachher != kommentare_vorher:
        print(f"NICHT GESCHRIEBEN: {kommentare_vorher} Kommentarzeilen vorher, "
              f"{kommentare_nachher} nachher", file=sys.stderr)
        return 1
    alt = yaml.safe_load(text)
    if len(gegengelesen["entries"]) != len(alt["entries"]):
        print("NICHT GESCHRIEBEN: die Zahl der Eintraege hat sich geaendert",
              file=sys.stderr)
        return 1

    PAKET.write_text(neuer_text, encoding="utf-8")
    print(f"{ergaenzt} Verweis(e) ergaenzt zwischen "
          f"{', '.join(argumente.kennungen)}.")
    print("OFFEN BLEIBT DIE PROSA: im body die eine Frage nennen, die")
    print("zwischen den Zwillingen entscheidet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
