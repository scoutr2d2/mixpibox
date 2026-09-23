#!/usr/bin/env python3
"""Baut `loadfile … append-play` wirklich EINE mpv-Liste? — am Geraet gemessen.

WOZU: Ein Jellyfin-Album kommt NICHT als m3u, sondern als N einzelne
HTTP-Befehle an den Abspieldienst: einmal `jellyfin/<url>` (spotify-control.ts
Z. 1648-1661 -> `player.play` -> `loadfile … replace`) und danach N-1 mal
`jfqueue/<url>` (Z. 1663-1670 -> `player.queue` -> `loadfile … append-play`,
mpv-protokoll.ts Z. 129/130).

Daran haengt die Frage, ob der ABSOLUTE Titelsprung (`playlist-pos-1`,
mpv-protokoll.ts Z. 154) fuer Jellyfin ueberhaupt etwas zu springen hat. Aus
dem Quelltext allein ist das nicht zu beantworten — `append-play` koennte
theoretisch auch nur nacheinander laden. Das von Hand mit echten Medien zu
pruefen hiess: Jellyfin-Server, Album, Lautsprecher. Hier genuegen erzeugte
Stille-Dateien und eine Sekunde.

Zusaetzlich wird der Kollisionsfall gemessen: `loadlist <fehlt> replace` — den
schickt der aeltere `queue`-Zweig (Z. 1618), weil '/current/jfqueue/…' die
Zeichenkette 'queue' ENTHAELT. Die Frage dabei: reisst ein fehlgeschlagenes
`loadlist replace` die laufende Liste mit?

WAS ES NICHT TUT
    * Es spielt nichts Hoerbares (`--ao=null`) und fasst die Box nicht an:
      eigenes mpv, eigener Socket, Wegwerf-Verzeichnis.
    * Es spricht mit keinem Jellyfin-Server. Ob eine Stream-Adresse
      erreichbar ist, sagt curl — nicht dieses Werkzeug. Fuer mpv ist eine
      http-Adresse derselbe Listeneintrag wie ein Dateiname.
    * Es prueft den Aufsatz (mpv-wrapper.ts) NICHT, sondern mpv selbst.
      Ob der Aufsatz richtig sendet, sagen dessen eigene Tests.

AUFRUF
    tools/mpv-warteschlange.py                 # 1 + 3 angehaengt, Sprung auf 3
    tools/mpv-warteschlange.py --titel 6 --sprung 5
"""

import argparse
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import wave


def stille_datei(pfad: str, sekunden: float = 3.0, rate: int = 8000) -> None:
    """Eine gueltige WAV-Datei aus Stille — ohne ffmpeg, ohne Fremdpaket."""
    with wave.open(pfad, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<%dh" % int(rate * sekunden), *([0] * int(rate * sekunden))))


def antwort_lesen(s: socket.socket, kennung: int, frist: float = 3.0):
    """Auf die Antwort mit dieser Kennung warten; Ereignisse dazwischen uebergehen."""
    ende = time.time() + frist
    puffer = b""
    while time.time() < ende:
        s.settimeout(max(0.05, ende - time.time()))
        try:
            teil = s.recv(65536)
        except socket.timeout:
            break
        if not teil:
            break
        puffer += teil
        while b"\n" in puffer:
            zeile, puffer = puffer.split(b"\n", 1)
            if not zeile.strip():
                continue
            try:
                d = json.loads(zeile)
            except json.JSONDecodeError:
                continue
            if d.get("request_id") == kennung:
                return d
    return None


def main() -> int:
    p = argparse.ArgumentParser(description="mpv-Warteschlange aus Einzelbefehlen pruefen")
    p.add_argument("--titel", type=int, default=4, help="wie viele Stuecke insgesamt (1 + Rest angehaengt)")
    p.add_argument("--sprung", type=int, default=3, help="auf welchen Titel absolut gesprungen wird (1-basiert)")
    p.add_argument("--mpv", default="mpv")
    a = p.parse_args()

    if not shutil.which(a.mpv):
        print(f"{a.mpv} nicht gefunden", file=sys.stderr)
        return 1

    ordner = tempfile.mkdtemp(prefix="mpv-schlange-")
    proc = None
    try:
        dateien = []
        for i in range(a.titel):
            d = os.path.join(ordner, f"stille{i + 1}.wav")
            stille_datei(d)
            dateien.append(d)

        sock = os.path.join(ordner, "ipc")
        proc = subprocess.Popen(
            [a.mpv, "--no-video", "--ao=null", "--idle=yes", "--really-quiet",
             f"--input-ipc-server={sock}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            if os.path.exists(sock):
                break
            time.sleep(0.05)
        else:
            print("mpv hat keinen Socket angelegt", file=sys.stderr)
            return 1
        time.sleep(0.3)

        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(sock)
        kennung = [0]

        def schicke(befehl):
            kennung[0] += 1
            s.sendall((json.dumps({"command": befehl, "request_id": kennung[0]}) + "\n").encode())
            return antwort_lesen(s, kennung[0])

        def lies(name):
            r = schicke(["get_property", name])
            return r.get("data") if r else None

        # 1) wie `jellyfin/<url>`: loadfile … replace
        r = schicke(["loadfile", dateien[0], "replace"])
        print(f"  jellyfin  loadfile replace      -> {r.get('error') if r else '-'}")
        time.sleep(0.4)
        print(f"            playlist-count = {lies('playlist-count')}  pos-1 = {lies('playlist-pos-1')}")

        # 2) wie N-1 mal `jfqueue/<url>`: loadfile … append-play
        for d in dateien[1:]:
            r = schicke(["loadfile", d, "append-play"])
            print(f"  jfqueue   loadfile append-play   -> {r.get('error') if r else '-'}")
        time.sleep(0.4)
        anzahl = lies("playlist-count")
        print(f"            playlist-count = {anzahl}  pos-1 = {lies('playlist-pos-1')}")
        eine_liste = anzahl == a.titel
        print(f"\n  EINE LISTE? {'JA' if eine_liste else 'NEIN'} — erwartet {a.titel}, gemeldet {anzahl}")

        # 3) absoluter Sprung — das ist der Punkt, an dem playlist-pos-1 haengt
        r = schicke(["set_property", "playlist-pos-1", a.sprung])
        time.sleep(0.4)
        ist = lies("playlist-pos-1")
        sprung_ok = (r.get("error") if r else None) == "success" and ist == a.sprung
        print(f"  SPRUNG auf {a.sprung}: {r.get('error') if r else '-'}, pos-1 = {ist}"
              f"  -> {'GEHT' if sprung_ok else 'GEHT NICHT'}")

        # 4) Kollisionsfall: der aeltere `queue`-Zweig schickt loadlist auf eine
        #    Datei, die es nicht gibt. Reisst das die laufende Liste mit?
        fehlt = os.path.join(ordner, "gibtesnicht", "playlist.m3u")
        r = schicke(["loadlist", fehlt, "replace"])
        time.sleep(0.4)
        nach = lies("playlist-count")
        print(f"\n  queue-Kollision  loadlist <fehlt> replace -> {r.get('error') if r else '-'}")
        print(f"            playlist-count = {nach} (vorher {anzahl})"
              f"  -> {'LISTE BLEIBT' if nach == anzahl else 'LISTE WEG'}")

        return 0 if (eine_liste and sprung_ok) else 2
    finally:
        try:
            if proc:
                proc.terminate()
                proc.wait(timeout=3)
        except Exception:  # noqa: BLE001
            pass
        shutil.rmtree(ordner, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
