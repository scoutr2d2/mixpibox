#!/usr/bin/env python3
"""Was kostet der MuPiHAT-Dienst an Arbeitsspeicher - Posten fuer Posten.

Der Dienst mupi_hat.service belegt auf der Box rund 42 MB RSS (gemessen
19.08.2026, /proc/663262/status). Diese Zahl ist eine Summe, und eine Summe
sagt nicht, wo man kuerzen kann. Das Werkzeug hier zerlegt sie: es startet
jeweils einen frischen Python-Prozess, laedt genau eine Stufe mehr und misst
danach VmRSS. Die Differenz zur Vorstufe ist der Preis dieser Stufe.

Aufruf
------
    python3 tools/mupihat-speicherprofil.py
    python3 tools/mupihat-speicherprofil.py --modulpfad scripts/mupihat

smbus2 wird gefaelscht, wenn es fehlt (Entwicklungsrechner ohne I2C). Der
Registerbaum wird dadurch nicht kleiner - er ist reiner Python-Code, und genau
den wollen wir wiegen.

Warnung zur Uebertragbarkeit: gemessen wird auf dem Rechner, auf dem das
Werkzeug laeuft. Auf der Box (aarch64, andere Python-Version) sind die
absoluten Zahlen andere; die VERHAELTNISSE zwischen den Stufen halten.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

# Die Stufen. Jede STUFE FUEGT HINZU, was die vorherigen schon geladen haben -
# der ausgefuehrte Code ist die Summe aller Zeilen bis einschliesslich hier.
# (Ohne diese Summenbildung misst man Aepfel gegen Birnen; genau daran ist die
# erste Fassung dieses Werkzeugs gescheitert.)
STUFEN: list[tuple[str, str]] = [
    ("nackt (Python allein)", ""),
    ("+ json/logging/argparse/datetime", "import json, logging, argparse, datetime"),
    ("+ smbus2", "import smbus2"),
    ("+ mupihat_bq25792 (Registerbaum)", "import mupihat_bq25792"),
    ("+ bq25792() angelegt", "h = mupihat_bq25792.bq25792(battery_conf_file='/nicht/da.json')"),
    ("+ flask + Flask()", "import flask\napp = flask.Flask('m')"),
    ("+ eine Vorlage gerendert", "import jinja2\n_ = jinja2.Template('{{a}}').render(a=1)"),
]

VORSPANN = """
import sys, os
sys.path.insert(0, {modulpfad!r})

# smbus2 faelschen, falls nicht vorhanden (Rechner ohne I2C).
try:
    import smbus2  # noqa: F401
except ImportError:
    import types
    m = types.ModuleType('smbus2')
    class SMBus:
        def __init__(self, *a, **k): pass
        def read_i2c_block_data(self, *a, **k): return [0] * (a[2] if len(a) > 2 else 1)
        def write_byte_data(self, *a, **k): pass
    m.SMBus = SMBus
    sys.modules['smbus2'] = m

def rss_kb():
    with open('/proc/self/status') as f:
        for z in f:
            if z.startswith('VmRSS:'):
                return int(z.split()[1])
    return -1

basis = rss_kb()
"""

NACHSPANN = """
import json as _j
print('MESSWERT ' + _j.dumps({'rss_kb': rss_kb(), 'basis_kb': basis}))
"""


def messe_einmal(code: str, modulpfad: str, optimiert: bool) -> int:
    """Startet einen frischen Python-Prozess, fuehrt `code` aus, liefert VmRSS in kB."""
    quelle = VORSPANN.format(modulpfad=modulpfad) + "\n" + code + "\n" + NACHSPANN
    argv = [sys.executable]
    if optimiert:
        argv.append("-OO")
    argv += ["-c", quelle]
    erg = subprocess.run(argv, capture_output=True, text=True)
    for zeile in erg.stdout.splitlines():
        if zeile.startswith("MESSWERT "):
            return int(json.loads(zeile[len("MESSWERT "):])["rss_kb"])
    sys.stderr.write(erg.stderr[-2000:] + "\n")
    raise SystemExit(f"Messung fehlgeschlagen fuer Stufe:\n{textwrap.indent(code, '  ')}")


def messe(code: str, modulpfad: str, optimiert: bool, wiederholungen: int) -> int:
    """Median mehrerer Laeufe - ein einzelner Anlauf schwankt um mehrere MB."""
    werte = sorted(messe_einmal(code, modulpfad, optimiert) for _ in range(wiederholungen))
    return werte[len(werte) // 2]


def lauf(modulpfad: str, optimiert: bool, wiederholungen: int) -> list[tuple[str, int, int]]:
    ergebnis = []
    vorher = None
    aufgelaufen: list[str] = []
    for name, code in STUFEN:
        if code:
            aufgelaufen.append(code)
        kb = messe("\n".join(aufgelaufen), modulpfad, optimiert, wiederholungen)
        delta = 0 if vorher is None else kb - vorher
        ergebnis.append((name, kb, delta))
        vorher = kb
    return ergebnis


def tabelle(titel: str, zeilen: list[tuple[str, int, int]]) -> None:
    print(f"\n{titel}")
    print(f"  {'Stufe':<36} {'RSS':>10} {'Zuwachs':>10}")
    print("  " + "-" * 58)
    for name, kb, delta in zeilen:
        d = "" if delta == 0 and name == "nackt" else f"{delta / 1024:+.1f} MB"
        print(f"  {name:<36} {kb / 1024:>7.1f} MB {d:>10}")


def main() -> int:
    wurzel = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--modulpfad", default=str(wurzel / "scripts" / "mupihat"),
                   help="Verzeichnis mit mupihat_bq25792.py")
    p.add_argument("-n", "--wiederholungen", type=int, default=5,
                   help="Laeufe je Stufe, ausgewertet wird der Median (Vorgabe 5)")
    args = p.parse_args()

    if not Path(args.modulpfad, "mupihat_bq25792.py").exists():
        raise SystemExit(f"mupihat_bq25792.py nicht gefunden unter {args.modulpfad}")

    print(f"Python {sys.version.split()[0]} auf {os.uname().machine}, "
          f"Median aus {args.wiederholungen} Laeufen je Stufe")
    normal = lauf(args.modulpfad, optimiert=False, wiederholungen=args.wiederholungen)
    tabelle("OHNE -OO (so laeuft der Dienst heute)", normal)
    opt = lauf(args.modulpfad, optimiert=True, wiederholungen=args.wiederholungen)
    tabelle("MIT -OO (Docstrings verworfen)", opt)

    print("\nErsparnis durch -OO je Stufe:")
    for (name, kb_n, _), (_, kb_o, _) in zip(normal, opt):
        print(f"  {name:<36} {(kb_n - kb_o) / 1024:+.1f} MB")

    # Flask ist der Posten, um den es geht: sein Zuwachs gegen die Endsumme.
    voll = normal[-1][1]
    flask_delta = next(d for name, _, d in normal if name.startswith("+ flask"))
    reg_delta = next(d for name, _, d in normal if "Registerbaum" in name)
    print(f"\nFlask-Zuwachs:        {flask_delta / 1024:5.1f} MB  "
          f"({100 * flask_delta / voll:.0f} % der {voll / 1024:.1f} MB am Ende)")
    print(f"Registerbaum-Zuwachs: {reg_delta / 1024:5.1f} MB  "
          f"({100 * reg_delta / voll:.0f} %) - 5764 Zeilen Python wiegen fast nichts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
