#!/usr/bin/env python3
"""DER NACHGESTELLTE TASTER-WAECHTER — was `taster_wache.py` im Sandkasten ist.

    ausschalter-nachgestellte-wache.py --taster <datei> \
        --zustandsdatei <datei> [--takt 0.002] [--stumm-bis-bereit 0]

Er tut nach aussen genau das, was `scripts/OnOffShim/taster_wache.py` am Geraet
tut — nur dass die Leitung eine DATEI ist, die der Fahrplan des Falls
beschreibt:

    BEREIT <stand>   einmal, sobald er den ersten Stand gelesen hat
    FLANKE           wenn der Taster von 1 auf 0 geht (gedrueckt)
    LOS              wenn er von 0 auf 1 geht (losgelassen)

und spiegelt den Stand nach `--zustandsdatei`, wo die Halteschleife von
`off_trigger.sh` ihn mit dem eingebauten `read` abholt.

── WARUM DAS EINE EIGENE DATEI IST UND NICHT EINE BASH-FUNKTION IM VORSPANN ──

Der Sandkasten stellt sonst alles ueber Funktionen nach, die er per `BASH_ENV`
einschleust. Hier geht das nicht gut, und zwar aus zwei Gruenden:

  * `off_trigger.sh` startet den Waechter mit `>"${MELDEROHR}"` und liest die
    Roehre danach mit `exec 3<>`. Das ist echtes Zusammenspiel zweier Prozesse
    ueber eine benannte Roehre — genau das soll gemessen werden, und eine
    Funktion im selben Prozess misst es nicht.
  * Der Spiegel muss FEIN sein. Am Geraet meldet der Waechter Flanken vom
    Kernel und verpasst grundsaetzlich keine; ein Nachbau, der alle 20 ms
    nachsieht, verschluckt einen 15-ms-Tipper und macht den Sandkasten damit
    GUTMUETIGER als die Wirklichkeit. In Python kostet ein Takt von 2 ms
    nichts, in bash kostete er zwei Prozesse.

── UND WARUM DER STAND GESPIEGELT UND NICHT DIREKT GELESEN WIRD ─────────────

Es waere kuerzer gewesen, `--zustandsdatei` einfach auf die Tasterdatei des
Falls zeigen zu lassen. Dann pruefte der Sandkasten aber eine Zeile NICHT, die
am Geraet wichtig ist: `off_trigger.sh` LOESCHT die Zustandsdatei vor dem Start
(ein alter Stand aus einem hart geschossenen Waechter darf den naechsten Lauf
nicht anluegen). Mit einem Spiegel geht dieses `rm -f` durch den echten Weg;
mit einer Abkuerzung haette es den Fahrplan geloescht.

Der Spiegel schreibt ueber `os.replace`, also mit einem Umbenennen — dieselbe
Vorsicht wie am Geraet: ein `read` auf der Bash-Seite sieht nie eine halbe
Datei.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


def stand_lesen(taster: Path) -> str:
    """Den Stand des nachgestellten Tasters lesen.

    FEHLT DIE DATEI ODER IST SIE LEER, GILT „1" — losgelassen. Das ist
    dieselbe Richtung, die der Sandkasten schon beim alten `gpioget` genommen
    hat (`cat … || echo 1`), und es ist die harmlose: ein Fall, der vergisst,
    den Taster anzulegen, misst dann „nichts passiert" statt „Box aus".
    """
    try:
        roh = taster.read_text().strip()
    except OSError:
        return "1"
    return roh if roh in ("0", "1") else "1"


def main(argv=None) -> int:
    z = argparse.ArgumentParser()
    z.add_argument("--taster", required=True,
                   help="Datei, die der Fahrplan des Falls beschreibt")
    z.add_argument("--zustandsdatei", required=True)
    z.add_argument("--takt", type=float, default=0.002,
                   help="Wie fein nachgesehen wird (Vorgabe 2 ms)")
    z.add_argument("--nicht-bereit", action="store_true",
                   help="NIE 'BEREIT' melden - stellt einen Waechter nach, "
                        "der nicht hochkommt (fehlende Bibliothek, belegte "
                        "Leitung). off_trigger.sh muss dann enden.")
    z.add_argument("--sterben-nach", type=float, default=0.0,
                   help="Nach so vielen Sekunden einfach weg sein - stellt "
                        "einen Waechter nach, den der OOM-Killer holt.")
    # Alles, was off_trigger.sh sonst noch mitgibt, wird angenommen und
    # ignoriert. Ein Nachbau, der an einem neuen Schalter scheitert, macht aus
    # einer Messung eine Fehlermeldung.
    z.add_argument("--protokoll", default="",
                   help="Mitschrift des Falls; hier landen WACHT und FLANKE in "
                        "demselben Format, das die Bash-Funktion `merken` "
                        "schreibt. So bleibt `warte_auf('WACHT')` in allen "
                        "Faellen gueltig, obwohl der Waechter jetzt ein "
                        "eigener Prozess ist.")
    z.add_argument("--chip", default="")
    z.add_argument("--leitung", default="")
    z.add_argument("--weg", default="")
    a = z.parse_args(argv)

    def merken(art: str, text: str = "") -> None:
        if not a.protokoll:
            return
        with open(a.protokoll, "a") as f:
            f.write(f"{int(time.time() * 1000)}\t{art}\t{text}\n")

    taster = Path(a.taster)
    ziel = Path(a.zustandsdatei)
    neben = ziel.with_suffix(ziel.suffix + ".neu")
    ziel.parent.mkdir(parents=True, exist_ok=True)

    def spiegeln(stand: str) -> None:
        neben.write_text(stand + "\n")
        os.replace(neben, ziel)

    stand = stand_lesen(taster)
    spiegeln(stand)

    if a.nicht_bereit:
        # Er schweigt — aber er LEBT. Genau das ist der boese Fall: ein Prozess,
        # den `kill -0` findet, der aber nie meldet, dass er die Leitung hat.
        # off_trigger.sh muss darauf mit einem Abgang antworten und nicht mit
        # „active (running)".
        while True:
            time.sleep(1)

    # DER AUSGANGSSTAND ZUERST, DIE MELDUNG DANACH — dieselbe Reihenfolge und
    # derselbe Grund wie beim alten nachgestellten `gpiomon`: `warte_auf`
    # kehrt zurueck, der Fall drueckt sofort, und wer erst danach den ersten
    # Stand liest, hat die Flanke schon verpasst. Ein Rot, das an der Messung
    # liegt und nicht am Skript, ist teurer als kein Rot.
    sys.stdout.write(f"BEREIT {stand}\n")
    sys.stdout.flush()
    merken("WACHT", f"chip={a.chip} leitung={a.leitung}")

    beginn = time.time()
    while True:
        if a.sterben_nach and time.time() - beginn >= a.sterben_nach:
            return 9
        time.sleep(a.takt)
        jetzt = stand_lesen(taster)
        if jetzt == stand:
            continue
        stand = jetzt
        spiegeln(stand)
        sys.stdout.write("FLANKE\n" if stand == "0" else "LOS\n")
        sys.stdout.flush()
        merken("FLANKE" if stand == "0" else "LOS")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
