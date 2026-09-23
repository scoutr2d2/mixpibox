#!/usr/bin/env python3
"""Sichert die Sicherung DER BOX den Bereich? — am Geraet nachgesehen, rein lesend.

WARUM NICHT `tools/bereich-sicherung-deckung.py` GENUEGT: der liest den
QUELLTEXT und beantwortet „ist das Muster da". Das ist die halbe Frage. Die
andere Haelfte ist, ob auf der Box wirklich etwas liegt, das dieses Muster
trifft — eine Kennung mit einem Punkt darin, ein Bereich, den es gar nicht
gibt, eine Datei, die dem falschen Benutzer gehoert. Nur die Box weiss das.

WAS DIESER LAUF TUT: er kopiert eine Fassung von `mupibox-sicherung.py` nach
/tmp der Box, importiert sie dort und ruft `bestandsaufnahme()`. Das ist die
Funktion, die entscheidet, was ins Archiv kommt — und sie ist REIN LESEND.
Es wird kein Stand angelegt, nichts umbenannt, nichts geloescht.

ER VERGLEICHT ZWEI FASSUNGEN, weil eine allein nichts beweist: die auf der Box
INSTALLIERTE und die im Arbeitsbaum. Steht am Ende bei beiden dasselbe, hat
man nichts gemessen — dann ist entweder schon ausgerollt oder nichts geaendert.

    python3 tools/bereich-sicherung-am-geraet.py
    python3 tools/bereich-sicherung-am-geraet.py --box 192.168.178.169
"""
import argparse
import json
import os
import subprocess
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
BAUM = os.path.dirname(HIER)
NEU = os.path.join(BAUM, "scripts", "mupibox", "mupibox-sicherung.py")
INSTALLIERT = "/usr/local/bin/mupibox/mupibox-sicherung.py"

# Der Schnipsel laeuft AUF der Box. Er importiert die genannte Fassung ueber
# ihren Pfad (der Dateiname traegt einen Bindestrich, `import` kaeme da nicht
# heran) und meldet, was `bestandsaufnahme()` in den Bereichen findet.
SCHNIPSEL = r'''
import importlib.util, json, sys
pfad = sys.argv[1]
spec = importlib.util.spec_from_file_location("sich", pfad)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
auf = m.bestandsaufnahme()
def bereich(liste, feld="pfad"):
    return sorted(e[feld] for e in liste if "/profile/" in e[feld] or e[feld].endswith("/profile"))
print(json.dumps({
    "dabei":       bereich(auf["dabei"]),
    "nicht_dabei": bereich(auf["nicht_dabei"]),
    "unbekannt":   bereich(auf["unbekannt"]),
    "dabei_alle":  len(auf["dabei"]),
}))
'''


def auf_der_box(box: str, befehl: list[str], eingabe: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "ConnectTimeout=8", f"dietpi@{box}"] + befehl,
        input=eingabe, capture_output=True, timeout=120)


def messen(box: str, pfad_auf_box: str) -> dict | str:
    r = auf_der_box(box, ["python3", "-", pfad_auf_box], SCHNIPSEL.encode())
    if r.returncode != 0:
        return f"FEHLER: {r.stderr.decode(errors='replace').strip()[:400]}"
    try:
        return json.loads(r.stdout.decode())
    except ValueError:
        return f"unlesbare Antwort: {r.stdout.decode(errors='replace')[:300]}"


def zeigen(titel: str, e: dict | str) -> None:
    print(f"\n  {titel}")
    if isinstance(e, str):
        print(f"    {e}")
        return
    print(f"    eingesammelt insgesamt: {e['dabei_alle']} Dateien")
    for name, feld in [("MIT im Archiv", "dabei"),
                       ("bewusst draussen", "nicht_dabei"),
                       ("NICHT eingeordnet -> NICHT gesichert", "unbekannt")]:
        werte = e[feld]
        print(f"    {name}: {len(werte)}")
        for w in werte:
            print(f"      {w}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="192.168.178.169")
    a = p.parse_args()

    print("Sichert die Sicherung DER BOX den Bereich eines Profils?")
    print("───────────────────────────────────────────────────────")
    print(f"  Box:  {a.box}   (rein lesend — kein Stand wird angelegt)")

    r = auf_der_box(a.box, ["ls", "-d",
                            "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/profile/*"])
    bereiche = r.stdout.decode().split() if r.returncode == 0 else []
    print(f"  Bereiche auf der Box: {len(bereiche)}")
    for b in bereiche:
        print(f"    {b}")
    if not bereiche:
        print("\n  KEIN Bereich auf der Box — dieser Lauf kann nichts beweisen.")
        return 2

    installiert = messen(a.box, INSTALLIERT)
    zeigen(f"INSTALLIERT ({INSTALLIERT})", installiert)

    ziel = "/tmp/mupibox-sicherung-gegenlesen.py"
    with open(NEU, "rb") as f:
        roh = f.read()
    r = auf_der_box(a.box, ["cat", ">", ziel], roh)
    if r.returncode != 0:
        print(f"\n  konnte die neue Fassung nicht ablegen: {r.stderr.decode()[:200]}")
        return 2
    neu = messen(a.box, ziel)
    zeigen("ARBEITSBAUM (nach /tmp der Box kopiert)", neu)
    auf_der_box(a.box, ["rm", "-f", ziel])

    print()
    if isinstance(neu, str) or isinstance(installiert, str):
        print("  NICHT GEMESSEN — siehe Fehler oben.")
        return 2
    fehlt_alt = not neu["dabei"] or installiert["dabei"] == neu["dabei"]
    if fehlt_alt and installiert["dabei"]:
        print("  Beide Fassungen sammeln dasselbe ein — entweder ist die "
              "Aenderung schon ausgerollt\n  oder es gibt keine.")
        return 0
    if not neu["dabei"]:
        print("  ROT: auch die neue Fassung sammelt im Bereich NICHTS ein.")
        return 1
    print(f"  Die installierte Fassung sammelt im Bereich {len(installiert['dabei'])} Datei(en) ein,")
    print(f"  die aus dem Arbeitsbaum {len(neu['dabei'])}.")
    print("  -> Solange nicht ausgerollt ist, laeuft die Box mit der Luecke.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
