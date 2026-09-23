#!/usr/bin/env python3
"""Zeigt, was der Vorschlag »Nicht angeboten: …« WIRKLICH auf den Schirm
schreiben wuerde — auf DIESEM Rechner, in DIESEM Moment.

WOZU: Der Vorschlag zu sdstart lautet, bei leerem `ok` und nicht leerem
`blockiert` unter `l_wo` die Ausschlussgruende zu zeigen. Ob das hilft oder
schadet, haengt allein daran, WIE OFT diese Bedingung wahr ist und WAS dann
dort steht. Beides ist messbar, statt es zu schaetzen — deshalb dieses
Werkzeug und kein Wegwerfbefehl.

    python3 tools/karten-ausschluss-vorschau.py        # ohne Karte laufen lassen
    python3 tools/karten-ausschluss-vorschau.py        # UND mit gesteckter Karte

Der Vergleich beider Laeufe ist die eigentliche Antwort: Steht die Zeile auch
OHNE Karte da, ersetzt sie die einzige brauchbare Anweisung ("Steck die Karte
ein") durch eine Aufzaehlung von Platten, die niemanden interessieren.
"""
import os
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(WURZEL, "remote-step-installer", "controller"))

import geraete  # noqa: E402

# Genau die beiden Zeilen aus sdstart._karte_text() fuer den Fall "keine Karte".
HEUTE_GROSS = "Keine SD-Karte gefunden."
HEUTE_KLEIN = "Steck die Karte ein — ich sehe von selbst nach."


def main():
    ok, blockiert = geraete.karten_finden()
    print(f"System: {geraete.SYSTEM}")
    print(f"verwendbar ({len(ok)}):")
    for k in ok:
        print(f"  + {k['pfad']:24s} {k['groesse']:>8s}  {k['modell'] or '(ohne Namen)'}")
    print(f"ausgeschlossen ({len(blockiert)}):")
    for b in blockiert:
        print(f"  - {b['pfad']:24s} {b['groesse']:>8s}  {b['grund']}")

    greift = (not ok) and bool(blockiert)
    print(f"\nBedingung des Vorschlags (ok leer UND blockiert nicht leer): {greift}")
    print("\nl_wo HEUTE:")
    print(f"  {HEUTE_GROSS}")
    print(f"  {HEUTE_KLEIN}")
    print("\nl_wo NACH DEM VORSCHLAG:")
    if greift:
        # Wortgleich mit sdgui.py:263-266, inklusive der Kappung bei vier.
        print(f"  {HEUTE_GROSS}")
        print("  Nicht angeboten: " + " · ".join(
            f"{b['pfad']} ({b['grund']})" for b in blockiert[:4]))
        print("\n  ^ Die Anweisung »Steck die Karte ein« ist damit WEG.")
    else:
        print("  (unveraendert)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
