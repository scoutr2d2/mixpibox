#!/usr/bin/env python3
"""
Tests fuer den Einrichtungsbildschirm (tools/einrichtung-schirm.py).

KEIN FRAMEBUFFER NOETIG — wie bei splash_test.py. Geprueft wird, was ohne
Bildschirm entschieden wird: welche Adresse aufs Bild gehoert, wie gross der
QR-Code gezeichnet wird, wie die Box heisst und ob das Maskottchen gefunden
wird.

WAS DIESER TEST NICHT LEISTET, damit sich niemand darauf verlaesst: Er malt
nichts. Ob die Aufteilung auf 800x480 hinter der DSI-Anzeige gut aussieht,
sagt nur die Box. Er prueft aber das, woran ein Einrichtungsbildschirm
WIRKLICH scheitert — dass der Code zu klein zum Abfotografieren ist.

  python3 tests/einrichtung_schirm_test.py
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

_sp = importlib.util.spec_from_file_location(
    "es", os.path.join(REPO, "tools", "einrichtung-schirm.py")
)
es = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(es)
import qr  # noqa: E402

ok = bad = uebersprungen = 0


def pruefe(bedingung, was, hinweis=""):
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


print("── 1. Welche Adresse gehoert aufs Bild?")
pruefe(es.beste_adresse([]) is None, "ohne Netz: keine Adresse")
pruefe(
    es.beste_adresse([("wlan0", "192.168.1.5")]) == "192.168.1.5",
    "eine einzige wird genommen",
)
pruefe(
    es.beste_adresse([("wlan0", "192.168.1.5"), ("eth0", "192.168.1.9")]) == "192.168.1.9",
    "Kabel schlaegt Funk",
)
pruefe(
    es.beste_adresse([("eth0", "169.254.7.7"), ("wlan0", "192.168.1.5")]) == "192.168.1.5",
    "echte Adresse schlaegt Eigenzuweisung — auch wenn die am Kabel haengt",
)
pruefe(
    es.beste_adresse([("eth0", "169.254.7.7")]) == "169.254.7.7",
    "Eigenzuweisung ist besser als nichts",
)

print("── 2. Wie gross wird der Code gezeichnet?")
# Die Hoehe, die auf der Anzeige der Box (800x480) wirklich uebrig bleibt:
#   480 - Rand(24) - Kopfzeile(30) - Unterzeile(24) - Abstand(24)
#       - Fusszeile(24+10) - Rand(24)  =  320
# Ausgerechnet und nicht geschaetzt, weil genau daran der Code zu klein wird.
PLATZ_H = 320
PLATZ_B = 400
skala, kante = es.qr_platzierung(29, PLATZ_H, PLATZ_B)
pruefe(isinstance(skala, int) and skala >= 1, f"Skala ist eine ganze Zahl ({skala})")
pruefe(kante <= PLATZ_H, f"passt in die Hoehe ({kante} <= {PLATZ_H})")
pruefe(kante == (29 + 8) * skala, "Kante entspricht Feldern plus Ruhebereich")
eng, _ = es.qr_platzierung(29, 40, 400)
pruefe(eng >= 1, "auch bei absurd wenig Platz mindestens Skala 1 (nie 0)")

print("── 3. Ist der Code auf dem echten Schirm noch abzufotografieren?")
# DIE FRAGE, an der so ein Bildschirm wirklich scheitert.
url = "http://192.168.178.169:8098/einrichtung"
matrix = qr.kodieren(url)
skala, kante = es.qr_platzierung(len(matrix), PLATZ_H, PLATZ_B)
pruefe(skala >= 4, f"mindestens 4 Punkte je Feld (hier {skala})", "darunter wird es heikel")
if not shutil.which("zbarimg"):
    uebersprungen += 1
    print("  uebersprungen — zbarimg ist nicht installiert")
else:
    with tempfile.TemporaryDirectory() as ordner:
        pfad = os.path.join(ordner, "schirm.pbm")
        with open(pfad, "wb") as f:
            f.write(qr.als_pbm(matrix, rand=4, skala=skala))
        lauf = subprocess.run(
            ["zbarimg", "--quiet", "--raw", pfad], capture_output=True, text=True
        )
        pruefe(
            lauf.stdout.rstrip("\n") == url,
            f"in der Groesse des Schirms lesbar ({kante}x{kante} Punkte)",
            f"gelesen: {lauf.stdout!r}",
        )

print("── 4. Wie heisst die Box?")
with tempfile.TemporaryDirectory() as ordner:
    fehlt = os.path.join(ordner, "gibtsnicht.json")
    pruefe(
        es.boxname(fehlt) == "MixPiBox",
        "ohne Konfiguration der Rueckfall — VOR der Installation gibt es nichts zu lesen",
    )
    da = os.path.join(ordner, "konfig.json")
    with open(da, "w", encoding="utf-8") as f:
        json.dump({"mupibox": {"host": "Kinderzimmer"}}, f)
    pruefe(es.boxname(da) == "Kinderzimmer", "mit Konfiguration deren Name — nie eine Konstante")
    leer = os.path.join(ordner, "leer.json")
    with open(leer, "w", encoding="utf-8") as f:
        json.dump({"mupibox": {"host": "   "}}, f)
    pruefe(es.boxname(leer) == "MixPiBox", "ein leerer Name ist kein Name")
    kaputt = os.path.join(ordner, "kaputt.json")
    with open(kaputt, "w", encoding="utf-8") as f:
        f.write("{kein json")
    pruefe(es.boxname(kaputt) == "MixPiBox", "eine kaputte Konfiguration wirft den Schirm nicht um")

print("── 5. Das Maskottchen reist mit")
# Auf einer frischen Box gibt es NewDesign/ nicht — deshalb liegt MixPi im
# Installer. Faellt diese Kopie weg, laeuft der Schirm ohne Bild, aber der
# Test soll es merken.
eigen = os.path.join(REPO, "dateien", "mixpi-hoert.png")
pruefe(os.path.exists(eigen), "dateien/mixpi-hoert.png ist da")
bild = es.maskottchen_laden()
pruefe(bild is not None, "wird gefunden und gelesen")
if bild is not None:
    pruefe(bild.b == 256 and bild.h == 256, f"256x256 ({bild.b}x{bild.h})")
pruefe(
    es.maskottchen_laden(["/gibt/es/nicht.png"]) is None,
    "fehlt es ueberall, ist das kein Fehler — nur kein Bild",
)

print("── 6. Der Pair-Code vom Agenten")
# Er ist die Tuer zu einem Programm, das beliebige Befehle als root ausfuehrt.
# Auf dem Schirm der Box kommt zur Kenntnis die koerperliche Anwesenheit dazu:
# einrichten kann nur, wer die Box SEHEN kann.
with tempfile.TemporaryDirectory() as ordner:
    pruefe(es.paircode_lesen("") is None, "ohne Pfad kein Code")
    pruefe(
        es.paircode_lesen(os.path.join(ordner, "gibtsnicht")) is None,
        "fehlende Datei ist kein Fehler — der Agent legt sie erst an, wenn sein Socket steht",
    )
    gut = os.path.join(ordner, "code")
    with open(gut, "w") as f:
        f.write("417382\n")
    pruefe(es.paircode_lesen(gut) == "417382", "Code wird gelesen und beschnitten")
    muell = os.path.join(ordner, "muell")
    with open(muell, "w") as f:
        f.write("rm -rf /\n")
    pruefe(
        es.paircode_lesen(muell) is None,
        "was keine Ziffernfolge ist, kommt nicht auf den Schirm",
    )
    lang = os.path.join(ordner, "lang")
    with open(lang, "w") as f:
        f.write("1" * 40)
    pruefe(es.paircode_lesen(lang) is None, "und auch nichts absurd Langes")

print("── 7. Die Adresse fuer den Browser")
pruefe(
    es.adresse_zu_url("192.168.1.9", 8098) == "http://192.168.1.9:8098/einrichtung",
    "Adresse wird zur vollstaendigen URL",
)


# ── Drei Lagen, drei Botschaften — der Betreiber beim Zusehen: ─────────────
# "macht es sinn dann noch den qr code anzuzeigen? verwirrt es nicht"
# Waehrend der Vorbereitung fuehrte der QR auf eine Seite, die den Pair-Code
# verlangte — und genau den verdraengte der Fortschrittsbalken vom Schirm.
# Ein Weg, der ins Nichts fuehrt, ist schlimmer als keiner.
# ══ UND SEIT DEM 10.08.2026 UEBER HTTPS ════════════════════════════════════
# Betreiber: „und gleich mit dem qr die https seite öffnen der zwischen schritt
# ist unnötig." Der Grund ist nicht Bequemlichkeit: Spotify nimmt seit 2025 nur
# noch HTTPS oder das Loopback-Literal als Rueckweg, und der Rueckweg muss
# DIESELBE Herkunft haben wie die Seite, auf der die Anmeldung beginnt
# (sessionStorage gilt je Herkunft — daran ist E22/R4 schon einmal
# gescheitert). Fuehrte der Code weiter auf http://…:8200, waere jede
# Spotify-Anmeldung vom Handy wieder ein Kopierweg.
pruefe(es.app_url("192.168.178.55") == "https://192.168.178.55:8443/",
       "der Code fuehrt am Ende auf die BOX, und zwar ueber HTTPS")
pruefe(es.adresse_zu_url("192.168.178.55", 8099).endswith("/einrichtung"),
       "  vorher auf den Assistenten, der das Netz besorgt")
pruefe(es.adresse_zu_url("192.168.178.55", 8099).startswith("http://"),
       "  und DER bleibt http — waehrend der Einrichtung laeuft noch kein TLS")
pruefe(es.APP_TLS_PORT == 8443, "  der TLS-Port der Oberflaeche")
pruefe(es.APP_PORT == 8200, "  der einfache Port bleibt bekannt (Rueckfall, Anzeige)")

import inspect as _i
_m = _i.getsource(es.malen)
pruefe('fortschritt.get("laeuft")' in _m and "return" in _m,
       "waehrend des Laufs endet malen() frueh — kein QR")
pruefe("wird vorbereitet" in _m,
       "  und die Kopfzeile sagt 'wird vorbereitet', nicht 'einrichten'")
pruefe("ist fertig" in _m, "am Ende: 'ist fertig'")
pruefe("Profile, Spotify, Jellyfin" in _m,
       "  mit der Unterzeile, die sagt, was jetzt drankommt")
_mn = _i.getsource(es.main)
pruefe(_mn.count("fortschritt_lesen()") == 1,
       "der Lauf wird EINMAL gelesen — zwei Blicke koennten auseinanderfallen")


# ── Die abgetippte Adresse muss dorthin fuehren wie der Code ───────────────
# Im Bild aufgefallen, von keinem Test: der QR zeigte am Ende schon auf die
# Box (8200), die Zeile daneben nannte weiter den Assistenten (8099). Wer
# abtippt statt scannt, landete woanders als wer scannt.
_m2 = _i.getsource(es.malen)
pruefe("APP_PORT if fertig_jetzt" in _m2,
       "die Adresszeile nennt am Ende den Port der Oberflaeche")

# ── Die Phasen: der Schirm deckt auch DietPis Textwand zu ──────────────────
# Der Betreiber wuenscht eine durchgehende Kette: QR -> Grundsystem ->
# Vorbereitung -> Profile/Spotify/Jellyfin -> Start. Dazwischen darf nie
# DietPis Ausgabe durchschlagen.
pruefe(set(es.PHASEN) == {"grundsystem", "neustart", "vorbereitung",
                          "netzschwach"},
       "vier Phasen fuer die Zeit zwischen den Schirmen")
# "netzschwach" ist der einzige Zustand, in dem ein Mensch etwas tun KANN —
# also muss der Text auch sagen, was. Ohne diesen Satz bliebe nur ein
# Achselzucken auf dem Bildschirm.
pruefe("Router" in es.PHASEN["netzschwach"][1],
       "bei schwachem Netz steht der eine Rat da, der hilft")
pruefe(es.phase_lesen("/gibt/es/nicht") == "",
       "keine Phasendatei -> leer, kein Fehler")

# ── WAS GERADE PASSIERT ──────────────────────────────────────────────────
# Alle Zeilen unten sind ECHTE Ausgabe von der Box vom 09.08.2026 — keine
# erfundenen Muster. Der Schirm stand damals zwanzig Minuten unveraendert da,
# waehrend die Box erst hing und dann wieder lief; von aussen sah beides
# gleich aus.
_echt = """
[  OK  ] DietPi-Software | chmod 0775 /mnt/dietpi_userdata/Music
 Step: Installing OpenSSH Client: Feature-rich SSH, SFTP and SCP client
[ INFO ] DietPi-Software | APT install openssh-client, please wait...
Get:36 https://deb.debian.org/debian trixie/main arm64 device-tree-compiler arm64 1.7.2-2+b1 [226 kB]
"""
pruefe(es.taetigkeit_lesen(_echt) == "Lädt device-tree-compiler",
       "die juengste Zeile gewinnt: das Paket, das gerade kommt")
pruefe(es.taetigkeit_lesen(" Step: Installing OpenSSH Client: Feature-rich SSH")
       == "Installiert OpenSSH Client",
       "aus DietPis Schritt wird ein deutscher Satz")
pruefe(es.taetigkeit_lesen("[ INFO ] APT install openssh-client, please wait...")
       == "Installiert openssh-client",
       "auch die APT-Zeile wird uebersetzt")
pruefe(es.taetigkeit_lesen("Setting up libfmt10:arm64 (10.1.1+ds1-4)")
       == "Richtet libfmt10:arm64 ein",
       "und das Einrichten einzelner Pakete")
# Kein Maschinentext durchreichen: was wir nicht uebersetzen koennen, zeigen
# wir gar nicht. "Reading package lists..." hat auf diesem Schirm nichts zu
# suchen — der Betreiber wollte ausdruecklich keinen Code sehen.
pruefe(es.taetigkeit_lesen("Reading package lists...\nBuilding dependency tree...")
       == "",
       "unuebersetzbare englische Ausgabe wird verschwiegen")
pruefe(es.taetigkeit_lesen("") == "", "kein Protokoll -> leer, kein Fehler")

# Der Selbstlauf stempelt jede Zeile und schreibt eigene Schrittkoepfe.
# ECHTE Zeilen von der Box vom 09.08.2026, waehrend Schritt 19 lief:
_lauf = """2026-08-09 22:13:01 Setting up python3-smbus2 (0.5.0-1) ...
2026-08-09 22:14:31 [18/53] Display: 5" DSI 800x480 (volles KMS)
2026-08-09 22:14:31   display configured
2026-08-09 22:14:31 [19/53] Touch-Brücke (Bildschirm reagiert sonst nicht)"""
pruefe(es.taetigkeit_lesen(_lauf) == "",
       "am Kopf des laufenden Postens ist Schluss — keine alte Zeile zeigen")
_mitten = """2026-08-09 22:10:01 [12/53] Abhängigkeiten
2026-08-09 22:11:02 Get:36 https://deb.debian.org/debian trixie/main arm64 chromium arm64 1.2 [226 kB]"""
pruefe(es.taetigkeit_lesen(_mitten) == "Lädt chromium",
       "was INNERHALB des Postens laeuft, wird gezeigt")

# ── TEMPO ────────────────────────────────────────────────────────────────
# "ist jetzt auch schon wieder ewig dran" — ob die Box laedt oder haengt,
# steht als Zahl im Kernel. Der erste Blick muss schweigen: ohne Vergleich
# gibt es keine Geschwindigkeit.
es._TEMPO.clear()
pruefe(es.tempo_lesen(jetzt=100.0, gelesen=1000) == "",
       "erster Blick schweigt — noch kein Vergleich moeglich")
pruefe(es.tempo_lesen(jetzt=102.0, gelesen=2400000) == "lädt mit 1,2 MB/s",
       "2,4 MB in 2 s sind 1,2 MB/s — mit Komma, nicht mit Punkt")
pruefe(es.tempo_lesen(jetzt=104.0, gelesen=2400500) == "",
       "bei Stillstand wird geschwiegen statt '0 kB/s' zu flackern")
es._TEMPO.clear()
es.tempo_lesen(jetzt=200.0, gelesen=9000000)
pruefe(es.tempo_lesen(jetzt=202.0, gelesen=5) == "",
       "zurueckgesetzter Zaehler ergibt keine Fantasiezahl")
es._TEMPO.clear()
pruefe(es.seit_lesen("/gibt/es/nicht") == "",
       "keine Phasendatei -> keine Zeitangabe")

# ── FORTSCHRITT IM GRUNDSYSTEM ───────────────────────────────────────────
# DietPi nennt keine Gesamtzahl; gezaehlt werden seine " Step: "-Zeilen.
# Gelesen wird inkrementell, weil der Schirm im Sekundentakt zeichnet und
# das Protokoll gegen Ende einige hundert Kilobyte gross ist.
import tempfile as _tf  # noqa: E402

_ordner = _tf.mkdtemp()
_pfad = os.path.join(_ordner, "vorstart.log")


def _anhaengen(text):
    with open(_pfad, "a", encoding="utf-8") as f:
        f.write(text)
    return es.grundsystem_schritte([_pfad])


es._ZAEHLER.update({"pfad": None, "gelesen": 0, "zahl": 0, "rest": ""})
pruefe(_anhaengen(" Step: Installing A: x\n Step: Installing B: y\n") == 2,
       "zwei Posten gezaehlt")
pruefe(_anhaengen(" Step: Installing C: z\n") == 3,
       "der naechste zaehlt weiter — nicht von vorn gelesen")
# Eine Zeile, die noch im Schreiben ist, darf weder doppelt noch gar nicht
# zaehlen: beim naechsten Blick wird sie zu Ende gelesen.
pruefe(_anhaengen(" Step: Installing D") == 3, "halbe Zeile zaehlt noch nicht")
pruefe(_anhaengen(": w\n") == 4, "und beim naechsten Blick genau einmal")
# Ein neuer Anlauf von dietpi-software beginnt bei null — sonst stuende der
# Balken nach dem zweiten Versuch bei ueber 100 %.
pruefe(_anhaengen("DietPi-Software laeuft (10-20 Minuten, Geduld) ...\n"
                  " Step: Installing A: x\n") == 1,
       "ein neuer Anlauf faengt wieder bei null an")
# Kuerzt ein Aufraeumer die Datei, darf der Zaehler nicht in die Zukunft
# laufen — genau das tat das Lauf-Protokoll am 09.08.2026 (230 KB -> 0).
open(_pfad, "w").close()
open(_pfad, "a", encoding="utf-8").write(" Step: Installing A: x\n")
pruefe(es.grundsystem_schritte([_pfad]) == 1,
       "gekuerzte Datei setzt den Zaehler zurueck")
es._ZAEHLER.update({"pfad": None, "gelesen": 0, "zahl": 0, "rest": ""})
pruefe(es.grundsystem_schritte(["/gibt/es/nicht"]) == 0,
       "kein Protokoll -> 0, kein Fehler")

# ── DER LAUFSCHIRM WIRD WIRKLICH GEZEICHNET ──────────────────────────────
# Nicht im Quelltext nachlesen, sondern malen lassen und nachmessen. Der
# Schluessel MUSS waehrend des Laufs dastehen: ohne ihn antwortet die Seite
# im Heimnetz mit "unauthorized" und bleibt ein leeres Geruest (am
# 09.08.2026 an der laufenden Box gemessen). Und der QR darf dabei nirgends
# in den Text laufen — ein halb verdeckter Code wird von keiner Kamera
# gefunden.
class _Schrift:
    def __init__(self, h):
        self.hoehe = h
        self.breite = h * 6 // 10

    def textbreite(self, s):
        return len(s) * self.breite

    def malen(self, schirm, text, x, y, farbe):
        schirm.texte.append((x, y, x + self.textbreite(text), text))


class _Schirm:
    def __init__(self, b=800, h=480):
        self.b, self.h, self.texte, self.kaesten, self.bilder = b, h, [], [], []

    def fuellen(self, f):
        pass

    def rechteck(self, x, y, b, h, f, radius=0):
        self.kaesten.append((x, y, b, h))

    def bild(self, bild, x, y):
        self.bilder.append((x, y))

    def zeigen(self):
        pass


class _Bild:
    # DIE ECHTE GROESSE, 256x256 (dateien/mixpi-hoert.png), unskaliert
    # gezeichnet. Die erste Fassung dieses Tests nahm 160 an — und war damit
    # blind fuer genau den Fehler, den der Betreiber sofort sah: der Balken
    # lief hinter MixPi durch. Eine Attrappe, die kleiner ist als das Echte,
    # prueft die Enge weg, um die es geht.
    b = h = 256


def _laufschirm(paircode="7F3K2Q"):
    s = _Schirm()
    es.malen(s, _Schrift(34), _Schrift(18), "http://192.168.178.55:8099",
             "192.168.178.55", 8099, "MixPiBox", maskottchen=_Bild(),
             paircode=paircode,
             fortschritt={"laeuft": True, "nummer": 4, "gesamt": 53,
                          "titel": "mupibox:deps"})
    return s


_s = _laufschirm()
pruefe(any("4 von 53, 8 %" in t for *_, t in _s.texte),
       "Prozent dazu — '4 von 53' allein sagt wenig")
pruefe(any("mupibox:deps" in t for *_, t in _s.texte),
       "und der Titel des Postens, der gerade dran ist")
_balken = [k for k in _s.kaesten if k[3] == es.BALKEN_H]
pruefe(len(_balken) == 2 and _balken[1][2] < _balken[0][2],
       "ein Balken, teilweise gefuellt")

# KEIN VERWEIS AUFS HANDY. Die Assistentenseite ruft /fortschritt nie ab und
# sagt in ihrem eigenen Text "der Fortschritt steht auf ihrem Bildschirm" —
# ein QR dorthin verspricht eine Ansicht, die es nicht gibt. Nachgesehen und
# bestaetigt vom Betreiber: "zum zusehen ist nur die wlan konfiguration".
pruefe(not [k for k in _s.kaesten if k[2] == k[3] and k[2] >= 96],
       "kein QR waehrend des Laufs — er fuehrte auf den WLAN-Assistenten")
pruefe(not any("Zusehen" in t for *_, t in _s.texte),
       "und keine Einladung zum Zusehen, die ins Leere fuehrt")
pruefe(any("192.168.178.55 erreichbar" in t for *_, t in _s.texte),
       "die Adresse bleibt als reine Auskunft stehen")
# MixPi gehoert auf den Schirm, der am laengsten steht. Er war weg, solange
# der QR seine Ecke hatte — dem Betreiber sofort aufgefallen.
pruefe(bool(_s.bilder), "MixPi steht in seiner Ecke")
pruefe(bool(_laufschirm(None).bilder), "auch ohne Schluessel")

# ── NICHTS LAEUFT HINTER MIXPI DURCH ─────────────────────────────────────
# Der Betreiber am Geraet: "der prozent balken lief beim mixpi hinten
# durch". MixPi ist 256x256 und sitzt unten rechts — auf 800x480 also von
# x=520 bis 776 und ab y=200. Alles, was tiefer als y=200 gezeichnet wird,
# muss vorher enden.
_mx, _my = _s.b - 24 - 256, _s.h - 24 - 256
_ueber = [(x, y, b, h) for (x, y, b, h) in _s.kaesten
          if y + h > _my and x + b > _mx]
pruefe(not _ueber, f"kein Balken laeuft in MixPi hinein ({_ueber})")
_textueber = [t for x, y, x2, t in _s.texte if y + 18 > _my and x2 > _mx]
pruefe(not _textueber, f"und kein Text ({_textueber})")

# ── LANGE PAKETNAMEN BRECHEN UM, STATT ABGESCHNITTEN ZU WERDEN ───────────
_f = _Schrift(18)   # 10 px je Zeichen
pruefe(es.umbrechen(_f, "Installiert chromium", 400) == ["Installiert chromium"],
       "was passt, bleibt in einer Zeile")
pruefe(es.umbrechen(_f, "Installiert libpython3.13-stdlib und mehr", 200)
       == ["Installiert", "libpython3.13-stdlib"],
       "was nicht passt, bricht um — der Paketname bleibt GANZ")
pruefe(es.umbrechen(_f, "Installiert ab cd ef gh", 200)
       == ["Installiert ab cd ef", "gh"],
       "und die erste Zeile wird bis zum Rand gefuellt, nicht auf Verdacht")
pruefe(es.umbrechen(_f, "abcdefghijklmnopqrstuvwxyz", 100)[0] == "abcdefghij",
       "ein einzelnes langes Wort wird hart getrennt statt verschluckt")
pruefe(es.umbrechen(_f, "", 200) == [] and es.umbrechen(_f, "x", 0) == [],
       "leerer Text oder keine Breite -> nichts, kein Fehler")

# ── PAKETE ZAEHLEN: APT SAGT DEN NENNER SELBST ───────────────────────────
# Echte apt-Ausgabe. Laden und Einrichten sind zwei Durchgaenge mit
# demselben Nenner — zusammengezaehlt kaeme man auf 200 %.
es._ZAEHLER.update({"geladen": 0, "eingerichtet": 0, "pakete": 0})
_st = es._pakete_lesen(
    "0 upgraded, 45 newly installed, 0 to remove and 0 not upgraded.\n"
    "Get:1 https://deb.debian.org/debian trixie/main arm64 a arm64 1 [1 kB]\n"
    "Get:12 https://deb.debian.org/debian trixie/main arm64 b arm64 1 [1 kB]\n",
    (0, 0, 0))
pruefe(_st == (12, 0, 45), "beim Laden zaehlt apts eigene Nummer")
_st = es._pakete_lesen("Setting up a (1) ...\nSetting up b (1) ...\n", _st)
pruefe(_st == (12, 2, 45), "beim Einrichten zaehlt ein ZWEITER Zaehler")
es._ZAEHLER.update({"geladen": 12, "eingerichtet": 0, "pakete": 45})
pruefe(es.paket_stand() == "Paket 12 von 45", "im Ladelauf zaehlt das Laden")
es._ZAEHLER.update({"eingerichtet": 2})
pruefe(es.paket_stand() == "Paket 2 von 45",
       "sobald eingerichtet wird, zaehlt das Einrichten")
es._ZAEHLER.update({"geladen": 0, "eingerichtet": 0, "pakete": 0})
pruefe(es.paket_stand() == "", "ohne Ankuendigung wird nichts behauptet")

# ── FERTIG IST ERST, WENN DORT JEMAND ANTWORTET ──────────────────────────
# Der Betreiber: "mixpi ist fertig screen zeigt auf eine seite die nicht
# laed". Der letzte Schritt ist gemeldet, die Box startet danach aber noch
# einmal neu — in diesem Fenster gibt es unter 8200 nichts.
_fertig = {"laeuft": False, "nummer": 53, "gesamt": 53}


def _schlussschirm(dienst):
    s = _Schirm()
    _echt = es.dienst_da
    es.dienst_da = lambda *a, **k: dienst
    try:
        es.malen(s, _Schrift(34), _Schrift(18), "http://192.168.178.55:8200/",
                 "192.168.178.55", 8099, "MixPiBox", maskottchen=_Bild(),
                 fortschritt=_fertig)
    finally:
        es.dienst_da = _echt
    return s


_auf = _schlussschirm(True)
pruefe(any("ist fertig" in t for *_, t in _auf.texte),
       "antwortet die Oberflaeche, heisst es 'ist fertig'")
pruefe(any("Profile, Spotify" in t for *_, t in _auf.texte),
       "und der Schirm laedt zum Weitermachen ein")
pruefe([k for k in _auf.kaesten if k[2] == k[3] and k[2] >= 96],
       "dann gibt es auch einen QR — er fuehrt irgendwohin")

_zu = _schlussschirm(False)
pruefe(any("gleich fertig" in t for *_, t in _zu.texte),
       "antwortet niemand, heisst es 'ist gleich fertig'")
pruefe(not [k for k in _zu.kaesten if k[2] == k[3] and k[2] >= 96],
       "und KEIN QR auf eine Seite, die nicht laedt")
pruefe(any("startet noch" in t for *_, t in _zu.texte),
       "stattdessen der Satz, der wirklich gilt")
pruefe(not any("Kamera" in t for *_, t in _zu.texte),
       "und keine Aufforderung zu scannen")
pruefe(bool(_zu.bilder), "MixPi bleibt auch hier stehen")

# Die Pruefung selbst: gegen einen Port, auf dem sicher niemand lauscht.
es._DIENST.update({"bis": 0.0, "da": False, "ziel": None})
pruefe(es.dienst_da("127.0.0.1", 9, wartezeit=0.2) is False,
       "ein toter Port gilt als nicht da")
pruefe(es.dienst_da("", 8200) is False, "ohne Adresse wird nichts behauptet")
pruefe("not (fortschritt and fortschritt.get(\"laeuft\"))" in _m2,
       "ein LAUFENDER Schritt schlaegt die Phase — er weiss mehr")

print()
print(f"{ok} in Ordnung, {bad} gebrochen, {uebersprungen} Teil(e) uebersprungen")
sys.exit(1 if bad else 0)
