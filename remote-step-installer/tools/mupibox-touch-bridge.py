#!/usr/bin/env python3
"""Touch-Bruecke: liest den FT5x06 per I2C ab und meldet Beruehrungen als
echtes Eingabegeraet (uinput).

WARUM UEBERHAUPT — die Messung auf der Box (Pi 5, DietPi Trixie):
  * Der Kerneltreiber edt_ft5x06 bindet sauber an den Controller (11-0038),
    Chip-ID 0x54, Firmware 0x0b, crc_errors/header_errors beide 0.
  * Direkt per I2C abgefragt meldet derselbe Controller Beruehrungen zuverlaessig
    (16 Treffer in 30 s Tippen).
  * Trotzdem: in /proc/interrupts steht KEINE Zeile fuer das Geraet, und 20 s
    durchgehendes Tippen erzeugen 0 Rohbytes auf /dev/input/event*.
Der Treiber arbeitet rein unterbrechungsgesteuert und hat keinen Abfragemodus.
Ohne Interrupt-Leitung liest er den Controller also nie aus. Diese Bruecke fragt
ihn stattdessen im Benutzerraum ab — der Bus traegt das muehelos.

Bewusst nur Standardbibliothek: auf der Box ist weder python3-evdev noch
smbus installiert, und eine Eingabemethode darf nicht an einem nachzu-
installierenden Paket haengen.

Damit sich Kerneltreiber und Bruecke nicht in die Quere kommen, gehoert der
Controller genau einem von beiden. Dauerhaft loest das `disable_touch` am
Overlay; zum Ausprobieren im laufenden Betrieb genuegt --unbind.

DIESE DATEI LIEGT IN ZWEI REPOS — box (scripts/box/touch-bridge.py) und
remote-step-installer (tools/mupibox-touch-bridge.py, anderer Name, GLEICHES
ZIEL: /opt/mupibox-tools/touch-bridge.py). Der Installer bespielt frische
Karten, das box-Repo aktualisiert laufende Boxen; wer nur eine Seite aendert,
bekommt die alte Fassung ueber den anderen Weg zurueck. Am 05.08.2026 genau so
aufgefallen: dem Installer fehlte die Bus-Probe unten (Stand 26.07.), also
haette jede neu bespielte Karte ohne FT5x06 das Neustart-Karussell zurueck-
bekommen. Der abweichende DATEINAME ist dabei die eigentliche Falle — ein
Abgleich nach Namen findet dieses Paar nicht.
Gegenprobe: python3 tools/zwillingsdateien-abgleich.py

Aufrufe:
  --drehung GRAD       Touch gegenueber dem Bild drehen (0/90/180/270)
  --auto               nur einspringen, wenn der Kerneltreiber NICHTS liefert
  --probe [SEKUNDEN]   nur messen und die entschluesselten Werte zeigen
  --unbind             Kerneltreiber vorher loesen (Betrieb ohne disable_touch)
"""
import fcntl
import os
import struct
import sys
import time

I2C_BUS = 11
I2C_ADRESSE = 0x38
I2C_SLAVE = 0x0703
I2C_SLAVE_FORCE = 0x0706

UINPUT = "/dev/uinput"
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502
UI_SET_EVBIT = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_SET_ABSBIT = 0x40045567
UI_SET_PROPBIT = 0x4004556E

EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
BTN_TOUCH = 0x14A
ABS_X, ABS_Y = 0x00, 0x01
ABS_MT_SLOT = 0x2F
ABS_MT_POSITION_X, ABS_MT_POSITION_Y = 0x35, 0x36
ABS_MT_TRACKING_ID = 0x39
INPUT_PROP_DIRECT = 0x01
ABS_ANZAHL = 64

# struct input_event: bewusst NATIVES Format ("@"). Mit "<" waere "l" nur 4 Byte
# breit, der Kernel erwartet aber die native long-Groesse — das Ereignis kaeme
# 16 statt 24 Byte lang an und uinput antwortet mit EINVAL.
EREIGNIS = struct.Struct("@llHHi")

BREITE, HOEHE = 800, 480
# Drehung des TOUCH gegenueber dem BILD, in Grad. Noetig, weil der Controller
# im Gehaeuse anders herum sitzt als das Panel: am Geraet gemessen meldete eine
# Beruehrung OBEN LINKS die Werte x~750 y~415 — also beide Achsen am Maximum,
# eine glatte 180°-Drehung. Merke: gleiche WERTEBEREICHE beweisen NICHT die
# gleiche Ausrichtung; man muss eine bekannte Ecke antippen und nachsehen.
DREHUNG = 0
MAX_FINGER = 5
ABFRAGEN_PRO_S = 60
TREIBER = "/sys/bus/i2c/drivers/edt_ft5x06"
GERAET = f"{I2C_BUS}-00{I2C_ADRESSE:02x}"


# ── Controller ─────────────────────────────────────────────────────────────
class Controller:
    """Liest den FT5x06 ueber /dev/i2c-<bus>."""

    def __init__(self, bus=I2C_BUS, adresse=I2C_ADRESSE, erzwingen=True):
        self.fd = os.open(f"/dev/i2c-{bus}", os.O_RDWR)
        # FORCE nur noetig, solange der Kerneltreiber die Adresse noch haelt.
        fcntl.ioctl(self.fd, I2C_SLAVE_FORCE if erzwingen else I2C_SLAVE, adresse)

    def lesen(self, anzahl=0x21):
        """Registerblock ab 0x00 lesen. None, wenn der Bus gerade klemmt."""
        try:
            os.write(self.fd, b"\x00")
            roh = os.read(self.fd, anzahl)
        except OSError:
            return None
        return roh if len(roh) >= anzahl else None

    def beruehrungen(self):
        """-> [(kennung, x, y, hoch)] oder None bei Lesefehler."""
        roh = self.lesen()
        if roh is None:
            return None
        anzahl = roh[0x02] & 0x0F
        punkte = []
        for i in range(min(anzahl, MAX_FINGER)):
            o = 0x03 + i * 6
            b0, b1, b2, b3 = roh[o], roh[o + 1], roh[o + 2], roh[o + 3]
            ereignis = b0 >> 6            # 0 = aufgesetzt, 1 = abgehoben, 2 = liegt auf
            x = ((b0 & 0x0F) << 8) | b1
            y = ((b2 & 0x0F) << 8) | b3
            kennung = b2 >> 4
            if kennung > 0x0E:            # 0x0F = Platz unbelegt
                continue
            punkte.append((kennung, x, y, ereignis == 1))
        return punkte

    def schliessen(self):
        try:
            os.close(self.fd)
        except OSError:
            pass


# ── Eingabegeraet ──────────────────────────────────────────────────────────
class Eingabegeraet:
    """uinput-Geraet im Mehrfinger-Protokoll B.

    Bewusst ein echtes Beruehrungsgeraet (INPUT_PROP_DIRECT + ABS_MT_*), kein
    Mausersatz: nur so erzeugt Chromium Touch-Ereignisse, und Wischen bzw.
    Scrollen in der Oberflaeche funktioniert wie erwartet.
    """

    def __init__(self, breite=BREITE, hoehe=HOEHE, drehung=0):
        self.roh_b, self.roh_h = breite, hoehe
        self.drehung = drehung % 360
        # Bei 90/270 tauschen Breite und Hoehe die Rollen.
        if self.drehung in (90, 270):
            breite, hoehe = hoehe, breite
        self.fd = os.open(UINPUT, os.O_WRONLY | os.O_NONBLOCK)
        for ev in (EV_KEY, EV_ABS):
            fcntl.ioctl(self.fd, UI_SET_EVBIT, ev)
        fcntl.ioctl(self.fd, UI_SET_KEYBIT, BTN_TOUCH)
        fcntl.ioctl(self.fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT)

        grenzen = {
            ABS_X: (0, breite - 1),
            ABS_Y: (0, hoehe - 1),
            ABS_MT_POSITION_X: (0, breite - 1),
            ABS_MT_POSITION_Y: (0, hoehe - 1),
            ABS_MT_SLOT: (0, MAX_FINGER - 1),
            ABS_MT_TRACKING_ID: (0, 65535),
        }
        for code in grenzen:
            fcntl.ioctl(self.fd, UI_SET_ABSBIT, code)

        absmin = [0] * ABS_ANZAHL
        absmax = [0] * ABS_ANZAHL
        for code, (lo, hi) in grenzen.items():
            absmin[code], absmax[code] = lo, hi

        name = b"MuPiBox Touch Bridge".ljust(80, b"\x00")
        kopf = name + struct.pack("<4HI", 0x18, 0x0416, 0x0038, 1, 0)   # BUS_I2C
        felder = (struct.pack(f"<{ABS_ANZAHL}i", *absmax)
                  + struct.pack(f"<{ABS_ANZAHL}i", *absmin)
                  + struct.pack(f"<{ABS_ANZAHL}i", *([0] * ABS_ANZAHL))   # fuzz
                  + struct.pack(f"<{ABS_ANZAHL}i", *([0] * ABS_ANZAHL)))  # flat
        os.write(self.fd, kopf + felder)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        self.belegt = {}          # Steckplatz -> Kennung des Fingers
        self.naechste_kennung = 1

    def dreh(self, x, y):
        """Rohkoordinate -> Bildkoordinate. Pure (nur Arithmetik)."""
        mx, my = self.roh_b - 1, self.roh_h - 1
        d = self.drehung
        if d == 90:
            return y, mx - x
        if d == 180:
            return mx - x, my - y
        if d == 270:
            return my - y, x
        return x, y

    def _sende(self, typ, code, wert):
        jetzt = time.time()
        os.write(self.fd, EREIGNIS.pack(int(jetzt), int((jetzt % 1) * 1_000_000),
                                        typ, code, wert))

    def melden(self, punkte):
        """Punktliste des Controllers in Protokoll-B-Ereignisse uebersetzen."""
        aktiv = {k: self.dreh(x, y) for k, x, y, hoch in punkte if not hoch}

        for steckplatz in list(self.belegt):
            if steckplatz not in aktiv:
                self._sende(EV_ABS, ABS_MT_SLOT, steckplatz)
                self._sende(EV_ABS, ABS_MT_TRACKING_ID, -1)
                del self.belegt[steckplatz]

        for steckplatz, (x, y) in aktiv.items():
            if steckplatz >= MAX_FINGER:
                continue
            self._sende(EV_ABS, ABS_MT_SLOT, steckplatz)
            if steckplatz not in self.belegt:
                self.belegt[steckplatz] = self.naechste_kennung
                self._sende(EV_ABS, ABS_MT_TRACKING_ID, self.naechste_kennung)
                self.naechste_kennung = (self.naechste_kennung + 1) & 0xFFFF or 1
            self._sende(EV_ABS, ABS_MT_POSITION_X, x)
            self._sende(EV_ABS, ABS_MT_POSITION_Y, y)

        # Einzelfinger-Spur mitfuehren: aeltere Auswertungen lesen nur diese.
        if aktiv:
            erster = sorted(aktiv)[0]
            x, y = aktiv[erster]
            self._sende(EV_KEY, BTN_TOUCH, 1)
            self._sende(EV_ABS, ABS_X, x)
            self._sende(EV_ABS, ABS_Y, y)
        else:
            self._sende(EV_KEY, BTN_TOUCH, 0)

        self._sende(EV_SYN, SYN_REPORT, 0)

    def schliessen(self):
        try:
            fcntl.ioctl(self.fd, UI_DEV_DESTROY)
            os.close(self.fd)
        except OSError:
            pass


# ── Treiber loesen ─────────────────────────────────────────────────────────
def kerntreiber_taugt():
    """Liefert der Kerneltreiber selbst Ereignisse? Dann Finger weg.

    Unterscheidungsmerkmal ist die Unterbrechungsleitung: edt_ft5x06 hat KEINEN
    Abfragemodus, ohne Interrupt liest er den Controller nie aus. Steht also
    keine Zeile in /proc/interrupts, kann er prinzipbedingt nichts liefern —
    genau der Fall auf dieser Box. Steht eine da (funktionierende Verdrahtung,
    z. B. am echten offiziellen Panel), macht der Kernel seine Arbeit und die
    Bruecke haelt sich raus, statt einen intakten Treiber zu verdraengen.
    """
    if not os.path.exists(f"{TREIBER}/{GERAET}"):
        return False                       # gar nicht gebunden -> Bruecke uebernimmt
    try:
        with open("/proc/interrupts") as f:
            tabelle = f.read().lower()
    except OSError:
        return False
    return any(m in tabelle for m in (GERAET, "ft5x06", "ft5406", "edt_ft5x06"))


def treiber_loesen():
    """Kerneltreiber vom Controller loesen, damit nur die Bruecke ihn liest."""
    pfad = f"{TREIBER}/unbind"
    if not os.path.exists(f"{TREIBER}/{GERAET}"):
        return False
    try:
        with open(pfad, "w") as f:
            f.write(GERAET)
        return True
    except OSError as e:
        print(f"Treiber liess sich nicht loesen: {e}", file=sys.stderr)
        return False


# ── Betrieb ────────────────────────────────────────────────────────────────
def messen(dauer):
    ctl = Controller()
    roh = ctl.lesen(0xA7)
    if roh:
        print(f"Chip-ID 0x{roh[0xA3]:02x}, Firmware 0x{roh[0xA6]:02x}")
    ende = time.time() + dauer
    gesehen = 0
    xmin = ymin = 10_000
    xmax = ymax = -1
    while time.time() < ende:
        p = ctl.beruehrungen()
        if p:
            for kennung, x, y, hoch in p:
                gesehen += 1
                xmin, xmax = min(xmin, x), max(xmax, x)
                ymin, ymax = min(ymin, y), max(ymax, y)
                print(f"  Finger {kennung}: x={x:4d} y={y:4d} {'ab' if hoch else 'auf'}")
        time.sleep(1.0 / ABFRAGEN_PRO_S)
    ctl.schliessen()
    print(f"ERGEBNIS: {gesehen} Meldungen, x {xmin}..{xmax}, y {ymin}..{ymax}")
    return 0 if gesehen else 1


def laufen():
    # NICHTS ZU TUN ist kein Fehler: fehlt der I2C-Bus oder /dev/uinput (kein
    # Panel angeschlossen, Overlay noch nicht aktiv, Modul nicht geladen), dann
    # sauber mit 0 enden. Sonst dreht systemd wegen Restart=on-failure alle zwei
    # Sekunden eine neue Runde — auf einer frisch aufgesetzten Box, auf der das
    # DSI-Overlay erst nach dem naechsten Neustart greift, ist das der Normalfall
    # und keine Stoerung.
    try:
        ctl = Controller()
    except OSError as e:
        print(f"Kein Touch-Controller erreichbar ({e}) — Bruecke nicht noetig", file=sys.stderr)
        return 0
    # DER BUS IST NICHT DER CHIP (nachgetragen 04.08.2026 beim Gegenlesen).
    #
    # `Controller()` oeffnet nur /dev/i2c-11 und setzt die Zieladresse — mit
    # I2C_SLAVE_FORCE, also OHNE zu fragen, ob dort jemand antwortet. Auf einem
    # Pi 5 gibt es /dev/i2c-11 aber IMMER, auch ohne angeschlossenes Panel.
    # Ohne diese Probe lief die Bruecke dort in ihre Schleife, sammelte 200
    # Lesefehler (rund 10 s), endete mit 1 — und systemd startete sie wegen
    # Restart=on-failure alle zwei Sekunden neu, endlos. Seit dem 04.08.2026
    # kommt die Unit ueber BEIDE Ausrollwege auf JEDE Karte; ohne die Probe
    # haette also jede Box ohne genau diesen FT5x06 ein Neustart-Karussell
    # bekommen — und bei jeder Runde ein neues uinput-Geraet an- und wieder
    # abgemeldet, mitten unter dem laufenden X-Server.
    # Mehrere Versuche, weil ein einzelner Lesefehler auch ein kurz belegter
    # Bus sein kann; wer wirklich da ist, antwortet innerhalb einer halben
    # Sekunde.
    antwortet = False
    for _ in range(10):
        if ctl.lesen() is not None:
            antwortet = True
            break
        time.sleep(0.1)
    if not antwortet:
        ctl.schliessen()
        print(
            f"Keine Antwort von 0x{I2C_ADRESSE:02x} auf Bus {I2C_BUS} — "
            "kein FT5x06 angeschlossen, Bruecke nicht noetig",
            file=sys.stderr,
        )
        return 0
    try:
        geraet = Eingabegeraet(drehung=DREHUNG)
    except OSError as e:
        ctl.schliessen()
        print(f"/dev/uinput nicht verfuegbar ({e}) — Bruecke kann nichts melden", file=sys.stderr)
        return 0
    print("Touch-Bruecke laeuft", flush=True)
    fehler = 0
    try:
        while True:
            p = ctl.beruehrungen()
            if p is None:
                fehler += 1
                if fehler > 200:          # Bus dauerhaft weg -> beenden, systemd startet neu
                    print("I2C antwortet nicht mehr", file=sys.stderr)
                    return 1
                time.sleep(0.05)
                continue
            fehler = 0
            geraet.melden(p)
            time.sleep(1.0 / ABFRAGEN_PRO_S)
    except KeyboardInterrupt:
        return 0
    finally:
        geraet.schliessen()
        ctl.schliessen()


def main(argv):
    global DREHUNG
    if "--drehung" in argv:
        i = argv.index("--drehung")
        try:
            DREHUNG = int(argv[i + 1]) % 360
        except (IndexError, ValueError):
            print("--drehung braucht 0, 90, 180 oder 270", file=sys.stderr)
            return 2
        if DREHUNG not in (0, 90, 180, 270):
            print("--drehung: nur 0, 90, 180, 270", file=sys.stderr)
            return 2
    if "--auto" in argv and kerntreiber_taugt():
        print("Kerneltreiber hat eine Unterbrechungsleitung — Bruecke nicht noetig")
        return 0
    if "--auto" in argv:
        treiber_loesen()
    if "--unbind" in argv:
        print("Kerneltreiber geloest" if treiber_loesen() else "Kerneltreiber war nicht gebunden")
    if "--probe" in argv:
        i = argv.index("--probe")
        dauer = float(argv[i + 1]) if len(argv) > i + 1 and argv[i + 1][0].isdigit() else 15.0
        return messen(dauer)
    return laufen()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
