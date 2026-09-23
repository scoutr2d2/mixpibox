#!/usr/bin/env python3
"""Boot-Animation fuer die MixPiBox — direkt auf den Framebuffer.

Der Fork zeigt nur ein STATISCHES Bild (splash_screen.sh: `fbv <bild>`), und fbv
ist auf einem nackten DietPi nicht einmal installiert. Hier stattdessen eine
Animation mit ECHTEM Fortschritt: die Balkenfuellung kommt aus tatsaechlich
erreichten Meilensteinen, nicht aus einem Timer, der eine Bootdauer errraet.

Bewusst nur Standardbibliothek: PIL ist nicht installiert, und eine
Boot-Animation darf nicht an einem nachzuinstallierenden Paket haengen. Schrift
kommt aus den vorhandenen Konsolenschriften (PSF), Pixel gehen per mmap direkt
nach /dev/fb0.

Beendet sich selbst, sobald der Kiosk-Browser laeuft — ab da gehoert der Schirm
ihm. Fehlt der Framebuffer oder klemmt etwas, endet das Skript still: eine
kaputte Animation darf den Start nie aufhalten.

WARUM DIESE DATEI IN ZWEI REPOS LIEGT (BACKLOG E11c/S2, 04.08.2026)
Bis zum 04.08.2026 stand sie NUR im remote-step-installer, und dort als
`[opt]`-Schritt. Beide Boxen im Haus haben die Animation also, eine frisch aus
dem box-Repo bespielte Karte haette sie NICHT bekommen — dieselbe Bauart wie
beim Luefterschalter, bei zram/B7 und bei dhcp-schneller.sh: etwas ist auf den
GERAETEN, aber kein Ausrollweg bringt es dorthin. Im box-Repo ist sie seitdem
Pflicht, kein Zusatz.

Seither liegt sie doppelt: box `scripts/mupibox/`, Installer `tools/`. ACHTUNG,
die beiden Wege legen sie an VERSCHIEDENE Stellen — Installer nach
/usr/local/bin/mupibox-boot-splash.py, box-Repo nach
/usr/local/bin/mupibox/mupibox-boot-splash.py, und der Update-Weg raeumt die
alte Stelle dabei weg. Jede Unit zeigt auf ihren eigenen Pfad; das ist
Absicht und darf NICHT gleichgezogen werden. Der INHALT dieser Datei gehoert
dagegen an beide Stellen. Gegenprobe: python3 tools/zwillingsdateien-abgleich.py

WAS SIE VERDECKT, IST GEMESSEN (tools/grundmessung.py, 04.08.2026, vier
Kaltstarts am Pi 5 / DietPi Trixie): 19,4 bis 23,8 s vom Einschalten bis zum
brauchbaren Bild, davon der Schirm durchgehend SCHWARZ (heller Anteil 0,000).
Es gibt kein Zwischenbild, das die Wartezeit erklaert — genau diese Luecke
fuellt dieses Skript.

WAS ES NICHT TUT: es startet nichts, es repariert nichts und es haelt nichts
auf. Bleibt ein Meilenstein aus, steht der Balken ehrlich still; nach 120 s
endet es. Wer wissen will, ob der Start SCHIEFGEGANGEN ist, braucht das
Fehlerbild (mupibox-fehlerbild.py) und die Kioskwache (mupibox-kioskwache.py)
daneben — dieses Skript hier ist nur die Anzeige.
"""
import gzip
import math
import mmap
import os
import signal
import socket
import struct
import subprocess
import sys
import time
import zlib

FB = "/dev/fb0"
SCHRIFT_GROSS = "/usr/share/consolefonts/Lat15-DejaVuBold30x16.psf.gz"
SCHRIFT_KLEIN = "/usr/share/consolefonts/Lat15-TerminusBold24x12.psf.gz"
# ══ WO DAS BILD WIRKLICH LIEGT ══════════════════════════════════════════
# Betreiber, 10.08.2026: „das Mixpibild ist immer noch nicht beim boot screen."
# Die Liste suchte an drei Orten aus der MuPiBox-Zeit. AM GERAET GEMESSEN
# (find / -name mixpi-hoert.png) liegt es an ganz anderen — die stehen jetzt
# VORNE, damit sie gewinnen. Findet der Splash nichts, malt er seinen eigenen
# gezeichneten Kopf; das sieht nach Absicht aus und faellt deshalb nicht auf.
# `/var/www/images/mupi_round_trans.png` IST HERAUS (20.08.2026): Der Ordner
# gehoerte dem PHP-Admin, und der ist mit E47 ausgebaut. Ein Suchpfad, der
# nirgends mehr existieren kann, kostet bei jedem Start einen Dateizugriff und
# suggeriert beim Lesen, es gebe dort noch etwas. Am Geraet nachgesehen: von
# den verbliebenen Pfaden greift der favicon-Eintrag.
LOGOS = ["/usr/local/bin/mupibox/mixpi-hoert.png",
         "/opt/mixpibox-einrichtung/mixpi-hoert.png",
         "/boot/firmware/einrichtung/mixpi-hoert.png",
         "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/assets/icon/favicon.png",
         "/boot/splash.png"]
MAX_LAUFZEIT = 120          # Notbremse: nie laenger als 2 min stehenbleiben
# 10 STATT 20 (14.08.2026, Audit-Merkposten 4.4): dieses Skript rechnet in
# reinem Python und laeuft genau in der Minute, in der Backend, X und
# Chromium um dieselben vier Kerne ringen. Zehn Bilder je Sekunde sehen bei
# sechs treibenden Noten gleich fluessig aus (der Notenlauf ist
# zeitkompensiert, siehe NOTEN_TEMPO) — und kosten die halbe Rechenzeit.
# Dazu malt jedes Bild seit demselben Datum nur noch die BEWEGTEN Zonen:
# Hintergrund, Logo und Schriftzug stehen fertig in einem Basis-Puffer
# (siehe malen()), statt je Bild pixelweise neu zu entstehen.
BILD_PRO_S = 10
# Der Notenstrom in Umlaeufen je TAKT: frueher stand hier ein nacktes 0.021
# bei 20 Bildern je Sekunde. An die Bildrate gekoppelt bleibt die SICHTBARE
# Geschwindigkeit gleich, egal was oben steht.
NOTEN_TEMPO = 0.42 / BILD_PRO_S

HINTERGRUND = (0x12, 0x12, 0x12)
AKZENT = (0x44, 0xAF, 0xE2)     # Themenfarbe des Forks
TEXT = (0xEA, 0xF1, 0xF8)
GEDIMMT = (0x76, 0x8E, 0x9F)


def punkt565(r, g, bl):
    """EINE Farbe als RGB565-Punkt (2 Byte, little endian).

    5 Bit Rot, 6 Bit Gruen, 5 Bit Blau. Gruen bekommt das zusaetzliche Bit,
    weil das Auge dort am genauesten ist - die uebliche Aufteilung, nicht
    unsere Erfindung.
    """
    w = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (bl >> 3)
    return bytes((w & 0xFF, w >> 8))


def von565(zwei):
    """RGB565-Punkt zurueck nach (r, g, bl) - fuer das Mischen mit Deckkraft.

    Die zurueckgelesene Farbe ist GROEBER als die geschriebene (5 bzw. 6 Bit
    statt 8). Das ist keine Ungenauigkeit im Code, sondern das, was auf einem
    16-bpp-Schirm wirklich steht.
    """
    w = zwei[0] | (zwei[1] << 8)
    r = (w >> 8) & 0xF8
    g = (w >> 3) & 0xFC
    bl = (w << 3) & 0xF8
    return r | (r >> 5), g | (g >> 6), bl | (bl >> 5)


def punkt(r, g, bl, bpp):
    """Eine Farbe im Format des Framebuffers - EINMAL je Farbe, nicht je Punkt.

    DAS ist der Kern: frueher wurde bei 32 bpp gezeichnet und danach JEDER
    Bildpunkt umgerechnet - 800x480 = 384000 Schleifendurchlaeufe je Bild,
    auf dem Pi 4 ein Kern am Anschlag. Jetzt entsteht der Punkt gleich im
    richtigen Format, und die Flaechen werden wie eh und je als Wiederholung
    dieses Musters geschrieben. Kein Umrechnen mehr, weder schnell noch
    langsam - es gibt schlicht keines.
    """
    return bytes((bl, g, r, 0)) if bpp == 32 else punkt565(r, g, bl)


def hintergrund(roh, bpp):
    """Einen gelesenen Punkt nach (r, g, bl) - Gegenstueck zu punkt()."""
    return (roh[2], roh[1], roh[0]) if bpp == 32 else von565(roh)


# ── Framebuffer ────────────────────────────────────────────────────────────
class Schirm:
    def __init__(self):
        with open("/sys/class/graphics/fb0/virtual_size") as f:
            self.b, self.h = (int(v) for v in f.read().strip().split(","))
        with open("/sys/class/graphics/fb0/bits_per_pixel") as f:
            self.bpp = int(f.read().strip())
        if self.bpp not in (16, 32):
            raise RuntimeError(f"nur 16 und 32 bpp unterstuetzt, hier {self.bpp}")
        self.fd = os.open(FB, os.O_RDWR)
        self.bp = self.bpp // 8          # Bytes je Bildpunkt: 2 oder 4
        self.mm = mmap.mmap(self.fd, self.b * self.h * self.bp, mmap.MAP_SHARED,
                            mmap.PROT_WRITE | mmap.PROT_READ)
        # NATIV IM FORMAT DES FRAMEBUFFERS gezeichnet, nicht umgerechnet.
        # Der Pi 4 faehrt seinen Schirm mit 16 bpp hoch, der Pi 5 mit 32; der
        # Puffer hat genau die Groesse, die der Schirm erwartet, und wird
        # unveraendert hinuebergeschrieben.
        self.puffer = bytearray(self.b * self.h * self.bp)

    def fuellen(self, farbe):
        px = punkt(*farbe, self.bpp)
        self.puffer[:] = px * (self.b * self.h)

    def rechteck(self, x, y, br, ho, farbe, radius=0):
        px = punkt(*farbe, self.bpp)
        for zy in range(max(0, y), min(self.h, y + ho)):
            if radius:
                dy = min(zy - y, (y + ho - 1) - zy)
                if dy < radius:
                    ein = radius - int((radius * radius - (radius - dy - 1) ** 2) ** 0.5)
                else:
                    ein = 0
            else:
                ein = 0
            von, bis = max(0, x + ein), min(self.b, x + br - ein)
            if bis <= von:
                continue
            o = (zy * self.b + von) * self.bp
            self.puffer[o:o + (bis - von) * self.bp] = px * (bis - von)

    def bild(self, bd, x, y, skala=1, teiler=1):
        """PNG zeichnen, Transparenz gegen den Hintergrund verrechnet.

        `teiler` VERKLEINERT — und das fehlte hier bis zum 20.08.2026.
        `skala` konnte nur ganzzahlig VERGROESSERN; ein Logo, das schon zu
        gross war, blieb deshalb in Originalgroesse stehen. Auf dieser Box ist
        das Logo 256x256 bei 480 px Schirmhoehe: die Wahl
        `max(1, min(4, (h//3)//logo.h))` ergab `max(1, 0)` = 1, und der ganze
        Bildblock wurde 520 px hoch — mehr, als der Schirm hat. Alles darunter
        wurde an den unteren Rand gedrueckt.
        Genommen wird jeder `teiler`-te Punkt. Das ist grob, aber es ist eine
        Boot-Animation auf einem 800x480-Panel, und die Alternative waere
        Glaettung in reinem Python, waehrend die Box hochfaehrt.
        """
        zh = max(1, (bd.h * skala) // teiler)
        zb = max(1, (bd.b * skala) // teiler)
        for zy in range(zh):
            py = y + zy
            if not (0 <= py < self.h):
                continue
            qy = (zy * teiler) // skala
            for zx in range(zb):
                px_ = x + zx
                if not (0 <= px_ < self.b):
                    continue
                r, g, bl, a = bd.punkt((zx * teiler) // skala, qy)
                if a == 0:
                    continue
                o = (py * self.b + px_) * self.bp
                if a < 255:      # ueber den vorhandenen Hintergrund mischen
                    hr, hg, hb = hintergrund(self.puffer[o:o + self.bp], self.bpp)
                    bl = (bl * a + hb * (255 - a)) // 255
                    g = (g * a + hg * (255 - a)) // 255
                    r = (r * a + hr * (255 - a)) // 255
                self.puffer[o:o + self.bp] = punkt(r, g, bl, self.bpp)

    def _mischen(self, o, r, g, bl, a):
        """Farbe mit Deckkraft a (0..255) auf den vorhandenen Punkt legen."""
        if a >= 255:
            self.puffer[o:o + self.bp] = punkt(r, g, bl, self.bpp)
            return
        hr, hg, hb = hintergrund(self.puffer[o:o + self.bp], self.bpp)
        self.puffer[o:o + self.bp] = punkt((r * a + hr * (255 - a)) // 255,
                                           (g * a + hg * (255 - a)) // 255,
                                           (bl * a + hb * (255 - a)) // 255, self.bpp)

    def note(self, x, y, groesse, farbe, deckkraft=255, gespiegelt=False):
        """Eine Achtelnote zeichnen: Kopf (geneigte Ellipse), Hals, Fahne.

        Von Hand gerechnet statt als Bild: eine Note muss in jeder Groesse und
        Deckkraft sauber aussehen, und ein PNG je Variante waere Ballast. Der
        Kopf ist eine um ~20 Grad geneigte Ellipse — genau das macht aus einem
        Oval eine Note.

        Die Punkte werden erst GESAMMELT und dann EINMAL gemischt: Kopf, Hals
        und Fahne ueberlappen, und zweimal gemischt verklingen diese Stellen
        beim Ausblenden langsamer als der Rest (ein Test hat es gefunden).
        """
        if deckkraft <= 0:
            return
        r, g, bl = farbe
        rx, ry = groesse * 0.62, groesse * 0.44          # Kopf
        sin, cos = 0.34, 0.94                            # ca. 20 Grad Neigung
        hals_h = int(groesse * 2.6)
        punkte = set()

        def setze(px_, py):
            if 0 <= px_ < self.b and 0 <= py < self.h:
                punkte.add((py * self.b + px_) * self.bp)

        for dy in range(int(-ry * 1.6), int(ry * 1.6) + 1):
            for dx in range(int(-rx * 1.6), int(rx * 1.6) + 1):
                u = (dx * cos + dy * sin) / rx
                v = (-dx * sin + dy * cos) / ry
                if u * u + v * v <= 1.0:
                    setze(x + dx, y + dy)

        hx = x + int(rx * 0.86) * (-1 if gespiegelt else 1)
        breite = max(1, groesse // 7)
        for dy in range(hals_h):
            for dx in range(breite):
                setze(hx + dx - (breite if gespiegelt else 0), y - dy - int(ry * 0.3))

        oben = y - hals_h - int(ry * 0.3)
        for i in range(int(groesse * 1.5)):
            weite = max(1, int(groesse * 0.75 * (1 - i / (groesse * 1.6)) ** 0.7))
            for dx in range(weite):
                setze(hx + (dx if not gespiegelt else -dx), oben + i)

        for o in punkte:
            self._mischen(o, r, g, bl, deckkraft)

    def zeigen(self):
        self.mm.seek(0)
        self.mm.write(bytes(self.puffer))

    def schliessen(self):
        try:
            self.mm.close()
            os.close(self.fd)
        except OSError:
            pass


# ── Bild (PNG) — bewusst von Hand, PIL ist nicht installiert ───────────────
class Bild:
    """Minimaler PNG-Leser: 8 Bit, nicht verschraenkt, RGBA/RGB/Grau.

    zlib steckt in der Standardbibliothek, den Rest macht das Format selbst
    einfach: Bloecke lesen, IDAT entpacken, Zeilenfilter zuruecknehmen. Genau
    dieselbe Haltung wie beim PSF-Schriftleser weiter unten — lieber vierzig
    Zeilen hier als ein Paket, das auf einer frischen Box fehlen kann.
    """

    KANAELE = {0: 1, 2: 3, 4: 2, 6: 4}      # Grau, RGB, Grau+Alpha, RGBA

    def __init__(self, pfad):
        roh = open(pfad, "rb").read()
        if roh[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("kein PNG")
        daten, i = bytearray(), 8
        self.b = self.h = 0
        while i + 8 <= len(roh):
            laenge = struct.unpack(">I", roh[i:i + 4])[0]
            typ = roh[i + 4:i + 8]
            nutz = roh[i + 8:i + 8 + laenge]
            if typ == b"IHDR":
                self.b, self.h, tiefe, farbtyp, _, _, verschraenkt = struct.unpack(">IIBBBBB", nutz[:13])
                if tiefe != 8 or verschraenkt or farbtyp not in self.KANAELE:
                    raise ValueError(f"nicht unterstuetzt: Tiefe {tiefe}, Typ {farbtyp}")
                self.k = self.KANAELE[farbtyp]
            elif typ == b"IDAT":
                daten += nutz
            elif typ == b"IEND":
                break
            i += 12 + laenge
        self.px = self._entfiltern(zlib.decompress(bytes(daten)))

    def _entfiltern(self, roh):
        """Zeilenfilter zuruecknehmen -> flaches Bytefeld mit k Kanaelen."""
        k, breite = self.k, self.b * self.k
        raus = bytearray(breite * self.h)
        vorher = bytearray(breite)
        pos = 0
        for y in range(self.h):
            filt = roh[pos]; pos += 1
            zeile = bytearray(roh[pos:pos + breite]); pos += breite
            for x in range(breite):
                a = zeile[x - k] if x >= k else 0
                b = vorher[x]
                c = vorher[x - k] if x >= k else 0
                if filt == 1:
                    zeile[x] = (zeile[x] + a) & 0xFF
                elif filt == 2:
                    zeile[x] = (zeile[x] + b) & 0xFF
                elif filt == 3:
                    zeile[x] = (zeile[x] + ((a + b) >> 1)) & 0xFF
                elif filt == 4:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    vor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    zeile[x] = (zeile[x] + vor) & 0xFF
            raus[y * breite:(y + 1) * breite] = zeile
            vorher = zeile
        return raus

    def punkt(self, x, y):
        """-> (r, g, b, a) an dieser Stelle."""
        o = (y * self.b + x) * self.k
        p = self.px
        if self.k == 4:
            return p[o], p[o + 1], p[o + 2], p[o + 3]
        if self.k == 3:
            return p[o], p[o + 1], p[o + 2], 255
        if self.k == 2:
            return p[o], p[o], p[o], p[o + 1]
        return p[o], p[o], p[o], 255


# ── PSF-Schrift (Konsolenschriften sind ueberall vorhanden) ────────────────
class Schrift:
    def __init__(self, pfad):
        roh = gzip.open(pfad, "rb").read() if pfad.endswith(".gz") else open(pfad, "rb").read()
        hat_tabelle = False
        if roh[:2] == b"\x36\x04":                      # PSF1
            self.hoehe = roh[3]
            self.breite = 8
            self.anzahl = 512 if roh[2] & 1 else 256
            self.glyphen = roh[4:]
            self.zeilenbytes = 1
            hat_tabelle = bool(roh[2] & 2)
            self.psf1 = True
        elif roh[:4] == b"\x72\xb5\x4a\x86":            # PSF2
            (_, _, kopf, flags, anzahl, groesse, hoehe, breite) = struct.unpack("<8I", roh[:32])
            self.hoehe, self.breite, self.anzahl = hoehe, breite, anzahl
            self.glyphen = roh[kopf:]
            self.zeilenbytes = (breite + 7) // 8
            hat_tabelle = bool(flags & 1)
            self.psf1 = False
        else:
            raise RuntimeError("unbekanntes PSF-Format")
        self.glyphgroesse = self.zeilenbytes * self.hoehe

        # ── DIE UNICODE-TABELLE, und warum es sie braucht ───────────────────
        # `ord(zeichen)` als Glyph-Index zu nehmen trifft nur, solange Unicode
        # und die Kodierung der Schrift zufaellig uebereinstimmen — bei ASCII
        # tun sie das, bei Umlauten nicht mehr verlaesslich. Deshalb stand im
        # ganzen Projekt "ue" statt "ü", und wo doch ein Umlaut durchrutschte,
        # erschien ein fremdes Zeichen.
        # PSF bringt die Zuordnung SELBST mit: hinter den Glyphen steht je
        # Glyph eine Liste der Unicode-Zeichen, die er darstellt, mit 0xFF
        # abgeschlossen (PSF1: 16-bit little endian, PSF2: UTF-8).
        self.tabelle = {}
        if hat_tabelle:
            self._tabelle_lesen(roh)

    def _tabelle_lesen(self, roh):
        """Unicode -> Glyph-Index. Faellt still aus, wenn etwas nicht passt:
        eine kaputte Tabelle darf nie einen schwarzen Schirm bedeuten."""
        try:
            start = (4 if self.psf1 else struct.unpack("<I", roh[8:12])[0]) \
                + self.anzahl * self.glyphgroesse
            rest = roh[start:]
            if self.psf1:
                i = 0
                for glyph in range(self.anzahl):
                    while i + 1 < len(rest):
                        wert = struct.unpack("<H", rest[i:i + 2])[0]
                        i += 2
                        if wert == 0xFFFF:
                            break
                        if wert != 0xFFFE:      # 0xFFFE leitet Folgen ein
                            self.tabelle.setdefault(wert, glyph)
            else:
                for glyph, teil in enumerate(rest.split(b"\xff")):
                    if glyph >= self.anzahl:
                        break
                    for zeichen in teil.split(b"\xfe")[0].decode(
                            "utf-8", "ignore"):
                        self.tabelle.setdefault(ord(zeichen), glyph)
        except (struct.error, ValueError, IndexError):
            self.tabelle = {}

    def zeichen(self, c):
        # ZUERST die Tabelle der Schrift — sie weiss es genau. Erst danach der
        # alte Weg (Codepunkt als Index), der fuer ASCII stimmt und fuer
        # Schriften ohne Tabelle das Beste ist, was geht.
        i = self.tabelle.get(ord(c))
        if i is None:
            i = ord(c)
        if i >= self.anzahl:
            i = self.tabelle.get(ord("?"), ord("?"))
        o = i * self.glyphgroesse
        return self.glyphen[o:o + self.glyphgroesse]

    def textbreite(self, s):
        return len(s) * self.breite

    def malen(self, schirm, s, x, y, farbe):
        px = punkt(*farbe, schirm.bpp)
        for zi, c in enumerate(s):
            gl = self.zeichen(c)
            zx = x + zi * self.breite
            for zy in range(self.hoehe):
                zeile = gl[zy * self.zeilenbytes:(zy + 1) * self.zeilenbytes]
                py = y + zy
                if not (0 <= py < schirm.h):
                    continue
                for sx in range(self.breite):
                    if zeile[sx >> 3] & (0x80 >> (sx & 7)):
                        pxx = zx + sx
                        if 0 <= pxx < schirm.b:
                            o = (py * schirm.b + pxx) * schirm.bp
                            schirm.puffer[o:o + schirm.bp] = px


# ── Konsole vom Framebuffer abkoppeln ──────────────────────────────────────
class KonsoleAus:
    """Die Framebuffer-Konsole waehrend der Animation abkoppeln.

    `quiet` allein genuegt NICHT: es daempft nur die Kernelmeldungen. Danach
    schreiben getty, die automatische Anmeldung und der X-Start weiter auf
    DENSELBEN Framebuffer — Zeilen laufen quer durchs Bild, es flackert (am
    Geraet genau so gesehen). Das Abkoppeln von vtcon (fbcon) ist der einzige
    Weg, der wirklich Ruhe schafft.

    Als Kontextverwalter, damit die Konsole GARANTIERT zurueckkommt — sonst
    stuende man nach einem Fehler vor einem stummen Bildschirm ohne Konsole.
    """

    PFAD = "/sys/class/vtconsole"

    def __init__(self):
        self.abgekoppelt = []

    def __enter__(self):
        try:
            eintraege = os.listdir(self.PFAD)
        except OSError:
            return self
        for name in eintraege:
            b = os.path.join(self.PFAD, name, "bind")
            n = os.path.join(self.PFAD, name, "name")
            try:
                with open(n) as f:
                    if "frame buffer" not in f.read():
                        continue
                with open(b) as f:
                    if f.read().strip() != "1":
                        continue
                with open(b, "w") as f:
                    f.write("0")
                self.abgekoppelt.append(b)
            except OSError:
                continue          # keine Rechte o.ae. -> dann eben mit Flackern
        return self

    def __exit__(self, *_):
        for b in self.abgekoppelt:
            try:
                with open(b, "w") as f:
                    f.write("1")
            except OSError:
                pass
        return False


# ── Meilensteine: ECHTER Fortschritt, keine geratene Dauer ─────────────────
def dienst_laeuft(name):
    try:
        return subprocess.run(["systemctl", "is-active", "--quiet", name],
                              timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def prozess_laeuft(muster):
    try:
        return subprocess.run(["pgrep", "-f", muster], stdout=subprocess.DEVNULL,
                              timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def port_offen(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def netz_da():
    """Hat die Box eine echte IPv4-Adresse? -> True/False

    BEWUSST NICHT ueber /tmp/network.json: die schreibt ein Zeitgeber der
    MuPiBox nur alle 20 s, und beim Booten existiert sie minutenlang nicht.
    Der Balken blieb deshalb auf "Netzwerk" stehen, obwohl die Box langst
    online war (am Geraet gesehen). Direkt gefragt kostet das nichts und
    stimmt sofort.

    Nur Standardbibliothek: SIOCGIFADDR per ioctl, dieselbe Technik wie in der
    Touch-Bruecke nebenan.
    """
    import fcntl
    import socket
    SIOCGIFADDR = 0x8915
    try:
        namen = [n for n in os.listdir("/sys/class/net") if n != "lo"]
    except OSError:
        namen = []
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for n in namen:
            try:
                r = fcntl.ioctl(s.fileno(), SIOCGIFADDR,
                                struct.pack("256s", n[:15].encode()))
                if socket.inet_ntoa(r[20:24]) not in ("", "0.0.0.0"):
                    return True
            except OSError:
                continue
    except OSError:
        pass
    finally:
        if s is not None:
            s.close()
    # Rueckfall: die Datei der Box, falls es sie schon gibt
    try:
        import json
        with open("/tmp/network.json") as f:
            return bool(json.load(f).get("ip"))
    except (OSError, ValueError):
        return False


MEILENSTEINE = [
    ("System startet", lambda: True),
    ("Netzwerk", netz_da),
    ("Dienste", lambda: port_offen(8200)),
    ("Musik-Bibliothek", lambda: dienst_laeuft("mupi_check_internet")),
    ("Anzeige", lambda: prozess_laeuft("[X]org")),
    ("Oberflaeche", lambda: prozess_laeuft("[c]hromium")),
]


def boxname():
    """Wie die Box heisst — aus ihrer Konfiguration, nicht aus einer Konstanten.

    HIER STAND `titel = "MuPiBox"` FEST IM CODE. Der Betreiber am 07.08.2026:
    „im boot screen steht noch mupibox". Das Logo daneben war da schon MixPi —
    der Schriftzug nicht, und er ist das, was man liest.

    DER NAME GEHOERT DER BOX, NICHT DEM PROGRAMM. Genau dieselbe Regel gilt in
    der neuen Oberflaeche (`mupibox.host`, siehe das Wappen unten links in
    NewDesign/index.html): Wer seine Box „Kinderzimmer Box" nennt, will sie
    beim Hochfahren auch so begruesst sehen. Eine zweite fest verdrahtete
    Zeichenkette waere der naechste Ort, an dem die Umbenennung haengenbleibt.

    ES DARF NICHTS KOSTEN, WENN ES MISSLINGT. Dieses Skript laeuft, bevor
    irgendein Dienst steht; die Konfiguration kann fehlen, halb geschrieben
    oder unlesbar sein. Dann gilt der Rueckfall, und der Startbildschirm
    erscheint trotzdem — ein Boot-Splash, der an einer Datei scheitert, ist
    schlimmer als einer mit dem falschen Namen.
    """
    try:
        import json
        with open("/etc/mupibox/mupiboxconfig.json") as f:
            n = json.load(f).get("mupibox", {}).get("host", "")
        n = str(n).strip()
        if n:
            return n
    except (OSError, ValueError, AttributeError):
        pass
    return "MixPiBox"


def kioskumgebung():
    """WOMIT der Kiosk gleich starten wird — chromium oder cog.

    Betreiber, 20.08.2026: „Ich wuerde gerne auch bei dem screen in einer ecke
    sehen welches kiosk enviroment wir laden."

    DIE FRAGE IST BERECHTIGT, weil man es SONST NICHT SIEHT: Beide Wege zeigen
    dieselbe Oberflaeche, und ob gerade Chromium mit X-Server laeuft oder Cog
    auf DRM, erkennt man erst an der Speicherzahl — oder daran, dass ein
    Bedienelement sich anders verhaelt. Wer eine Box hinstellt und umschaltet,
    will beim Hochfahren bestaetigt bekommen, was er gewaehlt hat.

    ES IST DIE ABSICHT UND NICHT DAS ERGEBNIS. Hier steht, was in der
    Konfiguration gewaehlt ist; ob Cog wirklich hochkommt, entscheidet sich
    Sekunden spaeter in chromium-autostart.sh, das notfalls auf Chromium
    zurueckfaellt. Genau deshalb ist die Anzeige nuetzlich: Steht hier „cog"
    und laeuft danach Chromium, war der Rueckfall am Werk — und das ist eine
    Auskunft, die man sonst nirgends bekommt.

    DERSELBE RUECKFALL WIE BEI `boxname()`: eine unlesbare Konfiguration darf
    keinen Startbildschirm kosten.
    """
    try:
        import json

        with open("/etc/mupibox/mupiboxconfig.json") as f:
            b = json.load(f).get("mupibox", {}).get("kioskBrowser", "")
        b = str(b).strip().lower()
        if b in ("chromium", "cog"):
            return b
    except (OSError, ValueError, AttributeError):
        pass
    # Dieselbe Vorgabe wie im Kioskskript (jq '// "chromium"'). Ein dritter
    # Wert waere dort stumm Chromium — hier steht dann dasselbe.
    return "chromium"


# Der unbewegte Teil des Bildes, EINMAL komponiert (14.08.2026, Audit 4.4):
# Hintergrund fuellen, Logo mit Alpha verrechnen und den Schriftzug setzen
# sind die drei teuersten Schritte — und sie aendern sich zwischen zwei
# Bildern nie. Vorher liefen sie zwanzigmal je Sekunde pixelweise in reinem
# Python, waehrend Backend, X und Chromium um dieselben vier Kerne rangen.
# Der Schluessel haelt fest, WOFUER der Puffer gilt; ein anderes Logo oder
# eine andere Schirmgroesse komponieren neu.
_basis = {"schluessel": None, "puffer": None, "oben": 0}


def malen(schirm, gross, klein, erreicht, takt, offen="", logo=None, umgebung="chromium"):
    titel = boxname()
    schluessel = (titel, id(logo), schirm.b, schirm.h, schirm.bpp)
    if _basis["schluessel"] != schluessel:
        schirm.fuellen(HINTERGRUND)
        # Alles als EIN Block senkrecht mittig setzen — sonst klebt es oben und
        # unten bleibt die halbe Anzeige leer (auf 800x480 deutlich sichtbar).
        if logo is not None:
            # ══ DAS LOGO DARF AUCH KLEINER WERDEN (20.08.2026) ══════════════
            # Hier stand nur `max(1, min(4, (schirm.h // 3) // logo.h))`. Diese
            # Wahl kann ausschliesslich VERGROESSERN: Sobald das Logo hoeher
            # ist als ein Drittel des Schirms, wird der Bruch 0 und `max(1, 0)`
            # macht daraus 1 — Originalgroesse.
            # AM GERAET GEMESSEN: das Logo ist 256x256, der Schirm 480 hoch.
            # Der Bildblock wurde damit 520 px hoch, also HOEHER als der
            # Schirm; `kopf` fiel auf sein Minimum 10, und alles darunter
            # wurde an den unteren Rand gedrueckt. Gemeldet als „die x von 5
            # zahl ist bisschen nach unten gerutscht" — die Zahl war nicht
            # verrutscht, sie hatte schlicht keinen Platz mehr.
            ziel = schirm.h // 3
            if logo.h <= ziel:
                sk, teiler = max(1, min(4, ziel // max(1, logo.h))), 1
            else:
                # Aufgerundet, damit das Ergebnis sicher UNTER das Ziel faellt:
                # 256 -> Teiler 2 -> 128 px bei einem Ziel von 160.
                sk, teiler = 1, -(-logo.h // ziel)
            lh = (logo.h * sk) // teiler + 14
        else:
            sk = teiler = 0
            lh = 0
        # ══ DIE BLOCKHOEHE NACHGERECHNET (20.08.2026) ═══════════════════════
        # Betreiber: „die x von 5 zahl ist bisschen nach unten gerutscht."
        #
        # HIER STAND `lh + 34 + 92 + 58 + 76`, und darin steckten ZWEI Fehler,
        # die sich teilweise aufhoben — deshalb fiel es nie ganz auf:
        #   * die `34` war ueberzaehlig. Der Titel wird bei `oben` gemalt, und
        #     `mitte = oben + 92` enthaelt ihn bereits; er wurde also doppelt
        #     gezaehlt.
        #   * die letzte Zeile fehlte. `76` ist der Abstand bis zur OBERKANTE
        #     des Zaehlers; der ist selbst noch `klein.hoehe` hoch (24 px).
        #
        # WAS DER INHALT WIRKLICH BRAUCHT, ab `oben` durchgerechnet:
        #     oben -> mitte      92     (Titel und Notenraum)
        #     mitte -> py        58     (Abstand zur Leiste)
        #     py -> Unterkante  100     (Leiste, Beschriftung py+40,
        #                                Zaehler py+76 plus dessen Hoehe)
        # macht `lh + 250`. Gerechnet wurden `lh + 260` — der Block galt als
        # zu hoch, `kopf` fiel zu klein aus, und der Inhalt sass fuenf Pixel zu
        # weit oben, mit entsprechend mehr Luft unter der Zahl.
        #
        # NACHGERECHNET (800x480, Terminus-24, Logo 64 px): vorher 39 px oben
        # gegen 49 px unten, jetzt 44 gegen 44.
        block = lh + 92 + 58 + 76 + klein.hoehe
        kopf = max(10, (schirm.h - block) // 2)
        if logo is not None:
            schirm.bild(logo, (schirm.b - (logo.b * sk) // teiler) // 2, kopf, sk, teiler)
        oben = kopf + lh
        gross.malen(schirm, titel, (schirm.b - gross.textbreite(titel)) // 2, oben, TEXT)
        _basis["schluessel"] = schluessel
        _basis["puffer"] = bytes(schirm.puffer)
        _basis["oben"] = oben
    else:
        # Ein memcpy statt zehntausender Python-Schleifendurchlaeufe.
        schirm.puffer[:] = _basis["puffer"]
        oben = _basis["oben"]

    # Aufsteigende Noten als Lebenszeichen — passt zu einer Musikbox besser als
    # abstrakte Balken. Rein gerechnet, kein Bild noetig: jede Note steigt,
    # driftet leicht seitlich und verklingt oben.
    # Reichlich Abstand zum Schriftzug: die Noten steigen bis dicht unter ihn,
    # und eine Note, die in die Buchstaben ragt, sieht nach Fehler aus.
    mitte = oben + 92
    NOTEN = 6
    steig = 74                       # Weg einer Note von unten nach oben
    for i in range(NOTEN):
        # Jede Note eigener Startversatz -> ein steter Strom statt Gleichschritt
        lauf = ((takt * NOTEN_TEMPO) + i / NOTEN) % 1.0
        ny = mitte + 30 - int(lauf * steig)
        drift = math.sin(lauf * 6.0 + i) * 9
        nx = int(schirm.b / 2 - 108 + i * 43 + drift)
        # aufblenden im ersten Fuenftel, ausblenden im letzten Drittel
        if lauf < 0.2:
            deck = int(255 * lauf / 0.2)
        elif lauf > 0.68:
            deck = int(255 * (1 - (lauf - 0.68) / 0.32))
        else:
            deck = 255
        schirm.note(nx, ny, 11, AKZENT, max(0, min(255, deck)), gespiegelt=(i % 2 == 1))

    # Fortschritt aus ERREICHTEN Meilensteinen
    br, ho = 520, 16
    # DIE GRENZE MUSS DEN GANZEN TEXT TRAGEN, nicht nur die Leiste. Hier stand
    # `schirm.h - 92`; unter `py` folgen aber noch die Beschriftung (py+40) und
    # der Zaehler (py+76), und der ist `klein.hoehe` hoch. Bei 480 px Schirm
    # und 24 px Schrift lief die letzte Zeile damit bis 488 — acht Pixel ueber
    # den Rand hinaus, sobald ein grosses Logo `mitte` weit genug nach unten
    # schob. Die 10 px sind Rand, damit die Zahl nicht an der Kante klebt.
    px, py = (schirm.b - br) // 2, min(schirm.h - 76 - klein.hoehe - 10, mitte + 58)
    schirm.rechteck(px, py, br, ho, (0x26, 0x26, 0x26), radius=ho // 2)
    anteil = erreicht / len(MEILENSTEINE)
    if anteil > 0:
        schirm.rechteck(px, py, max(ho, int(br * anteil)), ho, AKZENT, radius=ho // 2)

    # ══ NUR ASCII — DIE SCHRIFT KANN NICHT MEHR ═════════════════════════
    # Betreiber, 10.08.2026: „hinter jedem schritt ist ein fragezeichen hinten
    # dran". Hier stand `offen + " …"` mit einem U+2026. Die Konsolenschrift
    # ist eine PSF-Datei mit 256 Zeichen; alles darueber ersetzt `zeichen()`
    # weiter oben durch "?" — und weil der Punkt an JEDEM Schritt hing, stand
    # das Fragezeichen auch hinter jedem.
    # Drei Punkte tun dasselbe und liegen im Zeichenvorrat.
    beschriftung = (offen + " ...") if offen else "Fertig"
    klein.malen(schirm, beschriftung, (schirm.b - klein.textbreite(beschriftung)) // 2, py + 40, TEXT)
    zaehler = f"{erreicht}/{len(MEILENSTEINE)}"
    klein.malen(schirm, zaehler, (schirm.b - klein.textbreite(zaehler)) // 2, py + 76, GEDIMMT)

    # ══ WELCHE KIOSK-UMGEBUNG GLEICH STARTET — unten links ══════════════════
    # Betreiber, 20.08.2026: „ich wuerde gerne auch bei dem screen in einer
    # ecke sehen welches kiosk enviroment wir laden." Und nach dem ersten
    # Versuch: „hab ich jetzt so schnell nicht das kiosk enviroment sehen
    # koennen, es soll nicht aufdringlich aber auffindbar sein."
    #
    # ZWEI GRUENDE, WARUM ES BEIM ERSTEN MAL UNSICHTBAR WAR:
    #   1. Es stand unten RECHTS auf y = h - hoehe - 12 = 444..468 — und der
    #      Zaehler lag damals bei 446..470. Zwei Texte auf denselben Zeilen,
    #      der eine mittig, der andere rechts: bei „3/5" ueberschnitten sie
    #      sich nicht immer, aber sie standen auf derselben Hoehe und lasen
    #      sich als eine Zeile.
    #   2. Gedimmt UND ohne Beschriftung: ein blasses „cog" allein in einer
    #      Ecke sieht aus wie ein Rest, nicht wie eine Auskunft.
    #
    # JETZT: unten LINKS (die Gegenseite des Zaehlers, der mittig steht),
    # mit dem Wort „Kiosk:" davor und einer ruhigen Unterlegung. Die Pille
    # macht es auffindbar, ohne laut zu sein — sie ist nur wenig heller als
    # der Hintergrund, waehrend der Text in normaler Textfarbe steht.
    #
    # AUS DEM VORAB KOMPONIERTEN TEIL HERAUSGEHALTEN: Der Puffer oben wird nur
    # neu gebaut, wenn sich Name, Logo oder Schirmmasse aendern — die Umgebung
    # stuende dort fest, auch wenn jemand sie waehrenddessen umstellte.
    marke = f"Kiosk: {umgebung}"
    mb = klein.textbreite(marke)
    mx, my = 16, schirm.h - klein.hoehe - 16
    schirm.rechteck(mx - 10, my - 6, mb + 20, klein.hoehe + 12, (0x26, 0x26, 0x26),
                    radius=(klein.hoehe + 12) // 2)
    klein.malen(schirm, marke, mx, my, TEXT)
    schirm.zeigen()


def main():
    # SIGTERM IN EINEN ORDENTLICHEN ABGANG UEBERSETZEN — sonst kommt die
    # Konsole NICHT zurueck.
    #
    # Am 04.08.2026 nachgestellt und belegt: ohne diesen Handler beendet Python
    # den Prozess bei SIGTERM sofort, das `finally` unten laeuft NICHT, und
    # KonsoleAus.__exit__ bindet fbcon nie wieder an. Wer also von Hand
    # `systemctl stop mupibox-boot-splash.service` sagt, steht danach vor einem
    # Bildschirm ohne Konsole — bis zum naechsten Neustart. Der Kommentar bei
    # KonsoleAus verspricht "GARANTIERT zurueck"; diese vier Zeilen halten das
    # Versprechen erst.
    #
    # BEWUSST IN main() UND NICHT AUF MODULEBENE: mupibox-fehlerbild.py laedt
    # diese Datei als Modul. Ein signal.signal() beim Import wuerde dort die
    # eigene Behandlung ueberschreiben.
    for zeichen in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(zeichen, lambda *_: sys.exit(0))
        except (OSError, ValueError):
            pass

    try:
        schirm = Schirm()
        gross = Schrift(SCHRIFT_GROSS)
        klein = Schrift(SCHRIFT_KLEIN)
    except (OSError, RuntimeError) as e:
        print(f"Boot-Animation nicht moeglich: {e}", file=sys.stderr)
        return 0

    # EINMAL GELESEN UND NICHT JE BILD: Die Umgebung steht fest, sobald das
    # Kioskskript sie liest; zwanzigmal je Sekunde eine JSON-Datei zu oeffnen
    # waere Arbeit fuer nichts — und zwar genau in den Sekunden, in denen die
    # Box am meisten zu tun hat.
    umgebung = kioskumgebung()

    # Blinkenden Konsolen-Cursor ausblenden (sonst blinkt er ueber dem Bild).
    try:
        with open("/sys/class/graphics/fbcon/cursor_blink", "w") as f:
            f.write("0")
    except OSError:
        pass

    # Logo optional: fehlt es oder ist es unlesbar, laeuft die Animation ohne.
    logo = None
    for pfad in LOGOS:
        try:
            logo = Bild(pfad)
            break
        except (OSError, ValueError, zlib.error):
            continue

    konsole = KonsoleAus()
    konsole.__enter__()
    start = time.time()
    beschriftung_offen = MEILENSTEINE[0][0]
    erreicht = 0
    takt = 0
    letzte_pruefung = 0.0
    try:
        while time.time() - start < MAX_LAUFZEIT:
            # Meilensteine nur zweimal je Sekunde pruefen — die Abfragen kosten,
            # das Bild soll trotzdem fluessig laufen.
            if time.time() - letzte_pruefung > 0.5:
                letzte_pruefung = time.time()
                # JEDEN Meilenstein einzeln pruefen. Beim ersten unerfuellten
                # abzubrechen liess den Balken stehen, sobald ein spaeter
                # Schritt frueh fertig war und ein frueher noch fehlte (am
                # Geraet: /tmp/network.json kam spaet, danach bewegte sich
                # nichts mehr, obwohl die Box langst weiter war).
                stand = []
                for _, pruefung in MEILENSTEINE:
                    try:
                        stand.append(bool(pruefung()))
                    except Exception:
                        stand.append(False)
                erreicht = max(erreicht, sum(stand))   # nie zurueckspringen
                offen = [n for (n, _), got in zip(MEILENSTEINE, stand) if not got]
                beschriftung_offen = offen[0] if offen else ""
            malen(schirm, gross, klein, erreicht, takt, beschriftung_offen, logo, umgebung)
            if erreicht >= len(MEILENSTEINE):
                time.sleep(0.6)                   # kurz "Fertig" stehenlassen
                break
            takt += 1
            time.sleep(1.0 / BILD_PRO_S)
    except KeyboardInterrupt:
        pass
    finally:
        schirm.schliessen()
        # Konsole IMMER zurueckgeben — auch nach einem Fehler. Sonst bleibt der
        # Bildschirm stumm, und das waere schlimmer als jedes Flackern.
        konsole.__exit__(None, None, None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
