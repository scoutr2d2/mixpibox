#!/usr/bin/env python3
"""
Tonwache: haelt die Bluetooth-Ausgabe verbunden — und sorgt dafuer, dass die
Box NIE stumm dasteht.

WARUM ES DAS BRAUCHT (am Geraet erlebt, 2026-07-27)
Steht die Tonausgabe auf einem Bluetooth-Lautsprecher und ist der beim
Hochfahren aus oder noch nicht da, dann zeigt `/etc/asound.conf` auf einen
Kanal, den es nicht gibt: die Box spielt ins Nichts. ALSA kennt keinen
selbsttaetigen Rueckfall, es kommt keine Fehlermeldung — nur Stille. Und weil
diese Box AUSGESTECKT statt heruntergefahren wird, ist genau diese Kombination
der Normalfall, nicht die Ausnahme.

WAS SIE TUT
  Beim Start (nach bluetooth.service):
    1. Ziel aus /etc/asound.conf lesen. Intern -> nichts zu tun.
    2. Bluetooth -> verbinden, mehrfach mit wachsendem Abstand (der
       Lautsprecher braucht nach dem Einschalten ein paar Sekunden).
    3. Klappt es nicht -> auf INTERN zurueckschreiben, damit Ton da ist,
       und den WUNSCH in /etc/mupibox/tonwunsch merken.
  Danach im Takt (Zeitgeber):
    4. Wunsch = Bluetooth, Geraet nicht verbunden -> verbinden versuchen.
       Das ist der eigentliche „automatische Reconnect": es aendert NICHTS
       an der Konfiguration, faellt also niemandem auf.
    5. Wunsch = Bluetooth, Geraet wieder verbunden, Ausgabe steht aber noch
       auf intern -> zurueckschalten und den Wiedergabedienst neu starten.

WAS SIE BEWUSST NICHT TUT
  * Den Kiosk anfassen. `restart_kiosk.sh` toetet X und bekommt es aus einem
    Dienst heraus nicht zurueck (mupi-kiosk-restart-ueber-ssh-toetet-x).
    Chromium oeffnet seinen Tonkanal beim naechsten Stueck ohnehin neu.
  * Waehrend der Wiedergabe umschalten, wenn es sich vermeiden laesst — der
    Rueckweg auf Bluetooth wartet, bis nichts spielt.

Die Entscheidung selbst ist rein und getestet (tests/tonwache_test.py); alles
mit Dateisystem und Prozessen liegt darum herum.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import time

ASOUND = "/etc/asound.conf"
WUNSCH = "/etc/mupibox/tonwunsch"
REGLER_KARTE = "MAX98357A"
REGLER_NAME = "Master"
# Nach dem Einschalten meldet sich ein Lautsprecher nicht sofort. Sechs
# Versuche ueber gut eine Minute — laenger zu warten hiesse, dass die Box
# minutenlang stumm bleibt, obwohl intern laengst spielen koennte.
VERSUCHE = 6
ABSTAND_S = (2, 4, 6, 10, 15, 20)


# ── reine Entscheidung ────────────────────────────────────────────────────

MAC_RE = re.compile(r'device\s+"([0-9A-Fa-f:]{17})"')


def ziel_aus_asound(text):
    """Was steht in asound.conf? -> ('intern', None) oder ('bluetooth', MAC). Pure.

    Unklares gilt als INTERN — das ist der Zustand MIT Ton. Wer hier raet und
    daneben liegt, macht die Box stumm; die andere Richtung kostet nur einen
    falschen Lautsprecher.
    """
    if not text or "type bluealsa" not in text:
        return ("intern", None)
    m = MAC_RE.search(text)
    if not m:
        return ("intern", None)
    return ("bluetooth", m.group(1).upper())


def verbunden_aus_info(text):
    """`bluetoothctl info <MAC>` auswerten -> True/False. Pure.

    Am ZUSTAND ablesen, nicht am Rueckgabewert: bluetoothctl endet auch nach
    Fehlern mit 0 (mupi-bluetooth-skripte-kaputt).
    """
    for zeile in (text or "").splitlines():
        s = zeile.strip()
        if s.lower().startswith("connected:"):
            return s.split(":", 1)[1].strip().lower() == "yes"
    return False


def entscheide(wunsch_mac, ist_art, verbunden, spielt=False):
    """
    Was ist zu tun? Pure.

    wunsch_mac : gewuenschter Lautsprecher (MAC) oder None = intern gewollt
    ist_art    : was gerade in asound.conf steht ('intern'|'bluetooth')
    verbunden  : ist der gewuenschte Lautsprecher verbunden?
    spielt     : laeuft gerade Musik?

    -> 'nichts' | 'verbinden' | 'zurueckfallen' | 'wiederherstellen'
    """
    if not wunsch_mac:
        return "nichts"                      # intern gewollt: nie ein Problem
    if verbunden:
        if ist_art == "bluetooth":
            return "nichts"                  # alles wie gewuenscht
        # Der Lautsprecher ist wieder da, die Ausgabe steht noch auf intern.
        # Nicht mitten im Stueck umschalten — das bricht es ab.
        return "nichts" if spielt else "wiederherstellen"
    # nicht verbunden
    if ist_art == "bluetooth":
        return "zurueckfallen"               # sonst: stumme Box
    return "verbinden"                       # intern laeuft, im Hintergrund holen


# ── asound.conf schreiben, WORTGLEICH zur Verwaltung ──────────────────────
# Muss Zeichen fuer Zeichen zu asoundConf() in backend-api/src/ton.ts passen,
# sonst erkennt die Verwaltung den Zustand nicht wieder und zeigt Unsinn an.

def asound_text(mac=None):
    kopf = [
        "# Von der MuPiBox-Verwaltung geschrieben.",
        "# Von Hand geaenderte Zeilen gehen beim naechsten Umschalten verloren;",
        "# die vorherige Fassung liegt als /etc/asound.conf.vorher daneben.",
        "",
    ]
    if mac:
        unterbau = [
            "    slave.pcm {",
            "        type bluealsa",
            f'        device "{mac.upper()}"',
            '        profile "a2dp"',
            "    }",
        ]
    else:
        unterbau = [f'    slave.pcm "plughw:CARD={REGLER_KARTE},DEV=0"']
    return "\n".join(
        kopf
        + ["pcm.mupibox {", "    type softvol"]
        + unterbau
        + [f'    control.name "{REGLER_NAME}"', f'    control.card "{REGLER_KARTE}"', "}", ""]
        + ["pcm.!default {", "    type plug", '    slave.pcm "mupibox"', "}", ""]
        + ["ctl.!default {", "    type hw", f'    card "{REGLER_KARTE}"', "}", ""]
    )


# ── Umgebung ──────────────────────────────────────────────────────────────

def sag(*t):
    print("[tonwache]", *t, flush=True)


def _lauf(args, frist=20):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=frist)
        return (r.stdout or "") + (r.stderr or "")
    except (OSError, subprocess.SubprocessError):
        return ""


def ist_verbunden(mac):
    return verbunden_aus_info(_lauf(["bluetoothctl", "info", mac]))


def verbinde(mac):
    _lauf(["bluetoothctl", "connect", mac], frist=25)
    return ist_verbunden(mac)


def spielt_gerade():
    """Laeuft Musik? Vorsichtig: im Zweifel JA, dann wird nicht umgeschaltet."""
    aus = _lauf(["pgrep", "-f", "mplayer|mpv"], frist=5)
    return bool(aus.strip())


def wunsch_lesen():
    try:
        with open(WUNSCH, encoding="utf-8") as f:
            m = f.read().strip().upper()
        return m if re.fullmatch(r"[0-9A-F:]{17}", m) else None
    except OSError:
        return None


def wunsch_schreiben(mac):
    try:
        os.makedirs(os.path.dirname(WUNSCH), exist_ok=True)
        with open(WUNSCH, "w", encoding="utf-8") as f:
            f.write((mac or "") + "\n")
    except OSError as e:
        sag("Wunsch nicht merkbar:", e)


def asound_schreiben(mac, trocken=False):
    neu = asound_text(mac)
    if trocken:
        sag(f"(Trockenlauf) wuerde asound.conf auf {mac or 'intern'} setzen")
        return True
    try:
        if os.path.exists(ASOUND):
            shutil.copyfile(ASOUND, ASOUND + ".vorher")
        tmp = ASOUND + ".neu"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(neu)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, ASOUND)
        return True
    except OSError as e:
        sag("asound.conf nicht schreibbar:", e)
        return False


def wiedergabe_neu():
    """Nur den Wiedergabedienst. Den Kiosk NICHT — siehe Modulkopf."""
    _lauf(["sudo", "-u", "dietpi", "pm2", "restart", "spotify-control"], frist=30)


def laufen(argv=None):
    p = argparse.ArgumentParser(description="Bluetooth-Ausgabe verbunden halten.")
    p.add_argument("--start", action="store_true", help="Startlauf mit mehreren Versuchen")
    p.add_argument("--trocken", action="store_true", help="nur zeigen, nichts aendern")
    a = p.parse_args([] if argv is None else argv)

    try:
        with open(ASOUND, encoding="utf-8") as f:
            ist_art, ist_mac = ziel_aus_asound(f.read())
    except OSError:
        sag("keine asound.conf — nichts zu tun")
        return 0

    wunsch = ist_mac or wunsch_lesen()
    if not wunsch:
        sag("Ausgabe steht auf intern, kein Bluetooth gewuenscht")
        return 0

    verbunden = ist_verbunden(wunsch)

    # Startlauf: dem Lautsprecher Zeit geben, sich zu melden.
    if a.start and not verbunden:
        for i in range(VERSUCHE):
            sag(f"Versuch {i + 1}/{VERSUCHE}, {wunsch} zu verbinden")
            if verbinde(wunsch):
                verbunden = True
                break
            time.sleep(ABSTAND_S[min(i, len(ABSTAND_S) - 1)])

    was = entscheide(wunsch, ist_art, verbunden, spielt_gerade())
    sag(f"Ziel={ist_art} Wunsch={wunsch} verbunden={verbunden} -> {was}")

    if was == "nichts":
        return 0
    if was == "verbinden":
        return 0 if verbinde(wunsch) else 1
    if was == "zurueckfallen":
        sag("Lautsprecher nicht erreichbar — schalte auf intern, damit Ton da ist")
        wunsch_schreiben(wunsch)
        if asound_schreiben(None, a.trocken) and not a.trocken:
            wiedergabe_neu()
        return 0
    if was == "wiederherstellen":
        sag("Lautsprecher wieder da — schalte zurueck auf Bluetooth")
        if asound_schreiben(wunsch, a.trocken) and not a.trocken:
            wiedergabe_neu()
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(laufen())
