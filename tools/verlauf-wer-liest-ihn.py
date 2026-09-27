#!/usr/bin/env python3
"""
Liest wer den VERLAUF (`zuletzt` / `haeufigste`) tatsaechlich anzeigt.

WOFUER: Die Behauptung „der Verlauf gilt je Profil" laesst sich mit
`curl /api/gespielt?profil=…` scheinbar belegen — die Ablage IST je Profil.
Das beantwortet aber die falsche Frage. Die richtige lautet: SIEHT das jemand?

Dieses Werkzeug beantwortet drei Fragen NACHEINANDER und rein lesend:

  1. LIEFERT die Box je Profil Verschiedenes?   -> GET /api/gespielt[?profil=]
  2. WELCHE Oberflaeche laeuft ueberhaupt?      -> Kommandozeile des Kiosk
  3. HOLT diese Oberflaeche den Verlauf?        -> POST/GET-Zaehlung im Bundle

Punkt 3 ist der, an dem es kippt: `gespieltMelden` SCHREIBT (POST), aber im
laufenden Bundle steht kein einziges GET. Ein Feld, das niemand liest, gilt
nirgends — auch nicht je Profil.

NUR LESEND. Kein POST, kein systemctl, keine Datei auf der Box.

    python3 tools/verlauf-wer-liest-ihn.py [--box 192.168.178.169]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request

BOX_WWW = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"


def hole(url: str, sek: int = 20):
    with urllib.request.urlopen(url, timeout=sek) as r:
        return json.load(r)


def am_geraet(box: str, befehl: str) -> str:
    p = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", f"dietpi@{box}", befehl],
        capture_output=True,
        text=True,
    )
    return p.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default="192.168.178.169")
    ap.add_argument("--port", default="8200")
    a = ap.parse_args()
    basis = f"http://{a.box}:{a.port}"

    # ── 1. Die ABLAGE: liefert die Box je Profil Verschiedenes? ─────────────
    print("== 1. Ablage: /api/gespielt je Profil ==")
    stand = hole(f"{basis}/api/profile")
    kennungen = [p["kennung"] for p in stand.get("profile", [])]
    print(f"   Profile: {kennungen}   aktiv: {stand.get('aktiv')!r}")
    koepfe = {}
    for k in kennungen:
        d = hole(f"{basis}/api/gespielt?profil={k}&max=50")
        oft = [(e["key"], e.get("anzahl")) for e in d.get("haeufigste", [])]
        koepfe[k] = oft[:1]
        print(f"   {k:8s} zuletzt[0]={_erst(d.get('zuletzt'))}  haeufigste[0..2]={oft[:3]}")
    verschieden = len({str(v) for v in koepfe.values()}) == len(koepfe) and len(koepfe) > 1
    print(f"   -> je Profil verschieden: {verschieden}")

    # ── 2. Welche OBERFLAECHE laeuft? ──────────────────────────────────────
    print("\n== 2. Was der Kiosk laedt ==")
    zeile = am_geraet(a.box, "ps aux | grep -m1 'homepage http' | grep -v grep")
    treffer = re.search(r"--homepage (\S+)", zeile)
    seite = treffer.group(1) if treffer else "(nicht gefunden)"
    print(f"   --homepage {seite}")
    neu = "/neu" in seite

    # ── 3. HOLT diese Oberflaeche den Verlauf? ─────────────────────────────
    print("\n== 3. Liest die laufende Oberflaeche /api/gespielt? ==")
    datei = f"{BOX_WWW}/neu/app.js" if neu else f"{BOX_WWW}/*.js"
    roh = am_geraet(a.box, f"grep -n -A3 'API}}/gespielt' {datei} || true")
    if not neu:
        roh += am_geraet(a.box, f"grep -n -A3 \"'/api/gespielt'\" {datei} || true")
    posts = len(re.findall(r"method: *'POST'|method:\"POST\"", roh))
    aufrufe = len(re.findall(r"gespielt`|/api/gespielt'", roh))
    print(roh.strip() or "   (kein Aufruf gefunden)")
    print(f"   -> Aufrufe: {aufrufe}, davon schreibend (POST): {posts}")
    print(f"   -> LESENDE Aufrufe: {aufrufe - posts}")

    print("\n== Urteil ==")
    if verschieden and aufrufe - posts == 0:
        print("   Ablage je Profil: JA. Angezeigt: NEIN — nur geschrieben.")
        print("   Die Behauptung 'gilt je Profil' beschreibt eine Datei, keine Sicht.")
        return 1
    print("   Ablage je Profil und mindestens ein lesender Aufruf gefunden.")
    return 0


def _erst(liste):
    return liste[0]["key"] if liste else None


if __name__ == "__main__":
    sys.exit(main())
