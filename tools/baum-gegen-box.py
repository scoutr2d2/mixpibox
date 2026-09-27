#!/usr/bin/env python3
"""Vergleicht JEDE Skriptdatei im Baum mit der Datei, die auf der Box wirklich liegt.

WOZU (Muster A: AUSGELIEFERT, ABER NICHT DA)
tools/ausliefern.py kennt genau vier Ziele: server, player, www, admin.
`scripts/` ist KEINES davon. Wer eine Datei unter scripts/ repariert, hat sie
im Baum repariert — auf der Box liegt weiter die alte. Der einzige Weg dorthin
ist autosetup.sh (frische Karte) oder update/start_mupibox_update.sh (Update).
Beides laeuft nachts nicht.

Dieses Werkzeug fragt fuer jede Datei: liegt sie auf der Box, und ist sie
GLEICH? Es misst ueber sha256, nicht ueber Zeitstempel.

NUR LESEND. Es schreibt nichts auf die Box.

    python3 tools/baum-gegen-box.py
    python3 tools/baum-gegen-box.py --box dietpi@192.168.178.169
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BOX_VORGABE = "dietpi@192.168.178.169"

# Wohin die Wege unter scripts/ kopieren. Abgelesen aus autosetup/autosetup.sh
# und update/start_mupibox_update.sh (cp-Zeilen) sowie aus den ExecStart der
# Units auf der Box.
ZIELORTE = [
    "/usr/local/bin/mupibox",
    "/usr/local/bin",
    "/opt/mupibox-tools",
]

UEBERGEHEN = {"__pycache__", "templates"}


def baumdateien() -> list[Path]:
    aus = []
    for p in sorted((WURZEL / "scripts").rglob("*")):
        if not p.is_file():
            continue
        if any(t in UEBERGEHEN for t in p.parts):
            continue
        if p.suffix in (".pyc", ".c"):
            continue
        aus.append(p)
    return aus


def summe(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def box_summen(box: str) -> dict[str, str]:
    """name -> sha256, fuer alle Dateien an allen Zielorten."""
    orte = " ".join(ZIELORTE)
    befehl = (
        f"for d in {orte}; do "
        f"[ -d $d ] && find $d -maxdepth 1 -type f -exec sha256sum {{}} + ; "
        f"done 2>/dev/null"
    )
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", box, befehl],
        capture_output=True, text=True, timeout=120,
    )
    if p.returncode != 0:
        print(f"FEHLER: Box nicht erreichbar ({box}): {p.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    aus: dict[str, str] = {}
    for zeile in p.stdout.splitlines():
        teile = zeile.split(None, 1)
        if len(teile) != 2:
            continue
        h, pfad = teile
        aus.setdefault(Path(pfad).name, h)
    return aus


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default=BOX_VORGABE)
    a = ap.parse_args()

    dateien = baumdateien()
    auf_box = box_summen(a.box)

    gleich, anders, fehlt = [], [], []
    for p in dateien:
        rel = p.relative_to(WURZEL)
        b = auf_box.get(p.name)
        if b is None:
            fehlt.append(rel)
        elif b == summe(p):
            gleich.append(rel)
        else:
            anders.append(rel)

    print(f"Baum: {len(dateien)} Skriptdateien unter scripts/ (ohne .pyc, .c, templates)")
    print(f"Box:  {len(auf_box)} Dateien an {', '.join(ZIELORTE)}")
    print()
    print(f"  gleich          {len(gleich):3d}")
    print(f"  ANDERS          {len(anders):3d}  <- im Baum repariert, auf der Box alt")
    print(f"  GAR NICHT DA    {len(fehlt):3d}  <- erreicht diese Box nie")
    print()
    if anders:
        print("ANDERS (Inhalt weicht ab):")
        for r in anders:
            print(f"  {r}")
        print()
    if fehlt:
        print("GAR NICHT DA:")
        for r in fehlt:
            print(f"  {r}")
    return 1 if (anders or fehlt) else 0


if __name__ == "__main__":
    sys.exit(main())
