#!/usr/bin/env python3
"""Liefern die Ausrollwege ein librespot, das ueberhaupt Ton macht?

WOZU: Bis zum 04.08.2026 lautete die Antwort NEIN — und zwar in beiden Wegen.
`autosetup.sh` und `update/start_mupibox_update.sh` holten beide
`dev_0.6_20250806`. Diese Fassung fragt einen ueberholten Metadaten-Endpunkt
ab, der keine Tondatei mehr mitliefert; jeder Titel meldet "not available".
A/B belegt am 2026-07-28 (gleiche Anmeldung, gleiches Album,
scripts/librespot/README.md): 0.6.0-dev stumm, 0.8.0 spielt.

DIE SCHLIMMERE RICHTUNG war dabei der UPDATE-Weg: auf beiden laufenden Boxen
liegt 0.8.0 (hingebracht vom remote-step-installer). Ein Update haette es
ueberschrieben — eine Box, die vorher spielte, waere danach still gewesen. Das
ist der Kern des Zwei-Repos-Deltas (BACKLOG E12/X1, frueher P6).

DIE ZWEITE HAELFTE: der Waechter. `librespot-waechter.service` und `.timer`
liegen seit langem in `config/services/`, das zugehoerige Skript in
`scripts/librespot/` — aber KEIN Ausrollweg hat je eines davon angefasst. Eine
Unit ohne ihr Skript ist schlimmer als keine: sie sieht eingerichtet aus. Was
sie faengt, faellt sonst niemandem auf — librespots Sitzung kann sterben,
waehrend der Prozess weiterlaeuft; die Box verschwindet aus Spotifys
Geraeteliste, systemd meldet einen gesunden Dienst.

WAS ES PRUEFT (alles am Quelltext, ohne Box)
  1. Beide Ausrollwege bevorzugen ein Binaer >= 0.8.0 aus dem Paket.
  2. Das Binaer, auf das sie zeigen, liegt wirklich im Repo.
  3. Beide rollen librespot-waechter.service UND .timer aus.
  4. Beide bringen librespot-waechter.sh nach /usr/local/bin/mupibox — sonst
     zeigt die Unit ins Leere.
  5. Der Timer wird eingeschaltet, und zwar NICHT ueber die Dienstschleife:
     die haengt ".service" an, ein Timer darin wuerde still nie gefunden.
  6. UND ALLES, WAS DER WAECHTER SELBST AUFRUFT. Nachgetragen am 04.08.2026
     beim Gegenlesen: der Waechter ruft in seinem Hauptzweig
     /usr/local/bin/mupibox/librespot-konto.py auf, und kein Weg brachte diese
     Datei dorthin. Fehlt sie, faellt der Waechter durch bis
     `systemctl restart librespot` — die falsche Antwort auf genau den Fall,
     der am 02.08.2026 gemessen wurde (fremdes Konto uebernommen): jeder
     Neustart meldet sich wieder dort an, alle fuenf Minuten von vorn.
     Die Liste wird deshalb NICHT hier gepflegt, sondern aus dem Waechter
     selbst gelesen — sonst faellt der naechste Aufruf wieder durch.

WAS ES NICHT KANN: sagen, welche Fassung auf DER Box liegt. Gegenprobe:

    ssh <box> "librespot -V; systemctl is-active librespot-waechter.timer"

AUFRUF
    python3 tools/librespot-ausrollweg-abgleich.py
    python3 tools/librespot-ausrollweg-abgleich.py --pruefen
"""

import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEGE = {
    "autosetup/autosetup.sh": os.path.join(WURZEL, "autosetup/autosetup.sh"),
    "update/start_mupibox_update.sh": os.path.join(WURZEL, "update/start_mupibox_update.sh"),
}
# Alles unterhalb davon ist die stumme Sorte. Die Zahl steht im README des
# Skriptverzeichnisses und ist dort mit einer Messung begruendet.
MINDESTFASSUNG = "0.8.0"


def lies(pfad: str) -> str:
    try:
        return open(pfad, encoding="utf-8").read()
    except OSError:
        return ""


def paketbinaer(text: str) -> str:
    """
    Auf welches mitgelieferte librespot zeigt der Weg?

    AUSKOMMENTIERTES ZAEHLT NICHT — und das ist hier keine Feinheit: in
    start_mupibox_update.sh standen jahrelang abgeschaltete `#mv
    ${MUPI_SRC}/bin/librespot/dev_0.6_20250305/...`-Zeilen direkt neben den
    wirksamen. Wer sie mitliest, bekommt ein gruenes Ergebnis fuer eine Zeile,
    die nie ausgefuehrt wird.
    """
    ohne_kommentar = "\n".join(
        z for z in text.splitlines() if not z.lstrip().startswith("#")
    )
    t = re.search(r"\$\{MUPI_SRC\}/(bin/librespot/[^\"'\s]+)", ohne_kommentar)
    return t.group(1) if t else ""


def waechter_braucht() -> list:
    """
    Welche Dateien aus scripts/librespot/ ruft der Waechter zur Laufzeit auf?

    NICHT FEST VERDRAHTET, sondern am Skript abgelesen. Der Grund steht oben:
    die Luecke entstand, weil jemand "nur diese eine Datei" ausrollte und die
    zweite uebersah. Eine Liste in DIESER Datei haette denselben Fehler noch
    einmal erlaubt — der Waechter selbst kann nicht luegen.
    """
    text = lies(os.path.join(WURZEL, "scripts/librespot/librespot-waechter.sh"))
    ohne_kommentar = "\n".join(
        z for z in text.splitlines() if not z.lstrip().startswith("#")
    )
    gerufen = set(re.findall(r"/usr/local/bin/mupibox/([\w.-]+)", ohne_kommentar))
    # Nur was auch WIRKLICH in scripts/librespot/ liegt — Skripte aus anderen
    # Verzeichnissen rollt die jeweils eigene Zeile aus.
    return sorted(
        d for d in gerufen
        if os.path.exists(os.path.join(WURZEL, "scripts/librespot", d))
    )


def main() -> int:
    still = "--pruefen" in sys.argv
    noetig = waechter_braucht()
    befunde = []
    zeilen = []

    for name, pfad in WEGE.items():
        text = lies(pfad)
        if not text:
            befunde.append(f"{name} nicht lesbar.")
            continue

        binaer = paketbinaer(text)
        if not binaer:
            befunde.append(
                f"{name}: holt librespot NUR ueber wget. Im Paket liegt "
                f"bin/librespot/{MINDESTFASSUNG}/ — der Weg benutzt es nicht."
            )
        elif MINDESTFASSUNG not in binaer:
            befunde.append(
                f"{name}: zeigt auf {binaer} — das ist nicht {MINDESTFASSUNG} "
                "oder neuer. Diese Fassung spielt keinen Ton."
            )
        elif not os.path.exists(os.path.join(WURZEL, binaer)):
            befunde.append(
                f"{name}: zeigt auf {binaer}, aber diese Datei liegt nicht im "
                "Repo. Der Weg faellt still auf die stumme Fassung zurueck."
            )

        fehlt = []
        if "config/services/librespot-waechter.service" not in text:
            fehlt.append("Unit")
        if "config/services/librespot-waechter.timer" not in text:
            fehlt.append("Timer")
        if "scripts/librespot/librespot-waechter.sh" not in text:
            fehlt.append("Skript")
        if not re.search(r"systemctl enable librespot-waechter\.timer", text):
            fehlt.append("Einschalten des Timers")
        for datei in noetig:
            if f"scripts/librespot/{datei}" not in text:
                fehlt.append(f"{datei} (der Waechter ruft es auf)")
        if fehlt:
            befunde.append(f"{name}: Waechter unvollstaendig — es fehlt: {', '.join(fehlt)}.")

        zeilen.append((name, binaer or "(nur wget)", "vollstaendig" if not fehlt else "LUECKE"))

    if still:
        for b in befunde:
            print(f"  {b}")
        return 1 if befunde else 0

    print(f"{'Ausrollweg':34s} {'librespot aus dem Paket':34s} Waechter")
    for name, binaer, waechter in zeilen:
        print(f"{name:34s} {binaer:34s} {waechter}")
    print()
    if befunde:
        print("BEFUNDE:")
        for b in befunde:
            print(f"  * {b}")
    else:
        print(f"Beide Wege liefern librespot >= {MINDESTFASSUNG} und den Waechter.")
        print("Offen bleibt 32 Bit: dafuer gibt es hier kein taugliches Binaer.")
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
