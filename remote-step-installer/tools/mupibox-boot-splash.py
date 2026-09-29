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

WIE ES AUSSIEHT (Betreiber, 29.09.2026: „erstelle mir einen neue boot animation
mit sternen und mupibox mit dem maskottchen. bitte verwende ein vorhandenes
bild"): ein Nachthimmel mit funkelnden Sternen und ab und zu einer
Sternschnuppe; in der Mitte schwebt das MixPi vor einem weichen Schein, darunter
steht der Name der Box. Die aufsteigenden Noten von vorher sind heraus. Das
Bild ist KEIN neues, sondern das Standard-MixPi (NewDesign/bilder/
mixpi-hoert.png), vorab auf Schirmgroesse gebracht: mixpi-startbild.png, gebaut
und nachgeprueft mit tools/bootsplash-vorschau.py. Der Fortschritt ist
derselbe echte wie vorher — nur sind es jetzt sechs Pillen in den Farben der
sechs Stifte im MixPi-Haar statt eines Balkens.
"""
import gzip
import math
import mmap
import os
import random
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
# DAS STARTBILD STEHT VORN (29.09.2026): mixpi-startbild.png liegt in
# scripts/mupibox/ und kommt deshalb auf BEIDEN Einrichtungswegen neben dieses
# Skript (autosetup/Update und der Skriptschritt des Installers kopieren
# scripts/mupibox/* nach /usr/local/bin/mupibox/). Es ist schon 200 px hoch
# und glatt verkleinert; die anderen Eintraege sind 256 px und werden hier
# grob auf die Haelfte gebracht — sie bleiben als Rueckfall.
LOGOS = ["/usr/local/bin/mupibox/mixpi-startbild.png",
         "/usr/local/bin/mupibox/mixpi-hoert.png",
         "/opt/mixpibox-einrichtung/mixpi-hoert.png",
         "/boot/firmware/einrichtung/mixpi-hoert.png",
         "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/assets/icon/favicon.png",
         "/boot/splash.png"]
MAX_LAUFZEIT = 120          # Notbremse: nie laenger als 2 min stehenbleiben
# 10 STATT 20 (14.08.2026, Audit-Merkposten 4.4): dieses Skript rechnet in
# reinem Python und laeuft genau in der Minute, in der Backend, X und
# Chromium um dieselben vier Kerne ringen. Zehn Bilder je Sekunde sehen fuer
# funkelnde Sterne und ein langsam schwebendes MixPi gleich fluessig aus —
# und kosten die halbe Rechenzeit. Alles, was sich bewegt, rechnet in
# SEKUNDEN (takt / BILD_PRO_S): wer die Bildrate aendert, aendert nur, wie
# oft gemalt wird, nicht wie schnell es funkelt.
# Dazu malt jedes Bild nur die BEWEGTEN Zonen: Himmel, Schein und Schriftzug
# stehen fertig in einem Basis-Puffer (siehe malen()), statt je Bild
# pixelweise neu zu entstehen.
BILD_PRO_S = 10

# Diese vier werden auch vom Einrichtungsschirm (einrichtung-schirm.py im
# Installer) und vom Fehlerbild gelesen — sie bleiben, auch wenn der
# Sternenhimmel sie selbst nicht mehr braucht.
HINTERGRUND = (0x12, 0x12, 0x12)
AKZENT = (0x44, 0xAF, 0xE2)     # Themenfarbe des Forks
TEXT = (0xEA, 0xF1, 0xF8)
GEDIMMT = (0x76, 0x8E, 0x9F)

# ══ DER STERNENHIMMEL (29.09.2026) ══════════════════════════════════════════
# Oben fast schwarz, zum Boden hin ein tiefes Violett — die Farbe der
# Kopfhoerer (#8B57FD), nur sehr weit abgedunkelt. HOF ist das, was der Schein
# hinter dem MixPi in seiner Mitte ZUSAETZLICH zum Himmel an Licht bekommt.
HIMMEL_OBEN = (0x05, 0x07, 0x1A)
HIMMEL_UNTEN = (0x1C, 0x10, 0x3A)
HOF = (0x34, 0x26, 0x70)
SCHATTEN = (0x02, 0x03, 0x10)
LEISTE = (0x24, 0x1E, 0x4C)      # noch nicht erreichte Pille, Kiosk-Unterlegung
# Die sechs Stifte im MixPi-Haar, in ihrer Reihenfolge — aus der Figur
# GEZAEHLT, nicht ausgedacht (NewDesign/bilder/favicon.svg: blau, gruen,
# stahlblau, gelb, pink, orange). Sechs Stifte, sechs Meilensteine: jeder
# erreichte laesst einen aufleuchten.
ANTENNEN = ((0x00, 0xAC, 0xFD), (0x11, 0xDE, 0x47), (0x43, 0x71, 0x9A),
            (0xFE, 0xEE, 0x04), (0xFD, 0x34, 0xA2), (0xFF, 0x70, 0x01))
STERNFARBEN = ((0xF6, 0xF7, 0xFF), (0xC8, 0xDA, 0xFF), (0xFF, 0xF1, 0xCC))
SCHNUPPE = (0xFF, 0xF8, 0xE8)
SCHWEBEN = 3             # so viele Punkte hebt und senkt sich das MixPi
SCHWEBE_DAUER = 3.6      # Sekunden fuer einmal auf und ab
SCHNUPPE_ALLE = 5.0      # alle so viele Sekunden eine Sternschnuppe ...
SCHNUPPE_DAUER = 1.1     # ... die so lange unterwegs ist
PILLE_H = 14
PILLE_LUECKE = 12

# Geordnetes Raster (Bayer 4x4) fuer 16 bpp. Der Pi 4 hat nur 5 Bit Rot und
# Blau: ein Verlauf ueber 480 Zeilen von 0x05 nach 0x1C zerfiele dort in vier
# harte Streifen. Gerastert werden daraus feine Punktmuster, die das Auge
# wieder zum Verlauf mischt. Auf 32 bpp verschiebt dasselbe Raster um
# weniger als eine Stufe und ist unsichtbar.
BAYER4 = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))


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


def mischfarbe(a, b, t):
    """Zwischen zwei Farben: t=0 ist a, t=1 ist b. Bleibt Kommazahl — gerundet
    wird erst in muster(), damit das Raster den Rest verteilen kann."""
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def muster(farbe, y, bpp):
    """Vier Punkte dieser Farbe fuer Zeile y, auf 16 bpp GERASTERT.

    Eine Flaeche wird damit als Wiederholung von vier Punkten geschrieben —
    genauso billig wie eine einfarbige, aber ohne Streifen auf dem Pi 4. Das
    Muster haengt an der Zeile (y % 4) und, beim Schreiben, an der ABSOLUTEN
    Spalte (x % 4, siehe Schirm.spanne); nur so setzen sich zwei Flaechen
    nebeneinander ohne Naht fort.
    """
    stufe = (8, 4, 8) if bpp == 16 else (1, 1, 1)
    r, g, bl = farbe
    raus = b""
    for s in BAYER4[y & 3]:
        t = (s + 0.5) / 16
        raus += punkt(min(255, max(0, int(r + t * stufe[0]))),
                      min(255, max(0, int(g + t * stufe[1]))),
                      min(255, max(0, int(bl + t * stufe[2]))), bpp)
    return raus


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

    def spanne(self, y, von, bis, vier):
        """Zeile y von `von` bis `bis` (ausschliesslich) mit einem Muster aus
        muster() fuellen — an der absoluten Spalte ausgerichtet."""
        if not (0 <= y < self.h):
            return
        von, bis = max(0, von), min(self.b, bis)
        if bis <= von:
            return
        ph, n = von & 3, bis - von
        reihe = vier * ((ph + n) // 4 + 1)
        o = (y * self.b + von) * self.bp
        self.puffer[o:o + n * self.bp] = reihe[ph * self.bp:(ph + n) * self.bp]

    def verlauf(self, oben, unten):
        """Den ganzen Schirm senkrecht von `oben` nach `unten` verlaufen lassen."""
        for y in range(self.h):
            t = y / max(1, self.h - 1)
            self.spanne(y, 0, self.b, muster(mischfarbe(oben, unten, t), y, self.bpp))

    def hof(self, cx, cy, radius, oben, unten, zusatz, stufen=24):
        """Weicher Schein um (cx, cy), ueber einen Verlauf oben->unten gelegt.

        Konzentrische Scheiben, von aussen nach innen, jede ein wenig heller.
        Die Farbe einer Scheibe ist JE ZEILE der Himmel an dieser Zeile plus ein
        Anteil von `zusatz` — eine feste Farbe je Scheibe stuende oben heller
        und unten dunkler als der Himmel daneben, und der Rand waere zu sehen.
        Als Spannen geschrieben statt Punkt fuer Punkt: rund 24 Scheiben mal
        300 Zeilen Slices statt 90000 Wurzeln in reinem Python.
        """
        for y in range(max(0, cy - radius), min(self.h, cy + radius + 1)):
            grund = mischfarbe(oben, unten, y / max(1, self.h - 1))
            dy = y - cy
            for k in range(stufen):
                rk = radius * (stufen - k) / stufen
                if abs(dy) >= rk:
                    continue
                w = int((rk * rk - dy * dy) ** 0.5)
                s = ((k + 1) / stufen) ** 1.5
                farbe = tuple(grund[i] + zusatz[i] * s for i in range(3))
                self.spanne(y, cx - w, cx + w + 1, muster(farbe, y, self.bpp))

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

    def tupfen(self, x, y, farbe, a):
        """Einen Punkt mit Deckkraft a setzen — ausserhalb des Schirms: nichts."""
        if a > 0 and 0 <= x < self.b and 0 <= y < self.h:
            self._mischen((y * self.b + x) * self.bp, farbe[0], farbe[1], farbe[2], min(255, a))

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


# ── Das MixPi, das schwebt ─────────────────────────────────────────────────
class Figur:
    """Ein Bild, das sich um wenige Punkte hebt und senkt — ohne je Bild neu
    gemischt zu werden.

    WARUM NICHT EINFACH `Schirm.bild()` JE BILD: das MixPi hat rund 2500
    halbdurchsichtige Kantenpunkte. Die je Bild ueber den Himmel zu mischen,
    kostet auf dem Pi 4 in reinem Python mehr als alles andere zusammen — in
    genau der Minute, in der die Box ihre Kerne fuer den Start braucht.

    WARUM NICHT EIN FERTIGER STREIFEN, DER NUR VERSCHOBEN WIRD: unter dem
    Bild liegt der Schein (Schirm.hof). Ein einmal gemischter Streifen
    truege ihn mit, und um drei Punkte verschoben passten seine Ringe am
    Rand des Streifens nicht mehr zu denen daneben — eine Kante mitten im
    Himmel.

    DESHALB: je Hoehe (-SCHWEBEN .. +SCHWEBEN, also sieben) EINMAL gegen die
    fertige Basis gemischt und aufgehoben, danach nur noch zeilenweise
    kopiert. Erst gebaut, wenn die Hoehe zum ersten Mal gebraucht wird; die
    Kosten verteilen sich damit auf die ersten zwei Sekunden.
    """

    def __init__(self, bd, x, y, skala=1, teiler=1, bpp=32):
        self.x, self.y = x, y
        self.b = max(1, (bd.b * skala) // teiler)
        self.h = max(1, (bd.h * skala) // teiler)
        # Je Zeile: deckende Laeufe als fertige Bytes, Kantenpunkte einzeln.
        self.voll, self.halb = [], []
        for zy in range(self.h):
            qy = (zy * teiler) // skala
            laeufe, kanten = [], []
            anfang, lauf = None, bytearray()
            for zx in range(self.b):
                r, g, bl, a = bd.punkt((zx * teiler) // skala, qy)
                if a == 255:
                    if anfang is None:
                        anfang, lauf = zx, bytearray()
                    lauf += punkt(r, g, bl, bpp)
                    continue
                if anfang is not None:
                    laeufe.append((anfang, bytes(lauf)))
                    anfang = None
                if a:
                    kanten.append((zx, r, g, bl, a))
            if anfang is not None:
                laeufe.append((anfang, bytes(lauf)))
            self.voll.append(laeufe)
            self.halb.append(kanten)
        self._streifen = {}

    def _bauen(self, schirm, basis, versatz):
        bp = schirm.bp
        x0, x1 = max(0, self.x), min(schirm.b, self.x + self.b)
        streifen = []
        if x1 <= x0:
            return streifen
        for zy in range(self.h):
            py = self.y + versatz + zy
            if not (0 <= py < schirm.h):
                continue
            o = (py * schirm.b + x0) * bp
            zeile = bytearray(basis[o:o + (x1 - x0) * bp])
            for zx, roh in self.voll[zy]:
                sx = self.x + zx
                von, bis = max(sx, x0), min(sx + len(roh) // bp, x1)
                if bis > von:
                    zeile[(von - x0) * bp:(bis - x0) * bp] = roh[(von - sx) * bp:(bis - sx) * bp]
            for zx, r, g, bl, a in self.halb[zy]:
                sx = self.x + zx
                if not (x0 <= sx < x1):
                    continue
                q = (sx - x0) * bp
                hr, hg, hb = hintergrund(zeile[q:q + bp], schirm.bpp)
                zeile[q:q + bp] = punkt((r * a + hr * (255 - a)) // 255,
                                        (g * a + hg * (255 - a)) // 255,
                                        (bl * a + hb * (255 - a)) // 255, schirm.bpp)
            streifen.append((o, bytes(zeile)))
        return streifen

    def zeichnen(self, schirm, basis, versatz=0):
        """Das Bild um `versatz` Punkte verschoben in den Puffer legen.
        `basis` ist der fertige Hintergrund OHNE Figur."""
        s = self._streifen.get(versatz)
        if s is None:
            s = self._streifen[versatz] = self._bauen(schirm, basis, versatz)
        for o, zeile in s:
            schirm.puffer[o:o + len(zeile)] = zeile


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


# ── Der Sternenhimmel ──────────────────────────────────────────────────────
def sternhimmel(breite, hoehe, aussparen, samen=29):
    """Wo die Sterne stehen — EINMAL ausgewuerfelt, mit festem Samen.

    Fester Samen, weil der Himmel bei jedem Start derselbe sein soll: ein Kind,
    das jeden Morgen hinsieht, kennt ihn irgendwann. Und ein Bild, das bei
    jedem Lauf anders aussieht, laesst sich nicht nachpruefen.

    `aussparen` sind Rechtecke (x, y, b, h), in die KEIN Stern hineinragen darf
    — Figur, Name, Fortschritt, Kiosk-Hinweis. Ein Stern, der durch einen
    Buchstaben funkelt, sieht nach Fehler aus. Der Rand von 6 Punkten deckt
    die Arme der Funkelsterne mit ab.

    -> Liste von (x, y, art, farbe, tempo, phase, grund). art 0 ist ein
    einzelner Punkt, 1 ein kleines Kreuz, 2 ein Funkelstern, der seine Arme
    streckt und in der Haelfte der Faelle eine Stiftfarbe traegt.
    """
    zufall = random.Random(samen)
    anzahl = breite * hoehe // 3000
    sterne, versuche = [], 0
    while len(sterne) < anzahl and versuche < anzahl * 30:
        versuche += 1
        x = zufall.randrange(6, max(7, breite - 6))
        y = zufall.randrange(6, max(7, hoehe - 6))
        if any(ax - 6 <= x < ax + ab + 6 and ay - 6 <= y < ay + ah + 6
               for ax, ay, ab, ah in aussparen):
            continue
        w = zufall.random()
        art = 0 if w < 0.62 else (1 if w < 0.88 else 2)
        if art == 2 and zufall.random() < 0.5:
            farbe = zufall.choice(ANTENNEN)
        else:
            farbe = zufall.choice(STERNFARBEN)
        tempo = 2 * math.pi / zufall.uniform(1.6, 4.2)   # ein Funkeln je 1,6 bis 4,2 s
        phase = zufall.uniform(0, 2 * math.pi)
        grund = zufall.uniform(0.2, 0.55) if art == 0 else zufall.uniform(0.45, 0.7)
        sterne.append((x, y, art, farbe, tempo, phase, grund))
    return sterne


def sterne_malen(schirm, sterne, t):
    """Jeder Stern funkelt in seinem eigenen Takt: Helligkeit als Sinus der
    Zeit t (Sekunden), mit eigener Geschwindigkeit und eigenem Versatz. Die
    Funkelsterne strecken dabei ihre Arme (1 bis 4 Punkte)."""
    for x, y, art, farbe, tempo, phase, grund in sterne:
        hell = grund + (1 - grund) * (0.5 + 0.5 * math.sin(t * tempo + phase))
        a = int(255 * hell)
        schirm.tupfen(x, y, farbe, a)
        if art == 0:
            continue
        arm = 1 if art == 1 else 1 + int(3.4 * hell)
        for d in range(1, arm + 1):
            ad = a * (arm + 1 - d) // (arm + 1)
            if art == 1:
                ad //= 2
            schirm.tupfen(x - d, y, farbe, ad)
            schirm.tupfen(x + d, y, farbe, ad)
            schirm.tupfen(x, y - d, farbe, ad)
            schirm.tupfen(x, y + d, farbe, ad)


def schnuppe_malen(schirm, lage, t):
    """Alle SCHNUPPE_ALLE Sekunden eine Sternschnuppe, links oder rechts der
    Figur, schraeg nach unten zur Mitte hin.

    Start und Seite wuerfelt ein Samen aus der laufenden Nummer: jede
    Schnuppe ist anders, und trotzdem ist das Bild zu einer Zeit t immer
    dasselbe — sonst liesse sich keine Vorschau vergleichen.

    Sie bleibt OBERHALB des Namens (`schnuppe_bis`) und darf hoechstens bis
    an den Rand der Figur ziehen; was dort hineinreicht, deckt die Figur zu,
    weil sie danach gemalt wird. Das sieht aus wie „hinter dem MixPi
    vorbei" und braucht keine eigene Pruefung.
    """
    nummer, rest = divmod(t, SCHNUPPE_ALLE)
    p = rest / SCHNUPPE_DAUER
    if p >= 1.0:
        return
    zufall = random.Random(int(nummer) * 7919 + 17)
    weg = min(160, schirm.b // 5)
    ex, ey = 0.91, 0.41                                  # rund 24 Grad Gefaelle
    wx, wy = int(weg * ex), int(weg * ey)
    links = zufall.random() < 0.5
    if links:
        lo, hi, richtung = 16, lage["mitte_links"] - 16 - wx // 2, 1
    else:
        lo, hi, richtung = lage["mitte_rechts"] + 16 + wx // 2, schirm.b - 16, -1
    y_hi = lage["schnuppe_bis"] - wy
    if hi < lo or y_hi < 12:
        return                        # Schirm zu klein — dann eben keine
    sx, sy = zufall.randint(lo, hi), zufall.randint(12, y_hi)
    # Einblenden im ersten Achtel, Ausblenden im letzten Drittel.
    hell = max(0.0, min(1.0, p / 0.12, (1.0 - p) / 0.35))
    kx, ky = sx + richtung * wx * p, sy + wy * p
    laenge = int(min(56, weg * p))            # der Schweif waechst erst heraus
    for i in range(laenge + 1):
        a = int(255 * hell * (1 - i / (laenge + 1)) ** 1.6)
        x, y = int(kx - richtung * ex * i), int(ky - ey * i)
        schirm.tupfen(x, y, SCHNUPPE, a)
        if i < 14:
            schirm.tupfen(x, y + 1, SCHNUPPE, a // 3)
    kopf = int(190 * hell)
    x, y = int(kx), int(ky)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        schirm.tupfen(x + dx, y + dy, SCHNUPPE, kopf)


def pillen_malen(schirm, lage, erreicht, t):
    """Sechs Pillen statt eines Balkens — in den Farben der sechs Stifte.

    Erreichte leuchten in ihrer Farbe, die als naechste erwartete glimmt
    langsam, der Rest bleibt dunkel. Das Glimmen ist KEIN Fortschritt: es
    zeigt nur, dass die Anzeige lebt, waehrend ein Schritt dauert. Der Stand
    selbst springt nie zurueck und rueckt nie ohne Meilenstein vor.
    """
    n = len(MEILENSTEINE)
    for i in range(n):
        x = lage["pille_x"] + i * (lage["pille_b"] + PILLE_LUECKE)
        farbe = ANTENNEN[i % len(ANTENNEN)]
        if i < erreicht:
            f = farbe
        elif i == erreicht:
            glimm = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 1.4)
            f = tuple(int(c) for c in mischfarbe(LEISTE, farbe, 0.15 + 0.30 * glimm))
        else:
            f = LEISTE
        schirm.rechteck(x, lage["pille_y"], lage["pille_b"], PILLE_H, f, radius=PILLE_H // 2)


def komponieren(schirm, gross, klein, titel, logo):
    """Den unbewegten Teil EINMAL bauen und festhalten, wo alles steht.

    -> (basis, lage). `basis` sind Himmel, Schein und Name als fertige Bytes
    — OHNE Figur, denn die wird je Bild in ihrer Schwebehoehe daraufgelegt.
    `lage` haelt die Koordinaten, die Sterne und die vorbereitete Figur.
    """
    B, H = schirm.b, schirm.h
    if logo is not None:
        # ══ DAS LOGO DARF AUCH KLEINER WERDEN (20.08.2026) ══════════════════
        # Hier stand einmal nur `max(1, min(4, (schirm.h // 3) // logo.h))`.
        # Diese Wahl kann ausschliesslich VERGROESSERN: sobald das Logo hoeher
        # ist als das Ziel, wird der Bruch 0 und `max(1, 0)` macht daraus 1 —
        # Originalgroesse. Am Geraet war der Bildblock damit hoeher als der
        # Schirm und die Zahl darunter „bisschen nach unten gerutscht".
        # Das Ziel ist seit dem Sternenhimmel 5/12 der Hoehe (200 px bei 480):
        # mixpi-startbild.png passt genau, die 256er Rueckfaelle werden halbiert.
        ziel = H * 5 // 12
        if logo.h <= ziel:
            sk, teiler = max(1, min(4, ziel // max(1, logo.h))), 1
        else:
            # Aufgerundet, damit das Ergebnis sicher UNTER das Ziel faellt.
            sk, teiler = 1, -(-logo.h // ziel)
        fb, fh = max(1, (logo.b * sk) // teiler), max(1, (logo.h * sk) // teiler)
        luft = 14
    else:
        sk = teiler = 1
        fb = fh = luft = 0
    # ══ DIE BLOCKHOEHE, von oben durchgezaehlt ═════════════════════════════
    # Figur, Luft, Name, Luft, Pillen, Luft, Beschriftung, Luft, Zaehler. Die
    # Rechnung hatte am 20.08.2026 zwei Fehler, die sich teilweise aufhoben
    # (ein Posten doppelt, die letzte Zeile fehlte) — deshalb steht hier jede
    # Zeile genau einmal und in der Reihenfolge, in der sie gemalt wird.
    # NACHGERECHNET (800x480, Figur 200, Terminus-24): 63 px oben, 63 unten.
    block = fh + luft + gross.hoehe + 26 + PILLE_H + 14 + klein.hoehe + 6 + klein.hoehe
    kopf = max(SCHWEBEN + 8, (H - block) // 2)
    fx, fy = (B - fb) // 2, kopf
    ty = fy + fh + luft
    tb = gross.textbreite(titel)
    tx = (B - tb) // 2
    n = len(MEILENSTEINE)
    pb = max(8, min(72, (B - 80 - (n - 1) * PILLE_LUECKE) // n))
    gesamt = n * pb + (n - 1) * PILLE_LUECKE
    px = (B - gesamt) // 2
    # Die Grenze traegt den GANZEN Text darunter, nicht nur die Pillen
    # (dieselbe Lehre wie beim alten Balken: die letzte Zeile lief einmal
    # acht Punkte ueber den Rand).
    py = min(H - 10 - klein.hoehe - 6 - klein.hoehe - 14 - PILLE_H, ty + gross.hoehe + 26)
    ly = py + PILLE_H + 14
    zy = ly + klein.hoehe + 6

    schirm.verlauf(HIMMEL_OBEN, HIMMEL_UNTEN)
    if logo is not None:
        schirm.hof(B // 2, fy + fh // 2, int(max(fb, fh) * 0.82),
                   HIMMEL_OBEN, HIMMEL_UNTEN, HOF)
    gross.malen(schirm, titel, tx + 2, ty + 2, SCHATTEN)
    gross.malen(schirm, titel, tx, ty, TEXT)
    basis = bytes(schirm.puffer)

    kiosk_b = klein.textbreite("Kiosk: chromium") + 20
    aussparen = [
        (fx - 4, fy - SCHWEBEN - 4, fb + 8, fh + 2 * SCHWEBEN + 8),
        (tx - 6, ty - 4, tb + 12, gross.hoehe + 8),
        (min(px, B // 2 - 160) - 6, py - 6, max(gesamt, 320) + 12,
         zy + klein.hoehe + 12 - py),
        (0, H - klein.hoehe - 32, kiosk_b + 26, klein.hoehe + 32),
    ]
    lage = {
        "figur": Figur(logo, fx, fy, sk, teiler, schirm.bpp) if logo is not None else None,
        "sterne": sternhimmel(B, H, aussparen),
        "aussparen": aussparen,
        "mitte_links": min(fx, tx) if logo is not None else tx,
        "mitte_rechts": max(fx + fb, tx + tb) if logo is not None else tx + tb,
        "schnuppe_bis": ty - 16,
        "pille_x": px, "pille_y": py, "pille_b": pb,
        "beschriftung_y": ly, "zaehler_y": zy,
    }
    return basis, lage


# Der unbewegte Teil des Bildes, EINMAL komponiert (14.08.2026, Audit 4.4):
# Himmel, Schein und Schriftzug sind die teuersten Schritte — und sie aendern
# sich zwischen zwei Bildern nie. Der Schluessel haelt fest, WOFUER der Puffer
# gilt; ein anderer Name, ein anderes Logo oder eine andere Schirmgroesse
# komponieren neu.
_basis = {"schluessel": None, "puffer": None, "lage": None}


def malen(schirm, gross, klein, erreicht, takt, offen="", logo=None, umgebung="chromium"):
    titel = boxname()
    schluessel = (titel, id(logo), schirm.b, schirm.h, schirm.bpp)
    if _basis["schluessel"] != schluessel:
        _basis["puffer"], _basis["lage"] = komponieren(schirm, gross, klein, titel, logo)
        _basis["schluessel"] = schluessel
    lage = _basis["lage"]
    t = takt / BILD_PRO_S

    # Ein memcpy statt zehntausender Python-Schleifendurchlaeufe. Danach in
    # dieser Reihenfolge: Sterne, Schnuppe, Figur (deckt die Schnuppe zu, wo
    # sie hinter ihr vorbeizieht), Fortschritt und Schrift obenauf.
    schirm.puffer[:] = _basis["puffer"]
    sterne_malen(schirm, lage["sterne"], t)
    schnuppe_malen(schirm, lage, t)
    if lage["figur"] is not None:
        versatz = int(round(SCHWEBEN * math.sin(2 * math.pi * t / SCHWEBE_DAUER)))
        lage["figur"].zeichnen(schirm, _basis["puffer"], versatz)
    pillen_malen(schirm, lage, erreicht, t)

    # ══ NUR ASCII — DIE SCHRIFT KANN NICHT MEHR ═════════════════════════
    # Betreiber, 10.08.2026: „hinter jedem schritt ist ein fragezeichen hinten
    # dran". Hier stand `offen + " …"` mit einem U+2026. Die Konsolenschrift
    # ist eine PSF-Datei mit 256 Zeichen; alles darueber ersetzt `zeichen()`
    # weiter oben durch "?" — und weil der Punkt an JEDEM Schritt hing, stand
    # das Fragezeichen auch hinter jedem.
    # Drei Punkte tun dasselbe und liegen im Zeichenvorrat.
    beschriftung = (offen + " ...") if offen else "Fertig"
    klein.malen(schirm, beschriftung, (schirm.b - klein.textbreite(beschriftung)) // 2,
                lage["beschriftung_y"], TEXT)
    zaehler = f"{erreicht}/{len(MEILENSTEINE)}"
    klein.malen(schirm, zaehler, (schirm.b - klein.textbreite(zaehler)) // 2,
                lage["zaehler_y"], GEDIMMT)

    # ══ WELCHE KIOSK-UMGEBUNG GLEICH STARTET — unten links ══════════════════
    # Betreiber, 20.08.2026: „ich wuerde gerne auch bei dem screen in einer
    # ecke sehen welches kiosk enviroment wir laden." Und nach dem ersten
    # Versuch: „hab ich jetzt so schnell nicht das kiosk enviroment sehen
    # koennen, es soll nicht aufdringlich aber auffindbar sein."
    # Unten LINKS (die Gegenseite des Zaehlers, der mittig steht), mit dem
    # Wort „Kiosk:" davor und einer ruhigen Unterlegung: nur wenig heller als
    # der Himmel, der Text in normaler Textfarbe. Beim ersten Versuch stand es
    # unten rechts auf derselben Hoehe wie der Zaehler und las sich mit ihm
    # als eine Zeile.
    # AUS DEM VORAB KOMPONIERTEN TEIL HERAUSGEHALTEN: der Puffer oben wird nur
    # neu gebaut, wenn sich Name, Logo oder Schirmmasse aendern — die Umgebung
    # stuende dort fest, auch wenn jemand sie waehrenddessen umstellte.
    marke = f"Kiosk: {umgebung}"
    mb = klein.textbreite(marke)
    mx, my = 16, schirm.h - klein.hoehe - 16
    schirm.rechteck(mx - 10, my - 6, mb + 20, klein.hoehe + 12, LEISTE,
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
