#!/usr/bin/env python3
"""Nimmt mpv diese Eigenschaft wirklich an? — am Geraet gemessen, nicht gelesen.

WOZU: Der mpv-Aufsatz (backend-player/src/mpv-protokoll.ts) bildet ein gutes
Dutzend Eigenschaften ab. Ob mpv eine davon zur LAUFZEIT annimmt, steht in
seiner Dokumentation — und die Dokumentation ist nicht das Geraet. Beim
Titelsprung war genau das die offene Frage: `playlist-pos-1` liest sich
schluessig, aber ob `set_property` darauf waehrend einer laufenden Liste
wirkt, sagt erst ein Versuch.

Ohne dieses Werkzeug hiesse Pruefen: echte Medien auf die Box legen, abspielen,
zuhoeren. Auf einer Box ohne lokale Dateien (und ohne angeschlossenen
Lautsprecher) geht das gar nicht. Hier genuegen zwei erzeugte Stille-Dateien.

WAS ES NICHT TUT
    * Es spielt nichts Hoerbares. Ausgabe geht nach `--ao=null`; es geht um
      den Zustand, nicht um Ton.
    * Es fasst die Box nicht an: eigenes mpv, eigener Socket, alles in einem
      Wegwerf-Verzeichnis. Der laufende Abspieldienst merkt nichts davon.
    * Es prueft NICHT den Aufsatz, sondern mpv. Ob der Aufsatz richtig sendet,
      sagen dessen eigene Tests.

AUFRUF
    tools/mpv-eigenschaft.py playlist-pos-1 3
    tools/mpv-eigenschaft.py volume 40 --titel 5
    tools/mpv-eigenschaft.py --nur-lesen playlist-count
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


def stille_datei(pfad: str, sekunden: float = 2.0, rate: int = 8000) -> None:
    """Eine gueltige WAV-Datei aus Stille — ohne ffmpeg, ohne Fremdpaket."""
    with wave.open(pfad, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<%dh" % int(rate * sekunden), *([0] * int(rate * sekunden))))


def antwort_lesen(s: socket.socket, kennung: int, frist: float = 3.0):
    """Auf die Antwort mit dieser Kennung warten. mpv schickt dazwischen
    Ereignisse — die muessen uebergangen werden, sonst haelt man das erste
    Beste fuer die Antwort."""
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
    p = argparse.ArgumentParser(description="mpv-Eigenschaft am Geraet pruefen (aendert nichts an der Box)")
    p.add_argument("eigenschaft")
    p.add_argument("wert", nargs="?", help="weglassen heisst: nur lesen")
    p.add_argument("--titel", type=int, default=4, help="wie viele Stuecke die Probeliste hat")
    p.add_argument("--nur-lesen", action="store_true")
    p.add_argument("--mpv", default="mpv")
    a = p.parse_args()

    if not shutil.which(a.mpv):
        print(f"{a.mpv} nicht gefunden", file=sys.stderr)
        return 1

    ordner = tempfile.mkdtemp(prefix="mpv-probe-")
    try:
        liste = os.path.join(ordner, "probe.m3u")
        with open(liste, "w", encoding="utf8") as f:
            for i in range(a.titel):
                datei = os.path.join(ordner, f"stille{i + 1}.wav")
                stille_datei(datei)
                f.write(datei + "\n")

        sock = os.path.join(ordner, "ipc")
        proc = subprocess.Popen(
            [a.mpv, "--no-video", "--ao=null", "--idle=yes", "--really-quiet",
             f"--input-ipc-server={sock}", f"--playlist={liste}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        # Auf den Socket warten - mpv legt ihn erst nach dem Start an.
        for _ in range(100):
            if os.path.exists(sock):
                break
            time.sleep(0.05)
        else:
            print("mpv hat keinen Socket angelegt", file=sys.stderr)
            return 1
        time.sleep(0.4)

        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(sock)

        def schicke(befehl, kennung):
            s.sendall((json.dumps({"command": befehl, "request_id": kennung}) + "\n").encode())
            return antwort_lesen(s, kennung)

        vorher = schicke(["get_property", a.eigenschaft], 1)
        print(f"  vorher   {a.eigenschaft} = {vorher.get('data') if vorher else '(keine Antwort)'}"
              f"   [{vorher.get('error') if vorher else '-'}]")

        if not a.nur_lesen and a.wert is not None:
            try:
                wert = int(a.wert)
            except ValueError:
                try:
                    wert = float(a.wert)
                except ValueError:
                    wert = a.wert
            gesetzt = schicke(["set_property", a.eigenschaft, wert], 2)
            fehler = gesetzt.get("error") if gesetzt else "(keine Antwort)"
            print(f"  setzen   auf {wert!r}   -> {fehler}")
            time.sleep(0.3)
            nachher = schicke(["get_property", a.eigenschaft], 3)
            ist = nachher.get("data") if nachher else None
            print(f"  nachher  {a.eigenschaft} = {ist}")
            passt = ist == wert
            print(f"\n  {'ANGENOMMEN' if fehler == 'success' and passt else 'NICHT wie erwartet'}"
                  f" — mpv meldet '{fehler}', Wert ist {ist!r} (erwartet {wert!r})")
            return 0 if (fehler == "success" and passt) else 2
        return 0
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:  # noqa: BLE001
            pass
        shutil.rmtree(ordner, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
