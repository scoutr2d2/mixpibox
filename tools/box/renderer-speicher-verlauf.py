#!/usr/bin/env python3
"""WAECHST DER KIOSK-RENDERER? — Speicherverlauf an der Box, rein lesend.

WOZU ES DAS GIBT
----------------
Am 05.09.2026 um 13:37:29 hat der OOM-Killer auf der Box den Kiosk-Renderer
erschossen: `Out of memory: Killed process 1277 (WPEWebProcess)` mit
`anon-rss:1082672kB`. Auf dem Schirm stand danach „renderer process crashed"
und ein „Try again"-Knopf. Die Box war zu dem Zeitpunkt 33 Minuten wach — der
Renderer hatte in einer halben Stunde ueber ein Gigabyte angesammelt.

Eine EINZELNE Messung kann das nicht zeigen. `ps` sagt „155 MB", und 155 MB
sind unauffaellig; auffaellig ist erst, dass es vor fuenf Minuten 90 MB waren.
Deshalb misst dieses Werkzeug MEHRFACH MIT ABSTAND und rechnet die Steigung
aus — und daraus, wie lange es bei dieser Steigung bis zum naechsten OOM ist.

WARUM /proc/PID/status UND NICHT statm
--------------------------------------
`statm` zaehlt SEITEN. Der Pi 5 hat 16-KB-Seiten, nicht 4 KB — wer mit 4096
multipliziert, liegt auf dieser Box um den Faktor 4 daneben. `status` liefert
`VmRSS`/`VmSwap` direkt in kB und ist damit von der Seitengroesse unabhaengig.

Der Swap-Anteil gehoert dazu: der erschossene Prozess hatte zusaetzlich zu
1,06 GB resident noch 19377 Seiten (= 310 MB) ausgelagert. Wer nur RSS misst,
sieht ein Drittel des Lecks nicht.

AUFRUF
------
    python3 tools/box/renderer-speicher-verlauf.py
    python3 tools/box/renderer-speicher-verlauf.py --box 192.168.178.62
    python3 tools/box/renderer-speicher-verlauf.py --proben 10 --abstand 60
    python3 tools/box/renderer-speicher-verlauf.py --json
    python3 tools/box/renderer-speicher-verlauf.py --hier   # auf der Box selbst

Rein LESEND: ssh, cat /proc/…/status, free. Nichts wird gestartet, beendet
oder veraendert.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent.parent

# Die Adressen kommen aus dem Inventar des remote-step-installer, NICHT von
# hier — eine zweite Adressliste veraltet zwangslaeufig (siehe
# tools/welche-box.sh, das denselben Weg geht). Der Rueckfall greift nur,
# wenn das Inventar fehlt.
INVENTARE = (
    WURZEL / "remote-step-installer" / "boxen.yaml",
    WURZEL.parent / "remote-step-installer" / "boxen.yaml",
)
RUECKFALL = ["192.168.178.169", "192.168.178.99"]
BENUTZER = "dietpi"

# Woran ein Renderer zu erkennen ist. Der Kiosk ist umschaltbar (Cog/WPE oder
# Chromium, siehe Wissenspaket `cog-drm-kiosk-statt-chromium`), also muessen
# beide Sorten erkannt werden — auf den NAMEN gehen, nicht auf einen Pfad.
RENDERER_MUSTER = (
    ("WPEWebProcess", "Cog/WPE"),
    ("--type=renderer", "Chromium"),
)


def adressen_aus_inventar() -> list[str]:
    """Adressen aus boxen.yaml ziehen — ohne yaml-Abhaengigkeit."""
    for pfad in INVENTARE:
        if not pfad.is_file():
            continue
        gefunden = re.findall(
            r"^\s*adresse:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*$",
            pfad.read_text(encoding="utf-8", errors="replace"),
            re.MULTILINE,
        )
        if gefunden:
            return gefunden
    return list(RUECKFALL)


def ssh(box: str, befehl: str, frist: int = 20) -> tuple[int, str]:
    """Den Probe-Befehl fahren — ueber ssh, oder BEI `--hier` direkt.

    `--hier` kommt vom abgeloesten `tools/kiosk-speicher-verlauf.py`
    (AUDIT-2026-09-06 Rang 11) und ist kein Luxus: laeuft das Werkzeug auf
    der Box selbst (per Hand oder aus einem Dienst), gibt es keinen
    ssh-Rueckweg zum Arbeitsrechner — und eine Messung, die nur von
    draussen geht, faellt genau dann aus, wenn das Netz das Problem ist.
    `box is None` ist die Naht dafuer.
    """
    if box is None:
        lauf = subprocess.run(["sh", "-c", befehl], capture_output=True, text=True, timeout=frist)
        return lauf.returncode, lauf.stdout
    lauf = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            f"{BENUTZER}@{box}",
            befehl,
        ],
        capture_output=True,
        text=True,
        timeout=frist,
    )
    return lauf.returncode, lauf.stdout


def erreichbar(box: str) -> bool:
    try:
        code, _ = ssh(box, "true", frist=15)
    except (subprocess.TimeoutExpired, OSError):
        return False
    return code == 0


# Eine Probe holt ALLES in EINEM ssh-Aufruf. Zwei Aufrufe waeren zwei
# Zeitpunkte, und der Abstand dazwischen taucht in keiner Zahl auf.
PROBE_BEFEHL = r"""
date +%s
echo '--PROZESSE--'
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  [ -r "$p/cmdline" ] || continue
  cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null) || continue
  case "$cmd" in
    *WPEWebProcess*|*--type=renderer*)
      case "$cmd" in *bwrap*) continue;; esac
      rss=$(awk '/^VmRSS:/{print $2}' "$p/status" 2>/dev/null)
      swp=$(awk '/^VmSwap:/{print $2}' "$p/status" 2>/dev/null)
      # VmHWM ist der HOECHSTSTAND seit Prozessstart — er ueberlebt, was
      # eine Probe zwischen zwei Messpunkten verpasst (Erbe des
      # abgeloesten kiosk-speicher-verlauf.py).
      hwm=$(awk '/^VmHWM:/{print $2}' "$p/status" 2>/dev/null)
      lauf=$(awk '{print $22}' "$p/stat" 2>/dev/null)
      [ -n "$rss" ] && echo "$pid|${rss:-0}|${swp:-0}|${lauf:-0}|${hwm:-0}|$cmd"
      ;;
  esac
done
echo '--SPEICHER--'
awk '/^MemTotal:|^MemAvailable:|^SwapTotal:|^SwapFree:/{print $1" "$2}' /proc/meminfo
echo '--BETRIEBSZEIT--'
cut -d' ' -f1 /proc/uptime
"""


def probe(box: str) -> dict | None:
    try:
        code, text = ssh(box, PROBE_BEFEHL, frist=30)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if code != 0:
        return None

    teil = {"kopf": [], "prozesse": [], "speicher": [], "betriebszeit": []}
    wo = "kopf"
    for zeile in text.splitlines():
        if zeile == "--PROZESSE--":
            wo = "prozesse"
        elif zeile == "--SPEICHER--":
            wo = "speicher"
        elif zeile == "--BETRIEBSZEIT--":
            wo = "betriebszeit"
        elif zeile.strip():
            teil[wo].append(zeile.strip())

    prozesse = []
    for zeile in teil["prozesse"]:
        stueck = zeile.split("|", 5)
        if len(stueck) != 6:
            continue
        pid, rss, swap, ticks, hwm, cmd = stueck
        sorte = next((n for m, n in RENDERER_MUSTER if m in cmd), "unbekannt")
        prozesse.append(
            {
                "pid": int(pid),
                "rss_mb": int(rss) / 1024,
                "swap_mb": int(swap) / 1024,
                "starttick": int(ticks),
                "hoechst_mb": int(hwm) / 1024,
                "sorte": sorte,
            }
        )

    speicher = {}
    for zeile in teil["speicher"]:
        name, wert = zeile.split()
        speicher[name.rstrip(":")] = int(wert) / 1024

    return {
        "zeit": int(teil["kopf"][0]) if teil["kopf"] else 0,
        "prozesse": prozesse,
        "speicher": speicher,
        "betriebszeit_s": float(teil["betriebszeit"][0]) if teil["betriebszeit"] else 0.0,
    }


def summe(p: dict) -> float:
    return sum(x["rss_mb"] + x["swap_mb"] for x in p["prozesse"])


def hauptlauf(argv: list[str] | None = None) -> int:
    zerleger = argparse.ArgumentParser(
        description="Speicherverlauf des Kiosk-Renderers an der Box messen (rein lesend).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    zerleger.add_argument("--box", help="Adresse; ohne Angabe wird das Inventar durchprobiert")
    zerleger.add_argument(
        "--hier",
        action="store_true",
        help="auf DIESEM Rechner messen statt ueber ssh (wenn das Werkzeug auf der Box selbst laeuft)",
    )
    zerleger.add_argument("--proben", type=int, default=5, help="Anzahl Messungen (Vorgabe 5)")
    zerleger.add_argument("--abstand", type=int, default=60, help="Sekunden dazwischen (Vorgabe 60)")
    zerleger.add_argument("--json", action="store_true", help="Rohdaten als JSON")
    args = zerleger.parse_args(argv)

    if args.proben < 2:
        print("Mit einer einzigen Probe gibt es keine Steigung — mindestens 2.", file=sys.stderr)
        return 2

    # `--hier`: box bleibt None, und ssh() faehrt den Befehl dann direkt
    # (Begruendung dort). Die Suche nach einer erreichbaren Box entfaellt —
    # die Box IST der Rechner, auf dem das hier laeuft.
    if args.hier:
        box = None
    else:
        kandidaten = [args.box] if args.box else adressen_aus_inventar()
        box = next((k for k in kandidaten if erreichbar(k)), None)
        if box is None:
            print(f"Keine Box erreichbar (versucht: {', '.join(kandidaten)}).", file=sys.stderr)
            print("Steht sie woanders? `tools/welche-box.sh --suchen` sucht am Geraetebaum.", file=sys.stderr)
            return 1

    if not args.json:
        print(f"# Kiosk-Renderer an {box or 'diesem Rechner (--hier)'}")
        print(f"# {args.proben} Proben im Abstand von {args.abstand} s\n")

    proben: list[dict] = []
    for nr in range(args.proben):
        if nr:
            time.sleep(args.abstand)
        p = probe(box)
        if p is None:
            print(f"Probe fehlgeschlagen ({'lokal' if box is None else 'ssh'}).", file=sys.stderr)
            return 1
        proben.append(p)
        if not args.json:
            if not p["prozesse"]:
                print(f"  [{nr + 1}/{args.proben}]  KEIN Renderer da — laeuft der Kiosk?")
            else:
                teile = "  ".join(
                    f"pid {x['pid']}: {x['rss_mb']:.0f} MB + {x['swap_mb']:.0f} Swap"
                    for x in p["prozesse"]
                )
                frei = p["speicher"].get("MemAvailable", 0)
                print(f"  [{nr + 1}/{args.proben}]  {teile}   (frei: {frei:.0f} MB)")

    if args.json:
        print(json.dumps({"box": box, "proben": proben}, indent=2))
        return 0

    erste, letzte = proben[0], proben[-1]
    spanne_s = letzte["zeit"] - erste["zeit"]
    if spanne_s <= 0:
        print("\nZeitspanne war 0 — nichts zu rechnen.")
        return 1

    zuwachs = summe(letzte) - summe(erste)
    pro_min = zuwachs / (spanne_s / 60)

    print(f"\n── Bilanz ueber {spanne_s / 60:.1f} min ────────────────────────")
    print(f"  Renderer gesamt (RSS+Swap):  {summe(erste):.0f} MB  ->  {summe(letzte):.0f} MB")
    print(f"  Zuwachs:                     {zuwachs:+.0f} MB  ({pro_min:+.1f} MB/min)")

    # Gab es zwischendurch einen Neustart? Eine PID, die verschwindet, ist ein
    # Absturz — und dann ist die Steigung ueber die ganze Spanne wertlos.
    pids_erst = {x["pid"] for x in erste["prozesse"]}
    pids_letzt = {x["pid"] for x in letzte["prozesse"]}
    if pids_erst and pids_erst != pids_letzt:
        print(f"\n  ACHTUNG: PID-Wechsel {sorted(pids_erst)} -> {sorted(pids_letzt)}.")
        print("  Der Renderer ist waehrend der Messung neu gestartet — die Steigung")
        print("  oben mischt zwei Leben und ist NICHT zu gebrauchen. Nochmal messen.")
        return 1

    frei = letzte["speicher"].get("MemAvailable", 0) + letzte["speicher"].get("SwapFree", 0)
    print(f"  Noch frei (Mem+Swap):        {frei:.0f} MB")

    # ERST AB EINER ECHTEN MESSDAUER URTEILEN. Bei einer kurzen Reihe (zwei
    # Proben, wenige Sekunden Abstand) ist jede Steigung Rauschen: ein
    # Renderer, der gerade eine Seite aufbaut, waechst zwangslaeufig. Wer
    # daraus „LECK" macht, hat einmal hingesehen und eine Messung behauptet
    # (llmwiki einmal-hinsehen-ist-keine-messung). Die Schwelle ist der
    # Anlauf einer Seite plus Reserve.
    URTEILSDAUER_MIN = 5.0
    if pro_min > 0.5 and (spanne_s / 60) < URTEILSDAUER_MIN:
        print(f"\n  Es steigt ({pro_min:+.1f} MB/min) — aber {spanne_s / 60:.1f} min sind zu kurz")
        print(f"  fuer ein Urteil: unter {URTEILSDAUER_MIN:.0f} min misst man den Anlauf mit.")
        print("  Nochmal mit `--proben 10 --abstand 60` fahren.")
    elif pro_min > 0.5:
        rest_min = frei / pro_min
        print(f"\n  Bei dieser Steigung ist der Vorrat in {rest_min:.0f} min aufgebraucht")
        print(f"  (~{rest_min / 60:.1f} h). Das ist ein LECK, kein Anlaufverbrauch.")
    elif pro_min > 0:
        print("\n  Steigung unter 0,5 MB/min — das kann noch Anlauf oder Rauschen sein.")
        print("  Laenger messen (--proben 20 --abstand 60), bevor daraus ein Befund wird.")
    else:
        print("\n  Kein Zuwachs. Der Renderer waechst zu DIESEM Zeitpunkt nicht.")
        print("  Ein Leck, das nur bei Bedienung auftritt, sieht im Leerlauf so aus.")

    return 0


if __name__ == "__main__":
    sys.exit(hauptlauf())
