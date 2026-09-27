#!/usr/bin/env python3
"""
NUR DIE EIGENEN AENDERUNGEN EINER DATEI IN DEN INDEX LEGEN.

WOZU: An diesem Baum arbeitet mehr als einer gleichzeitig. Am 03.08.2026 lagen
in tools/neu-vorschau.mjs und tools/pruefen.sh Aenderungen von ZWEI Vorgaengen
uebereinander — eine zur Kinderzeit, eine zur Interpreten-Reihe. `git add
<datei>` haette die fremde, halbfertige Arbeit mit eingesammelt und in einer
Nachricht beschrieben, die von ihr nichts weiss. `git add -i`/`-p` gibt es
hier nicht (keine Eingabe moeglich).

Dieses Werkzeug schneidet aus `git diff <datei>` die Hunks heraus, die man
selbst verantwortet, und legt NUR sie in den Index (`git apply --cached`). Der
Arbeitsbaum bleibt unberuehrt — die fremde Aenderung steht danach weiter da
und gehoert weiter dem anderen Vorgang.

DIE HUNKS WERDEN UEBER IHRE ALTE ANFANGSZEILE BENANNT, also die Zahl hinter
dem Minus in `@@ -203,6 +234,27 @@`. Sie ist stabil, solange HEAD sich nicht
bewegt — und genau so lange dauert ein Commit.

AUFRUF
    # erst ansehen, welche Hunks es gibt:
    python3 tools/eigene-hunks.py tools/neu-vorschau.mjs --zeigen

    # dann die eigenen benennen (alte Anfangszeilen, durch Komma getrennt):
    python3 tools/eigene-hunks.py tools/neu-vorschau.mjs 203,210,233,559,572

FALLE: Danach steht die Datei sowohl im Index (der eigene Teil) als auch im
Arbeitsbaum (alles). `git commit` OHNE `-a` schreibt den Index — genau das ist
gewollt. Ein `git commit -a` machte die ganze Muehe zunichte.
"""

import re
import subprocess
import sys


def diff_holen(datei: str) -> str:
    return subprocess.run(
        ["git", "diff", "--", datei], capture_output=True, text=True, check=True
    ).stdout


def zerlegen(diff: str):
    """(kopf, [(alte_anfangszeile, hunktext), ...])"""
    zeilen = diff.splitlines(keepends=True)
    kopf, hunks, jetzt, nr = [], [], None, None
    for z in zeilen:
        t = re.match(r"^@@ -(\d+)", z)
        if t:
            if jetzt is not None:
                hunks.append((nr, "".join(jetzt)))
            nr, jetzt = int(t.group(1)), [z]
        elif jetzt is None:
            kopf.append(z)
        else:
            jetzt.append(z)
    if jetzt is not None:
        hunks.append((nr, "".join(jetzt)))
    return "".join(kopf), hunks


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    datei = sys.argv[1]
    diff = diff_holen(datei)
    if not diff.strip():
        print(f"  {datei}: keine Aenderung")
        return 0
    kopf, hunks = zerlegen(diff)

    if sys.argv[2] == "--zeigen":
        for nr, text in hunks:
            # Die erste geaenderte Zeile sagt mehr als die Zahl allein.
            probe = next(
                (
                    z.strip()
                    for z in text.splitlines()[1:]
                    if z[:1] in "+-" and z[1:].strip()
                ),
                "",
            )
            print(f"  {nr:>6}  {probe[:96]}")
        return 0

    gewollt = {int(x) for x in sys.argv[2].split(",") if x.strip()}
    unbekannt = gewollt - {nr for nr, _ in hunks}
    if unbekannt:
        # NICHT STILL UEBERGEHEN: Wer sich in der Zahl vertut, bekaeme sonst
        # einen Commit, in dem seine Aenderung schlicht fehlt — und merkt es
        # erst, wenn jemand anders daran scheitert.
        print(f"  FEHLER: keine Hunks mit alter Anfangszeile {sorted(unbekannt)}")
        return 1

    teil = kopf + "".join(t for nr, t in hunks if nr in gewollt)
    p = subprocess.run(
        ["git", "apply", "--cached", "--unidiff-zero", "-"],
        input=teil,
        text=True,
        capture_output=True,
    )
    if p.returncode:
        print(f"  FEHLER beim Anlegen: {p.stderr.strip()}")
        return 1
    print(f"  {datei}: {len(gewollt)} von {len(hunks)} Hunks im Index")
    return 0


if __name__ == "__main__":
    sys.exit(main())
