#!/usr/bin/env python3
"""Fragt Spotify DIREKT, ob ein Web-API-Pfad fuer DIESE Anwendung noch antwortet.

WOZU: Die Durchreiche der Box (`/api/spotify/web/...`) hat eine enge
Erlaubnisliste. Ein gesperrter Pfad antwortet 400 "Pfad nicht vorgesehen" —
und das sagt NICHTS darueber, ob Spotify ihn beantworten wuerde. Genau daran
haengt die Entscheidung, ob eine Reihe gebaut wird oder nicht: Spotify hat am
2024-11-27 mehrere Endpunkte fuer neue Anwendungen abgeschaltet
(related-artists, recommendations, audio-features, redaktionelle Playlists).
Eine Erlaubnis fuer einen toten Endpunkt ist eine Erlaubnis zu viel.

Dieses Skript laeuft AUF DER BOX (per tools/spotify-endpunkt-probe.sh
hineingefuettert) und umgeht die Erlaubnisliste, indem es mit dem Token der Box
unmittelbar api.spotify.com fragt.

WAS ES AENDERT: nichts. Es liest /etc/mupibox/mupiboxconfig.json und stellt
ausschliesslich GET-Anfragen. Der Token wird NIE ausgegeben — nur Pfad, Status
und ein kurzer Auszug der Antwort.

AUFRUF (vom Arbeitsplatz):
    tools/spotify-endpunkt-probe.sh 192.168.178.169 \
        'artists/352PojxBglNK0F7TBbCWJm/top-tracks?market=DE' \
        'artists/352PojxBglNK0F7TBbCWJm/related-artists'

Rueckgabe: 0 = alle Pfade 200, 1 = mindestens einer nicht.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

KONFIG = "/etc/mupibox/mupiboxconfig.json"


def zugang() -> str:
    """Ein frisches Zugriffsmerkmal — derselbe Weg wie webApiToken() im Server."""
    with open(KONFIG, encoding="utf-8") as f:
        sp = json.load(f).get("spotify") or {}
    if not sp.get("refreshToken") or not sp.get("clientId"):
        raise SystemExit("Spotify ist auf dieser Box nicht eingerichtet")
    daten = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": sp["refreshToken"],
            "client_id": sp["clientId"],
        }
    ).encode()
    anfrage = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=daten,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(anfrage, timeout=15) as antwort:
        return json.load(antwort)["access_token"]


def probe(token: str, pfad: str) -> int:
    anfrage = urllib.request.Request(
        f"https://api.spotify.com/v1/{pfad}",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(anfrage, timeout=15) as antwort:
            koerper = antwort.read().decode("utf-8", "replace")
            stand = antwort.status
    except urllib.error.HTTPError as e:
        koerper = e.read().decode("utf-8", "replace")
        stand = e.code
    except Exception as e:  # Netz weg — das ist KEIN Urteil ueber den Endpunkt
        print(f"{pfad}\n    nicht feststellbar: {e}")
        return 0

    print(f"{pfad}\n    HTTP {stand}")
    try:
        d = json.loads(koerper)
    except ValueError:
        print(f"    {koerper[:200]}")
        return stand
    # Nur Umrisse zeigen: Feldnamen und Mengen. Alles andere waere Rauschen,
    # und bei /me stuenden Kontonamen darin.
    if isinstance(d, dict):
        for schluessel, wert in d.items():
            if isinstance(wert, list):
                print(f"    {schluessel}: {len(wert)} Eintraege")
            elif isinstance(wert, dict):
                print(f"    {schluessel}: {{{', '.join(sorted(wert)[:6])}}}")
            elif schluessel in ("total", "limit", "offset", "error", "message", "status"):
                print(f"    {schluessel}: {wert}")
        if "items" in d and d["items"]:
            erstes = d["items"][0]
            if isinstance(erstes, dict):
                print(f"    items[0]: {{{', '.join(sorted(erstes))}}}")
        if "tracks" in d and isinstance(d["tracks"], list) and d["tracks"]:
            erstes = d["tracks"][0]
            if isinstance(erstes, dict):
                print(f"    tracks[0]: {{{', '.join(sorted(erstes))}}}")
    return stand


def main() -> int:
    pfade = sys.argv[1:]
    if not pfade:
        print(__doc__)
        return 2
    token = zugang()
    schlecht = 0
    for p in pfade:
        if probe(token, p) != 200:
            schlecht = 1
    return schlecht


if __name__ == "__main__":
    raise SystemExit(main())
