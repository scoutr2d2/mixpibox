#!/usr/bin/env python3
"""
Schreiben die zwei Karten-Wege dieselben dietpi.txt-Schluessel? — gemessen
an einer Probekarte, nicht am Quelltext.

══ DER BEFUND, AUS DEM DIESE WACHE ENTSTAND (AUDIT-2026-09-25 Rang 3) ══════

Eine frische Karte entsteht auf zwei Wegen:

    der Assistent   remote-step-installer/controller/sdprep.py
                    (sdstart, sdgui, sdtui) — prepare_boot()
    der Bash-Weg    scripts/make-boot-sd.sh

Die beiden teilten KEINE Zeile. AUTO_SETUP_ACCEPT_LICENSE=1 stand nur im
Assistenten (der blaue Lizenzdialog vom 10.08.2026 kehrte auf dem Bash-Weg
zurueck), die zram-Schluessel (BACKLOG E5/B7) nur im Bash-Weg (die
Assistenten-Karte bekam weiter /var/swap auf der SD). Jeder Weg war fuer
sich gruen — tools/karte-dietpi-schluessel.test.sh prueft den einen,
tests/sdprep_test.py den anderen, und keiner sah hinueber.

Seit dem 29.09.2026 lesen beide EINE Tabelle:
remote-step-installer/controller/mixpi-kartenschluessel.txt. Diese Wache
haelt fest, dass das so bleibt — und zwar am ERGEBNIS: sie faehrt beide Wege
gegen eine Probe-dietpi.txt und vergleicht, was danach WIRKLICH darin steht
(Wiki: dietpi-txt-vorlage-ist-kein-ausrollweg — „geprueft wird, was auf der
Karte steht").

══ WAS GEPRUEFT WIRD — POSITIV UND „UND SONST NICHTS" ══════════════════════

  1. Jeder Tabellenschluessel steht auf BEIDEN Probekarten genau einmal
     aktiv, mit dem Tabellenwert — gleich ob er in der Ausgangsdatei fehlte,
     auskommentiert war oder einen anderen Wert trug.
  2. Jeden Schluessel, den ein Weg darueber hinaus schreibt, fuehrt diese
     Datei unter WEG_EIGEN mit Grund. Einer, der dort fehlt, ist rot: entweder
     gehoert er in die Tabelle (dann bekommt ihn auch der andere Weg), oder
     er ist wirklich wegeigen (dann gehoert der Grund hierher).
  3. Schreiben BEIDE Wege denselben Schluessel ausserhalb der Tabelle, ist
     das rot — das ist genau der Zwilling, der in die Tabelle gehoert.
  4. Ein WEG_EIGEN-Eintrag, den der Weg gar nicht mehr schreibt, ist rot:
     eine Ausnahme ohne Gegenstand ist eine Falschauskunft.

WAS SIE NICHT SIEHT: den WLAN-Zweig des Bash-Wegs (`--wifi` fragt die
Passphrase verdeckt am Terminal und laeuft erst nach dem Paketbau) und
jeden Assistenten-Zweig ausser der Grundform (kein Agent, kein Handy-Weg —
die aendern nur Dateien NEBEN der dietpi.txt). Und natuerlich nicht, was
DietPi auf dem Geraet daraus macht.

DER BASH-WEG LAEUFT MIT `--nur-schluessel`: dieselbe Funktion wie im vollen
Lauf (karten_schluessel_setzen), nur ohne den zwanzig Sekunden langen
Paketbau. Den vollen Lauf deckt tools/karte-dietpi-schluessel.test.sh.

    python3 tools/kartenwege-schluessel-zwilling.py            Bericht
    python3 tools/kartenwege-schluessel-zwilling.py --pruefen  still bei Gruen

RUECKGABE: 0 gleich, 1 Befund, 2 Abbruch (ein Weg lief nicht / Tabelle kaputt).
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
CONTROLLER = WURZEL / "remote-step-installer" / "controller"
BASH_WEG = WURZEL / "scripts" / "make-boot-sd.sh"

# ── Was ein Weg MIT GRUND allein schreibt ───────────────────────────────────
#
# Der Bash-Weg setzt ausser der Tabelle nichts (WLAN nur mit --wifi, s. Kopf).
# Der Assistent leitet all das aus seinen Eingaben ab — der Bash-Weg fragt
# nichts davon, er ueberlaesst Netz, Name und Erstlauf dem Menschen (so steht
# es in seiner Schlussausgabe).
WEG_EIGEN = {
    "assistent": {
        "AUTO_SETUP_AUTOMATED": "der Assistent fragt Netz und Passwort ab und kann "
                                "den Erstlauf deshalb ohne Tastatur fahren; der "
                                "Bash-Weg nicht — dort endete AUTOMATED=1 ohne Netz "
                                "in 'first run setup failed'",
        "AUTO_SETUP_GLOBAL_PASSWORD": "Eingabe im Assistenten",
        "AUTO_SETUP_SSH_SERVER_INDEX": "der Assistent redet per SSH mit der Box",
        "AUTO_SETUP_NET_HOSTNAME": "Eingabe im Assistenten",
        "AUTO_SETUP_NET_WIFI_ENABLED": "Eingabe im Assistenten (Bash-Weg: nur mit --wifi)",
        "AUTO_SETUP_NET_ETHERNET_ENABLED": "Entweder-oder zum WLAN, Eingabe im Assistenten",
        "AUTO_SETUP_NET_WIFI_COUNTRY_CODE": "Eingabe im Assistenten (Bash-Weg: nur mit --wifi)",
        "AUTO_SETUP_LOCALE": "Eingabe im Assistenten",
        "AUTO_SETUP_KEYBOARD_LAYOUT": "Eingabe im Assistenten",
        "AUTO_SETUP_TIMEZONE": "Eingabe im Assistenten",
        "AUTO_SETUP_DESKTOP": "nacktes System, alles Weitere faehrt der Controller",
        "AUTO_SETUP_INSTALL_SOFTWARE_ID": "nacktes System, alles Weitere faehrt der Controller",
        "SURVEY_OPTED_IN": "keine Umfrage aus einer Box ohne Tastatur",
        "CONFIG_SERIAL_CONSOLE_ENABLE": "Fehlersuche am seriellen Anschluss",
    },
    "bash": {},
}

# Die Probe-dietpi.txt: fremde Schluessel, die stehen bleiben muessen, und
# jeder Tabellenschluessel in DREI Lagen — die, in denen DietPi ihn ausliefert.
FREMD = "CONFIG_CPU_GOVERNOR=ondemand\nAUTO_SETUP_BOOT_WAIT_FOR_NETWORK=1\n"


def probe_texte(tabelle: dict) -> dict:
    schluessel = list(tabelle)
    return {
        "fehlt": FREMD,
        "auskommentiert": FREMD + "".join(f"#{k}=probe-alt\n" for k in schluessel),
        "anderer-wert": FREMD + "".join(f"{k}=probe-alt\n" for k in schluessel),
    }


def aktive(text: str) -> dict:
    """SCHLUESSEL -> [Werte] der AKTIVEN Zeilen (mehrfach = Befund)."""
    werte: dict = {}
    for z in text.splitlines():
        m = re.match(r"^([A-Za-z0-9_]+)=(.*)$", z)
        if m:
            werte.setdefault(m.group(1), []).append(m.group(2))
    return werte


def geschrieben(vorher: str, nachher: str) -> dict:
    """Was ein Weg geschrieben hat: aktive Zeilen, die vorher nicht so dastanden."""
    alt = aktive(vorher)
    return {k: v for k, v in aktive(nachher).items() if alt.get(k) != v}


def assistent(karte: Path) -> None:
    sys.path.insert(0, str(CONTROLLER))
    import sdprep  # noqa: E402  (liegt neben core.py, wird nur hier gebraucht)
    sdprep.prepare_boot(str(karte), password="probe-passwort", hostname="Probebox")


def bash_weg(karte: Path) -> None:
    r = subprocess.run(["bash", str(BASH_WEG), str(karte), "--nur-schluessel"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"make-boot-sd.sh --nur-schluessel endete mit {r.returncode}: "
                           f"{(r.stderr or r.stdout).strip()[:300]}")


def main() -> int:
    still = "--pruefen" in sys.argv
    sys.path.insert(0, str(CONTROLLER))
    try:
        import sdprep
        tabelle = sdprep.kartenschluessel()
    except Exception as e:  # noqa: BLE001 — jede Form von „Tabelle nicht lesbar"
        print(f"ABBRUCH: die gemeinsame Tabelle laesst sich nicht lesen: {e}")
        return 2

    befunde: list = []
    zeilen: list = []
    geschrieben_je_weg: dict = {"assistent": set(), "bash": set()}
    werte_je_weg: dict = {"assistent": {}, "bash": {}}
    arbeit = Path(tempfile.mkdtemp(prefix="kartenwege-zwilling-"))
    try:
        for lage, text in probe_texte(tabelle).items():
            for weg, fahren in (("assistent", assistent), ("bash", bash_weg)):
                karte = arbeit / f"{weg}-{lage}"
                karte.mkdir()
                (karte / "dietpi.txt").write_text(text, encoding="utf-8")
                try:
                    fahren(karte)
                except Exception as e:  # noqa: BLE001
                    print(f"ABBRUCH: der Weg '{weg}' lief auf der Probekarte '{lage}' nicht: {e}")
                    return 2
                nachher = (karte / "dietpi.txt").read_text(encoding="utf-8")
                auf_karte = aktive(nachher)

                # 1. Tabelle: genau einmal aktiv, mit dem Tabellenwert.
                for k, v in tabelle.items():
                    ist = auf_karte.get(k, [])
                    if ist != [v]:
                        befunde.append(f"ABWEICHUNG {weg}/{lage}: {k} soll genau einmal "
                                       f"'{v}' sein, steht da als {ist or 'FEHLT'}")
                # Fremdes muss ueberleben.
                for z in FREMD.splitlines():
                    k, v = z.split("=", 1)
                    if auf_karte.get(k) != [v]:
                        befunde.append(f"ZERSTOERT {weg}/{lage}: fremder Schluessel {z} "
                                       f"steht nicht mehr unveraendert da")

                neu = geschrieben(text, nachher)
                geschrieben_je_weg[weg] |= set(neu)
                for k, v in neu.items():
                    werte_je_weg[weg][k] = v
    finally:
        shutil.rmtree(arbeit, ignore_errors=True)

    # 2./3. Was ausserhalb der Tabelle geschrieben wird.
    for weg, andere in (("assistent", "bash"), ("bash", "assistent")):
        for k in sorted(geschrieben_je_weg[weg] - set(tabelle)):
            if k in geschrieben_je_weg[andere]:
                if weg == "assistent":  # einmal melden, nicht je Richtung
                    befunde.append(
                        f"ZWILLING OHNE TABELLE: {k} schreiben BEIDE Wege "
                        f"(assistent {werte_je_weg['assistent'][k]}, bash "
                        f"{werte_je_weg['bash'][k]}) — der gehoert in "
                        f"mixpi-kartenschluessel.txt")
                continue
            if k not in WEG_EIGEN[weg]:
                befunde.append(
                    f"UNBEGRUENDET {weg}: schreibt {k}={werte_je_weg[weg][k]}, der andere "
                    f"Weg nicht — in die Tabelle damit, oder mit Grund in WEG_EIGEN")
            else:
                zeilen.append(f"  nur {weg:<9} {k:<34} {WEG_EIGEN[weg][k]}")

    # 4. Ausnahmen ohne Gegenstand.
    for weg, eigene in WEG_EIGEN.items():
        for k in sorted(set(eigene) - geschrieben_je_weg[weg]):
            befunde.append(f"VERALTET {weg}: WEG_EIGEN fuehrt {k}, der Weg schreibt ihn "
                           f"nicht mehr — Eintrag streichen")

    if not still:
        print("── Gemeinsame Tabelle (remote-step-installer/controller/mixpi-kartenschluessel.txt)")
        for k, v in tabelle.items():
            print(f"  beide     {k}={v}")
        print("── Wegeigen, mit Grund")
        print("\n".join(zeilen) if zeilen else "  (nichts)")
        print()

    if befunde:
        for b in befunde:
            print(f"  FAIL {b}")
        print(f"\n{len(befunde)} BEFUND(E) — die Karten-Wege laufen auseinander.")
        return 1
    if not still:
        print(f"Beide Karten-Wege schreiben dieselben {len(tabelle)} Tabellenschluessel "
              f"(je drei Ausgangslagen), und sonst nur Begruendetes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
