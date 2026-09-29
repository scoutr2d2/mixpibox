#!/usr/bin/env python3
"""Die Boot-Animation bauen, pruefen und ansehen — ohne Box und ohne Neustart.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 29.09.2026: „erstelle mir einen neue boot animation mit sternen und
mupibox mit dem maskottchen. bitte verwende ein vorhandenes bild."

Die Animation (scripts/mupibox/mupibox-boot-splash.py) malt auf /dev/fb0 und
laeuft nur beim Hochfahren. Wer an ihr etwas aendert, muesste sonst ausliefern,
neu starten und im richtigen Moment hinsehen — und macht es deshalb nicht.
Dieses Werkzeug hat drei Aufgaben:

  --startbild   baut scripts/mupibox/mixpi-startbild.png aus dem VORHANDENEN
                Standard-MixPi (NewDesign/bilder/mixpi-hoert.png): auf die
                Figur zugeschnitten und glatt auf 200 px Hoehe gebracht. Die
                Animation kann selbst nur grob verkleinern (jeden n-ten Punkt);
                vorab mit Lanczos verkleinert bleiben die Kanten weich.
  --pruefen     baut dasselbe im Speicher nach und vergleicht mit der Datei im
                Baum. Aendert jemand mixpi-hoert.png, zeigt die Box sonst still
                weiter das alte Bild — die Ableitung laeuft der Quelle davon.
                Prueft ausserdem, dass der PNG-Leser der Animation die Datei
                lesen kann und dass ihr Alphakanal BENUTZT ist.
  (ohne)        rendert eine Vorschau mit dem ECHTEN Zeichencode: Einzelbilder
                je Fortschritt und eine GIF-Animation durch den ganzen Start.

══ WARUM DAS KEINE ATTRAPPE IST ═══════════════════════════════════════════
Gezeichnet wird mit der Schirm-Klasse der Animation selbst; nur der
Framebuffer ist durch einen gewoehnlichen Puffer ersetzt — dieselbe Technik wie
`papierschirm()` im Fehlerbild und `schirm_bauen()` in
remote-step-installer/tools/einrichtung-vorschau.py. Ein nachgebauter Zeichner
waere eine zweite Meinung darueber, wie die Box aussieht (llmwiki:
neue-oberflaeche-ohne-box-ansehen).

══ WAS DARAN NICHT STIMMT ═════════════════════════════════════════════════
DIE SCHRIFT, wenn die Konsolenschriften der Box fehlen. Auf DietPi liegen sie
unter /usr/share/consolefonts (Lat15-DejaVuBold30x16, Lat15-TerminusBold24x12),
am Entwicklungsrechner meist nicht. Dann baut das Werkzeug gleich grosse
Ersatzschriften aus DejaVu Sans Mono Bold und SAGT das. Maße und Lage stimmen,
die Buchstabenform des kleinen Texts nicht ganz. Die echten holen:

    scp dietpi@<box>:/usr/share/consolefonts/Lat15-DejaVuBold30x16.psf.gz <ordner>
    scp dietpi@<box>:/usr/share/consolefonts/Lat15-TerminusBold24x12.psf.gz <ordner>
    python3 tools/bootsplash-vorschau.py --schriften <ordner> --ziel <ordner>

DIE ZEIT JE BILD gilt fuer DIESEN Rechner. Auf dem Pi 4 ist reines Python
grob zehnmal langsamer; die Zahl taugt zum Vergleichen zweier Fassungen, nicht
als Messung am Geraet.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/bootsplash-vorschau.py --ziel /tmp/splash        Vorschau
    python3 tools/bootsplash-vorschau.py --ziel /tmp/s --bpp 16    wie am Pi 4
    python3 tools/bootsplash-vorschau.py --ziel /tmp/s --name "Kinderzimmer Box"
    python3 tools/bootsplash-vorschau.py --startbild               Bild neu bauen
    python3 tools/bootsplash-vorschau.py --startbild --quelle NewDesign/bilder/mixpi-spielt.png
    python3 tools/bootsplash-vorschau.py --pruefen                 fuer den Laeufer

Rueckgabe: 0 gut, 1 Befund (nur --pruefen), 2 Aufruf falsch oder Werkzeug fehlt.
"""
import argparse
import gzip
import importlib.util
import os
import struct
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SPLASH = WURZEL / "scripts" / "mupibox" / "mupibox-boot-splash.py"
STARTBILD = WURZEL / "scripts" / "mupibox" / "mixpi-startbild.png"
QUELLE = WURZEL / "NewDesign" / "bilder" / "mixpi-hoert.png"
HOEHE = 200            # = 5/12 von 480, das Ziel in komponieren()
TOLERANZ = 2           # Stufen je Kanal — andere Pillow-Fassung, anderes Runden
SCHRIFTORTE = ("/usr/share/consolefonts", "/usr/share/kbd/consolefonts")
ERSATZ_TTF = ("/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf")


def pil():
    try:
        from PIL import Image  # noqa: F401
        return Image
    except ImportError:
        print("Pillow fehlt (python3 -m pip install pillow) — noetig fuer "
              "Startbild und Vorschau, NICHT auf der Box.", file=sys.stderr)
        sys.exit(2)


def splash_laden():
    spec = importlib.util.spec_from_file_location("bootsplash", SPLASH)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


# ── Das Startbild ──────────────────────────────────────────────────────────
def startbild_bauen(quelle, hoehe=HOEHE):
    """Auf die Figur zuschneiden und glatt verkleinern. -> RGBA-Bild

    Verkleinert wird VORMULTIPLIZIERT (RGBa): sonst ziehen die unsichtbaren
    Punkte rings um die Figur ihre Farbe in die Kante hinein, und das MixPi
    bekommt auf dem dunklen Himmel einen hellen Saum.
    """
    Image = pil()
    im = Image.open(quelle).convert("RGBA")
    kasten = im.getchannel("A").getbbox()
    if kasten is None:
        raise ValueError(f"{quelle}: ganz durchsichtig — da ist keine Figur")
    im = im.crop(kasten)
    breite = max(1, round(im.width * hoehe / im.height))
    return im.convert("RGBa").resize((breite, hoehe), Image.LANCZOS).convert("RGBA")


def startbild_schreiben(quelle, ziel):
    bild = startbild_bauen(quelle)
    bild.save(ziel, optimize=True)
    print(f"{ziel.relative_to(WURZEL)}: {bild.width}x{bild.height}, "
          f"{ziel.stat().st_size // 1024} kB, aus {Path(quelle).name}")


def pruefen(quelle, ziel):
    """-> Liste von Befunden (leer = gut)."""
    Image = pil()
    befunde = []
    if not ziel.is_file():
        return [f"{ziel.relative_to(WURZEL)} fehlt — "
                f"python3 tools/bootsplash-vorschau.py --startbild"]
    soll = startbild_bauen(quelle)
    ist = Image.open(ziel).convert("RGBA")
    if ist.size != soll.size:
        befunde.append(f"Masse {ist.size} statt {soll.size} — die Quelle hat sich geaendert")
    else:
        from PIL import ImageChops
        groesste = max(hi for _, hi in ImageChops.difference(ist, soll).getextrema())
        if groesste > TOLERANZ:
            befunde.append(f"weicht um bis zu {groesste} Stufen von {Path(quelle).name} ab "
                           f"(erlaubt {TOLERANZ}) — neu bauen: --startbild")
    # Kann der Leser der ANIMATION die Datei lesen? Er kennt nur 8 Bit, nicht
    # verschraenkt, Farbtypen 0/2/4/6 — ein Palettenbild aus einem „optimize"
    # waere fuer ihn kein Bild, und die Box fiele still auf den Rueckfall.
    try:
        bd = splash_laden().Bild(str(ziel))
    except Exception as e:                        # noqa: BLE001
        befunde.append(f"der PNG-Leser der Animation lehnt die Datei ab: {e}")
    else:
        alpha = [bd.punkt(x, y)[3] for y in range(bd.h) for x in range(bd.b)]
        leer = sum(1 for a in alpha if a == 0) / len(alpha)
        if leer < 0.05:
            befunde.append(f"nur {leer:.0%} durchsichtig — der Alphakanal ist da, "
                           "aber nicht benutzt (llmwiki: bilder-aufbereiten-drei-fallen)")
    return befunde


# ── Ersatzschrift, wenn die der Box fehlt ──────────────────────────────────
def psf2_bauen(ttf, breite, hoehe, pfad):
    """Eine PSF2-Schrift mit 256 Zeichen (Latin-1) aus einer TrueType-Schrift.

    NUR FUER DIE VORSCHAU. Die Groesse wird so gewaehlt, dass die Zeichen in
    die Zelle passen; Maße und Lage stimmen damit, die Form nicht ganz.
    """
    Image = pil()
    from PIL import ImageDraw, ImageFont
    groesse = hoehe
    while groesse > 6:
        schrift = ImageFont.truetype(ttf, groesse)
        oben, unten = schrift.getmetrics()
        if schrift.getlength("M") <= breite and oben + unten <= hoehe:
            break
        groesse -= 1
    zeilenbytes = (breite + 7) // 8
    glyphen = bytearray()
    for c in range(256):
        zelle = Image.new("1", (breite, hoehe), 0)
        if 32 <= c < 127 or 160 <= c < 256:
            ImageDraw.Draw(zelle).text((0, (hoehe - oben - unten) // 2), chr(c), fill=1, font=schrift)
        for y in range(hoehe):
            for bx in range(zeilenbytes):
                wert = 0
                for bit in range(8):
                    x = bx * 8 + bit
                    if x < breite and zelle.getpixel((x, y)):
                        wert |= 0x80 >> bit
                glyphen.append(wert)
    kopf = struct.pack("<8I", 0x864AB572, 0, 32, 0, 256, zeilenbytes * hoehe, hoehe, breite)
    with gzip.open(pfad, "wb") as f:
        f.write(kopf + bytes(glyphen))


def schriften(ordner, arbeit):
    """-> (gross, klein, ersatz?) — Pfade der beiden Schriften."""
    namen = ("Lat15-DejaVuBold30x16.psf.gz", "Lat15-TerminusBold24x12.psf.gz")
    for o in ([ordner] if ordner else list(SCHRIFTORTE)):
        pfade = [os.path.join(o, n) for n in namen]
        if all(os.path.isfile(p) for p in pfade):
            return pfade[0], pfade[1], False
    ttf = next((t for t in ERSATZ_TTF if os.path.isfile(t)), None)
    if ttf is None:
        print("Weder die Konsolenschriften der Box noch DejaVu Sans Mono gefunden.",
              file=sys.stderr)
        print(__doc__.split("Die echten holen:")[1].split("DIE ZEIT")[0], file=sys.stderr)
        sys.exit(2)
    gross, klein = os.path.join(arbeit, "gross.psf.gz"), os.path.join(arbeit, "klein.psf.gz")
    psf2_bauen(ttf, 16, 30, gross)
    psf2_bauen(ttf, 12, 24, klein)
    return gross, klein, True


# ── Vorschau ───────────────────────────────────────────────────────────────
def papierschirm(bs, breite, hoehe, bpp):
    s = bs.Schirm.__new__(bs.Schirm)
    s.b, s.h, s.bpp = breite, hoehe, bpp
    s.bp = bpp // 8
    s.puffer = bytearray(breite * hoehe * s.bp)
    s.mm, s.fd = None, None
    s.zeigen = lambda: None
    s.schliessen = lambda: None
    return s


def als_bild(schirm):
    Image = pil()
    roh = bytes(schirm.puffer)
    if schirm.bpp == 32:
        return Image.frombytes("RGB", (schirm.b, schirm.h), roh, "raw", "BGRX")
    return Image.frombytes("RGB", (schirm.b, schirm.h), roh, "raw", "BGR;16")


def vorschau(a):
    Image = pil()
    bs = splash_laden()
    bs.boxname = lambda: a.name                  # sonst die Konfiguration der Box
    ziel = Path(a.ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as arbeit:
        gross_p, klein_p, ersatz = schriften(a.schriften, arbeit)
        gross, klein = bs.Schrift(gross_p), bs.Schrift(klein_p)
    logo = bs.Bild(str(a.logo)) if a.logo else None
    schirm = papierschirm(bs, a.breite, a.hoehe, a.bpp)
    n = len(bs.MEILENSTEINE)

    def bild(erreicht, takt):
        offen = bs.MEILENSTEINE[erreicht][0] if erreicht < n else ""
        bs.malen(schirm, gross, klein, erreicht, takt, offen, logo, a.kiosk)
        return als_bild(schirm)

    t0 = time.perf_counter()
    bild(0, 0)                                   # baut Basis, Sterne, Figur
    aufbau = time.perf_counter() - t0

    # Einzelbilder: jeder Stand zu einem Zeitpunkt, an dem eine Schnuppe fliegt.
    for e in range(n + 1):
        bild(e, int((e * bs.SCHNUPPE_ALLE + 0.5) * bs.BILD_PRO_S)).save(ziel / f"stand-{e}.png")

    # Die Animation: jede Sekunde ein Meilenstein mehr, dann kurz „Fertig".
    bilder, zeiten = [], []
    takte = int(a.sekunden * bs.BILD_PRO_S)
    for takt in range(takte):
        erreicht = min(n, takt * (n + 1) // takte)
        t1 = time.perf_counter()
        bilder.append(bild(erreicht, takt))
        zeiten.append(time.perf_counter() - t1)
    tafel = Image.new("RGB", (a.breite, a.hoehe * 3))
    for i, b in enumerate(bilder[:: max(1, len(bilder) // 3)][:3]):
        tafel.paste(b, (0, i * a.hoehe))
    palette = tafel.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    gif = [b.quantize(palette=palette, dither=Image.Dither.NONE) for b in bilder]
    gif[0].save(ziel / "animation.gif", save_all=True, append_images=gif[1:],
                duration=1000 // bs.BILD_PRO_S, loop=0, optimize=False)

    zeiten.sort()
    print(f"Vorschau in {ziel}: stand-0..{n}.png, animation.gif ({len(bilder)} Bilder)")
    print(f"  {a.breite}x{a.hoehe}, {a.bpp} bpp, Name {a.name!r}, Kiosk {a.kiosk}, "
          f"Logo {Path(a.logo).name if a.logo else 'keins'}, {len(bs._basis['lage']['sterne'])} Sterne")
    print(f"  erstes Bild (mit Aufbau) {aufbau * 1000:.0f} ms, danach je Bild "
          f"Median {zeiten[len(zeiten) // 2] * 1000:.1f} ms — AUF DIESEM RECHNER, nicht am Pi")
    if ersatz:
        print("  SCHRIFT: Ersatz aus DejaVu Sans Mono (die Konsolenschriften der Box fehlen hier) — "
              "Lage und Maße stimmen, die Buchstabenform nicht ganz.")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.split("══ WOZU")[0].strip())
    p.add_argument("--startbild", action="store_true", help="mixpi-startbild.png neu bauen")
    p.add_argument("--pruefen", action="store_true", help="Startbild gegen die Quelle pruefen")
    p.add_argument("--quelle", default=str(QUELLE), help="vorhandenes MixPi-Bild (RGBA)")
    p.add_argument("--ziel", help="Ordner fuer die Vorschau")
    p.add_argument("--schriften", help="Ordner mit den Konsolenschriften der Box")
    p.add_argument("--logo", default=str(STARTBILD), help="welches Bild die Vorschau zeigt")
    p.add_argument("--name", default="MixPiBox")
    p.add_argument("--kiosk", default="chromium", choices=("chromium", "cog"))
    p.add_argument("--bpp", type=int, default=32, choices=(16, 32))
    p.add_argument("--breite", type=int, default=800)
    p.add_argument("--hoehe", type=int, default=480)
    p.add_argument("--sekunden", type=float, default=8.0)
    a = p.parse_args()

    if a.startbild:
        startbild_schreiben(a.quelle, STARTBILD)
        return 0
    if a.pruefen:
        befunde = pruefen(a.quelle, STARTBILD)
        for b in befunde:
            print(f"  BEFUND  {b}")
        print(f"Startbild der Boot-Animation: {'in Ordnung' if not befunde else f'{len(befunde)} Befund(e)'}")
        return 1 if befunde else 0
    if not a.ziel:
        p.error("--ziel <ordner> fuer die Vorschau, oder --startbild / --pruefen")
    return vorschau(a)


if __name__ == "__main__":
    sys.exit(main())
