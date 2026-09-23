#!/usr/bin/env python3
"""Misst, ob `geraete.karten_finden()` mehrere SCHAECHTE EINES LESERS als
mehrere Karten meldet — und was die Oberflaeche daraufhin sagt.

WOZU: Ein Mehrfach-Kartenleser meldet je Schacht eine eigene SCSI-LUN. Der
Kernel macht daraus /dev/sda, /dev/sdb … — verschiedene Geraetenamen, aber
EIN Stecker. Die Kartenseite von `sdstart.py` zaehlt nur und sagt dann
„Zieh alle ab außer der einen". Diese Anweisung ist am Mehrfachleser nicht
ausfuehrbar: der leere Schacht geht nur zusammen mit der Karte ab.

Die Probe macht drei Dinge und ist deshalb wiederverwendbar:
  1. `karten_finden()` echt laufen lassen und die Treffer zeigen;
  2. die Treffer ueber sysfs auf ihre USB-Schnittstelle zurueckfuehren —
     gleiche Schnittstelle = gleicher Stecker = gleicher Leser;
  3. `_karten_gesetzt()` mit genau dieser Liste fahren und ablesen, in
     welchem Zustand die Oberflaeche danach steht (Knopf gesperrt? Text?).

Schritt 3 braucht einen Bildschirm; ohne DISPLAY wird er uebersprungen
(dann mit `xvfb-run -a python3 tools/kartenleser-luns-probe.py` aufrufen).
"""
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
CTRL = os.path.join(os.path.dirname(HIER), "remote-step-installer", "controller")
sys.path.insert(0, CTRL)


def schnittstelle(name):
    """sysfs-Pfad bis zur USB-Schnittstelle (…/2-1:1.0) — oder ''.

    ALLES DAHINTER (host/target/LUN) unterscheidet die Schaechte; alles davor
    ist gemeinsam. Genau dieser Schnitt beantwortet die Frage 'ein Stecker
    oder zwei'.
    """
    weg = os.path.realpath(f"/sys/block/{name}")
    teile = weg.split("/")
    for i, t in enumerate(teile):
        if ":" in t and "-" in t:          # z.B. 2-1:1.0
            return "/".join(teile[:i + 1])
    return ""


def messen():
    import geraete
    ok, blockiert = geraete.karten_finden()
    for k in ok:
        k["_iface"] = schnittstelle(k.get("name") or "")
    gruppen = {}
    for k in ok:
        gruppen.setdefault(k["_iface"] or k["pfad"], []).append(k["pfad"])
    return ok, blockiert, gruppen


def oberflaeche_fahren(liste):
    """Die Kartenseite echt aufbauen und die gemessene Liste einspielen."""
    import sdstart
    f = sdstart.Fenster(board="RPi5", trocken=True, board_gesetzt=True)
    try:
        f._seite_karte()
        f.update()
        f._karten_gesetzt(liste)
        f.update()
        return {
            "karte_gewaehlt": f.karte["pfad"] if f.karte else None,
            # `Knopf.sperren` setzt `an = not gesperrt` — das ist das Merkmal,
            # das der Klick selbst abfragt, nicht bloss die Faerbung.
            "knopf_gesperrt": not bool(f.knopf.an),
            "gross": f.l_karte.cget("text"),
            "klein": f.l_wo.cget("text"),
            "waehlbar": [w.__class__.__name__ for w in f.mitte.winfo_children()],
        }
    finally:
        f.destroy()


def main():
    ok, blockiert, gruppen = messen()
    print("BESCHREIBBAR:", json.dumps(ok, ensure_ascii=False, indent=1))
    print("AUSGESCHLOSSEN:", [(b["pfad"], b.get("grund")) for b in blockiert])
    print()
    for iface, pfade in gruppen.items():
        marke = "EIN LESER, MEHRERE SCHAECHTE" if len(pfade) > 1 else "eigener Stecker"
        print(f"  {marke}: {pfade}  <- {iface}")
    print()
    if not os.environ.get("DISPLAY"):
        print("kein DISPLAY — Oberflaechenteil uebersprungen "
              "(xvfb-run -a python3 tools/kartenleser-luns-probe.py)")
        return 0
    print("OBERFLAECHE NACH DIESER LISTE:")
    for schluessel, wert in oberflaeche_fahren(ok).items():
        print(f"  {schluessel}: {wert}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
