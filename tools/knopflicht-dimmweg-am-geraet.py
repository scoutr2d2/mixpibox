#!/usr/bin/env python3
"""Misst AM GERAET, ob der Dimmweg des Knopflichts ueberhaupt eine Chance hat.

WARUM ES DIESES WERKZEUG GIBT
=============================
tools/knopflicht-probe.py prueft die RECHNUNG (led_control.py, die drei
Funktionen aus mupi_start_led.sh, die Haltedauer) — ohne Pi, gestellt. Genau
die eine Stelle, an der die Kette auf einem Pi 5 reisst, kommt darin nicht vor:

    scripts/mupibox/mupi_start_led.sh:126
        displayState=`vcgencmd display_power | grep -o '.$'`

`display_power` ist ein VideoCore-Befehl. Auf dem Pi 5 (BCM2712) kennt ihn die
Firmware nicht mehr. Und der Fehlertext geht NICHT nach stderr, sondern nach
STDOUT — die Backticks fangen ihn also ein:

    vc_gencmd_read_response returned -1
    error=1 error_msg="Command not registered"

`grep -o '.$'` nimmt von JEDER Zeile das letzte Zeichen: aus der ersten die 1
(von "-1"), aus der zweiten das Anfuehrungszeichen. displayState wird damit
zu 1<NL>" — und `[ ${displayState} -eq 1 ]` (unquotiert, Zeile 128 und 138)
endet in `[: too many arguments`. BEIDE Zweige feuern nie, `ledDim` bleibt auf
dem Startwert 0 = hell. Die Einstellung „Helligkeit gedimmt" ist damit tot.

Das sieht man dem Verhalten nicht an: der Dienst laeuft, die Datei /tmp/.power_led
ist gueltig, led_control.py rechnet richtig — nur der Eingangswert kommt nie an.
Deshalb wird hier NICHT die Rechnung geprueft, sondern die Wirklichkeit auf der
Box.

    python3 tools/knopflicht-dimmweg-am-geraet.py [--box 192.168.178.169]

NUR LESEND. Kein Dienst wird angefasst, keine Datei geschrieben, /tmp/.power_led
nicht veraendert (ein Schreiben dort waere sichtbar: die LED wuerde springen).

Rueckgabe 0 = der Dimmweg ist erreichbar, 1 = mindestens ein Befund.
"""

import argparse
import os
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START_LED = os.path.join(WURZEL, "scripts", "mupibox", "mupi_start_led.sh")
BOX_START_LED = "/usr/local/bin/mupibox/mupi_start_led.sh"

befunde = []


def sagen(zeile):
    print(zeile, flush=True)


def befund(text):
    befunde.append(text)
    sagen(f"  BEFUND  {text}")


def ok(text):
    sagen(f"  ok      {text}")


def fern(box, befehl, als_root=False, zeitlimit=30, schale="bash"):
    """Einen Befehl auf der Box ausfuehren. Gibt (rc, stdout, stderr) zurueck.

    BatchMode: eine Messung darf nie nach einem Passwort fragen und dann
    stehenbleiben — sie soll ehrlich scheitern.

    SCHALE: mupi_start_led.sh traegt `#!/bin/bash`. Wer die Zeile in `sh`
    (auf DietPi ist das dash) nachstellt, misst eine ANDERE Sprache: dash
    sagt zu `[ 1 " -eq 1 ]` nicht „too many arguments", sondern „unexpected
    operator", und `printf %q` kennt es gar nicht. Die erste Fassung dieses
    Werkzeugs hat genau daran vorbeigemessen und den Fehler fuer harmlos
    erklaert.
    """
    huelle = f"sudo -n {schale} -c " if als_root else f"{schale} -c "
    wort = "'" + befehl.replace("'", "'\\''") + "'"
    try:
        e = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
             "-o", "StrictHostKeyChecking=accept-new", f"dietpi@{box}", huelle + wort],
            capture_output=True, text=True, timeout=zeitlimit)
        return e.returncode, e.stdout, e.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "Zeitlimit"


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--box", default="192.168.178.169")
    a = p.parse_args()
    box = a.box

    sagen(f"Dimmweg des Knopflichts — gemessen an {box}, nur lesend\n")

    rc, aus, _ = fern(box, "cat /proc/device-tree/model | tr -d '\\000'")
    if rc != 0:
        sagen(f"  Box nicht erreichbar (rc={rc}). Nichts gemessen.")
        return 2
    modell = aus.strip()
    sagen(f"1. Geraet: {modell}")

    # ── Kennt die Firmware den Befehl? ────────────────────────────────────
    sagen("\n2. vcgencmd display_power — der Eingangswert von Zeile 126")
    rc, aus, err = fern(box, "vcgencmd display_power")
    sagen(f"     rc={rc}  stdout={aus!r}  stderr={err!r}")
    if rc != 0 or "not registered" in aus or "not registered" in err:
        befund("vcgencmd display_power antwortet nicht mit 0/1 — "
               "der Bildschirmzustand ist fuer das Skript nicht lesbar")
    else:
        ok("vcgencmd display_power antwortet")

    # Was Zeile 126 daraus macht — mit GENAU derselben Pipeline.
    rc, aus, _ = fern(box, "d=`vcgencmd display_power | grep -o '.$'`; printf '%q' \"$d\"")
    sagen(f"     displayState = {aus.strip()}")
    rc, aus, err = fern(
        box, "d=`vcgencmd display_power | grep -o '.$'`; [ ${d} -eq 1 ]; echo rc=$?")
    meldung = (err or "").strip().splitlines()
    sagen(f"     Test Zeile 128: {aus.strip()}  {meldung[-1] if meldung else ''}")
    if "too many arguments" in (err or "") or "unary operator" in (err or ""):
        befund("der Test in Zeile 128/138 bricht ab — beide Zweige feuern nie, "
               "ledDim bleibt auf dem Startwert 0 (hell)")
    else:
        ok("der Test in Zeile 128 laeuft durch")

    # ── Laeuft dort wirklich diese Datei? ─────────────────────────────────
    sagen("\n3. Laeuft auf der Box dieselbe Datei wie im Baum?")
    rc, aus, _ = fern(box, f"md5sum {BOX_START_LED}")
    auf_box = aus.split()[0] if aus.split() else "?"
    hier = subprocess.run(["md5sum", START_LED], capture_output=True, text=True).stdout.split()[0]
    if auf_box == hier:
        ok(f"gleiche Datei ({auf_box[:12]}…)")
    else:
        sagen(f"     Box {auf_box[:12]}…  Baum {hier[:12]}… — Aussagen gelten nur fuer den Baum")

    # ── Der Beweis, dass es JETZT passiert ────────────────────────────────
    sagen("\n4. Das Protokoll des Dienstes")
    rc, aus, _ = fern(
        box, "journalctl -u mupi_powerled --since '-1h' --no-pager "
             "| grep -c 'too many arguments'", als_root=True)
    zahl = (aus or "0").strip()
    sagen(f"     '[: too many arguments' in der letzten Stunde: {zahl}")
    if zahl.isdigit() and int(zahl) > 0:
        befund(f"{zahl} Fehlermeldungen je Stunde — die Schleife scheitert "
               "zweimal pro Sekunde, seit dem Start")

    # ── Und was am Ende der Kette anliegt ─────────────────────────────────
    sagen("\n5. Was in /tmp/.power_led steht (der Stand, den led_control.py liest)")
    rc, aus, _ = fern(box, "jq -c '{led_dim_mode,led_max_brightness,led_min_brightness,led_enabled}' /tmp/.power_led")
    sagen(f"     {aus.strip()}")
    if '"led_dim_mode":0' in aus.replace(" ", "") and '"led_enabled":1' in aus.replace(" ", ""):
        sagen("     (0 = hell — erwartbar, solange der Bildschirm an ist;"
              " nach Ablauf von timeout.idleDisplayOff muesste hier 1 stehen)")

    rc, aus, _ = fern(box, "jq -r .timeout.idleDisplayOff /etc/mupibox/mupiboxconfig.json")
    sagen(f"     timeout.idleDisplayOff = {aus.strip()} min")
    rc, aus, _ = fern(box, "grep -h BlankTime /etc/X11/xorg.conf.d/*.conf")
    sagen(f"     X-Bildschirmschoner: {aus.strip() or '(nicht gesetzt)'}")

    sagen("")
    if befunde:
        sagen(f"{len(befunde)} BEFUND(E):")
        for b in befunde:
            sagen(f"  - {b}")
        return 1
    sagen("Kein Befund: der Dimmweg ist erreichbar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
