#!/usr/bin/env python3
"""
HAELT DER WAECHTER? — eine Probe auf tools/helligkeit-untergrenze-vergleich.py.

══ WARUM ES DIESE DATEI GIBT ═══════════════════════════════════════════════

0 % Bildschirmhelligkeit ist ein schwarzes Display, und ein schwarzes Display
ist eine Box, die sich am Geraet nicht mehr zuruecknehmen laesst — der Regler
ist dann selbst unsichtbar. Dass es dazu nicht kommt, haengt an EINER Zahl:

    PROZENT_MIN   in src/backend-api/src/schirmhelligkeit.ts

Dass jemand hinsieht, haengt an EINEM Werkzeug — und ein Werkzeug, das nicht
rot werden KANN, sichert nichts. Es ist dann schlimmer als keines, weil es
beruhigt. Diese Datei beantwortet deshalb genau die Frage, die man dem
Waechter stellen muss: **wenn ich die Grenze wegnehme, wird er dann wirklich
rot?** Nicht im Kopf durchgespielt, sondern ausgefuehrt.

══ WAS SICH AM 19.09.2026 GEAENDERT HAT ════════════════════════════════════

Gebaut wurde die Probe am 07.08.2026 fuer ZWEI Orte: `schirmhelligkeit.ts`
und `AdminInterface/www/mupi.php`. Mit E47 (19.08.2026) ist PHP aus dem
Projekt geflogen, mupi.php mit ihm — und diese Probe STUERZTE seitdem bei
jedem Lauf mit `FileNotFoundError` in `shutil.copy2`. Eine Probe, die
stuerzt, ist keine Wache: sie sagt weder gruen noch rot.

Der Waechter ist am selben Tag auf den Gegenstand umgebaut worden, den es
heute gibt (eine Grenze, ein Ort, und die Frage, ob ein zweiter zurueckkommt).
Diese Probe folgt ihm dorthin. Sie faellt NICHT weg: die Sicherung haengt
nach wie vor an einem einzigen Werkzeug, und genau das ist der Grund, warum
es eine Probe darauf gibt.

══ WIE, OHNE DEN BAUM ANZUFASSEN ═══════════════════════════════════════════

Es wird ein SPIEGEL angelegt: ein Ordner mit derselben Struktur, in den die
beteiligten Dateien kopiert werden. Der Waechter leitet seine Pfade aus dem
eigenen Ort ab — im Spiegel sieht er also die Kopien. Die echten Dateien
werden NIE geschrieben; `schirmhelligkeit.ts` gehoert ohnehin gerade einer
anderen Sitzung.

Im Spiegel gibt es kein git. Der Waechter muss seine Baumsuche deshalb auch
ohne git koennen (er laeuft dann), und diese Probe misst das mit: waere es
anders, pruefte sie etwas anderes als den Ernstfall.

Jede Mutation ist eine Aenderung, die ein Mensch wirklich machen wuerde:
jemand haelt 20 % fuer zu streng, jemand raeumt einen „doppelten" Riegel weg,
jemand spielt ein altes Admin aus einem Backup ein. Erwartet wird JE MUTATION
EIN BESTIMMTER AUSGANG, nicht bloss „irgendwas ungleich 0":

    1 = ROT       der Waechter hat den Verstoss gefunden
    2 = ABBRUCH   sein Gegenstand fehlt; er sagt es mit Anleitung und wird
                  ausdruecklich NICHT gruen

Der Unterschied ist der Kern des Umbaus vom 19.09.: ein Abbruch, der als
Gruen durchginge, waere die gefaehrlichste Sorte Wache.

    python3 tools/untergrenzen-waechter-probe.py
    python3 tools/untergrenzen-waechter-probe.py --zeigen   # Ausgabe je Lauf

Rueckgabe: 0 = der Waechter haelt bei allen Mutationen, 1 = mindestens eine
geht unbemerkt durch (oder er ist schon unveraendert nicht gruen).
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
WAECHTER = WURZEL / "tools" / "helligkeit-untergrenze-vergleich.py"
TS_DATEI = Path("src") / "backend-api" / "src" / "schirmhelligkeit.ts"

# Wo der zweite Ort bis E47 stand. Er wird im Spiegel WIEDERHERGESTELLT — das
# ist der Rueckfall, vor dem der Waechter warnen soll.
PHP_DATEI = Path("AdminInterface") / "www" / "mupi.php"

# Der letzte Stand von mupi.php, aus der Geschichte geholt: E47 ist der Commit,
# der PHP ausgebaut hat, `^` sein Vorgaenger.
PHP_AUS_DER_GESCHICHTE = "52d21406^:AdminInterface/www/mupi.php"

# Falls die Geschichte nicht erreichbar ist (flacher Klon, anderer Baum): eine
# Attrappe, die dasselbe Merkmal traegt. Dann ist die Mutation flacher, aber
# sie faellt nicht aus — nicht gemessen ist nicht dasselbe wie gruen.
PHP_ATTRAPPE = "<?php\n$HELLIGKEIT_PROZENT_MIN = 10;\n$HELLIGKEIT_PROZENT_MAX = 100;\n"


def spiegel_bauen(ziel: Path) -> Path:
    """Die beteiligten Dateien in eine eigene Baumstruktur kopieren."""
    (ziel / TS_DATEI).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(WURZEL / TS_DATEI, ziel / TS_DATEI)
    (ziel / "tools").mkdir(parents=True, exist_ok=True)
    shutil.copy2(WAECHTER, ziel / "tools" / WAECHTER.name)
    return ziel


def waechter_lauf(spiegel: Path) -> tuple[int, str]:
    fertig = subprocess.run(
        [sys.executable, str(spiegel / "tools" / WAECHTER.name)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    return fertig.returncode, fertig.stdout + fertig.stderr


def ersetze(spiegel: Path, rel: Path, muster: str, ersatz: str) -> None:
    """Eine Stelle im Spiegel aendern. Trifft das Muster nicht, ist das ein
    Fehler dieser Probe — nicht ein Befund ueber den Waechter."""
    pfad = spiegel / rel
    alt = pfad.read_text(encoding="utf-8")
    neu, wieoft = re.subn(muster, ersatz, alt, count=1)
    if wieoft != 1:
        raise SystemExit(f"Mutation fand ihre Stelle nicht: {muster!r} in {rel}")
    pfad.write_text(neu, encoding="utf-8")


def alte_verwaltung(spiegel: Path, untergrenze: int | None) -> None:
    """Den zweiten Ort wiederherstellen — mit `untergrenze` als seiner Zahl.

    `None` heisst: ein PHP-Admin OHNE eigene Untergrenze. Auch das ist ein
    Rueckfall, denn mit PHP kommt der Weg zurueck, ueber den E47 die
    sudo-Regel `www-data ALL=(ALL:ALL) NOPASSWD: ALL` losgeworden ist.
    """
    ziel = spiegel / PHP_DATEI
    ziel.parent.mkdir(parents=True, exist_ok=True)
    if untergrenze is None:
        ziel.write_text("<?php\n// ein Admin ohne eigene Helligkeitsgrenze\n", encoding="utf-8")
        return
    inhalt = PHP_ATTRAPPE
    holen = subprocess.run(
        ["git", "-C", str(WURZEL), "show", PHP_AUS_DER_GESCHICHTE],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if holen.returncode == 0 and holen.stdout.strip():
        inhalt = holen.stdout
    inhalt = re.sub(r"\$HELLIGKEIT_PROZENT_MIN\s*=\s*\d+;", f"$HELLIGKEIT_PROZENT_MIN = {untergrenze};", inhalt, count=1)
    ziel.write_text(inhalt, encoding="utf-8")


def datei_weg(spiegel: Path) -> None:
    (spiegel / TS_DATEI).unlink()


# Jede Mutation: (Name, was im Spiegel geschieht, erwarteter Ausgang)
MUTATIONEN: list[tuple[str, object, int]] = [
    (
        "die Untergrenze auf 0 gesetzt — der Fall, um den es geht",
        lambda s: ersetze(s, TS_DATEI, r"export const PROZENT_MIN = \d+", "export const PROZENT_MIN = 0"),
        1,
    ),
    (
        "die Obergrenze unter die Untergrenze gezogen",
        lambda s: ersetze(s, TS_DATEI, r"export const PROZENT_MAX = \d+", "export const PROZENT_MAX = 10"),
        1,
    ),
    (
        "der zweite Riegel in rohUntergrenze() weggeraeumt (Math.max(1, …))",
        lambda s: ersetze(
            s,
            TS_DATEI,
            r"Math\.max\(1, Math\.round\(\(PROZENT_MIN / 100\) \* maxRoh\)\)",
            "Math.round((PROZENT_MIN / 100) * maxRoh)",
        ),
        1,
    ),
    (
        "klemmeProzent() klemmt nicht mehr gegen die Untergrenze",
        lambda s: ersetze(
            s,
            TS_DATEI,
            r"Math\.max\(PROZENT_MIN, Math\.round\(prozent\)\)",
            "Math.round(prozent)",
        ),
        1,
    ),
    (
        "die alte Verwaltung ist zurueck und bringt eine zweite Untergrenze (10 %) mit",
        lambda s: alte_verwaltung(s, 10),
        1,
    ),
    (
        "die alte Verwaltung ist zurueck und ist sich sogar einig (20 %)",
        lambda s: alte_verwaltung(s, 20),
        1,
    ),
    (
        "ein PHP-Admin ist zurueck, ganz ohne Helligkeitsgrenze",
        lambda s: alte_verwaltung(s, None),
        1,
    ),
    (
        "die gehuetete Datei ist ganz weg — ABBRUCH mit Anleitung, nicht gruen",
        datei_weg,
        2,
    ),
]

# Was in der Ausgabe stehen MUSS, wenn der Gegenstand fehlt. Ein Abbruch ohne
# Anleitung laesst den naechsten Leser genauso ratlos wie ein falsches Gruen.
ANLEITUNG_MERKMALE = ("ABBRUCH", "Was zu tun ist")


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--zeigen", action="store_true", help="die Ausgabe jedes Laufs mit ausdrucken")
    args = zerleger.parse_args()

    if not WAECHTER.exists():
        print(f"ROT  Den Waechter gibt es nicht: {WAECHTER}")
        return 1
    if not (WURZEL / TS_DATEI).exists():
        print(f"ROT  Die gehuetete Datei gibt es nicht: {TS_DATEI}")
        print("     Dann sagt keine Mutation unten etwas aus — erst sie, dann diese Probe.")
        return 1

    schlecht = 0

    with tempfile.TemporaryDirectory(prefix="untergrenzen-waechter-") as tmp:
        # ── 1. Unveraendert: der Waechter MUSS gruen sein ────────────────────
        spiegel = spiegel_bauen(Path(tmp) / "sauber")
        code, ausgabe = waechter_lauf(spiegel)
        if args.zeigen:
            print(ausgabe)
        if code == 0:
            print("  ok   unveraendert ist der Waechter gruen")
        else:
            print(f"  ROT  unveraendert ist der Waechter schon nicht gruen (Code {code}) —")
            print("       dann sagt keine der Mutationen unten etwas aus.")
            print(ausgabe)
            return 1

        # ── 2. Jede Mutation MUSS ihren Ausgang bringen ─────────────────────
        for nr, (name, mutieren, erwartet) in enumerate(MUTATIONEN):
            spiegel = spiegel_bauen(Path(tmp) / f"mutation{nr}")
            mutieren(spiegel)  # type: ignore[operator]
            code, ausgabe = waechter_lauf(spiegel)
            if args.zeigen:
                print(f"\n─── {name} ───\n{ausgabe}")
            wort = {1: "rot", 2: "Abbruch"}[erwartet]
            if code != erwartet:
                schlecht += 1
                gesehen = "GRUEN" if code == 0 else f"Code {code}"
                print(f"  ROT  {gesehen} statt {wort} bei: {name}")
                if code == 0:
                    print("       Diese Aenderung wuerde unbemerkt durchgehen.")
                else:
                    print(f"       Erwartet war Ausgang {erwartet}; ein Abbruch ist kein Fund und umgekehrt.")
                continue
            fehlt = [m for m in ANLEITUNG_MERKMALE if m not in ausgabe] if erwartet == 2 else []
            if fehlt:
                schlecht += 1
                print(f"  ROT  {wort} ohne Anleitung bei: {name}")
                print(f"       in der Ausgabe fehlt: {', '.join(fehlt)}")
            else:
                print(f"  ok   {wort} bei: {name}")

    print()
    if schlecht:
        print(f"{schlecht} Luecke(n) im Waechter. Die Untergrenze ist NICHT vollstaendig gesichert.")
        return 1
    print(f"Der Waechter antwortet auf alle {len(MUTATIONEN)} Aenderungen wie verlangt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
