#!/usr/bin/env python3
"""DER TASTER, GEMELDET — der kleine Helfer unter off_trigger.sh.

    taster_wache.py --chip gpiochip0 --leitung 17 \
                    --zustandsdatei /run/mupibox/taster.zustand

Er meldet auf der Standardausgabe, ZEILENWEISE und sofort gespuelt:

    BEREIT 1        er hat die Leitung, ihr Stand ist 1 (losgelassen)
    FLANKE          eine FALLENDE Flanke — der Knopf wurde gedrueckt
    LOS             eine steigende Flanke — der Knopf wurde losgelassen

und schreibt bei JEDER Flanke den aktuellen Stand ("0" oder "1") in die
Zustandsdatei. Geht etwas schief, sagt er es auf der Fehlerausgabe und ENDET
mit einem Kode ungleich 0. Er laeuft nicht weiter und behauptet nichts.


══ WARUM ES DIESE DATEI UEBERHAUPT GIBT ════════════════════════════════════

`off_trigger.sh` rief bis heute zwei Programme aus libgpiod 1.x:

    sudo gpioget CHIP LEITUNG
    sudo gpiomon --num-events=1 --falling-edge CHIP LEITUNG

AM GERAET NACHGESEHEN (Box .169, 08.08.2026, nur lesend):

    ls /usr/bin/gpio*          ->  nichts
    dpkg -l | grep -c gpiod    ->  0
    apt-cache madison gpiod    ->  NUR 2.2.1

Es gibt sie dort also nicht — und das Paket, das sie braechte, ist auf diesem
Debian 13 die Fassung 2.x MIT ANDERER AUFRUFFORM. Ein `apt-get install gpiod`
haette das Skript nicht geheilt, sondern ihm zwei Programme gegeben, die es
falsch aufruft; ein `gpioget`, das an seinen Argumenten scheitert, sieht von
aussen aus wie ein defekter Taster.

WAS DIE BOX STATTDESSEN HAT (dieselbe Messung):

    python3-lgpio          0.2.2   ->  import lgpio      geht
    python3-rpi-lgpio      0.6     ->  import RPi.GPIO   geht (Nachbau auf lgpio)
    liblgpio1              0.2.2
    /dev/gpiochip0 = pinctrl-rp1, 54 Leitungen

Beides steht in `packages2install` und ist ANGEKOMMEN — anders als `gpiod`,
das dort ebenfalls steht und fehlt. Und `led_control.py` treibt mit diesem
Unterbau GERADE JETZT das Licht im Einschaltknopf; in `/sys/kernel/debug/gpio`
steht hinter GPIO13 der Besitzer `lg`. Der Weg ist auf dieser Box also nicht
theoretisch, er leuchtet.


══ WARUM EIN LAUFENDER HELFER UND NICHT EIN AUFRUF JE PROBE ════════════════

Der naheliegende Weg waere gewesen, `gpioget` durch ein winziges Python-
Programm zu ersetzen, das einmal liest und endet — dann bliebe die Bash-Seite
Zeile fuer Zeile dieselbe. AM GERAET GEMESSEN, warum das nicht geht (je 20
Laeufe, Mittel):

    python3 -c "pass"            18 ms
    python3 -c "import lgpio"    34 ms
    sudo true                    10 ms
                                 ─────
    ein `sudo python3 …`         44 ms

Die Halteschleife in `off_trigger.sh` probt unregelmaessig alle 40 bis 90 ms.
Ein Aufruf von 44 ms verschlaenge also die HAELFTE bis die GANZE Pause — aus
rund 30 unabhaengigen Blicken je Sekunde wuerden 15, und was uebrig bleibt,
haengt daran, wie beschaeftigt der Pi gerade ist. Genau diese Abhaengigkeit
war LOCH 2 in der alten Halteschleife und ist dort mit viel Muehe beseitigt
worden. Sie ueber die Hintertuer wieder einzubauen waere albern.

Also laeuft der Helfer EINMAL und bleibt. Bash liest seine Meldungen mit dem
eingebauten `read` aus einer Roehre und den Tasterstand mit dem eingebauten
`read` aus einer Datei auf tmpfs — beides ohne einen einzigen neuen Prozess.
Der Preis von 34 ms faellt einmal je Systemstart an.


══ WARUM DER STAND IN EINE DATEI GEHT UND NICHT IN DIE ROEHRE ══════════════

Die Roehre traegt EREIGNISSE, die Datei traegt den ZUSTAND. Das ist nicht
Geschmack, sondern der Unterschied zwischen „etwas ist passiert" und „so ist
es jetzt": Bash fragt in der Halteschleife nach dem Zustand, zu einem
Zeitpunkt, den Bash bestimmt. Aus einer Roehre laesst sich das nicht lesen,
ohne zu raten, ob gerade nichts drinsteht, weil nichts passiert ist — oder
weil man zu frueh geschaut hat.

Und WARUM NICHT die Halteschleife ganz auf Ereignisse umstellen, also einfach
auf „LOS" warten? Weil ein mechanischer Taster PRELLT. Beim Druck springt der
Kontakt ein paar Millisekunden lang hin und her; wer beim ersten „LOS"
abbricht, dessen Knopf funktioniert NIE. Deshalb zwei Dinge: eine Entprellung
von 10 ms unten im Treiber, UND eine Bash-Seite, die weiter den Zustand probt
statt auf ein einzelnes Ereignis zu horchen. Die 29 Aussagen, die diese
Schleife absichern, bleiben damit gueltig.

Geschrieben wird die Datei ueber `os.replace`, also mit einem Umbenennen. Ein
`read` auf der Bash-Seite sieht dadurch IMMER entweder den alten oder den
neuen Stand, nie einen halben.


══ WAS ER NICHT STOERT ═════════════════════════════════════════════════════

`led_control.py` haelt GPIO13 als PWM. Dieser Helfer nimmt sich NUR die eine
Leitung, die ihm gesagt wird (Vorgabe 17 aus `shim.triggerPin`), und gibt sie
beim Ende wieder frei. AM GERAET GEPRUEFT: in `/sys/kernel/debug/gpio` steht
GPIO13 auf `lg` (der LED-Dienst), GPIO17 hat keinen Besitzer. Zwei Programme
teilen sich hier also nichts.

Sollte jemand `triggerPin` je auf 13 stellen, scheitert das Beanspruchen mit
„busy" — und dann sagt dieser Helfer das laut und endet, statt still danebenzu-
stehen.
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
from pathlib import Path

ENTPRELLUNG_US = 10_000  # 10 ms, siehe oben: gegen das Prellen des Kontakts


def warten_bis_ende(ende: "threading.Event") -> None:
    """Schlafen, bis von aussen abgewunken wird — UND DABEI ANSPRECHBAR BLEIBEN.

    ACHTUNG, HIER STAND EINE FALSCHE BEGRUENDUNG (berichtigt am 08.08.2026).
    Behauptet war, als AM GERAET GEMESSEN, ein `ende.wait()` OHNE Frist
    ueberlebe SIGTERM und SIGINT, erst `kill -9` beende den Helfer. DAS LAESST
    SICH NICHT NACHSTELLEN. `tools/waechter-signalfrist.py` faehrt beide
    Warteformen, direkt und unter `sudo`, und schiesst einmal auf den
    Python-Prozess und einmal auf den `sudo`-Wrapper. Auf der Box .169:

        ende.wait()   Signal an das Kind, direkt   -> endet nach 24 ms
        ende.wait()   Signal an das Kind, sudo     -> endet nach 11 ms
        ende.wait()   Signal an den Wrapper, sudo  -> endet nach 11 ms

    `/proc/<pid>/wchan` steht dabei wirklich auf `futex_do_wait`, genau wie
    damals notiert — das ist aber nur die Wartestelle und kein Beleg dafuer,
    dass sie unterbrechbar-frei waere.

    WARUM ES GEHT: Python fuehrt Signalhandler tatsaechlich nur im Hauptfaden
    und nur zwischen zwei Bytekode-Schritten aus — so weit stimmte es. Aber
    CPython nimmt auf POSIX fuer `lock.acquire()` IM HAUPTFADEN den
    unterbrechbaren Weg; das Signal bricht das Warten ab, der Handler laeuft.
    In einem NEBENFADEN waere die alte Behauptung richtig gewesen — `main()`
    ruft diese Funktion aber aus dem Hauptfaden.

    WARUM DIE FRIST TROTZDEM BLEIBT — sie ist nicht der Notnagel, als der sie
    beschrieben war, aber sie ist billig und sie ist robust: sie macht diese
    Wartestelle unabhaengig davon, in welchem Faden sie einmal landet, und
    unabhaengig davon, ob eine kuenftige Python-Fassung den Hauptfaden anders
    behandelt. Der Preis ist ein Aufwachen je Sekunde und damit nichts.

    UND DAS DAHINTER GILT WEITER, unabhaengig von der falschen Begruendung: die
    Unit raeumt mit `KillMode=control-group` und `TimeoutStopSec=10` ab. WENN
    das Stoppen je in die Frist liefe, schoesse systemd hart — und der harte
    Schuss laesst die Zustandsdatei stehen. Stuende darin eine "0", laese die
    naechste Halteschleife „gedrueckt", ohne dass jemand drueckt. Nachgemessen
    ist beides: die Leitung gibt der Kernel beim Schliessen der Datei wieder
    frei (GPIO17 war danach ohne Besitzer), die DATEI aber blieb liegen. Genau
    deshalb loescht `off_trigger.sh` sie vor jedem Start.
    """
    while not ende.wait(1.0):
        pass


def sagen(text: str) -> None:
    """Eine Meldung auf die Standardausgabe — und SOFORT spuelen.

    Ohne das Spuelen liegt „BEREIT" in einem Puffer von 4 KB und kommt bei der
    Bash-Seite erst an, wenn genug nachgekommen ist. Bei einem Waechter, der im
    Ruhezustand tagelang schweigt, heisst „genug" praktisch: nie. Die Bash-Seite
    wartet dann auf ein Bereit, das laengst geschrieben ist, und meldet einen
    Helfer, der nicht hochkommt.
    """
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def klagen(text: str) -> None:
    """Eine Fehlermeldung — sie landet ueber die Unit im Protokoll."""
    sys.stderr.write("taster_wache: " + text + "\n")
    sys.stderr.flush()


def chipnummer(bezeichnung: str) -> int:
    """"gpiochip0", "/dev/gpiochip0" oder "0" -> 0.

    `off_trigger.sh` reicht durch, was `ls /dev/ | grep -m1 gpiochip` gefunden
    hat, also den blossen Namen. Die Bibliotheken wollen eine Zahl.
    """
    rest = bezeichnung.strip().rsplit("/", 1)[-1]
    if rest.startswith("gpiochip"):
        rest = rest[len("gpiochip"):]
    if not rest.isdigit():
        raise ValueError(f"kein GPIO-Chip zu erkennen in '{bezeichnung}'")
    return int(rest)


class Zustandsdatei:
    """Der aktuelle Stand der Leitung, fuer die Bash-Seite lesbar ohne Prozess.

    ATOMAR ueber `os.replace`. Das ist der ganze Trick und er ist wichtig: die
    Halteschleife liest diese Datei bis zu siebzigmal je Druck, waehrend dieser
    Prozess sie von einem anderen Faden aus beschreibt. Ein `open(…, "w")`
    kuerzt die Datei zuerst auf null — ein `read` in genau diesem Augenblick
    bekaeme eine LEERE Zeile. Leer ist nicht "0", also „losgelassen", also ein
    Abbruch mitten im Halten: der Knopf tut dann sporadisch nichts. Genau die
    Sorte Fehler, die man nie nachstellen kann.
    """

    def __init__(self, pfad: Path):
        self.pfad = pfad
        self.neben = pfad.with_suffix(pfad.suffix + ".neu")
        pfad.parent.mkdir(parents=True, exist_ok=True)
        self._schloss = threading.Lock()

    def schreiben(self, stand: int) -> None:
        with self._schloss:
            self.neben.write_text(f"{stand}\n")
            os.replace(self.neben, self.pfad)

    def aufraeumen(self) -> None:
        for p in (self.neben, self.pfad):
            try:
                p.unlink()
            except OSError:
                pass


# ════ DER WEG UEBER lgpio ═══════════════════════════════════════════════════
#
# Der bevorzugte: er ist auf dieser Box installiert, er ist das, worauf
# rpi-lgpio selbst aufsetzt, und er kann eine Entprellung im Treiber.


def ueber_lgpio(chip: int, leitung: int, datei: Zustandsdatei, ende) -> int:
    import lgpio

    try:
        griff = lgpio.gpiochip_open(chip)
    except Exception as f:
        klagen(
            f"gpiochip{chip} laesst sich nicht oeffnen ({f}). "
            "Laeuft der Waechter als root? /dev/gpiochip* gehoert root:gpio."
        )
        return 2

    try:
        # SET_PULL_UP: der Taster zieht die Leitung nach Masse, also ist
        # gedrueckt = 0 und losgelassen = 1. Ohne einen Hochzieher haengt eine
        # offene Leitung in der Luft und liest zufaellig — und „zufaellig 0"
        # heisst hier „die Box geht aus".
        #
        # AM GERAET GEMESSEN (08.08.2026): GPIO17 liest 1, auch wenn man
        # ausdruecklich nach unten zieht (SET_PULL_DOWN). Auf der Leitung sitzt
        # also ein AEUSSERER Hochzieher — dort haengt Beschaltung, nicht nichts.
        # Der innere Hochzieher hier schadet daneben nicht und rettet den Fall,
        # in dem eine Box ohne aeusseren gebaut ist.
        lgpio.gpio_claim_alert(
            griff, leitung, lgpio.BOTH_EDGES, lgpio.SET_PULL_UP
        )
    except Exception as f:
        lgpio.gpiochip_close(griff)
        klagen(
            f"Leitung {leitung} auf gpiochip{chip} laesst sich nicht beanspruchen "
            f"({f}). Haelt sie schon jemand? `cat /sys/kernel/debug/gpio` sagt es. "
            "Ein Waechter ohne Leitung bewacht nichts - Abbruch."
        )
        return 3

    try:
        lgpio.gpio_set_debounce_micros(griff, leitung, ENTPRELLUNG_US)
    except Exception as f:
        # KEIN ABBRUCH. Die Entprellung ist eine Verbesserung, keine Bedingung:
        # ohne sie prellt der Kontakt ein paar Millisekunden, und die
        # Halteschleife probt fruehestens 40 ms spaeter ohnehin darueber hinweg.
        # Eine Bibliotheksfassung ohne diesen Griff darf den Ausschalter nicht
        # kosten.
        klagen(f"Entprellung nicht setzbar ({f}) - es geht auch ohne, weiter")

    stand = lgpio.gpio_read(griff, leitung)
    datei.schreiben(stand)

    def bei_flanke(_chip, _leitung, pegel, _zeit):
        # pegel 2 heisst bei lgpio „Wachhund", kein echter Flankenwechsel.
        if pegel not in (0, 1):
            return
        datei.schreiben(pegel)
        sagen("FLANKE" if pegel == 0 else "LOS")

    rueckruf = lgpio.callback(griff, leitung, lgpio.BOTH_EDGES, bei_flanke)

    sagen(f"BEREIT {stand}")
    try:
        warten_bis_ende(ende)
    finally:
        try:
            rueckruf.cancel()
        except Exception:
            pass
        try:
            lgpio.gpio_free(griff, leitung)
        except Exception:
            pass
        lgpio.gpiochip_close(griff)
    return 0


# ════ DER WEG UEBER RPi.GPIO ════════════════════════════════════════════════
#
# WOFUER ER DA IST: nicht fuer diese Box. Hier IST RPi.GPIO nur ein Nachbau auf
# lgpio (`python3-rpi-lgpio`), der Weg oben ist derselbe mit einer Schicht
# weniger. Aber die MuPiBox laeuft auch auf aelteren Pis, auf denen das echte
# `python3-rpi.gpio` liegt und `lgpio` fehlen kann. Dort haelt dieser Zweig den
# Ausschalter am Leben.
#
# Er kennt keine Chipnummer — RPi.GPIO redet immer mit dem Kopfleisten-Chip.
# Steht in der Konfiguration ein anderer, wird das gesagt und nicht verschwiegen.


def ueber_rpi_gpio(chip: int, leitung: int, datei: Zustandsdatei, ende) -> int:
    import RPi.GPIO as GPIO

    if chip != 0:
        klagen(
            f"RPi.GPIO kennt nur die Kopfleiste; gpiochip{chip} wird ignoriert "
            "und Leitung {leitung} dort gesucht, wo RPi.GPIO sie erwartet"
        )

    GPIO.setwarnings(False)
    GPIO.setmode(GPIO.BCM)
    try:
        GPIO.setup(leitung, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    except Exception as f:
        klagen(f"Leitung {leitung} laesst sich nicht als Eingang einrichten ({f})")
        return 3

    stand = GPIO.input(leitung)
    datei.schreiben(stand)

    def bei_flanke(_leitung):
        pegel = GPIO.input(leitung)
        datei.schreiben(pegel)
        sagen("FLANKE" if pegel == 0 else "LOS")

    try:
        GPIO.add_event_detect(
            leitung, GPIO.BOTH, callback=bei_flanke,
            bouncetime=max(1, ENTPRELLUNG_US // 1000),
        )
    except Exception as f:
        GPIO.cleanup(leitung)
        klagen(f"Flankenerkennung auf Leitung {leitung} geht nicht ({f}) - Abbruch")
        return 3

    sagen(f"BEREIT {stand}")
    try:
        warten_bis_ende(ende)
    finally:
        try:
            GPIO.remove_event_detect(leitung)
        except Exception:
            pass
        GPIO.cleanup(leitung)
    return 0


# ════ DAS PROGRAMM ══════════════════════════════════════════════════════════


def main(argv=None) -> int:
    z = argparse.ArgumentParser(
        description="Meldet Druck und Zustand des Ausschalt-Tasters an off_trigger.sh"
    )
    z.add_argument("--chip", default="gpiochip0",
                   help="GPIO-Chip, als Name oder Zahl (Vorgabe gpiochip0)")
    z.add_argument("--leitung", type=int, required=True,
                   help="Leitung in BCM-Zaehlung, z. B. 17")
    z.add_argument("--zustandsdatei", required=True,
                   help="Datei, in der der aktuelle Stand steht (auf tmpfs)")
    z.add_argument("--weg", choices=("auto", "lgpio", "rpi"), default="auto",
                   help="Welcher Unterbau (Vorgabe: auto, lgpio zuerst)")
    a = z.parse_args(argv)

    try:
        chip = chipnummer(a.chip)
    except ValueError as f:
        klagen(str(f))
        return 4

    datei = Zustandsdatei(Path(a.zustandsdatei))

    # ── DAS ENDE KOMMT VON AUSSEN ────────────────────────────────────────
    # Die Unit raeumt beim Stoppen die ganze Gruppe ab (KillMode=control-group),
    # dieser Helfer bekommt also SIGTERM. Ohne diesen Griff naehme Python den
    # Vorgabeweg und braeche mitten im Rueckruf ab — die Leitung bliebe beim
    # Kernel beansprucht, und der NAECHSTE Start faende sie belegt. Genau daran
    # ist der alte `gpiomon` immer wieder haengengeblieben.
    ende = threading.Event()

    def abwinken(_signal, _rahmen):
        ende.set()

    signal.signal(signal.SIGTERM, abwinken)
    signal.signal(signal.SIGINT, abwinken)

    wege = []
    if a.weg in ("auto", "lgpio"):
        wege.append(("lgpio", ueber_lgpio))
    if a.weg in ("auto", "rpi"):
        wege.append(("RPi.GPIO", ueber_rpi_gpio))

    letzter = None
    for name, weg in wege:
        try:
            rc = weg(chip, a.leitung, datei, ende)
        except ImportError as f:
            # NUR ein fehlendes Modul rechtfertigt den naechsten Weg. Eine
            # BELEGTE Leitung waere ueber jeden Weg belegt; es noch einmal zu
            # versuchen verschleiert nur, woran es lag.
            klagen(f"{name} steht nicht zur Verfuegung ({f})")
            letzter = f
            continue
        datei.aufraeumen()
        return rc

    klagen(
        "Weder lgpio noch RPi.GPIO sind da - der Taster kann nicht bewacht "
        "werden. Fehlen 'python3-lgpio' und 'python3-rpi-lgpio'? "
        f"(zuletzt: {letzter})"
    )
    return 5


if __name__ == "__main__":
    sys.exit(main())
