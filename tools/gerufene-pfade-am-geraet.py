#!/usr/bin/env python3
"""Jeder fest verdrahtete Geraetepfad im Baum — liegt dort auf der Box wirklich etwas?

WOZU (Muster A + B)
Der Abspieldienst, der Server, der PHP-Admin und die Units rufen Skripte ueber
ABSOLUTE Pfade auf (`/usr/local/bin/mupibox/…`). Der Pfad steht im Aufrufer,
die Datei entsteht im Ausrollweg — ZWEI Orte fuer EINE Wahrheit, von Hand
gleichgehalten. Faellt eine auseinander, meldet niemand etwas:
`exec()` im PHP wirft die Ausgabe weg, `cmdCall()` im Abspieldienst loggt
hoechstens, und der Knopf sieht aus, als haette er gewirkt.

Dieses Werkzeug liest ALLE solchen Pfade aus dem Baum und fragt die Box, ob
dort etwas liegt. NUR LESEND.

    python3 tools/gerufene-pfade-am-geraet.py
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BOX_VORGABE = "dietpi@192.168.178.169"

# Wo gesucht wird. node_modules und der Bauordner bleiben draussen.
BAEUME = ["src", "AdminInterface", "config", "autosetup", "scripts", "NewDesign", "update"]

MUSTER = re.compile(
    r"(/usr/local/bin/mupibox/|/usr/local/bin/|/opt/mupibox-tools/)\.?/?"
    r"([a-zA-Z0-9_.-]+\.(?:sh|py))"
)


def fundstellen() -> dict[str, list[str]]:
    """pfad -> Liste 'datei:zeile'"""
    aus: dict[str, list[str]] = {}
    for baum in BAEUME:
        wurzel = WURZEL / baum
        if not wurzel.is_dir():
            continue
        for p in wurzel.rglob("*"):
            if not p.is_file() or "node_modules" in p.parts or "__pycache__" in p.parts:
                continue
            if p.suffix in (".pyc", ".png", ".jpg", ".zip", ".gz", ".woff2", ".ttf"):
                continue
            try:
                text = p.read_text(errors="ignore")
            except OSError:
                continue
            for nr, zeile in enumerate(text.splitlines(), 1):
                for m in MUSTER.finditer(zeile):
                    pfad = m.group(1).rstrip("/") + "/" + m.group(2)
                    aus.setdefault(pfad, []).append(f"{p.relative_to(WURZEL)}:{nr}")
    return aus


def box_pruefen(box: str, pfade: list[str]) -> set[str]:
    """Menge der Pfade, die auf der Box existieren."""
    liste = " ".join(f"'{p}'" for p in pfade)
    befehl = f"for f in {liste}; do [ -e \"$f\" ] && echo \"$f\"; done"
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", box, befehl],
        capture_output=True, text=True, timeout=120,
    )
    if p.returncode not in (0, 1):
        print(f"FEHLER: Box nicht erreichbar: {p.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return set(p.stdout.split())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default=BOX_VORGABE)
    a = ap.parse_args()

    stellen = fundstellen()
    pfade = sorted(stellen)
    da = box_pruefen(a.box, pfade)
    fehlend = [p for p in pfade if p not in da]

    print(f"{len(pfade)} verschiedene Geraetepfade im Baum gerufen, "
          f"aus {sum(len(v) for v in stellen.values())} Fundstellen.")
    print(f"  vorhanden auf der Box   {len(da):3d}")
    print(f"  ZEIGT INS LEERE         {len(fehlend):3d}")
    print()
    for p in fehlend:
        print(f"  {p}")
        for s in sorted(set(stellen[p])):
            print(f"      {s}")
    return 1 if fehlend else 0


if __name__ == "__main__":
    sys.exit(main())
