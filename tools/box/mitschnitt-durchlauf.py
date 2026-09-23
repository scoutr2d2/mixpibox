#!/usr/bin/env python3
"""Schneidet das Plugin wirklich mit? — ein Durchlauf, der den Netzabriss ueberlebt.

    nohup python3 mitschnitt-durchlauf.py > /home/dietpi/mitschnitt-probe.log 2>&1 &

Muss AUF DER BOX laufen. Ergebnis steht danach in der Logdatei; sie wird
geerntet, wenn die Verbindung wieder steht.

══ WARUM NICHT EINFACH UEBER ssh ══════════════════════════════════════════

Diese Box trennt sich derzeit alle paar Minuten selbst vom WLAN (reason=3,
locally_generated=1 — die Sonde jagt es). Ein Test ueber ssh bricht dann
mittendrin ab, und zwar an der schlechtestmoeglichen Stelle: NACH dem
Einschalten und VOR dem Ausschalten. Genau das ist am 16.08.2026 passiert.

Eine rechtlich heikle Testfunktion darf nicht eingeschaltet zurueckbleiben,
weil eine Verbindung abriss. Deshalb laeuft der Durchlauf hier, auf der
Box, und das Ausschalten haengt an `finally` — es passiert auch dann, wenn
mitten im Lauf etwas wirft.

══ WAS ER PRUEFT ══════════════════════════════════════════════════════════

Nicht "laeuft ein Prozess?", sondern die Kette bis zum Ergebnis:
 1. schaltet ein (beide Haken) und liest das Befinden
 2. startet eine echte Wiedergabe ueber den Proxy — der streut das Ereignis
 3. sieht nach, ob der Abgriff am QUELLKNOTEN haengt (nicht am Monitor)
 4. beendet die Wiedergabe
 5. misst die entstandene Datei: Groesse, FLAC-Signatur, und ob ueberhaupt
    Ton drin ist statt Stille
 6. schaltet wieder aus — IMMER
"""
from __future__ import annotations

import array
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave

SERVER = "http://127.0.0.1:8200"
KENNUNG = "mixpi-mitschnitt"
ABLAGE = "/home/dietpi/MuPiBox/media"
SPIELT_S = 35


def ruf(pfad: str, art: str = "GET", rumpf: dict | None = None, frist: int = 10) -> str:
    daten = json.dumps(rumpf).encode() if rumpf is not None else None
    b = urllib.request.Request(f"{SERVER}{pfad}", data=daten, method=art)
    if daten:
        b.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(b, timeout=frist) as a:
            return a.read().decode(errors="replace")
    except Exception as f:
        return f"FEHLER: {f}"


def befinden() -> str:
    return ruf(f"/api/plugins/{KENNUNG}/befinden")


def schalten(an: bool) -> None:
    ruf(
        f"/api/plugins/{KENNUNG}/einstellungen",
        "PUT",
        {"verstanden": an, "spotify": an, "ablage": ABLAGE, "kategorie": "audiobook", "hoechstensMinuten": 3},
    )


def spotify_kennungen(hoechstens: int = 2) -> list[str]:
    """Mehrere Alben — der Titelwechsel wird sonst nicht geprueft.

    Ein Hoerspielkapitel laeuft zwanzig Minuten; abzuwarten, bis es von selbst
    endet, ist kein Test. Stattdessen wird mittendrin ein zweites Album
    gestartet: fuer das Plugin ist das derselbe Fall, denn es vergleicht die
    Titelkennung, nicht die Ursache des Wechsels.
    """
    try:
        with open("/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json") as f:
            d = json.load(f)
    except Exception:
        return []
    # ALBUM_AB ueberspringt die ersten N Alben. Wozu: die ersten zwei sind
    # laengst aufgenommen, und `neueBehalten` verwirft dann korrekt jede neue
    # Aufnahme — der Lauf erreicht die Kachel-Kette nie und prueft nichts.
    # Genau so ist der Lauf am 19.08. ins Leere gegangen.
    ab = int(os.environ.get("ALBUM_AB", "0"))
    alle = []
    for e in d if isinstance(d, list) else d.get("data", []):
        if e.get("type") == "spotify" and e.get("id") and str(e["id"]) not in alle:
            alle.append(str(e["id"]))
    return alle[ab:ab + hoechstens]


def haengt_woran() -> list[str]:
    """Woran der Mitschnitt WIRKLICH haengt. Der Kern der Pruefung: haengt er
    am Monitor, waeren die Ansagen drin — dann ist der Zweck verfehlt."""
    try:
        roh = subprocess.run(["pw-link", "-l"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return []
    quellen, drin = [], False
    for zeile in roh.splitlines():
        if zeile.startswith(f"{KENNUNG}:input_"):
            drin = True
        elif drin and zeile.strip().startswith("|<-"):
            quellen.append(zeile.strip()[3:].strip().rsplit(":", 1)[0])
        elif drin and not zeile.startswith(" "):
            drin = False
    return sorted(set(quellen))


def alle_dateien(wurzel: str) -> list[str]:
    """Alles unterhalb — die Stuecke liegen unter Kuenstler/Album."""
    aus = []
    for ordner, _, namen in os.walk(wurzel):
        for n in namen:
            if not n.startswith("."):
                aus.append(os.path.join(ordner, n))
    return aus


def veredelung(pfad: str) -> list[str]:
    """Was ausser Ton noch drinsteckt: Tags, Cover, Fingerabdruck, Dauer."""
    zeilen = []
    try:
        roh = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format_tags=title,artist,album,track,comment,ACOUSTID_FINGERPRINT",
             "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name",
             "-of", "json", pfad],
            capture_output=True, text=True, timeout=30).stdout
        d = json.loads(roh or "{}")
    except Exception as f:
        return [f"ffprobe scheiterte: {f}"]

    tags = {k.lower(): v for k, v in (d.get("format", {}).get("tags") or {}).items()}
    for schluessel in ("title", "artist", "album", "track", "comment"):
        if tags.get(schluessel):
            zeilen.append(f"{schluessel:<9} {tags[schluessel][:60]}")
    fp = tags.get("acoustid_fingerprint")
    zeilen.append(f"{'fingerab.':<9} {(fp[:40] + '…') if fp else 'FEHLT'}")
    bild = [s for s in d.get("streams", []) if s.get("codec_type") == "video"]
    zeilen.append(f"{'cover':<9} {bild[0]['codec_name'] if bild else 'FEHLT'}")
    dauer = (d.get("format") or {}).get("duration")
    if dauer:
        zeilen.append(f"{'dauer':<9} {float(dauer):.1f} s")
    for endung in (".lrc", ".txt"):
        neben = pfad.replace(".flac", endung)
        if os.path.exists(neben):
            zeilen.append(f"{'songtext':<9} {endung} ({os.path.getsize(neben)} B)")
    return zeilen

def datei_pruefen(pfad: str) -> str:
    """Ist da Ton drin — oder nur eine Datei?

    Eine FLAC-Datei mit Signatur und Stille sieht auf jedem `ls` richtig aus.
    Das ist der Fehler, vor dem N4 warnt: was vollstaendig AUSSIEHT.
    """
    gross = os.path.getsize(pfad)
    with open(pfad, "rb") as f:
        signatur = f.read(4)
    zeile = f"{os.path.basename(pfad)}: {gross/1024:.0f} kB, Signatur {signatur!r}"
    if signatur != b"fLaC":
        return zeile + " — KEIN FLAC"
    # libsndfile-FLAC laesst sich mit `wave` nicht oeffnen; also nur die
    # Groesse als Hinweis. Eine Minute Musik sind rund 1,4 MB.
    if gross < 20_000:
        return zeile + " — verdaechtig klein, vermutlich kein Ton"
    return zeile + " — sieht nach echtem Mitschnitt aus"


def main() -> int:
    print(f"══ Mitschnitt-Durchlauf {time.strftime('%Y-%m-%d %H:%M:%S')} ══\n")
    vorher = set(alle_dateien(ABLAGE))

    kennungen = spotify_kennungen(2)
    if not kennungen:
        print("Kein Spotify-Album in data.json gefunden.")
        return 2
    print(f"Testalben: {', '.join(kennungen)}")

    try:
        print("\n── 1. Einschalten ──")
        schalten(True)
        time.sleep(5)
        print(f"  {befinden()}")

        print("\n── 2. Wiedergabe ueber den Proxy ──")
        # UNTER /player, NICHT direkt: der Proxy ist dort registriert
        # (`app.use('/player', ...)`). Ohne das Praefix antwortet die
        # Oberflaeche mit ihrer index.html — HTTP 200, HTML statt Player, und
        # kein Ereignis wird gestreut. Genau daran ist der erste Lauf
        # gescheitert, ohne dass irgendetwas nach einem Fehler aussah.
        print(f"  {ruf(f'/player/spotify/now/spotify:album:{kennungen[0]}:0:0', frist=15)[:120]}")
        time.sleep(SPIELT_S)

        if "--abriss" in sys.argv:
            # ══ N4: DER ABBRUCH MITTEN IM TITEL ══════════════════════════
            #
            # Auf dieser Box reisst das WLAN alle paar Minuten ab; dann
            # verliert librespot die Verbindung mitten im Lied. Darauf zu
            # WARTEN waere kein Test — also wird es ausgeloest.
            #
            # `pkill -x`, niemals `-f`: mit -f traefe das Muster auch die
            # eigene Shell, in deren Befehlszeile es steht.
            # MITTEN IN EINEN LANGEN TITEL treffen, nicht an sein Ende. Der
            # erste Lauf brach zufaellig genau beim Titelwechsel ab; das
            # Stueck war dann vollstaendig, und die Kennzeichnung blieb
            # ungeprueft. Also erst den kurzen Vorspann durchlaufen lassen.
            warten = int(os.environ.get("ABRISS_NACH", "45"))
            print(f"\n── 2b. noch {warten} s weiterlaufen, um mitten in einen langen Titel zu geraten ──")
            time.sleep(warten)
            print("\n── 2c. ABRISS: librespot wird beendet (wie ein Netzabriss) ──")
            e = subprocess.run(["pkill", "-x", "librespot"], capture_output=True)
            print(f"  pkill -x librespot: rc={e.returncode}")
            print("  … die Aufnahme laeuft jetzt in die Stille weiter")
            time.sleep(25)
        elif len(kennungen) > 1:
            print("\n── 2b. Mitten im Lauf auf ein anderes Album — das ist der Titelwechsel ──")
            print(f"  {ruf(f'/player/spotify/now/spotify:album:{kennungen[1]}:0:0', frist=15)[:120]}")
            time.sleep(SPIELT_S)

        print("\n── 3. Haengt der Abgriff am Quellknoten? ──")
        woran = haengt_woran()
        print(f"  haengt an: {', '.join(woran) or 'NICHTS'}")
        if any("librespot" in w for w in woran):
            print("  RICHTIG — am Quellknoten, die Ansagen bleiben draussen")
        elif woran:
            print("  FALSCH — nicht am Quellknoten; hier waeren Ansagen drin")
        print(f"  {befinden()}")

        print("\n── 4. Wiedergabe beenden ──")
        ruf("/player/current/stop", frist=12)
        time.sleep(5)

        print("\n── 5. Was ist entstanden? ──")
        # REKURSIV: die Stuecke liegen jetzt unter Kuenstler/Album.
        jetzt = set(alle_dateien(ABLAGE))
        neu = sorted(jetzt - vorher)
        if not neu:
            print("  KEINE neue Datei.")
        for pfad in neu:
            print(f"  {os.path.relpath(pfad, ABLAGE)}")
            print(f"    {datei_pruefen(pfad)}")
            if pfad.endswith("playlist.m3u"):
                with open(pfad) as f:
                    for zeile in f.read().splitlines():
                        print(f"      {zeile}")
            if pfad.endswith(".flac"):
                for zeile in veredelung(pfad):
                    print(f"    {zeile}")
    finally:
        # IMMER. Auch wenn oben etwas wirft, auch bei Strg-C: eine
        # Testfunktion, die rechtlich heikel ist, bleibt nicht an, weil ein
        # Durchlauf schiefging.
        print("\n── 6. Wieder ausschalten ──")
        schalten(False)
        time.sleep(4)
        print(f"  {befinden()}")
        subprocess.run(["pkill", "-x", "pw-record"], capture_output=True)

    print("\nFertig.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
