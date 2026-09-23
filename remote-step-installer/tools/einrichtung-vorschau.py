#!/usr/bin/env python3
"""Den Einrichtungsbildschirm ansehen, ohne eine Box zu haben.

WOZU: `einrichtung-schirm.py` malt auf /dev/fb0. Wer die Aufteilung aendert,
muesste sonst jedes Mal auf die Box schieben, neu starten und hinsehen — das
dauert Minuten, und deshalb macht man es nicht. Dieselbe Ueberlegung wie bei
`neu-vorschau.mjs` fuer die neue Oberflaeche.

WIE — und warum das KEINE Attrappe ist: Gezeichnet wird mit dem ECHTEN Code.
Die `Schirm`-Klasse der Boot-Animation wird ohne ihren Konstruktor erzeugt
(`__new__`) und bekommt statt des Framebuffers einen gewoehnlichen Puffer
untergeschoben; alle Zeichenwege — `fuellen`, `rechteck`, `bild`, die
PSF-Schriften — sind unveraendert dieselben. Ein nachgebauter Zeichner waere
eine zweite Meinung darueber, wie die Box aussieht, und damit wertlos (llmwiki:
neue-oberflaeche-ohne-box-ansehen).

Nur `zeigen()` entfaellt: es gibt kein /dev/fb0, in das geschrieben wuerde.

SCHRIFTEN: Die PSF-Konsolenschriften liegen auf der Box, nicht unbedingt am
Entwicklungsrechner. Fehlen sie, sagt das Werkzeug, wie man sie holt:

    scp dietpi@<box>:/usr/share/consolefonts/Lat15-DejaVuBold30x16.psf.gz .
    scp dietpi@<box>:/usr/share/consolefonts/Lat15-TerminusBold24x12.psf.gz .

WAS ES NICHT TUT
  * Es ersetzt den Blick auf die Box nicht. Farben wirken auf der DSI-Anzeige
    anders, und wie hell 800x480 in einem Kinderzimmer sind, sagt nur das
    Kinderzimmer.
  * Es schreibt nichts auf einen Framebuffer — auch nicht auf den eigenen.

AUFRUF
    python3 tools/einrichtung-vorschau.py --schriften <ordner> -o vorschau.png
    python3 tools/einrichtung-vorschau.py --schriften <ordner> --ohne-netz
"""
import argparse
import importlib.util
import os
import struct
import sys
import zlib

HIER = os.path.dirname(os.path.abspath(__file__))


def _laden(name, datei):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HIER, datei))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


bs = _laden("bootsplash", "mupibox-boot-splash.py")
es = _laden("einrichtungsschirm", "einrichtung-schirm.py")


def schirm_bauen(breite, hoehe, bpp=32):
    """Ein `Schirm` ohne Framebuffer — echte Klasse, echter Zeichencode."""
    s = bs.Schirm.__new__(bs.Schirm)
    s.b, s.h, s.bpp = breite, hoehe, bpp
    s.bp = bpp // 8
    s.puffer = bytearray(breite * hoehe * s.bp)
    s.mm = None
    s.fd = -1
    s.zeigen = lambda: None  # es gibt nichts anzuzeigen
    return s


def als_png(schirm, pfad):
    """Den Puffer als PNG ablegen — von Hand, damit auch dieses Werkzeug ohne
    Fremdpakete auskommt."""
    zeilen = bytearray()
    for y in range(schirm.h):
        zeilen.append(0)  # Zeilenfilter: keiner
        for x in range(schirm.b):
            o = (y * schirm.b + x) * schirm.bp
            r, g, b = bs.hintergrund(schirm.puffer[o : o + schirm.bp], schirm.bpp)
            zeilen += bytes((r, g, b))

    def block(kennung, daten):
        roh = kennung + daten
        return struct.pack(">I", len(daten)) + roh + struct.pack(">I", zlib.crc32(roh))

    kopf = struct.pack(">IIBBBBB", schirm.b, schirm.h, 8, 2, 0, 0, 0)
    with open(pfad, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(block(b"IHDR", kopf))
        f.write(block(b"IDAT", zlib.compress(bytes(zeilen), 6)))
        f.write(block(b"IEND", b""))


def main():
    p = argparse.ArgumentParser(add_help=True)
    p.add_argument("--schriften", default="/usr/share/consolefonts")
    p.add_argument("-o", "--ausgabe", default="einrichtung-vorschau.png")
    p.add_argument("--breite", type=int, default=800)
    p.add_argument("--hoehe", type=int, default=480)
    p.add_argument("--adresse", default="192.168.178.169")
    p.add_argument("--port", type=int, default=8099)
    p.add_argument("--name", default="MixPiBox")
    p.add_argument("--ohne-netz", action="store_true", help="den Wartezustand zeigen")
    p.add_argument("--paircode", default="", help="Pair-Code, den der Schirm zeigen soll")
    p.add_argument("--wlan", default="", help="Netzname, mit dem die Box verbunden ist")
    p.add_argument("--ap", default="", help="AP-Fall: SSID,Passwort")
    p.add_argument("--fortschritt", default="",
                   help="Lauf zeigen: NUMMER,GESAMT,TITEL[,exit] — z.B. 12,30,Node.js "
                        "installieren  ·  mit angehaengtem ,1 den gescheiterten Schritt")
    p.add_argument("--phase", default="",
                   help="Phase zeigen: grundsystem | neustart | vorbereitung")
    a = p.parse_args()

    gross_pfad = os.path.join(a.schriften, "Lat15-DejaVuBold30x16.psf.gz")
    klein_pfad = os.path.join(a.schriften, "Lat15-TerminusBold24x12.psf.gz")
    for pfad in (gross_pfad, klein_pfad):
        if not os.path.exists(pfad):
            print(f"Schrift fehlt: {pfad}", file=sys.stderr)
            print(__doc__.split("SCHRIFTEN:")[1].split("WAS ES NICHT TUT")[0], file=sys.stderr)
            return 2

    schirm = schirm_bauen(a.breite, a.hoehe)
    gross = bs.Schrift(gross_pfad)
    klein = bs.Schrift(klein_pfad)
    maskottchen = es.maskottchen_laden()

    fortschritt = None
    if a.fortschritt:
        t = a.fortschritt.split(",")
        fortschritt = {
            "nummer": int(t[0]), "gesamt": int(t[1]),
            "titel": t[2] if len(t) > 2 else "",
            # Ein vierter Wert ist der Exit-Code: alles ausser 0 zeigt den
            # gescheiterten Schritt. Genau der ist der Zustand, den man beim
            # Entwerfen am seltensten ansieht und am dringendsten braucht.
            "laeuft": len(t) < 4,
            "exit": int(t[3]) if len(t) > 3 else None,
            "abgebrochen": False,
        }

    url = None if a.ohne_netz else es.adresse_zu_url(a.adresse, a.port)
    es.malen(
        schirm, gross, klein, url, None if a.ohne_netz else a.adresse, a.port, a.name,
        maskottchen, a.paircode or None, a.wlan or None,
        tuple(a.ap.split(',', 1)) if a.ap else None,
        fortschritt,
        a.phase,
    )
    als_png(schirm, a.ausgabe)
    print(f"geschrieben: {a.ausgabe} ({a.breite}x{a.hoehe})")
    if maskottchen is None:
        print("  HINWEIS: kein Maskottchen gefunden — der Schirm laeuft ohne Bild")
    return 0


if __name__ == "__main__":
    sys.exit(main())
