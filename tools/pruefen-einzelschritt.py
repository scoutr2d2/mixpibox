#!/usr/bin/env python3
"""PRUEFEN-EINZELSCHRITT — einen Schritt aus `tools/pruefen.sh` fahren, im echten Text.

WOFUER: die Gegenprobe „wird `pruefen.sh` rot, wenn ich den Test kaputtmache?"
(llmwiki: gegenprobe-statt-gruen-glauben). Der ganze Lauf ist dafuer oft der
falsche Weg: in einem Arbeitsbaum unter `.claude/worktrees/` fehlen alle
`node_modules`, und dann sind Dutzende npm-Schritte aus einem Grund rot, der mit
der Probe nichts zu tun hat — `npx tsx` wuerde obendrein Pakete aus dem Netz
nachladen wollen. Gebaut am 28.09.2026 fuer genau diesen Fall, beim Einhaengen
von `tools/installer-tests.py`.

WIE, und warum kein Nachbau: das Werkzeug liest `tools/pruefen.sh`, ersetzt
jede `schritt`-Zeile, die NICHT passt, durch `:` (eine Fortsetzungszeile mit
`\\` bleibt eine, damit die Folgezeilen Argumente von `:` werden) und laesst
alles andere stehen — Kopf, `schritt()`, Hilfsfunktionen, `if`-Bloecke und
den Schluss mit „N Schritt(e) gebrochen" und `exit "$FEHLER"`. Gefahren wird
also derselbe Text wie im vollen Lauf, nur ohne die uebrigen Schritte. Ein
Nachbau des Kopfes wuerde genau das NICHT pruefen: ob die eingehaengte Zeile
im echten `schritt()` rot wird.
Das `cd "$(dirname "$0")/.."` am Anfang wird auf die Wurzel festgelegt, weil
die Umformung in einer Zwischendatei ausserhalb von `tools/` liegt.

AUFRUF
    python3 tools/pruefen-einzelschritt.py "Tests des Installers"
    python3 tools/pruefen-einzelschritt.py --liste       alle Schrittnamen
Weitere Argumente hinter `--` gehen an `pruefen.sh` (z. B. `-- --box`).
Rueckgabe: die von `pruefen.sh`; 2, wenn kein Schritt passt.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
LAEUFER = WURZEL / "tools" / "pruefen.sh"
SCHRITT = re.compile(r'^(\s*)schritt\s+"([^"]+)"')
WURZELSPRUNG = 'cd "$(dirname "$0")/.." || exit 1'


def main() -> int:
    argumente = sys.argv[1:]
    weiter: list[str] = []
    if "--" in argumente:
        i = argumente.index("--")
        argumente, weiter = argumente[:i], argumente[i + 1:]
    text = LAEUFER.read_text(encoding="utf-8")
    zeilen = text.splitlines(keepends=True)
    namen = [m.group(2) for z in zeilen if (m := SCHRITT.match(z))]
    if not argumente or argumente == ["--liste"]:
        print("\n".join(namen))
        return 0 if argumente else 2
    gesucht = argumente[0]
    treffer = [n for n in namen if gesucht in n]
    if not treffer:
        print(f"kein Schritt enthaelt „{gesucht}\". --liste zeigt alle {len(namen)}.", file=sys.stderr)
        return 2
    if text.count(WURZELSPRUNG) != 1:
        print(f"der Wurzelsprung `{WURZELSPRUNG}` steht nicht genau einmal in pruefen.sh — "
              "Kopf umgebaut? Ohne ihn liefe die Zwischendatei im falschen Ordner.", file=sys.stderr)
        return 2
    neu = []
    for z in zeilen:
        m = SCHRITT.match(z)
        if m and gesucht not in m.group(2):
            neu.append(m.group(1) + (": \\\n" if z.rstrip("\n").endswith("\\") else ":\n"))
        else:
            neu.append(z)
    umgeformt = "".join(neu).replace(WURZELSPRUNG, f'cd "{WURZEL}" || exit 1', 1)
    print(f"faehrt aus {LAEUFER.relative_to(WURZEL)}: {', '.join(treffer)}", file=sys.stderr)
    with tempfile.NamedTemporaryFile("w", suffix="-pruefen.sh", encoding="utf-8") as f:
        f.write(umgeformt)
        f.flush()
        return subprocess.run(["bash", f.name, *weiter]).returncode


if __name__ == "__main__":
    sys.exit(main())
