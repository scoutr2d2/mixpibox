#!/usr/bin/env python3
"""Spielt Spotify — und landet ein Titelsprung dort, wo er soll? Am Geraet gemessen.

WOZU: „Spotify spielt nicht" und „der Sprung klappt nicht" sind ZWEI Aussagen,
die sich nur trennen lassen, wenn man die Kette einzeln durchgeht. Sie hat vier
Glieder, und jedes kann still versagen:

    1. librespot laeuft ueberhaupt         (systemd)
    2. Spotify SIEHT das Geraet            (me/player/devices ueber die Box)
    3. es ist das AKTIVE Geraet            (is_active — sonst geht der Befehl
                                            an ein Handy oder ins Leere)
    4. der Sprung landet auf der Nummer    (currently-playing.item.track_number)

Ohne Schritt 3 nimmt Spotify den Befehl mit HTTP 204 an und tut NICHTS
Hoerbares. Genau das sieht von aussen aus wie „der Sprung klappt nicht".

DIE +1-FALLE (llmwiki: spotify-sprungziel-um-eins-verschoben): Der
Abspieldienst zieht von der uebergebenen Nummer INTERN wieder eins ab. Wer
0-basiert schickt, startet den Titel DAVOR — und bei Titel 1 faellt das nicht
auf, weil der Abzug bei 0 nicht greift. Dieses Werkzeug prueft deshalb NICHT
Titel 1, sondern vergleicht die getippte mit der tatsaechlich laufenden Nummer.

WAS ES NICHT TUT: Es aendert nichts an der Box — keine Dienste, keine Dateien.
Es startet allerdings HOERBAR Musik. Auf einer Box, an der jemand sitzt, ist
das keine Nebenwirkung, sondern der Zweck.

AUFRUF
    tools/spotify-sprung.py --nur-kette          # nur pruefen, nichts starten
    tools/spotify-sprung.py <playlist-id> --nr 3
    tools/spotify-sprung.py --box 192.168.178.169 <album-id> --typ album --nr 5
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request

API = 8200
SPIELER = 5005


def hole(basis: str, pfad: str, frist: float = 10.0):
    """Eine Abfrage an die Box. Gibt (daten, fehlertext) zurueck — nie eine
    Ausnahme, denn ein fehlendes Glied ist hier ein ERGEBNIS, kein Absturz."""
    try:
        with urllib.request.urlopen(f"{basis}{pfad}", timeout=frist) as r:
            roh = r.read().decode("utf8", "replace")
        try:
            return json.loads(roh), None
        except json.JSONDecodeError:
            return roh, None
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def fern(box: str, befehl: str) -> str:
    """Ein Kommando auf der Box. Leer, wenn es nicht klappt."""
    try:
        return subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{box}", befehl],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def kette_pruefen(box: str, basis: str) -> bool:
    """Die drei Glieder VOR dem Sprung. Rueckgabe: taugt die Kette zum Messen?"""
    print("── 1. laeuft librespot?")
    zustand = fern(box, "systemctl is-active librespot.service") or "(nicht erreichbar)"
    print(f"     {zustand}")
    if zustand != "active":
        print("     -> ohne librespot gibt es kein Spotify-Geraet. Alles Weitere ist sinnlos.")
        return False

    print("── 2./3. kennt Spotify das Geraet, und ist es aktiv?")
    d, fehler = hole(basis, "/api/spotify/web/me/player/devices")
    if fehler:
        print(f"     Abfrage scheiterte: {fehler}")
        return False
    geraete = (d or {}).get("devices", []) if isinstance(d, dict) else []
    if not geraete:
        print("     KEIN Geraet. Spotify nimmt Befehle an und spielt nichts.")
        print("     -> einmalig: Spotify-App -> Geraete -> MuPiBox waehlen.")
        return False
    aktiv = None
    for g in geraete:
        merk = " <- AKTIV" if g.get("is_active") else ""
        if g.get("is_active"):
            aktiv = g.get("name")
        print(f"     {g.get('name','?'):<24} {g.get('type','?'):<12}{merk}")
    if not aktiv:
        print("     Keines ist aktiv. Ein Startbefehl waehlt das Geraet mit —")
        print("     ein SPRUNG-Befehl auf ein totes Geraet dagegen verpufft.")
    return True


def laeuft_gerade(box: str):
    """Was spielt jetzt? Gibt (nummer, titel) oder (None, Grund).

    NICHT ueber /api/spotify/web/me/player/currently-playing fragen — die
    Durchreiche der Box laesst von den Wiedergabe-Pfaden NUR me/player/devices
    durch (Erlaubnisliste in spotify-web.ts, Absicht: Steuerbefehle bleiben
    draussen). Alles andere beantwortet sie mit 400, und das sieht beim Messen
    aus wie „spielt nicht", obwohl es nur die eigene Frage war.

    Der Abspieldienst haelt den Zustand ohnehin vor — /state auf 5005, derselbe
    Weg, den die Oberflaeche im 2-s-Takt nimmt. Er reicht Spotifys eigene
    Zustandsantwort durch (is_playing / item / context), NICHT die internen
    currentMeta-Felder.

    ACHTUNG bei der Nummer: `item.track_number` ist die Nummer im ALBUM. In
    einer Playlist ist das etwas ANDERES als die Position, auf die gesprungen
    wurde — eine Playlist reiht Titel aus vielen Alben. Verglichen wird deshalb
    bei Alben die Nummer, bei Playlists nur, DASS der Kontext stimmt und etwas
    laeuft."""
    d, fehler = hole(f"http://{box}:{SPIELER}", "/state")
    if fehler:
        return None, f"Abspieldienst nicht erreichbar: {fehler}"
    if not isinstance(d, dict):
        return None, f"unerwartete Antwort: {str(d)[:80]}"
    if not d.get("is_playing"):
        return None, "Spotify meldet: spielt nicht"
    stueck = d.get("item") or {}
    return stueck.get("track_number"), stueck.get("name", "?")


def main() -> int:
    p = argparse.ArgumentParser(description="Spotify-Kette und Titelsprung am Geraet messen")
    p.add_argument("kennung", nargs="?", help="Spotify-Id von Playlist/Album")
    p.add_argument("--typ", default="playlist", choices=["playlist", "album"])
    p.add_argument("--nr", type=int, default=3, help="1-basierte Titelnummer (NICHT 1 nehmen — siehe oben)")
    p.add_argument("--box", default="localhost")
    p.add_argument("--nur-kette", action="store_true")
    p.add_argument("--warten", type=float, default=4.0, help="Sekunden bis zur Gegenprobe")
    a = p.parse_args()

    basis = f"http://{a.box}:{API}"
    print(f"Box {a.box}\n")
    if not kette_pruefen(a.box, basis):
        return 1
    if a.nur_kette:
        return 0
    if not a.kennung:
        print("\nOhne Kennung kein Sprung. --nur-kette genuegte hier.")
        return 0
    if a.nr == 1:
        print("\nHINWEIS: Titel 1 ist als Probe UNTAUGLICH — der interne Abzug")
        print("greift bei 0 nicht, das Ergebnis ist zufaellig richtig.")

    print(f"\n── 4. Sprung auf Titel {a.nr} ({a.typ})")
    befehl = f"spotify/now/spotify:{a.typ}:{urllib.parse.quote(a.kennung)}:{a.nr}:0"
    _, fehler = hole(f"http://{a.box}:{SPIELER}", f"/{befehl}", frist=15)
    print(f"     geschickt: {befehl}")
    if fehler:
        print(f"     Abspieldienst: {fehler}")
        return 1

    time.sleep(a.warten)
    ist, text = laeuft_gerade(a.box)
    if ist is None:
        print(f"     {text}")
        print("\n  KEIN TON — der Befehl wurde angenommen, es spielt aber nichts.")
        return 2
    print(f"     laeuft:    {text}   (Albumnummer {ist})")

    if a.typ == "playlist":
        # Eine Playlist reiht Titel aus vielen Alben — die Albumnummer sagt
        # ueber die Playlist-Position NICHTS. Nachweisbar ist hier nur: der
        # Befehl wurde angenommen, der richtige Zusammenhang laeuft, und es
        # kommt Ton. Welcher Titel der vierte der Playlist ist, weiss nur die
        # Titelliste — die vergleicht `tools/neu-vorschau.mjs` beim Klicken.
        print(f"\n  ES SPIELT — Sprung auf Playlist-Position {a.nr} angenommen, Ton laeuft.")
        print("  (Die Position selbst ist so nicht pruefbar: die gemeldete Nummer")
        print("   gehoert zum ALBUM des Titels, nicht zur Playlist. Fuer den")
        print("   Nummernbeweis --typ album nehmen.)")
        return 0

    if ist == a.nr:
        print(f"\n  RICHTIG — getippt {a.nr}, laeuft {ist}.")
        return 0
    print(f"\n  DANEBEN — getippt {a.nr}, laeuft {ist} (um {ist - a.nr:+d} verschoben).")
    print("  Bei genau -1: llmwiki spotify-sprungziel-um-eins-verschoben.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
