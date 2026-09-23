#!/usr/bin/env python3
"""Welche Steuerbefehle kennt der Abspieldienst WIRKLICH? — aus dem Code gelesen.

WOZU: Ein unbekannter Befehl wird von der Box mit HTTP 200 quittiert. Es gibt
keinen Zweig, der ihn bemaengelt — der Verteiler in spotify-control.ts
vergleicht der Reihe nach gegen bekannte Namen, und wenn keiner passt, faellt
der Aufruf einfach durch. Von aussen sieht das aus wie Erfolg.

GENAU DARAN hat sich die neue Oberflaeche verletzt: Ihre Knoepfe schickten
`playpause`. Den Befehl gibt es nicht. Die Box antwortete 200, die Musik lief
weiter, und der Fehler wurde bei den Knoepfen gesucht.

Verfuehrerisch war dabei die Aufzaehlung `PlayerCmds` in player.service.ts —
dort STEHT `PLAYPAUSE = 'playpause'`. Es ist ein toter Eintrag: gesendet wird
er von nirgends. Eine Aufzaehlung im Frontend ist kein Beleg dafuer, dass das
Hintergrundsystem etwas kennt.

DESHALB LIEST DIESES WERKZEUG DIE WAHRHEIT AM QUELLTEXT des Verteilers und
stellt sie der Aufzaehlung gegenueber. Wer einen Knopf verdrahtet, sieht in
einem Blick, ob sein Befehl ankommt.

WAS ES NICHT TUT: Es fasst die Box nicht an und spielt nichts ab. Es ist eine
Textprüfung — genau deshalb laeuft es ohne Geraet und ohne Ton.

AUFRUF
    tools/player-befehle.py
    tools/player-befehle.py --pruefe playpause play pause weiter
"""

import argparse
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
VERTEILER = WURZEL / "src/backend-player/src/spotify-control.ts"
# Die AUFZAEHLUNG PlayerCmds der alten Angular-App fiel mit E118/1e — der
# lange Bericht unten arbeitet seither ohne sie; --oberflaeche (der
# pruefen.sh-Schritt) hat sie nie gebraucht.
AUFZAEHLUNG = None


def bekannte_befehle(text: str) -> set[str]:
    """Die Namen, gegen die der Verteiler wirklich vergleicht.

    Zwei Formen kommen vor:
        command.name === 'pause'
        command.name.includes('tracknr:')
    Die zweite ist ein VORSATZ, kein ganzer Name — sie wird mit ':' am Ende
    zurueckgegeben, damit man beides auseinanderhaelt.
    """
    treffer = set(re.findall(r"command\.name\s*===\s*'([^']+)'", text))
    for v in re.findall(r"command\.name\.includes\('([^']+)'\)", text):
        treffer.add(v)
    return treffer


def dir_zweige(text: str) -> set[str]:
    """Zweige, die nicht am Namen haengen, sondern am PFAD (`command.dir`)
    oder am Verb — also die Startbefehle wie `library`, `radio`, `jellyfin`."""
    treffer = set(re.findall(r"command\.dir\.includes\('([^']+)'\)", text))
    treffer |= set(re.findall(r"verb\s*===\s*'([^']+)'", text))
    return treffer


def aufzaehlung(text: str) -> dict[str, str]:
    """PlayerCmds aus dem Frontend: Name -> Wert."""
    block = re.search(r"export enum PlayerCmds\s*\{(.*?)\}", text, re.S)
    if not block:
        return {}
    return dict(re.findall(r"(\w+)\s*=\s*'([^']+)'", block.group(1)))


def kennt(befehl: str, namen: set[str], pfade: set[str]) -> bool:
    """Erreicht dieser Befehl einen Zweig des Verteilers?

    Der Verteiler zerlegt den Pfad mit `path.parse` und vergleicht `command.name`
    — das LETZTE Wegstueck. Deshalb drei Formen pruefen:
        `pause`        ganzer Name
        `volume/+5`    letztes Stueck (`+5`)
        `tracknr:3`    Vorsatz mit Doppelpunkt (`tracknr:`)
    """
    letztes = befehl.rsplit("/", 1)[-1]
    vorsatz = letztes.split(":")[0] + ":" if ":" in letztes else None
    return (
        befehl in namen
        or letztes in namen
        or (vorsatz is not None and vorsatz in namen)
        or befehl in pfade
        or befehl.split("/")[0] in pfade
    )


OBERFLAECHE = WURZEL / "NewDesign/app.js"


def gesendete_befehle(text: str) -> set[str]:
    """Was die NEUE Oberflaeche an den Abspieldienst schickt.

    Gesucht werden die festen Zeichenketten in `spielerBefehl(...)` und in
    `tasteBinden(id, '...')`. Zusammengesetzte Befehle (Vorlagen mit ${...})
    werden auf ihren festen ANFANG gekuerzt — `tracknr:${n}` wird zu
    `tracknr:`, und genau das vergleicht der Verteiler auch.

    Was sich gar nicht statisch bestimmen laesst (ein Befehl, der komplett aus
    einer Variablen kommt), faellt hier durch — dieser Abgleich ist eine
    Absicherung gegen Tippfehler und erfundene Befehle, kein Beweis.
    """
    treffer: set[str] = set()
    for m in re.finditer(r"spielerBefehl\(\s*'([^']+)'", text):
        treffer.add(m.group(1))
    for m in re.finditer(r"tasteBinden\(\s*'[^']+'\s*,\s*'([^']+)'", text):
        treffer.add(m.group(1))
    # Vorlagen: `tracknr:${...}` -> fester Anfang bis zum ersten ${
    for m in re.finditer(r"spielerBefehl\(\s*`([^`]*)`", text):
        treffer.add(m.group(1).split("${")[0])
    # Der Ja/Nein-Zweig des Spiel-Knopfs: will ? 'play' : 'pause'
    for m in re.finditer(r"spielerBefehl\(\s*\w+\s*\?\s*'([^']+)'\s*:\s*'([^']+)'", text):
        treffer.add(m.group(1))
        treffer.add(m.group(2))
    return {t for t in treffer if t}


def main() -> int:
    p = argparse.ArgumentParser(description="Steuerbefehle des Abspieldienstes auflisten und pruefen")
    p.add_argument("--pruefe", nargs="*", default=[], help="diese Befehle gegen den Verteiler pruefen")
    p.add_argument(
        "--oberflaeche",
        action="store_true",
        help="pruefen, ob die neue Oberflaeche nur Befehle schickt, die es gibt (fuer pruefen.sh)",
    )
    a = p.parse_args()

    if not VERTEILER.exists():
        print(f"nicht gefunden: {VERTEILER}", file=sys.stderr)
        return 1

    vt = VERTEILER.read_text(encoding="utf8")
    namen = bekannte_befehle(vt)
    pfade = dir_zweige(vt)
    enum = {}

    # KURZE FORM FUER pruefen.sh: nur die neue Oberflaeche gegen den Verteiler.
    # Schweigt, wenn alles stimmt — ein Pruefschritt soll nur reden, wenn etwas
    # nicht in Ordnung ist.
    if a.oberflaeche:
        if not OBERFLAECHE.exists():
            print(f"nicht gefunden: {OBERFLAECHE}", file=sys.stderr)
            return 1
        geschickt = gesendete_befehle(OBERFLAECHE.read_text(encoding="utf8"))
        unbekannt = sorted(b for b in geschickt if not kennt(b, namen, pfade))
        if unbekannt:
            print(f"{OBERFLAECHE.relative_to(WURZEL)} schickt Befehle, die der Verteiler NICHT kennt:")
            for b in unbekannt:
                print(f"    {b}")
            print("Die Box quittiert solche Befehle mit 200 und tut nichts.")
            print("llmwiki: playpause-gibt-es-nicht")
            return 2
        return 0

    print(f"VERTEILER  {VERTEILER.relative_to(WURZEL)}")
    print(f"\n{len(namen)} Befehle am NAMEN erkannt:")
    for n in sorted(namen):
        print(f"    {n}")
    print(f"\n{len(pfade)} Zweige am PFAD/Verb (Startbefehle):")
    print("    " + "  ".join(sorted(pfade)))

    if enum:
        # Der Verteiler zerlegt den Pfad mit `path.parse` und vergleicht gegen
        # `command.name` — das ist das LETZTE Wegstueck. `volume/+5` kommt dort
        # als `+5` an. Wer nur die ganze Zeichenkette vergleicht, meldet solche
        # Befehle faelschlich als tot (mir beim ersten Lauf passiert).
        tot = {k: v for k, v in enum.items() if not kennt(v, namen, pfade)}
        print(f"\nAUFZAEHLUNG PlayerCmds: {len(enum)} Eintraege")
        if tot:
            print("  OHNE Entsprechung im Verteiler — wer diese schickt, erreicht nichts:")
            for k, v in sorted(tot.items()):
                print(f"    {k:<16} '{v}'")
        else:
            print("  alle haben eine Entsprechung")

    if a.pruefe:
        print("\nGEPRUEFT:")
        schlecht = 0
        for b in a.pruefe:
            ok = kennt(b, namen, pfade)
            if not ok:
                schlecht += 1
            print(f"    {b:<20} {'kennt die Box' if ok else 'KENNT DIE BOX NICHT — faellt durch, Antwort trotzdem 200'}")
        return 2 if schlecht else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
