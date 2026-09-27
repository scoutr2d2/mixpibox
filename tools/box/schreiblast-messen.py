#!/usr/bin/env python3
"""Was kostet der Mitschnitt die SD-Karte? — E28/N2, gemessen.

    python3 schreiblast-messen.py [sekunden]

Muss AUF DER BOX laufen. Misst am besten, waehrend ein Mitschnitt laeuft.

══ WORUM ES GEHT ══════════════════════════════════════════════════════════

Der Betreiber hat ein NAS als Ablage vorgeschlagen. Der Grund dafuer ist
NICHT die Kapazitaet — auf der Karte sind 221 GB frei, das reicht fuer
Hunderte Stunden. Der Grund ist der VERSCHLEISS: eine SD-Karte hat eine
begrenzte Zahl Schreibvorgaenge, und sie stirbt ohne Vorwarnung.

„Wer das NAS mit der Kapazitaet begruendet, begruendet es falsch."

Diese Messung beantwortet, was ein Mitschnitt-Abend die Karte wirklich
kostet — und ob der groesste Posten sich vermeiden laesst, ohne dass
ueberhaupt ein NAS noetig wird.

══ DER GROESSTE POSTEN IST DIE ROHDATEI ═══════════════════════════════════

Aufgenommen wird durchgehend roh (660 MB/h), geschnitten wird daraus; das
Ergebnis sind rund 320 MB/h FLAC. Die Karte traegt also BEIDES — obwohl die
Rohdatei nach dem letzten Schnitt sofort geloescht wird. Sie ist reines
Durchgangsmaterial.

Genau dafuer gibt es `/dev/shm`: ein Dateisystem im ARBEITSSPEICHER. Was
dort liegt, beruehrt die Karte nie. Ob das hier traegt, haengt an einer
Zahl, die dieses Werkzeug misst: wie viel Platz dort wirklich frei ist,
neben allem, was die Box sonst im Speicher haelt.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

# Aus den Messungen vom 16.08.2026 (tools/box/mitschnitt-machbar.py und die
# Durchlaeufe): roh 48000 x 2 x 2 Byte, FLAC etwa Faktor 2,2 kleiner.
ROH_MB_H = 660
FLAC_MB_H = 320


def geraet_der_wurzel() -> str:
    """Auf welchem Blockgeraet liegt `/`? Ohne das misst man die falsche Karte."""
    try:
        roh = subprocess.run(["findmnt", "-no", "SOURCE", "/"], capture_output=True, text=True, timeout=10).stdout
        name = os.path.basename(roh.strip())
        # /dev/mmcblk0p2 -> mmcblk0 ; /dev/sda2 -> sda
        for kandidat in (name.split("p")[0], name.rstrip("0123456789")):
            if os.path.isdir(f"/sys/block/{kandidat}"):
                return kandidat
    except Exception:
        pass
    return ""


def geschrieben_mb(geraet: str) -> float:
    """Wie viel wurde seit dem Start auf dieses Geraet geschrieben?

    Feld 7 in /sys/block/<x>/stat sind die geschriebenen Sektoren zu 512 Byte.
    """
    try:
        with open(f"/sys/block/{geraet}/stat") as f:
            felder = f.read().split()
        return int(felder[6]) * 512 / 1024 / 1024
    except Exception:
        return -1.0


def frei_mb(pfad: str) -> float:
    try:
        s = os.statvfs(pfad)
        return s.f_bavail * s.f_frsize / 1024 / 1024
    except Exception:
        return -1.0


def main() -> int:
    dauer = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    geraet = geraet_der_wurzel()
    if not geraet:
        print("Das Blockgeraet der Wurzel ist nicht zu bestimmen.", file=sys.stderr)
        return 2

    print("══ Was kostet der Mitschnitt die Karte? ══\n")
    print(f"── Die Karte: {geraet} ──")
    try:
        with open(f"/sys/block/{geraet}/size") as f:
            print(f"  Groesse       {int(f.read().strip()) * 512 / 1e9:.0f} GB")
    except Exception:
        pass
    print(f"  frei auf /    {frei_mb('/') / 1024:.0f} GB")

    laufzeit = 0.0
    try:
        with open("/proc/uptime") as f:
            laufzeit = float(f.read().split()[0])
    except Exception:
        pass
    gesamt = geschrieben_mb(geraet)
    if gesamt >= 0 and laufzeit > 0:
        print(f"  seit dem Start geschrieben: {gesamt / 1024:.1f} GB in {laufzeit / 3600:.1f} h "
              f"= {gesamt / (laufzeit / 3600):.0f} MB/h im Mittel")

    print("\n── Der Arbeitsspeicher, und was dort Platz haette ──")
    print(f"  /dev/shm frei {frei_mb('/dev/shm') / 1024:.1f} GB")
    try:
        with open("/proc/meminfo") as f:
            zeilen = dict(
                (z.split(":")[0], int(z.split()[1])) for z in f if ":" in z and len(z.split()) > 1
            )
        print(f"  RAM gesamt    {zeilen.get('MemTotal', 0) / 1024 / 1024:.1f} GB, "
              f"verfuegbar {zeilen.get('MemAvailable', 0) / 1024 / 1024:.1f} GB")
    except Exception:
        pass

    print(f"\n── Jetzt {dauer} s messen ──")
    vorher = geschrieben_mb(geraet)
    t0 = time.time()
    time.sleep(dauer)
    nachher = geschrieben_mb(geraet)
    echt = time.time() - t0
    geschrieben = nachher - vorher
    print(f"  {geschrieben:.1f} MB in {echt:.0f} s = {geschrieben / echt * 3600:.0f} MB/h")
    print("  (laeuft gerade KEIN Mitschnitt, ist das die Grundlast der Box)")

    print("\n── Die Rechnung fuer einen Mitschnitt ──")
    print(f"  roh waehrend der Aufnahme   {ROH_MB_H:>5} MB/h   ← reines Durchgangsmaterial")
    print(f"  fertige FLAC-Stuecke        {FLAC_MB_H:>5} MB/h   ← das, was bleiben soll")
    print(f"  zusammen auf der Karte      {ROH_MB_H + FLAC_MB_H:>5} MB/h")
    print(f"  mit Rohdatei im Speicher    {FLAC_MB_H:>5} MB/h   = {100 * ROH_MB_H // (ROH_MB_H + FLAC_MB_H)} % weniger")

    shm = frei_mb("/dev/shm")
    print("\n── Traegt der Speicher das? ──")
    if shm > 0:
        stunden = shm / ROH_MB_H
        print(f"  {shm / 1024:.1f} GB frei in /dev/shm reichen fuer {stunden * 60:.0f} min am Stueck.")
        if stunden < 0.5:
            print("  DAS IST KNAPP. Ohne eine Grenze liefe der Speicher voll, und das")
            print("  trifft nicht nur den Mitschnitt, sondern die ganze Box.")
        else:
            print("  Das reicht fuer einen ueblichen Abend — mit Notbremse, nicht ohne.")
    else:
        print("  /dev/shm ist nicht lesbar.")

    print("\nWAS DAS NICHT BEANTWORTET: wie viel die Karte noch aushaelt. SD-Karten")
    print("melden ihren Verschleiss nicht (kein SMART wie bei SSDs). Deshalb ist")
    print("die einzige belastbare Groesse die, die man SPART.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
