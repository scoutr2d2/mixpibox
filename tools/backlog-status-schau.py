#!/usr/bin/env python3
"""BACKLOG.md nach Statuswoertern durchsehen — und zaehlen, was zaehlbar ist.

Warum es dieses Werkzeug gibt
-----------------------------
Am 04.08.2026 wurde ueber das Statuswort GEZAEHLT und die Zaehlung fiel auf ein
ZITAT herein: E12/X2 traegt „ERLEDIGT", enthaelt aber im Begruendungstext das
Wort „OFFEN" (naemlich: „Er sagte OFFEN, `dietpi.txt` setzt /var/swap").  Wer
`grep -c OFFEN` rechnet, zaehlt solche Stellen mit.

Deshalb liest dieses Werkzeug NICHT den Fliesstext, sondern ausschliesslich die
STATUSSPALTE der Tabellen — und zwar nur ihr erstes Wort.  Alles danach ist
Begruendung und wird nicht bewertet.

    python3 tools/backlog-status-schau.py            # Zaehlung + Liste
    python3 tools/backlog-status-schau.py --offen    # nur, was noch aussteht
    python3 tools/backlog-status-schau.py --fremd    # nur unerlaubte Statuswoerter
    python3 tools/backlog-status-schau.py --pruefen  # still; Ende 1 bei fremdem Wort

`--pruefen` ist fuer `tools/pruefen.sh` gedacht: es faellt, sobald jemand ein
Statuswort benutzt, das in den Konventionen nicht steht.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Die erlaubte Menge — sie steht so auch unter „Konventionen" in BACKLOG.md.
# Wer hier etwas ergaenzt, ergaenzt es DORT auch, sonst laufen sie auseinander.
ERLAUBT = {
    "OFFEN": "beschrieben, noch nicht begonnen",
    "LAEUFT": "in Arbeit",
    "TEILERLEDIGT": "teils gebaut — der Rest ist benannt",
    "BLOCKIERT": "wartet auf eine Auskunft oder ein anderes Item",
    "ENTSCHEIDUNG": "braucht eine Wahl des Betreibers, kein Code",
    "FERTIG": "gebaut/entschieden/behoben — nichts steht mehr aus",
    "VERWORFEN": "bewusst nicht gemacht — Grund steht daneben",
}

# Was noch Arbeit ist. FERTIG und VERWORFEN sind zu; alles andere ist offen.
OFFEN_ARTIG = {"OFFEN", "LAEUFT", "TEILERLEDIGT", "BLOCKIERT", "ENTSCHEIDUNG"}

# Alte Woerter und wohin sie gehoeren — damit ein Fund erklaerbar bleibt.
ABGELOEST = {
    "ERLEDIGT": "FERTIG",
    "BEHOBEN": "FERTIG",
    "ENTSCHIEDEN": "FERTIG",
    "GEBAUT": "FERTIG",
    "GESTRICHEN": "VERWORFEN",
    "ENTFAELLT": "VERWORFEN",
    "ZURUECKGESTELLT": "OFFEN",
    "HALB": "TEILERLEDIGT",
    "TEILWEISE": "TEILERLEDIGT",
    "LÄUFT": "LAEUFT",
}

# Zeile einer Markdown-Tabelle: | a | b | c | …
TABELLE = re.compile(r"^\s*\|(.+)\|\s*$")
TRENNER = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
# Das erste Wort einer Statuszelle, ohne Auszeichnung und ohne Durchstreichung.
WORT = re.compile(r"[A-Za-zÄÖÜäöü]+")


# Ein `|` im Text trennt eine Zelle — AUCH innerhalb von Backticks. Markdown
# kennt dort keine Ausnahme, nur `\|`. Am 04.08.2026 zerlegte ein
# `amixer sget Master | grep "Right:"` die X13-Zeile in fuenf statt drei Zellen;
# die Statusspalte zeigte danach auf ein Stueck Fliesstext, und der Punkt fiel
# aus der Zaehlung. Am gerenderten Dokument sieht man es als Spalten zu viel.
TRENNZEICHEN = re.compile(r"(?<!\\)\|")


def zellen(zeile: str) -> list[str]:
    inhalt = TABELLE.match(zeile).group(1)
    return [z.strip() for z in TRENNZEICHEN.split(inhalt)]


def kopfstatusspalte(zellen_: list[str]) -> int | None:
    """Welche Spalte traegt den Status? Kopfzeilen heissen „Status" oder „Stand"."""
    # SPALTE 0 ZAEHLT NICHT. Dort steht die ID (F1, G4, X13 …); eine Tabelle,
    # deren ERSTE Spalte „Status" heisst, ist keine Punkteliste, sondern eine
    # Begriffserklaerung — die Konventionen-Tabelle dieses Dokuments zum
    # Beispiel. Sie mitzuzaehlen hiesse, die Legende fuer Punkte zu halten.
    for i, z in enumerate(zellen_):
        if i == 0:
            continue
        k = z.strip("* ").lower()
        if k in ("status", "stand"):
            return i
    return None


# Eine Zelle, die etwas SAGT, aber nicht mit einem Statuswort anfaengt. Sie ist
# die gefaehrlichste Sorte: ein stiller Ausfall aus der Zaehlung. Am 04.08.2026
# fiel E12/X13 genau so heraus — seine Zelle begann mit „(d) OFFEN", und ein
# Leser, der nur das erste GROSSBUCHSTABENWORT sucht, findet dort keins und
# geht weiter. Der Punkt war danach in keiner Spalte mehr enthalten.
OHNE_STATUS = "(ohne Statuswort)"

# Durchgestrichenes ist ZURUECKGENOMMEN und darf nicht gelesen werden.
# Am 04.08.2026 stand in der Statuszelle von E6/G4:
#     ~~FERTIG 2026-08-03~~ → **TEILERLEDIGT (korrigiert 2026-08-04).**
# Dieses Werkzeug nahm die `~~` bloss WEG statt den Inhalt dazwischen — und
# zaehlte den Punkt danach als FERTIG, also als „ist zu". Das Dokument sagte
# das Gegenteil, im selben Satz. Ein durchgestrichenes Wort mitzuzaehlen ist
# schlimmer als es zu uebersehen: die Zahl sieht plausibel aus und ist falsch
# herum. Deshalb wird die Spanne samt Inhalt entfernt, bevor gelesen wird.
DURCHGESTRICHEN = re.compile(r"~~.*?~~", re.DOTALL)


def erstes_wort(zelle: str) -> str | None:
    """Das Statuswort einer Zelle — oder OHNE_STATUS, wenn sie eines schuldig bleibt.

    `None` heisst „diese Zelle sagt gar nichts" (leer, `—`). Alles andere zaehlt.
    """
    # Auszeichnung weg, Zurueckgenommenes SAMT INHALT weg, dann das erste Wort.
    mit_gestrichenem = zelle.replace("**", "").replace("~~", "").strip()
    hatte_inhalt = bool(mit_gestrichenem) and mit_gestrichenem not in ("—", "-", "–")
    roh = DURCHGESTRICHEN.sub(" ", zelle).replace("**", "").replace("~~", "").strip()
    # Reste einer Aufzaehlung, die nach dem Streichen allein stehenbleiben.
    roh = roh.lstrip("→->–— ").strip()
    if not roh or roh in ("—", "-", "–"):
        # Stand hier etwas, das VOLLSTAENDIG durchgestrichen ist, dann ist die
        # Zelle nicht leer, sondern unbeantwortet — und das muss auffallen,
        # statt still aus der Zaehlung zu fallen.
        return OHNE_STATUS if hatte_inhalt else None
    m = WORT.match(roh)
    if not m:
        return OHNE_STATUS
    w = m.group(0).upper().replace("Ü", "UE").replace("Ä", "AE").replace("Ö", "OE")
    return w


def krumme_zeilen(pfad: Path) -> list[tuple[int, int, int, str]]:
    """Tabellenzeilen, deren Spaltenzahl von ihrem Kopf abweicht.

    WOZU DAS HIER MITLAEUFT: Ein `|` zu viel verschiebt die Statusspalte, und
    dann liest dieses Werkzeug ein Stueck Fliesstext als Status — schlimmer als
    gar nichts zu lesen, weil die Zahl trotzdem plausibel aussieht. Am
    04.08.2026 traf es vier Zeilen (X7, X13, X14, G10e-5), jede mit einer Pipe
    in einem Codestueck: `amixer … | grep`, `||`, `kz-an|kz-aus`.
    """
    erwartet: int | None = None
    krumm = []
    for nr, zeile in enumerate(pfad.read_text(encoding="utf-8").splitlines(), start=1):
        if not TABELLE.match(zeile):
            erwartet = None
            continue
        n = len(zellen(zeile))
        if TRENNER.match(zeile) or erwartet is None:
            erwartet = n
            continue
        if n != erwartet:
            krumm.append((nr, n, erwartet, zeile[:100]))
    return krumm


def lesen(pfad: Path):
    """Liefert (zeilennummer, abschnitt, id, statuswort, rest) je Tabellenzeile."""
    abschnitt = "(vor der ersten Ueberschrift)"
    spalte: int | None = None
    befunde = []

    for nr, zeile in enumerate(pfad.read_text(encoding="utf-8").splitlines(), start=1):
        if zeile.startswith("#"):
            abschnitt = zeile.lstrip("#").strip()
            spalte = None
            continue
        if not TABELLE.match(zeile):
            spalte = None
            continue
        if TRENNER.match(zeile):
            continue
        z = zellen(zeile)
        k = kopfstatusspalte(z)
        if k is not None:
            spalte = k
            continue
        if spalte is None or spalte >= len(z):
            continue
        wort = erstes_wort(z[spalte])
        if wort is None:
            continue
        kennung = z[0].replace("**", "").replace("~~", "").strip() or "(ohne ID)"
        befunde.append((nr, abschnitt, kennung, wort, z[spalte]))
    return befunde


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--datei", default=None, help="Pfad zu BACKLOG.md")
    p.add_argument("--offen", action="store_true", help="nur, was noch aussteht")
    p.add_argument("--fremd", action="store_true", help="nur unerlaubte Statuswoerter")
    p.add_argument("--pruefen", action="store_true", help="still; Ende 1 bei fremdem Wort")
    a = p.parse_args()

    pfad = Path(a.datei) if a.datei else Path(__file__).resolve().parent.parent / "BACKLOG.md"
    if not pfad.exists():
        print(f"nicht gefunden: {pfad}", file=sys.stderr)
        return 2

    befunde = lesen(pfad)
    fremd = [b for b in befunde if b[3] not in ERLAUBT]
    krumm = krumme_zeilen(pfad)

    if a.pruefen:
        ende = 0
        if krumm:
            print(f"FEHLT: {len(krumm)} Tabellenzeile(n) mit falscher Spaltenzahl — ein `|` gehoert als `\\|` geschrieben")
            for nr, n, soll, roh in krumm[:20]:
                print(f"  Zeile {nr:5d}  {n} Zellen statt {soll}:  {roh}")
            ende = 1
        if fremd:
            print(f"FEHLT: {len(fremd)} Statuszelle(n) mit einem Wort ausserhalb der Konventionen")
            for nr, _, kennung, wort, _ in fremd[:20]:
                hin = ABGELOEST.get(wort)
                print(f"  Zeile {nr:5d}  {kennung:<12} {wort}" + (f"  -> {hin}" if hin else ""))
            ende = 1
        return ende

    if a.fremd:
        for nr, absch, kennung, wort, roh in fremd:
            print(f"{nr:5d}  {wort:<14} {kennung:<12} {absch[:44]}")
        print(f"\n{len(fremd)} Statuszelle(n) ausserhalb der Konventionen")
        for nr, n, soll, roh in krumm:
            print(f"{nr:5d}  {n} Zellen statt {soll}:  {roh}")
        if krumm:
            print(f"{len(krumm)} Tabellenzeile(n) mit falscher Spaltenzahl")
        return 0

    zaehl: dict[str, int] = {}
    for _, _, _, wort, _ in befunde:
        zaehl[wort] = zaehl.get(wort, 0) + 1

    auswahl = [b for b in befunde if not a.offen or b[3] in OFFEN_ARTIG]
    for nr, absch, kennung, wort, _ in auswahl:
        print(f"{nr:5d}  {wort:<14} {kennung:<12} {absch[:44]}")

    print()
    print(f"{pfad}  —  {len(befunde)} Statuszellen in Tabellen")
    for wort, n in sorted(zaehl.items(), key=lambda kv: (-kv[1], kv[0])):
        marke = "" if wort in ERLAUBT else "   <- nicht in den Konventionen"
        print(f"  {wort:<14} {n:3d}{marke}")
    aus = sum(n for w, n in zaehl.items() if w in OFFEN_ARTIG)
    zu = sum(n for w, n in zaehl.items() if w in ("FERTIG", "VERWORFEN"))
    print(f"\n  steht aus {aus}   ist zu {zu}   ausserhalb der Konventionen {len(fremd)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
