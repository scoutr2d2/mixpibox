#!/usr/bin/env python3
"""Was meldet der Spieler ueber die Zeit? — die Grundlage jeder Stueckelung.

    python3 spielerzustand-beobachten.py [sekunden]

Muss AUF DER BOX laufen, waehrend etwas spielt.

══ WOFUER ═════════════════════════════════════════════════════════════════

Das Mitschnitt-Plugin schneidet dort, wo sich die Titelkennung aendert, und
verschiebt den Schnitt um `progress_ms` zurueck. Beides sind ANNAHMEN ueber
`/state` — und am 16.08.2026 kamen dabei Stuecke von 1 Sekunde heraus,
obwohl 37 Sekunden aufgenommen waren.

Statt im Plugin zu raten, zeigt dieses Werkzeug, was wirklich kommt: jede
Sekunde eine Zeile, und markiert, WO sich etwas aendert. Danach ist
entweder klar, dass die Annahme falsch war, oder dass der Fehler woanders
sitzt.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request


def zustand():
    try:
        with urllib.request.urlopen("http://127.0.0.1:5005/state", timeout=3) as a:
            return json.load(a)
    except Exception as f:
        return {"__fehler": str(f)}


def kurz(d):
    """Genau die Felder, auf die sich das Plugin stuetzt."""
    s = d.get("item") or {}
    return {
        "uri": s.get("uri"),
        "id": s.get("id"),
        "name": (s.get("name") or "")[:34],
        "progress_ms": d.get("progress_ms"),
        "is_playing": d.get("is_playing"),
        "duration_ms": s.get("duration_ms"),
    }


def album_starten(kennung: str) -> str:
    """Ueber den Proxy, nicht am Spieler vorbei — sonst faellt kein Ereignis."""
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:8200/player/spotify/now/spotify:album:{kennung}:0:0", timeout=12
        ) as a:
            return a.read().decode(errors="replace")[:60]
    except Exception as f:
        return f"FEHLER {f}"


def main() -> int:
    dauer = int(sys.argv[1]) if len(sys.argv) > 1 else 45
    # Optional: nach N Sekunden selbst auf ein anderes Album schalten. Der
    # Wechsel muss WAEHREND der Beobachtung passieren, sonst sieht man ihn
    # nicht — und ihn von aussen einzutakten hat sich als unzuverlaessig
    # erwiesen.
    wechsel_nach = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    wechsel_auf = sys.argv[3] if len(sys.argv) > 3 else ""
    print(f"══ Spielerzustand, {dauer} s ══\n")
    print(f"{'t':>4}  {'spielt':<7} {'progress':>9}  {'uri/id':<38} name")
    vorher = None
    ende = time.time() + dauer
    t0 = time.time()
    while time.time() < ende:
        d = zustand()
        if "__fehler" in d:
            print(f"{time.time()-t0:>4.0f}  FEHLER {d['__fehler'][:60]}")
            time.sleep(1)
            continue
        k = kurz(d)
        schluessel = k["uri"] or k["id"]
        # NUR ZEIGEN, WAS SICH AENDERT — sonst ertrinkt der Befund in
        # Wiederholungen. Ein Wechsel bekommt eine Marke.
        wechsel = vorher is not None and schluessel != vorher
        marke = "  <<< WECHSEL" if wechsel else ""
        print(
            f"{time.time()-t0:>4.0f}  {str(k['is_playing']):<7} {str(k['progress_ms']):>9}  "
            f"{str(schluessel):<38} {k['name']}{marke}"
        )
        if wechsel:
            print(f"      → progress_ms beim Wechsel: {k['progress_ms']} "
                  f"(davon haengt ab, wie weit der Schnitt zurueckgelegt wird)")
        vorher = schluessel
        if wechsel_nach and wechsel_auf and time.time() - t0 >= wechsel_nach:
            print(f"      → schalte jetzt auf {wechsel_auf}: {album_starten(wechsel_auf)}")
            wechsel_nach = 0
        time.sleep(1)

    print("\nWorauf es ankommt:")
    print("  · Traegt `item` durchgehend dieselbe Kennung, solange ein Titel laeuft?")
    print("  · Faengt `progress_ms` beim Wechsel klein an — oder traegt es den")
    print("    Stand des VORIGEN Titels weiter? Im zweiten Fall zieht das Plugin")
    print("    viel zu viel ab, und jedes Stueck wird eine Sekunde lang.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
