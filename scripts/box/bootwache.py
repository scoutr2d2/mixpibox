#!/usr/bin/env python3
"""BOOTWACHE — der Totmannschalter fuer die Bildschirm-Drehung.

DAS PROBLEM, DAS ES OHNE SIE GIBT
=================================
Beim Bau der Box kann das Display um 180 Grad verdreht eingebaut werden. Dann
steht alles auf dem Kopf und muss in Software zurueckgedreht werden. Nur: eine
FALSCHE Drehung macht die Box unbedienbar, und zwar auf eine Art, die sich am
Geraet nicht mehr zuruecknehmen laesst:

  * Das Bild steht auf dem Kopf ODER bleibt schwarz.
  * Die Beruehrung landet spiegelverkehrt — der Finger zeigt hierhin, getroffen
    wird da drueben. Auch der Knopf „zurueck" waere dann nicht zu treffen.

Ein Mensch am Rechner kennt das Muster: Aufloesung umstellen, der Schirm fragt
„Sehen Sie das? Ja/Nein", und ohne Antwort geht es von selbst zurueck. Genau
das ist diese Datei. Sie stellt um, spannt eine Frist, und wenn niemand
bestaetigt, stellt sie ohne jedes Zutun zurueck.

WARUM DER RUECKWEG NICHT AM SCHIRM HAENGEN DARF
==============================================
Der schlimmste Fall ist nicht „auf dem Kopf", sondern SCHWARZ. Dann hilft kein
Antippen, kein Dialog, kein Knopf. Deshalb ist der Rueckweg hier eine Uhr, die
ohne Bedienung ablaeuft — nicht eine Frage, die beantwortet werden muss.

VIER NETZE, ABSICHTLICH UNABHAENGIG VONEINANDER
===============================================
1. systemd-Kurzzeitwecker (`systemd-run --on-active`). Nicht dieser Prozess
   haelt die Frist, sondern PID 1. Wird `bootwache.py` abgeschossen, laeuft der
   Wecker trotzdem.
2. Der Wachtimer `mupibox-bootwache.timer` sieht alle 30 s nach. Er faengt den
   Fall, dass der Kurzzeitwecker gar nicht erst angelegt werden konnte.
3. DIE FRIST UEBERLEBT KEINEN NEUSTART. In der schwebenden Umstellung steht die
   `boot_id` des Laufs, in dem sie gestellt wurde. Passt sie nicht mehr, wird
   ZURUECKGESTELLT — egal wie viel Frist rechnerisch noch uebrig waere. Damit
   ist der Fall „waehrend der Frist ausgesteckt" erledigt: die Box kommt nie in
   der ungepruefeten Einstellung hoch.
4. Eine Datei auf der BOOT-PARTITION haelt alles an: liegt
   `/boot/firmware/mupibox-drehung-aus` da, gilt Drehung 0, ohne Wenn und Aber.
   Diese Partition ist FAT — sie laesst sich in JEDEM anderen Rechner oeffnen,
   auch unter Windows. Das ist der letzte Rettungsanker, und er ist bewusst
   eine ZUSAETZLICHE Datei und keine Zeile in `config.txt`: eine leere Datei
   anzulegen kann niemand kaputtmachen, eine Zeile in der Boot-Konfiguration
   sehr wohl.

WAS DIESE DATEI NICHT ANFASST
=============================
Die Boot-Konfiguration. Kein `lcd_rotate`, kein `video=…,rotate=180`, kein
`fbcon=rotate:2`. Begruendung steht in `--hilfe` und im Bericht: das Bild wird
zur Laufzeit ueber X gedreht (sofort wirksam, ohne Neustart zuruecknehmbar),
der Startbildschirm dreht sein eigenes Bild selbst. Damit gibt es den
Fehlerfall „schwarzer Schirm nach dem Neustart wegen einer Zeile in
config.txt" gar nicht erst.

TROTZDEM wird bei jeder Umstellung eine DATIERTE Kopie von `config.txt` und
`cmdline.txt` weggelegt — fuer den Fall, dass jemand dort doch von Hand etwas
eingetragen hat. `--zuruecknehmen --auch-boot` spielt sie zurueck.

DIE ZWEI ZAHLEN
===============
`anzeige.bildDrehung`   0 oder 180 — wie weit das BILD in Software gedreht wird.
`anzeige.touchVersatz`  0 oder 180 — wie weit der Touch-Controller GEGENUEBER
                        dem Panelglas sitzt. Eigenschaft des Panelmoduls, nicht
                        des Gehaeuses; auf dieser Box gemessen: 180.

Sie sind GETRENNT stellbar, weil sie getrennte Ursachen haben. Die Bruecke
bekommt ihre Summe:

    wirksamer Touch = (touchVersatz + bildDrehung) mod 360

Warum die Summe: wird das ganze Displaymodul verdreht eingebaut, dreht sich das
Glas MIT — das Bild braucht 180, und der Touch braucht dieselben 180 zusaetzlich
zu seinem Versatz. Auf dieser Box heisst das: Versatz 180 + Bild 180 = 0.

Aufrufe
=======
  --stand                     Zustand als JSON (fuer die Verwaltung)
  --stellen --bild 0|180 [--touch-versatz 0|180] [--frist N]
                              umstellen und Frist spannen
  --bestaetigen               „ich sehe das Bild" — die Frist entfaellt
  --zuruecknehmen [--auch-boot]
                              sofort auf die zuletzt bewaehrte Einstellung
  --nachsehen                 Wachtimer und Start: Abgelaufenes zuruecknehmen
  --frist-abgelaufen          der Kurzzeitwecker ruft das
  --anwenden                  wirksame Werte auf X und Bruecke uebertragen
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time

KONFIG = "/etc/mupibox/mupiboxconfig.json"
ZUSTAND = "/var/lib/mupibox/drehung"
BEWAEHRT = f"{ZUSTAND}/bewaehrt.json"
SCHWEBEND = f"{ZUSTAND}/schwebend.json"
BOOT_SICHERUNG = f"{ZUSTAND}/boot-sicherung"

# Der Rettungsanker auf der FAT-Partition. Beide Orte, weil DietPi die
# Boot-Partition je nach Alter unter /boot oder /boot/firmware einhaengt.
NOTAUS = ("/boot/firmware/mupibox-drehung-aus", "/boot/mupibox-drehung-aus")
BOOT_DATEIEN = ("config.txt", "cmdline.txt")

DIENST_BRUECKE = "mupibox-touch-bridge"
WECKER = "mupibox-drehung-rueckfall"

FRIST_VORGABE = 60
FRIST_MIN = 15
FRIST_MAX = 600

ERLAUBT = (0, 180)


# ── Kleinkram ──────────────────────────────────────────────────────────────
def boot_id() -> str:
    """Kennung DIESES Laufs des Kerns. Wechselt bei jedem Neustart.

    Das ist der Unterschied zwischen „die Frist laeuft noch" und „die Box war
    zwischendurch aus". Eine Uhrzeit taugt dafuer nicht: ohne Echtzeituhr steht
    die Zeit nach dem Hochfahren irgendwo, und ein Vergleich mit `frist_bis`
    koennte sagen „noch 40 s uebrig", obwohl die Box seit gestern aus war.
    """
    try:
        with open("/proc/sys/kernel/random/boot_id") as f:
            return f.read().strip()
    except OSError:
        return ""


def lies_json(pfad: str):
    try:
        with open(pfad) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def schreib_json(pfad: str, inhalt) -> None:
    """Erst daneben schreiben, dann umbenennen.

    Ein halb geschriebenes `bewaehrt.json` waere genau der Anker, an dem der
    Rueckweg haengt — und wer beim Schreiben den Strom verliert, braucht ihn.
    """
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    tmp = f"{pfad}.neu"
    with open(tmp, "w") as f:
        json.dump(inhalt, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, pfad)
    try:
        d = os.open(os.path.dirname(pfad), os.O_RDONLY)
        os.fsync(d)
        os.close(d)
    except OSError:
        pass


def notaus_liegt() -> str | None:
    for p in NOTAUS:
        if os.path.exists(p):
            return p
    return None


def zahl(wert, vorgabe: int = 0) -> int:
    """0/180 herausschaelen — aus Zahl, Text oder Wahrheitswert.

    NACHSICHTIG BEIM LESEN, STRENG BEIM SCHREIBEN: in dieser Konfiguration
    stehen Zahlen mal als Zahl, mal als Zeichenkette ("800"), je nachdem wer
    den Schluessel angelegt hat. Ein `int()` allein waere bei "180" richtig und
    bei true falsch. Alles, was nicht 0 oder 180 ergibt, faellt auf die Vorgabe
    zurueck — eine unlesbare Zahl darf nicht in eine Drehung geraten.
    """
    if isinstance(wert, bool):
        return 180 if wert else 0
    try:
        g = int(str(wert).strip()) % 360
    except (TypeError, ValueError):
        return vorgabe
    return g if g in ERLAUBT else vorgabe


# ── Die Konfiguration ──────────────────────────────────────────────────────
#
# ── WARUM `pfad=None` UND NICHT `pfad=KONFIG` ───────────────────────────────
#
# Weil ein Vorgabewert BEIM DEFINIEREN festgezurrt wird, nicht beim Aufrufen.
# Stuende hier `pfad: str = KONFIG`, dann zeigte diese Vorgabe fuer immer auf
# /etc/mupibox/mupiboxconfig.json — auch nachdem jemand das Modul geladen und
# `bootwache.KONFIG` auf ein Wegwerf-Verzeichnis umgebogen hat.
#
# GENAU DAS TUT tools/drehung-sandkasten.py, und genau daran ist es
# gescheitert: der Sandkasten setzte `w.KONFIG` auf /tmp, `befehl_stellen`
# schrieb aber weiter nach /etc. Auf dem Arbeitsplatz endete das mit
# „Permission denied" — auf der BOX, wo diese Datei als root laeuft, haette
# derselbe Lauf die echte Konfiguration der Box umgeschrieben, waehrend das
# Werkzeug im Kopf verspricht, nichts anzufassen.
#
# Ein Werkzeug, das die Box nicht anfassen darf, muss sie auch nicht anfassen
# KOENNEN. Deshalb wird der Pfad erst beim Aufruf nachgeschlagen.
def lies_konfig(pfad: str | None = None) -> dict:
    k = lies_json(KONFIG if pfad is None else pfad)
    return k if isinstance(k, dict) else {}


def anzeige_aus(konfig: dict) -> dict:
    """{bild, touchVersatz} aus der Konfiguration, mit Vorgaben.

    VORGABE FUER touchVersatz IST 180 UND NICHT 0. Das ist kein Geschmack: die
    Unit fuhr die Bruecke seit dem 04.08.2026 mit `--drehung 180` fest, weil
    der Controller im Gehaeuse anders herum sitzt. Waere die Vorgabe hier 0,
    bekaeme jede Box, deren Konfiguration den neuen Schluessel noch nicht hat,
    beim naechsten Start einen spiegelverkehrten Touch — also genau den Schaden,
    den diese Datei verhindern soll, ausgeloest durch ihre eigene Einfuehrung.
    """
    a = konfig.get("anzeige") if isinstance(konfig.get("anzeige"), dict) else {}
    return {
        "bild": zahl(a.get("bildDrehung"), 0),
        "touchVersatz": zahl(a.get("touchVersatz"), 180),
    }


def schreib_anzeige(werte: dict, pfad: str | None = None) -> None:
    """Die zwei Zahlen in die Konfiguration schreiben — und sonst NICHTS.

    Gelesen, geaendert, zurueckgeschrieben statt neu erzeugt: in dieser Datei
    stehen Spotify-Token, Passwort-Hash und die Medienliste. Ein Schreiber, der
    sie neu aufbaut, verliert alles, was er nicht kennt.

    `pfad=None` statt `pfad=KONFIG` aus dem Grund, der ueber `lies_konfig`
    steht — und hier wiegt er schwerer, weil hier GESCHRIEBEN wird.
    """
    pfad = KONFIG if pfad is None else pfad
    konfig = lies_konfig(pfad)
    a = konfig.get("anzeige")
    if not isinstance(a, dict):
        a = {}
    a["bildDrehung"] = int(werte["bild"])
    a["touchVersatz"] = int(werte["touchVersatz"])
    konfig["anzeige"] = a
    schreib_json(pfad, konfig)


def wirksamer_touch(werte: dict) -> int:
    """Was die Bruecke als `--drehung` bekommt."""
    return (int(werte["touchVersatz"]) + int(werte["bild"])) % 360


# ── Der bewaehrte Stand ────────────────────────────────────────────────────
def bewaehrt_lesen() -> dict:
    """Die zuletzt BESTAETIGTE Einstellung — der Anker des Rueckwegs.

    Fehlt sie (erste Umstellung nach dem Einspielen), gilt die Einstellung, die
    gerade in der Konfiguration steht. Nicht 0/0: eine Box, die schon laenger
    mit Versatz 180 laeuft, wuerde sonst bei der ersten Ruecknahme auf einen
    Stand „zurueck"gestellt, den sie nie hatte.
    """
    b = lies_json(BEWAEHRT)
    if isinstance(b, dict) and "bild" in b and "touchVersatz" in b:
        return {"bild": zahl(b["bild"], 0), "touchVersatz": zahl(b["touchVersatz"], 180)}
    return anzeige_aus(lies_konfig())


def bewaehrt_setzen(werte: dict) -> None:
    schreib_json(BEWAEHRT, {
        "bild": int(werte["bild"]),
        "touchVersatz": int(werte["touchVersatz"]),
        "bestaetigt": time.strftime("%Y-%m-%d %H:%M:%S"),
    })


def schwebend_lesen() -> dict | None:
    s = lies_json(SCHWEBEND)
    return s if isinstance(s, dict) else None


def schwebend_loeschen() -> None:
    try:
        os.remove(SCHWEBEND)
    except OSError:
        pass


def schwebend_faellig(s: dict, jetzt: float | None = None) -> str | None:
    """Muss diese schwebende Umstellung zurueckgenommen werden? Wenn ja: warum.

    REINE FUNKTION, damit der Sandkasten sie ohne Box durchspielen kann
    (tools/drehung-sandkasten.py). Genau hier sitzt die Logik, die im Ernstfall
    ueber bedienbar/unbedienbar entscheidet — sie darf nicht nur am echten
    Geraet pruefbar sein.
    """
    if jetzt is None:
        jetzt = time.time()
    if s.get("boot_id") and s["boot_id"] != boot_id():
        return "neustart"
    try:
        if float(s.get("frist_bis", 0)) <= jetzt:
            return "frist"
    except (TypeError, ValueError):
        return "unlesbar"
    return None


# ── Das Bild drehen (X) ────────────────────────────────────────────────────
def x_umgebung() -> dict | None:
    """DISPLAY und XAUTHORITY fuer einen Aufruf als root finden.

    X gehoert hier root, wurde aber ueber `startx` als dietpi gestartet; ohne
    Berechtigungsdatei antwortet der Server „Authorization required" — auch dem
    Supernutzer. Am Geraet gemessen greifen sowohl ~dietpi/.Xauthority als auch
    die Serverdatei unter /tmp/serverauth.*; welche da ist, haengt davon ab, wie
    die Sitzung gestartet wurde, also werden beide probiert.
    """
    kandidaten = ["/home/dietpi/.Xauthority", "/root/.Xauthority"]
    try:
        kandidaten += sorted(
            f"/tmp/{n}" for n in os.listdir("/tmp") if n.startswith("serverauth.")
        )
    except OSError:
        pass
    if os.environ.get("XAUTHORITY"):
        kandidaten.insert(0, os.environ["XAUTHORITY"])
    for x in kandidaten:
        if not os.path.exists(x):
            continue
        umg = dict(os.environ, DISPLAY=os.environ.get("DISPLAY", ":0"), XAUTHORITY=x)
        try:
            p = subprocess.run(["xrandr", "--query"], env=umg, capture_output=True,
                               text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            continue
        if p.returncode == 0:
            return umg
    return None


def dsi_ausgang(umg: dict) -> str | None:
    """Den angeschlossenen DSI-Ausgang finden — nicht fest verdrahten.

    Auf dieser Box heisst er DSI-1-2. Der Name enthaelt die Nummer des
    Anschlusses und aendert sich, wenn das Panel am anderen DSI-Port haengt;
    ein fester Name waere eine Box, die still nichts dreht.
    """
    try:
        p = subprocess.run(["xrandr", "--query"], env=umg, capture_output=True,
                           text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    verbunden = []
    for zeile in p.stdout.splitlines():
        teile = zeile.split()
        if len(teile) >= 2 and teile[1] == "connected":
            verbunden.append(teile[0])
    for name in verbunden:
        if name.startswith("DSI"):
            return name
    return verbunden[0] if verbunden else None


def bild_drehen(grad: int) -> tuple[bool, str]:
    """Das Bild in X drehen. (geschafft, Meldung)

    NUR X, MIT ABSICHT. Der andere Weg waere die Boot-Konfiguration — der gilt
    dann zwar auch fuer Konsole und Startbildschirm, braucht aber einen
    Neustart, und ein Fehler dort IST der schwarze Schirm, den man nur noch mit
    der Karte in einem anderen Rechner behebt. Ueber X wirkt es sofort und ist
    ohne Neustart zurueckzunehmen — beides ist genau das, was ein
    Totmannschalter braucht.
    """
    umg = x_umgebung()
    if umg is None:
        return False, "X nicht erreichbar (laeuft der Kiosk?)"
    ausgang = dsi_ausgang(umg)
    if ausgang is None:
        return False, "kein angeschlossener Ausgang gefunden"
    richtung = "inverted" if grad == 180 else "normal"
    try:
        p = subprocess.run(["xrandr", "--output", ausgang, "--rotate", richtung],
                           env=umg, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"xrandr fehlgeschlagen: {e}"
    if p.returncode != 0:
        return False, f"xrandr: {p.stderr.strip()}"
    return True, f"{ausgang} -> {richtung}"


# ── Die Beruehrung drehen (Bruecke) ────────────────────────────────────────
def bruecke_neu_starten() -> tuple[bool, str]:
    """Die Bruecke liest ihre Drehung beim Start aus der Konfiguration.

    NEUSTART STATT NEULESEN IM BETRIEB, und zwar bewusst: die Drehung steckt in
    den Grenzwerten des uinput-Geraets (bei 90/270 tauschen Breite und Hoehe),
    die nur BEIM ANLEGEN gesetzt werden koennen. Ein Neulesen muesste das Geraet
    ohnehin ab- und wieder anmelden — dann kann gleich der Dienst neu starten,
    und systemd raeumt auf, wenn dabei etwas schiefgeht. Der Preis ist gut eine
    Sekunde ohne Beruehrung; ein dauerhaft falsch gedrehter Touch waere teurer.
    """
    try:
        p = subprocess.run(["systemctl", "restart", DIENST_BRUECKE],
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"{DIENST_BRUECKE}: {e}"
    if p.returncode != 0:
        return False, f"{DIENST_BRUECKE}: {p.stderr.strip()}"
    return True, f"{DIENST_BRUECKE} neu gestartet"


# ── Anwenden ───────────────────────────────────────────────────────────────
def anwenden(werte: dict, mit_bruecke: bool = True) -> dict:
    """Bild und Beruehrung auf `werte` bringen. Meldet, was geklappt hat.

    REIHENFOLGE: erst die Beruehrung, dann das Bild. Wer es andersherum macht,
    hat zwischen den beiden Schritten ein gedrehtes Bild mit ungedrehtem Touch
    — und wenn der zweite Schritt scheitert, bleibt es dabei. Andersherum ist
    das Zwischenstadium „Bild richtig herum, Touch falsch", was ebenfalls
    unschoen ist, aber der haeufigere Fehlschlag ist der von xrandr (X noch
    nicht da), und der soll nicht mit einem verdrehten Touch enden.
    """
    ergebnis = {"bild": werte["bild"], "touchVersatz": werte["touchVersatz"],
                "touchWirksam": wirksamer_touch(werte), "schritte": []}
    if mit_bruecke:
        ok, m = bruecke_neu_starten()
        ergebnis["schritte"].append({"was": "beruehrung", "ok": ok, "meldung": m})
    ok, m = bild_drehen(int(werte["bild"]))
    ergebnis["schritte"].append({"was": "bild", "ok": ok, "meldung": m})
    return ergebnis


# ── Boot-Dateien sichern ───────────────────────────────────────────────────
def boot_verzeichnis() -> str | None:
    for d in ("/boot/firmware", "/boot"):
        if os.path.exists(f"{d}/config.txt"):
            return d
    return None


def boot_sichern() -> str | None:
    """Datierte Kopie von config.txt und cmdline.txt.

    Diese Datei aendert die Boot-Konfiguration NICHT. Die Kopie entsteht
    trotzdem bei jeder Umstellung, weil sie fast nichts kostet (zwei Dateien,
    zusammen wenige Kilobyte) und weil sie den einen Fall abdeckt, den man
    sonst nicht abdeckt: jemand hat dort von Hand `video=…,rotate=180` oder
    `lcd_rotate` eingetragen und weiss hinterher nicht mehr, wie es vorher
    aussah. Zurueck kommt sie mit `--zuruecknehmen --auch-boot`.
    """
    quelle = boot_verzeichnis()
    if quelle is None:
        return None
    ziel = f"{BOOT_SICHERUNG}/{time.strftime('%Y-%m-%d_%H-%M-%S')}"
    try:
        os.makedirs(ziel, exist_ok=True)
        for name in BOOT_DATEIEN:
            p = f"{quelle}/{name}"
            if os.path.exists(p):
                shutil.copy2(p, f"{ziel}/{name}")
    except OSError as e:
        print(f"Boot-Sicherung fehlgeschlagen: {e}", file=sys.stderr)
        return None
    return ziel


def boot_datei_ersetzen(quelle: str, ziel: str) -> None:
    """Eine Boot-Datei ersetzen, ohne sie unterwegs zerstoeren zu koennen.

    ERST DANEBEN SCHREIBEN, DANN UMBENENNEN — dieselbe Vorsicht wie in
    `schreib_json`, und hier ist sie noch noetiger. `shutil.copy2` direkt auf
    `config.txt` oeffnet die Datei mit O_TRUNC: ab diesem Augenblick ist die
    alte Fassung weg, und was danach hineingeht, haengt daran, dass Platz da
    ist und der Strom bleibt.

    GEMESSEN im Sandkasten (tools/drehung-sandkasten.py, Teil E): Karte voll
    mitten im Zurueckspielen, und `config.txt` blieb mit 25 von 50 Zeichen
    liegen — ohne die Zeile `dtoverlay=vc4-kms-dsi-7inch`. Das ist der schwarze
    Schirm, und zwar ausgerechnet an der Stelle, die ihn beheben soll: dies
    ist der LETZTE Rettungsanker, der Weg, den man geht, wenn sonst nichts mehr
    geht. Ein Rueckweg, der beim Scheitern schlimmer zurueckliegt als vorher,
    ist keiner.

    `os.replace` ist auf FAT ein Umbenennen innerhalb desselben Verzeichnisses
    und damit unteilbar: entweder die alte Datei steht noch da, oder die neue
    steht vollstaendig da. Ein halber Stand kann nicht entstehen.
    """
    tmp = f"{ziel}.neu"
    try:
        shutil.copy2(quelle, tmp)
        with open(tmp, "rb+") as f:
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, ziel)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
    try:
        d = os.open(os.path.dirname(ziel) or ".", os.O_RDONLY)
        os.fsync(d)
        os.close(d)
    except OSError:
        pass


def boot_zurueck() -> str | None:
    """Die juengste Boot-Sicherung zurueckspielen."""
    ziel = boot_verzeichnis()
    if ziel is None or not os.path.isdir(BOOT_SICHERUNG):
        return None
    staende = sorted(os.listdir(BOOT_SICHERUNG))
    if not staende:
        return None
    quelle = f"{BOOT_SICHERUNG}/{staende[-1]}"
    try:
        for name in BOOT_DATEIEN:
            p = f"{quelle}/{name}"
            if os.path.exists(p):
                boot_datei_ersetzen(p, f"{ziel}/{name}")
    except OSError as e:
        print(f"Boot-Ruecknahme fehlgeschlagen: {e}", file=sys.stderr)
        return None
    return quelle


# ── Der Wecker ─────────────────────────────────────────────────────────────
def wecker_stellen(sekunden: int) -> tuple[bool, str]:
    """Die Frist gehoert PID 1, nicht diesem Prozess.

    `systemd-run --on-active` legt einen Kurzzeitwecker an. Der ueberlebt es,
    wenn dieser Prozess abgeschossen wird, wenn die Verwaltung abstuerzt, wenn
    die SSH-Sitzung zusammenbricht. Ein `fork()` mit `sleep()` haette all das
    nicht ueberlebt — und der Fall „der Dienst, der zurueckstellt, ist selbst
    kaputt" ist einer der Faelle, die hier gefangen werden sollen.
    """
    subprocess.run(["systemctl", "stop", f"{WECKER}.timer"],
                   capture_output=True, text=True)
    try:
        p = subprocess.run(
            ["systemd-run", f"--unit={WECKER}", f"--on-active={int(sekunden)}s",
             "--description=MuPiBox: ungepruefte Bildschirm-Drehung zuruecknehmen",
             sys.argv[0], "--frist-abgelaufen"],
            capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"systemd-run: {e}"
    if p.returncode != 0:
        return False, f"systemd-run: {p.stderr.strip()}"
    return True, f"Wecker auf {int(sekunden)} s"


def wecker_abbestellen() -> None:
    for unit in (f"{WECKER}.timer", f"{WECKER}.service"):
        subprocess.run(["systemctl", "stop", unit], capture_output=True, text=True)


# ── Die Befehle ────────────────────────────────────────────────────────────
def befehl_stand() -> int:
    konfig = lies_konfig()
    jetzt = anzeige_aus(konfig)
    s = schwebend_lesen()
    stand = {
        "jetzt": jetzt,
        "touchWirksam": wirksamer_touch(jetzt),
        "bewaehrt": bewaehrt_lesen(),
        "notaus": notaus_liegt(),
        "fristVorgabe": FRIST_VORGABE,
        "schwebend": None,
    }
    if s:
        rest = 0.0
        try:
            rest = max(0.0, float(s.get("frist_bis", 0)) - time.time())
        except (TypeError, ValueError):
            rest = 0.0
        stand["schwebend"] = {
            "bild": zahl(s.get("bild"), 0),
            "touchVersatz": zahl(s.get("touchVersatz"), 180),
            "restSekunden": int(rest),
            "faellig": schwebend_faellig(s),
        }
    print(json.dumps(stand, indent=2))
    return 0


def befehl_stellen(bild: int, touch_versatz: int | None, frist: int) -> int:
    if bild not in ERLAUBT:
        print(f"--bild: nur {ERLAUBT[0]} oder {ERLAUBT[1]}", file=sys.stderr)
        return 2
    if touch_versatz is not None and touch_versatz not in ERLAUBT:
        print(f"--touch-versatz: nur {ERLAUBT[0]} oder {ERLAUBT[1]}", file=sys.stderr)
        return 2
    anker = notaus_liegt()
    if anker:
        print(f"{anker} liegt — die Drehung ist von Hand stillgelegt. "
              "Datei entfernen, dann geht es wieder.", file=sys.stderr)
        return 3
    frist = max(FRIST_MIN, min(FRIST_MAX, int(frist)))

    alt = anzeige_aus(lies_konfig())
    neu = {"bild": bild,
           "touchVersatz": alt["touchVersatz"] if touch_versatz is None else touch_versatz}

    # ══ DER RUECKFALL IST NICHT „WAS GERADE DASTEHT" ══════════════════════════
    #
    # GEMESSEN im Sandkasten (tools/drehung-sandkasten.py, Teil D): zweimal
    # `--stellen` hintereinander, ohne dazwischen zu bestaetigen, und der
    # Rueckweg zeigte auf 180 — also auf die UNGEPRUEFTE Einstellung. Danach
    # nahm weder der Wecker noch der Neustart noch `--zuruecknehmen` das Bild
    # zurueck; alle drei landeten wieder auf dem Kopf.
    #
    # DAS IST GENAU DER HANDGRIFF, DEN EIN MENSCH MACHT. Der Schirm sieht falsch
    # aus, also stellt man nochmal — oder man dreht das Bild und will gleich
    # darauf noch den Panelversatz nachziehen. Zwei Klicks, und der
    # Totmannschalter faellt auf den Zustand zurueck, vor dem er schuetzen soll.
    #
    # `anzeige_aus(lies_konfig())` ist der falsche Anker, weil `--stellen` die
    # neuen Werte SOFORT hineinschreibt (Zeile weiter unten). Was dort steht,
    # ist ab dem ersten Aufruf die schwebende Einstellung, nicht die bewaehrte.
    # Der richtige Anker ist das `alt` der bereits schwebenden Umstellung: das
    # ist der letzte Stand, den jemand tatsaechlich gesehen hat.
    offen = schwebend_lesen()
    if offen and isinstance(offen.get("alt"), dict):
        rueckfall = {"bild": zahl(offen["alt"].get("bild"), 0),
                     "touchVersatz": zahl(offen["alt"].get("touchVersatz"), 180)}
    else:
        rueckfall = alt

    # DER ANKER WIRD VOR DER UMSTELLUNG GESETZT, nicht danach: was hier
    # dasteht, ist der Stand, auf den zurueckgefallen wird. Wer ihn erst
    # hinterher schreibt, hat zwischen Umstellung und Anker ein Zeitfenster
    # ohne Rueckweg — genau die Sekunden, in denen der Strom ausfaellt.
    if not os.path.exists(BEWAEHRT):
        bewaehrt_setzen(rueckfall)

    if neu == alt and not offen:
        print(json.dumps({"ok": True, "unveraendert": True, **neu}))
        return 0

    sicherung = boot_sichern()
    schreib_json(SCHWEBEND, {
        "bild": neu["bild"],
        "touchVersatz": neu["touchVersatz"],
        "alt": rueckfall,
        "frist_bis": time.time() + frist,
        "frist": frist,
        "boot_id": boot_id(),
        "gestellt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "boot_sicherung": sicherung,
    })
    ok_wecker, m_wecker = wecker_stellen(frist)

    # ERST DER WECKER, DANN DIE UMSTELLUNG. Laesst sich der Wecker nicht
    # stellen, wird gar nicht erst gedreht — lieber „geht nicht" als „gedreht
    # und niemand holt es zurueck". Der Wachtimer waere zwar noch da, aber auf
    # den allein soll sich niemand verlassen muessen.
    if not ok_wecker:
        schwebend_loeschen()
        print(json.dumps({"ok": False, "fehler": f"Rueckfall nicht scharf: {m_wecker}"}))
        return 1

    schreib_anzeige(neu)
    ergebnis = anwenden(neu)
    print(json.dumps({"ok": True, "frist": frist, "wecker": m_wecker,
                      "bootSicherung": sicherung, **ergebnis}, indent=2))
    return 0


def befehl_bestaetigen() -> int:
    s = schwebend_lesen()
    if not s:
        print(json.dumps({"ok": True, "nichtsOffen": True}))
        return 0
    grund = schwebend_faellig(s)
    if grund:
        # Zu spaet. NICHT trotzdem bestaetigen: die Bestaetigung heisst „ich
        # sehe das Bild JETZT". Ist die Frist um oder war die Box neu gestartet,
        # ist das eine Aussage ueber einen Zustand, den es nicht mehr gibt.
        befehl_zuruecknehmen(auch_boot=False)
        print(json.dumps({"ok": False, "grund": grund,
                          "meldung": "Frist war abgelaufen — zurueckgestellt"}))
        return 1
    wecker_abbestellen()
    neu = {"bild": zahl(s.get("bild"), 0), "touchVersatz": zahl(s.get("touchVersatz"), 180)}
    bewaehrt_setzen(neu)
    schwebend_loeschen()
    print(json.dumps({"ok": True, "bewaehrt": neu}))
    return 0


def befehl_zuruecknehmen(auch_boot: bool = False) -> int:
    wecker_abbestellen()
    s = schwebend_lesen()
    # Der Rueckweg nimmt den Stand aus der SCHWEBENDEN Umstellung, wenn es eine
    # gibt („alt"), sonst den bewaehrten. Beides ist dasselbe, solange nichts
    # danebengegangen ist; unterscheiden muss man es, wenn `bewaehrt.json`
    # fehlt, weil jemand die Datei geloescht hat.
    ziel = None
    if s and isinstance(s.get("alt"), dict):
        ziel = {"bild": zahl(s["alt"].get("bild"), 0),
                "touchVersatz": zahl(s["alt"].get("touchVersatz"), 180)}
    if ziel is None:
        ziel = bewaehrt_lesen()
    schwebend_loeschen()
    schreib_anzeige(ziel)
    bewaehrt_setzen(ziel)
    ergebnis = anwenden(ziel)
    sicherung = boot_zurueck() if auch_boot else None
    print(json.dumps({"ok": True, "zurueckAuf": ziel, "bootZurueck": sicherung,
                      **ergebnis}, indent=2))
    return 0


def befehl_nachsehen() -> int:
    """Wachtimer und Start: nachsehen, ob etwas Ungepruefetes offen steht.

    Laeuft alle 30 s und einmal frueh beim Hochfahren. Der fruehe Lauf ist der
    wichtige: er faengt „die Box wurde waehrend der Frist ausgesteckt". Dann
    steht `schwebend.json` noch da, aber mit der `boot_id` des VORIGEN Laufs —
    und wird zurueckgenommen, bevor der Kiosk ueberhaupt startet.
    """
    anker = notaus_liegt()
    if anker:
        jetzt = anzeige_aus(lies_konfig())
        if jetzt["bild"] != 0:
            print(f"{anker} liegt — Bilddrehung auf 0")
            schwebend_loeschen()
            ziel = {"bild": 0, "touchVersatz": jetzt["touchVersatz"]}
            schreib_anzeige(ziel)
            bewaehrt_setzen(ziel)
            anwenden(ziel)
            return 0
        return 0
    s = schwebend_lesen()
    if not s:
        return 0
    grund = schwebend_faellig(s)
    if not grund:
        return 0
    print(f"Ungepruefte Drehung wird zurueckgenommen (Grund: {grund})")
    return befehl_zuruecknehmen(auch_boot=False)


def befehl_anwenden() -> int:
    """Was in der Konfiguration steht, auf Bild und Bruecke uebertragen.

    Wird vom Kiosk-Start gerufen, NACHDEM X und force-dsi-output.sh da sind.
    Ruft vorher `--nachsehen`: kaeme die Box mit einer ungepruefeten Drehung
    hoch (Strom weg waehrend der Frist), wuerde sie sie hier sonst brav
    anwenden — der Wachtimer holt es zwar auch, aber erst nach bis zu 30 s, und
    in diesen 30 s sieht das Kind einen Schirm auf dem Kopf.
    """
    befehl_nachsehen()
    werte = anzeige_aus(lies_konfig())
    # Die Bruecke haelt der Dienst; beim Kiosk-Start laeuft sie schon mit den
    # richtigen Werten (sie liest dieselbe Datei). Ein Neustart hier waere ein
    # unnoetiges Loch in der Beruehrung genau dann, wenn das Kind hinschaut.
    ergebnis = anwenden(werte, mit_bruecke=False)
    print(json.dumps(ergebnis))
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        prog="bootwache.py",
        description="Bildschirm-Drehung mit Totmannschalter (0 oder 180 Grad).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    p.add_argument("--stand", action="store_true")
    p.add_argument("--stellen", action="store_true")
    p.add_argument("--bild", type=int)
    p.add_argument("--touch-versatz", type=int, dest="touch_versatz")
    p.add_argument("--frist", type=int, default=FRIST_VORGABE)
    p.add_argument("--bestaetigen", action="store_true")
    p.add_argument("--zuruecknehmen", action="store_true")
    p.add_argument("--auch-boot", action="store_true", dest="auch_boot")
    p.add_argument("--nachsehen", action="store_true")
    p.add_argument("--frist-abgelaufen", action="store_true", dest="frist_abgelaufen")
    p.add_argument("--anwenden", action="store_true")
    a = p.parse_args(argv)

    if a.zuruecknehmen:
        return befehl_zuruecknehmen(auch_boot=a.auch_boot)
    if a.bestaetigen:
        return befehl_bestaetigen()
    if a.frist_abgelaufen:
        return befehl_nachsehen()
    if a.nachsehen:
        return befehl_nachsehen()
    if a.anwenden:
        return befehl_anwenden()
    if a.stellen:
        if a.bild is None:
            print("--stellen braucht --bild 0 oder --bild 180", file=sys.stderr)
            return 2
        return befehl_stellen(a.bild, a.touch_versatz, a.frist)
    return befehl_stand()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
