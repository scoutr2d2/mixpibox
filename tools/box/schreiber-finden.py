#!/usr/bin/env python3
"""Wer schreibt hier eigentlich? — die Schreiblast je Prozess.

    sudo python3 schreiber-finden.py [sekunden]

Muss AUF DER BOX laufen, und mit root: `/proc/<pid>/io` gehoert dem
jeweiligen Prozess, und genau die fremden will man sehen.

══ WOFUER ═════════════════════════════════════════════════════════════════

Die Box schreibt im LEERLAUF rund 1,5 GB je Stunde auf die SD-Karte
(gemessen 16.08.2026, tools/box/schreiblast-messen.py). Das ist viel fuer
ein Geraet, das Musik abspielt — und es ist die Groesse, an der die
Lebensdauer der Karte haengt. Fuer den Mitschnitt wurde die Rohdatei extra
in den Arbeitsspeicher gelegt, um 660 MB/h zu sparen; wenn nebenher das
Doppelte fuer nichts geschrieben wird, war das die falsche Baustelle.

══ WAS GEMESSEN WIRD, UND WAS NICHT ═══════════════════════════════════════

`write_bytes` aus /proc/<pid>/io: was der Kernel fuer diesen Prozess
WIRKLICH zum Blockgeraet geschickt hat. Das ist die Zahl, die die Karte
altern laesst.

NICHT `wchar` — das ist, was das Programm in Richtung Betriebssystem
geschrieben hat. Wer nach /dev/shm oder in eine Datei schreibt, die im
Cache stirbt, taucht dort auf, ohne die Karte zu beruehren. Genau dieser
Unterschied ist hier der Punkt.

Prozesse, die waehrend der Messung starten oder enden, werden ausgelassen
statt geschaetzt.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time


def lesen(pid: str) -> tuple[int, int]:
    """(write_bytes, wchar) eines Prozesses. (-1, -1) wenn nicht lesbar."""
    try:
        with open(f"/proc/{pid}/io") as f:
            werte = dict(
                (z.split(":")[0], int(z.split(":")[1])) for z in f if ":" in z
            )
        return werte.get("write_bytes", -1), werte.get("wchar", -1)
    except Exception:
        return -1, -1


def name(pid: str) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            roh = f.read().decode(errors="replace").replace("\0", " ").strip()
        if roh:
            return roh[:70]
    except Exception:
        pass
    try:
        with open(f"/proc/{pid}/comm") as f:
            return f.read().strip()
    except Exception:
        return "?"


def alle_pids() -> list[str]:
    return [p for p in os.listdir("/proc") if p.isdigit()]


def geraet_schreiblast() -> float:
    """Was das Blockgeraet insgesamt bekommt, in MB — zum Abgleich."""
    try:
        roh = subprocess.run(["findmnt", "-no", "SOURCE", "/"], capture_output=True, text=True, timeout=10).stdout
        basis = os.path.basename(roh.strip())
        for kandidat in (basis.split("p")[0], basis.rstrip("0123456789")):
            if os.path.isdir(f"/sys/block/{kandidat}"):
                with open(f"/sys/block/{kandidat}/stat") as f:
                    return int(f.read().split()[6]) * 512 / 1024 / 1024
    except Exception:
        pass
    return -1.0


def main() -> int:
    dauer = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    if os.geteuid() != 0:
        print("Ohne root sind fremde /proc/<pid>/io nicht lesbar — genau die", file=sys.stderr)
        print("interessieren hier. Aufruf: sudo python3 schreiber-finden.py", file=sys.stderr)
        return 1

    print(f"══ Wer schreibt auf die Karte? ({dauer} s) ══\n")
    vorher = {p: lesen(p) for p in alle_pids()}
    namen = {p: name(p) for p in vorher}
    geraet_vorher = geraet_schreiblast()

    t0 = time.time()
    time.sleep(dauer)
    echt = time.time() - t0

    nachher = {p: lesen(p) for p in alle_pids()}
    geraet_nachher = geraet_schreiblast()

    zeilen = []
    for pid, (w_vor, c_vor) in vorher.items():
        if pid not in nachher or w_vor < 0:
            continue  # der Prozess ist weg oder war nie lesbar
        w_nach, c_nach = nachher[pid]
        if w_nach < 0:
            continue
        platte = (w_nach - w_vor) / 1024 / 1024
        gesamt = (c_nach - c_vor) / 1024 / 1024 if c_vor >= 0 and c_nach >= 0 else -1
        if platte > 0.05 or gesamt > 1:
            zeilen.append((platte, gesamt, pid, namen.get(pid, "?")))

    zeilen.sort(reverse=True)
    print(f"{'auf die Karte':>14}  {'geschrieben':>12}   PID    Programm")
    print(f"{'MB/h':>14}  {'MB/h gesamt':>12}")
    for platte, gesamt, pid, wie in zeilen[:18]:
        ph = platte / echt * 3600
        gh = gesamt / echt * 3600 if gesamt >= 0 else -1
        print(f"{ph:>14.0f}  {gh:>12.0f}   {pid:<6} {wie}")

    if not zeilen:
        print("  (kein Prozess hat messbar geschrieben)")

    summe = sum(z[0] for z in zeilen) / echt * 3600
    print(f"\n  Summe der Prozesse: {summe:.0f} MB/h")
    if geraet_vorher >= 0 and geraet_nachher >= 0:
        am_geraet = (geraet_nachher - geraet_vorher) / echt * 3600
        print(f"  Am Blockgeraet:     {am_geraet:.0f} MB/h")
        if am_geraet > summe * 1.5:
            print("  → Die Differenz kommt NICHT von einzelnen Prozessen. Verdaechtig:")
            print("    Journal/Syslog (schreibt der Kernel-Thread), Dateisystem-Journal,")
            print("    Swap. Weiter mit: journalctl --disk-usage, vmstat, /proc/meminfo.")

    print("\n── Was das Journal frisst ──")
    for befehl in (["journalctl", "--disk-usage"], ["swapon", "--show"]):
        try:
            e = subprocess.run(befehl, capture_output=True, text=True, timeout=15)
            aus = (e.stdout or e.stderr).strip()
            print(f"  {' '.join(befehl)}: {aus.splitlines()[0] if aus else '(nichts)'}")
        except Exception as f:
            print(f"  {' '.join(befehl)}: {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
