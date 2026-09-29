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
import math
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

# ── Der Sternenhimmel (29.09.2026) ────────────────────────────────────────
# Betreiber: „erstelle mir einen neue boot animation mit sternen und mupibox
# mit dem maskottchen." Geprueft wird, was man dem Bild am Geraet nur mit
# Glueck ansieht: ein Stern im Namen, eine Schnuppe durch die Schrift, eine
# Kante im Himmel um die schwebende Figur.
class StummeSchrift:
    """Eine Schrift ohne Datei: nur die Masse, gemalt wird nichts."""
    def __init__(self, breite, hoehe):
        self.breite, self.hoehe = breite, hoehe

    def textbreite(self, s):
        return len(s) * self.breite

    def malen(self, *_):
        pass


class Klotz:
    """Ein Bild ohne Datei: b x h, ueberall deckendes Weiss."""
    def __init__(self, b, h):
        self.b, self.h = b, h

    def punkt(self, x, y):
        return 255, 255, 255, 255


def leer(schirm, x, y, b, h):
    """Ist das Rechteck unberuehrt schwarz (32 bpp)?"""
    for zy in range(max(0, y), min(schirm.h, y + h)):
        o = (zy * schirm.b + max(0, x)) * 4
        if any(schirm.puffer[o:(zy * schirm.b + min(schirm.b, x + b)) * 4]):
            return False
    return True


zone = (150, 100, 80, 60)
himmel = bs.sternhimmel(400, 300, [zone])
chk("der Himmel hat Sterne", len(himmel) > 10)
chk("kein Stern steht in der Aussparung oder ihrem Rand",
    all(not (zone[0] - 6 <= x < zone[0] + zone[2] + 6 and zone[1] - 6 <= y < zone[1] + zone[3] + 6)
        for x, y, *_ in himmel))
chk("derselbe Samen gibt denselben Himmel", bs.sternhimmel(400, 300, [zone]) == himmel)
# Der hellste Funkelstern auf dem naechsten erlaubten Platz: seine Arme
# duerfen den Rand nicht ueberwinden.
s = FakeSchirm(400, 300)
s.fuellen((0, 0, 0))
nah = [(zone[0] - 7, zone[1] + 20, 2, (255, 255, 255), 0.0, math.pi / 2, 1.0),
       (zone[0] + 20, zone[1] + zone[3] + 6, 2, (255, 255, 255), 0.0, math.pi / 2, 1.0)]
bs.sterne_malen(s, nah, 0.0)
chk("auch voll gestreckte Arme bleiben draussen", leer(s, *zone))
chk("und gemalt wurde trotzdem", not leer(s, 0, 0, 400, 300))
for t in (0.0, 0.8, 1.7, 2.9, 4.1):
    bs.sterne_malen(s, himmel, t)
chk("ueber mehrere Sekunden funkelt nichts in die Aussparung", leer(s, *zone))

# Das Raster: auf 16 bpp im Mittel die Farbe, auf 32 bpp genau sie.
farbe = (0x10, 0x0C, 0x2A)
werte = []
for y in range(4):
    v = bs.muster(farbe, y, 16)
    werte += [bs.von565(v[2 * i:2 * i + 2]) for i in range(4)]
mittel = [sum(w[k] for w in werte) / 16 for k in range(3)]
chk("16 bpp: das Raster trifft die Farbe im Mittel",
    all(abs(mittel[k] - farbe[k]) <= 2.5 for k in range(3)))
chk("16 bpp: und mischt dafuer benachbarte Stufen", len(set(werte)) > 1)
chk("32 bpp: eine ganzzahlige Farbe bleibt genau sie selbst",
    bs.muster(farbe, 1, 32) == bs.punkt(*farbe, 32) * 4)
s = FakeSchirm(10, 1)
s.fuellen((0, 0, 0))
s.spanne(0, 3, 7, bs.punkt(9, 9, 9, 32) * 4)
chk("eine Spanne fuellt genau von..bis", [s.puffer[i * 4] for i in range(10)] == [0, 0, 0, 9, 9, 9, 9, 0, 0, 0])

# Die Figur: deckend ersetzt, durchsichtig laesst durch, halb mischt — und
# jede Schwebehoehe wird EINMAL gebaut.
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "figur.png")
    schreibe_png(p, 3, 2, lambda x, y: [(255, 0, 0, 255), (255, 255, 255, 128), (0, 255, 0, 0)][x], 6)
    s = FakeSchirm(6, 5)
    s.fuellen((0, 0, 255))
    basis = bytes(s.puffer)
    f = bs.Figur(bs.Bild(p), 1, 1, bpp=32)

    def bei(x, y):
        o = (y * 6 + x) * 4
        return s.puffer[o + 2], s.puffer[o + 1], s.puffer[o]

    f.zeichnen(s, basis, 0)
    chk("deckend: die Farbe des Bildes", bei(1, 1) == (255, 0, 0))
    chk("halb: gemischt mit dem Grund", 120 <= bei(2, 1)[0] <= 135 and bei(2, 1)[2] == 255)
    chk("durchsichtig: der Grund bleibt", bei(3, 1) == (0, 0, 255))
    s.puffer[:] = basis
    f.zeichnen(s, basis, 1)
    chk("um 1 verschoben steht es eine Zeile tiefer", bei(1, 2) == (255, 0, 0) and bei(1, 1) == (0, 0, 255))
    f.zeichnen(s, basis, 1)
    f.zeichnen(s, basis, 0)
    chk("jede Hoehe wird nur einmal gebaut", len(f._streifen) == 2)
    f2 = bs.Figur(bs.Bild(p), -2, 4, bpp=32)
    s.puffer[:] = basis
    f2.zeichnen(s, basis, 3)
    chk("halb ausserhalb des Schirms: kein Absturz, nichts gemalt", bytes(s.puffer) == basis)

# Die Pillen: erreichte in ihrer Stiftfarbe, die naechste glimmt, der Rest dunkel.
s = FakeSchirm(800, 40)
s.fuellen((0, 0, 0))
lage = {"pille_x": 154, "pille_y": 10, "pille_b": 72}
bs.pillen_malen(s, lage, 2, 0.3)


def pille(i):
    x = 154 + i * (72 + bs.PILLE_LUECKE) + 36
    o = ((10 + bs.PILLE_H // 2) * 800 + x) * 4
    return s.puffer[o + 2], s.puffer[o + 1], s.puffer[o]


chk("erreichte Pillen tragen ihre Stiftfarbe", pille(0) == bs.ANTENNEN[0] and pille(1) == bs.ANTENNEN[1])
chk("die naechste glimmt — weder dunkel noch schon ganz an",
    pille(2) not in (bs.LEISTE, bs.ANTENNEN[2]))
chk("der Rest bleibt dunkel", pille(3) == bs.LEISTE and pille(5) == bs.LEISTE)

# Die Aufteilung: Figur, Name und Text ueberschneiden sich nicht, auch nicht
# beim Schweben, und die letzte Zeile bleibt auf dem Schirm.
for b, h in ((800, 480), (480, 320), (1280, 720)):
    s = FakeSchirm(b, h)
    _, lage = bs.komponieren(s, StummeSchrift(16, 30), StummeSchrift(12, 24), "MixPiBox", Klotz(172, 200))
    fig = lage["figur"]
    titel_oben = lage["schnuppe_bis"] + 16
    chk(f"{b}x{h}: die schwebende Figur bleibt ueber dem Namen",
        fig.y + fig.h + bs.SCHWEBEN < titel_oben and fig.y - bs.SCHWEBEN >= 0)
    chk(f"{b}x{h}: die letzte Zeile bleibt auf dem Schirm", lage["zaehler_y"] + 24 <= h - 10)
    breite = 6 * lage["pille_b"] + 5 * bs.PILLE_LUECKE
    chk(f"{b}x{h}: die Pillen passen und stehen mittig",
        breite <= b and abs(2 * lage["pille_x"] + breite - b) <= 1)

# Die Sternschnuppe bleibt ueber dem Namen — eine Minute lang, jede einzelne.
s = FakeSchirm(800, 480)
s.fuellen((0, 0, 0))
_, lage = bs.komponieren(s, StummeSchrift(16, 30), StummeSchrift(12, 24), "MixPiBox", Klotz(172, 200))
s.fuellen((0, 0, 0))
for takt in range(0, 60 * bs.BILD_PRO_S):
    bs.schnuppe_malen(s, lage, takt / bs.BILD_PRO_S)
chk("es fliegen Sternschnuppen", not leer(s, 0, 0, 800, lage["schnuppe_bis"]))
chk("keine zieht unter die Oberkante des Namens",
    leer(s, 0, lage["schnuppe_bis"] + 2, 800, 480 - lage["schnuppe_bis"] - 2))

# Und das Ganze: fuenf Sekunden Animation auf beiden Farbtiefen, ohne Absturz.
for bpp in (32, 16):
    s = FakeSchirm(800, 480, bpp)
    s.zeigen = lambda: None
    klotz = Klotz(172, 200)
    try:
        for takt in range(0, 50, 3):
            bs.malen(s, StummeSchrift(16, 30), StummeSchrift(12, 24), takt // 9, takt,
                     "Netzwerk", klotz, "cog")
        chk(f"{bpp} bpp: malen() laeuft fuenf Sekunden durch", True)
    except Exception as e:                          # noqa: BLE001
        chk(f"{bpp} bpp: malen() laeuft fuenf Sekunden durch ({e})", False)

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
