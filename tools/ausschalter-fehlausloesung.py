#!/usr/bin/env python3
"""FAEHRT DIE BOX HERUNTER, WENN SIE NICHT SOLL?

  python3 tools/ausschalter-fehlausloesung.py
  python3 tools/ausschalter-fehlausloesung.py --nur prellen
  python3 tools/ausschalter-fehlausloesung.py --laut

══ EINE EINZIGE FRAGE ═══════════════════════════════════════════════════════
`tools/ausschalter-sandkasten.py` fragt, OB der Ausschalter funktioniert.
Diese Datei fragt nur eines, dafuer haertnaeckig:

    Gibt es einen Weg, auf dem die Box herunterfaehrt, obwohl niemand sie
    ausschalten wollte?

Das ist die Richtung, die ein Kind mitten im Hoerspiel trifft — und die
Richtung, die man am Geraet nicht mehr korrigieren kann, wenn schon der Griff
zum Menue die Box abschaltet.

Deshalb ist der Taster hier kein Schalter, sondern ein FAHRPLAN in
Millisekunden: prellende Kontakte, Streifen, Tippen im Takt der Abtastung,
Loslassen einen Wimpernschlag vor der Frist. Und deshalb wird jeder unsinnige
`pressDelay` nicht nur eingestellt, sondern danach ANGETIPPT.

══ WAS ANDERS IST ALS IM SANDKASTEN NEBENAN ═════════════════════════════════
1. DER FAHRPLAN. Der Taster wird von einem Faden nach Uhrzeit geschrieben, in
   Millisekunden, unabhaengig davon, was das Skript gerade tut. Ein Fahrplan
   kann prellen; ein Schalter, den der Pruefling selbst weiterstellt, nicht.
2. DER WAECHTER DARF GROB SEIN (`wache_takt_ms`). Hier stand bis zum
   08.08.2026 „`gpioget` darf etwas kosten" — das war richtig, solange jede
   Probe der Halteschleife einen Prozess startete. Seither liest das Skript
   den Tasterstand mit dem eingebauten `read` aus einer Datei auf tmpfs; am
   Geraet gemessen sind das 1000 Blicke in 17 ms, eine Probe kostet also
   nichts mehr. Was bleibt, ist, wie schnell der WAECHTER eine Flanke meldet:
   am Geraet kommt sie vom Kernel, hier wird sie kuenstlich verschleppt.
3. DIE ERWARTUNG IST IMMER DIESELBE: kein Abschalten. Nur zwei Faelle
   erwarten eines — sie sind die Gegenprobe dafuer, dass hier ueberhaupt
   etwas ausloesen KANN.

══ WIE DAS SKRIPT UNVERAENDERT BLEIBT ═══════════════════════════════════════
Ueber `BASH_ENV`: bash liest diese Datei im selben Prozess ein, bevor das
Skript laeuft, und Funktionen schlagen bei der Befehlssuche alles — auch
absolute Pfade. `sudo`, `poweroff`, `service`, `mkdir`, `chmod`, `rrdtool` und
die Pfade nach /usr/bin sind nachgestellt. `LOGFILE`, `CONFIG`, die vier Pfade
des Waechters und die beiden Toene sind `readonly` und zeigen in den
Sandkasten; die Zuweisungen des Skripts prallen ab. `sleep` bleibt ECHT —
sonst waere jede gemessene Frist erfunden.

Der WAECHTER ist kein Vorspann-Nachbau, sondern ein echtes Programm
(tools/ausschalter-nachgestellte-wache.py), das ueber eine benannte Roehre mit
dem Skript redet — so wie `taster_wache.py` es am Geraet tut.

NICHTS HIERIN FAEHRT ETWAS HERUNTER. `poweroff` schreibt einen Zeitstempel in
eine Datei und kehrt zurueck.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SKRIPT = WURZEL / "scripts" / "OnOffShim" / "off_trigger.sh"

# An diesem Baum arbeiten mehrere Sitzungen gleichzeitig; `off_trigger.sh` kann
# sich waehrend eines Laufs unter der Hand aendern. Mit `--stand <commit>` holt
# dieses Werkzeug eine FESTE Fassung aus der Versionsgeschichte in eine eigene
# Datei — dann steht in jeder Zeile des Berichts, was genau gemessen wurde.
_HERKUNFT = "Arbeitsbaum"

# Der nachgestellte Waechter. Seit dem 08.08.2026 ruft `off_trigger.sh` kein
# `gpioget`/`gpiomon` mehr (die es auf der Box gar nicht gibt), sondern startet
# EINMAL `taster_wache.py` und liest von ihm durch eine benannte Roehre.
NACHGESTELLTE_WACHE = Path(__file__).resolve().parent / "ausschalter-nachgestellte-wache.py"

# Wie fein der Nachbau auf den Taster sieht. Am Geraet meldet der Kernel die
# Flanken und verpasst grundsaetzlich keine; der Nachbau muss deshalb VIEL
# feiner nachsehen als das Skript probt (40 bis 90 ms), sonst waere er
# gutmuetiger als die Wirklichkeit.
FLANKE_TAKT_S = 0.002


VORSPANN = r"""
SK="__SK__"
readonly LOGFILE="$SK/protokoll.log"
readonly CONFIG="$SK/mupiboxconfig.json"

merken() { printf '%s\t%s\t%s\n' "$(command date +%s%3N)" "$1" "$2" >> "$SK/spur"; }

sudo() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -n|-E|-H|-S) shift ;;
            -u) shift 2 ;;
            *) break ;;
        esac
    done
    "$@"
}

# ── DER TASTER ───────────────────────────────────────────────────────────
# "0" = gedrueckt (der Taster zieht nach Masse), "1" = losgelassen.
# Den Stand schreibt der Fahrplan aus Python, nach Uhrzeit.
#
# ══ HIER STANDEN `gpioget` UND `gpiomon`, UND MIT IHNEN EIN PREISSCHILD ══
# `__GPIOGET_MS__` stellte nach, was ein `sudo gpioget` auf einem
# beschaeftigten Pi kostet — es verschob die Abtastpunkte des Skripts und
# machte damit sichtbar, ob eine Tippfolge sich mit ihnen ueberlagern kann.
# Das war richtig, solange JEDE Probe einen Prozess startete.
#
# SEIT DEM 08.08.2026 KOSTET EINE PROBE NICHTS MEHR. Das Skript liest den
# Tasterstand mit dem eingebauten `read` aus einer Datei auf tmpfs; am Geraet
# gemessen sind das 1000 Blicke in 17 ms, also 0,017 ms statt der 44 ms, die
# ein `sudo python3 …` gekostet haette. Ein Preisschild fuer etwas, das nichts
# mehr kostet, misst nichts.
#
# WAS AN SEINE STELLE TRITT, ist die Groebe des WAECHTERS (`--takt` unten):
# wie schnell er eine Flanke ueberhaupt meldet. Am Geraet kommt sie vom Kernel
# und wird nie verpasst; der Nachbau kann sie kuenstlich verschleppen, und
# genau daran laesst sich weiter messen, ob ein Trommeln durchkommt.
#
# DIE VIER PFADE SIND `readonly` — dieselbe Mechanik wie bei LOGFILE und
# CONFIG. So legt kein Lauf eine Roehre nach /run/mupibox.
readonly WACHE="__WACHE__"
readonly LAUFVERZ="$SK"
readonly MELDEROHR="$SK/melderohr"
readonly ZUSTANDSDATEI="$SK/zustand"

# Der Bestaetigungston. Auf der Box .169 fehlt das ganze Verzeichnis sysmedia;
# hier ist er DA, damit die Faelle unten den Normalfall messen.
readonly TON_KNOPF="$SK/ton.wav"
readonly TON_ERSATZ="$SK/ton-ersatz.wav"

# ── DAS AUSSCHALTEN, DAS NUR MITSCHREIBT ─────────────────────────────────
# Es kehrt ZURUECK. Nur so laesst sich zaehlen, ob es zweimal kaeme.
poweroff() { merken POWEROFF "$*"; return 0; }
shutdown() { merken POWEROFF "$*"; return 0; }
reboot()   { merken POWEROFF "$*"; return 0; }
halt()     { merken POWEROFF "$*"; return 0; }

service()    { merken DIENST "$*"; return 0; }
systemctl()  { merken DIENST "$*"; return 0; }

# Der Kopf des Skripts legt /tmp/.rrd an. Auf dieser Arbeitsmaschine laufen
# fremde Sitzungen — es wird nichts ausserhalb des Sandkastens angefasst.
# Der Kopf legt /tmp/.rrd an — das wird abgefangen. `mkdir -p "$LAUFVERZ"`
# aber muss ECHT laufen, sonst gibt es das Sandkastenverzeichnis fuer die
# Roehre nicht. Frueher fing diese Funktion alles ab; damals brauchte das
# Skript auch kein eigenes Verzeichnis.
mkdir()  { case "$*" in *"/tmp/.rrd"*) merken MKDIR "$*"; return 0 ;; esac; command mkdir "$@"; }
chmod()  { merken CHMOD "$*"; return 0; }
rrdtool(){ merken RRD "$*"; return 0; }

/usr/bin/aplay() { merken TON "$*"; return 0; }
/usr/bin/pactl() { merken PACTL "$*"; return 0; }
/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; return 0; }

# jq und awk bleiben echt, aber ueber die Sandkasten-Konfiguration.
__JQ_STUB__
"""

JQ_ECHT = ""
JQ_FEHLT = r"""
/usr/bin/jq() { merken JQFEHLT "$*"; return 127; }
"""


# ════ DER FAHRPLAN ═══════════════════════════════════════════════════════════


class Fahrplan(threading.Thread):
    """Schreibt den Tasterstand nach Uhrzeit — unabhaengig vom Pruefling.

    `plan` ist eine Folge von (ms_seit_start, "0"|"1"). Geschrieben wird ueber
    eine Hilfsdatei und `rename`, damit der Pruefling nie eine halb
    geschriebene Datei liest (ein leerer Lesevorgang saehe aus wie
    „losgelassen" und wuerde eine Messung still schoenen).
    """

    def __init__(self, datei: Path, plan, laufzeit_ms: int):
        super().__init__(daemon=True)
        self.datei = datei
        self.plan = sorted(plan)
        self.laufzeit_ms = laufzeit_ms
        self.start_zeit = None
        self._stop = threading.Event()

    def schreiben(self, wert: str) -> None:
        tmp = self.datei.with_suffix(".neu")
        tmp.write_text(wert)
        os.replace(tmp, self.datei)

    def run(self) -> None:
        self.start_zeit = time.monotonic()
        for ms, wert in self.plan:
            ziel = self.start_zeit + ms / 1000.0
            while True:
                rest = ziel - time.monotonic()
                if rest <= 0 or self._stop.is_set():
                    break
                time.sleep(min(rest, 0.002))
            if self._stop.is_set():
                return
            self.schreiben(wert)
        rest = self.start_zeit + self.laufzeit_ms / 1000.0 - time.monotonic()
        if rest > 0:
            self._stop.wait(rest)

    def anhalten(self) -> None:
        self._stop.set()


# ════ EIN LAUF ═══════════════════════════════════════════════════════════════


class Lauf:
    def __init__(self, skript: Path, press_delay, *, wache_takt_ms=0,
                 wache="normal", jq=True, konfig=None, sprache=None,
                 trigger_pin="17", ton=True):
        self.skript = skript
        self.press_delay = press_delay
        # Wie GROB der Waechter meldet, in Millisekunden. 0 heisst: so fein wie
        # moeglich (FLANKE_TAKT_S). Der Nachfolger von `gpioget_ms` — die
        # Begruendung steht im Vorspann.
        self.wache_takt_ms = wache_takt_ms
        # "normal" | "nicht-bereit" (kommt hoch, meldet aber nie BEREIT)
        # | "fehlt" (das Programm gibt es gar nicht)
        self.wache = wache
        self.ton = ton
        self.jq = jq
        self.konfig = konfig
        self.sprache = sprache
        self.trigger_pin = trigger_pin
        self.verz = Path(tempfile.mkdtemp(prefix="ausschalter-fehl-"))
        self.spur = self.verz / "spur"
        self.taster = self.verz / "taster"

    def aufbauen(self) -> None:
        self.taster.write_text("1")
        self.spur.touch()
        (self.verz / "protokoll.log").touch()

        if self.konfig == "fehlt":
            pass
        elif self.konfig == "kaputt":
            (self.verz / "mupiboxconfig.json").write_text("{ das ist kein JSON")
        else:
            inhalt = {
                "shim": {"triggerPin": self.trigger_pin},
                "mupibox": {"startVolume": "40"},
                "timeout": {},
            }
            if self.press_delay is not _FEHLT:
                inhalt["timeout"]["pressDelay"] = self.press_delay
            (self.verz / "mupiboxconfig.json").write_text(json.dumps(inhalt))

        if self.ton:
            (self.verz / "ton.wav").write_bytes(b"RIFF")

        # ── DER WAECHTER ALS AUFRUFBARES PROGRAMM ────────────────────────
        #
        # `off_trigger.sh` ruft ihn mit den Schaltern, die auch das echte
        # Programm kennt. Was der Nachbau zusaetzlich braucht, steht in einem
        # Huellskript — so bleibt der Aufruf im Skript UNVERAENDERT der, der
        # auf der Box steht.
        #
        # "fehlt" zeigt bewusst auf einen Pfad, den es NICHT gibt: das stellt
        # eine Box nach, auf der der Helfer nicht ausgerollt wurde. Genau so
        # sah es bis zum 08.08.2026 mit `gpiod` aus.
        wache_pfad = self.verz / "wache.sh"
        if self.wache == "fehlt":
            wache_pfad = self.verz / "gibt-es-nicht.sh"
        else:
            takt = (self.wache_takt_ms / 1000.0) if self.wache_takt_ms else FLANKE_TAKT_S
            zusatz = "--nicht-bereit" if self.wache == "nicht-bereit" else ""
            wache_pfad.write_text(
                "#!/bin/sh\n"
                f'exec python3 "{NACHGESTELLTE_WACHE}" '
                f'--taster "{self.taster}" --protokoll "{self.spur}" '
                f'--takt {takt} {zusatz} "$@"\n'
            )
            wache_pfad.chmod(0o755)

        vorspann = (
            VORSPANN.replace("__SK__", str(self.verz))
            .replace("__WACHE__", str(wache_pfad))
            .replace("__JQ_STUB__", JQ_ECHT if self.jq else JQ_FEHLT)
        )
        (self.verz / "vorspann.sh").write_text(vorspann)

    def fahren(self, plan, laufzeit_ms: int):
        self.aufbauen()
        umgebung = dict(os.environ)
        umgebung["BASH_ENV"] = str(self.verz / "vorspann.sh")
        umgebung["PATH"] = os.environ.get("PATH", "/usr/bin:/bin")
        if self.sprache:
            umgebung["LC_ALL"] = self.sprache
            umgebung["LC_NUMERIC"] = self.sprache

        prozess = subprocess.Popen(
            ["bash", str(self.skript)],
            env=umgebung,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            preexec_fn=os.setsid,
        )
        fahrplan = Fahrplan(self.taster, plan, laufzeit_ms)
        # Dem Skript einen Wimpernschlag Vorlauf lassen, damit `gpiomon` schon
        # wacht, wenn die erste Flanke kommt. Sonst pruefte man den Vorlauf
        # statt den Knopf.
        time.sleep(0.35)
        t0 = time.monotonic()
        fahrplan.start()
        fahrplan.join(timeout=laufzeit_ms / 1000.0 + 5)
        fahrplan.anhalten()

        import signal as _s
        try:
            os.killpg(os.getpgid(prozess.pid), _s.SIGKILL)
        except ProcessLookupError:
            pass
        prozess.wait(timeout=5)

        return self._auswerten(t0)

    def _auswerten(self, t0):
        zeilen = []
        if self.spur.exists():
            for zeile in self.spur.read_text().splitlines():
                teile = zeile.split("\t")
                if len(teile) >= 2:
                    zeilen.append((int(teile[0]), teile[1], teile[2] if len(teile) > 2 else ""))
        return Ergebnis(zeilen, self.verz)

    def aufraeumen(self):
        shutil.rmtree(self.verz, ignore_errors=True)


class _Fehlt:
    def __repr__(self):
        return "<fehlt>"


_FEHLT = _Fehlt()


class Ergebnis:
    def __init__(self, spur, verz):
        self.spur = spur
        self.verz = verz

    @property
    def aus(self):
        return [z for z in self.spur if z[1] == "POWEROFF"]

    @property
    def anzahl_aus(self):
        return len(self.aus)

    @property
    def flanken(self):
        return [z for z in self.spur if z[1] == "FLANKE"]

    def frist_ms(self):
        """Von der ersten erkannten Flanke bis zum Abschalten."""
        if not self.flanken or not self.aus:
            return None
        return self.aus[0][0] - self.flanken[0][0]

    def protokoll(self):
        p = self.verz / "protokoll.log"
        return p.read_text() if p.exists() else ""


# ════ DIE FAELLE ═════════════════════════════════════════════════════════════


class Pruefung:
    def __init__(self):
        self.aussagen = []

    def sagt(self, gruppe, name, gut, text):
        self.aussagen.append((gruppe, name, bool(gut), text))
        return gut

    @property
    def rot(self):
        return [a for a in self.aussagen if not a[2]]


def tippen(anzahl, druck_ms, pause_ms, ab_ms=0):
    """Eine Folge von Tippern: druck_ms gedrueckt, pause_ms los."""
    plan = []
    t = ab_ms
    for _ in range(anzahl):
        plan.append((t, "0"))
        t += druck_ms
        plan.append((t, "1"))
        t += pause_ms
    return plan, t


def lauf(press_delay, plan, laufzeit_ms, **kw):
    l = Lauf(SKRIPT, press_delay, **kw)
    try:
        return l.fahren(plan, laufzeit_ms)
    finally:
        if not os.environ.get("BEHALTEN"):
            l.aufraeumen()


# ── Gruppe: kurze Beruehrungen ───────────────────────────────────────────────

def gruppe_beruehrung(p, laut):
    faelle = [
        ("streifen 30 ms", [(0, "0"), (30, "1")], 1500),
        ("antippen 300 ms", [(0, "0"), (300, "1")], 1800),
        ("antippen 900 ms", [(0, "0"), (900, "1")], 2400),
        ("antippen 1900 ms (knapp unter der Frist 2 s)",
         [(0, "0"), (1900, "1")], 3400),
    ]
    for name, plan, dauer in faelle:
        e = lauf("2", plan, dauer)
        p.sagt("beruehrung", name, e.anzahl_aus == 0,
               f"{e.anzahl_aus}x poweroff (erwartet 0)")
        if laut:
            print(f"    {name}: {e.anzahl_aus}x")


# ── Gruppe: Prellen ──────────────────────────────────────────────────────────

def gruppe_prellen(p, laut):
    # Ein mechanischer Taster prellt: der Pegel flackert einige Millisekunden.
    prell = []
    t = 0
    for _ in range(6):
        prell.append((t, "0")); t += 4
        prell.append((t, "1")); t += 4
    prell.append((t, "1"))
    e = lauf("2", prell, 1500)
    p.sagt("prellen", "prellender Kontakt, danach los", e.anzahl_aus == 0,
           f"{e.anzahl_aus}x poweroff (erwartet 0)")

    # Prellen und DANN wirklich halten: das muss GENAU EINMAL ausschalten.
    prell2 = []
    t = 0
    for _ in range(6):
        prell2.append((t, "0")); t += 4
        prell2.append((t, "1")); t += 4
    prell2.append((t, "0"))
    e = lauf("2", prell2, 4000)
    p.sagt("prellen", "prellen, dann halten -> genau einmal", e.anzahl_aus == 1,
           f"{e.anzahl_aus}x poweroff (erwartet 1)")

    # Flackern MITTEN im Halten: 5 ms los, dann wieder drauf. Das Skript sieht
    # alle 0,2 s hin und kann diese Luecke verpassen — dann faehrt die Box
    # herunter, obwohl der Kontakt zwischendurch offen war. Es ist zu klein,
    # um „losgelassen" zu heissen; hier steht es als GEMESSENE Grenze.
    plan = [(0, "0"), (1000, "1"), (1005, "0")]
    e = lauf("2", plan, 4000)
    p.sagt("prellen", "5 ms Flackern beim Halten (Kontakt, kein Wille)",
           e.anzahl_aus == 1, f"{e.anzahl_aus}x poweroff (erwartet 1)")
    if laut:
        print(f"    Flackern 5 ms: {e.anzahl_aus}x")


# ── Gruppe: Tippen im Takt der Abtastung ─────────────────────────────────────

def gruppe_takt(p, laut):
    """DER KERN DIESER DATEI.

    Das Skript sieht in die Halteschleife hinein und fragt, ob der Knopf noch
    gedrueckt ist. Wer im selben Takt TIPPT, kann bei jeder Probe gerade wieder
    drauf sein — dann sieht die Schleife lauter „gedrueckt" und schaltet ab,
    obwohl der Knopf dazwischen jedes Mal los war. Deshalb probt sie
    unregelmaessig zwischen 0,04 und 0,09 s; gegen eine Resonanz hilft nur,
    dass es keinen Takt gibt, auf den sich etwas einschwingen kann.

    Geprueft wird ueber eine Reihe von Takten um 0,2 s herum, und dazu mit
    einem WAECHTER, DER GROB MELDET. Hier stand frueher „mit dem Preis eines
    `gpioget`" — das war richtig, solange jede Probe einen Prozess startete.
    Seit dem 08.08.2026 liest das Skript den Tasterstand mit dem eingebauten
    `read` aus einer Datei auf tmpfs (am Geraet gemessen: 1000 Blicke in
    17 ms), eine Probe kostet also nichts mehr. Was bleibt, ist die Frage, wie
    schnell der WAECHTER eine Flanke ueberhaupt meldet — am Geraet kommt sie
    vom Kernel und wird nie verpasst, hier wird sie kuenstlich verschleppt.
    """
    # Die vier ersten Takte haben die Fassung vom 07.08. JEDES MAL abgeschaltet
    # (3 von 3 Laeufen, jeweils). Sie sind der Grund, aus dem der Probentakt
    # unregelmaessig geworden ist, und sie bleiben hier stehen.
    for druck, pause in [(100, 100), (120, 80), (80, 120), (140, 60),
                         (150, 150), (180, 220), (250, 250), (400, 400),
                         (90, 110), (60, 40), (300, 100)]:
        plan, ende = tippen(14, druck, pause)
        e = lauf("2", plan, ende + 400)
        p.sagt("takt", f"tippen {druck}/{pause} ms, 14x", e.anzahl_aus == 0,
               f"{e.anzahl_aus}x poweroff (erwartet 0)")
        if laut:
            print(f"    {druck}/{pause}: {e.anzahl_aus}x")

    # Und dasselbe mit einem Waechter, der Flanken nur GROB meldet — 30 und
    # 60 ms statt der 2 ms des Nachbaus. Am Geraet ist er ereignisgetrieben und
    # verpasst gar nichts; das hier ist die pessimistische Annahme.
    for kosten in (30, 60):
        plan, ende = tippen(14, 150, 150)
        e = lauf("2", plan, ende + 400, wache_takt_ms=kosten)
        p.sagt("takt", f"tippen 150/150 ms bei einem Waechter, der nur alle {kosten} ms meldet",
               e.anzahl_aus == 0, f"{e.anzahl_aus}x poweroff (erwartet 0)")
        if laut:
            print(f"    150/150 @Waechtertakt {kosten}ms: {e.anzahl_aus}x")


# ── Gruppe: Loslassen an der Frist ───────────────────────────────────────────

def gruppe_frist(p, laut):
    for los_ms, erwartet in [(1800, 0), (1900, 0), (1950, 0), (1990, 0)]:
        e = lauf("2", [(0, "0"), (los_ms, "1")], 3600)
        p.sagt("frist", f"gehalten {los_ms} ms bei Frist 2000 ms",
               e.anzahl_aus == erwartet,
               f"{e.anzahl_aus}x poweroff (erwartet {erwartet})")
        if laut:
            print(f"    los nach {los_ms} ms: {e.anzahl_aus}x")

    # Gegenprobe: wirklich gehalten muss abschalten, sonst misst die Reihe
    # oben nur, dass hier gar nichts ausloest.
    e = lauf("2", [(0, "0")], 3600)
    p.sagt("frist", "durchgehalten -> genau einmal", e.anzahl_aus == 1,
           f"{e.anzahl_aus}x poweroff (erwartet 1)")
    if e.frist_ms() is not None:
        ms = e.frist_ms()
        p.sagt("frist", f"Frist 2 s wird nicht unterschritten (gemessen {ms} ms)",
               ms >= 2000, f"{ms} ms")
        p.sagt("frist", f"Frist 2 s bleibt unter der Platine bei 6 s ({ms} ms)",
               ms < 6000, f"{ms} ms")

    # Die laengste erlaubte Frist ist die gefaehrliche: bei 5 eingestellten
    # Sekunden liegt zwischen dem weichen Aus und dem HARTEN der Platine nur
    # noch eine Sekunde. Der dichtere Probentakt kostet Zeit — hier steht, wie
    # viel davon in dieser Sekunde landet.
    e = lauf("5", [(0, "0")], 7000)
    ms = e.frist_ms()
    p.sagt("frist", "Frist 5 s -> genau einmal", e.anzahl_aus == 1,
           f"{e.anzahl_aus}x poweroff")
    if ms is not None:
        p.sagt("frist", f"Frist 5 s wird nicht unterschritten ({ms} ms)",
               ms >= 5000, f"{ms} ms")
        p.sagt("frist", f"Frist 5 s bleibt vor der Platine bei 6 s ({ms} ms)",
               ms < 6000, f"{ms} ms")
    if laut:
        print(f"    Frist 5 s gemessen: {ms} ms")


# ── Gruppe: unsinniger pressDelay ────────────────────────────────────────────

MUELL = [
    ("0", "0"),
    ("0 als Zahl", 0),
    (" 0 mit Leerzeichen", " 0 "),
    ("-1", "-1"),
    ("2.25", "2.25"),
    ("abc", "abc"),
    ("leer", ""),
    ("fehlt", _FEHLT),
    ("null", None),
    ("99", "99"),
    ("1e9", "1e9"),
    ("0.4", "0.4"),
    (".5", ".5"),
    ("00", "00"),
    ("08", "08"),
    ("010", "010"),
    ("0x2", "0x2"),
    ("wahr", True),
    ("Liste", [2]),
    ("20 Stellen", "99999999999999999999"),
    ("13 Stellen", "9999999999999"),
    ("2 mit Zeilenumbruch", "2\n9"),
]


def gruppe_muell(p, laut):
    """NACH JEDEM UNSINN: ANTIPPEN. Faehrt sie?"""
    for name, wert in MUELL:
        e = lauf(wert, [(0, "0"), (300, "1")], 2000)
        gut = e.anzahl_aus == 0
        p.sagt("muell", f"pressDelay {name} -> Antippen schaltet nicht ab", gut,
               f"{e.anzahl_aus}x poweroff (erwartet 0)")
        if laut or not gut:
            print(f"    pressDelay {name!r}: antippen -> {e.anzahl_aus}x aus")


def gruppe_muell_gegenrichtung(p, laut):
    """Und die Gegenrichtung: sie muss trotzdem noch herunterfahren koennen."""
    for name, wert in [("0", "0"), ("abc", "abc"), ("fehlt", _FEHLT),
                       ("99", "99"), ("20 Stellen", "99999999999999999999")]:
        e = lauf(wert, [(0, "0")], 7000)
        p.sagt("muell-zurueck", f"pressDelay {name} -> Halten schaltet noch ab",
               e.anzahl_aus >= 1, f"{e.anzahl_aus}x poweroff (erwartet >=1)")
        if laut:
            ms = e.frist_ms()
            print(f"    pressDelay {name!r}: halten -> {e.anzahl_aus}x nach {ms} ms")


# ── Gruppe: der Waechter darf nicht LUEGEN ───────────────────────────────────

def gruppe_waechter(p, laut):
    """Wenn er nicht wachen kann, muss man das SEHEN.

    DIE FEHLERKLASSE IST DIESELBE GEBLIEBEN, DER ANLASS HAT SICH GEAENDERT.
    Bis zum 08.08.2026 hiess sie: auf der Box .169 gibt es `gpioget` und
    `gpiomon` nicht (Paket `gpiod` fehlt, obwohl autosetup.sh es fuehrt), und
    die Fassung vom 07.08. lief in diesem Fall einfach weiter — `systemctl
    status mupi_offtrigger` sagte „active (running)", das Protokoll meldete
    alle fuenf Sekunden „gpiomon started with PID …" und direkt danach einen
    Fehler, und der Knopf tat nichts.

    Seit dem Umbau auf `taster_wache.py` gibt es drei Tueren in denselben
    Zustand, und alle drei werden hier gemessen:

      * der Helfer ist gar nicht ausgerollt (auf der Box fehlte `gpiod` genau
        so, obwohl es im Rezept stand);
      * er kommt hoch, meldet aber nie BEREIT — die Leitung ist belegt, die
        Rechte fehlen, die Bibliothek fehlt;
      * er lebt eine Weile und stirbt dann.

    Gemessen wird nicht, ob abgeschaltet wird, sondern ob das Skript ENDET.
    Nur ein Ende macht `Restart=always` sichtbar. Und dazu die Gegenprobe:
    mit einem heilen Helfer muss es LAUFEN BLEIBEN — sonst maesse diese Gruppe
    nur, dass irgendetwas abstuerzt.
    """
    import signal as _s

    def laeuft_noch(sekunden=9, **kw):
        l = Lauf(SKRIPT, "2", **kw)
        l.aufbauen()
        u = dict(os.environ)
        u["BASH_ENV"] = str(l.verz / "vorspann.sh")
        pr = subprocess.Popen(["bash", str(SKRIPT)], env=u,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              preexec_fn=os.setsid)
        ende = time.monotonic() + sekunden
        while time.monotonic() < ende and pr.poll() is None:
            time.sleep(0.1)
        lebt = pr.poll() is None
        rc = pr.returncode
        try:
            os.killpg(os.getpgid(pr.pid), _s.SIGKILL)
            pr.wait(timeout=5)
        except (ProcessLookupError, OSError):
            pass
        l.aufraeumen()
        return lebt, rc

    lebt, rc = laeuft_noch(wache="fehlt")
    p.sagt("waechter", "taster_wache.py gar nicht ausgerollt -> der Dienst endet",
           not lebt and rc not in (0, None), f"laeuft noch: {lebt}, Rueckgabewert {rc}")
    if laut:
        print(f"    Helfer fehlt: laeuft noch={lebt} rc={rc}")

    lebt, rc = laeuft_noch(sekunden=30, wache="nicht-bereit")
    p.sagt("waechter", "Helfer da, meldet aber nie BEREIT -> der Dienst endet auch dann",
           not lebt and rc not in (0, None), f"laeuft noch: {lebt}, Rueckgabewert {rc}")
    if laut:
        print(f"    kein BEREIT: laeuft noch={lebt} rc={rc}")

    # Und die Gegenprobe: mit einem heilen Helfer muss er LAUFEN BLEIBEN.
    lebt, rc = laeuft_noch()
    p.sagt("waechter", "mit einem heilen Helfer laeuft er weiter", lebt,
           f"laeuft noch: {lebt}, Rueckgabewert {rc}")


# ── Gruppe: kaputte Umgebung ─────────────────────────────────────────────────

def gruppe_umgebung(p, laut):
    # GPIO nicht lesbar: der Helfer kommt hoch und meldet nie BEREIT.
    e = lauf("2", [(0, "0")], 4000, wache="nicht-bereit")
    p.sagt("umgebung", "GPIO nicht lesbar -> kein Abschalten", e.anzahl_aus == 0,
           f"{e.anzahl_aus}x poweroff (erwartet 0)")

    # HIER STAND EIN FALL FUER DAS AUSGABEFORMAT VON libgpiod 2 (`"17"=active`
    # statt einer nackten 0). Er ist ersatzlos weg, und das ist die richtige
    # Art, einen Fall loszuwerden: das Skript LIEST diese Ausgabe nicht mehr.
    # Es ruft `gpioget` ueberhaupt nicht mehr auf, sondern geht ueber lgpio,
    # das ganze Format-Problem der beiden libgpiod-Reihen gibt es nicht mehr.
    # Ein Fall, der ein verschwundenes Verhalten prueft, ist kein Schutz,
    # sondern Ballast — er wird gruen, egal was passiert.

    # Der Bestaetigungston fehlt (auf der Box .169 fehlt sysmedia ganz):
    # das darf das Abschalten NICHT aufhalten.
    e = lauf("2", [(0, "0")], 4000, ton=False)
    p.sagt("umgebung", "ohne Tondatei -> Halten schaltet trotzdem genau einmal ab",
           e.anzahl_aus == 1, f"{e.anzahl_aus}x poweroff (erwartet 1)")

    # Konfiguration kaputt.
    e = lauf("2", [(0, "0"), (300, "1")], 2500, konfig="kaputt")
    p.sagt("umgebung", "kaputte Konfiguration -> Antippen schaltet nicht ab",
           e.anzahl_aus == 0, f"{e.anzahl_aus}x poweroff (erwartet 0)")

    # jq fehlt.
    e = lauf("2", [(0, "0"), (300, "1")], 2500, jq=False)
    p.sagt("umgebung", "jq fehlt -> Antippen schaltet nicht ab",
           e.anzahl_aus == 0, f"{e.anzahl_aus}x poweroff (erwartet 0)")

    # triggerPin fehlt in der Konfiguration -> jq liefert "null".
    e = lauf("2", [(0, "0"), (300, "1")], 2500, trigger_pin=None)
    p.sagt("umgebung", "triggerPin null -> Antippen schaltet nicht ab",
           e.anzahl_aus == 0, f"{e.anzahl_aus}x poweroff (erwartet 0)")

    # Deutsche Spracheinstellung: EPOCHREALTIME traegt dann ein Komma.
    e = lauf("2", [(0, "0"), (300, "1")], 2500, sprache="de_DE.UTF-8")
    p.sagt("umgebung", "de_DE (Komma in EPOCHREALTIME) -> Antippen schaltet nicht ab",
           e.anzahl_aus == 0, f"{e.anzahl_aus}x poweroff (erwartet 0)")
    e = lauf("2", [(0, "0")], 4000, sprache="de_DE.UTF-8")
    p.sagt("umgebung", "de_DE -> Halten schaltet genau einmal ab",
           e.anzahl_aus == 1, f"{e.anzahl_aus}x poweroff (erwartet 1)")


# ── Gruppe: zwei Waechter ────────────────────────────────────────────────────

def gruppe_zweifach(p, laut):
    """Laeuft der Waechter zweimal, zaehlen zwei Schleifen denselben Druck.

    Auf einer Box, die einmal mit dem alten Rezept bespielt wurde, liegt das
    Skript noch in /var/lib/dietpi/postboot.d/ — und bis zum 08.08.2026 legte
    `update/start_mupibox_update.sh` es dort auch weiterhin hin. Dann gaebe es
    den Dienst UND den alten Weg, und zwei Schleifen zaehlten denselben Druck.
    Beide Rezepte raeumen den alten Stand jetzt mit `rm -f` weg; diese Gruppe
    bleibt trotzdem stehen, denn sie misst, WARUM das noetig ist.
    """
    l1 = Lauf(SKRIPT, "2")
    l2 = Lauf(SKRIPT, "2")
    try:
        l1.aufbauen()
        l2.aufbauen()
        # Beide auf denselben Taster sehen lassen.
        # BEIDE AUF DENSELBEN TASTER SEHEN LASSEN. Frueher stand der Pfad im
        # Vorspann (im nachgestellten `gpioget`); seit der Waechter ein eigenes
        # Programm ist, steht er in dessen Huellskript. Umgebogen wird dort.
        l2.taster = l1.taster
        w2 = l2.verz / "wache.sh"
        w2.write_text(w2.read_text().replace(
            f'--taster "{l2.verz / "taster"}"', f'--taster "{l1.taster}"'))
        umg = dict(os.environ)
        prozesse = []
        for l in (l1, l2):
            u = dict(umg)
            u["BASH_ENV"] = str(l.verz / "vorspann.sh")
            prozesse.append(subprocess.Popen(
                ["bash", str(SKRIPT)], env=u,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid))
        time.sleep(0.4)
        fp = Fahrplan(l1.taster, [(0, "0"), (300, "1")], 2200)
        fp.start()
        fp.join(timeout=5)
        import signal as _s
        for pr in prozesse:
            try:
                os.killpg(os.getpgid(pr.pid), _s.SIGKILL)
            except ProcessLookupError:
                pass
            pr.wait(timeout=5)
        gesamt = l1._auswerten(0).anzahl_aus + l2._auswerten(0).anzahl_aus
        p.sagt("zweifach", "zwei Waechter, kurzes Antippen -> keiner schaltet ab",
               gesamt == 0, f"{gesamt}x poweroff (erwartet 0)")

        # Und beim Halten: zwei Waechter schalten zweimal ab. Das ist kein
        # zweites Ausschalten (die Box ist dann schon unterwegs), aber es ist
        # der Beleg, dass zwei Schleifen denselben Druck zaehlen.
        l3 = Lauf(SKRIPT, "2")
        l4 = Lauf(SKRIPT, "2")
        l3.aufbauen(); l4.aufbauen()
        w4 = l4.verz / "wache.sh"
        w4.write_text(w4.read_text().replace(
            f'--taster "{l4.verz / "taster"}"', f'--taster "{l3.taster}"'))
        prozesse = []
        for l in (l3, l4):
            u = dict(umg)
            u["BASH_ENV"] = str(l.verz / "vorspann.sh")
            prozesse.append(subprocess.Popen(
                ["bash", str(SKRIPT)], env=u,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid))
        time.sleep(0.4)
        fp = Fahrplan(l3.taster, [(0, "0")], 4000)
        fp.start(); fp.join(timeout=8)
        for pr in prozesse:
            try:
                os.killpg(os.getpgid(pr.pid), _s.SIGKILL)
            except ProcessLookupError:
                pass
            pr.wait(timeout=5)
        gesamt2 = l3._auswerten(0).anzahl_aus + l4._auswerten(0).anzahl_aus
        p.sagt("zweifach", "zwei Waechter zaehlen denselben Druck doppelt",
               gesamt2 == 2, f"{gesamt2}x poweroff (zwei Waechter = zweimal)")
        for l in (l3, l4):
            l.aufraeumen()
    finally:
        l1.aufraeumen()
        l2.aufraeumen()


GRUPPEN = {
    "beruehrung": gruppe_beruehrung,
    "prellen": gruppe_prellen,
    "takt": gruppe_takt,
    "frist": gruppe_frist,
    "muell": gruppe_muell,
    "muell-zurueck": gruppe_muell_gegenrichtung,
    "waechter": gruppe_waechter,
    "umgebung": gruppe_umgebung,
    "zweifach": gruppe_zweifach,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--nur", action="append", choices=sorted(GRUPPEN),
                    help="nur diese Gruppe(n)")
    ap.add_argument("--laut", action="store_true")
    ap.add_argument("--stand", metavar="COMMIT",
                    help="feste Fassung aus der Versionsgeschichte statt des "
                         "Arbeitsbaums (an dem andere Sitzungen mitschreiben)")
    args = ap.parse_args()

    global SKRIPT, _HERKUNFT
    if args.stand:
        roh = subprocess.run(
            ["git", "-C", str(WURZEL), "show",
             f"{args.stand}:scripts/OnOffShim/off_trigger.sh"],
            capture_output=True, text=True)
        if roh.returncode != 0:
            print(f"Fassung {args.stand} nicht lesbar: {roh.stderr}", file=sys.stderr)
            return 2
        halde = Path(tempfile.mkdtemp(prefix="ausschalter-stand-"))
        SKRIPT = halde / "off_trigger.sh"
        SKRIPT.write_text(roh.stdout)
        SKRIPT.chmod(0o755)
        _HERKUNFT = f"git {args.stand}"

    if not SKRIPT.exists():
        print(f"FEHLT: {SKRIPT}", file=sys.stderr)
        return 2
    print(f"Fassung: {_HERKUNFT}  ({SKRIPT})")

    p = Pruefung()
    gruppen = args.nur or list(GRUPPEN)
    for name in gruppen:
        print(f"\n── {name} ".ljust(76, "─"))
        GRUPPEN[name](p, args.laut)
        for g, n, gut, text in p.aussagen:
            if g != name:
                continue
            zeichen = "  ok  " if gut else "  ROT "
            print(f"{zeichen} {n}  [{text}]")

    print("\n" + "═" * 76)
    print(f"{len(p.aussagen) - len(p.rot)} von {len(p.aussagen)} Aussagen gruen")
    for g, n, _, text in p.rot:
        print(f"  ROT  {g}: {n}  [{text}]")
    return 1 if p.rot else 0


if __name__ == "__main__":
    sys.exit(main())
