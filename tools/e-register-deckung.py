#!/usr/bin/env python3
"""E-REGISTER-DECKUNG — welche gebaute E-Nummer in keiner Rangliste steht.

WARUM ES DAS GIBT (24.08.2026): `BACKLOG.md` ist die einzige Stelle, an der
eine E-Nummer mit Zustand (OFFEN/FERTIG/…) steht — `tools/backlog-status-schau.py`
zaehlt 232 Statuszellen daraus. Die Kopfzeile des Dokuments sagt „E55 bis E74
am Ende dieses Dokuments". Gemessen an den Commits sind seither NEUN weitere
Nummern ausgeliefert worden, und neun davon stehen in keiner Tabelle:
E75, E76, E80, E81, E82, E85, E86, E89, E90.

Keine der vorhandenen Wachen konnte das sehen, und der Grund ist lehrreich:
`tools/doku-luecken-probe.sh` haelt den BAUM gegen die Handbuecher — Plugins,
Rechte, Endpunkte, Ablagen. Eine E-Nummer liegt aber nicht im Baum. Sie
entsteht in einer Commit-Nachricht und stirbt dort, wenn niemand sie
eintraegt. Wer nach der naechsten Aufgabe sucht, liest deshalb ein
Verzeichnis, dem die letzten zwei Wochen fehlen — genau der Fehler, den der
Abgleich vom 04.08. schon einmal beschrieb („in diesem Projekt veraltet ein
Backlog nicht durch Nachlaessigkeit, sondern durch Tempo").

WAS ALS „GEBAUT" ZAEHLT: eine Commit-BETREFFZEILE, die mit der Nummer
ANFAENGT (`E85: …`, `E86/2: …`, `E78-Nachtrag: …`). Nicht jede Erwaehnung —
sonst zaehlte jeder Doku-Lauf mit, der eine Nummer im Nebensatz nennt, und
die Wache meldete Nummern, die nie eine Auslieferung waren.

WAS SIE NICHT KANN: sie prueft NUR, ob die Nummer irgendwo in `BACKLOG.md`
vorkommt. Eine Zeile, die E85 nennt und Falsches darueber sagt, faellt hier
nicht auf — dagegen hilft nur Lesen (dieselbe Grenze wie bei
`doku-luecken-probe.sh`).

GEGENPROBE EINGEBAUT: findet sie GAR KEINE E-Commits, meldet sie eine
Warnung statt gruen. Eine Wache, die ein umbenanntes Nachrichtenformat
ueberlebt, ist keine (llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/e-register-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
REGISTER = WURZEL / "BACKLOG.md"

# Die Nummer MUSS die Betreffzeile eroeffnen; danach darf `/2`, `-Nachtrag`,
# `b` oder ein Doppelpunkt folgen.
BETREFF = re.compile(r"^E(\d{2,3})\b")


def gebaute_nummern() -> dict[str, str]:
    """Nummer -> juengster Commit, dessen Betreff mit ihr anfaengt."""
    roh = subprocess.run(
        ["git", "-C", str(WURZEL), "log", "--format=%h%x09%s"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    gefunden: dict[str, str] = {}
    for zeile in roh.splitlines():
        if "\t" not in zeile:
            continue
        kurz, betreff = zeile.split("\t", 1)
        treffer = BETREFF.match(betreff)
        if treffer:
            gefunden.setdefault(treffer.group(1), kurz)
    return gefunden


def main() -> int:
    nummern = gebaute_nummern()
    print("── Gebaute E-Nummern, die BACKLOG.md nicht kennt ──")
    if not nummern:
        print("  WARNUNG: keine einzige Commit-Betreffzeile beginnt mit einer")
        print("  E-Nummer — hat sich das Nachrichtenformat geaendert?")
        return 1
    if not REGISTER.exists():
        print(f"  WARNUNG: {REGISTER.name} fehlt.")
        return 1

    text = REGISTER.read_text(encoding="utf-8")
    luecken = 0
    for nr in sorted(nummern, key=int):
        if not re.search(rf"\bE{nr}\b", text):
            print(f"  FEHLT: E{nr} (ausgeliefert in {nummern[nr]})")
            luecken += 1

    print(f"\n{luecken} LUECKE(N) — {len(nummern)} gebaute Nummern geprueft.")
    return 1 if luecken else 0


if __name__ == "__main__":
    sys.exit(main())
