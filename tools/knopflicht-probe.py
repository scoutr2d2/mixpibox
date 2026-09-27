#!/usr/bin/env python3
"""
Das Licht im Einschaltknopf und die Haltedauer der Taste — nachgemessen.

WOFUER: die Kette vom Schalter in der Verwaltung bis zum PWM-Ausgang laeuft
ueber drei Sprachen und eine Datei in /tmp. Genau dort lagen bis 4.3.1 drei
Fehler, die man dem Verhalten nicht ansieht — die LED tat einfach nichts, und
die Haltedauer schaltete die Box beim Antippen aus. Wer daran etwas aendert,
laesst das hier laufen; es braucht KEINEN Pi (RPi.GPIO wird gestellt) und
fasst nichts an, was laeuft.

    python3 tools/knopflicht-probe.py

Geprueft werden die drei Stellen, an denen es schiefging:

  1. led_control.py   liest den Stand aus /tmp/.power_led. Der Vergleich ging
                      gegen Text, geschrieben wurde eine Zahl — das Dimmen gab
                      es nie. Hier laufen beide Schreibweisen durch.
  2. mupi_start_led.sh schreibt diesen Stand. Die Schleife las die
                      Konfiguration und warf sie weg; Helligkeit und der neue
                      Schalter kamen nie an.
  3. off_trigger.sh   zaehlt die Haltedauer mit `for ((i=0;i<N;i++))`. Eine
                      Bruchzahl aus dem alten PHP-Schieber liess die Schleife
                      abbrechen — und die Box fuhr beim Antippen herunter.

Rueckgabe 0 = alles gut, 1 = mindestens ein Befund.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import types

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START_LED = os.path.join(WURZEL, "scripts", "mupibox", "mupi_start_led.sh")
OFF_TRIGGER = os.path.join(WURZEL, "scripts", "OnOffShim", "off_trigger.sh")
LED_CONTROL_DIR = os.path.join(WURZEL, "scripts", "mupibox")

befunde = []
geprueft = 0


def pruef(name, ist, soll):
    global geprueft
    geprueft += 1
    if ist != soll:
        befunde.append(f"{name}: {ist!r} statt {soll!r}")
        print(f"  BEFUND  {name}: {ist!r} statt {soll!r}")
    else:
        print(f"  ok      {name}")


# ── 1. led_control.py ─────────────────────────────────────────────────────
# RPi.GPIO gibt es auf keinem Rechner ausser dem Pi. Gestellt, nicht
# nachgebaut: geprueft wird die Rechnung, nicht der Treiber.
def _gpio_stellen():
    gpio = types.ModuleType("RPi.GPIO")
    rpi = types.ModuleType("RPi")
    for n in ("BCM", "OUT", "HIGH"):
        setattr(gpio, n, n)
    gpio.setmode = gpio.setup = gpio.output = lambda *a, **k: None
    gpio.PWM = lambda *a, **k: None
    rpi.GPIO = gpio
    sys.modules["RPi"] = rpi
    sys.modules["RPi.GPIO"] = gpio


def teil_led_control():
    print("\n1. led_control.py — was leuchten soll")
    _gpio_stellen()
    sys.path.insert(0, LED_CONTROL_DIR)
    import led_control as L

    # Der Schalter. Fehlt er (Box aelter als 4.3.1), ist das Licht AN — ein
    # fehlender Schluessel darf nicht wie ein Defekt aussehen.
    pruef("Schalter fehlt => Licht an", L.ist_an({}), True)
    pruef("Schalter false => aus", L.ist_an({"led_enabled": False}), False)
    pruef("Schalter 0 => aus", L.ist_an({"led_enabled": 0}), False)
    pruef('Schalter "0" (Text) => aus', L.ist_an({"led_enabled": "0"}), False)
    pruef('Schalter "false" (Text) => aus', L.ist_an({"led_enabled": "false"}), False)
    pruef("kein Stand (skip) => an", L.ist_an("skip"), True)

    # DER FEHLER VON 4.3.0: geschrieben wurde `jq '.led_dim_mode = 1'` (Zahl),
    # verglichen wurde gegen "1" (Text). Beide Schreibweisen muessen wirken.
    als_zahl = {"led_max_brightness": 80, "led_min_brightness": 7, "led_dim_mode": 1}
    als_text = {"led_max_brightness": "80", "led_min_brightness": "7", "led_dim_mode": "1"}
    pruef("gedimmt, Zahl geschrieben", L.soll_helligkeit(als_zahl), 7)
    pruef("gedimmt, Text geschrieben", L.soll_helligkeit(als_text), 7)
    pruef("hell, Zahl geschrieben", L.soll_helligkeit({**als_zahl, "led_dim_mode": 0}), 80)
    pruef("hell, Text geschrieben", L.soll_helligkeit({**als_text, "led_dim_mode": "0"}), 80)

    # Der Schalter schlaegt beide Helligkeiten — sonst waere "aus" nur ein
    # dunkleres Leuchten.
    pruef("aus schlaegt hell", L.soll_helligkeit({**als_zahl, "led_dim_mode": 0, "led_enabled": False}), 0)
    pruef("aus schlaegt gedimmt", L.soll_helligkeit({**als_zahl, "led_enabled": False}), 0)

    # ChangeDutyCycle wirft ausserhalb 0..100.
    pruef("250 % wird begrenzt", L.soll_helligkeit({"led_max_brightness": 250}), 100)
    pruef("-5 % wird begrenzt", L.soll_helligkeit({"led_max_brightness": -5}), 0)
    pruef("Unsinn => Ersatzwert", L.soll_helligkeit({"led_max_brightness": "abc"}), 100)

    # Geblendet wird von dem, was WIRKLICH anliegt.
    L.AKTUELL = 0
    L.blenden(30, 0)
    pruef("blenden merkt sich 30", L.AKTUELL, 30)
    L.blenden(5, 0)
    pruef("blenden weiter auf 5", L.AKTUELL, 5)

    # ── Welcher Browser der Kiosk ist (E68) ──────────────────────────────────
    #
    # DIE ZEILEN SIND ECHT, am 20.08.2026 auf der Box aus `ps -ef` genommen.
    # Der Fehler dahinter: `grep chromium` fand Cog nie, die Startschleife ging
    # nie aus, der Knopf pulste endlos — und `main()` wurde nie erreicht, also
    # fiel auch das Dimmen aus. Denselben Fehler gab es am 07.08. schon einmal
    # (`chromium-browser` gegen `chromium`); deshalb stehen hier ALLE drei
    # Namen und nicht nur der, den diese Box gerade faehrt.
    cog = "dietpi      1213     920  5 16:16 ?        00:00:12 /usr/bin/cog -O renderer=gles --platform=drm http://localhost:8200/neu/"
    chromium = "dietpi      1300     920  9 16:16 ?        00:00:31 /usr/bin/chromium --kiosk http://localhost:8200/neu/"
    alt = "dietpi      1301     920  9 16:16 ?        00:00:31 /usr/lib/chromium-browser/chromium-browser --kiosk http://localhost:8200/"
    pruef("Cog gilt als Kiosk", L.ist_kioskzeile(cog), True)
    pruef("Chromium gilt als Kiosk", L.ist_kioskzeile(chromium), True)
    pruef("chromium-browser (alter Name) gilt", L.ist_kioskzeile(alt), True)

    # Die Hilfsprozesse duerfen NICHT zaehlen: sie stehen schon da, bevor ein
    # Bild zu sehen ist. Sie tragen keine Adresse in der Befehlszeile.
    helfer = "dietpi      1345    1300  0 16:16 ?        00:00:00 /usr/bin/chromium --type=renderer --lang=de"
    pruef("Renderer zaehlt nicht", L.ist_kioskzeile(helfer), False)

    # Und der Suchbefehl selbst nicht — frueher brauchte es dafuer `grep -v
    # grep`, und beim Suchen nach genau diesem Fehler tippt man ihn staendig.
    suche = "achim      5010    5009  0 16:20 ?        00:00:00 grep cog http://localhost:8200"
    pruef("die eigene Suche zaehlt nicht", L.ist_kioskzeile(suche), False)

    # Namen, die den Browsernamen nur ENTHALTEN, duerfen nicht mitzaehlen.
    for fremd, was in (
        ("root  700  1  0 16:16 ?  00:00:00 /usr/lib/cogl/cogl-helper http://x", "cogl"),
        ("root  701  1  0 16:16 ?  00:00:00 /usr/bin/recognition --url http://x", "recognition"),
    ):
        pruef("%s zaehlt nicht" % was, L.ist_kioskzeile(fremd), False)


# ── 2. mupi_start_led.sh ──────────────────────────────────────────────────
def _funktionen_aus(pfad, namen):
    """Die Funktionen AUS DER ECHTEN DATEI holen — nicht nachbauen. Sonst
    prueft das hier eine Kopie und die Datei driftet weg."""
    text = open(pfad, encoding="utf-8").read()
    heraus = []
    for name in namen:
        anfang = text.index(f"{name}() {{")
        ende = text.index("\n}\n", anfang) + 3
        heraus.append(text[anfang:ende])
    return "\n".join(heraus)


def _bash(skript):
    e = subprocess.run(["bash", "-c", skript], capture_output=True, text=True)
    return (e.stdout or "").strip(), e.returncode


def teil_start_led():
    print("\n2. mupi_start_led.sh — was in /tmp/.power_led landet")
    fn = _funktionen_aus(START_LED, ["led_zahl", "led_an", "led_datei_schreiben"])

    def mit_konfig(konfig, ausdruck):
        with tempfile.TemporaryDirectory() as d:
            kpfad = os.path.join(d, "mupiboxconfig.json")
            with open(kpfad, "w", encoding="utf-8") as f:
                json.dump(konfig, f)
            skript = (
                f'MUPIBOX_CONFIG="{kpfad}"\n'
                f'TMP_LEDFILE="{os.path.join(d, ".power_led")}"\n'
                f"{fn}\n{ausdruck}"
            )
            return _bash(skript)

    voll = {"shim": {"ledPin": "13", "ledEnabled": True, "ledBrightnessMax": "70", "ledBrightnessMin": "5"}}
    alt = {"shim": {"ledPin": "13", "ledBrightnessMax": "70", "ledBrightnessMin": "5"}}
    aus = {"shim": {"ledPin": "13", "ledEnabled": False, "ledBrightnessMax": "70", "ledBrightnessMin": "5"}}

    pruef("Helligkeit gelesen", mit_konfig(voll, "led_zahl '.shim.ledBrightnessMax' 100")[0], "70")
    pruef("fehlender Schluessel => Ersatz", mit_konfig(voll, "led_zahl '.shim.gibtsnicht' 42")[0], "42")
    pruef("Unsinn => Ersatz", mit_konfig({"shim": {"ledBrightnessMax": "viel"}}, "led_zahl '.shim.ledBrightnessMax' 100")[0], "100")
    pruef("Schalter an", mit_konfig(voll, "led_an")[0], "1")
    pruef("Schalter aus", mit_konfig(aus, "led_an")[0], "0")
    pruef("Box ohne den Schluessel => an", mit_konfig(alt, "led_an")[0], "1")

    # Die geschriebene Datei muss der Stand sein, den led_control.py erwartet.
    roh, _ = mit_konfig(voll, 'led_datei_schreiben 13 70 5 0 1 && cat "${TMP_LEDFILE}"')
    try:
        stand = json.loads(roh)
    except ValueError:
        stand = {}
    pruef("geschrieben: led_enabled", stand.get("led_enabled"), 0)
    pruef("geschrieben: led_dim_mode", stand.get("led_dim_mode"), 1)
    pruef("geschrieben: Helligkeit hell", stand.get("led_max_brightness"), 70)
    pruef("geschrieben: Helligkeit gedimmt", stand.get("led_min_brightness"), 5)
    pruef("geschrieben: GPIO", stand.get("led_gpio"), 13)

    # Und led_control.py muss aus genau diesem Stand 0 machen.
    import led_control as L
    pruef("Kette: geschriebener Stand => LED aus", L.soll_helligkeit(stand), 0)


# ── 3. off_trigger.sh ─────────────────────────────────────────────────────
def _presslogik():
    """Den Block AUS DER ECHTEN DATEI holen: vom `case` bis unmittelbar vor
    die Zeile, die das Ergebnis ins Protokoll schreibt.

    HIER STAND `text.index("\\nfi\\n", anfang)` — das erste `fi` nach dem
    `case`, also das der OBERGRENZE. Seit dem 07.08.2026 folgt darauf eine
    zweite Klemmung (die UNTERGRENZE von 2 Sekunden), und die waere damit
    stillschweigend aus der Messung gefallen: dieses Werkzeug haette weiter
    „0 bleibt 0" bestaetigt, waehrend die Datei daneben 2 daraus macht. Ein
    Werkzeug, das einen Ausschnitt misst und ueber das Ganze redet, ist die
    leiseste Art, gruen zu sein.
    """
    text = open(OFF_TRIGGER, encoding="utf-8").read()
    anfang = text.index('case "${PRESS_DELAY}" in')
    ende = text.index('echo "$(date) - INFO:  Press delay set to', anfang)
    return text[anfang:ende]


def teil_haltedauer():
    print("\n3. off_trigger.sh — die Haltedauer der Taste")
    block = _presslogik()

    def normal(wert):
        skript = (
            f'LOGFILE=/dev/null\nPRESS_DELAY="{wert}"\n{block}\n'
            # Der Beweis, dass die Zaehlschleife damit laeuft: bei einer
            # Bruchzahl brach genau sie ab — und die Box fuhr beim Antippen
            # herunter, weil button_held schon true war.
            "n=0\nfor ((i=0;i<PRESS_DELAY;i++)); do n=$((n+1)); done\n"
            'echo "${PRESS_DELAY}:${n}"'
        )
        return _bash(skript)[0]

    # links = normalisierte Haltedauer, rechts = Durchlaeufe der Zaehlschleife
    faelle = [
        ("3", "3:3", "ganze Sekunden bleiben"),
        ("2.25", "3:3", "Bruchzahl aus dem alten PHP-Schieber (der Fehler)"),
        ("0.25", "2:2", "kleine Bruchzahl wird aufgerundet, dann angehoben"),
        ("", "3:3", "leer => Ersatzwert"),
        ("null", "3:3", "fehlender Schluessel => Ersatzwert"),
        ("abc", "3:3", "Unsinn => Ersatzwert"),
        ("-2", "3:3", "negativ => Ersatzwert"),
        # ── DIE ZWEI, UM DERETWILLEN ES DIE UNTERGRENZE GIBT ──────────────
        # Hier stand `("0", "0:0", "0 bleibt 0 (sofort)")`, und das war der
        # gemessene Zustand einer SACKGASSE: bei 0 zaehlt die Halteschleife
        # null Durchlaeufe, `button_held` bleibt stehen, und die Box faehrt
        # beim kuerzesten Antippen herunter — am Geraet kommt danach niemand
        # mehr in das Menue, mit dem sich das zurueckstellen liesse.
        # 1 ist die zweite: eine Sekunde erreicht auch, wer die Box nur
        # hochhebt.
        ("0", "2:2", "0 waere die Sackgasse: Box geht beim Antippen aus"),
        ("1", "2:2", "1 Sekunde erreicht auch ein Versehen"),
        ("2", "2:2", "die Untergrenze selbst"),
        ("5", "5:5", "die Obergrenze selbst"),
        ("10", "5:5", "ueber der Obergrenze: HAT schaltet ab 6 s hart ab"),
        ("20", "5:5", "der alte Hoechstwert des Feldes"),
    ]
    for wert, erwartet, warum in faelle:
        pruef(f'"{wert}" ({warum})', normal(wert), erwartet)


def teil_browsernamen():
    """Kennen ALLE Stellen dieselben Browsernamen? (E68)

    DAS IST DIE EIGENTLICHE FEHLERKLASSE. Am 20.08.2026 wussten drei Stellen
    nicht, dass der Kiosk-Browser seit E56 waehlbar ist — die LED-Steuerung,
    die WLED-Warteschleife und die Zurueck-zur-Startseite-Funktion. Jede fuer
    sich sah richtig aus; falsch war, dass sie AUSEINANDERLIEFEN.

    Geprueft wird deshalb nicht, ob eine Stelle stimmt, sondern ob alle
    DASSELBE sagen. Wer einen vierten Browser einfuehrt und eine Stelle
    vergisst, faellt hier auf — und nicht erst, wenn ein Knopf endlos blinkt.
    """
    print("\n4. Kennen alle Stellen dieselben Browsernamen? (E68)")
    NAMEN = re.compile(r"chromium\[a-z-\]\*\|cog")
    stellen = {
        "led_control.py": os.path.join(LED_CONTROL_DIR, "led_control.py"),
        "mupi_start_led.sh": START_LED,
        "mupi-kiosk-heim.sh": os.path.join(LED_CONTROL_DIR, "mupi-kiosk-heim.sh"),
    }
    for name, pfad in stellen.items():
        if not os.path.exists(pfad):
            pruef(f"{name} gefunden", False, True)
            continue
        text = open(pfad, encoding="utf-8").read()
        # NUR ausserhalb von Kommentaren zaehlt — sonst genuegte es, den Namen
        # in einer Erklaerzeile zu erwaehnen, und der Test waere ein Alibi.
        code = "\n".join(
            z for z in text.splitlines() if not z.lstrip().startswith(("#", "*"))
        )
        pruef(f"{name} kennt chromium UND cog", bool(NAMEN.search(code)), True)


def main():
    print("Knopflicht und Haltedauer — nachgemessen")
    print(f"Baum: {WURZEL}")
    teil_led_control()
    teil_start_led()
    teil_browsernamen()
    # EIN ABSTURZ IST KEIN BEFUND, SONDERN DAS ENDE JEDER MELDUNG. Am
    # 20.08.2026 brach dieser Teil mit ValueError ab, weil off_trigger.sh
    # umgeschrieben wurde und die gesuchte `case`-Zeile nicht mehr enthaelt —
    # seither lief die ganze Probe nie wieder bis zur Zusammenfassung durch,
    # und die zwei Teile davor meldeten ins Leere. Ein Werkzeug, das man nicht
    # zu Ende laufen sehen kann, wird nicht benutzt.
    try:
        teil_haltedauer()
    except Exception as e:
        print("\n3. off_trigger.sh — die Haltedauer der Taste")
        pruef(f"Probe lesbar ({type(e).__name__}: {e})", False, True)
    print()
    if befunde:
        print(f"{len(befunde)} BEFUND(E) von {geprueft} Pruefungen:")
        for b in befunde:
            print(f"  - {b}")
        return 1
    print(f"{geprueft} Pruefungen, kein Befund.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
