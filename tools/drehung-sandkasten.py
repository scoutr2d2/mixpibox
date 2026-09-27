#!/usr/bin/env python3
"""DIE BILDSCHIRM-DREHUNG IM SANDKASTEN DURCHSPIELEN — ohne die Box anzufassen.

WOZU DAS HIER EIN EIGENES WERKZEUG IST
======================================
Die Drehung ist die eine Aenderung an dieser Box, die sich am Geraet nicht mehr
zuruecknehmen laesst, wenn sie danebengeht: das Bild steht auf dem Kopf oder
bleibt schwarz, und die Beruehrung landet spiegelverkehrt — auch auf dem Knopf
„zurueck". Wer so etwas am echten Schirm ausprobiert, hat im Fehlerfall keinen
zweiten Versuch.

Also wird hier alles durchgespielt, was durchspielbar ist:

  A  Die Umrechnung der Beruehrungspunkte (0 und 180), vier Ecken und Mitte,
     hin und zurueck. Aus der ECHTEN Funktion von touch-bridge.py, nicht aus
     einer Nachbildung — eine Nachbildung wuerde beweisen, dass der Sandkasten
     rechnen kann, und sonst nichts.
  B  Der Weg von der Einstellung zur Bruecke: kommt die Zahl, die bootwache.py
     ausrechnet, ueberhaupt bei touch-bridge.py an?
  C  Der Totmannschalter: bestaetigt / nicht bestaetigt / Strom weg waehrend
     der Frist / der Dienst, der zurueckstellt, ist selbst kaputt.
  D  Zwei Umstellungen kurz hintereinander — der Fall, den ein zweiter Klick
     erzeugt.
  E  Die Boot-Konfiguration: sichern, zuruecknehmen, und dasselbe mit einer
     vollen Karte mitten im Schreiben.
  F  Zwei gleichzeitige Schreiber auf mupiboxconfig.json.

WIE DER SANDKASTEN GEBAUT IST
=============================
`bootwache.py` wird als Modul geladen und bekommt seine Pfade auf ein
Wegwerf-Verzeichnis umgebogen (KONFIG, ZUSTAND, BEWAEHRT, SCHWEBEND,
BOOT_SICHERUNG, NOTAUS). Was die echte Maschine anfassen wuerde — xrandr,
systemctl, systemd-run — wird durch Attrappen ersetzt, die MITSCHREIBEN, statt
zu handeln. So laesst sich hinterher pruefen, WAS die Datei getan haette.

`/proc/sys/kernel/random/boot_id` wird ebenfalls ersetzt: nur so laesst sich
„die Box war zwischendurch aus" ohne Neustart nachstellen.

    python3 tools/drehung-sandkasten.py            # alles
    python3 tools/drehung-sandkasten.py --teil C   # nur ein Teil

Ruecklauf 0 = alle Aussagen halten. 1 = mindestens eine haelt nicht.
"""

from __future__ import annotations

import argparse
import errno
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import time

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
BOOTWACHE = os.path.join(WURZEL, "scripts", "box", "bootwache.py")
BRUECKE = os.path.join(WURZEL, "scripts", "box", "touch-bridge.py")

BREITE, HOEHE = 800, 480


# ── Ausgabe ────────────────────────────────────────────────────────────────
class Protokoll:
    def __init__(self) -> None:
        self.gut = 0
        self.schlecht = 0

    def sagt(self, aussage: str, wahr: bool, dazu: str = "") -> None:
        if wahr:
            self.gut += 1
            print(f"  ok    {aussage}" + (f"  [{dazu}]" if dazu else ""))
        else:
            self.schlecht += 1
            print(f"  NEIN  {aussage}" + (f"  [{dazu}]" if dazu else ""))

    def merke(self, text: str) -> None:
        print(f"  ..    {text}")


# ── Module laden, ohne sie laufen zu lassen ────────────────────────────────
def modul(pfad: str, name: str):
    """Eine Datei mit Bindestrich im Namen als Modul laden.

    `import` kann das nicht (Bindestrich ist kein gueltiger Bezeichner), und
    umbenennen waere das Falsche: gemessen werden soll die Datei, die auf die
    Box geht, nicht eine Kopie mit anderem Namen.
    """
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise SystemExit(f"laesst sich nicht laden: {pfad}")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Sandkasten:
    """Ein bootwache-Modul, dessen Pfade ins Nirgendwo zeigen.

    JEDER TEIL BEKOMMT EINEN EIGENEN. Sonst schleppte Teil D den Zustand von
    Teil C mit sich, und ein Fehler waere nicht mehr zuzuordnen.
    """

    def __init__(self, konfig: dict | None = None, boot: bool = True) -> None:
        self.dir = tempfile.mkdtemp(prefix="drehung-sandkasten-")
        self.bw = modul(BOOTWACHE, f"bootwache_{os.path.basename(self.dir)}")
        b = self.bw
        b.KONFIG = os.path.join(self.dir, "mupiboxconfig.json")
        b.ZUSTAND = os.path.join(self.dir, "var")
        b.BEWAEHRT = os.path.join(b.ZUSTAND, "bewaehrt.json")
        b.SCHWEBEND = os.path.join(b.ZUSTAND, "schwebend.json")
        b.BOOT_SICHERUNG = os.path.join(b.ZUSTAND, "boot-sicherung")
        self.bootdir = os.path.join(self.dir, "boot", "firmware")
        b.NOTAUS = (os.path.join(self.bootdir, "mupibox-drehung-aus"),)
        b.boot_verzeichnis = lambda: self.bootdir if os.path.exists(
            os.path.join(self.bootdir, "config.txt")) else None

        # Der Lauf des Kerns — hier von Hand gestellt, damit „Strom weg" ohne
        # Neustart nachstellbar ist.
        self.lauf = "lauf-1"
        b.boot_id = lambda: self.lauf

        # Die Attrappen schreiben mit, statt zu handeln.
        self.getan: list[tuple] = []
        self.wecker: list[int] = []
        self.wecker_geht = True
        self.x_geht = True
        self.bruecke_geht = True

        def bild_drehen(grad):
            self.getan.append(("bild", grad))
            return (True, f"DSI-1-2 -> {grad}") if self.x_geht else (False, "X nicht erreichbar")

        def bruecke_neu_starten():
            # Die Attrappe merkt sich, mit WELCHEM Wert die Bruecke
            # danach laeuft — das ist die Frage von Teil B.
            self.getan.append(("bruecke", self.bruecke_drehung()))
            return (True, "neu gestartet") if self.bruecke_geht else (False, "tot")

        def wecker_stellen(sek):
            if not self.wecker_geht:
                return False, "systemd-run: Attrappe abgeschaltet"
            self.wecker.append(int(sek))
            return True, f"Wecker auf {int(sek)} s"

        b.bild_drehen = bild_drehen
        b.bruecke_neu_starten = bruecke_neu_starten
        b.wecker_stellen = wecker_stellen
        b.wecker_abbestellen = lambda: self.getan.append(("wecker-ab",))

        if boot:
            os.makedirs(self.bootdir, exist_ok=True)
            with open(os.path.join(self.bootdir, "config.txt"), "w") as f:
                f.write("dtoverlay=vc4-kms-v3d\ndtoverlay=vc4-kms-dsi-7inch\n")
            with open(os.path.join(self.bootdir, "cmdline.txt"), "w") as f:
                f.write("root=PARTUUID=c7ff9455-02 rootwait quiet\n")

        b.schreib_json(b.KONFIG, konfig if konfig is not None else grundkonfig())

    def bruecke_drehung(self) -> int:
        """MIT WELCHER DREHUNG LAEUFT DIE BRUECKE NACH EINEM NEUSTART?

        Das ist der Kern von Teil B und bewusst NICHT aus der Konfiguration
        abgeleitet: die Antwort steht in der Unit-Datei (`ExecStart=… --drehung
        180`). Hier wird nachgelesen, was dort steht — genau wie systemd es
        beim Neustart tut.
        """
        unit = os.path.join(WURZEL, "config", "services", "mupibox-touch-bridge.service")
        try:
            with open(unit) as f:
                for zeile in f:
                    if zeile.startswith("ExecStart=") and "--drehung" in zeile:
                        teile = zeile.split()
                        return int(teile[teile.index("--drehung") + 1])
        except (OSError, ValueError, IndexError):
            pass
        return 0

    def konfig(self) -> dict:
        return self.bw.lies_json(self.bw.KONFIG) or {}

    def anzeige(self) -> dict:
        return self.bw.anzeige_aus(self.konfig())

    def weg(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)


def grundkonfig() -> dict:
    """Eine Konfiguration, wie sie auf der Box liegt — nur die Teile, die zaehlen.

    Die fremden Schluessel stehen mit drin, weil eine der Aussagen lautet: der
    Schreiber darf sie nicht verlieren.
    """
    return {
        "spotify": {"username": "geheim", "password": "auch-geheim"},
        "shim": {"ledPin": "13", "ledBrightnessMax": "100"},
        "timeout": {"pressDelay": 2},
    }


# ── A  Die Umrechnung der Beruehrungspunkte ────────────────────────────────
def dreher(drehung: int):
    """Die ECHTE `dreh`-Funktion aus touch-bridge.py, ohne /dev/uinput.

    `Eingabegeraet.__init__` legt ein Kernel-Geraet an — im Sandkasten weder
    moeglich noch gewollt. `object.__new__` umgeht den Konstruktor; `dreh`
    braucht nur drei Werte, und die werden hier von Hand gesetzt. Gemessen wird
    damit der Rechenweg, der auf der Box laeuft, Zeichen fuer Zeichen.
    """
    m = modul(BRUECKE, "touchbruecke")
    g = object.__new__(m.Eingabegeraet)
    g.roh_b, g.roh_h = BREITE, HOEHE
    g.drehung = drehung % 360
    return g.dreh


def teil_a(p: Protokoll) -> None:
    print("\nA  Umrechnung der Beruehrungspunkte (touch-bridge.py, echte Funktion)")
    ecken = {
        "oben links": (0, 0),
        "oben rechts": (BREITE - 1, 0),
        "unten links": (0, HOEHE - 1),
        "unten rechts": (BREITE - 1, HOEHE - 1),
        "Mitte": (BREITE // 2, HOEHE // 2),
    }

    d0 = dreher(0)
    for name, (x, y) in ecken.items():
        p.sagt(f"0 Grad laesst {name} stehen", d0(x, y) == (x, y), f"{(x, y)} -> {d0(x, y)}")

    d180 = dreher(180)
    erwartet = {
        "oben links": (BREITE - 1, HOEHE - 1),
        "oben rechts": (0, HOEHE - 1),
        "unten links": (BREITE - 1, 0),
        "unten rechts": (0, 0),
        "Mitte": (BREITE - 1 - BREITE // 2, HOEHE - 1 - HOEHE // 2),
    }
    for name, (x, y) in ecken.items():
        p.sagt(f"180 spiegelt {name} auf die Gegenecke",
               d180(x, y) == erwartet[name], f"{(x, y)} -> {d180(x, y)}")

    # HIN UND ZURUECK IST DIESELBE RECHNUNG. Das ist der Grund, warum 180 die
    # billigere Loesung ist als 90/270: eine Punktspiegelung ist ihre eigene
    # Umkehrung, es gibt keine zweite Formel, die falsch sein koennte.
    alle_gleich = all(d180(*d180(x, y)) == (x, y)
                      for x in range(0, BREITE, 7) for y in range(0, HOEHE, 5))
    p.sagt("zweimal 180 ergibt wieder den Ausgangspunkt (alle Punkte im Raster)",
           alle_gleich)

    # Und der Bereich bleibt der Bereich — kein Punkt faellt aus dem Schirm.
    drin = all(0 <= d180(x, y)[0] < BREITE and 0 <= d180(x, y)[1] < HOEHE
               for x in range(0, BREITE, 7) for y in range(0, HOEHE, 5))
    p.sagt("kein gedrehter Punkt faellt aus 800x480 heraus", drin)

    # Die Aufloesung bleibt: bei 90/270 taeten Breite und Hoehe das nicht.
    p.sagt("180 vertauscht Breite und Hoehe NICHT",
           dreher(180)(BREITE - 1, HOEHE - 1) == (0, 0))


# ── B  Der Weg von der Einstellung zur Bruecke ─────────────────────────────
def teil_b(p: Protokoll) -> None:
    print("\nB  Kommt die ausgerechnete Zahl bei der Bruecke an?")
    s = Sandkasten()
    try:
        b = s.bw
        p.sagt("Summe: Versatz 180 + Bild 180 ergibt 0",
               b.wirksamer_touch({"bild": 180, "touchVersatz": 180}) == 0)
        p.sagt("Summe: Versatz 180 + Bild 0 ergibt 180",
               b.wirksamer_touch({"bild": 0, "touchVersatz": 180}) == 180)

        # DIE ENTSCHEIDENDE FRAGE. bootwache.py rechnet eine Zahl aus und
        # startet dann den Dienst neu. Der Dienst startet mit dem, was in
        # SEINER Unit steht — liest er die Konfiguration nicht, ist die
        # ausgerechnete Zahl ein Zettel, den niemand abholt.
        liest_konfig = False
        with open(BRUECKE) as f:
            quelle = f.read()
        for hinweis in ("mupiboxconfig", "/etc/mupibox", "json.load"):
            if hinweis in quelle:
                liest_konfig = True
        p.sagt("touch-bridge.py liest die Konfiguration", liest_konfig,
               "sonst wirkt nur das --drehung in der Unit")

        b.schreib_anzeige({"bild": 180, "touchVersatz": 180})
        soll = b.wirksamer_touch(b.anzeige_aus(b.lies_konfig(b.KONFIG)))
        ist = s.bruecke_drehung()
        p.sagt(f"nach der Umstellung laeuft die Bruecke mit {soll} Grad",
               soll == ist, f"ausgerechnet {soll}, Unit sagt {ist}")
    finally:
        s.weg()


# ── C  Der Totmannschalter ─────────────────────────────────────────────────
def teil_c(p: Protokoll) -> None:
    print("\nC  Totmannschalter")

    # C1 bestaetigt
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 30)
        p.sagt("C1 nach dem Stellen steht 180 in der Konfiguration",
               s.anzeige()["bild"] == 180)
        p.sagt("C1 eine schwebende Umstellung liegt da",
               s.bw.schwebend_lesen() is not None)
        s.bw.befehl_bestaetigen()
        p.sagt("C1 nach dem Bestaetigen bleibt 180", s.anzeige()["bild"] == 180)
        p.sagt("C1 nichts schwebt mehr", s.bw.schwebend_lesen() is None)
        p.sagt("C1 der bewaehrte Stand ist jetzt 180",
               s.bw.bewaehrt_lesen()["bild"] == 180)
    finally:
        s.weg()

    # C2 nicht bestaetigt — die Frist laeuft ab
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 30)
        p.sagt("C2 die Frist ist noch offen",
               s.bw.schwebend_faellig(s.bw.schwebend_lesen()) is None)
        spaeter = time.time() + 31
        p.sagt("C2 nach Ablauf ist sie faellig (Grund: frist)",
               s.bw.schwebend_faellig(s.bw.schwebend_lesen(), spaeter) == "frist")
        # Der Wecker ruft --frist-abgelaufen; im Sandkasten von Hand.
        s.bw.time.time = lambda: spaeter  # nur fuer diesen Aufruf
        s.bw.befehl_nachsehen()
        s.bw.time.time = time.time
        p.sagt("C2 das Bild steht wieder auf 0", s.anzeige()["bild"] == 0)
        p.sagt("C2 nichts schwebt mehr", s.bw.schwebend_lesen() is None)
        p.sagt("C2 die letzte Handlung war eine Ruecknahme auf 0",
               ("bild", 0) in s.getan)
    finally:
        s.weg()

    # C3 Strom weg waehrend der Frist
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 600)   # Frist absichtlich lang
        s.lauf = "lauf-2"                     # die Box war aus und kam wieder
        p.sagt("C3 trotz reichlich Restfrist faellig (Grund: neustart)",
               s.bw.schwebend_faellig(s.bw.schwebend_lesen()) == "neustart")
        s.bw.befehl_nachsehen()
        p.sagt("C3 die Box kommt NICHT in der ungepruefeten Drehung hoch",
               s.anzeige()["bild"] == 0)
    finally:
        s.weg()

    # C4 der Dienst, der zurueckstellt, ist selbst kaputt
    s = Sandkasten()
    try:
        s.wecker_geht = False
        r = s.bw.befehl_stellen(180, None, 30)
        p.sagt("C4 laesst sich der Wecker nicht stellen, wird NICHT gedreht",
               r != 0 and s.anzeige()["bild"] == 0)
        p.sagt("C4 und es schwebt auch nichts nach", s.bw.schwebend_lesen() is None)
        p.sagt("C4 xrandr wurde gar nicht erst gerufen",
               not [g for g in s.getan if g[0] == "bild"])
    finally:
        s.weg()

    # C5 der Rettungsanker auf der Boot-Partition
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 600)
        s.bw.befehl_bestaetigen()
        open(s.bw.NOTAUS[0], "w").close()     # Karte im anderen Rechner
        s.bw.befehl_nachsehen()
        p.sagt("C5 die Datei auf der Boot-Partition holt das Bild auf 0",
               s.anzeige()["bild"] == 0)
        r = s.bw.befehl_stellen(180, None, 30)
        p.sagt("C5 solange sie liegt, laesst sich nicht wieder gedreht werden",
               r != 0 and s.anzeige()["bild"] == 0)
    finally:
        s.weg()

    # C6 unlesbare Frist
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 600)
        kaputt = s.bw.schwebend_lesen()
        kaputt["frist_bis"] = "morgen frueh"
        s.bw.schreib_json(s.bw.SCHWEBEND, kaputt)
        p.sagt("C6 unlesbare Frist gilt als faellig, nicht als unendlich",
               s.bw.schwebend_faellig(s.bw.schwebend_lesen()) == "unlesbar")
        s.bw.befehl_nachsehen()
        p.sagt("C6 und wird zurueckgenommen", s.anzeige()["bild"] == 0)
    finally:
        s.weg()

    # C7 halb geschriebene Zustandsdatei
    s = Sandkasten()
    try:
        s.bw.befehl_stellen(180, None, 600)
        with open(s.bw.SCHWEBEND, "w") as f:
            f.write('{"bild": 180, "touchVer')      # Strom weg beim Schreiben
        p.sagt("C7 eine halbe Zustandsdatei wirft den Rueckweg nicht um",
               s.bw.schwebend_lesen() is None)
        r = s.bw.befehl_zuruecknehmen()
        p.sagt("C7 --zuruecknehmen kommt trotzdem auf einen Stand",
               r == 0 and s.anzeige()["bild"] in (0, 180))
    finally:
        s.weg()


# ── D  Zweimal stellen ─────────────────────────────────────────────────────
def teil_d(p: Protokoll) -> None:
    print("\nD  Zwei Umstellungen kurz hintereinander (zweiter Klick, Nachbessern)")
    s = Sandkasten()
    try:
        b = s.bw
        b.befehl_stellen(180, None, 600)
        p.sagt("D  nach dem ersten Stellen ist der Rueckfall 0",
               b.schwebend_lesen()["alt"]["bild"] == 0)

        # DER FALL: das Bild steht jetzt richtig, aber die Beruehrung nicht.
        # Also stellt man WAEHREND DER FRIST den Touch-Versatz nach. Ein
        # zweiter Klick auf denselben Knopf tut dasselbe.
        b.befehl_stellen(180, 0, 600)
        rueckfall = b.schwebend_lesen()["alt"]["bild"]
        p.sagt("D  der Rueckfall zeigt IMMER NOCH auf das ungedrehte Bild",
               rueckfall == 0,
               f"schwebend.alt.bild = {rueckfall}")

        b.befehl_nachsehen if False else None
        s.lauf = "lauf-2"
        b.befehl_nachsehen()
        p.sagt("D  laeuft die Frist danach ab, landet das Bild wieder auf 0",
               s.anzeige()["bild"] == 0,
               f"steht auf {s.anzeige()['bild']}")
    finally:
        s.weg()


# ── E  Die Boot-Konfiguration ──────────────────────────────────────────────
def teil_e(p: Protokoll) -> None:
    print("\nE  Boot-Konfiguration sichern und zuruecknehmen")
    s = Sandkasten()
    try:
        b = s.bw
        cfg = os.path.join(s.bootdir, "config.txt")
        with open(cfg) as f:
            vorher = f.read()

        ziel = b.boot_sichern()
        p.sagt("E  die Kopie liegt VOR der Umstellung da",
               ziel is not None and os.path.exists(f"{ziel}/config.txt"))
        with open(f"{ziel}/config.txt") as f:
            p.sagt("E  und sie ist Zeichen fuer Zeichen die alte Datei",
                   f.read() == vorher)

        # Jemand traegt von Hand etwas ein, das den Schirm schwarz macht.
        with open(cfg, "a") as f:
            f.write("lcd_rotate=2\n")
        b.boot_zurueck()
        with open(cfg) as f:
            p.sagt("E  --auch-boot holt die alte Datei vollstaendig zurueck",
                   f.read() == vorher)

        # ── DIE VOLLE KARTE MITTEN IM SCHREIBEN ──────────────────────────
        # Nachgestellt, indem die Kopie nach der Haelfte mit ENOSPC abbricht
        # — genau das tut eine volle FAT-Partition. Die Frage ist nicht, ob
        # der Aufruf scheitert (das tut er), sondern WAS DANACH IN
        # config.txt STEHT. Bleibt dort eine halbe Datei, findet die Firmware
        # den Panel-Overlay nicht mehr: schwarzer Schirm, und der Rueckweg
        # war der, der ihn verursacht hat.
        echte_kopie = shutil.copy2

        def halbe_kopie(quelle, ziel_, *a, **kw):
            with open(quelle, "rb") as f:
                inhalt = f.read()
            with open(ziel_, "wb") as f:
                f.write(inhalt[: len(inhalt) // 2])
            raise OSError(errno.ENOSPC, "No space left on device")

        b.shutil.copy2 = halbe_kopie
        try:
            b.boot_zurueck()
        finally:
            b.shutil.copy2 = echte_kopie
        with open(cfg) as f:
            danach = f.read()
        p.sagt("E  volle Karte mitten im Schreiben laesst config.txt heil",
               danach == vorher,
               f"{len(danach)} von {len(vorher)} Zeichen uebrig")
        p.sagt("E  der Panel-Overlay steht noch drin",
               "vc4-kms-dsi-7inch" in danach)
    finally:
        s.weg()

    # Ohne Boot-Verzeichnis darf nichts umfallen (Pi ohne /boot/firmware).
    s = Sandkasten(boot=False)
    try:
        p.sagt("E  ohne Boot-Verzeichnis sichert es still nichts",
               s.bw.boot_sichern() is None)
        p.sagt("E  und die Ruecknahme faellt nicht um",
               s.bw.boot_zurueck() is None)
    finally:
        s.weg()


# ── F  Zwei gleichzeitige Schreiber ────────────────────────────────────────
def teil_f(p: Protokoll) -> None:
    print("\nF  Zwei gleichzeitige Schreiber auf mupiboxconfig.json")
    s = Sandkasten()
    try:
        b = s.bw
        # Der andere Schreiber ist der Server: er liest die Datei, aendert ein
        # Feld und schreibt sie zurueck. Genau dasselbe Muster wie
        # `schreib_anzeige` — und ohne Riegel dazwischen verliert einer.
        halt = threading.Event()

        def anderer():
            halt.wait()
            k = b.lies_json(b.KONFIG) or {}
            time.sleep(0.02)
            k.setdefault("shim", {})["ledBrightnessMax"] = "42"
            b.schreib_json(b.KONFIG, k)

        t = threading.Thread(target=anderer)
        t.start()
        halt.set()
        time.sleep(0.005)
        b.schreib_anzeige({"bild": 180, "touchVersatz": 180})
        t.join()

        k = s.konfig()
        drehung_da = k.get("anzeige", {}).get("bildDrehung") == 180
        fremd_da = k.get("shim", {}).get("ledBrightnessMax") == "42"
        p.sagt("F  beide Aenderungen ueberleben", drehung_da and fremd_da,
               f"Drehung {'da' if drehung_da else 'WEG'}, "
               f"fremdes Feld {'da' if fremd_da else 'WEG'}")

        # Und was auf jeden Fall gelten muss: nichts geht ganz verloren.
        p.sagt("F  die Datei ist danach jedenfalls lesbar", bool(k))
        p.sagt("F  die Spotify-Zugaenge stehen noch drin",
               k.get("spotify", {}).get("password") == "auch-geheim")
    finally:
        s.weg()


def teil_g(p: Protokoll) -> None:
    """RUFT DIESE LOGIK UEBERHAUPT JEMAND?

    Die Teile A bis F messen, ob `bootwache.py` das Richtige TUT. Dieser Teil
    misst etwas anderes und Wichtigeres: ob sie am Geraet je an die Reihe
    kommt. Ein Totmannschalter, den niemand aufzieht, ist kein halber
    Totmannschalter — er ist keiner, und er ist gefaehrlicher als gar keiner,
    weil man sich auf ihn verlaesst.

    Gemessen wird ausschliesslich am BAUM (welche Unit liegt in
    config/services/, wer nennt bootwache.py) — keine Box noetig, und die
    Antwort gilt fuer jede Karte, nicht nur fuer die hier im Netz.
    """
    print("\nG  Wird die Bootwache am Geraet ueberhaupt gerufen?")

    dienste = os.path.join(WURZEL, "config", "services")
    units = [u for u in os.listdir(dienste) if "bootwache" in u or "drehung" in u]
    p.sagt("eine Unit zieht den Wachtimer auf (Netz 2 aus dem Kopf der Datei)",
           bool(units),
           ", ".join(units) if units else "in config/services/ liegt keine")

    # Wer nennt die Datei? Der Ausrollweg (autosetup/update) kopiert
    # scripts/box/* pauschal nach /opt/mupibox-tools/, sie KAEME also an —
    # aufgerufen wird sie damit noch lange nicht.
    rufer: dict[str, str] = {}
    for wurzel, verz, dateien in os.walk(WURZEL):
        verz[:] = [v for v in verz
                   if v not in (".git", "node_modules", "dist", "worktrees", ".claude")]
        for d in dateien:
            if not d.endswith((".sh", ".service", ".timer", ".py", ".ts")):
                continue
            pfad = os.path.join(wurzel, d)
            if os.path.abspath(pfad) in (os.path.abspath(__file__), BOOTWACHE):
                continue
            try:
                with open(pfad, encoding="utf-8", errors="ignore") as f:
                    inhalt = f.read()
            except OSError:
                continue
            if "bootwache.py" in inhalt:
                rufer[os.path.relpath(pfad, WURZEL)] = inhalt
    p.merke(f"Rufer von bootwache.py im Baum: {', '.join(sorted(rufer)) or 'keine'}")

    for schalter, was, folge in (
        ("--nachsehen", "beim Hochfahren sieht jemand nach",
         "die boot_id-Pruefung aus Teil C3 wird nie ausgefuehrt: nach Stromausfall "
         "waehrend der Frist raeumt niemand auf"),
        ("--anwenden", "beim Kiosk-Start wird die Einstellung angewandt",
         "die Drehung ueberlebt keinen Neustart — ein verdreht eingebautes "
         "Display steht nach JEDEM Start wieder auf dem Kopf"),
        ("--stellen", "es gibt einen Weg, die Drehung zu STELLEN",
         "verdrahtet ist nur --zuruecknehmen (system.ts); einstellen geht "
         "ausschliesslich ueber SSH"),
        ("--bestaetigen", "es gibt einen Weg, sie zu BESTAETIGEN",
         "ohne Bestaetigung faellt jede Umstellung nach der Frist wieder "
         "zurueck — die Drehung liesse sich gar nicht dauerhaft einstellen"),
    ):
        wo = [r for r, i in rufer.items() if schalter in i]
        p.sagt(f"{was} ({schalter})", bool(wo), ", ".join(wo) if wo else folge)


def teil_h(p: Protokoll) -> None:
    """DER WECKER SELBST — die drei Stellen, an denen er still nicht losgeht.

    Teil C prueft die LOGIK des Totmannschalters mit einer Attrappe an Stelle
    von `systemd-run`. Das ist richtig so (sonst braeuchte jeder Lauf 60
    Sekunden und root), laesst aber genau die Fragen offen, die systemd selbst
    beantwortet. Die drei hier stehen, weil sie AM 08.08.2026 AUF DER BOX
    NACHGEMESSEN wurden — nicht aus einer Anleitung uebernommen.

    Gemessen wird deshalb hier der QUELLTEXT: ob die Datei die Lehre aus der
    Messung zieht. Was die Messung ergab, steht bei jeder Aussage dabei.
    """
    print("\nH  Der Wecker (auf der Box nachgemessen, hier am Quelltext geprueft)")
    with open(BOOTWACHE) as f:
        quelle = f.read()

    # Der Aufruf steht zwischen `systemd-run` und `--frist-abgelaufen`.
    anfang = quelle.find("systemd-run")
    stueck = quelle[anfang:quelle.find("--frist-abgelaufen", anfang)] if anfang >= 0 else ""

    # ── 1 ────────────────────────────────────────────────────────────────
    # AUF DER BOX GEMESSEN: mit `sys.argv[0] == "./sandprobe.py"` antwortet
    # systemd-run mit Ruecklauf 1 und
    #   "./sandprobe.py" is neither a valid executable name nor an absolute path
    # Mit demselben Skript unter /tmp/sandprobe.py: Ruecklauf 0.
    #
    # WAS DAS HEISST: wird bootwache.py aus ihrem Verzeichnis heraus gerufen
    # (`./bootwache.py --stellen 180`, wie man es beim Einrichten tut), laesst
    # sich der Wecker nicht stellen. Das ist zwar sicher — Teil C4 zeigt, dass
    # dann gar nicht erst gedreht wird — aber es heisst auch: die Drehung geht
    # dann UEBERHAUPT NICHT, und der Grund steht in keiner Fehlermeldung, die
    # von der Drehung spricht.
    p.sagt("H  der Wecker bekommt einen absoluten Pfad, nicht sys.argv[0]",
           "sys.argv[0]" not in stueck and ("__file__" in stueck or "abspath" in stueck
                                            or "realpath" in stueck),
           "sonst scheitert jeder Aufruf ueber einen relativen Pfad")

    # ── 2 ────────────────────────────────────────────────────────────────
    # AUF DER BOX GEMESSEN:
    #   systemd-run --unit=… --on-active=10s …
    #   systemctl show …timer -p AccuracyUSec  ->  AccuracyUSec=1min
    #
    # systemd darf einen Timer also bis zu eine Minute SPAETER ausloesen, um
    # Aufwachvorgaenge zu buendeln. Bei der Vorgabefrist von 60 s heisst das im
    # schlechtesten Fall 120 s vor einem Schirm, auf dem man nichts treffen
    # kann. Zwei Minuten sind fuer ein Kind vor einer Box, die nicht reagiert,
    # etwas anderes als eine.
    p.sagt("H  die Frist wird auf die Sekunde genau gestellt (AccuracySec)",
           "AccuracySec" in stueck,
           "ohne Angabe gilt AccuracyUSec=1min — die Frist kann sich verdoppeln")

    # ── 3 ────────────────────────────────────────────────────────────────
    # `systemd-run --unit=NAME` scheitert, wenn NAME noch existiert. Ein
    # transienter Dienst wird zwar aufgeraeumt, sobald er inaktiv ist — aber
    # NICHT, wenn er im Zustand "failed" haengen bleibt. Auf dieser Box liegt
    # dafuer ein Beleg herum: `mupibox-sicherungsprobe.service` steht seit
    # laengerem auf failed. Bleibt der Rueckfall-Dienst einmal so stehen,
    # laesst sich nie wieder gedreht werden, und niemand sagt warum.
    stoppt = quelle[max(0, anfang - 700):anfang]
    p.sagt("H  vor dem Stellen wird auch der DIENST gestoppt, nicht nur der Timer",
           ".service" in stoppt,
           "ein haengengebliebener Rueckfall-Dienst blockiert sonst jeden "
           "weiteren Versuch (systemd-run: unit already exists)")


TEILE = {"A": teil_a, "B": teil_b, "C": teil_c, "D": teil_d, "E": teil_e,
         "F": teil_f, "G": teil_g, "H": teil_h}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teil", action="append", choices=sorted(TEILE),
                    help="nur diese Teile (mehrfach moeglich)")
    a = ap.parse_args(argv)

    if not os.path.exists(BOOTWACHE):
        print(f"{BOOTWACHE} gibt es nicht — nichts zu messen.", file=sys.stderr)
        return 2

    p = Protokoll()
    for name in (a.teil or sorted(TEILE)):
        TEILE[name](p)

    print(f"\n{p.gut} halten, {p.schlecht} halten nicht.")
    return 1 if p.schlecht else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
