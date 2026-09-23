#!/usr/bin/env python3
"""WELCHE WERKE GIBT ES DOPPELT — und wie ungleich sind ihre Titelzahlen?

WOZU ES DAS GIBT
----------------
Betreiber am 05.09.2026: „aufnahme in admin menu laed nicht alle titel im
album, weniger sichtbar, auch zum nachladen." Gemessen an Box .62: das
Spotify-Werk „Folge 13: Der Geist von Cherry Town" hat 18 Titel, das
GLEICHNAMIGE Lokal-Werk (die Aufnahmen) nur 7 — und beides sind getrennte
Werke in /api/werke. Wer per Namensvergleich „das Werk zum Album" sucht
(so macht es die Aufnahme-Seite der Verwaltung, aufzeichnen.ts), kann das
LOKALE erwischen und haelt dann 7 fuer alles: nichts gilt mehr als fehlend,
nichts wird zum Nachladen angeboten.

Dazu der zweite Befund derselben Messung: dieselben lokalen Alben liegen
DOPPELT auf der Platte (media/audiobook/<interpret> UND
media/music/<interpret>) und damit doppelt in der Werkliste.

Diese Probe zaehlt beides an der lebenden Box:
  * Werk-Gruppen mit gleichem (normalisiertem) Titel+Interpret, aber
    mehreren Eintraegen — je Gruppe die Dienste und Titelzahlen.
  * Gruppen, in denen die Titelzahlen AUSEINANDERLIEGEN (das ist die
    gefaehrliche Sorte: die Namenssuche kann die kleine Fassung treffen).

AUFRUF
------
    python3 tools/box/werk-zwillinge-probe.py
    python3 tools/box/werk-zwillinge-probe.py --box 192.168.178.99 --json

Rein LESEND: GET /api/werke und je Zwilling GET /inhalt. Exit 1, wenn es
mindestens eine Gruppe mit auseinanderliegenden Titelzahlen gibt.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request

VORGABE_BOX = "192.168.178.62"
VORGABE_PORT = 8200


def norm(s: str) -> str:
    """Grob wie schluesselWort der Verwaltung: klein, nur Buchstaben/Ziffern."""
    return "".join(ch for ch in s.lower() if ch.isalnum())


def main() -> int:
    z = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    z.add_argument("--box", default=VORGABE_BOX)
    z.add_argument("--port", type=int, default=VORGABE_PORT)
    z.add_argument("--json", action="store_true")
    a = z.parse_args()
    basis = f"http://{a.box}:{a.port}"

    def api(pfad: str) -> dict:
        with urllib.request.urlopen(basis + pfad, timeout=25) as r:
            return json.load(r)

    try:
        werke = api("/api/werke").get("werke", [])
    except Exception as f:
        print(f"Werkliste nicht lesbar ({basis}/api/werke): {f}", file=sys.stderr)
        return 1

    gruppen: dict[str, list[dict]] = {}
    for w in werke:
        schl = norm(str(w.get("titel", ""))) + "|" + norm(str(w.get("interpret", "")))
        gruppen.setdefault(schl, []).append(w)

    zwillinge = {k: v for k, v in gruppen.items() if len(v) > 1}
    schief = []
    ausgabe = []
    for k, xs in sorted(zwillinge.items()):
        zeilen = []
        zahlen = set()
        for x in xs:
            s = str(x.get("schluessel", ""))
            dienst = (x.get("quellen") or [{}])[0].get("dienst", "?")
            try:
                inhalt = api("/api/werke/" + urllib.parse.quote(s, safe="") + "/inhalt?verschmelzen=1")
                n = len(inhalt.get("titel") or [])
            except Exception:
                n = -1
            zahlen.add(n)
            zeilen.append({"dienst": dienst, "kategorie": x.get("kategorie"), "titel": n, "schluessel": s})
        eintrag = {"gruppe": k, "fassungen": zeilen, "auseinander": len(zahlen - {-1}) > 1}
        if eintrag["auseinander"]:
            schief.append(eintrag)
        ausgabe.append(eintrag)

    if a.json:
        print(json.dumps({"werke": len(werke), "zwillingsgruppen": len(zwillinge),
                          "auseinander": schief}, ensure_ascii=False, indent=1))
    else:
        print(f"{len(werke)} Werke, {len(zwillinge)} Zwillingsgruppen, "
              f"{len(schief)} davon mit auseinanderliegenden Titelzahlen.")
        for e in ausgabe:
            marke = "SCHIEF" if e["auseinander"] else "gleich"
            teile = ", ".join(f"{f['dienst']}/{f['kategorie']}={f['titel']}" for f in e["fassungen"])
            print(f"  {marke}  {e['gruppe'][:55]:55s} {teile}")
    return 1 if schief else 0


if __name__ == "__main__":
    sys.exit(main())
