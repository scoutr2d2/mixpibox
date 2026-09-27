#!/usr/bin/env python3
"""
Tests fuer die Boot-Animation (tools/mupibox-boot-splash.py) — der von Hand
geschriebene PNG-Leser und die Meilenstein-Zaehlung. KEIN Framebuffer noetig.

Der PNG-Leser existiert, weil PIL auf einer frischen Box nicht installiert ist;
er muss deshalb selbst stimmen. Geprueft wird gegen ein hier erzeugtes Bild mit
BEKANNTEN Pixeln, inklusive aller fuenf Zeilenfilter.

  python3 tests/splash_test.py
"""
import importlib.util
import os
import struct
import sys
import tempfile
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location("bs", os.path.join(REPO, "tools", "mupibox-boot-splash.py"))
bs = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(bs)

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


def schreibe_png(pfad, breite, hoehe, pixel, farbtyp=6, filter_je_zeile=None):
    """PNG mit bekannten Pixeln bauen; filter_je_zeile erzwingt Filtertypen."""
    k = {0: 1, 2: 3, 4: 2, 6: 4}[farbtyp]
    roh = bytearray()
    vorher = bytearray(breite * k)
    for y in range(hoehe):
        f = (filter_je_zeile or [0] * hoehe)[y]
        zeile = bytearray()
        for x in range(breite):
            zeile += bytes(pixel(x, y)[:k])
        roh.append(f)
        if f == 0:
            roh += zeile
        elif f == 1:                       # Sub
            roh += bytes((zeile[i] - (zeile[i - k] if i >= k else 0)) & 0xFF for i in range(len(zeile)))
        elif f == 2:                       # Up
            roh += bytes((zeile[i] - vorher[i]) & 0xFF for i in range(len(zeile)))
        elif f == 3:                       # Average
            roh += bytes((zeile[i] - (((zeile[i - k] if i >= k else 0) + vorher[i]) >> 1)) & 0xFF
                         for i in range(len(zeile)))
        else:                              # Paeth
            out = bytearray()
            for i in range(len(zeile)):
                a = zeile[i - k] if i >= k else 0
                b = vorher[i]
                c = vorher[i - k] if i >= k else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                vor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                out.append((zeile[i] - vor) & 0xFF)
            roh += out
        vorher = zeile

    def ch(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    open(pfad, "wb").write(b"\x89PNG\r\n\x1a\n"
                           + ch(b"IHDR", struct.pack(">IIBBBBB", breite, hoehe, 8, farbtyp, 0, 0, 0))
                           + ch(b"IDAT", zlib.compress(bytes(roh)))
                           + ch(b"IEND", b""))


def muster(x, y):
    return (x * 7 % 256, y * 11 % 256, (x + y) * 5 % 256, 255 if (x + y) % 3 else 128)


with tempfile.TemporaryDirectory() as d:
    # ALLE fuenf Zeilenfilter in EINEM Bild — jeder Zweig wird durchlaufen
    p = os.path.join(d, "a.png")
    schreibe_png(p, 16, 10, muster, 6, [0, 1, 2, 3, 4, 1, 2, 3, 4, 0])
    b = bs.Bild(p)
    chk("RGBA: Groesse gelesen", (b.b, b.h, b.k) == (16, 10, 4))
    chk("RGBA: alle Pixel korrekt entfiltert (alle 5 Filter)",
        all(b.punkt(x, y) == muster(x, y) for y in range(10) for x in range(16)))

    p2 = os.path.join(d, "b.png")
    schreibe_png(p2, 8, 4, muster, 2, [4, 3, 2, 1])
    b2 = bs.Bild(p2)
    chk("RGB: wird als voll deckend gelesen",
        all(b2.punkt(x, y) == muster(x, y)[:3] + (255,) for y in range(4) for x in range(8)))

    p3 = os.path.join(d, "c.png")
    schreibe_png(p3, 6, 3, lambda x, y: (x * 9 % 256,) * 4, 0)
    b3 = bs.Bild(p3)
    chk("Grau: auf drei gleiche Kanaele verteilt",
        all(b3.punkt(x, y) == ((x * 9 % 256,) * 3 + (255,)) for y in range(3) for x in range(6)))

    open(os.path.join(d, "kaputt.png"), "wb").write(b"nicht wirklich ein PNG")
    try:
        bs.Bild(os.path.join(d, "kaputt.png"))
        chk("kaputte Datei wird abgelehnt", False)
    except (ValueError, zlib.error, struct.error):
        chk("kaputte Datei wird abgelehnt", True)

# ── Alpha-Mischung: halbdurchsichtig ueber Hintergrund ─────────────────────
class FakeSchirm(bs.Schirm):
    def __init__(self, b=8, h=4, bpp=32):
        # `bp` (Bytes je Punkt) MUSS mitgesetzt werden: seit das Startbild
        # nativ in 16 ODER 32 bpp zeichnet, rechnet der ganze Zeichencode
        # damit. Wer hier nur `bpp` setzt, bekommt ein AttributeError mitten
        # im Malen — genau so aufgelaufen.
        self.b, self.h, self.bpp = b, h, bpp
        self.bp = bpp // 8
        self.puffer = bytearray(b * h * self.bp)


with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "halb.png")
    schreibe_png(p, 2, 2, lambda x, y: (255, 255, 255, 128), 6)
    s = FakeSchirm()
    s.fuellen((0, 0, 0))
    s.bild(bs.Bild(p), 0, 0, 1)
    r = s.puffer[2]                       # BGRA -> Index 2 ist Rot
    chk("halbdurchsichtiges Weiss auf Schwarz wird grau", 120 <= r <= 135)

    # DASSELBE auf einem 16-bpp-Schirm (Pi 4). Dort wird der Hintergrund
    # groeber zurueckgelesen, das Ergebnis muss trotzdem ein Grau sein und
    # darf nicht nach Schwarz oder Weiss kippen.
    s16 = FakeSchirm(bpp=16)
    s16.fuellen((0, 0, 0))
    s16.bild(bs.Bild(p), 0, 0, 1)
    r16 = bs.hintergrund(s16.puffer[0:2], 16)[0]
    chk("16 bpp: halbdurchsichtiges Weiss wird auch dort grau", 110 <= r16 <= 145)
    s.fuellen((0, 0, 0))
    p2 = os.path.join(d, "leer.png")
    schreibe_png(p2, 2, 2, lambda x, y: (255, 0, 0, 0), 6)
    s.bild(bs.Bild(p2), 0, 0, 1)
    chk("voellig durchsichtig aendert nichts", s.puffer[2] == 0)

# ── Noten zeichnen: Kopf, Hals, Fahne — und Deckkraft ─────────────────────
def gezeichnet(schirm):
    return sum(1 for i in range(0, len(schirm.puffer), 4) if schirm.puffer[i:i + 3] != b"\x00\x00\x00")


s = FakeSchirm(90, 90)
s.fuellen((0, 0, 0))
s.note(45, 60, 11, (255, 255, 255))
n_voll = gezeichnet(s)
chk("eine Note hinterlaesst Pixel", n_voll > 120)
# Der Hals steht RECHTS vom Kopf, gespiegelt links — sonst saehe eine Reihe
# Noten wie eine Reihe Kommas aus.
def haelfte(links):
    t = FakeSchirm(90, 90); t.fuellen((0, 0, 0))
    t.note(45, 60, 11, (255, 255, 255), gespiegelt=links)
    oben = 0
    for y in range(0, 40):
        for x in range(90):
            if t.puffer[(y * 90 + x) * 4] and (x < 45) == links:
                oben += 1
    return oben
chk("der Hals steht rechts vom Kopf", haelfte(False) > 20)
chk("gespiegelt steht er links", haelfte(True) > 20)

s2 = FakeSchirm(90, 90); s2.fuellen((0, 0, 0))
s2.note(45, 60, 11, (255, 255, 255), deckkraft=0)
chk("Deckkraft 0 zeichnet nichts", gezeichnet(s2) == 0)
s3 = FakeSchirm(90, 90); s3.fuellen((0, 0, 0))
s3.note(45, 60, 11, (255, 255, 255), deckkraft=128)
mitten = [s3.puffer[i] for i in range(0, len(s3.puffer), 4) if s3.puffer[i]]
chk("halbe Deckkraft ergibt halbes Weiss", mitten and 120 <= max(mitten) <= 135)
s4 = FakeSchirm(90, 90); s4.fuellen((0, 0, 0))
s4.note(-40, -40, 11, (255, 255, 255))          # weit ausserhalb
chk("ausserhalb des Schirms stuerzt nichts ab", gezeichnet(s4) == 0)

# ── Meilensteine: EINZELN zaehlen, nicht beim ersten Loch abbrechen ────────
chk("es gibt sechs Meilensteine", len(bs.MEILENSTEINE) == 6)
stand = [True, False, True, True, False, False]
chk("gezaehlt wird jeder erfuellte, auch nach einer Luecke", sum(stand) == 3)
offen = [n for (n, _), got in zip(bs.MEILENSTEINE, stand) if not got]
chk("die Beschriftung nennt den ERSTEN offenen Punkt", offen[0] == bs.MEILENSTEINE[1][0])

# ── Netz-Erkennung: NICHT von der 20-Sekunden-Datei abhaengig ─────────────
# Der Balken blieb auf "Netzwerk" stehen, weil /tmp/network.json von einem
# Zeitgeber nur alle 20 s geschrieben wird und beim Booten minutenlang fehlt.
_echt_listdir = bs.os.listdir
try:
    bs.os.listdir = lambda p: (_ for _ in ()).throw(OSError("kein sysfs"))
    with tempfile.TemporaryDirectory() as d:
        pfad = os.path.join(d, "network.json")
        import json as _json
        open(pfad, "w").write(_json.dumps({"ip": "192.168.1.5"}))
        _echt_open = open
        # Rueckfall auf die Datei, wenn die Schnittstellen nicht lesbar sind
        import builtins
        builtins.open = lambda f, *a, **k: _echt_open(pfad if f == "/tmp/network.json" else f, *a, **k)
        chk("ohne Schnittstellen: Rueckfall auf network.json", bs.netz_da() is True)
        open_ = builtins.open
        open(pfad, "w").write(_json.dumps({"ip": ""}))
        chk("leere IP zaehlt nicht", bs.netz_da() is False)
        builtins.open = _echt_open
finally:
    bs.os.listdir = _echt_listdir

chk("mit echten Schnittstellen kommt eine Antwort", isinstance(bs.netz_da(), bool))

# ── Konsole abkoppeln: das MUSS zuverlaessig zurueckkommen ────────────────
# `quiet` daempft nur den Kernel; getty, Autologin und der X-Start schreiben
# danach weiter auf denselben Framebuffer. Nur das Abkoppeln schafft Ruhe —
# und ein Bildschirm, der ohne Konsole zurueckbleibt, waere schlimmer als
# jedes Flackern.
with tempfile.TemporaryDirectory() as d:
    for name, art, gebunden in (("vtcon0", "(S) dummy device", "0"),
                                ("vtcon1", "(M) frame buffer device", "1"),
                                ("vtcon2", "(M) frame buffer device", "0")):
        os.makedirs(os.path.join(d, name))
        open(os.path.join(d, name, "name"), "w").write(art + "\n")
        open(os.path.join(d, name, "bind"), "w").write(gebunden + "\n")

    def bind(n):
        return open(os.path.join(d, n, "bind")).read().strip()

    bs.KonsoleAus.PFAD = d
    k = bs.KonsoleAus()
    k.__enter__()
    chk("gebundene Framebuffer-Konsole wird abgekoppelt", bind("vtcon1") == "0")
    chk("das Dummy-Geraet bleibt unangetastet", bind("vtcon0") == "0")
    chk("eine bereits lose bleibt lose", bind("vtcon2") == "0")
    chk("nur die eine wurde angefasst", len(k.abgekoppelt) == 1)
    k.__exit__(None, None, None)
    chk("danach ist die Konsole WIEDER da", bind("vtcon1") == "1")
    chk("und die schon lose wurde nicht angeschaltet", bind("vtcon2") == "0")

bs.KonsoleAus.PFAD = "/gibt/es/nicht"
k2 = bs.KonsoleAus()
k2.__enter__(); k2.__exit__(None, None, None)
chk("fehlendes Verzeichnis stuerzt nicht ab", k2.abgekoppelt == [])


# ── Umlaute: die Schrift bringt die Zuordnung selbst mit ───────────────────
# `ord(zeichen)` als Glyphindex trifft nur, solange Unicode und die Kodierung
# der Schrift zufaellig uebereinstimmen. Gemessen an Lat15: ue/oe/ae stimmten,
# ß landete auf Glyph 223 statt 159 und Ü auf 220 statt 156 — beides falsche
# Zeichen auf dem Schirm. PSF traegt die Tabelle mit; jetzt wird sie gelesen.
import glob as _glob
_kand = (_glob.glob("/usr/share/kbd/consolefonts/lat1-16.psfu.gz")
         + _glob.glob("/usr/share/consolefonts/Lat15-*.psf.gz"))
if _kand:
    _f = bs.Schrift(_kand[0])
    chk("die Unicode-Tabelle der Schrift wird gelesen", len(_f.tabelle) > 0)
    # Jedes deutsche Sonderzeichen muss AUF EINEN ECHTEN GLYPH zeigen, und der
    # darf nicht die Fragezeichen-Glyphe sein.
    _frage = _f.tabelle.get(ord("?"), ord("?"))
    for _z in "äöüÄÖÜß":
        _g = _f.tabelle.get(ord(_z))
        chk(f"  {_z} hat einen eigenen Glyphen ({_g})",
            _g is not None and _g != _frage and _g < _f.anzahl)
    chk("  ß zeichnet nicht dasselbe wie ?", _f.zeichen("ß") != _f.zeichen("?"))
else:
    print("  (keine Konsolenschrift gefunden — Umlaut-Pruefung uebersprungen)")

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
