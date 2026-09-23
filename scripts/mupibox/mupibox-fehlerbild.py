#!/usr/bin/env python3
"""Ein BILD statt eines schwarzen Schirms, wenn ein Dienst aufgibt.

WOZU (BACKLOG E11c/S3)
Eine Box im Kinderzimmer, die nach dem Einschalten schwarz bleibt, ist fuer ein
Kind kaputt — egal wie sauber der Fehler im Protokoll steht. Das Protokoll
liest niemand: es braucht SSH, und wer SSH hat, hat das Problem ohnehin schon
halb geloest. Der Bildschirm ist die einzige Ausgabe, die das Kind und die
Eltern erreicht.

Dieses Skript ist die AUFFANGLOESUNG unter der Boot-Animation. Die Animation
(mupibox-boot-splash.py) zeigt Fortschritt, solange es Fortschritt gibt; bleibt
sie stehen, sieht man zwar, WO es klemmt, aber sie sagt nie „es ist
schiefgegangen". Das sagt dieses Bild — angehaengt an die Dienste ueber
`OnFailure=mupibox-fehlerbild@%n.service`, also genau dann, wenn systemd selbst
den Fehler schon festgestellt hat.

AUFRUF
    mupibox-fehlerbild.py mupibox-server.service     Bild fuer diese Unit
    mupibox-fehlerbild.py --text "Kein Ton" "Zeile2" freier Anlass
    mupibox-fehlerbild.py --probe bild.png mupibox-server.service
                                                     auf PAPIER statt auf den
                                                     Schirm — laeuft ohne
                                                     Framebuffer, also auch am
                                                     Entwicklungsrechner
    mupibox-fehlerbild.py --selbsttest               prueft das Zeichnen ohne
                                                     Box, Rueckgabe 0/1

DIE WICHTIGSTE REGEL: WENN DIE OBERFLAECHE LAEUFT, MALEN WIR NICHT.
Ein Dienst kann Stunden nach dem Start scheitern — dann sitzt ein Kind vor
einem laufenden Bild und hoert Musik. Ein Fehlerbild darueberzulegen waere aus
einem kleinen Fehler ein grosser gemacht: der Kiosk waere weg, die Musik
liefe weiter, und niemand kaeme zurueck. Laeuft Chromium, endet dieses Skript
also wortlos mit 0. Der Schirm gehoert dann dem Kiosk.

DIE ZWEITE ZURUECKHALTUNG: SOLANGE DIE BOOT-ANIMATION LAEUFT, WARTEN WIR.
Sie hat beim ersten Anlauf (Commit 64e53ec9) gefehlt, und ohne sie faellt
dieses Skript ausgerechnet in dem Fenster aus, fuer das es gebaut ist.

  Wir malen GENAU EINMAL und lassen das Bild dann stehen. Die Animation malt
  20-mal je Sekunde (BILD_PRO_S) den ganzen Framebuffer neu. Beide zugleich
  heisst also nicht "es flackert", sondern: das Fehlerbild ist nach 50 ms
  ueberschrieben und kommt NIE WIEDER — der Prozess haelt danach eine
  Viertelstunde lang einen Schirm, auf dem das letzte Bild der ANIMATION
  steht.

Und genau dieser Zusammenstoss ist kein Sonderfall, sondern der Normalfall:
die Animation laeuft bis zu 120 s, das brauchbare Bild kommt nach gemessenen
19,4 bis 23,8 s (tools/grundmessung.py, 04.08.2026). Ein Dienst, der beim
Starten scheitert, scheitert also mitten in der Animation —
`mupibox-server.service` etwa faellt mit Restart=on-failure/RestartSec=2 nach
den systemd-ueblichen fuenf Versuchen in rund 10 s auf "failed", und Chromium
ist dann noch nicht da.

Deshalb: erst warten, bis die Animation weg ist (sie zeigt in dieser Zeit
ehrlich, an WELCHEM Meilenstein es haengt — mehr Auskunft als dieses Bild),
dabei weiter auf Chromium schauen, und erst dann malen. Dieselbe Regel wie in
mupibox-kioskwache.py, wo sie von Anfang an stand.

WAS ES NICHT TUT
Es repariert nichts, es startet nichts neu und es faellt nie hart aus. Jeder
Fehler endet still mit 0 — ein Fehlerbild, das selbst den Start aufhaelt, waere
die Fehlerklasse, die es bekaempfen soll.
"""
import importlib.util
import os
import signal
import subprocess
import sys
import time

HIER = os.path.dirname(os.path.abspath(__file__))

# WIE LANGE DAS BILD INSGESAMT LEBEN DARF — Warten EINGERECHNET.
#
# Die Unit setzt RuntimeMaxSec=16min. Wird der Prozess von systemd abgeraeumt,
# faellt er ueber SIGTERM, und dabei laeuft in Python KEIN `finally`: die
# Framebuffer-Konsole bliebe abgekoppelt und der Schirm stumm bis zum Neustart.
# Zwei Sicherungen dagegen, und beide werden gebraucht:
#   * diese Frist hier liegt UNTER der von systemd, Wartezeit inklusive —
#     darum eine Frist ab Prozessstart und nicht ab dem Malen,
#   * und SIGTERM wird trotzdem abgefangen (siehe main), fuer den Fall, dass
#     jemand von Hand `systemctl stop` sagt.
GESAMTFRIST = 900.0


# Die Zeichenwerkzeuge kommen aus der Boot-Animation — BEWUSST nicht kopiert.
# Framebuffer, PSF-Schriftleser und PNG-Leser sind dort am Geraet bezahlt
# worden (16 bpp am Pi 4, 32 bpp am Pi 5, Konsole abkoppeln). Eine zweite
# Fassung waere eine zweite Fehlerquelle, die beim ersten Formatwechsel
# auseinanderlaeuft.
_pfad = os.path.join(HIER, "mupibox-boot-splash.py")
_spec = importlib.util.spec_from_file_location("mupibox_boot_splash", _pfad)
try:
    bs = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(bs)
except Exception as e:                      # noqa: BLE001 — still scheitern
    print(f"Fehlerbild nicht moeglich: {e}", file=sys.stderr)
    sys.exit(0)

HINTERGRUND = (0x1A, 0x10, 0x10)     # dunkel, aber merklich waermer als der Start
WARNTON = (0xE2, 0x8C, 0x44)         # Bernstein — die Umkehrung der Themenfarbe
TEXT = (0xEA, 0xF1, 0xF8)
GEDIMMT = (0x9F, 0x8E, 0x76)

# WAS DEM MENSCHEN VOR DER BOX GESAGT WIRD, nicht was systemd meldet.
#
# Der Unit-Name steht trotzdem klein darunter — er ist das, was beim Nachfragen
# weiterhilft. Oben steht, was ausgefallen IST, in der Sprache der Sache:
# jemand soll sehen koennen, ob das Kind heute noch Musik hoert.
KLARTEXT = {
    "mupibox-server.service": ("Die Box konnte nicht starten",
                               "Die Oberflaeche fehlt"),
    "mupibox-player.service": ("Die Box startet, aber es kommt kein Ton",
                               "Der Abspieler fehlt"),
    "librespot.service": ("Spotify fehlt",
                          "Der Rest der Box laeuft"),
    "mupi_check_internet.service": ("Die Musik-Bibliothek fehlt",
                                    "Der Rest der Box laeuft"),
    "mupi_wifi.service": ("Kein WLAN", "Die Box laeuft, findet aber kein Netz"),
    "pulseaudio.service": ("Kein Ton", "Die Tonausgabe ist ausgefallen"),
}
ERSATZ = ("Etwas ist schiefgegangen", "Ein Dienst der Box ist ausgefallen")


# Wo Konsolenschriften liegen. Der erste Pfad ist der von DietPi/Debian (am
# Geraet gezaehlt: 744 Dateien), der zweite der von kbd — er steht hier, damit
# `--probe` auch am Entwicklungsrechner ein echtes Bild liefert und nicht nur
# auf der Box geprueft werden kann.
SCHRIFTORTE = ("/usr/share/consolefonts", "/usr/share/kbd/consolefonts")


def schrift(*pfade, hoehe_etwa=None):
    """Eine PSF-Schrift laden — mit RUECKFALL auf irgendeine vorhandene.

    Die Boot-Animation nennt zwei feste Dateinamen aus /usr/share/consolefonts.
    Fehlt genau dieser Name auf einem anderen Abbild, faellt dort das Zeichnen
    aus und der Schirm bleibt schwarz — also genau der Fall, gegen den beide
    Skripte gebaut sind. Ein Fehlerbild darf daran erst recht nicht scheitern:
    lieber eine haesslichere Schrift als kein Bild.

    hoehe_etwa waehlt aus dem Rueckfall die Schrift mit der naechstgelegenen
    Hoehe — sonst geraet die Kopfzeile so gross wie das Kleingedruckte.
    """
    for p in pfade:
        try:
            return bs.Schrift(p)
        except (OSError, RuntimeError):
            continue
    kandidaten = []
    for ort in SCHRIFTORTE:
        try:
            for name in sorted(os.listdir(ort)):
                if ".psf" in name:
                    kandidaten.append(os.path.join(ort, name))
        except OSError:
            continue
    geladen = []
    for pfad in kandidaten:
        try:
            geladen.append(bs.Schrift(pfad))
        except (OSError, RuntimeError):
            continue
        if hoehe_etwa is None:
            return geladen[-1]
    if not geladen:
        raise RuntimeError("keine brauchbare Konsolenschrift gefunden")
    return min(geladen, key=lambda s: abs(s.hoehe - hoehe_etwa))


def papierschirm(breite=800, hoehe=480, bpp=32):
    """Ein Schirm, der NICHT am Framebuffer haengt — fuers Pruefen ohne Box.

    Dieselbe Klasse, dieselben Zeichenwege, nur ohne /dev/fb0. Eine eigene
    Zeichenfassung fuers Testen waere eine Attrappe, die genau die Fehler nicht
    faengt, die man sucht (falsche Farbtiefe, Text laeuft aus dem Bild).
    """
    s = bs.Schirm.__new__(bs.Schirm)
    s.b, s.h, s.bpp = breite, hoehe, bpp
    s.bp = bpp // 8
    s.puffer = bytearray(breite * hoehe * s.bp)
    s.mm = None
    s.fd = None
    s.zeigen = lambda: None
    s.schliessen = lambda: None
    return s


def oberflaeche_laeuft():
    """Laeuft der Kiosk? Dann gehoert der Schirm ihm — siehe Kopf."""
    try:
        return subprocess.run(["pgrep", "-f", "[c]hromium"],
                              stdout=subprocess.DEVNULL, timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def animation_laeuft():
    """Laeuft die Boot-Animation? Dann gehoert der Schirm IHR — siehe Kopf.

    NICHT ueber `systemctl is-active mupibox-boot-splash.service` gefragt,
    sondern nach dem PROZESS: die Unit ist Type=simple und gilt systemd schon
    als aktiv, bevor das erste Bild steht — und umgekehrt kann jemand das
    Skript von Hand laufen lassen. Gemalt wird auf den Framebuffer, also ist
    der Prozess die richtige Frage.
    """
    try:
        return subprocess.run(["pgrep", "-f", "[m]upibox-boot-splash.py"],
                              stdout=subprocess.DEVNULL, timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def darf_malen(bis, kiosk=oberflaeche_laeuft, animation=animation_laeuft,
               jetzt=time.time, schlafen=time.sleep):
    """Warten, bis der Schirm frei ist. -> True: malen. False: Finger weg.

    Der Rueckgabewert ist bewusst binaer und die Wartezeit steckt drin — die
    Reihenfolge der drei Fragen ist die ganze Regel:

      1. Kiosk da     -> nie malen (der haeufigste Fall, auch spaeter im Tag)
      2. Animation da -> warten, sie sagt mehr als wir
      3. Frist um     -> malen, auch wenn die Animation noch laeuft: dann
                         haengt sie selbst, und ein stehender Balken ist keine
                         Auskunft mehr.

    Die drei Auskuenfte kommen als Parameter herein, damit die Tabelle OHNE
    Box pruefbar ist (--selbsttest). Dieselbe Ueberlegung wie bei
    `entscheidung()` in mupibox-kioskwache.py: was im selben Atemzug fragt und
    handelt, testet man nur am Geraet — und am Geraet testet man es dann nicht.
    """
    while True:
        if kiosk():
            return False
        if not animation():
            return True
        if jetzt() >= bis:
            return True
        schlafen(2)


def adresse():
    """Die IPv4 der Box als Zeichenkette — oder "" .

    Sie steht auf dem Bild, weil sie die einzige Auskunft ist, mit der jemand
    von aussen weiterkommt (Verwaltung im Browser, SSH). Ohne Netz bleibt die
    Zeile weg, statt "0.0.0.0" zu behaupten.
    """
    import fcntl
    import socket
    import struct
    SIOCGIFADDR = 0x8915
    s = None
    try:
        namen = [n for n in os.listdir("/sys/class/net") if n != "lo"]
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for n in sorted(namen):
            try:
                r = fcntl.ioctl(s.fileno(), SIOCGIFADDR,
                                struct.pack("256s", n[:15].encode()))
                ip = socket.inet_ntoa(r[20:24])
                if ip not in ("", "0.0.0.0"):
                    return ip
            except OSError:
                continue
    except OSError:
        pass
    finally:
        if s is not None:
            s.close()
    return ""


def ausrufezeichen(schirm, x, y, groesse, farbe):
    """Ein Ausrufezeichen im Kreis — von Hand, aus demselben Grund wie die Note.

    Kein PNG: das Bild muss auf einer Box erscheinen, auf der gerade etwas
    kaputt ist. Je weniger Dateien dafuer vorhanden sein muessen, desto besser.
    """
    r = groesse // 2
    dicke = max(3, groesse // 14)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d = (dx * dx + dy * dy) ** 0.5
            if r - dicke <= d <= r:
                px, py = x + dx, y + dy
                if 0 <= px < schirm.b and 0 <= py < schirm.h:
                    o = (py * schirm.b + px) * schirm.bp
                    schirm.puffer[o:o + schirm.bp] = bs.punkt(*farbe, schirm.bpp)
    strich = max(3, groesse // 10)
    schirm.rechteck(x - strich // 2, y - int(r * 0.55), strich, int(r * 0.85), farbe)
    schirm.rechteck(x - strich // 2, y + int(r * 0.42), strich, strich, farbe)


def _zeile(schirm, wunsch, ersatz, text, y, farbe, rand=16):
    """Eine mittige Zeile, die GARANTIERT ins Bild passt.

    Warum das eine eigene Funktion ist: der PSF-Zeichensatz hat feste Breiten,
    also waechst jeder Text linear. Ein Unit-Name wie
    `mupibox-fehlerbild@mupi_check_internet.service` ist mit der grossen
    Schrift 750 px breit und lief bei 800 px Panelbreite rechts hinaus — die
    Zeichenfunktion schneidet still ab, das Bild sah aus wie ein Fehler im
    Fehlerbild. Erst kleiner setzen, dann kuerzen, aber nie ueberlaufen.
    """
    platz = schirm.b - 2 * rand
    fuer = wunsch if wunsch.textbreite(text) <= platz else ersatz
    passt = max(1, platz // fuer.breite)
    if len(text) > passt:
        # Kein Auslassungszeichen: eine PSF-Konsolenschrift hat nur die ersten
        # 256 Stellen, "…" liegt darueber und kaeme als "?" heraus. Ein Punkt
        # steht in jeder Schrift.
        text = text[:passt - 1] + "." if passt > 2 else text[:passt]
    fuer.malen(schirm, text, (schirm.b - fuer.textbreite(text)) // 2, y, farbe)
    return fuer


def malen(schirm, gross, klein, kopf, unterzeile, unit, ip):
    schirm.fuellen(HINTERGRUND)
    mitte = schirm.b // 2

    ausrufezeichen(schirm, mitte, int(schirm.h * 0.24), int(schirm.h * 0.22), WARNTON)

    y = int(schirm.h * 0.44)
    _zeile(schirm, gross, klein, kopf, y, TEXT)
    y += gross.hoehe + 10
    _zeile(schirm, klein, klein, unterzeile, y, WARNTON)

    # DIE HANDLUNGSANWEISUNG, nicht die Diagnose. Wer vor der Box steht, kann
    # genau eines tun, und das soll dastehen.
    y = int(schirm.h * 0.68)
    rat = "Box aus- und wieder einschalten"
    klein.malen(schirm, rat, mitte - klein.textbreite(rat) // 2, y, TEXT)

    # Kleingedrucktes: erst hier der Unit-Name und die Adresse.
    y = schirm.h - klein.hoehe * 2 - 12
    if ip:
        fuss = f"{unit}  -  http://{ip}:8200"
    else:
        fuss = f"{unit}  -  kein Netz"
    _zeile(schirm, klein, klein, fuss, y, GEDIMMT)
    schirm.zeigen()


def anlass(argv):
    """Aus der Befehlszeile -> (Kopfzeile, Unterzeile, Unit-Name).

    DIE UNIT KOMMT ALS `mupibox-fehlerbild@<unit>.service` HEREIN, wenn systemd
    die Vorlage ueber OnFailure startet — %i traegt den Namen der GESCHEITERTEN
    Unit, aber der Aufrufer kann auch den blanken Namen uebergeben. Beides muss
    denselben Klartext finden, sonst steht bei der haeufigsten Ursache der
    Ersatztext.
    """
    if "--text" in argv:
        i = argv.index("--text")
        kopf = argv[i + 1] if i + 1 < len(argv) else ERSATZ[0]
        unter = argv[i + 2] if i + 2 < len(argv) else ERSATZ[1]
        return kopf, unter, "MuPiBox"
    roh = next((a for a in argv[1:] if not a.startswith("-")), "")
    name = roh
    if "@" in name:
        name = name.split("@", 1)[1]
        if name.endswith(".service"):
            name = name[: -len(".service")]
    if name and not name.endswith((".service", ".timer", ".target")):
        name += ".service"
    kopf, unter = KLARTEXT.get(name, ERSATZ)
    return kopf, unter, (name or "MuPiBox")


def main(argv):
    if "--selbsttest" in argv:
        return selbsttest()

    start = time.time()
    probe = None
    if "--probe" in argv:
        i = argv.index("--probe")
        probe = argv[i + 1] if i + 1 < len(argv) else "probe.png"
        argv = argv[:i] + argv[i + 2:]

    kopf, unterzeile, unit = anlass(argv)

    # SIGTERM IN EINEN ORDENTLICHEN ABGANG UEBERSETZEN. Ohne das beendet Python
    # den Prozess sofort, `finally` laeuft NICHT — und die Framebuffer-Konsole
    # bliebe abgekoppelt, der Schirm stumm bis zum Neustart. Genau das Uebel,
    # gegen das dieses Skript gebaut ist, nur von uns selbst verursacht.
    if probe is None:
        for zeichen in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(zeichen, lambda *_: sys.exit(0))
            except (OSError, ValueError):
                pass

    if probe is None:
        # 150 s Deckel fuers Warten: die Animation endet von selbst nach 120 s
        # (MAX_LAUFZEIT dort). Wer laenger laeuft, haengt.
        if not darf_malen(start + 150.0):
            return 0

    try:
        schirm = papierschirm() if probe is not None else bs.Schirm()
        gross = schrift(bs.SCHRIFT_GROSS, hoehe_etwa=30)
        klein = schrift(bs.SCHRIFT_KLEIN, bs.SCHRIFT_GROSS, hoehe_etwa=16)
    except (OSError, RuntimeError) as e:
        print(f"Fehlerbild nicht moeglich: {e}", file=sys.stderr)
        return 0

    konsole = bs.KonsoleAus()
    if probe is None:
        konsole.__enter__()
    try:
        malen(schirm, gross, klein, kopf, unterzeile, unit, adresse())
        if probe is not None:
            _als_png(schirm, probe)
            print(f"Fehlerbild nach {probe} geschrieben")
        else:
            # STEHENLASSEN, aber nicht ewig. Solange dieser Prozess lebt,
            # bleibt die Konsole abgekoppelt und das Bild steht. Kommt der
            # Kiosk doch noch (etwa weil die Kioskwache ihn neu gestartet
            # hat), raeumen wir von selbst das Feld.
            #
            # DIE FRIST LAEUFT AB PROZESSSTART, nicht ab hier: das Warten auf
            # die Boot-Animation gehoert mit hinein, sonst reisst die Summe
            # aus beidem das RuntimeMaxSec der Unit (siehe GESAMTFRIST).
            ende = start + GESAMTFRIST
            while time.time() < ende:
                time.sleep(2)
                if oberflaeche_laeuft():
                    break
    finally:
        schirm.schliessen()
        if probe is None:
            konsole.__exit__(None, None, None)
    return 0


def _als_png(schirm, pfad):
    """Den gezeichneten Puffer als PNG ablegen — nur fuers Pruefen.

    Damit laesst sich das Bild am Entwicklungsrechner ansehen, ohne die Box
    anzufassen — `--probe bild.png` zusammen mit papierschirm().
    """
    import struct
    import zlib
    zeilen = bytearray()
    for y in range(schirm.h):
        zeilen.append(0)
        for x in range(schirm.b):
            o = (y * schirm.b + x) * schirm.bp
            r, g, b = bs.hintergrund(schirm.puffer[o:o + schirm.bp], schirm.bpp)
            zeilen += bytes((r, g, b))

    def block(typ, nutz):
        return (struct.pack(">I", len(nutz)) + typ + nutz
                + struct.pack(">I", zlib.crc32(typ + nutz) & 0xFFFFFFFF))

    with open(pfad, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(block(b"IHDR", struct.pack(">IIBBBBB", schirm.b, schirm.h,
                                           8, 2, 0, 0, 0)))
        f.write(block(b"IDAT", zlib.compress(bytes(zeilen), 6)))
        f.write(block(b"IEND", b""))


# ── Selbsttest ────────────────────────────────────────────────────────────
#
# WARUM IM SKRIPT UND NICHT IN tools/: das Fehlerbild muss auf einer Box
# funktionieren, auf der gerade etwas kaputt ist. Der Test gehoert deshalb
# neben die Sache und laeuft AUCH DORT (`mupibox-fehlerbild.py --selbsttest`),
# nicht nur am Entwicklungsrechner. Er braucht weder Framebuffer noch die
# Konsolenschriften der Box — die Schrift wird hier erzeugt.
def _bau_psf2(breite=8, hoehe=16, anzahl=256):
    """Eine winzige PSF2-Schrift im Speicher: jedes Zeichen ein voller Block.

    Voll gefuellte Glyphen sind Absicht: der Test fragt „wurde ueberhaupt
    etwas an dieser Stelle gezeichnet?", und dafuer ist ein Block eindeutiger
    als ein Buchstabe.
    """
    import struct
    zeilenbytes = (breite + 7) // 8
    groesse = zeilenbytes * hoehe
    kopf = struct.pack("<8I", 0x864AB572, 0, 32, 1, anzahl, groesse, hoehe, breite)
    return kopf + bytes([0xFF]) * (groesse * anzahl)


def _dienste_aus_dem_skript(pfad):
    """Die DIENSTE-Liste aus fehlerbild-anhaengen.sh lesen. -> Liste, evtl. leer.

    Von Hand statt mit `bash -c`: das Skript hier auszufuehren, nur um an eine
    Liste zu kommen, hiesse `systemctl` und `mkdir` auf einer Box anzustossen,
    die gerade geprueft wird. Gelesen wird der Block zwischen "DIENSTE=(" und
    der schliessenden Klammer.
    """
    try:
        with open(pfad) as f:
            zeilen = f.read().splitlines()
    except OSError:
        return []
    raus, drin = [], False
    for z in zeilen:
        s = z.strip()
        if s.startswith("DIENSTE=("):
            drin = True
            continue
        if drin:
            if s.startswith(")"):
                break
            if s and not s.startswith("#"):
                raus.append(s)
    return raus


def _listen_decken_sich():
    """Hat jeder Dienst aus dem Anhaenge-Skript einen Klartext? -> True/False.

    Fehlt das Skript (etwa weil jemand nur diese Datei kopiert hat), gilt die
    Pruefung als bestanden: ein Selbsttest, der an einer FEHLENDEN Nachbardatei
    scheitert, sagt nichts ueber das Fehlerbild.
    """
    pfad = os.path.join(HIER, "fehlerbild-anhaengen.sh")
    if not os.path.exists(pfad):
        return True
    dienste = _dienste_aus_dem_skript(pfad)
    if not dienste:
        print("        (DIENSTE-Liste nicht gefunden — Leseweise geaendert?)")
        return False
    ohne = [d for d in dienste if d not in KLARTEXT]
    for d in ohne:
        print(f"        ohne Klartext: {d}")
    return not ohne


def selbsttest():
    import tempfile
    ok = bad = 0

    def chk(name, bedingung):
        nonlocal ok, bad
        print(("  OK    " if bedingung else "  FEHLT ") + name)
        ok += bool(bedingung)
        bad += (not bedingung)

    with tempfile.NamedTemporaryFile(suffix=".psf", delete=False) as f:
        f.write(_bau_psf2())
        pfad = f.name
    try:
        gross = bs.Schrift(pfad)
        klein = bs.Schrift(pfad)

        # 1. Der Klartext muss BEIDE Schreibweisen finden — die blanke Unit und
        #    die, die systemd der Vorlage mitgibt (mupibox-fehlerbild@X.service).
        k1 = anlass(["x", "mupi_check_internet.service"])
        k2 = anlass(["x", "mupibox-fehlerbild@mupi_check_internet.service"])
        chk("Unit-Name aus der systemd-Vorlage wird erkannt", k1[:2] == k2[:2])
        chk("Klartext statt Unit-Name", k1[0] == KLARTEXT["mupi_check_internet.service"][0])
        chk("Unbekannte Unit bekommt Ersatztext",
            anlass(["x", "gibtsnicht.service"])[:2] == ERSATZ)

        # 2. Auf BEIDEN Farbtiefen zeichnen: der Pi 4 faehrt mit 16 bpp hoch,
        #    der Pi 5 mit 32 (Wiki: mupi-splash-16bpp). Ein Fehlerbild, das nur
        #    auf einem der beiden Boards erscheint, waere keines.
        for bpp in (16, 32):
            s = papierschirm(800, 480, bpp)
            malen(s, gross, klein, "Die Box konnte nicht starten",
                  "Die Oberflaeche fehlt", "mupibox-server.service", "192.168.1.2")
            hg = bs.punkt(*HINTERGRUND, bpp)
            anders = sum(1 for i in range(0, len(s.puffer), s.bp)
                         if bytes(s.puffer[i:i + s.bp]) != hg)
            chk(f"{bpp} bpp: es steht etwas auf dem Bild ({anders} Punkte)",
                anders > 2000)

        # 3. NICHTS DARF UEBER DEN RAND LAUFEN. Die Zeichenfunktion schneidet
        #    still ab; ein zu langer Text saehe dann aus wie ein zweiter Fehler.
        s = papierschirm(800, 480, 32)
        s.fuellen(HINTERGRUND)
        _zeile(s, gross, klein, "m" * 200, 100, TEXT)
        hg = bs.punkt(*HINTERGRUND, s.bp * 8)
        spalten = [i % s.b for i in range(s.b * s.h)
                   if bytes(s.puffer[i * s.bp:(i + 1) * s.bp]) != hg]
        chk("uebergrosser Text bleibt im Bild",
            bool(spalten) and min(spalten) >= 8 and max(spalten) <= s.b - 8)

        # 3b. WANN UEBERHAUPT GEMALT WERDEN DARF. Die Tabelle, die beim ersten
        #     Anlauf gefehlt hat: ohne sie malte das Fehlerbild MITTEN IN DIE
        #     Boot-Animation, wurde 50 ms spaeter von ihr ueberschrieben und kam
        #     nie wieder — im einzigen Fenster, fuer das es gebaut ist.
        chk("Kiosk laeuft -> gar nicht malen",
            darf_malen(0, kiosk=lambda: True, animation=lambda: False,
                       jetzt=lambda: 0, schlafen=lambda _s: None) is False)
        chk("Kiosk laeuft, Animation auch -> der Kiosk gewinnt",
            darf_malen(0, kiosk=lambda: True, animation=lambda: True,
                       jetzt=lambda: 0, schlafen=lambda _s: None) is False)
        chk("Schirm frei -> sofort malen, ohne zu warten",
            darf_malen(0, kiosk=lambda: False, animation=lambda: False,
                       jetzt=lambda: 0, schlafen=lambda _s: None) is True)

        # Die Animation laeuft und hoert nach ein paar Runden auf: gewartet
        # wird, bis sie weg ist — und KEINE Runde laenger.
        runden = []

        def _animation_hoert_auf():
            runden.append(1)
            return len(runden) < 4

        chk("Animation laeuft -> warten, bis sie weg ist",
            darf_malen(1e9, kiosk=lambda: False, animation=_animation_hoert_auf,
                       jetzt=lambda: 0, schlafen=lambda _s: None) is True
            and len(runden) == 4)

        # Und der Notausgang: eine Animation, die NICHT aufhoert, darf uns nicht
        # ewig festhalten — sonst haengt das Fehlerbild an genau der Stelle,
        # an der die Box haengt.
        uhr = [0.0]

        def _tick(_s):
            uhr[0] += 2.0

        chk("haengende Animation -> nach der Frist trotzdem malen",
            darf_malen(150.0, kiosk=lambda: False, animation=lambda: True,
                       jetzt=lambda: uhr[0], schlafen=_tick) is True
            and uhr[0] >= 150.0)

        # 3c. DIE LISTE STEHT AN ZWEI STELLEN — und muss dieselbe sein.
        #
        #     Welche Dienste ein Fehlerbild BEKOMMEN, entscheidet
        #     fehlerbild-anhaengen.sh (DIENSTE); was dann DARAUFSTEHT, entscheidet
        #     KLARTEXT hier. Kommt drueben einer dazu und hier nicht, faellt er
        #     STILL auf "Etwas ist schiefgegangen" zurueck: das Bild erscheint,
        #     sagt aber nicht mehr, ob das Kind heute noch Musik hoert — und
        #     niemand merkt es, weil nichts rot wird. Dieselbe Fehlerklasse wie
        #     bei den Dienst-Zeichen der Kacheln (tools/dienst-marken-schau.mjs).
        #
        #     Das Skript liegt auf der Box im selben Verzeichnis wie diese Datei
        #     (/usr/local/bin/mupibox/) und im Repo ebenfalls (scripts/mupibox/),
        #     also findet HIER es auf beiden Seiten.
        chk("Klartext fuer jeden Dienst, der ein Fehlerbild bekommt",
            _listen_decken_sich())

        # 4. Der Rueckfall auf irgendeine vorhandene Schrift darf nicht werfen,
        #    wenn gar keine da ist — er soll sauber melden.
        try:
            schrift("/gibt/es/nicht.psf")
            chk("ohne Schrift: sauberer Abbruch", True)
        except RuntimeError:
            chk("ohne Schrift: sauberer Abbruch", True)
        except Exception:                                  # noqa: BLE001
            chk("ohne Schrift: sauberer Abbruch", False)
    finally:
        os.unlink(pfad)

    print(f"\nFehlerbild: {ok} bestanden, {bad} fehlgeschlagen")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
