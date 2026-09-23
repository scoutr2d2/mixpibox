#!/usr/bin/env python3
"""LADEN ALLE COVER? — jede Cover-Adresse der Medienliste wirklich abrufen.

WOZU ES DAS GIBT
----------------
Betreiber am 05.09.2026: „manche cover laden nicht in der oberflaeche."
Gemessen an Box .62: 17 von 42 Cover-Adressen zeigten auf
`http://MixPiBox:8200/cover/...` — mit HOSTNAME statt relativem Pfad. Der
Name loeste ueber die Fritzbox auf eine IPv6-Adresse auf, die zu einer
ANDEREN (gerade abgeschalteten) Schnittstelle gehoerte als die, unter der
die Box erreichbar war. Ergebnis: genau diese Cover luden mal, mal nicht —
je nachdem, welche Adresse der Namensdienst gerade herausgab. Die Dateien
selbst waren alle da: ueber 127.0.0.1 mit sauberem URL-Encoding antworteten
alle 35 http-Adressen mit 200.

Die Probe trennt deshalb DREI Fragen, die sonst zusammenfallen:
  1. Wie viele Eintraege tragen eine ABSOLUTE Adresse mit Hostnamen?
     (Das ist der Konstruktionsfehler — relativ waere immun.)
  2. Antworten die Adressen SO WIE SIE DASTEHEN? (Sicht des Browsers)
  3. Antworten sie ueber 127.0.0.1? (Liegt die Datei ueberhaupt da?)

Ein Fehler in 2 bei Erfolg in 3 ist ein NAMENS-/NETZPROBLEM, kein
Dateiproblem — und umgekehrt.

AUFRUF
------
    python3 tools/box/cover-adressen-probe.py                  # Box .62
    python3 tools/box/cover-adressen-probe.py --box 192.168.178.99
    python3 tools/box/cover-adressen-probe.py --json

Rein LESEND: GET /api/data, dann je Cover ein GET. Nichts wird geschrieben.
Exit 1, sobald mindestens eine Adresse in Frage 2 scheitert.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

VORGABE_BOX = "192.168.178.62"
VORGABE_PORT = 8200


def holen(adresse: str, frist: float = 8.0) -> int:
    """HTTP-Status der Adresse; 0 heisst: gar nicht hingekommen."""
    try:
        with urllib.request.urlopen(adresse, timeout=frist) as a:
            return int(a.status)
    except urllib.error.HTTPError as f:
        return int(f.code)
    except Exception:
        return 0


def kodiert(roh: str, ersatz_wirt: str | None = None) -> str:
    """Pfad sauber prozent-kodieren; optional den Wirt austauschen."""
    u = urllib.parse.urlsplit(roh)
    if ersatz_wirt:
        port = f":{u.port}" if u.port else ""
        u = u._replace(netloc=f"{ersatz_wirt}{port}")
    return urllib.parse.urlunsplit(u._replace(path=urllib.parse.quote(u.path)))


def main() -> int:
    z = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    z.add_argument("--box", default=VORGABE_BOX)
    z.add_argument("--port", type=int, default=VORGABE_PORT)
    z.add_argument("--json", action="store_true")
    a = z.parse_args()

    basis = f"http://{a.box}:{a.port}"
    try:
        with urllib.request.urlopen(f"{basis}/api/data", timeout=10) as r:
            daten = json.load(r)
    except Exception as f:
        print(f"Medienliste nicht lesbar ({basis}/api/data): {f}", file=sys.stderr)
        return 1

    adressen = sorted({str(e.get("cover") or "") for e in daten if e.get("cover")})
    befund = {"gesamt": len(adressen), "data_uri": 0, "relativ": 0, "mit_wirt": 0,
              "fehl_wie_dasteht": [], "fehl_auch_direkt": []}

    for c in adressen:
        if c.startswith("data:"):
            befund["data_uri"] += 1
            continue
        if c.startswith("/"):
            befund["relativ"] += 1
            wie_dasteht = kodiert(basis + c)
        else:
            befund["mit_wirt"] += 1
            # Sicht des Browsers: die Adresse, WIE SIE IM EINTRAG STEHT —
            # nur von hier aus gerufen. Loest der Name hier anders auf als
            # auf der Box, ist das Teil des Befunds, nicht ein Messfehler.
            wie_dasteht = kodiert(c)
        if holen(wie_dasteht) == 200:
            continue
        befund["fehl_wie_dasteht"].append(c)
        # Frage 3: liegt die Datei ueberhaupt da? Gleicher Pfad, Wirt der Box.
        direkt = kodiert(c if c.startswith("http") else basis + c, ersatz_wirt=a.box)
        if holen(direkt) != 200:
            befund["fehl_auch_direkt"].append(c)

    if a.json:
        print(json.dumps(befund, ensure_ascii=False, indent=1))
    else:
        print(f"{befund['gesamt']} Cover-Adressen: {befund['relativ']} relativ, "
              f"{befund['mit_wirt']} mit Wirtsnamen, {befund['data_uri']} data-URIs.")
        for c in befund["fehl_wie_dasteht"]:
            wo = "DATEI FEHLT" if c in befund["fehl_auch_direkt"] else "nur Name/Netz"
            print(f"  FEHL ({wo}): {c[:110]}")
        if not befund["fehl_wie_dasteht"]:
            print("Alle Adressen antworten mit 200.")
    return 1 if befund["fehl_wie_dasteht"] else 0


if __name__ == "__main__":
    sys.exit(main())
