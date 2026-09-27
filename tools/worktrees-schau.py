#!/usr/bin/env python3
"""Was liegt in den Arbeitsbaeumen — und was davon fehlt in main?

    python3 tools/worktrees-schau.py

WOZU ES DAS GIBT (19.08.2026)
Sitzungen dieses Projekts arbeiten in eigenen Arbeitsbaeumen unter
`.claude/worktrees/`. Sie committen dort auf einen eigenen Zweig — und
niemand fuehrt Buch, ob diese Commits je in `main` ankommen. Beim Nachsehen
lagen ACHT Baeume herum, 3,4 GB, und darin DREI Commits, die es nie nach
main geschafft hatten:

    E46 "Die drei ??? und Die drei !!! trennen sich"   (fertig, 85 min alt)
    "Eine frische Karte lief unter pm2 ..."            (5 Tage)
    "Eine Quelle statt Zwillinge ..."                  (6 Tage)

Der erste war die Antwort auf einen Fehler, den die Inventur desselben Tages
als „hoch" eingestuft hatte. Er war fertig gebaut, gemessen und committet —
und wirkte nirgends.

WAS ES MELDET, in dieser Reihenfolge:
    FEHLT IN MAIN   Commits auf dem Zweig, die main nicht hat. Der Kern.
    UNCOMMITTET     Aenderungen, die noch nicht einmal einen Commit haben.
    UNBERUEHRT      wie lange der Baum schon still liegt.

WAS ES NICHT TUT: aufraeumen. Ein Baum kann fuer eine laufende Sitzung
gehoeren; `git worktree remove` mitten hinein kostet genau die Arbeit, die
dieses Werkzeug sichtbar machen soll. Es zeigt, du entscheidest.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAEUME = os.path.join(WURZEL, ".claude", "worktrees")


def git(pfad, *args, standard=""):
    """Ein git-Aufruf in einem Baum. Leer statt Absturz, wenn etwas fehlt."""
    try:
        e = subprocess.run(
            ["git", *args],
            cwd=pfad,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return e.stdout.strip() if e.returncode == 0 else standard
    except (subprocess.TimeoutExpired, OSError):
        return standard


def alter(iso):
    """„vor 5 Tagen" aus einem ISO-Datum — ohne Fremdpaket."""
    if not iso:
        return "?"
    try:
        d = datetime.fromisoformat(iso)
    except ValueError:
        return "?"
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    s = (datetime.now(timezone.utc) - d).total_seconds()
    if s < 3600:
        return f"vor {int(s // 60)} min"
    if s < 86400:
        return f"vor {int(s // 3600)} h"
    return f"vor {int(s // 86400)} Tagen"


def groesse(pfad):
    """Belegter Platz, menschenlesbar. `du` statt os.walk: schneller."""
    e = subprocess.run(["du", "-sh", pfad], capture_output=True, text=True)
    return e.stdout.split("\t")[0] if e.returncode == 0 else "?"


def main():
    if not os.path.isdir(BAEUME):
        print("Keine Arbeitsbaeume unter .claude/worktrees/ — nichts zu zeigen.")
        return 0

    baeume = sorted(
        os.path.join(BAEUME, n) for n in os.listdir(BAEUME) if os.path.isdir(os.path.join(BAEUME, n))
    )
    if not baeume:
        print("Keine Arbeitsbaeume — nichts zu zeigen.")
        return 0

    befunde = []
    print(f"{len(baeume)} Arbeitsbaeume unter .claude/worktrees/\n")

    for pfad in baeume:
        name = os.path.basename(pfad)
        zweig = git(pfad, "branch", "--show-current") or "(losgeloest)"
        # `main..HEAD` = was auf diesem Zweig steht und main NICHT hat.
        offen = [z for z in git(pfad, "log", "main..HEAD", "--format=%h\t%cI\t%s").splitlines() if z]
        stand = [z for z in git(pfad, "status", "--short").splitlines() if z]
        geaendert = [z for z in stand if not z.startswith("??")]
        neu = [z for z in stand if z.startswith("??")]
        letzte = git(pfad, "log", "-1", "--format=%cI")

        marke = "  " if not (offen or geaendert) else "! "
        print(f"{marke}{name}")
        print(f"    Zweig {zweig}   {groesse(pfad)}   letzter Commit {alter(letzte)}")

        if offen:
            print(f"    FEHLT IN MAIN — {len(offen)} Commit(s):")
            for z in offen:
                teile = z.split("\t")
                if len(teile) == 3:
                    print(f"      {teile[0]}  {alter(teile[1]):<14} {teile[2][:66]}")
            befunde.append(f"{name}: {len(offen)} Commit(s) nicht in main")

        if geaendert:
            print(f"    UNCOMMITTET — {len(geaendert)} Datei(en):")
            for z in geaendert[:6]:
                print(f"      {z}")
            if len(geaendert) > 6:
                print(f"      … und {len(geaendert) - 6} weitere")
            befunde.append(f"{name}: {len(geaendert)} Datei(en) uncommittet")

        if neu:
            print(f"    unversioniert: {len(neu)} Datei(en)")
        if not (offen or geaendert):
            print("    sauber — nichts geht verloren")
        print()

    print("─" * 72)
    if befunde:
        print("ES FEHLT ETWAS:")
        for b in befunde:
            print(f"  * {b}")
        print(
            "\nEin Commit, den main nicht hat, WIRKT NIRGENDS — er liegt nur da.\n"
            "Ueberfuehren mit:  git merge <zweig>   oder   git cherry-pick <hash>\n"
            "Danach den Baum abraeumen:  git worktree remove <pfad>"
        )
        return 1
    print("Alle Arbeitsbaeume sind sauber und in main aufgegangen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
