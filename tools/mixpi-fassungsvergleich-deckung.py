#!/usr/bin/env python3
"""URTEILEN BOX UND VERWALTUNG GLEICH? — dieselbe Fälleliste durch beide.

DER ANLASS: dieselbe Naht hat binnen eines Tages ZWEIMAL zugeschlagen.
Fassungsnummern werden an zwei Orten verglichen, und beide muessen dasselbe
tun:

    src/backend-api/src/aktualisierung.ts   vergleicheVersionen()  — die Seite
    scripts/box/mixpi-zieher.py             vergleiche()           — die Box

Was passierte, als sie auseinanderliefen:
  * 31.08.2026, erster Fall: der Zieher verstand die eigene Namensform
    `v1.1.0`, die Seite nicht. Ergebnis am Geraet: gefuelltes Verzeichnis,
    erreichbarer Feed, `feedFehler` LEER — und trotzdem „kein Angebot".
  * derselbe Tag, zweiter Fall: beide hielten `v1.1.0-beta.1` und
    `v1.1.0-beta.3` fuer GLEICH. Der beta-Kanal, dessen ganzer Zweck schnell
    aufeinanderfolgende Fassungen sind, war damit der einzige, der nicht
    funktionierte.

Beide Male gruen: die TypeScript-Tests pruefen die TS-Seite, die
Zieher-Probe die Python-Seite. Keine von beiden fragt, ob die zwei DASSELBE
sagen — und genau das ist die Frage, an der eine Box haengt.

WAS SIE TUT. Eine Liste von Faellen (unten, im Klartext) laeuft durch beide
Fassungen. Gemeldet wird jeder Fall, bei dem sich die Urteile unterscheiden —
und jeder, bei dem das Urteil nicht der ERWARTUNG entspricht, die neben dem
Fall steht. Das zweite ist wichtig: zwei Fassungen, die BEIDE falsch liegen,
sind sich einig und faenden sich sonst nicht.

WAS SIE NICHT TUT. Sie prueft nur den Vergleich, nicht die Auswahl des
Angebots (`neuestesAngebot` bzw. `neuestes_angebot`) und nicht das Urteil
(`beurteile`). Die haben eigene Tests; hier geht es um die eine Funktion, an
der sich zweimal etwas gerieben hat.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/mixpi-fassungsvergleich-deckung.py
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ZIEHER = WURZEL / "scripts" / "box" / "mixpi-zieher.py"
BACKEND = WURZEL / "src" / "backend-api"

# (a, b, erwartet) — erwartet ist -1, 0, 1 oder None (unvergleichbar).
# Die Liste ist die WAHRHEIT, gegen die beide Fassungen antreten. Wer eine
# Regel aendert, aendert sie hier zuerst.
FAELLE: list[tuple[str, str, int | None]] = [
    # ── Der Kern ─────────────────────────────────────────────────────────────
    ("4.3.0", "4.2.9", 1),
    ("4.10.0", "4.9.0", 1),            # 10 ist mehr als 9, nicht weniger
    ("4.3.0", "4.3.0", 0),
    ("4.2.0", "4.3.0", -1),
    ("4.3", "4.3.0", 0),               # verschieden viele Stellen
    ("4.3.1", "4.3", 1),

    # ── Die eigene Namensform ────────────────────────────────────────────────
    ("v1.1.0", "v1.1.0", 0),
    ("v1.1.0", "v1.0.0", 1),
    ("v1.1.0", "1.0.0", 1),            # gemischt: alte Boxen haben kein `v`

    # ── Die drei Kanaele: dev < beta < fertig ────────────────────────────────
    ("v1.2.0-dev.2", "v1.2.0-dev.1", 1),
    ("v1.2.0-beta.1", "v1.2.0-dev.9", 1),
    ("v1.2.0", "v1.2.0-beta.9", 1),
    ("v1.2.0-beta.3", "v1.2.0-beta.1", 1),   # DER FALL, DER DEN KANAL LAHMLEGTE
    ("v1.2.0-dev.1", "v1.1.0", 1),           # der Kern schlaegt die Stufe
    ("4.3.0-beta", "4.3.0", -1),             # unnummeriert ist die frueheste
    ("v1.2.0-beta", "v1.2.0-beta.1", -1),

    # ── Unbekanntes darf nie gewinnen ────────────────────────────────────────
    ("v1.2.0-dev.1", "v1.2.0-irgendwas.9", 1),
    ("v1.2.0-irgendwas", "v1.2.0", -1),

    # ── Unvergleichbares ist NICHT „neuer" ───────────────────────────────────
    ("X.X.X", "4.3.0", None),           # Upstreams dev-Platzhalter
    ("4.3.0", "irgendwas", None),
    ("", "4.3.0", None),
    ("version", "1.0.0", None),
    ("4.2.0 stable", "4.2.0", 0),       # Upstreams lange Form
]


def python_urteile() -> list[int | None]:
    spec = importlib.util.spec_from_file_location("zieher", ZIEHER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"{ZIEHER} nicht ladbar")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    aus: list[int | None] = []
    for a, b, _ in FAELLE:
        w = m.vergleiche(a, b)
        aus.append(None if w is None else (0 if w == 0 else (1 if w > 0 else -1)))
    return aus


def ts_urteile() -> list[int | None]:
    """Die TS-Fassung ueber tsx fahren — nicht nachbauen. Eine Nachbildung
    waere eine DRITTE Fassung derselben Regel und damit eine dritte Naht."""
    skript = (
        "import { vergleicheVersionen } from './src/aktualisierung.ts'\n"
        "const f = JSON.parse(process.argv[process.argv.length - 1])\n"
        "console.log(JSON.stringify(f.map(([a, b]) => {\n"
        "  const w = vergleicheVersionen(a, b)\n"
        "  return w === null ? null : (w === 0 ? 0 : (w > 0 ? 1 : -1))\n"
        "})))\n"
    )
    paare = json.dumps([[a, b] for a, b, _ in FAELLE])
    e = subprocess.run(["npx", "tsx", "-e", skript, paare],
                       cwd=BACKEND, capture_output=True, text=True, timeout=300)
    if e.returncode != 0:
        raise RuntimeError(f"tsx: {(e.stderr or e.stdout).strip()[:400]}")
    # tsx schreibt Warnungen auf stdout dazwischen — die letzte JSON-Zeile gilt.
    for zeile in reversed(e.stdout.strip().splitlines()):
        z = zeile.strip()
        if z.startswith("["):
            return json.loads(z)
    raise RuntimeError(f"keine Antwort von tsx: {e.stdout.strip()[:300]}")


def zeichen(w: int | None) -> str:
    return {None: "unvergleichbar", -1: "aelter", 0: "gleich", 1: "neuer"}[w]


def main() -> int:
    print("── Urteilen Box und Verwaltung gleich? ──")
    if not ZIEHER.is_file():
        print(f"  {ZIEHER} fehlt.")
        return 1
    try:
        py = python_urteile()
    except Exception as e:  # noqa: BLE001
        print(f"  Die Python-Fassung liess sich nicht fahren: {e}")
        return 1
    try:
        ts = ts_urteile()
    except Exception as e:  # noqa: BLE001
        print(f"  Die TypeScript-Fassung liess sich nicht fahren: {e}")
        return 1

    if len(ts) != len(FAELLE) or len(py) != len(FAELLE):
        print(f"  Zahl der Antworten passt nicht: {len(py)} Python, {len(ts)} TS, "
              f"{len(FAELLE)} Faelle.")
        return 1

    uneins, danebenmit = [], []
    for (a, b, soll), p, t in zip(FAELLE, py, ts, strict=True):
        if p != t:
            uneins.append((a, b, soll, p, t))
            print(f"  UNEINS: {a!r} gegen {b!r}")
            print(f"    Box sagt {zeichen(p)}, Verwaltung sagt {zeichen(t)}")
        elif p != soll:
            danebenmit.append((a, b, soll, p))
            print(f"  BEIDE DANEBEN: {a!r} gegen {b!r}")
            print(f"    erwartet {zeichen(soll)}, beide sagen {zeichen(p)}")

    print()
    print(f"  {len(FAELLE)} Faelle durch beide Fassungen: "
          f"{len(uneins)} uneins, {len(danebenmit)} einig aber falsch.")
    if uneins or danebenmit:
        print("  Beide Seiten aendern — sonst bietet die eine an, was die andere ablehnt.")
        print("LUECKE.")
        return 1
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
