#!/usr/bin/env python3
"""
Der gemeinsame Vorspann einer ARD-Sendung — GEMESSEN, nicht geraten.

WOZU
Betreiber (15.08.2026): „ard sounds funktion jingle überspringen es gibt
immer einen anfangs jingle der bei allen gleich ist kannst du das erkennen
und eine checkbox einbauen das uberspringen zu können."

Bevor eine Checkbox etwas ueberspringt, muss die Zahl gemessen sein: eine
feste („die ersten 12 Sekunden") waere bei jeder Sendung anders und beim
naechsten Programmumbau falsch. Am 15.08.2026 an vier Folgen von
„MausHoerspiel kurz" gemessen: 5,00 s bis 5,25 s bei allen sechs Paaren.

WIE
Zwei oder mehr Folgen derselben Sendung werden zu Mono-PCM (8 kHz, s16)
dekodiert — nur die ersten Sekunden. Dann laeuft ein Fenster ueber beide
Reihen und vergleicht BLOCKWEISE mit normalisierter Kreuzkorrelation:

  * gleicher Vorspann -> nahe 1 (dieselbe Aufnahme, nur neu encodiert)
  * ab der eigentlichen Folge -> faellt auf Rauschniveau

Der Vorspann endet am ersten Block, ab dem die Korrelation DAUERHAFT unter
die Schwelle faellt — ein einzelner Ausreisser in einer gemeinsamen Stille
darf ihn nicht zerschneiden.

DIE ERSTE ZAHL IST NICHT DIE ANTWORT: gemessen wird ueber ALLE Paare, und
das Ergebnis ist der KLEINSTE gemeinsame Nenner. Was nur zwei von fuenf
Folgen teilen, ist kein Vorspann der Sendung.

LAEUFT AUCH AUF DER BOX, und deshalb ohne Zutaten, die dort fehlen: als
Dekoder tut es ffmpeg ODER mpv (auf der Box ist mpv da, ffmpeg nicht),
gerechnet wird mit numpy ODER in reinem Python (am 15.08.2026 gemessen:
reines Python braucht fuer vier Folgen rund eine Sekunde — die Ladezeit
ueberwiegt bei weitem).

AUFRUF
    python3 ard-vorspann-messen.py --werk ard:81889970
    python3 ard-vorspann-messen.py --mp3 URL1 URL2 URL3
    python3 ard-vorspann-messen.py --werk ard:81889970 --json

WAS ES AENDERT: nichts. Es laedt, rechnet und schreibt eine Zahl.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

# ── Die Messgroessen ──────────────────────────────────────────────────────
#
# 8 kHz Mono reicht: gesucht wird die IDENTITAET zweier Aufnahmen, nicht ihre
# Klangqualitaet. Weniger Daten heisst schnelleres Rechnen auf jedem Geraet.
RATE = 8000
# So weit wird ueberhaupt hineingehoert. Ein Vorspann, der laenger ist als
# das, waere kein Vorspann mehr, sondern eine eigene Folge.
FENSTER_S = 60.0
# Blocklaenge des Vergleichs. 0,25 s ist fein genug fuer das Ende auf eine
# Viertelsekunde und grob genug, dass Encoder-Zappeln nichts kippt.
BLOCK_S = 0.25
# Ab hier gelten zwei Bloecke als DIESELBE Aufnahme. Gemessen: gleicher
# Vorspann liegt bei 0,97 bis 1,00, verschiedener Inhalt unter 0,3.
SCHWELLE = 0.85
# So viele Bloecke muessen NACHEINANDER darunter liegen, damit das Ende gilt.
BESTAETIGUNG = 4
# Was am Ende ABGEZOGEN wird. Der Messwert ist die Stelle, an der die
# Aufnahmen auseinanderlaufen — genau dort zu springen schnitte das erste
# Wort an. Ein Viertelsekunde davor ist hoerbar sauberer und kostet nichts.
SICHERHEIT_S = 0.25


def _dekoder():
    """Was auf DIESER Maschine dekodieren kann. ffmpeg zuerst, dann mpv."""
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    if shutil.which("mpv"):
        return "mpv"
    return None


def pcm_holen(quelle: str, sekunden: float = FENSTER_S) -> list:
    """Die ersten Sekunden einer Adresse als Mono-PCM (Liste von ints)."""
    art = _dekoder()
    if art == "ffmpeg":
        roh = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", quelle,
             "-t", str(sekunden), "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
            capture_output=True, timeout=180,
        )
        if roh.returncode != 0 or not roh.stdout:
            raise RuntimeError((roh.stderr or b"").decode()[:200] or "ffmpeg lieferte nichts")
        return _bytes_zu_ints(roh.stdout)
    if art == "mpv":
        # mpv schreibt PCM nur in eine DATEI, nicht nach stdout — deshalb der
        # Umweg ueber eine temporaere WAV. `--length` schneidet, `--ao=pcm`
        # rechnet ohne Tonausgabe (die Box spielt dabei NICHTS).
        with tempfile.TemporaryDirectory() as ordner:
            ziel = os.path.join(ordner, "probe.wav")
            roh = subprocess.run(
                ["mpv", "--no-video", "--no-terminal", "--ao=pcm", f"--ao-pcm-file={ziel}",
                 "--audio-channels=mono", f"--audio-samplerate={RATE}",
                 "--audio-format=s16", f"--length={sekunden}", quelle],
                capture_output=True, timeout=180,
            )
            if not os.path.exists(ziel):
                raise RuntimeError((roh.stderr or b"").decode()[:200] or "mpv lieferte nichts")
            with open(ziel, "rb") as f:
                return _wav_lesen(f.read())
    raise RuntimeError("Kein Dekoder: weder ffmpeg noch mpv vorhanden")


def _wav_lesen(b: bytes) -> list:
    """Eine WAV-Datei selbst zerlegen — s16 oder float32.

    WARUM NICHT `wave` AUS DER STDLIB (am Geraet gemessen, 15.08.2026): mpv
    schreibt WAVE_FORMAT_EXTENSIBLE, und `wave` bricht daran ab („unknown
    extended format"). Der Kopf ist zwanzig Zeilen weit selbst zu lesen, und
    danach ist es egal, was fuer ein Dekoder davorsteht.
    """
    if len(b) < 12 or b[:4] != b"RIFF" or b[8:12] != b"WAVE":
        raise RuntimeError("keine WAV-Datei")
    i = 12
    art = 1
    bits = 16
    daten = b""
    while i + 8 <= len(b):
        kennung = b[i:i + 4]
        laenge = int.from_bytes(b[i + 4:i + 8], "little")
        rumpf = b[i + 8:i + 8 + laenge]
        if kennung == b"fmt " and len(rumpf) >= 16:
            art = int.from_bytes(rumpf[0:2], "little")
            bits = int.from_bytes(rumpf[14:16], "little")
            # EXTENSIBLE (0xFFFE) nennt die WAHRE Art in den ersten zwei Byte
            # seines Anhangs — dort steht 1 (ganzzahlig) oder 3 (Fliesskomma).
            if art == 0xFFFE and len(rumpf) >= 26:
                art = int.from_bytes(rumpf[24:26], "little")
        elif kennung == b"data":
            daten = rumpf
            break
        # Chunks sind auf gerade Laengen aufgefuellt.
        i += 8 + laenge + (laenge & 1)
    if not daten:
        raise RuntimeError("WAV ohne Daten")
    if art == 3 and bits == 32:
        import struct  # noqa: PLC0415

        n = len(daten) // 4
        # Fliesskomma liegt bei -1..1; auf die s16-Skala bringen, damit die
        # Korrelation dieselben Groessen sieht wie beim ffmpeg-Weg.
        return [w * 32768.0 for w in struct.unpack(f"<{n}f", daten[: n * 4])]
    if bits != 16:
        raise RuntimeError(f"WAV mit {bits} Bit wird nicht gelesen")
    return _bytes_zu_ints(daten)


def _bytes_zu_ints(b: bytes) -> list:
    """s16le-Bytes zu Zahlen. Mit numpy schnell, ohne es genauso richtig."""
    try:
        import numpy as np  # noqa: PLC0415

        return np.frombuffer(b, dtype="<i2").astype("float64")
    except ImportError:
        import array  # noqa: PLC0415

        a = array.array("h")
        a.frombytes(b[: len(b) // 2 * 2])
        return a


def gemeinsamer_anfang(a, b) -> float:
    """Wie viele Sekunden am Anfang sind DIESELBE Aufnahme? Pure Rechnung."""
    n = int(BLOCK_S * RATE)
    bloecke = min(len(a), len(b)) // n
    if bloecke == 0:
        return 0.0
    unter = 0
    ende = 0
    for i in range(bloecke):
        r = _korrelation(a[i * n:(i + 1) * n], b[i * n:(i + 1) * n])
        if r >= SCHWELLE:
            unter = 0
            ende = i + 1
        else:
            unter += 1
            if unter >= BESTAETIGUNG:
                break
    return round(ende * BLOCK_S, 2)


def _korrelation(x, y) -> float:
    """Normalisierte Kreuzkorrelation zweier gleich langer Bloecke.

    Beide praktisch still zaehlt als GLEICH: die Korrelation ist dort
    mathematisch unbestimmt, und „hier passiert nichts" ist kein Unterschied.
    """
    m = len(x)
    if m == 0:
        return 0.0
    mx = sum(x) / m
    my = sum(y) / m
    zx = zy = zxy = 0.0
    for i in range(m):
        dx = x[i] - mx
        dy = y[i] - my
        zx += dx * dx
        zy += dy * dy
        zxy += dx * dy
    if zx < 1e-6 and zy < 1e-6:
        return 1.0
    if zx < 1e-6 or zy < 1e-6:
        return 0.0
    return zxy / math.sqrt(zx * zy)


def folgen_holen(werk: str, box: str, wie_viele: int) -> list:
    """Die Ausspieladressen der ersten Folgen einer Sendung — vom Server."""
    adresse = f"http://{box}:8200/api/werke/{urllib.parse.quote(werk, safe='')}/inhalt"
    with urllib.request.urlopen(adresse, timeout=30) as antwort:
        d = json.load(antwort)
    raus = []
    for t in (d.get("titel") or [])[:wie_viele]:
        befehl = str(t.get("befehl") or "")
        # `ard/<url-kodiert>/<titel>:title:artist:<interpret>` — die Adresse
        # ist das mittlere Stueck und ist einmal kodiert.
        teile = befehl.split("/", 1)
        if len(teile) < 2:
            continue
        url = urllib.parse.unquote(teile[1].rsplit("/", 1)[0])
        if url.startswith("http"):
            raus.append({"titel": t.get("titel") or url, "url": url})
    return raus


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Den gemeinsamen Vorspann einer ARD-Sendung messen.")
    p.add_argument("--werk", help="Werkschluessel, z. B. ard:81889970")
    p.add_argument("--box", default="localhost", help="Adresse des Servers")
    p.add_argument("--mp3", nargs="*", default=[], help="Adressen direkt (statt --werk)")
    p.add_argument("--folgen", type=int, default=4, help="wie viele Folgen vergleichen")
    p.add_argument("--json", action="store_true", help="nur das Ergebnis als JSON")
    a = p.parse_args(argv)

    try:
        quellen = [{"titel": u, "url": u} for u in a.mp3]
        if a.werk:
            quellen = folgen_holen(a.werk, a.box, a.folgen)
        if len(quellen) < 2:
            raise RuntimeError("Mindestens zwei Folgen noetig — sonst gibt es nichts zu vergleichen")

        if not a.json:
            print(f"\n── {len(quellen)} Folgen, die ersten {FENSTER_S:.0f} s (Dekoder: {_dekoder()}) ──")
        reihen = []
        for q in quellen:
            try:
                reihen.append((q, pcm_holen(q["url"])))
                if not a.json:
                    print(f"  geladen: {str(q['titel'])[:52]}")
            except Exception as e:  # noqa: BLE001
                if not a.json:
                    print(f"  FEHLT:   {str(q['titel'])[:52]} ({e})")

        if len(reihen) < 2:
            raise RuntimeError("Zu wenige Folgen liessen sich laden")

        paare = []
        for i in range(len(reihen)):
            for j in range(i + 1, len(reihen)):
                s = gemeinsamer_anfang(reihen[i][1], reihen[j][1])
                paare.append(s)
                if not a.json:
                    print(f"  {str(reihen[i][0]['titel'])[:26]:26} ~ "
                          f"{str(reihen[j][0]['titel'])[:26]:26} {s:6.2f} s")

        kleinster, groesster = min(paare), max(paare)
        # Der ausgegebene Wert ist der, mit dem gesprungen werden SOLL:
        # der kleinste gemeinsame Nenner, minus der Sicherheitsabstand.
        vorspann = round(max(0.0, kleinster - SICHERHEIT_S), 2) if kleinster >= 1.0 else 0.0
        einig = (groesster - kleinster) <= 2.0
    except Exception as e:  # noqa: BLE001
        if a.json:
            print(json.dumps({"ok": False, "grund": str(e)}))
        else:
            print(f"FEHLER: {e}", file=sys.stderr)
        return 1

    if a.json:
        print(json.dumps({
            "ok": True, "vorspannSekunden": vorspann, "gemessen": kleinster,
            "spanne": [kleinster, groesster], "einig": einig, "folgen": len(reihen),
        }))
    else:
        print(f"\n  GEMEINSAMER VORSPANN: {kleinster:.2f} s  "
              f"(Paare {kleinster:.2f} bis {groesster:.2f})")
        print(f"  ZUM UEBERSPRINGEN:    {vorspann:.2f} s  "
              f"(mit {SICHERHEIT_S:.2f} s Sicherheitsabstand)")
        if kleinster < 1.0:
            print("  -> Kein gemeinsamer Vorspann der Rede wert.")
        elif not einig:
            print("  -> Die Paare gehen weit auseinander: nicht alle Folgen teilen denselben Anfang.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
