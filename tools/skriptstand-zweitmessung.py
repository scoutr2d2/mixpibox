#!/usr/bin/env python3
"""Zweitmessung zum Skriptstand — bewusst DUMM, damit sie unabhaengig ist.

WOZU NOCH EIN WERKZEUG. Es gibt schon zwei, die dasselbe Feld vermessen:
`tools/baum-gegen-box.py` (zaehlt) und `tools/skriptstand-nachmessen.py`
(fragt, WOHER die Fassung auf der Box stammt). Der Befund „26 von 91" und die
Bauart des fuenften Ziels in `tools/ausliefern.py` stuetzen sich auf beide.
Genau deshalb taugt keines von ihnen als Gegenprobe fuer sich selbst.

Dieses hier weiss ABSICHTLICH NICHTS: keine Zuordnungstabelle, keine
Ausnahmeliste, keine Geschichte. Es nimmt jede Datei unter `scripts/` (ohne
__pycache__), sucht sie an den drei Orten ueber den blossen BASISNAMEN und
vergleicht sha256. Wenn eine Datei nur deshalb als „gleich" gilt, weil eine
Tabelle sie irgendwohin zeigt, faellt das hier auf.

Der Preis dieser Dummheit steht im Bericht statt im Verborgenen: Dateien, die
gar nicht auf die Box gehoeren (README.md, led_control.c, templates/), tauchen
unter „NICHT DA" mit auf. Sie sind kein Fehler, sondern der Grund, warum die
Zahlen der drei Werkzeuge sich um ein paar Stellen unterscheiden duerfen.

Am 08.08.2026 gemessen: gleich 65 · ANDERS 10 · und die zehn Namen decken sich
mit dem Befund. Die Zahlen wandern, solange andere Laeufe scripts/ anfassen.

  python3 tools/skriptstand-zweitmessung.py            # Bericht
  python3 tools/skriptstand-zweitmessung.py --json     # maschinenlesbar

NUR LESEND. Ein einziger ssh-Aufruf, kein Schreiben, kein Dienst angefasst.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BOX = "dietpi@192.168.178.169"
ORTE = ["/usr/local/bin/mupibox", "/usr/local/bin", "/opt/mupibox-tools"]
UEBERGEHEN = {"__pycache__"}


def baumdateien() -> dict[str, Path]:
    """Basisname -> Pfad. Doppelte Basisnamen werden gemeldet, nicht verschluckt."""
    gefunden: dict[str, Path] = {}
    doppelt: list[str] = []
    for p in sorted((WURZEL / "scripts").rglob("*")):
        if not p.is_file():
            continue
        if any(teil in UEBERGEHEN for teil in p.parts):
            continue
        if p.name in gefunden:
            doppelt.append(p.name)
        gefunden[p.name] = p
    if doppelt:
        print(f"ACHTUNG doppelte Basisnamen im Baum: {doppelt}", file=sys.stderr)
    return gefunden


def boxstand() -> dict[str, dict]:
    """Basisname -> {ort, sha, rechte, eigner}. Erster Treffer in ORTE gewinnt."""
    # ACHTUNG: `stat -c "%a\t..."` gibt ein LITERALES \t aus (stat kennt die
    # Ersetzung nicht, printf schon). Genau daran hat dieses Werkzeug beim
    # ersten Lauf still 94 mal „nicht da" gemeldet. Deshalb ein Trennzeichen,
    # das kein Programm auslegt, und eine Schranke unten, die Stille aufdeckt.
    befehl = "; ".join(
        f'for f in {ort}/*; do [ -f "$f" ] && printf "%s|%s|%s\\n" "$f" '
        f'"$(sha256sum "$f" | cut -d" " -f1)" "$(stat -c "%a %U:%G" "$f")"; done'
        for ort in ORTE
    )
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", BOX, befehl],
        capture_output=True, text=True, timeout=180,
    )
    if p.returncode != 0:
        sys.exit(f"Box nicht erreichbar: {p.stderr.strip()}")
    stand: dict[str, dict] = {}
    zeilen = [z for z in p.stdout.splitlines() if z.strip()]
    for zeile in zeilen:
        teile = zeile.split("|")
        if len(teile) != 3:
            continue
        pfad, sha, rest = teile
        rechte, _, eigner = rest.partition(" ")
        name = pfad.rsplit("/", 1)[-1]
        stand.setdefault(name, {"ort": pfad, "sha": sha, "rechte": rechte, "eigner": eigner})
    # Schranke gegen das stille Nichts: wenn deutlich weniger Zeilen ankommen
    # als gelesen wurden, ist das ein Formatfehler und kein leeres Verzeichnis.
    if len(stand) < len(zeilen) * 0.9 or not stand:
        sys.exit(f"Box lieferte {len(zeilen)} Zeilen, verwertbar {len(stand)} — Abbruch.")
    return stand


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def geaendert_seit(datum: str) -> set[str]:
    p = subprocess.run(
        ["git", "log", f"--since={datum}", "--name-only", "--format=", "--", "scripts"],
        cwd=WURZEL, capture_output=True, text=True,
    )
    return {z.rsplit("/", 1)[-1] for z in p.stdout.split() if z}


def main() -> int:
    baum = baumdateien()
    box = boxstand()
    seit0108 = geaendert_seit("2026-08-01")

    gleich, anders, fehlt = [], [], []
    for name, pfad in sorted(baum.items()):
        rel = str(pfad.relative_to(WURZEL))
        if name not in box:
            fehlt.append(rel)
        elif box[name]["sha"] == sha256(pfad):
            gleich.append(rel)
        else:
            anders.append(rel)

    fremd = sorted(set(box) - set(baum))

    befund = {
        "baum_gesamt": len(baum),
        "gleich": len(gleich),
        "anders": len(anders),
        "fehlt": len(fehlt),
        "anders_dateien": anders,
        "anders_davon_seit_0108_geaendert": sorted(
            r for r in anders if r.rsplit("/", 1)[-1] in seit0108),
        "fehlt_dateien": fehlt,
        "box_fremd": fremd,
        "rechte_verteilung": {},
        "eigner_verteilung": {},
    }
    for name in baum:
        if name in box:
            b = box[name]
            befund["rechte_verteilung"][b["rechte"]] = \
                befund["rechte_verteilung"].get(b["rechte"], 0) + 1
            befund["eigner_verteilung"][b["eigner"]] = \
                befund["eigner_verteilung"].get(b["eigner"], 0) + 1

    if "--json" in sys.argv:
        print(json.dumps(befund, indent=2, ensure_ascii=False))
        return 0

    print(f"Baum scripts/ (ohne __pycache__): {befund['baum_gesamt']} Dateien")
    print(f"  gleich {befund['gleich']} · ANDERS {befund['anders']} · "
          f"NICHT DA {befund['fehlt']}")
    print(f"  weichen ab: {befund['anders'] + befund['fehlt']}")
    print(f"\nANDERS ({len(anders)}):")
    for r in anders:
        marke = "seit 01.08. geaendert" if r.rsplit("/", 1)[-1] in seit0108 else "AELTER"
        print(f"  {r:55s} {marke}")
    print(f"\nNICHT AUF DER BOX ({len(fehlt)}):")
    for r in fehlt:
        print(f"  {r}")
    print(f"\nAuf der Box, nicht im Baum ({len(fremd)}):")
    for n in fremd:
        print(f"  {box[n]['ort']}")
    print(f"\nRechte am Ziel: {befund['rechte_verteilung']}")
    print(f"Eigentuemer:    {befund['eigner_verteilung']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
