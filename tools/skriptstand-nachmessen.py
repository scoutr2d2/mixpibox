#!/usr/bin/env python3
"""Gegenprobe zu tools/baum-gegen-box.py: WARUM weicht eine Skriptdatei ab?

Der Fund vom 07.08.2026 sagte: 26 von 91 Skriptdateien stimmen nicht mit der
Box ueberein, und alle 10 inhaltlich abweichenden seien Reparaturen dieser
Woche — also erreiche keine Reparatur unter scripts/ das Geraet.

Ein Zaehlwert allein traegt das nicht. Dieses Werkzeug fragt fuer JEDE Datei
zusaetzlich:

  * Ist die Datei im Baum ueberhaupt eingecheckt, oder liegt sie nur als
    unfestgeschriebene Aenderung da? (Dann ist "nicht auf der Box" kein
    Ausrollfehler, sondern schlicht noch nicht fertig.)
  * Traegt die Box eine AELTERE Fassung GENAU DIESER Datei aus der Geschichte?
    Dann gibt es einen Weg, er hinkt nur hinterher.
  * Traegt die Box eine Fassung, die in der Geschichte NIE vorkam? Dann wird
    die Datei beim Einrichten veraendert (Vorlage, sed) und ein sha256-
    Vergleich kann per Bauart nie "gleich" melden.
  * Gibt es den Dateinamen an MEHREREN Zielorten? Dann ist ein Vergleich ueber
    den blossen Basisnamen mehrdeutig.

NUR LESEND auf der Box (ein einziges find/sha256sum ueber drei Verzeichnisse).

    python3 tools/skriptstand-nachmessen.py
    python3 tools/skriptstand-nachmessen.py --seit 2026-08-01
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BOX_VORGABE = "dietpi@192.168.178.169"
ZIELORTE = ["/usr/local/bin/mupibox", "/usr/local/bin", "/opt/mupibox-tools"]
UEBERGEHEN = {"__pycache__", "templates"}


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(WURZEL), *args],
                       capture_output=True, text=True)
    return p.stdout


def baumdateien() -> list[Path]:
    aus = []
    for p in sorted((WURZEL / "scripts").rglob("*")):
        if not p.is_file() or any(t in UEBERGEHEN for t in p.parts):
            continue
        if p.suffix in (".pyc", ".c"):
            continue
        aus.append(p)
    return aus


def summe_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def box_summen(box: str) -> dict[str, list[tuple[str, str]]]:
    """Basisname -> [(vollpfad, sha256), ...] — MEHRERE Treffer bleiben sichtbar."""
    orte = " ".join(ZIELORTE)
    befehl = (f"for d in {orte}; do [ -d $d ] && find $d -maxdepth 1 -type f "
              f"-exec sha256sum {{}} + ; done 2>/dev/null")
    p = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                        box, befehl], capture_output=True, text=True, timeout=180)
    if p.returncode != 0:
        print(f"FEHLER: Box nicht erreichbar ({box}): {p.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    aus: dict[str, list[tuple[str, str]]] = {}
    for zeile in p.stdout.splitlines():
        teile = zeile.split(None, 1)
        if len(teile) != 2:
            continue
        h, pfad = teile
        aus.setdefault(Path(pfad).name, []).append((pfad, h))
    return aus


def geschichte(rel: str, grenze: int = 60) -> list[tuple[str, str, str]]:
    """[(sha256, commit, datum)] aller Fassungen dieser Datei, neueste zuerst."""
    zeilen = git("log", "--format=%H %ad", "--date=short", "-n", str(grenze),
                 "--", rel).splitlines()
    aus = []
    for z in zeilen:
        if not z.strip():
            continue
        commit, datum = z.split(None, 1)
        p = subprocess.run(["git", "-C", str(WURZEL), "show", f"{commit}:{rel}"],
                           capture_output=True)
        if p.returncode == 0:
            aus.append((summe_bytes(p.stdout), commit[:8], datum.strip()))
    return aus


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default=BOX_VORGABE)
    ap.add_argument("--seit", default="2026-08-01")
    a = ap.parse_args()

    geaendert = {z for z in git("log", f"--since={a.seit}", "--name-only",
                                "--pretty=format:").splitlines()
                 if z.startswith("scripts/")}
    schmutzig = {z[3:] for z in git("status", "--porcelain", "--", "scripts").splitlines()}

    auf_box = box_summen(a.box)
    schubladen: dict[str, list[str]] = {}

    def ablegen(art: str, text: str) -> None:
        schubladen.setdefault(art, []).append(text)

    for p in baumdateien():
        rel = str(p.relative_to(WURZEL))
        neu = rel in geaendert
        marke = "*" if neu else " "
        treffer = auf_box.get(p.name, [])
        eigen = summe_bytes(p.read_bytes())

        if not treffer:
            ablegen("nicht auf der Box", f"{marke} {rel}")
            continue
        if len(treffer) > 1:
            marke += "!"
        if any(h == eigen for _, h in treffer):
            ablegen("gleich", f"{marke} {rel}")
            continue

        # Abweichend: woher kommt die Fassung auf der Box?
        gesch = geschichte(rel)
        bekannt = {h: (c, d) for h, c, d in gesch}
        quelle = next((bekannt[h] for _, h in treffer if h in bekannt), None)
        offen = " (nicht festgeschrieben)" if rel in schmutzig else ""
        if quelle:
            ablegen("abweichend, Box traegt AELTERE Fassung",
                    f"{marke} {rel}{offen}  Box = {quelle[0]} vom {quelle[1]}")
        else:
            ablegen("abweichend, Box-Fassung kommt in der Geschichte NIE vor",
                    f"{marke} {rel}{offen}")

    print(f"Baum: {len(baumdateien())} Dateien unter scripts/   "
          f"(* = seit {a.seit} veraendert, ! = Name an mehreren Zielorten)")
    print()
    for art in ("gleich", "abweichend, Box traegt AELTERE Fassung",
                "abweichend, Box-Fassung kommt in der Geschichte NIE vor",
                "nicht auf der Box"):
        zeilen = schubladen.get(art, [])
        neue = sum(1 for z in zeilen if z.lstrip().startswith("*") or z.startswith("*"))
        print(f"── {art}: {len(zeilen)}  (davon seit {a.seit} veraendert: {neue})")
        for z in sorted(zeilen):
            print(f"   {z}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
