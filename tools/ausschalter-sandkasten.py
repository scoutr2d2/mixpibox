#!/usr/bin/env python3
"""DER AUSSCHALTER IM SANDKASTEN — off_trigger.sh fahren, ohne etwas auszuschalten.

  python3 tools/ausschalter-sandkasten.py            # alle Faelle
  python3 tools/ausschalter-sandkasten.py --nur frist
  python3 tools/ausschalter-sandkasten.py --laut     # Protokoll jedes Falls

══ WOZU ═════════════════════════════════════════════════════════════════════
Hier wird am AUSSCHALTER eines Geraets gebaut, das ein Kind benutzt. Es gibt
zwei Fehlerrichtungen, und beide sind schlimm:

  * die Box faehrt bei jeder Beruehrung herunter — mitten im Hoerspiel aus,
    und ein Kind, das den Knopf entdeckt hat, macht es wieder und wieder;
  * die Box faehrt gar nicht mehr herunter — der Betreiber muss weiter hart
    ausschalten, also genau das, was er loswerden will.

Beides laesst sich nicht dadurch pruefen, dass man die echte Box ausschaltet.
Deshalb dieses Werkzeug: es fuehrt `scripts/OnOffShim/off_trigger.sh`
UNVERAENDERT aus — Zeile fuer Zeile dieselbe Datei, die auf die Box kommt —,
haengt ihr aber einen nachgestellten Taster und ein `poweroff` unter, das nur
mitschreibt.

══ WIE DAS OHNE EINEN EINZIGEN EINGRIFF IN DAS SKRIPT GEHT ══════════════════
Ueber `BASH_ENV`. Bash liest den Inhalt dieser Variablen ein, BEVOR es ein
nicht-interaktives Skript ausfuehrt — im selben Prozess. Der Vorspann, den
dieses Werkzeug dort hineinlegt, definiert Funktionen, und Funktionen schlagen
bei der Befehlssuche alles andere:

    sudo, service, poweroff, rrdtool                      — nachgestellt
    /usr/bin/aplay, /usr/bin/pactl, …/mupi-lautstaerke.sh — mitgeschrieben

Ja, auch die mit Schraegstrich: bash erlaubt `/usr/bin/aplay() { … }` als
Funktionsnamen, und der Aufruf `/usr/bin/aplay …` findet sie. Ohne diesen
Umweg waere jeder absolute Pfad im Skript ein Loch im Sandkasten.

Einige Variablen setzt der Vorspann auf `readonly`: LOGFILE, CONFIG, die vier
Pfade des Waechters und die beiden Toene. Das Skript weist ihnen danach seine
echten Pfade zu, bash lehnt das mit einer Zeile auf stderr ab (die dieses
Werkzeug wegsteckt) — und sie zeigen weiter in den Sandkasten. So landet weder
ein Protokoll in /tmp der Arbeitsmaschine noch liest das Skript die
Konfiguration einer fremden Sitzung, und keine Roehre wird nach /run/mupibox
gelegt.

══ DER TASTER IST SEIT DEM 08.08.2026 EIN EIGENER PROZESS ═══════════════════
`off_trigger.sh` ruft nicht mehr `gpioget`/`gpiomon` (die es auf der Box gar
nicht gibt), sondern startet EINMAL `taster_wache.py` und liest von ihm durch
eine benannte Roehre. Der Sandkasten stellt diesen Waechter deshalb als echtes
Programm nach — tools/ausschalter-nachgestellte-wache.py — und misst damit auch
das Zusammenspiel der beiden: die Roehre, das Warten auf „BEREIT", und was
passiert, wenn der Waechter nicht hochkommt oder mittendrin stirbt.

`sleep` bleibt ECHT, sobald es unter 10 Sekunden geht — sonst waere die
gemessene Frist erfunden statt gemessen. Nur ein Anlaufwarten von 10 s oder
mehr wird uebersprungen und vermerkt; die alte Fassung beginnt mit `sleep 30`,
und 38 Faelle mal 30 Sekunden pruefte niemand mehr.

══ DIE GEGENPROBE ═══════════════════════════════════════════════════════════
Ein Werkzeug, das nur gruen wird, misst vielleicht gar nichts. Der letzte Fall
holt deshalb eine ALTE Fassung aus der Versionsgeschichte und erwartet, dass
sie bei `pressDelay = 0` beim kuerzesten Antippen abschaltet. Wird DIESER Fall
ROT, ist der Sandkasten kaputt und alles andere darin wertlos.

WELCHE alte Fassung — das ist der ganze Wert dieses Falls, und es stand bis
zum 08.08.2026 falsch darin (die Begruendung bei MARKE_HALTESCHLEIFE weiter
unten). Genommen wird die juengste, die eine Halteschleife HAT und die
Untergrenze von 2 Sekunden NICHT — nicht irgendeine, die aus irgendeinem Grund
abschaltet.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SKRIPT = WURZEL / "scripts" / "OnOffShim" / "off_trigger.sh"

# ══ WELCHE ALTE FASSUNG DIE GEGENPROBE HOLT ═════════════════════════════════
#
# HIER STAND EINE MARKE, UND SIE WAR DIE FALSCHE:
#     MARKE_NEU = "Press delay set to"
# und dazu die Regel „nimm die juengste Fassung OHNE diese Marke". Nachgesehen,
# welche das ist: 6b75ac79 — und die hat GAR KEINE HALTESCHLEIFE. Sie schaltet
# beim Antippen ab, weil ueberhaupt nie geprueft wird, ob der Knopf noch
# gedrueckt ist. Der Fall wurde also gruen, ohne irgendetwas ueber die Frage zu
# sagen, um die es geht.
#
# EINE GEGENPROBE SOLL DIE MESSUNG PRUEFEN, NICHT NUR IRGENDETWAS AUSLOESEN.
# Die Frage lautet: „merkt dieser Sandkasten, wenn die UNTERGRENZE von
# 2 Sekunden fehlt?" Dazu braucht man eine Fassung, die ALLES SONST schon hat —
# die Halteschleife, das Zaehlen, den Abbruch beim Loslassen — und NUR den
# Riegel nicht. Das ist a0617d72, die erste mit `for ((i=0; i<PRESS_DELAY; i++))`
# und ohne PRESS_DELAY_MIN.
#
# Deshalb zwei Marken statt einer, und gesucht wird nach dem, was die Fassung
# KANN, nicht nach einer Protokollzeile. Eine feste Commit-Nummer waere in einer
# Woche falsch; diese Regel bleibt richtig, solange die Datei eine Halteschleife
# und eine Untergrenze hat.
MARKE_HALTESCHLEIFE = "i<PRESS_DELAY"
MARKE_UNTERGRENZE = "PRESS_DELAY_MIN"

# Der nachgestellte Waechter — ein echtes Programm, kein Bash-Nachbau. Die
# Begruendung steht in seinem eigenen Kopf.
NACHGESTELLTE_WACHE = Path(__file__).resolve().parent / "ausschalter-nachgestellte-wache.py"

# WIE FEIN DER NACHBAU AUF DEN TASTER SIEHT. Am Geraet meldet der Kernel die
# Flanken und verpasst grundsaetzlich keine; der Nachbau muss deshalb SEHR viel
# feiner nachsehen, als das Skript probt (40 bis 90 ms), sonst waere der
# Sandkasten gutmuetiger als die Wirklichkeit und liesse einen kurzen Tipper
# durchgehen, den die Box gesehen haette. 2 ms kosten in Python nichts.
SPIEGEL_TAKT = 0.002


# ════ DER VORSPANN ═══════════════════════════════════════════════════════════

VORSPANN = r"""
# Vorspann des Sandkastens — wird ueber BASH_ENV vor off_trigger.sh gelesen.
SK="__SK__"

readonly LOGFILE="$SK/shutdown_control.log"
readonly CONFIG="$SK/mupiboxconfig.json"

merken() {
    printf '%s\t%s\t%s\n' "$(command date +%s%3N)" "$1" "$2" >> "$SK/protokoll"
}

# ── sudo faellt weg, der Rest laeuft weiter durch die Funktionen ──────────
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
# "0" = gedrueckt (so liest es die Platine: der Taster zieht nach Masse),
# "1" = losgelassen. Die Datei $SK/taster schreibt der Fahrplan weiter unten.
#
# ══ HIER STANDEN `gpioget` UND `gpiomon` — BEIDE SIND WEG ════════════════
# Nicht, weil sie schlecht nachgestellt waren, sondern weil das Skript sie
# nicht mehr ruft. Es gibt sie auf der Box .169 gar nicht (Paket `gpiod` nicht
# installiert; Debian 13 liefert nur libgpiod 2 mit anderer Aufrufform), und
# `off_trigger.sh` geht seit dem 08.08.2026 ueber `taster_wache.py` auf lgpio.
# Ein Sandkasten, der weiter zwei Programme nachstellt, die niemand mehr ruft,
# haette gemessen, wie gut das Skript von GESTERN ist.
#
# Der Waechter wird jetzt als ECHTER PROZESS nachgestellt
# (tools/ausschalter-nachgestellte-wache.py) und redet mit dem Skript ueber
# eine echte benannte Roehre. Damit misst dieser Sandkasten auch das
# Zusammenspiel der beiden — die Roehre, das Warten auf „BEREIT", das
# Feststellen eines toten Waechters —, und nicht nur die Halteschleife.
#
# DIE VIER PFADE SIND `readonly`, aus demselben Grund wie LOGFILE und CONFIG:
# das Skript weist ihnen gleich darauf seine echten Pfade zu, bash lehnt es mit
# einer Zeile auf stderr ab, und sie zeigen weiter in den Sandkasten. So legt
# kein Lauf eine Roehre nach /run/mupibox und faellt auch nicht darueber, dass
# er dort nichts anlegen darf.
readonly WACHE="__WACHE__"
readonly LAUFVERZ="$SK"
readonly MELDEROHR="$SK/melderohr"
readonly ZUSTANDSDATEI="$SK/zustand"

# ── DER BESTAETIGUNGSTON ─────────────────────────────────────────────────
# Er wird nur noch gespielt, wenn die Datei DA ist — seit auf der Box .169
# nachgesehen wurde und das ganze Verzeichnis sysmedia fehlte. Damit haengt
# jetzt eine Aussage des Skripts an einer Datei, und der Sandkasten muss
# entscheiden, ob sie existiert. Beide Faelle werden gemessen: der Fahrplan
# legt $SK/ton.wav an oder eben nicht.
readonly TON_KNOPF="$SK/ton.wav"
readonly TON_ERSATZ="$SK/ton-ersatz.wav"

# ── DAS AUSSCHALTEN, DAS NUR MITSCHREIBT ─────────────────────────────────
# Es KEHRT ZURUECK, statt das Skript zu beenden. Nur so laesst sich die Frage
# „faehrt sie GENAU EINMAL herunter?" ueberhaupt stellen: ein poweroff, das
# den Lauf beendet, kann kein zweites verraten.
poweroff() { merken POWEROFF "$*"; return 0; }
shutdown() { merken POWEROFF "$*"; return 0; }
reboot()   { merken POWEROFF "$*"; return 0; }

service() { merken DIENST "$*"; return 0; }
systemctl() { merken DIENST "$*"; return 0; }
rrdtool() { merken RRD "$*"; return 0; }

/usr/bin/aplay() { merken TON "$*"; return 0; }
/usr/bin/pactl() { merken PACTL "$*"; return 0; }
/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; return 0; }

# Nur die drei rrd-Griffe abfangen; alles andere darf echt sein.
mkdir() { case "$*" in *"/tmp/.rrd"*) merken RRD "mkdir $*"; return 0 ;; esac; command mkdir "$@"; }
chmod() { case "$*" in *"/tmp/.rrd"*) merken RRD "chmod $*"; return 0 ;; esac; command chmod "$@"; }

# Der Sandkasten hat immer einen GPIO-Chip — sonst haenge die Messung daran,
# ob die Arbeitsmaschine zufaellig einen hat.
ls() {
    if [ "$1" = "/dev/" ]; then echo gpiochip0; return 0; fi
    command ls "$@"
}

# ── SCHLAF: ECHT, WO ES UM DIE FRIST GEHT ────────────────────────────────
sleep() {
    case "$1" in
        [0-9]*) ;;
        *) command sleep "$@"; return $? ;;
    esac
    if [ "${1%%.*}" -ge 10 ] 2>/dev/null; then
        merken ANLAUF "sleep $1"
        return 0
    fi
    command sleep "$@"
}

/usr/bin/jq() { command /usr/bin/jq "$@"; }
"""


# ════ DER VORSPANN FUER DIE GEGENPROBE ═══════════════════════════════════════
#
# Die alte Fassung, die der Gegenproben-Fall aus der Geschichte holt, redet
# noch mit `gpioget` und `gpiomon` aus libgpiod 1.x. Sie sind aus dem Vorspann
# oben verschwunden, weil das heutige Skript sie nicht mehr ruft — fuer die
# alte Fassung muessen sie aber da sein, sonst misst die Gegenprobe nur, dass
# ein altes Skript ein fehlendes Programm nicht findet. Genau das war der Fall,
# als der Waechter umgebaut wurde: „die alte Fassung kam gar nicht erst hoch".
#
# ER WIRD AN DEN OBEREN ANGEHAENGT, nicht anstelle. Alles andere — sudo,
# poweroff, die Uhr, der Schlaf — gilt fuer beide Fassungen gleich; hier steht
# nur, was die alte zusaetzlich braucht.
VORSPANN_ALT = r"""
gpioget() {
    command cat "$SK/taster" 2>/dev/null || echo 1
}

# Der Ausgangsstand wird ZUERST genommen und erst dann „WACHT" gemeldet.
# Andersherum ist es ein Wettlauf mit dem Fahrplan: `warte_auf("WACHT")` kehrt
# zurueck, der Fall drueckt sofort, und wenn `vorher=$(cat taster)` erst danach
# drankommt, liest es schon eine 0 — dann wartet dieser Nachbau auf eine Flanke
# 1 -> 0, die es nie mehr gibt.
gpiomon() {
    local vorher jetzt
    vorher=$(command cat "$SK/taster" 2>/dev/null || echo 1)
    merken WACHT "$*"
    while :; do
        command sleep 0.02
        jetzt=$(command cat "$SK/taster" 2>/dev/null || echo 1)
        if [ "$vorher" = "1" ] && [ "$jetzt" = "0" ]; then
            merken FLANKE ""
            return 0
        fi
        vorher="$jetzt"
    done
}
"""


# ════ EIN LAUF ═══════════════════════════════════════════════════════════════


class Lauf:
    """Ein Skript im Sandkasten starten, den Taster bedienen, mitlesen."""

    def __init__(self, quelle: Path, press_delay, start_volume="40", sprache="C",
                 wache_extra=(), ton=True, alte_fassung=False, dienst_haengt=0):
        self.verz = Path(tempfile.mkdtemp(prefix="ausschalter-"))
        self.protokoll = self.verz / "protokoll"
        self.protokoll.write_text("")
        self.taster = self.verz / "taster"
        self.taster.write_text("1")

        # Der Ton ist DA, wenn der Fall nichts anderes sagt — das ist der
        # Zustand einer richtig bespielten Box. Der Fall `ton/fehlt` nimmt ihn
        # weg und prueft, dass die Box trotzdem herunterfaehrt.
        if ton:
            (self.verz / "ton.wav").write_bytes(b"RIFF")

        # ── DER NACHGESTELLTE WAECHTER, ALS AUFRUFBARES PROGRAMM ─────────
        #
        # `off_trigger.sh` ruft ihn mit den Schaltern, die das echte Programm
        # kennt (--chip, --leitung, --zustandsdatei). Was der Nachbau
        # zusaetzlich braucht — welche Datei der Taster ist und wohin die
        # Mitschrift geht —, steht hier in einem Huellskript. So bleibt der
        # Aufruf im Skript UNVERAENDERT der, der auch auf der Box steht; ein
        # Sandkasten, fuer den das Skript eine Sonderzeile braeuchte, misst
        # nicht mehr das Skript.
        self.wache = self.verz / "wache.sh"
        zusatz = " ".join(f'"{s}"' for s in wache_extra)
        self.wache.write_text(
            "#!/bin/sh\n"
            f'exec python3 "{NACHGESTELLTE_WACHE}" '
            f'--taster "{self.taster}" --protokoll "{self.protokoll}" '
            f'--takt {SPIEGEL_TAKT} {zusatz} "$@"\n'
        )
        self.wache.chmod(0o755)

        konf = {
            "shim": {"triggerPin": "17"},
            "timeout": {"pressDelay": press_delay},
            "mupibox": {"startVolume": start_volume},
        }
        (self.verz / "mupiboxconfig.json").write_text(json.dumps(konf))

        vorspann = VORSPANN.replace("__SK__", str(self.verz)).replace(
            "__WACHE__", str(self.wache)
        )
        if alte_fassung:
            vorspann += VORSPANN_ALT.replace("__SK__", str(self.verz))
        if dienst_haengt:
            # Ein `service … stop`, das HAENGT. Es kommt NACH dem Vorspann und
            # ueberschreibt dessen `service` — so bleibt der Normalfall dort
            # unberuehrt, und nur dieser eine Lauf sieht den haengenden Dienst.
            vorspann += (
                f'\nservice() {{ merken DIENST "$*"; command sleep {dienst_haengt}; return 0; }}\n'
            )
        (self.verz / "vorspann.sh").write_text(vorspann)

        self.skript = self.verz / "off_trigger.sh"
        shutil.copyfile(quelle, self.skript)
        self.skript.chmod(0o755)

        umwelt = dict(os.environ)
        umwelt["BASH_ENV"] = str(self.verz / "vorspann.sh")
        umwelt["LC_ALL"] = sprache
        self.ausgabe = open(self.verz / "stderr", "w")
        self.p = subprocess.Popen(
            ["bash", str(self.skript)],
            cwd=str(self.verz),
            env=umwelt,
            stdout=self.ausgabe,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    # ── mitlesen ──────────────────────────────────────────────────────────
    def ereignisse(self):
        zeilen = []
        for z in self.protokoll.read_text().splitlines():
            teile = z.split("\t")
            if len(teile) >= 2:
                zeilen.append((int(teile[0]), teile[1], teile[2] if len(teile) > 2 else ""))
        return zeilen

    def warte_auf(self, art, frist=15.0):
        ende = time.time() + frist
        while time.time() < ende:
            if any(e[1] == art for e in self.ereignisse()):
                return True
            if self.p.poll() is not None:
                return False
            time.sleep(0.02)
        return False

    def zaehle(self, art):
        return sum(1 for e in self.ereignisse() if e[1] == art)

    def erste_zeit(self, art):
        for e in self.ereignisse():
            if e[1] == art:
                return e[0] / 1000.0
        return None

    # ── den Taster bedienen ───────────────────────────────────────────────
    def druecken(self):
        self.taster.write_text("0")
        return time.time()

    def loslassen(self):
        self.taster.write_text("1")

    def halten(self, sekunden):
        t0 = self.druecken()
        time.sleep(sekunden)
        self.loslassen()
        return t0

    def tippen(self, anzahl, an, aus):
        for _ in range(anzahl):
            self.druecken()
            time.sleep(an)
            self.loslassen()
            time.sleep(aus)

    # ── aufraeumen ────────────────────────────────────────────────────────
    def ende(self):
        try:
            os.killpg(os.getpgid(self.p.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        self.p.wait(timeout=5)
        self.ausgabe.close()

    def stderr_text(self):
        return (self.verz / "stderr").read_text()

    def aufraeumen(self):
        shutil.rmtree(self.verz, ignore_errors=True)


# ════ DIE FAELLE ═════════════════════════════════════════════════════════════


class Bericht:
    def __init__(self, laut=False):
        self.zeilen = []
        self.laut = laut

    def sagen(self, gut, name, text):
        self.zeilen.append((gut, name, text))
        print(("  OK   " if gut else "  ROT  ") + name + " — " + text, flush=True)

    @property
    def rot(self):
        return [z for z in self.zeilen if not z[0]]


def fall_losgelassen(b: Bericht):
    """Gedrueckt und VOR der Frist losgelassen -> faehrt NICHT herunter."""
    lauf = Lauf(SKRIPT, "3")
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "losgelassen", "der Waechter kam gar nicht erst hoch")
        lauf.halten(1.5)
        time.sleep(2.5)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n == 0, "losgelassen", f"1,5 s bei Frist 3 s gehalten -> {n}x poweroff (erwartet 0)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_gehalten(b: Bericht):
    """Ueber die Frist gehalten -> GENAU EINMAL herunter, und nicht zweimal."""
    lauf = Lauf(SKRIPT, "2")
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "gehalten", "der Waechter kam gar nicht erst hoch")
        lauf.druecken()
        time.sleep(5.0)          # zwei volle Fristen lang halten
        lauf.loslassen()
        time.sleep(1.0)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n == 1, "gehalten", f"5 s bei Frist 2 s gehalten -> {n}x poweroff (erwartet genau 1)")

        # Und die Begleiterscheinungen: Ton und Dienste gehoeren dazu, sonst
        # faehrt die Box wortlos herunter.
        b.sagen(lauf.zaehle("TON") == 1, "gehalten/ton",
                f"Abschaltton {lauf.zaehle('TON')}x (erwartet 1)")
        b.sagen(lauf.zaehle("DIENST") >= 1, "gehalten/dienste",
                f"{lauf.zaehle('DIENST')} Dienste gestoppt (erwartet >= 1)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_frist(b: Bericht):
    """Die Frist stimmt: bei 1, 2, 3, 5 wirklich so lange.

    `1` ist der Grenzfall und steht deshalb mit drin: die Untergrenze des
    Skripts hebt ihn auf 2 an, und GENAU DAS soll die Messung zeigen — nicht
    „irgendwas passiert", sondern „zwei Sekunden, weil eine zu wenig ist".
    """
    for eingestellt, erwartet in (("1", 2), ("2", 2), ("3", 3), ("5", 5)):
        lauf = Lauf(SKRIPT, eingestellt)
        try:
            if not lauf.warte_auf("WACHT"):
                b.sagen(False, f"frist/{eingestellt}", "der Waechter kam gar nicht erst hoch")
                continue
            t0 = lauf.druecken()
            ende = time.time() + erwartet + 3.0
            while time.time() < ende and lauf.zaehle("POWEROFF") == 0:
                time.sleep(0.02)
            lauf.loslassen()
            t = lauf.erste_zeit("POWEROFF")
            if t is None:
                b.sagen(False, f"frist/{eingestellt}",
                        f"kein poweroff, obwohl {erwartet + 3:.0f} s gehalten")
                continue
            gemessen = t - t0
            # Untergrenze: die Frist darf nicht ZU FRUEH ablaufen (sonst ist
            # sie keine). Obergrenze: 0,8 s Luft fuer Probentakt und Prozesse
            # — und bei 5 s eingestellter Frist ist das die Zahl, die zaehlt,
            # denn ab 6 s nimmt der MuPiHAT den Strom weg.
            gut = erwartet - 0.15 <= gemessen <= erwartet + 0.8
            b.sagen(gut, f"frist/{eingestellt}",
                    f"eingestellt {eingestellt} -> gemessen {gemessen:.2f} s "
                    f"(erwartet {erwartet} s, Fenster {erwartet - 0.15:.2f}–{erwartet + 0.8:.2f})")
        finally:
            lauf.ende()
            if b.laut:
                print(lauf.protokoll.read_text())
            lauf.aufraeumen()


def fall_muell(b: Bericht):
    """Unbrauchbare Werte -> KEINE Box, die beim Antippen ausgeht.

    Das ist die Sackgasse, gegen die gebaut wird: geht die Box beim kuerzesten
    Antippen aus, kommt am Geraet niemand mehr an das Menue, mit dem sich der
    Wert korrigieren liesse.
    """
    for wert, name in (
        ("0", "null"),
        ("2.25", "bruchzahl"),
        ("abc", "buchstaben"),
        ("", "leer"),
        ("-1", "negativ"),
        ("99", "neunundneunzig"),
        (None, "fehlt-ganz"),
    ):
        lauf = Lauf(SKRIPT, wert)
        try:
            if not lauf.warte_auf("WACHT"):
                b.sagen(False, f"muell/{name}", "der Waechter kam gar nicht erst hoch")
                continue
            # Kurz antippen — das ist die Beruehrung, die NICHTS tun darf.
            lauf.halten(0.3)
            time.sleep(1.2)
            n = lauf.zaehle("POWEROFF")
            b.sagen(n == 0, f"muell/{name}",
                    f"pressDelay={wert!r}, 0,3 s angetippt -> {n}x poweroff (erwartet 0)")

            # UND DER KNOPF MUSS TROTZDEM NOCH GEHEN. Ein Skript, das jeden
            # unbrauchbaren Wert mit „dann eben nie" beantwortet, hat die
            # zweite Fehlerrichtung: die Box faehrt gar nicht mehr herunter.
            t0 = lauf.druecken()
            ende = time.time() + 8.0
            while time.time() < ende and lauf.zaehle("POWEROFF") == 0:
                time.sleep(0.02)
            lauf.loslassen()
            t = lauf.erste_zeit("POWEROFF")
            if t is None:
                b.sagen(False, f"muell/{name}/haelt",
                        "8 s gehalten und die Box faehrt NICHT herunter")
            else:
                gemessen = t - t0
                # Ueber 2 s (die Untergrenze) und sicher unter 6 s (der harte
                # Griff der Platine).
                gut = 1.85 <= gemessen <= 5.8
                b.sagen(gut, f"muell/{name}/haelt",
                        f"gehalten -> poweroff nach {gemessen:.2f} s (erwartet 1,85–5,8)")
        finally:
            lauf.ende()
            if b.laut:
                print(lauf.protokoll.read_text())
            lauf.aufraeumen()


def fall_klopfen(b: Bericht):
    """Kurz antippen, mehrmals hintereinander -> faehrt NICHT herunter.

    ZWEI MUSTER, und das zweite ist das boesartige: Die alte Schleife sah
    einmal je SEKUNDE nach, ob der Knopf noch gedrueckt ist. Wer im
    Sekundentakt tippt, ist bei jeder dieser Proben gerade wieder drauf — die
    Box haette abgeschaltet, obwohl der Knopf zwischendurch mehrfach los war.
    Ein Kind, das entdeckt hat, dass da etwas klickt, tippt genau so.
    """
    for name, anzahl, an, aus in (
        ("schnell", 6, 0.2, 0.3),
        ("sekundentakt", 5, 0.35, 0.65),
    ):
        lauf = Lauf(SKRIPT, "2")
        try:
            if not lauf.warte_auf("WACHT"):
                b.sagen(False, f"klopfen/{name}", "der Waechter kam gar nicht erst hoch")
                continue
            lauf.tippen(anzahl, an, aus)
            time.sleep(1.5)
            n = lauf.zaehle("POWEROFF")
            b.sagen(n == 0, f"klopfen/{name}",
                    f"{anzahl}x {an:.2f} s an / {aus:.2f} s aus -> {n}x poweroff (erwartet 0)")
        finally:
            lauf.ende()
            if b.laut:
                print(lauf.protokoll.read_text())
            lauf.aufraeumen()


def fall_kurz_vor_schluss(b: Bericht):
    """Losgelassen im letzten Probenfenster -> faehrt NICHT herunter."""
    lauf = Lauf(SKRIPT, "2")
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "kurz-vor-schluss", "der Waechter kam gar nicht erst hoch")
        lauf.halten(1.92)
        time.sleep(2.0)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n == 0, "kurz-vor-schluss",
                f"1,92 s bei Frist 2 s -> {n}x poweroff (erwartet 0)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_nachgestellt(b: Bericht):
    """Im Menue verstellt, WAEHREND der Waechter laeuft -> gilt beim naechsten Druck.

    ══ WARUM DIESER FALL DER WICHTIGSTE DER GANZEN DATEI IST ════════════════
    Alle anderen Faelle starten den Waechter mit einem Wert und pruefen ihn.
    Genau so war das Skript aber lange falsch: es las `timeout.pressDelay` EIN
    EINZIGES MAL, oben im Vorspann, weit vor der Hauptschleife. Der Wert, den
    die Konfiguration beim START DES DIENSTES hatte, galt bis zum naechsten
    Neustart — und kein einziger Fall hier haette das gemerkt, weil keiner den
    Wert waehrend des Laufs anfasste.

    Das Admin-Menue und die Browser-Verwaltung schreiben aber in die LAUFENDE
    Box hinein, und die Oberflaeche sagt dazu „Gilt ab dem naechsten Druck auf
    den Knopf". Ohne diesen Fall waere das eine Behauptung ohne Messung.

    BEIDE RICHTUNGEN STEHEN HIER, weil beide weh tun:
      auf 5 gestellt (weil das Kind die Box staendig ausschaltet) und die Box
        schaltet weiter nach 2 Sekunden ab — der Wunsch bleibt wirkungslos;
      auf 2 gestellt und die Box braucht weiter 5 — der Betreiber haelt, es
        passiert nichts, er haelt laenger, und bei 6 Sekunden nimmt der
        MuPiHAT den Strom weg. Das weiche Aus verliert gegen das harte, das es
        ersetzen sollte.
    """
    for start, neu, halten, erwartet_aus, name in (
        ("5", "2", 2.6, True, "runter"),
        ("2", "5", 2.6, False, "hoch"),
    ):
        lauf = Lauf(SKRIPT, start)
        try:
            if not lauf.warte_auf("WACHT"):
                b.sagen(False, f"nachgestellt/{name}", "der Waechter kam gar nicht erst hoch")
                continue
            # Das tut das Admin-Menue: dieselbe Datei, neuer Wert.
            konf = json.loads((lauf.verz / "mupiboxconfig.json").read_text())
            konf["timeout"]["pressDelay"] = neu
            (lauf.verz / "mupiboxconfig.json").write_text(json.dumps(konf))
            time.sleep(0.4)

            lauf.halten(halten)
            time.sleep(1.2)
            n = lauf.zaehle("POWEROFF")
            gut = (n >= 1) if erwartet_aus else (n == 0)
            b.sagen(gut, f"nachgestellt/{name}",
                    f"gestartet mit {start} s, im Menue auf {neu} s gestellt, "
                    f"{halten:.1f} s gehalten -> {n}x poweroff "
                    f"(erwartet {'mindestens 1' if erwartet_aus else '0'})")
        finally:
            lauf.ende()
            if b.laut:
                print(lauf.protokoll.read_text())
            lauf.aufraeumen()

    # UND DIE HALB GESCHRIEBENE DATEI. Wer im Menue speichert, waehrend jemand
    # drueckt, trifft die Konfiguration mitten im Schreiben an. Das darf die
    # eingestellte Haltedauer NICHT verstellen — weder nach oben noch nach
    # unten. Erwartet: die 5 bleiben stehen, also faehrt ein 2,6-s-Druck nicht
    # herunter und ein langer schon.
    lauf = Lauf(SKRIPT, "5")
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "nachgestellt/halb-geschrieben",
                    "der Waechter kam gar nicht erst hoch")
            return
        (lauf.verz / "mupiboxconfig.json").write_text('{"timeout": {"pressD')
        time.sleep(0.4)
        lauf.halten(2.6)
        time.sleep(1.2)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n == 0, "nachgestellt/halb-geschrieben",
                f"Konfiguration mitten im Schreiben, 2,6 s gehalten -> {n}x poweroff "
                f"(erwartet 0 — die eingestellten 5 s bleiben stehen)")

        t0 = lauf.druecken()
        ende = time.time() + 8.0
        while time.time() < ende and lauf.zaehle("POWEROFF") == 0:
            time.sleep(0.02)
        lauf.loslassen()
        t = lauf.erste_zeit("POWEROFF")
        if t is None:
            b.sagen(False, "nachgestellt/halb-geschrieben/haelt",
                    "8 s gehalten und die Box faehrt NICHT herunter")
        else:
            gemessen = t - t0
            b.sagen(4.85 <= gemessen <= 5.8, "nachgestellt/halb-geschrieben/haelt",
                    f"gehalten -> poweroff nach {gemessen:.2f} s (erwartet weiter 5 s)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_anlauf(b: Bericht):
    """Der Waechter darf nichts aufhalten — und muss schnell scharf sein.

    Die alte Fassung begann mit `sleep 30`: eine halbe Minute, in der ein
    Druck auf den Knopf NICHTS bewirkt. Wer in dieser Zeit drueckt und laenger
    haelt, weil nichts passiert, landet bei 6 Sekunden — und dort greift die
    Platine hart durch.
    """
    t0 = time.time()
    lauf = Lauf(SKRIPT, "2")
    try:
        da = lauf.warte_auf("WACHT", frist=10.0)
        gebraucht = time.time() - t0
        b.sagen(da and gebraucht < 3.0, "anlauf",
                f"scharf nach {gebraucht:.2f} s (erwartet < 3 s, frueher 30 s)")
        b.sagen(lauf.zaehle("ANLAUF") == 0, "anlauf/kein-blindwarten",
                f"{lauf.zaehle('ANLAUF')} uebersprungene Blindwartezeiten (erwartet 0)")
    finally:
        lauf.ende()
        lauf.aufraeumen()


# ── DIE GEGENPROBE ───────────────────────────────────────────────────────────


def alte_fassung(ziel: Path):
    """Die juengste Fassung MIT Halteschleife und OHNE Untergrenze.

    Die Begruendung fuer genau diese Wahl steht oben bei den beiden Marken.
    """
    hashes = subprocess.run(
        ["git", "log", "--format=%H", "--", str(SKRIPT.relative_to(WURZEL))],
        cwd=str(WURZEL), capture_output=True, text=True,
    ).stdout.split()
    for h in hashes:
        inhalt = subprocess.run(
            ["git", "show", f"{h}:{SKRIPT.relative_to(WURZEL)}"],
            cwd=str(WURZEL), capture_output=True, text=True,
        ).stdout
        if not inhalt:
            continue
        if MARKE_HALTESCHLEIFE in inhalt and MARKE_UNTERGRENZE not in inhalt:
            ziel.write_text(inhalt)
            return h
    return None


def fall_gegenprobe(b: Bericht):
    """Die ALTE Fassung MUSS bei pressDelay=0 beim Antippen ausgehen.

    Wird dieser Fall gruen, misst der Sandkasten nichts und alles darueber ist
    wertlos.
    """
    verz = Path(tempfile.mkdtemp(prefix="ausschalter-alt-"))
    alt = verz / "off_trigger_alt.sh"
    h = alte_fassung(alt)
    if h is None:
        b.sagen(False, "gegenprobe",
                "keine Fassung ohne den Riegel in der Geschichte gefunden")
        shutil.rmtree(verz, ignore_errors=True)
        return
    lauf = Lauf(alt, "0", alte_fassung=True)
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "gegenprobe",
                    f"die alte Fassung {h[:8]} kam gar nicht erst hoch — "
                    f"dann misst die Gegenprobe nichts. stderr: "
                    f"{lauf.stderr_text()[-300:]!r}")
            return
        lauf.halten(0.3)
        time.sleep(1.5)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n >= 1, "gegenprobe",
                f"alte Fassung {h[:8]}, pressDelay=0, 0,3 s angetippt -> {n}x poweroff "
                f"(ERWARTET >= 1; genau das war die Sackgasse)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()
        shutil.rmtree(verz, ignore_errors=True)


def fall_waechter(b: Bericht):
    """EIN DIENST, DER „LAEUFT" UND NICHTS BEWACHT, IST SCHLECHTER ALS KEINER.

    Das ist die Fehlerklasse, an der dieser Ausschalter ein Jahr lang gestorben
    ist, und sie hat auf dieser Box zwei Gestalten:

      * der Waechter KOMMT NICHT HOCH — die Leitung ist belegt, die Bibliothek
        fehlt, die Rechte fehlen. Am 08.08.2026 gemessen: ein `sudo gpioget`
        ohne das Paket `gpiod` liess das Skript alle fuenf Sekunden im Kreis
        laufen, waehrend `systemctl status` „active (running)" meldete.
      * der Waechter STIRBT MITTENDRIN — der OOM-Killer, ein Fehler in der
        Bibliothek. Danach steht das Skript in einem `read`, das nie
        zurueckkehrt, und heisst weiter „active (running)".

    In BEIDEN Faellen muss das Skript ENDEN. Nur dann zeigt `Restart=always`
    den Neustartzaehler, und die Frage „laeuft der Ausschalter?" bekommt eine
    ehrliche Antwort. Dieser Fall prueft genau das — nicht, ob eine Meldung im
    Protokoll steht, sondern ob der PROZESS WEG IST.
    """
    # ── kommt gar nicht hoch ───────────────────────────────────────────────
    lauf = Lauf(SKRIPT, "2", wache_extra=("--nicht-bereit",))
    try:
        ende = time.time() + 30
        while time.time() < ende and lauf.p.poll() is None:
            time.sleep(0.2)
        rc = lauf.p.poll()
        b.sagen(rc is not None and rc != 0, "waechter/kommt-nicht",
                f"Waechter meldet nie BEREIT -> Skript endet mit {rc} "
                f"(erwartet: endet, und zwar ungleich 0)")
    finally:
        lauf.ende()
        if b.laut:
            print((lauf.verz / "shutdown_control.log").read_text())
        lauf.aufraeumen()

    # ── stirbt mittendrin ──────────────────────────────────────────────────
    lauf = Lauf(SKRIPT, "2", wache_extra=("--sterben-nach", "3"))
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "waechter/stirbt", "der Waechter kam gar nicht erst hoch")
            return
        # Er lebt, das Skript wartet. Nach 3 s ist er weg; das Skript merkt es
        # spaetestens beim naechsten Ablauf seiner 60-Sekunden-Frist.
        ende = time.time() + 90
        while time.time() < ende and lauf.p.poll() is None:
            time.sleep(0.2)
        rc = lauf.p.poll()
        n = lauf.zaehle("POWEROFF")
        b.sagen(rc is not None and rc != 0 and n == 0, "waechter/stirbt",
                f"Waechter stirbt nach 3 s -> Skript endet mit {rc}, {n}x poweroff "
                f"(erwartet: endet ungleich 0, und schaltet dabei NICHTS ab)")
    finally:
        lauf.ende()
        if b.laut:
            print((lauf.verz / "shutdown_control.log").read_text())
        lauf.aufraeumen()


def fall_riegel(b: Bericht):
    """EIN DIENST, DER NICHT STOPPT, DARF DAS ABSCHALTEN NICHT VERHINDERN.

    Zwischen der Entscheidung „es wird abgeschaltet" und dem `sudo poweroff`
    stehen vier Aufrufe: die Lautstaerke zuruecksetzen, den Ton spielen, zwei
    Dienste anhalten. Keiner davon hatte eine Frist — und
    `mupi_powerled.service` darf laut seiner eigenen Unit anderthalb Minuten
    zum Stoppen brauchen (TimeoutStopUSec 1min30s). Blockiert einer, kommt das
    `poweroff` darunter NIE.

    WAS DER BETREIBER DAVON HAT: er haelt den Knopf, es passiert nichts, er
    haelt weiter — und bei 6 Sekunden nimmt der MuPiHAT den Strom hart weg.
    Das weiche Aus verliert dann gegen das harte, das es ersetzen sollte.

    Hier haengen BEIDE `service`-Aufrufe 30 Sekunden. Ohne Riegel kaeme das
    poweroff nach einer Minute, also praktisch gar nicht. Mit Riegel darf jeder
    Aufruf 3 Sekunden kosten, macht hoechstens 6 obendrauf.
    """
    lauf = Lauf(SKRIPT, "2", dienst_haengt=30)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "riegel", "der Waechter kam gar nicht erst hoch")
        t0 = lauf.druecken()
        ende = time.time() + 20.0
        while time.time() < ende and lauf.zaehle("POWEROFF") == 0:
            time.sleep(0.05)
        lauf.loslassen()
        t = lauf.erste_zeit("POWEROFF")
        if t is None:
            return b.sagen(False, "riegel",
                           "zwei haengende Dienste -> die Box faehrt GAR NICHT herunter")
        gemessen = t - t0
        b.sagen(gemessen <= 12.0, "riegel",
                f"zwei Dienste haengen je 30 s -> poweroff nach {gemessen:.1f} s "
                f"(erwartet hoechstens 12; ohne Riegel waeren es ueber 60)")
        log = (lauf.verz / "shutdown_control.log").read_text()
        b.sagen(log.count("cut short so the shutdown can proceed") >= 2, "riegel/protokoll",
                "das Protokoll benennt jeden abgeschnittenen Aufruf")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_ton(b: Bericht):
    """OHNE BESTAETIGUNGSTON MUSS SIE TROTZDEM HERUNTERFAHREN.

    AM GERAET NACHGESEHEN (Box .169, 08.08.2026): das Verzeichnis
    /home/dietpi/MuPiBox/sysmedia gibt es dort nicht, weder Ton noch Bild.
    `aplay` auf eine fehlende Datei schreibt eine Zeile und endet — die Box
    faehrt wortlos herunter. DAS IST NICHT NUR HAESSLICH: wer keine
    Rueckmeldung bekommt, haelt laenger, und bei 6 Sekunden nimmt der MuPiHAT
    den Strom hart weg.

    Hier wird die harmlosere Haelfte gemessen — dass ein fehlender Ton das
    Abschalten nicht AUFHAELT. Die andere Haelfte, dass die Datei ueberhaupt
    auf die Box kommt, prueft tools/ausrollweg-deckung.py.
    """
    lauf = Lauf(SKRIPT, "2", ton=False)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "ton/fehlt", "der Waechter kam gar nicht erst hoch")
        lauf.halten(3.0)
        time.sleep(1.0)
        n = lauf.zaehle("POWEROFF")
        t = lauf.zaehle("TON")
        b.sagen(n == 1 and t == 0, "ton/fehlt",
                f"ohne Tondatei 3 s gehalten -> {n}x poweroff, {t}x aplay "
                f"(erwartet 1 und 0)")
        log = (lauf.verz / "shutdown_control.log").read_text()
        b.sagen("no shutdown sound" in log, "ton/fehlt/protokoll",
                "das Protokoll sagt, WARUM es still war" if "no shutdown sound" in log
                else "das Protokoll schweigt darueber, dass der Ton fehlte")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def komma_sprache():
    """Eine Spracheinstellung, in der die Uhr ein KOMMA schreibt — oder None."""
    a = subprocess.run(["locale", "-a"], capture_output=True, text=True).stdout.split()
    for name in a:
        if not name.lower().startswith(("de_", "fr_", "es_", "it_", "nl_", "pt_")):
            continue
        p = subprocess.run(
            ["bash", "-c", 'printf "%s" "$EPOCHREALTIME"'],
            capture_output=True, text=True, env={**os.environ, "LC_ALL": name},
        )
        if "," in p.stdout:
            return name
    return None


def fall_sprache(b: Bericht):
    """Die Frist stimmt AUCH auf einer deutsch eingestellten Box.

    WARUM DAS EIN EIGENER FALL IST: Die Halteschleife liest die Uhr aus
    `EPOCHREALTIME`, und dessen Dezimalzeichen haengt an der Spracheinstellung
    — im Deutschen ist es ein KOMMA. Ein Skript, das auf einen Punkt baut,
    rechnet dort mit Unsinn; alle Faelle darueber laufen unter LC_ALL=C und
    saehen davon nichts. DietPi ist englisch vorbelegt, aber niemand hindert
    den Betreiber daran, das umzustellen — und dann haengt an dieser Zeile,
    ob seine Box noch herunterfaehrt.
    """
    sp = komma_sprache()
    if sp is None:
        b.sagen(True, "sprache/uebersprungen",
                "keine Spracheinstellung mit Komma auf dieser Maschine — nicht gemessen")
        return
    lauf = Lauf(SKRIPT, "3", sprache=sp)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "sprache", "der Waechter kam gar nicht erst hoch")
        t0 = lauf.druecken()
        ende = time.time() + 6.0
        while time.time() < ende and lauf.zaehle("POWEROFF") == 0:
            time.sleep(0.02)
        lauf.loslassen()
        t = lauf.erste_zeit("POWEROFF")
        if t is None:
            return b.sagen(False, "sprache", f"unter {sp} faehrt die Box gar nicht herunter")
        gemessen = t - t0
        b.sagen(2.85 <= gemessen <= 3.8, "sprache",
                f"unter {sp} (Uhr mit Komma) -> poweroff nach {gemessen:.2f} s (erwartet 3 s)")
    finally:
        lauf.ende()
        if b.laut:
            print(lauf.protokoll.read_text())
        lauf.aufraeumen()


def fall_ruhe(b: Bericht):
    """EINE MINUTE, IN DER NIEMAND DRUECKT — DER NORMALFALL.

    DER FALL, DER GEFEHLT HAT. Jede andere Aussage hier drueckt binnen
    Sekunden; die Box im Wohnzimmer tut das NICHT, sie steht stundenlang
    unberuehrt herum. Und genau dort lag der Fehler: `off_trigger.sh` wartete
    mit `read -r -t 60` auf eine Meldung und fragte danach

        if read …; then … continue; fi
        lese_rc=$?

    `$?` steht nach einem `if`, dessen Bedingung falsch war und das keinen
    `else`-Zweig hat, auf NULL — das ist der Rueckgabewert des if-Gebildes und
    nicht der von `read` (der waere 142). Die Zeile darunter liest daraus „die
    Roehre ist zu" und beendet das Skript. Bei JEDER ruhigen Minute.

    AM GERAET GEMESSEN (Box .169, 08.08.2026, Dienst ausgerollt, nichts
    beruehrt): Neustart im Takt von 65 Sekunden, in vier Minuten viermal, und
    `taster_wache.py` war dabei 16 der 240 Sekunden GAR NICHT DA. Wer in
    diesem Fenster drueckt, drueckt ins Leere — beim Neustart wird GPIO17
    freigegeben und neu beansprucht, eine Flanke dazwischen sieht niemand.

    DIESER FALL BRAUCHT DESHALB EINE ECHTE MINUTE. Das ist der Preis; kuerzer
    geht es nicht, ohne die Frist im Skript zu verstellen — und ein Skript,
    das fuer den Sandkasten eine Sonderzeile braucht, wird nicht mehr gemessen.
    Geprueft wird beides: dass er die Ruhe UEBERLEBT, und dass er danach noch
    ABSCHALTEN KANN. Das zweite ist das eigentliche Versprechen.
    """
    lauf = Lauf(SKRIPT, "2")
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "ruhe", "der Waechter kam gar nicht erst hoch")
            return

        RUHE = 65.0  # eine Sekunde ueber die Frist von 60 hinaus
        beginn = time.time()
        while time.time() - beginn < RUHE and lauf.p.poll() is None:
            time.sleep(0.5)

        rc = lauf.p.poll()
        b.sagen(rc is None, "ruhe/lebt",
                f"{RUHE:.0f} s lang niemand am Knopf -> Skript "
                + ("laeuft weiter" if rc is None else f"ENDETE mit {rc}")
                + " (erwartet: laeuft weiter)")
        if rc is not None:
            protokoll = (lauf.verz / "shutdown_control.log").read_text()
            zeile = [z for z in protokoll.splitlines() if "ERROR" in z]
            b.sagen(False, "ruhe/grund",
                    zeile[-1] if zeile else "(kein ERROR im Protokoll)")
            return

        # ── UND ER MUSS DANACH NOCH KOENNEN, WAS ER SOLL ──────────────────
        t0 = lauf.halten(2.6)
        lauf.warte_auf("POWEROFF", frist=10)
        n = lauf.zaehle("POWEROFF")
        b.sagen(n >= 1, "ruhe/schaltet-danach",
                f"nach der ruhigen Minute 2,6 s gehalten -> {n}x poweroff "
                f"(erwartet mindestens 1)")
        _ = t0
    finally:
        lauf.ende()
        if b.laut:
            print((lauf.verz / "shutdown_control.log").read_text())
        lauf.aufraeumen()


FAELLE = {
    "anlauf": fall_anlauf,
    "ruhe": fall_ruhe,
    "losgelassen": fall_losgelassen,
    "gehalten": fall_gehalten,
    "frist": fall_frist,
    "muell": fall_muell,
    "klopfen": fall_klopfen,
    "kurz": fall_kurz_vor_schluss,
    "nachgestellt": fall_nachgestellt,
    "sprache": fall_sprache,
    "waechter": fall_waechter,
    "riegel": fall_riegel,
    "ton": fall_ton,
    "gegenprobe": fall_gegenprobe,
}


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--nur", action="append", choices=sorted(FAELLE), default=None)
    p.add_argument("--laut", action="store_true", help="Protokoll jedes Laufs zeigen")
    a = p.parse_args()

    if not SKRIPT.is_file():
        print(f"ROT: {SKRIPT} gibt es nicht", file=sys.stderr)
        return 2
    if shutil.which("jq") is None:
        print("ROT: jq fehlt — der Sandkasten liest die Konfiguration damit", file=sys.stderr)
        return 2

    b = Bericht(laut=a.laut)
    namen = a.nur or list(FAELLE)
    print(f"Sandkasten: {SKRIPT}")
    for n in namen:
        print(f"\n── {n} " + "─" * (66 - len(n)))
        FAELLE[n](b)

    print("\n" + "═" * 70)
    if b.rot:
        print(f"ROT — {len(b.rot)} von {len(b.zeilen)} Aussagen:")
        for _, name, text in b.rot:
            print(f"   {name}: {text}")
        return 1
    print(f"GRUEN — {len(b.zeilen)} Aussagen, keine Box ist dabei ausgegangen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
