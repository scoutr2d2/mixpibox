#!/usr/bin/env python3
"""Wie viele Album-Cover der Box sind in Wahrheit das Rueckfallbild?

WARUM ES DIESES WERKZEUG GIBT (06.09.2026): Der Betreiber meldete zum zweiten
Mal fehlende Titelbilder („Conni backt", „101 Wichtel"). Beim ersten Mal hatte
ich die Kette gemessen und fuer heil erklaert:

    /api/bild/lokal:t:conni|conni backt pizza …   302
    /cover/audiobook/Conni/Conni backt …/cover.jpg  200  image/jpeg  58289 B

Alles gruen — und trotzdem war kein Cover da. Die 58289 Bytes WAREN der
Fehler: es ist `www/neu/bilder/mixpi-spielt.png`, das Maskottchen, das
`m3u_generator.sh` als Rueckfall unter dem Namen `cover.jpg` ablegt, wenn im
Medienordner kein Bild liegt. Ab da ist die Datei echt, der Inhaltstyp
stimmt, der Status ist 200 — und nichts im ganzen Baum meldet noch etwas.

DIE STUFE DAVOR IST SCHON GESCHLOSSEN: `tools/bilder-wirklich-da.py` (15.08.)
faengt den Fall „200, aber text/html". Der hier faengt den naechsten: „200,
image/jpeg, und trotzdem kein Cover". Ein Rueckfall, der GUELTIG AUSSIEHT,
macht den Fehler unsichtbar — deshalb muss man ihn benennen und zaehlen
koennen, statt ihn an der Kachel zu erraten.

WAS GEMESSEN WIRD: fuer jeden Album-Ordner unter `media/<kategorie>/` das
ausgelieferte Cover unter `www/cover/<kategorie>/<interpret>/<titel>/`, und
ob dessen Pruefsumme die des Rueckfallbildes ist. Gemeldet wird die Bilanz
und, mit --liste, jedes betroffene Album.

Aufruf:
    python3 tools/cover-platzhalter-probe.py --box dietpi@192.168.178.81
    python3 tools/cover-platzhalter-probe.py --box … --liste
    python3 tools/cover-platzhalter-probe.py --wurzel /pfad/zum/sandkasten
"""
from __future__ import annotations

import argparse
import hashlib
import shlex
import subprocess
import sys
from pathlib import Path

MEDIEN = "/home/dietpi/MuPiBox/media"
WWW = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"
# Die Rueckfaelle, die m3u_generator.sh kennt (LOGO und seine Ersatzwahl).
# BEIDE, nicht nur der aktuelle: eine Box, die aelter ist als der Wechsel vom
# 20.08.2026, traegt noch die MuPiLogo.jpg als Platzhalter.
RUECKFAELLE = ("neu/bilder/mixpi-spielt.png",)
FREMDE_RUECKFAELLE = ("/home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg",)
KATEGORIEN = ("audiobook", "music", "other")


def lauf(befehl: list[str], box: str | None) -> str:
    """Einen Befehl ausfuehren — auf der Box, wenn eine genannt ist."""
    if box:
        befehl = ["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", box, shlex.join(befehl)]
    fertig = subprocess.run(befehl, capture_output=True, text=True, timeout=180)
    return fertig.stdout


def summen(box: str | None, wurzel: str) -> dict[str, str]:
    """Pruefsumme je Datei unter `wurzel` — ein Gang, nicht einer je Datei."""
    roh = lauf(["find", wurzel, "-type", "f", "-name", "cover.jpg", "-exec", "md5sum", "{}", ";"], box)
    ergebnis: dict[str, str] = {}
    for zeile in roh.splitlines():
        teil = zeile.split("  ", 1)
        if len(teil) == 2:
            ergebnis[teil[1]] = teil[0]
    return ergebnis


def rueckfall_summen(box: str | None, www: str) -> set[str]:
    """Die Pruefsummen der Bilder, die als Rueckfall dienen."""
    pfade = [f"{www}/{p}" for p in RUECKFAELLE] + list(FREMDE_RUECKFAELLE)
    roh = lauf(["md5sum", *pfade], box)
    return {z.split("  ", 1)[0] for z in roh.splitlines() if "  " in z}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", help="ssh-Ziel, z. B. dietpi@192.168.178.81")
    p.add_argument("--medien", default=MEDIEN, help=f"Medienwurzel (Vorgabe: {MEDIEN})")
    p.add_argument("--www", default=WWW, help=f"www-Ordner der Box (Vorgabe: {WWW})")
    p.add_argument("--liste", action="store_true", help="jedes betroffene Album nennen")
    a = p.parse_args()

    rueck = rueckfall_summen(a.box, a.www)
    if not rueck:
        print("FEHLER: kein Rueckfallbild gefunden — dann ist nichts zu vergleichen.", file=sys.stderr)
        print(f"        Gesucht wurde unter {a.www}/{RUECKFAELLE[0]}", file=sys.stderr)
        return 2

    ausgeliefert = summen(a.box, f"{a.www}/cover")
    # Die Album-Ordner nennen, nicht die Cover: gesucht wird ja gerade das
    # Album, dem eins FEHLT.
    # TIEFE DREI, nicht zwei: unter `media` steht zuerst die KATEGORIE
    # (audiobook/music/other), dann der Interpret, dann das Album. Zwei traefe
    # die Interpreten-Ebene — die hat nie ein Album-Cover, und die Probe
    # meldete dann jedes Regal als „gar keins".
    roh = lauf(["find", a.medien, "-mindepth", "3", "-maxdepth", "3", "-type", "d"], a.box)
    alben = [z for z in roh.splitlines() if z.strip()]
    if not alben:
        print(f"Unter {a.medien} liegen keine Alben — nichts zu pruefen.")
        return 0

    platzhalter: list[str] = []
    echt = 0
    ohne = 0
    for ordner in alben:
        rest = ordner[len(a.medien) :].lstrip("/")
        if not rest:
            continue
        kategorie = rest.split("/", 1)[0]
        if kategorie not in KATEGORIEN:
            continue
        ziel = f"{a.www}/cover/{rest}/cover.jpg"
        summe = ausgeliefert.get(ziel)
        if summe is None:
            ohne += 1
        elif summe in rueck:
            platzhalter.append(rest)
        else:
            echt += 1

    gesamt = echt + ohne + len(platzhalter)
    print(f"{gesamt} Alben geprueft")
    print(f"  echtes Cover : {echt}")
    print(f"  Rueckfallbild: {len(platzhalter)}")
    print(f"  gar keins    : {ohne}")
    if a.liste and platzhalter:
        print("\nDiese Alben zeigen das Rueckfallbild:")
        for x in sorted(platzhalter):
            print(f"  {x}")
    if platzhalter:
        print(f"\nFUND: {len(platzhalter)} Alben liefern ein gueltiges Bild, das kein Cover ist.")
        print("      Ihr Medienordner traegt keine Bilddatei; m3u_generator.sh legt")
        print("      deshalb das Maskottchen als cover.jpg ab (Zeile 161/162).")
        print("      Status und Inhaltstyp sind dabei einwandfrei — deshalb faellt es")
        print("      keiner Messung auf, die nur diese beiden ansieht.")
        return 1
    print("\nKein Album zeigt das Rueckfallbild.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
