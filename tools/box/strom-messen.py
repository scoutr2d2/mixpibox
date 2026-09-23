#!/usr/bin/env python3
"""Was kostet welcher Zustand? — der Stromverbrauch der Box, gemessen statt geschaetzt.

    sudo python3 strom-messen.py

Fuer die Frage nach einem BEREITSCHAFTSMODUS (Betreiber, 16.08.2026: "kann man
einen bereitschafts modus mit sehr wenig energie implementieren"). Ohne Zahlen
laesst sie sich nicht beantworten: spart die Bereitschaft die Haelfte, lohnt
sie den zusaetzlichen Zustand — spart sie ein Fuenftel, nicht.

══ NUR AUF AKKU AUSSAGEKRAEFTIG ═══════════════════════════════════════════════

Am Netzteil misst `Ibat` den LADESTROM, nicht den Verbrauch — er wird vom
Laderegler bestimmt und aendert sich nicht, wenn man den Bildschirm abschaltet.
Genau daran ist der erste Messversuch gescheitert (Vbus lag bei 11947 mV, Ibat
bei +2029 mA, und der Bildschirm machte 2 mA Unterschied). Das Skript weigert
sich deshalb, am Netzteil zu messen.

══ ES STELLT ALLES ZURUECK — AUCH WENN DIE VERBINDUNG ABREISST ════════════════

Auf dieser Box faellt das WLAN gelegentlich aus (die Sonde jagt gerade, warum).
Eine Messung, die den Bildschirm dunkel und Chromium angehalten laesst, weil
ssh mittendrin stirbt, waere eine kaputte Box statt eines Messwerts. Deshalb:
ein Wecker im Prozess selbst, und die Wiederherstellung haengt an `finally` UND
an SIGTERM/SIGHUP.

VORBEHALT ZUR BILDSCHIRM-ZEILE (Betreiber, 16.08.2026): `bl_power=1` hat das
Panel womoeglich nur GEDIMMT statt die Hintergrundbeleuchtung abzuschalten —
er hat es am Geraet gesehen. Die gemessenen 13 % sind dann eine UNTERGRENZE.
Wer die Frage wieder aufmacht, prueft zuerst am Panel, ob es wirklich dunkel
wird, und misst sonst ueber `brightness=0` oder den DSI-Schalter.

WAS NICHT GEMESSEN WIRD: WLAN aus. Es waere der naechste grosse Posten, aber
die Messung liefe ueber genau diese Verbindung — man saege den Ast ab, auf dem
man sitzt. Dafuer braucht es einen Lauf mit Bildschirm am Geraet.
"""
from __future__ import annotations

import json
import signal
import subprocess
import sys
import time
import urllib.request

BACKLIGHT = "/sys/class/backlight/11-0045"
# Die ganze Messung bricht spaetestens nach dieser Zeit ab und stellt her.
NOTBREMSE_S = 240


class Zustand:
    """Was veraendert wurde — und wie es zurueckgeht."""

    def __init__(self) -> None:
        self.schirm_aus = False
        self.gestoppt: list[int] = []

    def herstellen(self) -> None:
        if self.schirm_aus:
            schreiben(f"{BACKLIGHT}/bl_power", "0")
            self.schirm_aus = False
        for pid in self.gestoppt:
            try:
                subprocess.run(["kill", "-CONT", str(pid)], capture_output=True, timeout=5)
            except Exception:
                pass
        self.gestoppt = []


ZUSTAND = Zustand()


def schreiben(pfad: str, wert: str) -> bool:
    try:
        with open(pfad, "w") as f:
            f.write(wert)
        return True
    except Exception:
        return False


def hat() -> dict:
    try:
        return json.load(urllib.request.urlopen("http://localhost:8200/api/mupihat", timeout=4))
    except Exception:
        return {}


def messen(sekunden: int, was: str) -> dict:
    """Mittelwert ueber mehrere Proben. EINE Probe ist kein Messwert:
    der Verbrauch schwankt mit jedem Bildaufbau und jedem Netzpaket."""
    proben: list[int] = []
    ende = time.time() + sekunden
    while time.time() < ende:
        d = hat()
        i = d.get("Ibat")
        if isinstance(i, (int, float)):
            proben.append(int(i))
        time.sleep(2)
    if not proben:
        return {"was": was, "fehler": "keine Proben"}
    proben.sort()
    mitte = proben[len(proben) // 2]
    # Ibat ist beim Entladen NEGATIV — als Verbrauch ist der Betrag gemeint.
    ma = abs(mitte)
    d = hat()
    volt = d.get("Vbat", 7200) / 1000
    return {
        "was": was,
        "ma": ma,
        "watt": round(ma * volt / 1000, 2),
        "proben": len(proben),
        "spanne": f"{abs(proben[-1])}..{abs(proben[0])}",
    }


def main() -> int:
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, lambda *_: (ZUSTAND.herstellen(), sys.exit(1)))
    signal.signal(signal.SIGALRM, lambda *_: (ZUSTAND.herstellen(), sys.exit(2)))
    signal.alarm(NOTBREMSE_S)

    d = hat()
    if not d:
        print("Der MuPiHAT antwortet nicht.", file=sys.stderr)
        return 2
    if (d.get("Vbus") or 0) > 1000:
        print(f"ABBRUCH: Netzteil haengt dran (Vbus={d['Vbus']} mV).", file=sys.stderr)
        print("Am Netzteil misst Ibat den LADESTROM, nicht den Verbrauch.", file=sys.stderr)
        return 3

    ergebnisse = []
    try:
        print(f"Akkubetrieb, {d.get('Vbat')} mV, SOC {d.get('Bat_SOC')}\n")

        ergebnisse.append(messen(20, "Normalbetrieb (Bildschirm an, alles laeuft)"))
        print(f"  {ergebnisse[-1]}")

        if schreiben(f"{BACKLIGHT}/bl_power", "1"):
            ZUSTAND.schirm_aus = True
            time.sleep(3)
            ergebnisse.append(messen(20, "Bildschirm aus"))
            print(f"  {ergebnisse[-1]}")

        # Chromium ANHALTEN, nicht beenden: SIGSTOP friert ein, SIGCONT holt
        # es zurueck. Ein Neustart des Kiosks daeuerte Sekunden und veraendert
        # den Zustand, den wir messen wollen.
        # BEIDE Browsernamen (E68/C2): auf einer Cog-Box mass diese Zeile
        # null und meldete damit einen Browser, der keinen Strom braucht.
        roh = subprocess.run(
            ["pgrep", "-f", "(^|/)(chromium[a-z-]*|cog)( |$)"], capture_output=True, text=True, timeout=5
        )
        pids = [int(p) for p in roh.stdout.split() if p.isdigit()]
        for pid in pids:
            if subprocess.run(["kill", "-STOP", str(pid)], capture_output=True).returncode == 0:
                ZUSTAND.gestoppt.append(pid)
        if ZUSTAND.gestoppt:
            time.sleep(3)
            ergebnisse.append(messen(20, f"+ Chromium angehalten ({len(ZUSTAND.gestoppt)} Prozesse)"))
            print(f"  {ergebnisse[-1]}")
    finally:
        ZUSTAND.herstellen()
        signal.alarm(0)

    print("\n── ERGEBNIS ──")
    grund = ergebnisse[0].get("ma") if ergebnisse else None
    for e in ergebnisse:
        if "ma" not in e:
            continue
        anteil = f"  ({round(100 * (grund - e['ma']) / grund)} % gespart)" if grund else ""
        print(f"  {e['was']:<46} {e['ma']:>5} mA = {e['watt']:>4} W{anteil}")
    print("\nNICHT gemessen: WLAN aus - die Messung laeuft ueber diese Verbindung.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
