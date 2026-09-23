#!/usr/bin/env python3
"""Wer erneuert den Spotify-Zugang der Box — der Browser oder die Box selbst?

WARUM DIESE FRAGE DIE WICHTIGSTE VON E15 IST: Wenn `/api/spotify/config`
aufhoert, `clientId` und `refreshToken` herauszugeben (E15/S4), verliert der
BROWSER die Faehigkeit zu erneuern. Kostet das den Benutzer seine Anmeldung?
Eine Neuanmeldung ist teuer — sie geht nur AN DER BOX, weil Spotifys Rueckweg
127.0.0.1 verlangt ([[spotify-rueckweg-haengt-an-der-adresse]]).

DESHALB WIRD GEMESSEN, NICHT GELESEN. Drei Fragen, drei Messungen:

  1. Gibt der ABSPIELDIENST von sich aus einen gueltigen Zugang heraus?
     (`GET /player/spotify/token` -> backend-player `/spotify/token`)
  2. Kommt das HINTERGRUNDSTUECK ohne Browser an einen Zugang?
     (`GET /api/spotify/bereit` benutzt serverseitig `webApiToken()`)
  3. Genuegen die auf der Box gespeicherten Zugangsdaten ALLEIN, um bei
     Spotify zu erneuern? — der eigentliche Beweis. Dieselbe Anfrage, die die
     Box stuendlich stellt; sie aendert nichts (Spotify tauscht PKCE-
     Erneuerungsmerkmale nicht aus, siehe spotify-control.ts:490).

Ist 3 gruen, ist der Browser NICHT in der tragenden Kette — dann darf S4
kommen, ohne dass jemand sich neu anmelden muss.

    tools/spotify-erneuerung-wer.py [--host 192.168.178.169]

Verandert NICHTS auf der Box. Druckt KEIN Geheimnis ab.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

FRIST_S = 20


def holen(adresse: str, daten: bytes | None = None, kopf: dict[str, str] | None = None):
    """(Status, Rohtext). Wirft nie."""
    anfrage = urllib.request.Request(adresse, data=daten, headers=kopf or {})
    try:
        with urllib.request.urlopen(anfrage, timeout=FRIST_S) as antwort:
            return antwort.status, antwort.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as fehler:
        return fehler.code, fehler.read().decode("utf-8", "replace")
    except Exception as fehler:
        return 0, f"{type(fehler).__name__}: {fehler}"


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--host", default="192.168.178.169")
    zerleger.add_argument("--port", type=int, default=8200)
    zerleger.add_argument(
        "--ohne-spotify",
        action="store_true",
        help="Frage 3 auslassen (kein Aufruf an accounts.spotify.com)",
    )
    args = zerleger.parse_args()
    basis = f"http://{args.host}:{args.port}"
    print(f"Wer erneuert den Spotify-Zugang? — gemessen gegen {basis}\n")

    # ── 0. Steht die Box? EINMAL, vor jeder Messung ─────────────────────────
    # WARUM (24.08.2026): `holen` wirft nie und gibt bei totem Draht Status 0.
    # Jede Zeile unten liest Status 0 als eine ANTWORT der Box. An der
    # abgeschalteten Box druckte dieses Werkzeug darum „1 NEIN / 2 NEIN" und
    # dazu „Zugangsdaten nicht mehr abrufbar (= Ziel von E15/S4)" — es las den
    # ausgefallenen Draht als BESTAETIGUNG, dass ein Umbau geglueckt sei. Eine
    # falsche Bestaetigung wiegt schwerer als eine falsche Widerlegung: sie
    # schliesst eine Frage, statt eine aufzumachen.
    if holen(f"{basis}/api/spotify/bereit")[0] == 0:
        print(f"ABBRUCH: {basis} antwortet nicht — es wurde NICHTS gemessen.")
        print("Kein Urteil. Box einschalten und erneut laufen lassen.")
        return 2

    # ── 1. Der Abspieldienst ────────────────────────────────────────────────
    status, text = holen(f"{basis}/player/spotify/token")
    # Der Weg antwortet mit dem nackten Token, nicht mit JSON. Nur die LAENGE
    # wird genannt — ein Token gehoert nicht in ein Protokoll.
    gut = status == 200 and len(text) > 100 and not text.startswith("Error")
    print(f"  1  Abspieldienst gibt Zugang heraus     {status:>4}  {'JA' if gut else 'NEIN'}  ({len(text)} Zeichen)")
    dienst_ok = gut

    # ── 2. Das Hintergrundstueck, serverseitig ──────────────────────────────
    status, text = holen(f"{basis}/api/spotify/bereit")
    try:
        urteil = json.loads(text)
    except json.JSONDecodeError:
        urteil = {}
    # `bereit` sagt etwas ueber das GERAET, nicht ueber den Zugang. Fuer diese
    # Frage zaehlt nur: kam die Auskunft ohne 503 „nicht eingerichtet"?
    zugang_da = status == 200
    print(f"  2  Hintergrundstueck ohne Browser       {status:>4}  {'JA' if zugang_da else 'NEIN'}  {urteil}")

    # ── 3. Der Beweis: erneuern die Daten der Box allein? ───────────────────
    if args.ohne_spotify:
        print("  3  Erneuerung bei Spotify              ---  ausgelassen")
        return 0

    status, text = holen(f"{basis}/api/spotify/config")
    try:
        cfg = json.loads(text)
    except json.JSONDecodeError:
        cfg = {}
    client_id = str(cfg.get("clientId") or "")
    refresh = str(cfg.get("refreshToken") or "")
    if not client_id or not refresh:
        # NACH S4 ist genau das der Normalfall — dann ist diese Frage von hier
        # aus nicht mehr messbar, und das ist der Erfolg, nicht der Fehler.
        print("  3  Erneuerung bei Spotify              ---  Zugangsdaten nicht mehr abrufbar (= Ziel von E15/S4)")
        print("\n     Ab hier nur noch AUF der Box messbar, z.B. mit `mupi-check spotifykette`.")
        return 0

    koerper = urllib.parse.urlencode(
        {"grant_type": "refresh_token", "refresh_token": refresh, "client_id": client_id}
    ).encode()
    status, text = holen(
        "https://accounts.spotify.com/api/token",
        koerper,
        {"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        tok = json.loads(text)
    except json.JSONDecodeError:
        tok = {}
    frisch = bool(tok.get("access_token"))
    print(
        f"  3  Erneuerung bei Spotify              {status:>4}  {'JA' if frisch else 'NEIN'}"
        f"  (gilt {tok.get('expires_in', '?')} s, neues Erneuerungsmerkmal: {'ja' if tok.get('refresh_token') else 'nein'})"
    )

    print()
    if dienst_ok and frisch:
        print("  URTEIL: Die auf der Box gespeicherten Zugangsdaten genuegen ALLEIN.")
        print("          Der Browser ist NICHT in der tragenden Kette — E15/S4 kostet")
        print("          keine Neuanmeldung.")
    else:
        print("  URTEIL: NICHT bewiesen. S4 zurueckstellen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
