#!/usr/bin/env python3
"""Wie lange dauert ein Titeltipp am GERAET — und was richtet ein zweiter an?

══ DIE MELDUNG ═════════════════════════════════════════════════════════════
Betreiber, 04.09.2026: „beim klicken von titeln gibt es eine verzoegerung
das man nochmal klickt dadurch wird es mehrfach gefeuert."

Zwei Aussagen in einem Satz, und sie brauchen VERSCHIEDENE Messungen:

  1. WIE LANGE dauert es wirklich, bis auf einen Titeltipp etwas passiert?
  2. WAS TUT die Box, wenn in dieser Zeit ein zweiter Tipp kommt?

Fuer (2) gibt es serverseitig eine Antwort — `spielLaufBeginnen()` setzt eine
Laufnummer, und jeder aeltere Lauf steigt beim naechsten `meinLauf !==
spielLauf` aus (server.ts). Ob die Ablöse den zweiten Tipp WIRKLICH billig
macht oder ob jeder Tipp die volle Anhalte-Start-Kette bezahlt, sagt nur die
Messung.

══ WARUM AM GERAET UND NICHT AN DER ATTRAPPE ═══════════════════════════════
Die Verzoegerung entsteht dort, wo die Box mit Spotify redet: Anhalten mit
Bestaetigung, Atempause, Startbefehl, Liste holen, springen. Eine Attrappe
antwortet sofort und wuerde genau die Frage wegdefinieren, um die es geht
[llmwiki attrappe-luegt-durch-weglassen]. ALSO MACHT DIESES WERKZEUG TON.
Es misst die Lautstaerke vorher, stellt sie NICHT um und haelt am Ende an.

══ WAS ES MISST ════════════════════════════════════════════════════════════
    t_inhalt   GET /api/werke/<s>/inhalt   — die Liste, die die Lane zeigt
    t_post     POST /api/spielen           — bis die Oberflaeche eine Antwort hat
    t_ton      POST-Beginn -> /player/local meldet `playing`
               (bei Spotify zusaetzlich ueber /player/state gegengelesen,
                weil `playing` in /local dort verzoegert nachzieht)

Die dritte Zahl ist die, die das Kind spuert. Die zweite ist die, nach der
sich die Oberflaeche richtet — wenn beide weit auseinanderliegen, ist das
der Befund.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/titeltipp-verzoegerung.py --werk <schluessel> --titel 3
    python3 tools/titeltipp-verzoegerung.py --werk <s> --titel 3 --doppel 3
    python3 tools/titeltipp-verzoegerung.py --api http://192.168.178.62:8200
    python3 tools/titeltipp-verzoegerung.py --liste        # nur Werke zeigen

--doppel N feuert N Tipps auf DENSELBEN Titel im Abstand --abstand (Vorgabe
900 ms, ungefaehr die Zeit, nach der ein ungeduldiger Finger nachsetzt) und
protokolliert je Tipp Status und Dauer. Am Ende steht, WAS die Box spielt —
denn genau das ist die Frage: kommt bei drei Tipps dreimal derselbe Start
heraus, oder bleibt am Ende etwas anderes uebrig?

Rueckgabe: 0 gemessen  2 Umgebung/Box nicht erreichbar
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Die Oberflaeche wartet bis 25 s auf /api/spielen (NewDesign/app.js,
# `spielenAnfordern`). Wer kuerzer misst, misst nicht, was sie erlebt.
FRIST_S = 26.0
# Wie lange nach dem Start auf Ton gewartet wird, bevor „kein Ton" gilt.
TON_FRIST_S = 20.0
TAKT_S = 0.15


def hole(api: str, pfad: str, frist: float = 12.0) -> tuple[int, object, float]:
    """GET mit Zeitnahme — Status, Koerper, Dauer in Sekunden."""
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(f"{api}{pfad}", timeout=frist) as a:
            roh = a.read()
            return a.status, _json(roh), time.monotonic() - t0
    except urllib.error.HTTPError as f:
        return f.code, _json(f.read()), time.monotonic() - t0
    except Exception:  # noqa: BLE001
        return 0, None, time.monotonic() - t0


def sende(api: str, pfad: str, koerper: dict, frist: float = FRIST_S) -> tuple[int, object, float]:
    """POST mit Zeitnahme — dieselbe Anfrage, die die Oberflaeche schickt."""
    daten = json.dumps(koerper).encode()
    anfrage = urllib.request.Request(
        f"{api}{pfad}", data=daten, method="POST",
        headers={"content-type": "application/json", "accept": "application/json"},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(anfrage, timeout=frist) as a:
            return a.status, _json(a.read()), time.monotonic() - t0
    except urllib.error.HTTPError as f:
        return f.code, _json(f.read()), time.monotonic() - t0
    except Exception:  # noqa: BLE001
        return 0, None, time.monotonic() - t0


def _json(roh: bytes | None) -> object:
    try:
        return json.loads(roh or b"")
    except Exception:  # noqa: BLE001
        return None


def zustand(api: str) -> dict:
    """`/player/local` — das ist die Quelle, aus der die Oberflaeche liest."""
    _, k, _ = hole(api, "/player/local", frist=6.0)
    return k if isinstance(k, dict) else {}


def spielt_schon(api: str) -> bool:
    """Spotify meldet seinen Lauf in `/player/state`, nicht in `/local`."""
    z = zustand(api)
    if z.get("playing") is True:
        return True
    _, s, _ = hole(api, "/player/state", frist=6.0)
    return bool(isinstance(s, dict) and s.get("is_playing") is True)


def auf_ton_warten(api: str, ab: float) -> float | None:
    """Sekunden vom Tippbeginn bis zum ersten gemeldeten Lauf — oder None."""
    ende = ab + TON_FRIST_S
    while time.monotonic() < ende:
        if spielt_schon(api):
            return time.monotonic() - ab
        time.sleep(TAKT_S)
    return None


def werke_holen(api: str) -> list[dict]:
    _, k, _ = hole(api, "/api/werke?verschmelzen=1", frist=20.0)
    return (k or {}).get("werke", []) if isinstance(k, dict) else []


def main() -> int:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--api", default="http://192.168.178.62:8200")
    a.add_argument("--werk", help="Schluessel des Werks (siehe --liste)")
    a.add_argument("--titel", type=int, default=3, help="Titelnummer, die getippt wird")
    a.add_argument("--doppel", type=int, default=1, help="wie viele Tipps hintereinander")
    a.add_argument("--abstand", type=int, default=900, help="Millisekunden zwischen den Tipps")
    a.add_argument("--liste", action="store_true", help="nur die Werke der Box zeigen")
    a.add_argument("--nicht-anhalten", action="store_true", help="am Ende weiterlaufen lassen")
    args = a.parse_args()

    werke = werke_holen(args.api)
    if not werke:
        print(f"Box antwortet nicht mit Werken ({args.api}).", file=sys.stderr)
        return 2

    if args.liste:
        for w in werke:
            q = ",".join(str((x or {}).get("dienst") or "") for x in (w.get("quellen") or []))
            print(f"{w.get('schluessel')}\t{w.get('interpret')} — {w.get('titel')}\t[{q}]")
        return 0

    if not args.werk:
        print("--werk fehlt. Mit --liste die Schluessel zeigen.", file=sys.stderr)
        return 2
    werk = next((w for w in werke if w.get("schluessel") == args.werk), None)
    if not werk:
        print(f"Werk nicht in der Auswahl dieser Box: {args.werk}", file=sys.stderr)
        return 2

    vorher = zustand(args.api)
    print(f"Box  {args.api}")
    print(f"Werk {werk.get('interpret')} — {werk.get('titel')}")
    print(f"Lautstaerke {vorher.get('volume')}   spielt gerade: {vorher.get('playing')}"
          f"   Maschine: {vorher.get('currentPlayer') or '—'}")
    print()

    # ── (1) Die Liste, die die Lane zeigt ───────────────────────────────────
    st, inhalt, t_inhalt = hole(args.api, f"/api/werke/{urllib.parse.quote(args.werk, safe='')}/inhalt?verschmelzen=1", frist=25.0)
    titel = (inhalt or {}).get("titel", []) if isinstance(inhalt, dict) else []
    print(f"  t_inhalt   {t_inhalt*1000:7.0f} ms   GET /inhalt  ({st}, {len(titel)} Titel)")
    gewaehlt = next((t for t in titel if int(t.get("nr") or 0) == args.titel), None)
    if gewaehlt:
        q = gewaehlt.get("quelle") or (gewaehlt.get("quellen") or [None])[0]
        print(f"             Titel {args.titel}: {gewaehlt.get('titel')}  [{q}]")
    print()

    # ── (2) Die Tipps ───────────────────────────────────────────────────────
    print(f"  {args.doppel} Tipp(e) auf Titel {args.titel}, Abstand {args.abstand} ms:")
    t_start = time.monotonic()
    ergebnisse = []
    for i in range(args.doppel):
        if i:
            time.sleep(args.abstand / 1000.0)
        st, k, dauer = sende(args.api, "/api/spielen", {"schluessel": args.werk, "titelNr": args.titel})
        urteil = (k or {}).get("ergebnis") or (k or {}).get("grund") or "—" if isinstance(k, dict) else "—"
        ergebnisse.append((st, urteil, dauer))
        print(f"    Tipp {i+1}   t_post {dauer*1000:7.0f} ms   HTTP {st}   {urteil}")

    # ── (3) Bis wirklich Ton kommt ──────────────────────────────────────────
    t_ton = auf_ton_warten(args.api, t_start)
    print()
    if t_ton is None:
        print(f"  t_ton      —          kein Lauf gemeldet innerhalb {TON_FRIST_S:.0f} s")
    else:
        print(f"  t_ton      {t_ton*1000:7.0f} ms   ab erstem Tipp bis gemeldetem Lauf")

    # ── (4) Was am Ende laeuft ──────────────────────────────────────────────
    time.sleep(2.0)
    nach = zustand(args.api)
    print(f"  danach     Titel {nach.get('currentTracknr') or '?'} von {nach.get('totalTracks') or '?'}"
          f"   „{nach.get('currentTrackname') or nach.get('activeSpotifyId') or '—'}\"")

    langsam = max(d for _, _, d in ergebnisse)
    print()
    print(f"  BILANZ  langsamster Tipp {langsam*1000:.0f} ms"
          + (f", spuerbarer Anlauf {t_ton*1000:.0f} ms" if t_ton is not None else ""))
    if langsam > 0.4:
        print("          Ueber 400 ms ohne Rueckmeldung setzt ein Finger nach — genau die Meldung.")

    # Anhalten auf demselben Weg wie die Oberflaeche (`spielerBefehl('stop')`
    # in NewDesign/app.js): GET /player/current/stop.
    if not args.nicht_anhalten:
        hole(args.api, "/player/current/stop", frist=12.0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
