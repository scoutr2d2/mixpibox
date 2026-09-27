#!/usr/bin/env python3
"""Einrichtungsbildschirm der MuPiBox — QR-Code und Adresse auf dem Schirm.

WOZU: Beim ersten Start soll niemand mehr einen Laptop brauchen. Die Box zeigt
auf ihrem eigenen Schirm, wohin das Handy gehen muss — als QR-Code zum
Abfotografieren und als Adresse zum Abtippen, falls die Kamera zickt.

WAS HIER WIEDERVERWENDET WIRD, statt es ein zweites Mal zu bauen:
  * `mupibox-boot-splash.py` bringt bereits Framebuffer, PSF-Schriften, das
    Abkoppeln der Konsole und die FARBEN DES FORKS mit. Genau die werden
    importiert — ein zweiter Satz Farben waere sofort ein zweiter Look, und
    die Boot-Animation laeuft unmittelbar vorher auf demselben Schirm.
  * `qr.py` erzeugt den Code, ebenfalls ohne Fremdpakete.

Beides in reiner Standardbibliothek: auf einer frischen DietPi gibt es weder
PIL noch pip-Pakete, und ein Einrichtungsbildschirm darf an nichts haengen,
was erst nachgeladen werden muesste.

WAS ES NICHT TUT
  * Es richtet nichts ein. Es ZEIGT nur, wo eingerichtet wird — der Assistent
    selbst laeuft im Agenten und wird vom Handy bedient.
  * Es haelt den Start nicht auf: fehlt der Framebuffer oder klemmt etwas,
    endet es still. Ein kaputter Bildschirm darf nie eine stumme Box bedeuten.
  * Es zeichnet keine eigenen Schriften. Was die Konsolenschriften nicht
    hergeben, wird nicht angezeigt.

AUFRUF
    python3 tools/einrichtung-schirm.py            # bis zur Einrichtung
    python3 tools/einrichtung-schirm.py --einmal   # einmal zeichnen und raus
    python3 tools/einrichtung-schirm.py --port 8099
"""
import importlib.util
import json
import os
import socket
import struct
import subprocess
import sys
import time

HIER = os.path.dirname(os.path.abspath(__file__))


def _laden(name, datei):
    pfad = os.path.join(HIER, datei)
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


# Der Bindestrich im Dateinamen laesst kein normales `import` zu — derselbe
# Griff wie in tests/splash_test.py.
bs = _laden("bootsplash", "mupibox-boot-splash.py")
qr = _laden("qr", "qr.py")
ap = _laden("einrichtungap", "einrichtung-ap.py")

# ── Aussehen: die Farben kommen aus der Boot-Animation ──────────────────────
HINTERGRUND = bs.HINTERGRUND
AKZENT = bs.AKZENT
TEXT = bs.TEXT
GEDIMMT = bs.GEDIMMT
# Der QR-Code braucht einen HELLEN Grund. Auf dem dunklen Thema direkt gemalt
# waere er invertiert, und ein invertierter Code ist fuer die meisten
# Handy-Kameras schlicht keiner.
KARTE = (0xF4, 0xF7, 0xFA)
KARTE_DUNKEL = (0x0E, 0x14, 0x1A)

RAND = 24
TAKT_S = 2
MAX_LAUFZEIT = 30 * 60
# Hoehe des Fortschrittsbalkens. Steht hier, weil ZWEI Stellen mit ihr rechnen
# muessen: der Balken selbst und der Platz, den die QR-Karte darueber frei
# lassen muss. Standen sie getrennt, lief die Schrift auf die Karte.
BALKEN_H = 14

# ── Das Maskottchen ─────────────────────────────────────────────────────────
# MixPi im Zustand `hoert` — der STANDARD aus NewDesign/maskottchen.json. Einen
# eigenen Zustand „einrichten" gibt es nicht, und er wird hier auch nicht
# erfunden: laut llmwiki (mixpi-maskottchen-familie) gehoert die Zuordnung in
# jene Datei, nicht in den Code. Kommt einer dazu, wird hier nur der Name
# getauscht.
#
# DIE EIGENE KOPIE ZUERST: auf einer frischen Box gibt es weder
# NewDesign/bilder/ noch /var/www — die App ist ja noch nicht installiert.
# Deshalb reist das Bild mit dem Installer mit (dateien/mixpi-hoert.png). Die
# uebrigen Pfade greifen, wenn der Schirm spaeter auf einer fertigen Box laeuft.
# DER NACHBARPFAD ZUERST, und das ist der einzige, der auf der BOX traegt:
# ausgerollt liegen alle Teile flach in EINEM Ordner
# (/opt/mixpibox-einrichtung), es gibt dort kein ../dateien. Ohne diesen
# Eintrag faende der Schirm sein Bild nur im Repo — also nur da, wo er
# ohnehin nie laeuft.
MASKOTTCHEN = [
    os.path.join(HIER, "mixpi-hoert.png"),
    os.path.join(HIER, "..", "dateien", "mixpi-hoert.png"),
    "/boot/mixpi-hoert.png",
    "/boot/firmware/mixpi-hoert.png",
    "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/neu/bilder/mixpi-hoert.png",
    "/var/www/neu/bilder/mixpi-hoert.png",
]

# Wie die Box heisst, steht in IHRER Konfiguration — nie fest im Code.
KONFIG = "/etc/mupibox/mupiboxconfig.json"
NAME_RUECKFALL = "MixPiBox"


# ── Reine Logik (ohne Schirm testbar) ───────────────────────────────────────
def beste_adresse(kandidaten):
    """Welche der gefundenen Adressen gehoert aufs Bild?

    Reihenfolge mit Grund:
      1. Kabel vor Funk — beim ersten Start ist das Kabel der verlaessliche
         Weg, und wer eines gesteckt hat, will darueber arbeiten.
      2. Echte Adressen vor Eigenzuweisung (169.254.x.x). Eine
         Eigenzuweisung heisst "kein DHCP" — sie ist besser als nichts, aber
         nur, wenn es nichts Besseres gibt.
    Ohne Kandidaten: None. Der Aufrufer zeigt dann, dass noch gewartet wird.
    """
    if not kandidaten:
        return None

    def rang(eintrag):
        name, adresse = eintrag
        kabel = 0 if name.startswith(("eth", "en")) else 1
        selbst = 1 if adresse.startswith("169.254.") else 0
        return (selbst, kabel, name)

    return sorted(kandidaten, key=rang)[0][1]


def adressen_lesen():
    """Alle IPv4-Adressen der Box — direkt per ioctl, ohne Fremdprogramm.

    Bewusst nicht ueber /tmp/network.json: die schreibt ein Zeitgeber der
    MuPiBox nur alle 20 s und beim ersten Start gibt es sie gar nicht (siehe
    die Begruendung an `netz_da()` in der Boot-Animation).
    """
    import fcntl

    SIOCGIFADDR = 0x8915
    aus = []
    try:
        namen = [n for n in os.listdir("/sys/class/net") if n != "lo"]
    except OSError:
        return aus
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for n in sorted(namen):
            try:
                r = fcntl.ioctl(
                    s.fileno(), SIOCGIFADDR, struct.pack("256s", n[:15].encode())
                )
                adresse = socket.inet_ntoa(r[20:24])
                if adresse not in ("", "0.0.0.0"):
                    aus.append((n, adresse))
            except OSError:
                continue
    except OSError:
        pass
    finally:
        if s is not None:
            s.close()
    return aus


def qr_platzierung(felder, hoehe_verfuegbar, breite_verfuegbar, rand_felder=4):
    """Skala und Kantenlaenge fuer den QR-Code — moeglichst gross, aber ganz.

    GANZZAHLIG ist Pflicht: ein auf krumme Bruchteile skalierter QR-Code
    bekommt ungleich breite Felder, und daran scheitern Kameras. Lieber ein
    paar Pixel kleiner als unscharf.
    """
    gesamt = felder + 2 * rand_felder
    skala = min(hoehe_verfuegbar // gesamt, breite_verfuegbar // gesamt)
    skala = max(1, skala)
    return skala, gesamt * skala


# Der Port der Box-Oberflaeche. Dort sitzt der Eltern-Bereich: Profile,
# Akzentfarbe, Spotify, Jellyfin, erste Inhalte — alles laengst gebaut.
APP_PORT = 8200
# ══ DER FERTIGE-BOX-CODE ZEIGT AUF HTTPS ════════════════════════════════════
#
# Betreiber, 10.08.2026: „und gleich mit dem qr die https seite öffnen der
# zwischen schritt ist unnötig."
#
# WARUM ES SEIN MUSS, nicht nur bequem ist: Spotify hat 2025 HTTP-Rueckwege
# abgeschafft — ausser dem Loopback-Literal. Eine Netzwerkadresse geht nur noch
# ueber HTTPS. Und der Rueckweg muss DIESELBE HERKUNFT haben wie die Seite, auf
# der die Anmeldung beginnt: Verifier und State liegen im sessionStorage der
# Herkunft. Wer den Code auf http://…:8200 scannt und als Rueckweg
# https://…:8443 eintraegt, legt sie unter der einen ab und sucht sie unter der
# anderen. (Genau daran ist E22/R4 schon einmal gescheitert.)
#
# DER PREIS: eine Zertifikatswarnung beim ersten Aufruf, denn das Zeugnis ist
# selbstsigniert. Der Betreiber hat sie ausdruecklich in Kauf genommen
# („selbst signiert"). Einmal bestaetigen, danach merkt der Browser es sich.
#
# NUR DIESER CODE. Der WAEHREND der Einrichtung gezeigte fuehrt weiter auf den
# Assistenten ueber http — dort laeuft noch gar kein TLS, die Box baut sich ja
# gerade erst. Ihn mit umzustellen hiesse, auf eine Adresse zu zeigen, die es
# in dem Moment nicht gibt.
APP_TLS_PORT = 8443


def adresse_zu_url(adresse, port):
    return f"http://{adresse}:{port}/einrichtung"


def app_url(adresse, port=APP_TLS_PORT):
    """Wohin das Handy NACH der Vorbereitung soll.

    NICHT auf den Assistenten: der kann nur Netz, und das ist erledigt. Was
    jetzt ansteht — Profil anlegen, Farbe waehlen, Spotify und Jellyfin
    verbinden, die ersten Inhalte — kann die Box in ihrem Eltern-Bereich
    laengst.

    WAEHREND des Laufs zeigt der Schirm einen ANDEREN Code: den auf den
    Assistenten, samt Schluessel daneben. Das war lange nicht so, weil jener
    Code auf eine Seite fuehrte, die einen Schluessel verlangte, der nirgends
    stand — die Seite blieb dann ein leeres Geruest. Seit der Schluessel
    danebensteht, fuehrt er wieder irgendwohin. Diese Adresse hier bleibt
    davon unberuehrt: sie gilt erst, wenn die Box FERTIG ist.
    """
    return f"https://{adresse}:{port}/"


# ── DIE PHASEN EINER FRISCHEN BOX ───────────────────────────────────────────
# Der Betreiber wuenscht sich einen durchgehenden Schirm: "man sieht nichts
# ausser beginn qr fuer wlan -> reboot screen info dietpi -> mixpibox
# vorbereitung -> spotify, jellyfin, profil anlegen -> start". Genau diese
# Kette. Der Vorstart schreibt, wo er steht; hier steht, was das fuer den
# Menschen davor heisst. Unbekanntes faellt auf den Einrichtungsschirm zurueck.
PHASEN = {
    "grundsystem": ("Das Grundsystem wird eingerichtet",
                    "Das dauert 10 bis 20 Minuten. Es ist nichts zu tun."),
    "neustart": ("Die Box startet neu",
                 "Gleich geht es von selbst weiter."),
    "vorbereitung": ("{name} wird vorbereitet",
                     "Bitte warten – es ist nichts zu tun."),
    # Das Netz steht, ist aber zu schwach: am 09.08.2026 lud die Box 674 kB
    # in viereinhalb Minuten, und die Paketquellen liefen in
    # Zeitueberschreitungen. Die Box versucht es allein weiter — der einzige
    # Satz, der hier hilft, ist der eine Hinweis, den ein Mensch umsetzen kann.
    "netzschwach": ("Das WLAN ist zu schwach",
                    "Die Box versucht es weiter. Näher an den Router hilft."),
}
PHASE_DATEI = "/run/mixpibox-einrichtung/phase"


def phase_lesen(pfad=PHASE_DATEI):
    """Welche Phase meldet der Vorstart? Leer = keine (dann gilt der Zustand)."""
    try:
        with open(pfad, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


# ── WAS DIE BOX GERADE TUT ────────────────────────────────────────────────
# Waehrend DietPi sein Grundsystem baut, stand hier zwanzig Minuten lang
# derselbe Satz. Von aussen war nicht zu unterscheiden, ob die Box arbeitet
# oder haengt — und am 09.08.2026 tat sie beides nacheinander: erst hing sie
# an kaputten Paketlisten, dann lief sie wieder, ohne dass man es sah.
# Das Protokoll des Vorstarts weiss die ganze Zeit Bescheid; wir lesen sein
# Ende und machen EINEN deutschen Satz daraus. DietPis englische Ausgabe wird
# dabei UEBERSETZT, nicht durchgereicht: auf diesen Bildschirm gehoert kein
# Maschinentext.
# Zwei Quellen, je nach Lebensabschnitt: der Vorstart baut das Grundsystem,
# der Selbstlauf danach die MuPiBox. Gelesen wird schlicht die JUENGSTE — wer
# gerade schreibt, weiss auch gerade Bescheid. Eine feste Reihenfolge waere
# falsch: nach dem Neustart ist der Vorstart-Log zwar noch da, aber tot.
LOGORTE = ("/var/lib/mixpibox-lauf/lauf.log",
           "/var/log/mixpibox-selbstlauf.log",  # alter Ort, aeltere Boxen
           "/boot/firmware/mixpibox-vorstart.log",
           "/boot/mixpibox-vorstart.log",
           "/tmp/mixpibox-vorstart.log")
VORSTART_LOGS = LOGORTE  # alter Name, damit nichts von aussen bricht

# Von unten nach oben gelesen gewinnt der erste Treffer — die juengste Zeile,
# die ueberhaupt etwas aussagt. Reihenfolge hier = Vorrang bei Gleichstand.
_TAETIGKEITEN = (
    ("Step: Installing ", "Installiert {0}", ":"),
    ("APT install ", "Installiert {0}", ","),
    ("Setting up ", "Richtet {0} ein", " "),
    ("Unpacking ", "Entpackt {0}", " "),
)


def _log_schwanz(orte=None, bytes_=16384):
    """Das Ende des zuletzt beschriebenen Protokolls — leer, wenn es keins gibt.

    Die Orte werden ERST BEIM AUFRUF gelesen, nicht als Vorgabewert gebunden:
    sonst steht die Liste von der Importzeit fest und laesst sich nicht mehr
    umbiegen — dieselbe Falle, vor der `sagen()` im Selbstlauf warnt.
    """
    orte = LOGORTE if orte is None else orte
    # LEERE DATEIEN ZAEHLEN NICHT. Ein Aufraeumer kann eine Datei auf 0 Bytes
    # kuerzen und ihr dabei einen brandneuen Zeitstempel geben — sie waere
    # damit "die juengste" und haette doch nichts zu sagen. Genau so lag am
    # 09.08.2026 das Lauf-Protokoll da: 0 Bytes, Zeitstempel von eben.
    juengstes, zeit = None, -1.0
    for p in orte:
        try:
            if os.path.getsize(p) <= 0:
                continue
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > zeit:
            juengstes, zeit = p, m
    if juengstes is None:
        return ""
    try:
        with open(juengstes, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - bytes_))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def _rx_bytes(wurzel="/sys/class/net"):
    """Summe der empfangenen Bytes ueber alle echten Schnittstellen."""
    try:
        namen = os.listdir(wurzel)
    except OSError:
        return None
    gesamt = 0
    for n in namen:
        if n == "lo":
            continue
        try:
            with open(os.path.join(wurzel, n, "statistics/rx_bytes")) as f:
                gesamt += int(f.read().strip())
        except (OSError, ValueError):
            continue
    return gesamt


_TEMPO = {}


def tempo_lesen(jetzt=None, gelesen=None, mindest=20000):
    """Wie schnell gerade Daten hereinkommen — oder leer, wenn kaum etwas.

    WOZU: Ein Schritt wie `mupibox:chromium` steht minutenlang scheinbar
    still. Der Betreiber hat genau das bemerkt ("ist jetzt auch schon wieder
    ewig dran"). Ob die Box laedt oder haengt, sieht man an EINER Zahl — und
    die steht ohnehin schon im Kernel.

    Unter der Schwelle wird geschwiegen: eine Zeile, die zwischen "0 kB/s"
    und "3 kB/s" flackert, beunruhigt mehr, als sie erklaert.
    """
    t = time.time() if jetzt is None else jetzt
    b = _rx_bytes() if gelesen is None else gelesen
    if b is None:
        return ""
    alt_t, alt_b = _TEMPO.get("t"), _TEMPO.get("b")
    _TEMPO["t"], _TEMPO["b"] = t, b
    # Erster Blick, Ruecksprung der Uhr oder zurueckgesetzter Zaehler: schweigen.
    if alt_t is None or t - alt_t < 0.5 or b < alt_b:
        return ""
    rate = (b - alt_b) / (t - alt_t)
    if rate < mindest:
        return ""
    if rate >= 1000000:
        return ("lädt mit %.1f MB/s" % (rate / 1000000)).replace(".", ",")
    return "lädt mit %d kB/s" % (rate / 1000)


def _ohne_zeitstempel(z):
    """"2026-08-09 22:14:31 rest" -> "rest". Der Selbstlauf stempelt jede Zeile."""
    teile = z.split(" ", 2)
    if len(teile) == 3 and teile[0].count("-") == 2 and teile[1].count(":") == 2:
        return teile[2].strip()
    return z


def _ist_schrittkopf(z):
    """Eine Zeile wie "[19/53] Touch-Bruecke" — der Selbstlauf beginnt einen Posten."""
    a = z.find("[")
    b = z.find("]", a + 1)
    if a < 0 or b < 0:
        return False
    teile = z[a + 1:b].split("/")
    return len(teile) == 2 and all(t.strip().isdigit() for t in teile)


def taetigkeit_lesen(text=None):
    """Ein deutscher Satz darueber, was gerade laeuft. Leer = nichts bekannt."""
    if text is None:
        text = _log_schwanz()
    for zeile in reversed(text.splitlines()):
        z = _ohne_zeitstempel(zeile.strip())
        if not z:
            continue
        # AM KOPF DES LAUFENDEN POSTENS IST SCHLUSS. Alles darueber gehoert
        # zum VORIGEN Schritt — es zu zeigen waere eine Luege ueber die
        # Gegenwart. Am 09.08.2026 an der laufenden Box gemessen: waehrend
        # Schritt 19 (Touch-Bruecke) lief, stand hier "Richtet python3-smbus2
        # ein" aus Schritt 17. Der Titel des Postens steht ohnehin schon
        # darueber auf dem Schirm; lieber nichts sagen als etwas Falsches.
        if _ist_schrittkopf(z):
            return ""
        # Pakete holen: "Get:36 https://... trixie/main arm64 libfmt10 arm64 ..."
        if z.startswith("Get:"):
            teile = z.split()
            if len(teile) >= 5:
                return f"Lädt {teile[4]}"
            return "Lädt Pakete"
        for anfang, vorlage, ende in _TAETIGKEITEN:
            if anfang in z:
                rest = z.split(anfang, 1)[1].strip()
                name = rest.split(ende, 1)[0].strip() if ende in rest else rest
                if name:
                    return vorlage.format(name[:34])
    return ""


# ── FORTSCHRITT IM GRUNDSYSTEM ────────────────────────────────────────────
# DietPi nennt KEINE Gesamtzahl. Es gibt nur " Step: <Titel>" je Posten
# (dietpi-software) und " Phase: ..." (dietpi-update) — die "(1/4)" in
# seinen Zeilen sind Wiederholungszaehler, keine Wegmarken.
# Also wird gezaehlt und gegen eine GEMESSENE Erwartung gestellt: der
# vollstaendige Erstlauf dieser Box am 09.08.2026 hatte 67 Step-Zeilen.
# Das ist eine Messung, keine Zusage — deshalb steht "etwa" daneben und der
# Balken laeuft nie ganz voll. Ein Balken, der bei 100 % stehen bleibt und
# doch weiterarbeitet, luegt lauter als gar keiner.
GRUNDSYSTEM_SCHRITTE = 67
_ZAEHLER = {"pfad": None, "gelesen": 0, "zahl": 0, "rest": "",
            "geladen": 0, "eingerichtet": 0, "pakete": 0}


def _schritte_zaehlen(text):
    """Wieviele DietPi-Posten in diesem Stueck Protokoll beginnen."""
    return sum(1 for z in text.splitlines() if z.strip().startswith("Step: "))


def _pakete_lesen(text, stand):
    """(geladen, eingerichtet, gesamt) — apt sagt alles drei selbst.

    apt kuendigt seine Arbeit an:
        0 upgraded, 45 newly installed, 0 to remove and 0 not upgraded.
    numeriert danach jeden Download durch:
        Get:36 https://deb.debian.org/debian trixie/main arm64 chromium ...
    und richtet zum Schluss ein:
        Setting up chromium (1.2) ...
    Der Nenner steht damit fest, BEVOR es losgeht — geraten wird hier nichts.

    LADEN UND EINRICHTEN SIND ZWEI DURCHGAENGE mit DEMSELBEN Nenner. Wer sie
    zusammenzaehlt, landet bei 200 % — deshalb zwei Zaehler und nicht einer.
    """
    geladen, eingerichtet, gesamt = stand
    for z in text.splitlines():
        z = z.strip()
        if "newly installed" in z:
            # Die Zahl steht unmittelbar VOR den beiden Woertern.
            teile = z.split()
            try:
                gesamt = int(teile[teile.index("newly") - 1])
            except (ValueError, IndexError):
                continue
            geladen = eingerichtet = 0
        elif z.startswith("Get:"):
            try:
                geladen = max(geladen, int(z.split(":", 1)[1].split()[0]))
            except (ValueError, IndexError):
                pass
        elif z.startswith("Setting up "):
            eingerichtet += 1
    return geladen, eingerichtet, gesamt


def paket_stand():
    """"Paket 12 von 45" — oder leer, solange apt nichts angekuendigt hat."""
    gesamt = _ZAEHLER["pakete"]
    if not gesamt:
        return ""
    # Wird schon eingerichtet, ist das Laden vorbei — dann zaehlt der zweite
    # Durchgang, nicht der erste.
    jetzt = _ZAEHLER["eingerichtet"] or _ZAEHLER["geladen"]
    if not jetzt:
        return ""
    return f"Paket {min(jetzt, gesamt)} von {gesamt}"


def grundsystem_schritte(orte=None):
    """Wieviele Posten bisher gelaufen sind — inkrementell gelesen.

    NICHT JEDESMAL DIE GANZE DATEI: das Protokoll wird gegen Ende einige
    hundert Kilobyte gross, und der Schirm zeichnet im Sekundentakt. Gelesen
    wird nur, was seit dem letzten Blick dazugekommen ist.
    """
    orte = LOGORTE if orte is None else orte
    pfad = None
    zeit = -1.0
    for p in orte:
        try:
            if os.path.getsize(p) <= 0:
                continue
            m = os.path.getmtime(p)
        except OSError:
            continue
        if m > zeit:
            pfad, zeit = p, m
    if pfad is None:
        return _ZAEHLER["zahl"]
    try:
        groesse = os.path.getsize(pfad)
    except OSError:
        return _ZAEHLER["zahl"]
    # Andere Datei oder gekuerzt -> von vorn. Ein Aufraeumer, der auf 0
    # setzt, darf den Zaehler nicht in die Zukunft laufen lassen.
    if pfad != _ZAEHLER["pfad"] or groesse < _ZAEHLER["gelesen"]:
        _ZAEHLER.update({"pfad": pfad, "gelesen": 0, "zahl": 0, "rest": ""})
    if groesse == _ZAEHLER["gelesen"]:
        return _ZAEHLER["zahl"]
    try:
        with open(pfad, "rb") as f:
            f.seek(_ZAEHLER["gelesen"])
            neu = f.read().decode("utf-8", "replace")
    except OSError:
        return _ZAEHLER["zahl"]
    _ZAEHLER["gelesen"] = groesse
    stueck = _ZAEHLER["rest"] + neu
    # Die letzte Zeile kann mitten im Schreiben stehen — sie wird beim
    # naechsten Blick zu Ende gelesen, sonst zaehlt ein " Ste" als nichts
    # und die fertige Zeile spaeter gar nicht mehr.
    if not stueck.endswith("\n"):
        stueck, _, _ZAEHLER["rest"] = stueck.rpartition("\n")
    else:
        _ZAEHLER["rest"] = ""
    # EIN NEUER ANLAUF FAENGT WIEDER BEI NULL AN. Scheitert dietpi-software
    # und der Vorstart startet es erneut, laeuft DietPi seine Posten von
    # vorn — ein weiterzaehlender Balken waere dann bald bei 200 %.
    if "DietPi-Software laeuft" in stueck:
        _ZAEHLER["zahl"] = _schritte_zaehlen(stueck.rsplit("DietPi-Software laeuft", 1)[1])
    else:
        _ZAEHLER["zahl"] += _schritte_zaehlen(stueck)
    (_ZAEHLER["geladen"], _ZAEHLER["eingerichtet"],
     _ZAEHLER["pakete"]) = _pakete_lesen(
        stueck, (_ZAEHLER["geladen"], _ZAEHLER["eingerichtet"], _ZAEHLER["pakete"]))
    return _ZAEHLER["zahl"]


def freie_breite(schirm, y, hoehe, maskottchen, abstand=16):
    """Wieviel Breite auf Hoehe y frei ist, ohne MixPi zu ueberlaufen.

    MIXPI IST 256x256 UND SITZT UNTEN RECHTS — auf einem 800x480-Panel also
    von x=520 bis 776 und von y=200 bis 456, mehr als die halbe Bildhoehe.
    Der Fortschrittsbalken lief ueber die volle Breite und damit MITTEN
    HINDURCH; am Geraet sofort gesehen ("der prozent balken lief beim mixpi
    hinten durch"). Beim Nachmessen war es unsichtbar, weil die Attrappe im
    Test nur 160x160 gross war — seitdem misst der Test mit 256.
    """
    voll = schirm.b - 2 * RAND
    if maskottchen is None:
        return voll
    mx = schirm.b - RAND - maskottchen.b
    my = schirm.h - RAND - maskottchen.h
    if y + hoehe <= my:
        return voll
    return max(80, mx - RAND - abstand)


def umbrechen(schrift, text, breite, zeilen=2):
    """Text auf hoechstens `zeilen` Zeilen verteilen, die in `breite` passen.

    WOZU: Paketnamen sind lang, und MixPi nimmt rechts 256 Pixel weg. Ein
    hart abgeschnittenes "Installiert libpython3.13-st" sagt weniger als ein
    Name, der umbricht — genau das war der Wunsch. Was dann immer noch nicht
    passt, endet sichtbar auf "..." statt stillschweigend zu enden: sonst
    haelt man den halben Namen fuer den ganzen.
    """
    if not text or breite <= 0:
        return []
    je_zeichen = max(1, schrift.textbreite("M"))
    passt = max(1, breite // je_zeichen)
    aus, rest = [], " ".join(text.split())
    while rest and len(aus) < zeilen:
        if len(rest) <= passt:
            aus.append(rest)
            return aus
        schnitt = rest.rfind(" ", 0, passt + 1)
        if schnitt <= 0:
            schnitt = passt        # ein einzelnes langes Wort wird hart getrennt
        aus.append(rest[:schnitt].rstrip())
        rest = rest[schnitt:].lstrip()
    if rest and aus and len(aus[-1]) + 3 <= passt:
        # Das "..." kommt NUR dazu, wenn noch Platz ist. Es zu erzwingen
        # hiesse, dem letzten Namen drei Zeichen wegzunehmen — und aus
        # "libpython3.13-stdlib" wuerde "libpython3.13-std...". Genau der
        # Name soll aber ganz lesbar sein; der Hinweis auf mehr ist weniger
        # wert als das, worauf er hinweist.
        aus[-1] += "..."
    return aus


_DIENST = {"bis": 0.0, "da": False, "ziel": None}


def dienst_da(adresse, port, wartezeit=0.4, gueltig=5.0, jetzt=None):
    """Antwortet unter dieser Adresse ueberhaupt jemand? Gepuffert.

    WOZU: Der Fertig-Schirm zeigte einen QR auf den Eltern-Bereich, sobald
    der LETZTE Schritt gemeldet war — die Box startet danach aber noch
    einmal neu, und in diesem Fenster gibt es dort nichts. Am Geraet genau
    so gesehen: "mixpi ist fertig screen zeigt auf eine seite die nicht
    laed". Es ist derselbe Fehler wie beim Lauf-QR, den wir heute schon
    herausgenommen haben: ein Weg, der ins Leere fuehrt, ist schlimmer als
    keiner — beim zweiten Mal glaubt niemand mehr dem Schirm.

    Gepuffert, weil der Schirm im Sekundentakt zeichnet und ein Verbindungs-
    versuch je Bild die Anzeige ruckeln liesse.
    """
    t = time.time() if jetzt is None else jetzt
    ziel = (adresse, port)
    if _DIENST["ziel"] == ziel and t < _DIENST["bis"]:
        return _DIENST["da"]
    da = False
    if adresse:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(wartezeit)
        try:
            da = s.connect_ex((str(adresse), int(port))) == 0
        except (OSError, ValueError, OverflowError):
            da = False
        finally:
            s.close()
    _DIENST.update({"bis": t + gueltig, "da": da, "ziel": ziel})
    return da


def seit_lesen(pfad=PHASE_DATEI, jetzt=None):
    """Wie lange die Box schon in dieser Phase ist — als kurzer Satz."""
    try:
        alter = (time.time() if jetzt is None else jetzt) - os.path.getmtime(pfad)
    except OSError:
        return ""
    minuten = int(alter // 60)
    if minuten < 1:
        return ""
    return f"seit {minuten} Minute" + ("n" if minuten != 1 else "")


def hinweis_lesen(pfad="/run/mixpibox-einrichtung/hinweis"):
    """Die eine Zeile, die der Agent fuer den Schirm hinterlegt. Leer = keine."""
    try:
        with open(pfad, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def boxname(konfig=KONFIG):
    """Wie die Box heisst — aus IHRER Konfiguration, nicht aus dem Code.

    Die Regel stammt aus einem echten Fehler (llmwiki
    benennung-mixpibox-drei-toepfe): in der Kopfzeile stand fest verdrahtet
    „MuPiBox", waehrend die Box laut eigener Konfiguration laengst „MixPiBox"
    hiess. Aufgefallen war es niemandem, weil die beiden Stellen nie
    nebeneinander zu sehen sind.

    HIER IST EIN RUECKFALL TROTZDEM NOETIG, und das ist kein Verstoss gegen die
    Regel, sondern ihr Grenzfall: Dieser Schirm laeuft VOR der Installation.
    Dann gibt es die Konfiguration noch gar nicht — es ist nichts da, was man
    lesen koennte. Sobald sie existiert, gilt wieder ausschliesslich sie.
    """
    try:
        import json

        with open(konfig, encoding="utf-8") as f:
            name = json.load(f).get("mupibox", {}).get("host", "")
        if isinstance(name, str) and name.strip():
            return name.strip()
    except (OSError, ValueError):
        pass
    return NAME_RUECKFALL


def wlan_stand(lauf=None):
    """Haengt die Box an einem WLAN — und an welchem?

    Gibt den Netznamen zurueck, sonst None. Bewusst ueber `wpa_cli status`:
    dasselbe Werkzeug, mit dem der Assistent das WLAN einstellt, also dieselbe
    Wahrheit. Fehlt es (blanke Box ohne Funk), gibt es eben keine Auskunft —
    das ist kein Fehler.

    WOFUER: Nach einem WLAN-Wechsel per WPS ist die Seite auf dem Handy tot,
    weil die Box in einem anderen Netz haengt. Der Bildschirm ist dann die
    EINZIGE Stelle, an der jemand sehen kann, ob es geklappt hat. Deshalb
    steht hier nicht nur die neue Adresse, sondern auch, WOMIT sie verbunden
    ist — sonst raet man, ob die Adresse noch die alte ist.
    """
    starter = lauf or (
        lambda argv: subprocess.run(argv, capture_output=True, text=True, timeout=8)
    )
    try:
        namen = [
            n for n in sorted(os.listdir("/sys/class/net"))
            if os.path.isdir(f"/sys/class/net/{n}/wireless")
        ]
    except OSError:
        return None
    for n in namen:
        try:
            r = starter(["wpa_cli", "-i", n, "status"])
        except (OSError, subprocess.SubprocessError):
            continue
        if getattr(r, "returncode", 1) != 0:
            continue
        werte = {}
        for zeile in (r.stdout or "").splitlines():
            if "=" in zeile:
                k, _, v = zeile.partition("=")
                werte[k.strip()] = v.strip()
        if werte.get("wpa_state") == "COMPLETED" and werte.get("ssid"):
            return werte["ssid"]
    return None


AP_ARBEIT = "/run/mixpibox-einrichtung"
# Dieselbe Adresse, die einrichtung-ap.py der Schnittstelle gibt.
ADRESSE_AP = "192.168.4.1"


def ap_qr(ssid, psk):
    """Der Text hinter dem WLAN-QR — aus einrichtung-ap.py, damit es EINE
    Quelle gibt und nicht zwei, die auseinanderlaufen."""
    return ap.wifi_qr(ssid, psk)


def ap_stand(ordner=AP_ARBEIT):
    """Laeuft gerade das eigene WLAN der Box? -> (ssid, passwort) oder None.

    Die beiden Dateien legt `einrichtung-ap.py starten` an und raeumt sie beim
    Beenden weg — ihr Dasein IST die Auskunft. Kein zweiter Zustand, der mit
    der Wirklichkeit auseinanderlaufen koennte.
    """
    try:
        with open(os.path.join(ordner, "ssid"), encoding="utf-8") as f:
            ssid = f.read().strip()
        with open(os.path.join(ordner, "wlan-passwort"), encoding="ascii") as f:
            psk = f.read().strip()
    except OSError:
        return None
    return (ssid, psk) if ssid else None


# Der Agent legt sie beim Start JEDES Schritts an (tmpfs, ueberlebt keinen
# Neustart — und soll es auch nicht: ein Fortschritt von gestern waere eine
# Luege auf einem Schirm, dem man glauben soll).
FORTSCHRITT = "/run/mixpibox-einrichtung/fortschritt.json"


def fortschritt_lesen(pfad=FORTSCHRITT):
    """Wie weit ist der Installationslauf? -> dict oder None.

    WOZU ES DAS GIBT: Die Erstinstallation dauert 10 bis 20 Minuten. Am
    Bildschirm der Box war davon NICHTS zu sehen — die Boot-Animation ist
    laengst durch, und wer nicht per SSH mitlas, konnte „arbeitet" nicht von
    „haengt" unterscheiden. Genau davor sitzt aber jemand.

    STRENG PRUEFEN, statt zu vertrauen: die Datei kommt zwar vom eigenen
    Agenten, aber ein halb geschriebener oder alter Stand darf hier kein
    Zerrbild ergeben. Was nicht passt, wird verworfen — dann zeigt der Schirm
    eben seinen gewohnten Zustand, und das ist kein Schaden.
    """
    try:
        with open(pfad, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    nummer, gesamt = d.get("nummer"), d.get("gesamt")
    if not isinstance(nummer, int) or not isinstance(gesamt, int):
        return None
    if gesamt < 1 or nummer < 1 or nummer > gesamt:
        return None
    titel = d.get("titel")
    return {
        "nummer": nummer,
        "gesamt": gesamt,
        "titel": (titel if isinstance(titel, str) else "")[:60],
        "laeuft": bool(d.get("laeuft")),
        "exit": d.get("exit") if isinstance(d.get("exit"), int) else None,
        "abgebrochen": bool(d.get("abgebrochen")),
    }


def paircode_lesen(pfad):
    """Den Pair-Code des Agenten lesen — oder None.

    WARUM ER AUF DEN SCHIRM GEHOERT: Der Agent fuehrt beliebige Befehle als
    root aus. Damit ein Handy ihn erreicht, muss er ins LAN, und dann ist der
    sechsstellige Code die einzige Tuer. Steht er auf dem BILDSCHIRM DER BOX,
    kommt zur Kenntnis noch die koerperliche Anwesenheit dazu: einrichten kann
    nur, wer die Box sehen kann. Zusammen mit der Versuchsbremse im Agenten
    (PAIR_MAX_FEHLER) ist das die eigentliche Absicherung.

    Die Datei gehoert root und traegt 0600 — dieser Schirm laeuft ohnehin als
    root, sonst gaebe es keinen Framebuffer.
    """
    if not pfad:
        return None
    try:
        with open(pfad, encoding="ascii") as f:
            code = f.read().strip()
    except OSError:
        return None
    return code if code.isdigit() and 4 <= len(code) <= 12 else None


def maskottchen_laden(pfade=None):
    """Das erste lesbare Maskottchen — oder None. Fehlt es, laeuft der Schirm
    ohne, genau wie die Boot-Animation ohne Logo laeuft."""
    import zlib

    for pfad in pfade if pfade is not None else MASKOTTCHEN:
        try:
            return bs.Bild(os.path.normpath(pfad))
        except (OSError, ValueError, zlib.error):
            continue
    return None


# ── Zeichnen ────────────────────────────────────────────────────────────────
def fortschritt_malen(schirm, gross, klein, f, maskottchen=None):
    """Der Balken unten: welcher Schritt, von wie vielen, und woran gerade.

    DER BALKEN SPRINGT NIE ZURUECK — dieselbe Regel wie in der Boot-Animation.
    Ein Fortschritt, der zurueckgeht, ist schlimmer als keiner: er sagt dem
    Menschen davor, dass etwas schiefgeht, wo bloss neu gezaehlt wurde.
    Deshalb kommt die Zahl vom Controller, der das Rezept kennt, und wird hier
    nur gezeichnet.

    DIE BREITE ENDET VOR DEM MASKOTTCHEN. Rechnet man mit der vollen
    Schirmbreite, laeuft der Balken bei 100 Prozent unter MixPi durch — die
    ersten Fassungen sahen genau so aus.
    """
    n, g = f["nummer"], f["gesamt"]
    rechts = schirm.b - RAND
    if maskottchen is not None:
        rechts = min(rechts, schirm.b - RAND - maskottchen.b - 16)
    breite = max(120, rechts - RAND)

    hoehe = BALKEN_H
    unten = schirm.h - RAND - hoehe
    kopf = unten - klein.hoehe - 10

    # Kopfzeile: Zahl links, Name des Schritts daneben. Die Zahl zuerst, weil
    # sie die Frage beantwortet, die man aus zwei Metern Abstand stellt.
    zahl = f"Schritt {n} von {g}"
    klein.malen(schirm, zahl, RAND, kopf, AKZENT)
    platz = breite - klein.textbreite(zahl) - 16
    if f.get("titel") and platz > 60:
        # Selbst kuerzen statt hoffen: eine Zeile, die ueber den Balken
        # hinauslaeuft, wird nicht abgeschnitten, sondern malt ins Nichts.
        titel = f["titel"]
        while titel and klein.textbreite(titel) > platz:
            titel = titel[:-1]
        klein.malen(schirm, titel, RAND + klein.textbreite(zahl) + 16, kopf, GEDIMMT)

    # Der Balken: erst die Rinne, dann der gefuellte Teil.
    schirm.rechteck(RAND, unten, breite, hoehe, KARTE_DUNKEL, radius=hoehe // 2)
    # Ein GESCHEITERTER Schritt bleibt stehen und wird nicht uebermalt — er ist
    # das Einzige auf diesem Schirm, das jemanden zum Handeln bringen muss.
    gescheitert = (not f["laeuft"]) and (f.get("abgebrochen")
                                         or (f.get("exit") not in (None, 0)))
    farbe = (0xE0, 0x5A, 0x5A) if gescheitert else AKZENT
    voll = max(hoehe, int(breite * n / g))
    schirm.rechteck(RAND, unten, voll, hoehe, farbe, radius=hoehe // 2)

    if gescheitert:
        klein.malen(schirm, "Dieser Schritt ist gescheitert.", RAND,
                    kopf - klein.hoehe - 6, farbe)


def malen(schirm, gross, klein, url, adresse, port, name, maskottchen=None, paircode=None,
          wlan=None, ap=None, fortschritt=None, phase=""):
    schirm.fuellen(HINTERGRUND)

    # ── EINE GEMELDETE PHASE GEHT VOR ───────────────────────────────────────
    # Solange DietPi sein Grundsystem baut, gibt es keinen Lauf, keinen Code
    # und nichts zu tun — aber sehr viel Textausgabe, die niemanden etwas
    # angeht. Der Schirm sagt in dieser Zeit schlicht, was passiert.
    # EIN LAUFENDER SCHRITT SCHLAEGT DIE PHASE: er weiss mehr (Nummer, Titel,
    # Balken). Die Phase ist die Auskunft fuer die Zeit DAZWISCHEN.
    if phase in PHASEN and not (fortschritt and fortschritt.get("laeuft")):
        kopf, unter = PHASEN[phase]
        gross.malen(schirm, kopf.format(name=name), RAND, RAND, AKZENT)
        klein.malen(schirm, unter, RAND, RAND + gross.hoehe + 8, GEDIMMT)
        y = RAND + gross.hoehe + klein.hoehe + 26
        hz = hinweis_lesen()
        if hz:
            klein.malen(schirm, hz[:60], RAND, y, TEXT)
            y += klein.hoehe + 10
        # EIN BALKEN AUCH HIER. Das Grundsystem dauert 10 bis 20 Minuten, und
        # bisher stand in dieser Zeit nur ein Satz da. Die Zahl ist gezaehlt,
        # die Erwartung gemessen — deshalb "etwa", und deshalb laeuft der
        # Balken nie ganz voll: fertig meldet die Stufe, nicht die Schaetzung.
        if phase == "grundsystem":
            getan = grundsystem_schritte()
            if getan:
                anteil = min(0.97, float(getan) / float(GRUNDSYSTEM_SCHRITTE))
                breite = freie_breite(schirm, y, BALKEN_H, maskottchen)
                schirm.rechteck(RAND, y, breite, BALKEN_H, KARTE_DUNKEL)
                schirm.rechteck(RAND, y, int(breite * anteil), BALKEN_H, AKZENT)
                y += BALKEN_H + 12
                zeile = f"Schritt {getan} von etwa {GRUNDSYSTEM_SCHRITTE}"
                pz = paket_stand()
                if pz:
                    zeile += f", {pz}"
                klein.malen(schirm, zeile, RAND, y, TEXT)
                y += klein.hoehe + 10
        # DER LEBENDIGE TEIL: was gerade laeuft, und wie lange schon. Ohne
        # diese zwei Zeilen sieht ein Wartender zwanzig Minuten lang nicht,
        # ob die Box arbeitet — genau danach wurde gefragt.
        for teil in umbrechen(klein, taetigkeit_lesen(),
                              freie_breite(schirm, y, klein.hoehe, maskottchen)):
            klein.malen(schirm, teil, RAND, y, TEXT)
            y += klein.hoehe + 6
        sz = seit_lesen()
        if sz:
            klein.malen(schirm, sz, RAND, y, GEDIMMT)
        if maskottchen is not None:
            schirm.bild(maskottchen, schirm.b - RAND - maskottchen.b,
                        schirm.h - RAND - maskottchen.h)
        if adresse:
            klein.malen(schirm, f"Die Box ist unter {adresse} erreichbar.",
                        RAND, schirm.h - RAND - klein.hoehe, GEDIMMT)
        schirm.zeigen()
        return

    # DIE KOPFZEILE SAGT, WER GERADE DRAN IST. "einrichten" klingt nach einer
    # Aufgabe fuer den Leser — waehrend die Box selbst arbeitet, ist das
    # schlicht falsch, und der Betreiber hat es beim Zusehen bemerkt.
    laeuft_gerade = bool(fortschritt and fortschritt.get("laeuft"))
    fertig_jetzt = bool(fortschritt and not fortschritt.get("laeuft")
                        and fortschritt.get("nummer")
                        and fortschritt.get("nummer") == fortschritt.get("gesamt"))
    # FERTIG IST ERST, WENN DORT AUCH JEMAND ANTWORTET. Der letzte Schritt
    # ist gemeldet — die Box startet danach aber noch einmal neu, und in
    # diesem Fenster gibt es unter 8200 nichts. Wer dann scannt, landet auf
    # einer Seite, die nicht laedt.
    oberflaeche_da = dienst_da(adresse, APP_PORT) if fertig_jetzt else False
    if laeuft_gerade:
        kopf = f"{name} wird vorbereitet"
    elif fertig_jetzt and oberflaeche_da:
        kopf = f"{name} ist fertig"
    elif fertig_jetzt:
        kopf = f"{name} ist gleich fertig"
    else:
        kopf = f"{name} einrichten"
    gross.malen(schirm, kopf, RAND, RAND, AKZENT)
    # ZWEI GRUNDVERSCHIEDENE CODES, je nach Lage — und die Unterzeile muss das
    # sagen, sonst haelt jemand die Kamera drauf und wundert sich, dass sein
    # Handy nach einem WLAN fragt statt eine Seite zu oeffnen.
    unterzeile = ("Mit diesem WLAN verbinden" if ap
                  else "Weiter am Handy: Profile, Spotify, Jellyfin"
                  if fertig_jetzt and oberflaeche_da
                  else "" if fertig_jetzt
                  # WAEHREND DES LAUFS IST KEIN CODE DA — dann darf die Zeile
                  # auch nicht auffordern, die Kamera draufzuhalten. Genau das
                  # stand in der ersten Fassung, mitten ueber einem Schirm ohne
                  # QR; im Bild sofort zu sehen gewesen.
                  else "" if laeuft_gerade
                  else "Handy-Kamera auf den Code halten")
    klein.malen(schirm, unterzeile, RAND, RAND + gross.hoehe + 8, GEDIMMT)

    oben = RAND + gross.hoehe + klein.hoehe + 24
    # Unter der Karte bleibt eine Zeile frei — dort steht der Pair-Code (oder,
    # solange es keinen gibt, der Hinweis). Rechts passt beides nicht mehr hin,
    # ohne MixPi zu ueberlaufen; genau so sah die erste Fassung aus, der Satz
    # lief mitten durchs Maskottchen.
    fusszeile_h = (gross.hoehe if paircode else klein.hoehe) + 10
    if fortschritt:
        # DER LAUF BRAUCHT MEHR PLATZ ALS EINE ZEILE, und die Karte muss
        # entsprechend kleiner werden. Erste Fassung rechnete weiter mit der
        # alten Hoehe: die Zeile "Dieser Schritt ist gescheitert." lag dann
        # MITTEN AUF DER WEISSEN QR-KARTE — ausgerechnet im einzigen Zustand,
        # in dem jemand wirklich hinsehen muss.
        #   Kopfzeile + Abstand + Balken   (+ Fehlerzeile, wenn es eine gibt)
        fusszeile_h = klein.hoehe + 10 + BALKEN_H + 10
        if (not fortschritt.get("laeuft")) and (
                fortschritt.get("abgebrochen")
                or fortschritt.get("exit") not in (None, 0)):
            fusszeile_h += klein.hoehe + 6
    verfuegbar_h = schirm.h - oben - RAND - fusszeile_h

    # ── LAEUFT DIE INSTALLATION, GIBT ES NICHTS ZU TUN ──────────────────────
    # Der Betreiber, und er hat recht: "macht es sinn dann noch den qr code
    # anzuzeigen? verwirrt es nicht" — Ein QR fuehrt auf die Assistentenseite,
    # und die verlangt ueber das Heimnetz den Pair-Code. Waehrend eines Laufs
    # verdraengt der Fortschrittsbalken aber genau diesen Code (kein Platz).
    # Der QR versprach also einen Weg, an dessen Ende eine Abfrage stand, die
    # niemand beantworten konnte. Waehrend die Box arbeitet, ist ein Anruf
    # ohnehin unnoetig: sie macht alles allein.
    # Also: grosse, ruhige Fortschrittsanzeige, sonst nichts. Wo man
    # nachsehen KANN, steht klein darunter — als Auskunft, nicht als Einladung.
    if fortschritt and fortschritt.get("laeuft"):
        klein.malen(schirm, "Bitte warten – es ist nichts zu tun.",
                    RAND, oben, TEXT)
        z = oben + klein.hoehe + 18
        titel = str(fortschritt.get("titel") or "")[:44]
        nummer = fortschritt.get("nummer")
        gesamt = fortschritt.get("gesamt")
        if nummer and gesamt:
            # PROZENT DAZU: "Schritt 12 von 53" sagt wenig, wenn man nicht
            # weiss, ob 53 viel ist. Eine Zahl, die man mit dem Vortag
            # vergleichen kann, beruhigt mehr als zwei, die man umrechnen muss.
            hundert = int(round(100.0 * float(nummer) / float(gesamt)))
            gross.malen(schirm, f"Schritt {nummer} von {gesamt}, {hundert} %",
                        RAND, z, AKZENT)
            z += gross.hoehe + 10
        if titel:
            klein.malen(schirm, titel, RAND, z, TEXT)
            z += klein.hoehe + 14
        # Der Balken — er IST die Botschaft, aber er endet vor MixPi.
        breite = freie_breite(schirm, z, BALKEN_H, maskottchen)
        anteil = 0.0
        if nummer and gesamt:
            anteil = max(0.0, min(1.0, float(nummer) / float(gesamt)))
        schirm.rechteck(RAND, z, breite, BALKEN_H, KARTE_DUNKEL)
        if anteil > 0:
            schirm.rechteck(RAND, z, int(breite * anteil), BALKEN_H, AKZENT)
        z += BALKEN_H + 16
        # ── KEIN VERWEIS AUFS HANDY WAEHREND DES LAUFS ──────────────────────
        # Hier standen kurzzeitig Adresse, Schluessel und ein QR — bis der
        # Betreiber nachgesehen hat, wohin sie fuehren: "zum zusehen ist nur
        # die wlan konfiguration, es ergibt keinen mehrwert". Nachgeprueft und
        # belegt: die Assistentenseite ruft `/fortschritt` NIE ab, und ihr
        # eigener Bestaetigungstext sagt woertlich "der Fortschritt steht auf
        # ihrem Bildschirm". Der QR versprach also eine Ansicht, die es dort
        # gar nicht gibt — und nahm dafuer MixPi die Ecke weg, was sofort
        # auffiel ("es fehlt auch der mixpi").
        # DIESER Schirm IST die Fortschrittsanzeige. Ein Verweis auf etwas
        # Schlechteres macht ihn nicht besser. Die Adresse bleibt als reine
        # Auskunft unten stehen, ohne zum Hinsehen aufzufordern.
        #
        # WAS INNERHALB DES SCHRITTS PASSIERT. Ein Posten wie `mupibox:deps`
        # oder `mupibox:chromium` steht minutenlang scheinbar still — der
        # Betreiber hat genau danach gefragt. Der Schritt-Titel wechselt dann
        # nicht, das Protokoll aber sehr wohl, und das Tempo zeigt, dass
        # ueberhaupt etwas fliesst. Laufende Namen werden abgeschnitten, damit
        # nichts ins Maskottchen laeuft.
        # "Paket 12 von 45" — apt kuendigt den Nenner selbst an, das ist
        # keine Schaetzung. Innerhalb eines Postens, der zwanzig Minuten
        # dauert, ist das die einzige Zahl, die sich sichtbar bewegt.
        pz = paket_stand()
        if pz:
            klein.malen(schirm, pz, RAND, z, TEXT)
            z += klein.hoehe + 6
        # DER NAME MUSS GANZ LESBAR SEIN, notfalls ueber zwei Zeilen. Vorher
        # wurde bei 44 Zeichen hart geschnitten — bei "Installiert
        # libpython3.13-stdlib" fehlte dann genau der Teil, der etwas sagt.
        for teil in umbrechen(klein, taetigkeit_lesen(),
                              freie_breite(schirm, z, klein.hoehe, maskottchen)):
            klein.malen(schirm, teil, RAND, z, TEXT)
            z += klein.hoehe + 4
        vz = tempo_lesen()
        if vz:
            z += 2
            klein.malen(schirm, vz, RAND, z, GEDIMMT)
            z += klein.hoehe + 8
        if adresse:
            klein.malen(schirm, f"Die Box ist unter {adresse} erreichbar.",
                        RAND, z, GEDIMMT)
        # MIXPI GEHOERT AUF DIESEN SCHIRM. Er steht am laengsten von allen —
        # zehn bis zwanzig Minuten Grundsystem, danach der Lauf. Wenn irgendwo
        # zu sehen sein soll, dass hier eine MixPiBox entsteht und kein
        # Rechner rechnet, dann hier.
        if maskottchen is not None:
            schirm.bild(maskottchen, schirm.b - RAND - maskottchen.b,
                        schirm.h - RAND - maskottchen.h)
        schirm.zeigen()
        return

    # ── FERTIG GEMELDET, ABER NOCH NICHT DA ─────────────────────────────────
    # Kein QR, solange unter 8200 niemand antwortet. Ein Weg, der ins Leere
    # fuehrt, ist schlimmer als keiner: beim zweiten Mal glaubt niemand mehr
    # dem Schirm. Stattdessen der Satz, der wirklich gilt — es geht von
    # selbst weiter, und man muss nichts tun.
    if fertig_jetzt and not oberflaeche_da:
        klein.malen(schirm, "Die Oberfläche startet noch.", RAND, oben, TEXT)
        klein.malen(schirm, "Die Box startet dazu ein letztes Mal neu.",
                    RAND, oben + klein.hoehe + 10, GEDIMMT)
        if adresse:
            klein.malen(schirm, f"Die Box ist unter {adresse} erreichbar.",
                        RAND, schirm.h - RAND - klein.hoehe, GEDIMMT)
        if maskottchen is not None:
            schirm.bild(maskottchen, schirm.b - RAND - maskottchen.b,
                        schirm.h - RAND - maskottchen.h)
        schirm.zeigen()
        return

    if url is None and not ap:
        # Noch keine Adresse: sagen, WORAUF gewartet wird. Ein Schirm, der nur
        # schweigt, sieht aus wie einer, der haengt.
        klein.malen(schirm, "Warte auf eine Netzwerkverbindung …", RAND, oben, TEXT)
        klein.malen(
            schirm,
            "Ein Netzwerkkabel einzustecken genügt.",
            RAND,
            oben + klein.hoehe + 10,
            GEDIMMT,
        )
        if maskottchen is not None:
            schirm.bild(
                maskottchen,
                schirm.b - RAND - maskottchen.b,
                schirm.h - RAND - maskottchen.h,
            )
        schirm.zeigen()
        return

    # IM AP-FALL traegt der Code die WLAN-ZUGANGSDATEN, nicht eine Adresse:
    # das Handy ist ja noch gar nicht im selben Netz. Ein Adress-QR waere hier
    # nutzlos — man kaeme nirgends hin.
    matrix = qr.kodieren(ap_qr(*ap) if ap else url)
    skala, kante = qr_platzierung(len(matrix), verfuegbar_h, schirm.b // 2)

    # Helle Karte hinter dem Code. DER RUHEBEREICH IST TEIL DER KARTE: ein
    # QR-Code ohne hellen Rand wird von vielen Kameras gar nicht erst gefunden.
    kx, ky = RAND, oben
    schirm.rechteck(kx, ky, kante, kante, KARTE, radius=10)
    for zy, zeile in enumerate(matrix):
        for zx, wert in enumerate(zeile):
            if wert:
                schirm.rechteck(
                    kx + (zx + 4) * skala, ky + (zy + 4) * skala, skala, skala, KARTE_DUNKEL
                )

    # Rechts daneben: dieselbe Auskunft zum Abtippen, falls die Kamera zickt.
    #
    # UMLAUTE GEHEN JETZT: die Schrift bringt eine Unicode-Tabelle mit, und
    # `Schrift.zeichen()` benutzt sie seit dem 09.08.2026. Vorher war `ord()`
    # der Glyphindex — bei ü/ö/ä traf das zufaellig, bei ß (Glyph 159 statt
    # 223) und Ü (156 statt 220) nicht. Zeichen, die die Schrift NICHT kennt,
    # werden weiterhin zu „?"; ein Mittelpunkt „·" etwa gehoert nicht dazu.
    tx = kx + kante + 28
    ty = oben + 2
    if ap:
        ssid, psk = ap
        klein.malen(schirm, "Eigenes WLAN der Box:", tx, ty, GEDIMMT)
        ty += klein.hoehe + 8
        klein.malen(schirm, ssid[:24], tx, ty, AKZENT)
        ty += klein.hoehe + 10
        if psk:
            klein.malen(schirm, "Passwort:", tx, ty, GEDIMMT)
            ty += klein.hoehe + 2
            gross.malen(schirm, psk[:16], tx, ty, TEXT)
        else:
            # OFFENES NETZ: kein Passwort — die Tuer ist der Code unten links.
            # Das steht hier ausdruecklich, sonst sucht jemand ein Passwort,
            # das es nicht gibt.
            klein.malen(schirm, "Ohne Passwort – einfach", tx, ty, TEXT)
            ty += klein.hoehe + 4
            klein.malen(schirm, "verbinden.", tx, ty, TEXT)
        if maskottchen is not None:
            schirm.bild(maskottchen, schirm.b - RAND - maskottchen.b,
                        schirm.h - RAND - maskottchen.h)
        # Die Hinweiszeile des Agenten ("Verbinde mit ...", "Passwort stimmte
        # wohl nicht") — der Schirm ist das EINZIGE, was den Netzwechsel
        # ueberlebt, also gehoert die Rueckmeldung hierher.
        hz = hinweis_lesen()
        if hz:
            klein.malen(schirm, hz[:60], RAND,
                        schirm.h - RAND - 2 * klein.hoehe - 8, AKZENT)
        klein.malen(schirm, f"Danach: http://{ADRESSE_AP}:{port}", RAND,
                    schirm.h - RAND - klein.hoehe, GEDIMMT)
        schirm.zeigen()
        return
    klein.malen(schirm, "Oder im Browser eingeben:", tx, ty, GEDIMMT)
    ty += klein.hoehe + 10
    # Adresse MIT Port in einer Zeile: der Agent liefert die Seite auch unter
    # "/" aus, `/einrichtung` muss also niemand abtippen. Das spart die dritte
    # Zeile — und die wird gleich fuer die WLAN-Auskunft gebraucht.
    # DER PORT MUSS ZUM CODE PASSEN. Ist die Vorbereitung durch, zeigt der QR
    # auf die BOX (8200, Eltern-Bereich) — die Zeile daneben nannte trotzdem
    # weiter den Assistenten (8099). Wer abtippt statt scannt, landete damit
    # woanders als wer scannt. Im Bild sofort zu sehen, in keinem Test.
    gross.malen(schirm, f"{adresse}:{APP_PORT if fertig_jetzt else port}",
                tx, ty, TEXT)
    ty += gross.hoehe + 8
    if wlan:
        # NACH EINEM WPS-WECHSEL IST DAS DIE WICHTIGSTE ZEILE AUF DEM SCHIRM.
        # Die Seite auf dem Handy ist dann tot, weil die Box in einem anderen
        # Netz haengt — hier steht, ob es geklappt hat und mit WELCHEM Netz.
        # Ohne das raet man, ob die Adresse daneben noch die alte ist.
        klein.malen(schirm, "Verbunden mit", tx, ty, GEDIMMT)
        ty += klein.hoehe + 2
        klein.malen(schirm, wlan[:22], tx, ty, AKZENT)
    else:
        klein.malen(schirm, "Verbunden ueber Kabel", tx, ty, GEDIMMT)

    # MixPi unten rechts — Schmuck, nie Auskunft: fehlt das Bild, fehlt nichts.
    if maskottchen is not None:
        schirm.bild(
            maskottchen,
            schirm.b - RAND - maskottchen.b,
            schirm.h - RAND - maskottchen.h,
        )

    # ── Unten: der Lauf, sobald einer da ist ────────────────────────────────
    # ER VERDRAENGT DEN PAIR-CODE, und das ist richtig: laeuft die Installation,
    # hat der Code seine Aufgabe erfuellt (jemand ist verbunden). Was jetzt
    # zaehlt, ist die Frage, vor der man wirklich sitzt — arbeitet das Ding
    # noch, und wie lange dauert es?
    if fortschritt:
        fortschritt_malen(schirm, gross, klein, fortschritt, maskottchen)
        schirm.zeigen()
        return

    # Unter der Karte: der Pair-Code. Er ist die Tuer zum Agenten und steht
    # deshalb gross und in der Akzentfarbe — wer die Box sieht, darf sie
    # einrichten, sonst niemand.
    if paircode:
        fy = schirm.h - RAND - gross.hoehe
        gross.malen(schirm, f"Code: {paircode}", RAND, fy, AKZENT)
        klein.malen(
            schirm,
            "am Handy eingeben",
            RAND + gross.textbreite(f"Code: {paircode}") + 16,
            fy + (gross.hoehe - klein.hoehe) // 2,
            GEDIMMT,
        )
    else:
        klein.malen(
            schirm,
            "Handy und Box im selben Netz.",
            RAND,
            schirm.h - RAND - klein.hoehe,
            GEDIMMT,
        )
    schirm.zeigen()


def main():
    port = 8099   # dieselbe Vorgabe wie der Agent (agent.py --port)
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    paircode_datei = ""
    if "--paircode" in sys.argv:
        paircode_datei = sys.argv[sys.argv.index("--paircode") + 1]
    einmal = "--einmal" in sys.argv

    try:
        schirm = bs.Schirm()
    except (OSError, RuntimeError) as e:
        # Kein Framebuffer (etwa am Entwicklungsrechner): still enden.
        print(f"kein Bildschirm: {e}", file=sys.stderr)
        return 0

    gross = bs.Schrift(bs.SCHRIFT_GROSS)
    klein = bs.Schrift(bs.SCHRIFT_KLEIN)
    maskottchen = maskottchen_laden()
    name = boxname()

    ende = time.time() + MAX_LAUFZEIT
    with bs.KonsoleAus():
        while True:
            adresse = beste_adresse(adressen_lesen())
            fs = fortschritt_lesen()
            # IST DIE VORBEREITUNG DURCH, zeigt der Code auf die BOX selbst —
            # dort geht es weiter (Profile, Spotify, Jellyfin). Vorher auf den
            # Assistenten, der das Netz besorgt.
            fertig = bool(fs and not fs.get("laeuft") and fs.get("nummer")
                          and fs.get("nummer") == fs.get("gesamt"))
            if adresse:
                url = app_url(adresse) if fertig else adresse_zu_url(adresse, port)
            else:
                url = None
            # EIN Blick, nicht zwei: `fs` oben und ein zweites Lesen hier
            # koennten auseinanderfallen, wenn der Lauf genau dazwischen endet
            # — dann zeigte der Code schon die Box und die Anzeige noch den
            # Balken. (Gelesen wird bei jedem Durchgang neu, weil der Agent
            # die Datei erst anlegt, wenn sein Socket steht.)
            lauf = fs
            phase = phase_lesen()
            malen(
                schirm, gross, klein, url, adresse, port, name, maskottchen,
                paircode_lesen(paircode_datei), wlan_stand(), ap_stand(),
                lauf, phase,
            )
            # SOLANGE EIN SCHRITT LAEUFT, WIRD DIE FRIST NACHGESCHOBEN. Die
            # halbe Stunde reicht fuers Einrichten, NICHT fuer die Installation
            # (10 bis 20 Minuten, und davor liegt das Einrichten). Ohne das
            # ginge der Schirm ausgerechnet in dem Moment aus, in dem er zum
            # ersten Mal etwas zu sagen hat — und die Box saehe aus wie
            # abgestuerzt.
            if lauf and lauf.get("laeuft"):
                ende = max(ende, time.time() + MAX_LAUFZEIT)
            # UND WENN ES FERTIG IST, BLEIBT ER STEHEN: der Code fuehrt jetzt
            # zu Profilen, Spotify und Jellyfin. Ein Schirm, der diese
            # Einladung nach zehn Minuten wegnimmt, laesst jemanden zurueck,
            # der gerade erst Zeit gefunden hat.
            if fertig:
                ende = max(ende, time.time() + MAX_LAUFZEIT)
            # Auch eine gemeldete Phase haelt den Schirm wach: das Grundsystem
            # braucht laenger als eine halbe Stunde, wenn der Spiegel traege ist.
            if phase in PHASEN:
                ende = max(ende, time.time() + MAX_LAUFZEIT)
            if einmal or time.time() > ende:
                break
            time.sleep(TAKT_S)
    return 0


if __name__ == "__main__":
    sys.exit(main())
