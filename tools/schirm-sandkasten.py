#!/usr/bin/env python3
"""
SIEHT DIE BOX IHREN SCHIRM? — die beiden Auswerter im Sandkasten.

WOZU ES DIESE DATEI GIBT
========================
Zwei Dauerlaeufer wollen jede Sekunde wissen, ob der Bildschirm an ist:

    scripts/mupibox/get_monitor.sh     schreibt daraus monitor.json
                                       ("block inputs if the screen is blank")
    scripts/mupibox/mupi_start_led.sh  macht daraus led_dim_mode — das
                                       Knopflicht soll dunkler werden, wenn
                                       der Schirm ausgeht

Beide fragten `vcgencmd display_power`. DEN BEFEHL GIBT ES AUF DEM PI 5 NICHT
MEHR; er antwortet zweizeilig auf STDOUT und beide Auswerter gingen daran
STILL kaputt — nicht mit einer Fehlermeldung, sondern indem sie das Falsche
taten. Genau solche Fehler soll diese Probe fangen: nicht "stuerzt ab",
sondern "arbeitet unbemerkt ins Leere".

WAS DIESE PROBE ANDERS MACHT ALS tools/schirmwahrnehmung-probe.sh
=================================================================
Die aeltere Probe rechnet die Shell-Zeilen NACH — sie schreibt die Logik ein
zweites Mal auf und prueft damit sich selbst. Diese hier startet die ECHTEN
SKRIPTDATEIEN und sieht nach, was hinten herauskommt. Umgeschrieben werden
ausschliesslich die fest verdrahteten PFADE (welche Datei, welches
backlight-Verzeichnis, welches Programmverzeichnis); keine einzige Zeile
Entscheidungslogik wird angefasst. Welche Ersetzungen das sind, steht in
`praeparieren()`, und jede von ihnen MUSS greifen — sonst bricht die Probe ab,
statt stillschweigend etwas anderes zu messen als das, was auf der Box laeuft.

DIE GEGENPROBE GEHOERT DAZU
===========================
Jeder Fall laeuft zweimal: gegen den Arbeitsbaum und gegen die Fassung VOR
der Reparatur. Mit der alten Fassung MUSS die Pi-5-Wirklichkeit rot werden.
Wird sie das nicht, taugt die Probe nichts und die Datei meldet das als
eigenen Fehler.

Die alte Fassung kommt aus der Geschichte — die juengste, in der es
`schirm_zustand` noch nicht gibt (siehe `vorher_fassung`). NICHT aus HEAD:
sobald die Reparatur festgeschrieben ist, ist HEAD die reparierte Fassung,
und die Gegenprobe verglich Neu gegen Neu.

WIE GEMESSEN WIRD
=================
Jeder Fall laeuft in ZWEI PHASEN, weil ein Standbild nicht zwischen "sagt
richtig an" und "sagt gar nichts mehr" unterscheiden kann:

    Phase 1  Schirm auf das GEGENTEIL des erwarteten Ergebnisses stellen
    Phase 2  den zu pruefenden Fall stellen -> und jetzt?

Dass Phase 1 auf dem Gegenteil steht, ist der Kern der Sache. Stuende sie
schon auf dem erwarteten Wert, kaeme ein TOTER Auswerter — einer, der gar
nichts mehr schreibt — gruen durch, weil er den richtigen Wert geerbt hat.
Genau daran ist eine erste Fassung dieser Probe aufgefallen: zwei Laeufe mit
der kaputten alten Fassung waren gruen. Bedeutet der Fall "unbekannt", muss
der Wert aus Phase 1 unveraendert stehenbleiben.

AUFRUF
    python3 tools/schirm-sandkasten.py
    python3 tools/schirm-sandkasten.py --fall pi5-schirm-aus   # nur einer
    python3 tools/schirm-sandkasten.py --laut                  # mit Ausgabe

RUECKGABE: 0 alles wie erwartet, 1 mindestens ein Fall sitzt nicht.
Die Probe braucht die Box NICHT und fasst nichts am Geraet an.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
GET_MONITOR = "scripts/mupibox/get_monitor.sh"
START_LED = "scripts/mupibox/mupi_start_led.sh"

# Die zwei Zeilen, mit denen der Pi 5 auf `vcgencmd display_power` antwortet.
# Wortgleich am 08.08.2026 an der Box abgenommen — auf STDOUT, Rueckgabe 255.
PI5_FEHLER = 'vc_gencmd_read_response returned -1\nerror=1 error_msg="Command not registered"'

# Wie lange je Phase gewartet wird. Beide Schleifen takten mit `sleep 1`.
PHASE1 = 2.2
PHASE2 = 2.6


# ── Die Faelle ─────────────────────────────────────────────────────────────
#
# backlight: Liste von (Geraetename, bl_power-Inhalt) — leere Liste heisst
#            "kein /sys/class/backlight-Verzeichnis".
# vcgencmd:  "fehler"  die zwei Pi-5-Zeilen, Rueckgabe 255
#            "fehlt"   den Befehl gibt es gar nicht
#            "an"      display_power=1
#            "aus"     display_power=0
#            "muell"   irgendetwas anderes Einzeiliges
# erwartet:  "an" | "aus" | "unbekannt"


@dataclass
class Fall:
    name: str
    backlight: list[tuple[str, str]]
    vcgencmd: str
    erwartet: str
    wozu: str
    # Faelle, die mit der Fassung VOR der Reparatur kaputtgehen MUESSEN:
    vorher_muss_scheitern: bool = False
    # WLED in der Konfiguration einschalten. Dann muessen bei jedem Wechsel
    # die vier wled_*-Werte gesetzt sein und wled_send_data.py gerufen werden.
    wled: bool = False


FAELLE: list[Fall] = [
    Fall(
        "pi5-schirm-an",
        [("11-0045", "0")],
        "fehler",
        "an",
        "Die Box, wie sie heute Nacht dasteht: bl_power 0, vcgencmd kaputt.",
        vorher_muss_scheitern=True,
    ),
    Fall(
        "pi5-schirm-aus",
        [("11-0045", "4")],
        "fehler",
        "aus",
        "Dasselbe mit dunklem Schirm — hier muss das Knopflicht dimmen.",
        vorher_muss_scheitern=True,
    ),
    Fall(
        "pi5-ohne-vcgencmd",
        [("11-0045", "0")],
        "fehlt",
        "an",
        "Den Befehl gibt es gar nicht mehr; bl_power allein muss reichen.",
        vorher_muss_scheitern=True,
    ),
    Fall(
        "mehrere-erstes-an",
        [("11-0045", "0"), ("12-0099", "4")],
        "fehler",
        "an",
        "Mehrere backlight-Geraete: das erste gewinnt, und zwar immer dasselbe.",
        vorher_muss_scheitern=True,
    ),
    Fall(
        "mehrere-erstes-aus",
        [("11-0045", "4"), ("12-0099", "0")],
        "fehler",
        "aus",
        "Gegenprobe dazu — sonst waere 'das erste gewinnt' nicht gezeigt.",
        vorher_muss_scheitern=True,
    ),
    Fall(
        "pi4-hdmi-an",
        [],
        "an",
        "an",
        "Pi 3/4 am HDMI-Schirm: kein backlight, aber vcgencmd weiss noch was.",
    ),
    Fall(
        "pi4-hdmi-aus",
        [],
        "aus",
        "aus",
        "Derselbe Pi 4 mit dunklem Schirm.",
    ),
    Fall(
        "nichts-zu-holen",
        [],
        "fehler",
        "unbekannt",
        "Kein backlight UND vcgencmd kaputt: nichts wissen, nichts aendern.",
    ),
    Fall(
        "gar-keine-quelle",
        [],
        "fehlt",
        "unbekannt",
        "Weder backlight noch Befehl — darf nicht in 'aus' umschlagen.",
    ),
    Fall(
        "muell-am-eingang",
        [],
        "muell",
        "unbekannt",
        "Antwortet der Befehl Unsinn, gilt das nicht als Messwert.",
    ),
    Fall(
        "mit-wled",
        [("11-0045", "4")],
        "fehler",
        "aus",
        "Mit eingeschaltetem WLED: die vier wled_*-Werte werden seit 08.08.2026 "
        "nur noch geholt, wenn WLED an ist — sie muessen dann aber dastehen.",
        vorher_muss_scheitern=True,
        wled=True,
    ),
]


# ── Sandkasten bauen ───────────────────────────────────────────────────────

# Die Werkzeuge, die die Skripte aufrufen. Der Sandkasten bekommt einen
# EIGENEN PATH, in dem nur diese stehen — sonst faende der Fall "Befehl fehlt
# ganz" auf einem echten Pi das echte vcgencmd und pruefte nichts.
WERKZEUGE = [
    "bash", "sh", "cat", "mv", "rm", "wc", "grep", "sed", "sleep", "chown",
    "jq", "python3", "cut", "head", "tail", "ls", "env", "dirname", "id",
    "printf", "date", "mkdir", "touch",
]


def sandkasten_bauen(ordner: Path, fall: Fall) -> None:
    bin_ = ordner / "bin"
    bin_.mkdir(parents=True)
    (ordner / "sys" / "class" / "backlight").mkdir(parents=True)

    for name in WERKZEUGE:
        pfad = shutil.which(name)
        if pfad:
            try:
                (bin_ / name).symlink_to(pfad)
            except FileExistsError:
                pass

    # Der nachgestellte vcgencmd. Er liest bei JEDEM Aufruf neu, was er
    # antworten soll — so laesst sich zwischen Phase 1 und Phase 2 umschalten,
    # ohne das Skript neu zu starten. Jeder Aufruf wird mitgeschrieben; daran
    # zeigt sich, ob die neue Fassung den Befehl ueberhaupt noch anfasst.
    (bin_ / "vcgencmd").write_text(
        "#!/bin/bash\n"
        f'echo "vcgencmd $*" >> "{ordner}/aufrufe.txt"\n'
        f'modus=$(cat "{ordner}/vcgencmd.modus" 2>/dev/null)\n'
        'case "${modus}" in\n'
        f'  fehler) printf %s\\\\n "{PI5_FEHLER}"; exit 255 ;;\n'
        '  an)     echo "display_power=1" ;;\n'
        '  aus)    echo "display_power=0" ;;\n'
        '  muell)  echo "ganz was anderes" ;;\n'
        '  *)      exit 1 ;;\n'
        "esac\n"
    )
    (bin_ / "vcgencmd").chmod(0o755)

    # Ein nachgestelltes sudo, das nur mitschreibt und dann ausfuehrt. Es gibt
    # den Blick darauf frei, wie oft die alte Fassung sudo bemueht — dreimal
    # je Aufruf steht das im Journal.
    (bin_ / "sudo").write_text(
        "#!/bin/bash\n"
        f'echo "sudo $*" >> "{ordner}/aufrufe.txt"\n'
        "while [ $# -gt 0 ]; do\n"
        '  case "$1" in\n'
        "    -n|-H|-E) shift ;;\n"
        "    -u) shift 2 ;;\n"
        "    *) break ;;\n"
        "  esac\n"
        "done\n"
        '[ $# -eq 0 ] && exit 0\n'
        'exec "$@"\n'
    )
    (bin_ / "sudo").chmod(0o755)

    # led_control.py und wled_send_data.py werden vom LED-Skript gestartet.
    # Im Sandkasten duerfen sie nichts tun ausser sich sofort zu beenden —
    # wled_send_data.py schreibt vorher auf, womit es gerufen wurde. Daran
    # zeigt sich, ob die vier wled_*-Werte wirklich dastanden.
    (bin_ / "led_control.py").write_text("import sys\nsys.exit(0)\n")
    (bin_ / "wled_send_data.py").write_text(
        "import sys\n"
        f"open({str(ordner / 'wled-aufrufe.txt')!r}, 'a').write("
        "' '.join(sys.argv[1:]) + chr(10))\n"
        "sys.exit(0)\n"
    )
    (bin_ / "pidof").write_text("#!/bin/bash\necho 4711\n")
    (bin_ / "pidof").chmod(0o755)

    # DER LAUFENDE KIOSK. Frueher fragte mupi_start_led.sh mit `pidof` danach,
    # und diese Probe stellte darum `pidof` nach. Seit der Kiosk in ZWEI
    # Browsern kommen kann (Chromium ODER Cog) fragt das Skript mit
    # `pgrep -f '(^|/)(chromium[a-z-]*|cog)[[:space:]].*https?://'` —
    # `pgrep` steht in keiner Werkzeugliste dieses Sandkastens, der Befehl
    # fehlte also ganz, `! kiosk_laeuft` war IMMER wahr, und der Fall
    # `mit-wled` haengte in der Startschleife fest. Gemeldet wurde das als
    # zwei Befunde an der NEUEN Fassung ("-> an" statt "aus" und "WLED war an,
    # aber wled_send_data.py wurde nicht gerufen") — beides Fehlalarm aus
    # einer Attrappe, die dem Skript nicht nachgezogen wurde. Gefunden am
    # 25.08.2026, weil diese Probe in KEINEM Laeufer hing
    # (llmwiki: `ungerufene-wache-driftet-in-den-fehlalarm`).
    (bin_ / "pgrep").write_text("#!/bin/bash\necho 4711\n")
    (bin_ / "pgrep").chmod(0o755)

    # Eine Konfiguration, die dem LED-Skript reicht. WLED ist normalerweise
    # AUS; ist es an, wartet das Skript beim Start auf einen Chromium — dafuer
    # gibt es oben das nachgestellte `pidof`.
    (ordner / "mupiboxconfig.json").write_text(json.dumps({
        "shim": {
            "ledPin": 13,
            "ledBrightnessMax": 100,
            "ledBrightnessMin": 10,
            "ledEnabled": True,
        },
        "wled": {
            "active": fall.wled,
            "com_port": "/dev/ttyPRUEF",
            "main_id": 1,
            "baud_rate": 115200,
            "brightness_default": 100,
            "brightness_dimmed": 10,
        },
    }, indent=2) + "\n")
    (ordner / "monitor.json").write_text('{\n  "monitor": "On"\n}\n')


def schirm_stellen(ordner: Path, backlight: list[tuple[str, str]], vcgencmd: str) -> None:
    """Den nachgestellten Schirm auf einen Zustand bringen."""
    wurzel = ordner / "sys" / "class" / "backlight"
    for alt in wurzel.iterdir():
        shutil.rmtree(alt)
    for name, wert in backlight:
        (wurzel / name).mkdir()
        (wurzel / name / "bl_power").write_text(wert + "\n")

    (ordner / "vcgencmd.modus").write_text(vcgencmd)
    stellvertreter = ordner / "bin" / "vcgencmd"
    if vcgencmd == "fehlt":
        if stellvertreter.exists():
            stellvertreter.rename(ordner / "vcgencmd.beiseite")
    else:
        beiseite = ordner / "vcgencmd.beiseite"
        if beiseite.exists():
            beiseite.rename(stellvertreter)


# ── Die Skripte umbiegen ───────────────────────────────────────────────────

def praeparieren(quelltext: str, ordner: Path, skript: str, vorher: bool) -> str:
    """
    NUR PFADE UMBIEGEN — keine Entscheidungslogik anfassen.

    Jede Ersetzung ist hier einzeln aufgefuehrt und MUSS greifen. Verschwindet
    eine davon aus dem Skript, bricht die Probe ab: lieber ein lauter Abbruch
    als eine gruene Probe, die etwas anderes gemessen hat als das, was auf der
    Box laeuft.

    EINE AUSNAHME, UND SIE HAT DIESE PROBE SCHON EINMAL WERTLOS GEMACHT: die
    ALTE Fassung von mupi_start_led.sh kennt /sys/class/backlight ueberhaupt
    nicht — sie fragte nur vcgencmd. Der Pfad ist fuer sie deshalb nicht
    Pflicht. Frueher stand hier, in diesem Fall werde ueberhaupt nicht ersetzt,
    und damit las die alte Fassung DAS ECHTE /sys/class/backlight DES RECHNERS,
    auf dem die Probe laeuft. Sie war rot — aber aus dem falschen Grund, und
    auf einem Rechner ohne Bildschirmklasse waere sie gruen geworden.
    Deshalb: nicht Pflicht heisst "ersetzen, WENN da"; herausfallen darf
    nichts. Am Ende wird nachgesehen, dass wirklich kein Systempfad mehr
    uebrig ist.
    """
    pflicht: list[tuple[str, str]] = []
    wenn_da: list[tuple[str, str]] = []

    backlight = ("/sys/class/backlight", f"{ordner}/sys/class/backlight")
    if vorher and skript == START_LED:
        wenn_da.append(backlight)
    else:
        pflicht.append(backlight)

    if skript == GET_MONITOR:
        pflicht.append((
            "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/monitor.json",
            f"{ordner}/monitor.json",
        ))
    else:
        pflicht += [
            ("/etc/mupibox/mupiboxconfig.json", f"{ordner}/mupiboxconfig.json"),
            ("/tmp/.power_led", f"{ordner}/.power_led"),
            ("/usr/local/bin/mupibox/", f"{ordner}/bin/"),
        ]

    for alt, neu in pflicht:
        if alt not in quelltext:
            raise SystemExit(
                f"ABBRUCH: in {skript} steht '{alt}' nicht mehr.\n"
                "Die Probe wuerde sonst am echten System messen. "
                "Bitte praeparieren() nachziehen."
            )
        quelltext = quelltext.replace(alt, neu)

    for alt, neu in wenn_da:
        quelltext = quelltext.replace(alt, neu)

    # Absolute Werkzeugpfade auf den Sandkasten-PATH umlenken. Freiwillig:
    # nicht jedes Skript nennt jedes davon.
    for alt, neu in [
        ("/usr/bin/jq", "jq"),
        ("/usr/bin/cat", "cat"),
        ("/usr/bin/python3", "python3"),
        ("/bin/mv", "mv"),
    ]:
        quelltext = quelltext.replace(alt, neu)

    # NACHSEHEN, DASS KEIN SYSTEMPFAD UEBRIG IST. Jede verbliebene Nennung
    # muss innerhalb des Sandkastens liegen; sonst laese das Skript am echten
    # Rechner nach — genau der Fehler, an dem die Gegenprobe schon einmal
    # stillschweigend vorbeigemessen hat.
    for stelle in re.finditer(r"/sys/class/backlight", quelltext):
        if not quelltext[:stelle.start()].endswith(str(ordner)):
            raise SystemExit(
                f"ABBRUCH: in {skript} zeigt eine Nennung von "
                "/sys/class/backlight noch auf das echte System."
            )

    # UND DASS JEDE PROZESSFRAGE EINE ATTRAPPE HAT. Der Sandkasten gibt dem
    # Skript einen EIGENEN PATH; fragt es nach einem Befehl, den es dort nicht
    # gibt, schlaegt der Aufruf fehl — und in einer Warteschleife
    # (`while ! kiosk_laeuft`) heisst das: das Skript kommt nie los und die
    # Probe meldet den Stillstand als Befund an der gemessenen Fassung.
    # GENAU DAS ist am 25.08.2026 passiert, als `kiosk_laeuft` von `pidof` auf
    # `pgrep -f` umgestellt wurde und hier niemand nachzog. Ein fehlender
    # Befehl darf nicht als roter Lauf durchgehen, sondern muss die Probe
    # abbrechen.
    # IN BEFEHLSSTELLUNG gesucht, nicht als Wort: `{"ps":` ist ein
    # JSON-Schluessel im WLED-Datensatz und hat mit dem Befehl `ps` nichts zu
    # tun. Eine erste Fassung dieses Riegels brach genau daran ab.
    for befehl in ("pidof", "pgrep", "ps", "systemctl"):
        in_befehlsstellung = re.search(rf"(?m)(?:^|[;|&(!]|\$\()[\t ]*{befehl}[\t ]", quelltext)
        if in_befehlsstellung and not (ordner / "bin" / befehl).exists():
            raise SystemExit(
                f"ABBRUCH: {skript} fragt mit `{befehl}` nach einem Prozess, "
                f"aber der Sandkasten stellt `{befehl}` nicht nach.\n"
                "Ohne Attrappe schlaegt der Aufruf fehl — in einer Warteschleife "
                "haengt das Skript dann fest und die Probe meldet einen Fehlalarm. "
                "Bitte sandkasten_bauen() nachziehen."
            )

    # `chown dietpi:dietpi` gibt es im Sandkasten nicht — der Aufruf ist im
    # Skript schon mit 2>/dev/null abgesichert, wir lassen ihn stehen.
    return quelltext


# Woran die reparierte Fassung zu erkennen ist. Die Funktion heisst in BEIDEN
# Skripten so; vor der Reparatur vom 08.08.2026 gab es sie in keinem.
MARKE_REPARIERT = "schirm_zustand"


def vorher_fassung(skript: str) -> str:
    """
    Die letzte Fassung VOR der Reparatur — aus der Geschichte geholt.

    WARUM NICHT `git show HEAD:` (so stand es hier zuerst): sobald die
    Reparatur festgeschrieben ist, IST HEAD die reparierte Fassung. Die
    Gegenprobe verglich dann Neu gegen Neu und war wertlos — die Probe hat
    das zwar gemeldet ("GEGENPROBE UNTAUGLICH") und mit 1 geendet, aber damit
    war sie ab dem Festschreiben dauerhaft rot.

    Auch kein fester Commit-Hash: der ueberlebt kein Umschreiben der
    Geschichte. Gesucht wird stattdessen die juengste Fassung der Datei, in
    der es `schirm_zustand` noch nicht gibt. Das ist genau die Fassung, die
    auf dem Pi 5 blind war.
    """
    stand = subprocess.run(
        ["git", "log", "--format=%H", "--", skript],
        cwd=BAUM, capture_output=True, text=True, check=True,
    ).stdout.split()

    for rev in stand:
        text = subprocess.run(
            ["git", "show", f"{rev}:{skript}"],
            cwd=BAUM, capture_output=True, text=True, check=True,
        ).stdout
        if MARKE_REPARIERT not in text:
            return text

    raise SystemExit(
        f"ABBRUCH: in der Geschichte von {skript} gibt es keine Fassung ohne "
        f"'{MARKE_REPARIERT}'. Ohne die kaputte Fassung ist die Gegenprobe "
        "nicht zu fahren."
    )


def fassung_holen(skript: str, vorher: bool) -> str:
    if vorher:
        return vorher_fassung(skript)
    return (BAUM / skript).read_text()


# ── Einen Fall fahren ──────────────────────────────────────────────────────

@dataclass
class Ergebnis:
    fall: str
    skript: str
    vorher: bool
    gesehen: str
    erwartet: str
    fehlerzeilen: list[str] = field(default_factory=list)
    vcgencmd_aufrufe: int = 0
    sudo_aufrufe: int = 0

    @property
    def sitzt(self) -> bool:
        return self.gesehen == self.erwartet and not self.fehlerzeilen


def ablesen(ordner: Path, skript: str) -> str:
    """Was sagt das Skript gerade — 'an', 'aus' oder 'nichts gesagt'?"""
    if skript == GET_MONITOR:
        text = (ordner / "monitor.json").read_text() if (ordner / "monitor.json").exists() else ""
        if '"Off"' in text:
            return "aus"
        if '"On"' in text:
            return "an"
        return "kaputt"
    datei = ordner / ".power_led"
    if not datei.exists():
        return "keine datei"
    text = datei.read_text()
    treffer = re.search(r'"led_dim_mode"\s*:\s*(\d+)', text)
    if not treffer:
        return "kaputt"
    return "aus" if treffer.group(1) == "1" else "an"


def fall_fahren(fall: Fall, skript: str, vorher: bool, laut: bool) -> Ergebnis:
    ordner = Path(tempfile.mkdtemp(prefix="schirm-sandkasten-"))
    try:
        sandkasten_bauen(ordner, fall)

        text = praeparieren(fassung_holen(skript, vorher), ordner, skript, vorher)
        lauf = ordner / "bin" / Path(skript).name
        lauf.write_text(text)
        lauf.chmod(0o755)

        umgebung = {
            "PATH": f"{ordner}/bin",
            "HOME": str(ordner),
            "LC_ALL": "C",
            "SHELL": "/bin/bash",
        }

        # PHASE 1 — den Schirm auf das GEGENTEIL dessen stellen, was Phase 2
        # ergeben soll. Das ist keine Feinheit, sondern der Kern der Probe:
        # stuende Phase 1 schon auf dem erwarteten Wert, kaeme ein TOTER
        # Auswerter, der gar nichts mehr schreibt, gruen durch — er hat den
        # richtigen Wert dann ja nur geerbt. Bei "unbekannt" wird auf "aus"
        # gestellt und verlangt, dass es dort stehenbleibt.
        gegenteil = {"an": "aus", "aus": "an", "unbekannt": "aus"}[fall.erwartet]
        if gegenteil == "aus":
            schirm_stellen(ordner, [("11-0045", "4")], "aus")
        else:
            schirm_stellen(ordner, [("11-0045", "0")], "an")

        mitschrift = open(ordner / "ausgabe.txt", "wb")
        prozess = subprocess.Popen(
            ["/bin/bash", str(lauf)],
            cwd=ordner, env=umgebung,
            stdout=mitschrift, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            time.sleep(PHASE1)
            phase1 = ablesen(ordner, skript)

            # PHASE 2 — der eigentliche Fall.
            (ordner / "aufrufe.txt").write_text("")
            schirm_stellen(ordner, fall.backlight, fall.vcgencmd)
            time.sleep(PHASE2)
            phase2 = ablesen(ordner, skript)
        finally:
            try:
                os.killpg(os.getpgid(prozess.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            prozess.wait(timeout=5)
            mitschrift.close()

        # "unbekannt" heisst: nichts geaendert — es muss also auf dem Wert aus
        # Phase 1 stehengeblieben sein.
        erwartet = gegenteil if fall.erwartet == "unbekannt" else fall.erwartet

        ausgabe = (ordner / "ausgabe.txt").read_text(errors="replace")
        fehlerzeilen = [
            z for z in ausgabe.splitlines()
            if "too many arguments" in z
            or "integer expression" in z
            or "unary operator" in z
            or "No such file" in z
        ]

        # Bei eingeschaltetem WLED muss der Wechsel auch dort angekommen
        # sein — und zwar mit ECHTEN Werten. Waeren die vier wled_*-Variablen
        # leer, stuende in der Zeile `-b  -j {"bri":}`; genau das faengt die
        # Pruefung auf "null" und auf leere Argumente ab.
        if fall.wled and skript == START_LED:
            rufe = ordner / "wled-aufrufe.txt"
            zeilen = rufe.read_text().splitlines() if rufe.exists() else []
            passend = [z for z in zeilen if '"bri"' in z]
            if not passend:
                fehlerzeilen.append(
                    "WLED war an, aber wled_send_data.py wurde nicht gerufen.")
            for z in passend:
                if "null" in z or re.search(r'"bri":\s*}', z) or "-b  " in z or "-s  " in z:
                    fehlerzeilen.append(f"WLED mit leerem Wert gerufen: {z}")

        # Wenn Phase 1 schon nicht sass, ist die Aussage ueber Phase 2
        # wertlos — das gehoert gemeldet.
        if phase1 != gegenteil:
            fehlerzeilen.insert(
                0, f"Phase 1 sass nicht: erwartet '{gegenteil}', gesehen '{phase1}'")

        aufrufe = (ordner / "aufrufe.txt").read_text() if (ordner / "aufrufe.txt").exists() else ""

        if laut:
            print(f"--- {fall.name} / {Path(skript).name} / "
                  f"{'vorher' if vorher else 'neu'} ---")
            print(f"    Phase 1: {phase1}   Phase 2: {phase2}   erwartet: {erwartet}")
            if ausgabe.strip():
                for z in ausgabe.splitlines()[:6]:
                    print(f"    | {z}")

        return Ergebnis(
            fall=fall.name, skript=skript, vorher=vorher,
            gesehen=phase2, erwartet=erwartet, fehlerzeilen=fehlerzeilen,
            vcgencmd_aufrufe=aufrufe.count("vcgencmd "),
            sudo_aufrufe=aufrufe.count("sudo "),
        )
    finally:
        shutil.rmtree(ordner, ignore_errors=True)


# ── Bericht ────────────────────────────────────────────────────────────────

def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__)
    zerleger.add_argument("--fall", help="nur diesen Fall fahren")
    zerleger.add_argument("--laut", action="store_true", help="Ausgabe der Skripte zeigen")
    zerleger.add_argument("--nur-neu", action="store_true", help="Gegenprobe gegen die alte Fassung weglassen")
    argumente = zerleger.parse_args()

    faelle = FAELLE
    if argumente.fall:
        faelle = [f for f in FAELLE if f.name == argumente.fall]
        if not faelle:
            print(f"Unbekannter Fall: {argumente.fall}", file=sys.stderr)
            print("Bekannt: " + ", ".join(f.name for f in FAELLE), file=sys.stderr)
            return 2

    if not shutil.which("jq"):
        print("Diese Probe braucht jq.", file=sys.stderr)
        return 2

    auftraege = []
    for fall in faelle:
        for skript in (GET_MONITOR, START_LED):
            auftraege.append((fall, skript, False))
            if not argumente.nur_neu:
                auftraege.append((fall, skript, True))

    print(f"SCHIRM-SANDKASTEN — {len(faelle)} Faelle, {len(auftraege)} Laeufe")
    print("Gemessen wird an den echten Skriptdateien; umgebogen sind nur Pfade.")
    print()

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        ergebnisse = list(pool.map(
            lambda a: fall_fahren(a[0], a[1], a[2], argumente.laut), auftraege
        ))

    nach_fall: dict[str, list[Ergebnis]] = {}
    for e in ergebnisse:
        nach_fall.setdefault(e.fall, []).append(e)

    rot_neu = 0
    vorher_gemerkt = 0
    vorher_gruen = 0

    for fall in faelle:
        print(f"■ {fall.name}")
        print(f"  {fall.wozu}")
        bl = ", ".join(f"{n}={w}" for n, w in fall.backlight) or "kein Verzeichnis"
        print(f"  backlight: {bl}   vcgencmd: {fall.vcgencmd}   erwartet: {fall.erwartet}")

        for e in sorted(nach_fall[fall.name], key=lambda x: (x.vorher, x.skript)):
            fassung = "alt " if e.vorher else "neu "
            marke = "OK  " if e.sitzt else "ROT "
            name = Path(e.skript).name.ljust(19)
            zusatz = ""
            if not e.vorher and e.skript == GET_MONITOR:
                zusatz = f"   (vcgencmd {e.vcgencmd_aufrufe}x, sudo {e.sudo_aufrufe}x)"
            print(f"    {marke} {fassung} {name} -> {e.gesehen:<12}{zusatz}")
            for z in e.fehlerzeilen[:3]:
                print(f"           {z.strip()[:96]}")

            if not e.vorher and not e.sitzt:
                rot_neu += 1
            if e.vorher and fall.vorher_muss_scheitern:
                if e.sitzt:
                    vorher_gruen += 1
                else:
                    vorher_gemerkt += 1
        print()

    print("─" * 74)
    if rot_neu:
        print(f"URTEIL: {rot_neu} Lauf/Laeufe der NEUEN Fassung sitzen nicht.")
        return 1

    print("Neue Fassung: alle Laeufe sitzen.")

    if not argumente.nur_neu:
        if vorher_gruen:
            print(f"GEGENPROBE UNTAUGLICH: {vorher_gruen} Lauf/Laeufe waren mit der")
            print("Fassung VOR der Reparatur ebenfalls gruen, obwohl sie rot sein")
            print("muessten.")
            print("Dann misst diese Probe den Fehler nicht, den sie messen soll.")
            return 1
        print(f"Gegenprobe: die Fassung vor der Reparatur faellt in {vorher_gemerkt} "
              "Laeufen durch —")
        print("            genau in der Pi-5-Wirklichkeit. Die Probe greift.")

    print()
    print("URTEIL: die Box sieht ihren Schirm wieder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
