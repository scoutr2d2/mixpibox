#!/usr/bin/python3
"""\
This script controls the power led.

DEUTSCH, weil hier drei Fehler lagen, die man dem Verhalten nicht ansieht:

Das Licht im Einschaltknopf (MuPiHAT J15, laut Datenblatt seit Platinenstand
2.2 auf GPIO13 mit PWM). Dieses Skript besitzt den PWM-Ausgang und laeuft
durch; WAS es leuchten soll, steht in /tmp/.power_led, geschrieben von
mupi_start_led.sh. Die Datei kennt fuenf Angaben:

    led_gpio                der Pin
    led_max_brightness      Helligkeit, solange der Bildschirm an ist (%)
    led_min_brightness      Helligkeit, sobald er ausgeht (%)
    led_dim_mode            0 = hell, 1 = gedimmt
    led_enabled             1/true = Licht an, 0/false = Knopf bleibt dunkel

── WAS BIS 4.3.1 NICHT FUNKTIONIERTE ─────────────────────────────────────────

1. DER VERGLEICH GING NIE AUF. Hier stand `JSON_DATA["led_dim_mode"] == "0"`,
   also gegen eine ZEICHENKETTE — geschrieben wurde der Wert aber mit
   `jq '.led_dim_mode = 0'`, also als ZAHL. `0 == "0"` ist in Python falsch.
   Das Dimmen beim Bildschirm-Aus hat es damit nie gegeben; die Schleife lief
   jede Sekunde und tat nichts. (Die C-Fassung daneben, scripts/led/
   led_control.c, liest mit `json_object_get_int` und war davon nicht
   betroffen — deshalb faellt es beim Nebeneinanderhalten der beiden nicht auf.)

2. HELLIGKEITSAENDERUNGEN KAMEN NICHT AN. Reagiert wurde ausschliesslich auf
   den WECHSEL von `led_dim_mode`. Wer in der Verwaltung die Helligkeit
   verstellte, sah bis zum naechsten Neustart nichts.

3. `main()` LAS SEINE ERSTE ZEILE INS LEERE. `LED_DIM_MODE_LAST =
   JSON_DATA["led_dim_mode"]` stand direkt hinter einem `read_json()`, das
   auch "skip" liefern kann (Datei gerade halb geschrieben) — dann lief ein
   Index-Zugriff auf eine Zeichenkette und der Dienst war sofort tot.

Statt auf den Wechsel einzelner Felder zu horchen, wird jetzt aus dem GANZEN
Stand ein SOLLWERT gerechnet und nur bei Abweichung geblendet. Das erledigt
alle drei Faelle auf einmal — und macht den neuen Schalter zu nichts weiter
als einem Sollwert von 0.
"""

__author__ = "Olaf Splitt"
__license__ = "GPLv3"
__version__ = "1.1.0"
__email__ = "splitti@mupibox.de"
__status__ = "dev"


import os
import re
import signal
import sys
import json
from time import sleep
import RPi.GPIO as GPIO

DEFAULT_PWM_FREQUENCY = 3000
JSON_DATA_FILE = "/tmp/.power_led"

POWER_LED = None
# Was gerade wirklich am Pin anliegt — der Ausgangspunkt jeder Blende. Vorher
# wurde von einem ANGENOMMENEN Wert aus geblendet (immer von max oder min);
# nach einer Helligkeitsaenderung gab das einen sichtbaren Sprung.
AKTUELL = 0


def read_json():
    try:
        with open(JSON_DATA_FILE) as file:
            rc = file.read()   # read first time
        rc = json.loads(rc)
    except:
        rc = "skip"
    return rc


def zahl(daten, schluessel, ersatz):
    """Eine Zahl aus dem Stand holen — gleichgueltig, ob sie als Zahl oder als
    Text dasteht. Genau dieser Unterschied war Fehler 1; er darf hier nicht
    noch einmal jemanden einen Nachmittag kosten."""
    try:
        return int(str(daten.get(schluessel, ersatz)).strip())
    except (TypeError, ValueError, AttributeError):
        return ersatz


def ist_an(daten):
    """Das Licht ist an, solange nicht ausdruecklich etwas anderes dasteht.

    Auf einer Box, deren Konfiguration aelter ist als der Schalter, FEHLT der
    Schluessel — und ein fehlender Schluessel darf die LED nicht ausknipsen.
    Das saehe nach einem Defekt aus, und gesucht wuerde am Kabel. Erkannt wird
    sowohl `false` (die Vorlage schreibt einen echten Boolean) als auch
    "0"/"false", falls der Wert je als Text in der Datei landet."""
    try:
        wert = daten.get("led_enabled", True)
    except AttributeError:
        return True
    if isinstance(wert, bool):
        return wert
    return str(wert).strip().lower() not in ("0", "false", "off", "no", "")


def soll_helligkeit(daten):
    """Was leuchten soll — aus dem ganzen Stand, nicht aus einem Feld."""
    if not ist_an(daten):
        return 0
    if zahl(daten, "led_dim_mode", 0) == 1:
        roh = zahl(daten, "led_min_brightness", 10)
    else:
        roh = zahl(daten, "led_max_brightness", 100)
    # Begrenzen, nicht vertrauen: ChangeDutyCycle wirft ausserhalb 0..100.
    return max(0, min(100, roh))


def led_control(start, end, sleep_time):
    global AKTUELL
    if start < end:
        cnt = +1
    else:
        cnt = -1
    for x in range(start, end, cnt):
        try:
            POWER_LED.ChangeDutyCycle(x)
        except:
            pass
        sleep(sleep_time)
    try:
        POWER_LED.ChangeDutyCycle(end)
    except:
        pass
    AKTUELL = end
    print("LED Brightness = " + str(end) + "%")


def blenden(ziel, sleep_time=0.02):
    """Von dem, was anliegt, auf den Sollwert."""
    if ziel != AKTUELL:
        led_control(AKTUELL, ziel, sleep_time)


def sigterm_handler(*_):
    # Das Abschiedsblinken beim Herunterfahren. Wer das Licht ausgeschaltet
    # hat, will es dabei nicht sehen — aus heisst aus.
    daten = read_json()
    if daten != "skip" and not ist_an(daten):
        led_control(AKTUELL, 0, 0.003)
        sys.exit(0)
    hell = zahl(daten, "led_max_brightness", 100) if daten != "skip" else 100
    led_control(AKTUELL, 0, 0.003)
    for x in range(0, 3, +1):
        led_control(0, hell, 0.003)
        led_control(hell, 0, 0.003)
    sys.exit(0)


# Die Namen, unter denen ein Kiosk-Browser im Prozessbaum steht — als Datei am
# Ende eines Pfades, nicht irgendwo im Text. `(?:^|/)` und `(?:\s|$)` klammern
# den Namen ein, damit `cog` nicht auch in `cogl` oder `recognition` trifft.
# `chromium[a-z-]*` deckt `chromium` UND `chromium-browser` ab; welcher der
# beiden Namen gilt, ist von der Distribution abhaengig.
KIOSK_MUSTER = re.compile(r"(?:^|/)(?:chromium[a-z-]*|cog)(?:\s|$)")


def ist_kioskzeile(zeile):
    """Ist das die `ps`-Zeile des Kiosk-Browsers?

    ZWEI BEDINGUNGEN, und beide werden gebraucht:

      * ein Browsername als Datei — sonst zaehlt jede Zeile mit, in der das
        Wort zufaellig vorkommt (auch die eigene `ps`-Rohrleitung, weswegen
        frueher ein `grep -v grep` noetig war);
      * eine ANGESURFTE ADRESSE — sie trennt das Kiosk-Fenster von den
        Hilfsprozessen (Renderer, GPU), die keine Adresse in der Befehlszeile
        tragen. Ohne das haette schon der erste Hilfsprozess das Pulsieren
        beendet, bevor etwas zu sehen ist.

    Geprueft wird auf `http://`/`https://` und nicht bloss auf `http`: sonst
    genuegte schon das Wort in einem beliebigen Befehl, und beim Suchen nach
    genau diesem Fehler tippt man es staendig.
    """
    if "http://" not in zeile and "https://" not in zeile:
        return False
    return bool(KIOSK_MUSTER.search(zeile))


def browser_laeuft():
    """Steht der Kiosk schon? Leerer Text heisst „noch nicht".

    ══ WARUM NICHT MEHR `chromium-browser` ═══════════════════════════════════

    HIER STAND `grep chromium-browser`. Auf dieser Box heisst der Browser
    `chromium` — `chromium-browser` war der Name unter Raspbian, DietPi liefert
    ihn ohne Zusatz. Am Geraet gemessen (07.08.2026):

        ps -ef | grep chromium-browser | grep http   ->  0 Treffer
        ps -ef | grep chromium         | grep http   ->  3 Treffer
        ps -ef | grep -o /usr/bin/chromium[a-z-]*    ->  /usr/bin/chromium

    FOLGE: Die Bedingung `while tmp == ""` ging NIE aus. Die Schleife hielt den
    Kiosk fuer ewig startend und pulste weiter — genau das, was der Betreiber
    heute gemeldet hat („sie blinkt jetzt"). Das Pulsieren war nicht kaputt,
    es hoerte nur nie auf.

    UND ES FIEL ERST JETZT AUF, weil `mupi_powerled.service` auf dieser Box
    `disabled` war: solange gar nichts lief, konnte auch nichts endlos pulsen.

    `chromium` TRIFFT BEIDE NAMEN — `chromium-browser` enthaelt ihn. Eine Box,
    die noch den alten Namen fuehrt, wird also weiterhin erkannt; das ist der
    Grund, warum hier nicht auf eine Liste von Namen geprueft wird.

    `grep http` BLEIBT: es trennt das Kiosk-Fenster von den Hilfsprozessen
    (Renderer, GPU), die keine Adresse in der Befehlszeile tragen. Ohne das
    haette schon der erste Hilfsprozess das Pulsieren beendet, bevor etwas
    zu sehen ist.

    ══ UND DASSELBE EIN ZWEITES MAL — COG (20.08.2026) ═══════════════════════

    Seit E56 ist der Kiosk-Browser WAEHLBAR (`mupibox.kioskBrowser`), und diese
    Box faehrt Cog. `grep chromium` trifft ihn nie. Am Geraet gemessen, als der
    Betreiber „der button blinkt immer" meldete:

        ps -ef | grep chromium | grep http   ->  0 Treffer
        ps -ef | grep cog      | grep http   ->  1 Treffer

    Die Schleife in `init()` ging also wieder nie aus — und weil sie nie
    ausgeht, wird auch `main()` nie erreicht: das Dimmen bei ausgeschaltetem
    Schirm fiel damit ebenfalls aus. Ein haengender Anlauf sieht aus wie ein
    Schoenheitsfehler und ist ein funktionaler.

    WARUM NICHT DEN KONFIGURATIONSWERT LESEN, so naheliegend das waere:
    `chromium-autostart.sh` hat einen RUECKFALL — kommt Cog nicht hoch, startet
    Chromium. Dann staende in der Konfiguration `cog`, waehrend Chromium
    laeuft, und die Pruefung waere aufs Neue blind. Erkannt werden muessen
    BEIDE, nicht der eingestellte.

    WARUM DIE ENTSCHEIDUNG JETZT IN EINER EIGENEN FUNKTION STECKT: Solange sie
    in einer Rohrleitung an `ps` hing, liess sie sich nur AUF EINER BOX MIT
    LAUFENDEM KIOSK pruefen — also genau dort nicht, wo man sie braucht.
    `ist_kioskzeile` ist rein und wird von tools/knopflicht-probe.py gegen
    echte `ps`-Zeilen beider Browser gefahren.
    """
    for zeile in os.popen("ps -ef").read().splitlines():
        if ist_kioskzeile(zeile):
            return zeile
    return ""


def init(daten):
    GPIO.setup(daten["led_gpio"], GPIO.OUT)
    GPIO.output(daten["led_gpio"], GPIO.HIGH)
    # Das Pulsieren, solange der Browser noch startet: „ich arbeite". Bei
    # ausgeschaltetem Licht wird nur gewartet, nicht gepulst — und der
    # Schalter wird waehrend des Wartens weiter gelesen, weil das Warten auf
    # einer langsamen Box eine Weile dauert.
    hell = zahl(daten, "led_max_brightness", 100)
    an = ist_an(daten)
    tmp = browser_laeuft()
    while tmp == "":
        if an:
            for x in range(0, 10, +1):
                led_control(0, hell, 0.003)
                led_control(hell, 0, 0.003)
        else:
            sleep(1)
        neu = read_json()
        if neu != "skip":
            daten = neu
            an = ist_an(daten)
            hell = zahl(daten, "led_max_brightness", 100)
        tmp = browser_laeuft()
    blenden(soll_helligkeit(daten), 0.01)


def main():
    while True:
        daten = read_json()
        # "skip" heisst: die Datei wurde gerade geschrieben. Dann bleibt
        # stehen, was steht — beim naechsten Durchgang ist sie wieder da.
        if daten != "skip":
            blenden(soll_helligkeit(daten))
        sleep(1)


if __name__ == "__main__":
    JSON_DATA = "skip"
    while JSON_DATA == "skip":
        JSON_DATA = read_json()

    pwm_frequency = int(JSON_DATA.get("pwm_frequency", DEFAULT_PWM_FREQUENCY))
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(JSON_DATA["led_gpio"], GPIO.OUT)
    POWER_LED = GPIO.PWM(JSON_DATA["led_gpio"], pwm_frequency)
    POWER_LED.start(0)
    init(JSON_DATA)
    signal.signal(signal.SIGTERM, sigterm_handler)
    main()
