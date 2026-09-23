#!/usr/bin/env python3
"""Verfolgt einen Titelwechsel auf der Box und stellt den ABSPIELZUSAMMENHANG
davor und danach nebeneinander.

WOZU
  Die Meldung war: "beim Wechsel des Titels geht die Marke 'spielt gerade'
  nicht mit". Die Marke vergleicht `context.uri` der laufenden Wiedergabe mit
  der Kennung des Werks. Wenn der Zusammenhang beim Weiterschalten wechselt,
  ist die Marke im Recht und die WIEDERGABE im Unrecht. Genau das misst dieses
  Werkzeug — fuer Playlist, Album und lokale Wiedergabe.

  Zusaetzlich liest es Spotifys eigene WARTESCHLANGE mit. Sie ist die einzige
  Stelle, an der man VOR dem Weiterschalten sieht, was als naechstes kommt —
  und ob dort ueberhaupt noch Titel des laufenden Werks stehen.

WAS ES AENDERT
  --schau      NICHTS. Nur lesen (Zustand + Warteschlange).
  --weiter     schickt EINEN `next`-Befehl an die Box (die Wiedergabe springt).
  --start URI  startet ein Werk (`spotify/now/...`) — die laufende Wiedergabe
               wird dabei ersetzt.
  Es wird nichts dauerhaft umgestellt, kein Dienst neu gestartet.

AUFRUF
  python3 tools/spotify-weiterschalten.py --schau
  python3 tools/spotify-weiterschalten.py --weiter
  python3 tools/spotify-weiterschalten.py --start spotify:playlist:<id>:1:0 --weiter
  python3 tools/spotify-weiterschalten.py --start spotify:album:<id>:1:0 --weiter
  (--box <adresse> setzt eine andere Box, Vorgabe 192.168.178.169)

VORSICHT
  Der Zugang (Token) wird von der Box geholt und NIE ausgegeben.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VORGABE_BOX = "192.168.178.169"
PLAYER_PORT = 5005


def hole(url, token=None, frist=10):
    anfrage = urllib.request.Request(url)
    if token:
        anfrage.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(anfrage, timeout=frist) as antwort:
            roh = antwort.read().decode("utf-8", "replace")
            return antwort.status, roh
    except urllib.error.HTTPError as fehler:
        return fehler.code, fehler.read().decode("utf-8", "replace")
    except Exception as fehler:  # Netz weg, Frist abgelaufen
        return 0, str(fehler)


def json_oder_none(roh):
    try:
        return json.loads(roh)
    except Exception:
        return None


def token_holen(box):
    stand, roh = hole(f"http://{box}:{PLAYER_PORT}/spotify/token")
    if stand != 200 or not roh or roh.startswith("Error"):
        return None
    return roh.strip()


def zustand_holen(box):
    stand, roh = hole(f"http://{box}:{PLAYER_PORT}/state")
    if stand != 200:
        return None
    return json_oder_none(roh)


def kurz(zustand):
    """Die vier Angaben, um die es geht — mehr verwirrt beim Vergleichen."""
    if not zustand:
        return {"leer": True}
    stueck = zustand.get("item") or {}
    zusammenhang = zustand.get("context") or {}
    return {
        "titel": stueck.get("name"),
        "titel_uri": stueck.get("uri"),
        "album": (stueck.get("album") or {}).get("name"),
        "zusammenhang": zusammenhang.get("uri"),
        "art": zusammenhang.get("type"),
        "spielt": zustand.get("is_playing"),
        "position_ms": zustand.get("progress_ms"),
        "zufall": zustand.get("shuffle_state"),
        "klug_zufall": zustand.get("smart_shuffle"),
        "wiederholen": zustand.get("repeat_state"),
    }


def zeile(name, wert):
    print(f"  {name:<16} {wert}")


def zustand_zeigen(ueberschrift, k):
    print(ueberschrift)
    for name in ("titel", "titel_uri", "album", "zusammenhang", "art", "spielt",
                 "position_ms", "zufall", "klug_zufall", "wiederholen"):
        zeile(name, k.get(name))


def warteschlange_zeigen(box, token, anzahl=8):
    """Spotifys eigene Warteschlange. Zeigt, was OHNE Zutun als naechstes kaeme."""
    if not token:
        print("  (kein Zugang — Warteschlange nicht lesbar)")
        return None
    stand, roh = hole("https://api.spotify.com/v1/me/player/queue", token)
    if stand != 200:
        print(f"  (Warteschlange: HTTP {stand})")
        return None
    daten = json_oder_none(roh) or {}
    jetzt = daten.get("currently_playing") or {}
    print(f"  laeuft:  {jetzt.get('name')}  [{jetzt.get('uri')}]")
    schlange = daten.get("queue") or []
    print(f"  danach ({len(schlange)} Eintraege, die ersten {anzahl}):")
    for i, t in enumerate(schlange[:anzahl]):
        album = (t.get("album") or {}).get("name")
        print(f"    {i + 1:>2}. {t.get('name')}   <{album}>   {t.get('uri')}")
    return daten


def befehl_an_box(box, pfad):
    """Die Oberflaeche spricht ueber /player/current/... mit dem Abspieldienst."""
    url = f"http://{box}:{PLAYER_PORT}/player/current/{pfad}"
    stand, roh = hole(url)
    print(f"  -> {url}\n     HTTP {stand} {roh[:120]!r}")
    return stand


def main():
    zerleger = argparse.ArgumentParser(description=__doc__,
                                       formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--box", default=VORGABE_BOX)
    zerleger.add_argument("--schau", action="store_true", help="nur lesen")
    zerleger.add_argument("--weiter", action="store_true", help="einen next-Befehl schicken")
    zerleger.add_argument("--start", default=None,
                          help="Werk starten, Form spotify:<art>:<id>:<nr>:<ms>")
    zerleger.add_argument("--warten", type=float, default=3.0,
                          help="Sekunden zwischen Befehl und Nachmessen (Spotify hinkt nach)")
    zerleger.add_argument("--mal", type=int, default=1,
                          help="wie oft weitergeschaltet wird")
    zerleger.add_argument("--verfolgen", type=float, default=0, metavar="SEKUNDEN",
                          help="im 2-s-Takt (wie die Oberflaeche) mitschreiben und jeden "
                               "Wechsel von Titel ODER Zusammenhang melden — so sieht man, "
                               "was die Marke beim SELBSTTAETIGEN Titelwechsel zu sehen bekommt")
    zerleger.add_argument("--letzter", default=None, metavar="URI",
                          help="Werk am LETZTEN Titel starten (Form spotify:playlist:<id> "
                               "oder spotify:album:<id>) — so laesst sich pruefen, was am "
                               "Ende eines Zusammenhangs geschieht (Spotifys Nachlauf)")
    args = zerleger.parse_args()

    if args.letzter:
        art = args.letzter.split(':')[1]
        kennung = args.letzter.split(':')[2]
        tok = token_holen(args.box)
        pfad = 'playlists' if art == 'playlist' else 'albums'
        stand, roh = hole(f"https://api.spotify.com/v1/{pfad}/{kennung}/tracks?limit=1", tok)
        gesamt = (json_oder_none(roh) or {}).get("total")
        if not gesamt:
            print(f"  (Laenge nicht ermittelbar: HTTP {stand})")
            return 1
        print(f"  {art} hat {gesamt} Titel — Start auf dem letzten")
        # 1-BASIERT hinaus: die -1 macht `playMe()` im Abspieldienst. Das ist
        # die +1-Falle aus dem Wiki, und sie gilt hier genauso.
        args.start = f"{args.letzter}:{gesamt}:0"

    if not (args.schau or args.weiter or args.start):
        args.schau = True

    token = token_holen(args.box)

    if args.start:
        print(f"== STARTEN: {args.start}")
        befehl_an_box(args.box, f"spotify/now/{urllib.parse.quote(args.start, safe=':')}")
        time.sleep(max(args.warten, 3.0))

    vorher = kurz(zustand_holen(args.box))
    zustand_zeigen("== VORHER", vorher)
    print("== WARTESCHLANGE VORHER")
    warteschlange_zeigen(args.box, token)

    if args.verfolgen:
        # DERSELBE TAKT WIE DIE OBERFLAECHE (dienstHolen, 2 s). Ein schnellerer
        # Takt zeigte Zwischenstaende, die die Oberflaeche nie sieht — und
        # verleitete dazu, ein Flackern zu erklaeren, das es dort gar nicht gibt.
        print(f"== VERFOLGEN ({args.verfolgen:.0f} s, Takt 2 s)")
        ende = time.time() + args.verfolgen
        letzt = None
        while time.time() < ende:
            k = kurz(zustand_holen(args.box))
            merkmal = (k.get("titel_uri"), k.get("zusammenhang"), k.get("spielt"))
            if merkmal != letzt:
                print(f"  {time.strftime('%H:%M:%S')}  {k.get('titel')!r:<45} "
                      f"zush={k.get('zusammenhang')}  spielt={k.get('spielt')}  "
                      f"pos={k.get('position_ms')}")
                letzt = merkmal
            time.sleep(2)

    if not args.weiter:
        return 0

    for i in range(max(1, args.mal)):
        print(f"== WEITERSCHALTEN (next {i + 1}/{args.mal})")
        befehl_an_box(args.box, "next")
        time.sleep(args.warten)
        zw = kurz(zustand_holen(args.box))
        zeile("danach", f"{zw.get('titel')}  |  {zw.get('zusammenhang')}")

    nachher = kurz(zustand_holen(args.box))
    zustand_zeigen("== NACHHER", nachher)
    print("== WARTESCHLANGE NACHHER")
    warteschlange_zeigen(args.box, token)

    print("== BEFUND")
    if vorher.get("zusammenhang") == nachher.get("zusammenhang"):
        zeile("Zusammenhang", "GLEICH GEBLIEBEN — die Marke darf mitgehen")
    else:
        zeile("Zusammenhang", "GEWECHSELT!")
        zeile("  vorher", vorher.get("zusammenhang"))
        zeile("  nachher", nachher.get("zusammenhang"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
