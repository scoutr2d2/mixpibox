#!/usr/bin/env python3
"""Stellt Mediathek und Verfuegbarkeitspruefung einer Box gegenueber.

WOZU
    Beim Aufraeumen verschwundener Playlisten gibt es zwei Bezeichner fuer
    denselben Eintrag, und sie sind NICHT dasselbe:

        medienSchluessel  nimmt  id  VOR  playlistid   (medien.ts)
        kennungVon        nimmt  playlistid VOR id     (verfuegbar.ts)

    Ein Eintrag mit BEIDEN Feldern wird also unter der einen Zeichenkette
    geprueft und muesste unter der anderen entfernt werden. Wer den einen aus
    dem anderen baut, entfernt den falschen Eintrag — oder gar keinen und
    behauptet trotzdem Erfolg. Dieses Werkzeug zeigt fuer JEDE Zeile beide
    nebeneinander, dazu was die Box dazu sagt.

    Ausserdem beantwortet es die zweite stille Frage: WIE VIELE Eintraege
    werden ueberhaupt nie geprueft? Alles, was nicht bei Spotify liegt, faellt
    aus der Pruefung heraus; eine Karte „nicht mehr vorhanden" darf deshalb
    nie Vollstaendigkeit vortaeuschen.

WAS ES AENDERT
    NICHTS. Zwei lesende GET-Anfragen, kein ssh, kein POST. Die Pruefung
    stoesst es NICHT an — dafuer gibt es den Knopf in der Verwaltung.

AUFRUF
    tools/verfuegbarkeit-abgleich.py                      # 127.0.0.1:8200
    tools/verfuegbarkeit-abgleich.py 192.168.178.169
    tools/verfuegbarkeit-abgleich.py --nur-auffaellige
    MUPI_BASIS=http://box:8200 tools/verfuegbarkeit-abgleich.py

RUECKGABE
    0  alles beisammen
    1  mindestens eine Auffaelligkeit (Schluessel != Kennung, doppelte
       Schluessel, gemeldete Kennung ohne Eintrag)
    2  die Box war nicht zu erreichen
"""

import json
import os
import sys
import urllib.error
import urllib.request

FRIST = 20


def basis_aus_argumenten(argv):
    """Die Basisadresse: erst Argument, dann Umgebung, dann Rueckschleife."""
    for a in argv:
        if a.startswith("-"):
            continue
        if a.startswith("http://") or a.startswith("https://"):
            return a.rstrip("/")
        return f"http://{a}:8200"
    return os.environ.get("MUPI_BASIS", "http://127.0.0.1:8200").rstrip("/")


def holen(basis, pfad):
    with urllib.request.urlopen(f"{basis}{pfad}", timeout=FRIST) as a:
        return json.load(a)


def dienst_von(eintrag):
    """Wie medien.ts dienstVon — nur so weit, wie es hier gebraucht wird."""
    t = str(eintrag.get("type") or "").lower()
    if t.startswith("spotify"):
        return "spotify"
    if t.startswith("jellyfin"):
        return "jellyfin"
    if t in ("library", "local"):
        return "lokal"
    if t in ("radio", "rss"):
        return t
    return "anderes"


def kennung_von(eintrag):
    """Wie verfuegbar.ts kennungVon: playlistid, showid, audiobookid, dann id.

    BEWUSST NACHGEBAUT und nicht abgeleitet: dieses Werkzeug soll ja gerade
    zeigen, wenn die Box etwas ANDERES tut als erwartet. Waeche es die Antwort
    der Box als Massstab, koennte es den Unterschied nicht mehr sehen.
    """
    if not str(eintrag.get("type") or "").startswith("spotify"):
        return None
    for feld, art in (
        ("playlistid", "playlists"),
        ("showid", "shows"),
        ("audiobookid", "audiobooks"),
        ("id", "albums"),
    ):
        wert = str(eintrag.get(feld) or "").strip()
        if wert:
            return (art, wert)
    return None


def main():
    argv = sys.argv[1:]
    nur_auffaellige = "--nur-auffaellige" in argv
    basis = basis_aus_argumenten([a for a in argv if a != "--nur-auffaellige"])

    try:
        medien = holen(basis, "/api/medien")
        verf = holen(basis, "/api/medien/verfuegbarkeit")
    except (urllib.error.URLError, TimeoutError, OSError) as fehler:
        print(f"Box {basis} nicht erreichbar: {fehler}", file=sys.stderr)
        return 2

    eintraege = medien.get("eintraege") or []
    tot = set(verf.get("geloescht") or [])
    vorschlaege = {v.get("schluessel"): v for v in (verf.get("vorschlaege") or [])}

    print(f"Box:            {basis}")
    stand = verf.get("stand") or "noch nie"
    print(f"zuletzt geprueft: {stand}   ({verf.get('geprueft', 0)} Eintraege)")
    if verf.get("grund"):
        marke = "" if verf.get("taugte", True) else "  ← LAUF VERWORFEN"
        print(f"Befund des Laufs: {verf['grund']}{marke}")
    print()

    wie_oft = {}
    for e in eintraege:
        s = e.get("schluessel")
        wie_oft[s] = wie_oft.get(s, 0) + 1

    auffaellig = 0
    ungeprueft = {}
    zeilen = []
    gesehene_kennungen = set()

    for e in eintraege:
        schluessel = str(e.get("schluessel") or "")
        k = kennung_von(e)
        if not k:
            d = dienst_von(e)
            ungeprueft[d] = ungeprueft.get(d, 0) + 1
            continue
        art, kennung = k
        gesehene_kennungen.add(kennung)
        merkmale = []
        # Der Kern: traegt der Schluessel eine ANDERE Zeichenkette als die
        # Kennung, unter der geprueft wird?
        if not schluessel.endswith(f":{kennung}"):
            merkmale.append("SCHLUESSEL!=KENNUNG")
        if wie_oft.get(schluessel, 0) > 1:
            merkmale.append("DOPPELTER SCHLUESSEL")
        if kennung in tot:
            merkmale.append("gilt als geloescht")
        if schluessel in vorschlaege:
            v = vorschlaege[schluessel]
            merkmale.append(f"VORGESCHLAGEN ({v.get('laeufe')}x)")
        if "SCHLUESSEL!=KENNUNG" in merkmale or "DOPPELTER SCHLUESSEL" in merkmale:
            auffaellig += 1
        zeilen.append((schluessel, art, kennung, e.get("title") or "", merkmale))

    breite = max([len(z[0]) for z in zeilen] or [10])
    for schluessel, art, kennung, titel, merkmale in zeilen:
        if nur_auffaellige and not merkmale:
            continue
        rest = f"   [{', '.join(merkmale)}]" if merkmale else ""
        print(f"{schluessel:<{breite}}  {art:<10} {kennung:<24} {titel[:34]}{rest}")

    # Gemeldet, aber in der Bibliothek nicht (mehr) zu finden — das darf es
    # nach dem Aufraeumen nicht geben.
    verwaist = sorted(tot - gesehene_kennungen)
    print()
    if ungeprueft:
        teile = ", ".join(f"{n}x {d}" for d, n in sorted(ungeprueft.items()))
        print(f"NICHT geprueft (keine Spotify-Kennung): {teile}")
        print("  -> eine Liste 'nicht mehr vorhanden' ist damit NIE vollstaendig.")
    if verwaist:
        auffaellig += len(verwaist)
        print(f"Als geloescht gemeldet, aber kein Eintrag dazu: {', '.join(verwaist)}")
    print(f"{len(zeilen)} pruefbar, {len(tot)} gelten als geloescht, {len(vorschlaege)} werden angeboten.")

    return 1 if auffaellig else 0


if __name__ == "__main__":
    sys.exit(main())
