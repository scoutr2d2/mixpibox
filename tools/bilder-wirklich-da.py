#!/usr/bin/env python3
"""Liefert die Box unter diesen Adressen wirklich BILDER — oder nur ihre Ersatzseite?

WARUM ES DIESES WERKZEUG GIBT (15.08.2026): Die Figurenbilder erschienen in der
Verwaltung nicht. Beim Nachmessen habe ich den Status abgefragt:

    curl -o /dev/null -w "%{http_code}" .../bilder/figuren/x.png   ->  200

und daraus geschlossen, die Bilder seien in Ordnung. Sie waren es nicht. Die
Einzelseiten-App beantwortet JEDEN unbekannten Weg mit ihrer index.html — also
kommt 200 zurueck, und im <img> steckt HTML. Der Status sagt bei einer solchen
App fast nichts; erst `content-type` sagt die Wahrheit:

    /bilder/figuren/x.png       200  text/html   9806 B   <- Ersatzseite
    /neu/bilder/figuren/x.png   200  image/png  31189 B   <- das Bild

DIE REGEL DARAUS: Wer prueft, ob eine Datei ausgeliefert wird, prueft den
Inhaltstyp. Ein 200 von einer SPA ist kein Beweis, sondern eine Hoeflichkeit.

Aufruf:
    python3 tools/bilder-wirklich-da.py --box dietpi@192.168.178.57
    python3 tools/bilder-wirklich-da.py --basis http://192.168.178.57:8200
"""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys

# Was ein Bild sein MUSS. Alles andere ist ein Fund, kein Zufall.
BILD_TYPEN = ("image/",)
# Darunter ist es kein echtes Bild, sondern bestenfalls ein Platzhalter.
MIN_BYTES = 500


def hole(basis: str, weg: str, ueber_box: str | None) -> tuple[int, str, int]:
    """Status, Inhaltstyp und Groesse einer Adresse. Ueber ssh, wenn noetig."""
    befehl = [
        "curl", "-s", "-o", "/dev/null",
        # SENKRECHTER STRICH ALS TRENNER, nicht Leerzeichen: der Inhaltstyp
        # traegt selbst eines („text/html; charset=utf-8"), und ein
        # Aufteilen an Leerzeichen zerlegt genau das Feld, um das es geht.
        "-w", "%{http_code}|%{content_type}|%{size_download}",
        "--max-time", "15", f"{basis}{weg}",
    ]
    if ueber_box:
        befehl = ["ssh", "-o", "ConnectTimeout=8", ueber_box, shlex.join(befehl)]
    roh = subprocess.run(befehl, capture_output=True, text=True, timeout=60).stdout.strip()
    teile = roh.split("|")
    if len(teile) < 3:
        return 0, "?", 0
    try:
        return int(teile[0] or 0), teile[1].strip(), int(teile[2] or 0)
    except ValueError:
        return 0, teile[1].strip(), 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", help="ssh-Ziel, z. B. dietpi@192.168.178.57 — dann wird auf der Box gemessen")
    p.add_argument("--basis", default="localhost:8200", help="Adresse des Servers (Vorgabe: localhost:8200)")
    a = p.parse_args()

    status, typ, _ = hole(a.basis, "/api/figuren", a.box)
    if status != 200:
        print(f"FEHLER: /api/figuren antwortet mit {status}", file=sys.stderr)
        return 2

    befehl = ["curl", "-s", "--max-time", "15", f"{a.basis}/api/figuren"]
    if a.box:
        befehl = ["ssh", "-o", "ConnectTimeout=8", a.box, shlex.join(befehl)]
    daten = json.loads(subprocess.run(befehl, capture_output=True, text=True, timeout=60).stdout)

    figuren = daten.get("figuren") or []
    if not figuren:
        print("Es liegen keine Figurenbilder auf der Box — nichts zu pruefen.")
        return 0

    # Der Server soll die brauchbare Adresse SELBST nennen. Tut er es nicht,
    # ist das der eigentliche Fund.
    web = daten.get("webOrdner")
    if not web:
        print("FUND: /api/figuren nennt kein `webOrdner`.")
        print("      Dann muss jede Oberflaeche die Adresse raten — genau so ist")
        print("      der Fehler vom 15.08.2026 entstanden.")
        web = f"/neu/{daten.get('ordner', 'bilder/figuren')}"
        print(f"      Geprueft wird ersatzweise gegen {web}\n")

    schlecht = 0
    proben = figuren[:5]
    print(f"{len(figuren)} Figuren gemeldet, {len(proben)} werden geprueft unter {web}\n")
    for f in proben:
        status, typ, groesse = hole(a.basis, f"{web}/{f}", a.box)
        istbild = typ.startswith(BILD_TYPEN) and groesse >= MIN_BYTES
        if not istbild:
            schlecht += 1
        marke = "ok  " if istbild else "FUND"
        print(f"  {marke}  {f:<34} {status} {typ} {groesse}B")
        if not istbild and typ.startswith("text/html"):
            print("        ^ das ist die Ersatzseite der App, kein Bild."
                  " Ein 200 beweist hier gar nichts.")

    print()
    if schlecht:
        print(f"{schlecht} von {len(proben)} Adressen liefern KEIN Bild.")
        return 1
    print("Alle geprueften Adressen liefern echte Bilder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
