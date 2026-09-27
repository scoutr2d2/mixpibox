#!/usr/bin/env python3
"""Der Wachhund unter der Oberflaeche: kommt der Kiosk nicht, passiert etwas.

WOZU (BACKLOG E11c/S4)
S2 (Boot-Animation) und S3 (Fehlerbild) decken zusammen fast alles ab — aber
nicht den schlimmsten Fall, und zwar aus einem Grund, der beim Nachsehen an der
Box am 04.08.2026 herausgekommen ist:

  DER KIOSK HAT KEINE UNIT, AN DIE MAN `OnFailure=` HAENGEN KOENNTE.
  Chromium startet aus `chromium-autostart.sh`, das die automatische Anmeldung
  von getty@tty1 aufruft. Scheitert es dort, ist fuer systemd nichts
  geschehen: getty laeuft, die Sitzung laeuft, kein Dienst ist "failed". Und
  die Anwendung selbst laeuft in diesem Repo unter pm2, hat also ebenfalls
  keine Unit (auf den Boxen im Haus schon: mupibox-server.service aus dem
  remote-step-installer — eine frische Karte bekaeme die nicht).

Genau diese Luecke ist der Fall, der im Kinderzimmer zaehlt: alles ist "gruen",
und der Schirm bleibt trotzdem schwarz. Dafuer ist dieser Wachhund da. Er
fragt nicht systemd, sondern den Bildschirm-Zweck selbst: LAEUFT DER BROWSER?

WAS ER TUT, UND WANN — die Fristen kommen aus der Messung, nicht aus dem Bauch
(tools/grundmessung.py, 04.08.2026, vier Kaltstarts am Pi 5 / DietPi Trixie:
19,4 bis 23,8 s bis zum fertigen Bild):

  bis 130 s   NICHTS. Die Boot-Animation laeuft bis zu 120 s und zeigt dabei
              ehrlich, an welchem Meilenstein es haengt. Wer hier dazwischen
              malt, streitet mit ihr um /dev/fb0 und nimmt dem Zuschauer die
              einzige nuetzliche Auskunft weg. 130 statt 120 ist der Abstand,
              damit die Animation ihr Ende wirklich hinter sich hat.
  ab 130 s    EIN Neustart des Kiosks (restart_kiosk.sh) — mehr als das
              Sechsfache der gemessenen Startzeit ist verstrichen.
  ab 190 s    Das Fehlerbild. Danach ist Schluss.

WAS ER NICHT TUT — und das ist der wichtigere Teil
  * Er startet die BOX nie neu. Ein Wachhund, der von selbst neu startet, tut
    das irgendwann mitten in einem Lied. Dieselbe Ueberlegung steht im
    Zeitgeber der Bootwache im remote-step-installer, und sie gilt hier genauso.
  * Er greift nur EINMAL JE START ein. Der Merker liegt unter /run und ist beim
    naechsten Start von selbst weg — kein Aufraeumen, keine Datei, die alt wird.
  * Laeuft der Kiosk, tut er gar nichts und schaltet seinen Zeitgeber ab.

AUFRUF
    mupibox-kioskwache.py              einmal pruefen und ggf. handeln
    mupibox-kioskwache.py --trocken    nur sagen, was er taete
    mupibox-kioskwache.py --selbsttest die Entscheidungstabelle pruefen (0/1)
"""
import os
import subprocess
import sys

MERKER = "/run/mupibox-kioskwache"          # verschwindet beim Neustart
NEUSTART_AB = 130.0                         # s Laufzeit — nach der Animation
FEHLERBILD_AB = 190.0
FEHLERBILD = "/usr/local/bin/mupibox/mupibox-fehlerbild.py"


# ── Die Entscheidung als reine Funktion ────────────────────────────────────
#
# Bewusst OHNE Seiteneffekte: nur so laesst sich die Tabelle pruefen, ohne eine
# Box zu haben. Genau daran ist hier schon einmal Zeit verlorengegangen —
# Entscheidungen, die im selben Atemzug handeln, kann man nur am Geraet testen,
# und am Geraet testet man sie dann eben nicht.
def entscheidung(laufzeit, kiosk_da, schon_neugestartet, schon_gemalt):
    """-> "nichts" | "neustart" | "fehlerbild" | "fertig"

    "fertig" heisst: der Kiosk ist da, der Wachhund darf sich abschalten.
    """
    if kiosk_da:
        return "fertig"
    if laufzeit < NEUSTART_AB:
        return "nichts"
    if not schon_neugestartet:
        return "neustart"
    if laufzeit >= FEHLERBILD_AB and not schon_gemalt:
        return "fehlerbild"
    return "nichts"


# ── Die Aussenwelt ─────────────────────────────────────────────────────────
def laufzeit():
    """Sekunden seit dem Start. /proc/uptime, nicht die Zeit seit Prozessstart.

    Der Unterschied ist der ganze Punkt: der Wachhund wird von einem Zeitgeber
    immer wieder aufgerufen und weiss aus sich heraus nicht, wie lange die Box
    schon laeuft.
    """
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except (OSError, ValueError):
        return 0.0


def kiosk_da():
    """Laeuft der Browser?

    NICHT ueber systemd gefragt (er kennt den Kiosk nicht, siehe Kopf) und
    nicht ueber den Port 8200 — der ist die Anwendung, nicht das Bild. Es gab
    hier schon den Fall, dass die Anwendung fertig war und niemand sie sah.
    """
    try:
        return subprocess.run(["pgrep", "-f", "[c]hromium"],
                              stdout=subprocess.DEVNULL, timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def merker_lesen():
    try:
        with open(MERKER) as f:
            inhalt = f.read()
    except OSError:
        return False, False
    return "neustart" in inhalt, "fehlerbild" in inhalt


def merker_schreiben(was):
    try:
        with open(MERKER, "a") as f:
            f.write(was + "\n")
    except OSError:
        pass


def sagen(*teile):
    print("[kioskwache]", *teile, flush=True)


def main(argv):
    if "--selbsttest" in argv:
        return selbsttest()
    trocken = "--trocken" in argv

    lz = laufzeit()
    da = kiosk_da()
    neugestartet, gemalt = merker_lesen()
    was = entscheidung(lz, da, neugestartet, gemalt)

    if was == "fertig":
        sagen(f"Kiosk laeuft ({lz:.0f} s nach dem Start) — nichts zu tun")
        if not trocken:
            # Zeitgeber abschalten: ab hier gibt es nichts mehr zu bewachen,
            # und ein Wachhund, der stuendlich `pgrep` laeuft, waere nur Last.
            subprocess.run(["systemctl", "stop", "mupibox-kioskwache.timer"],
                           check=False)
        return 0

    if was == "nichts":
        sagen(f"Kiosk fehlt, {lz:.0f} s — noch abwarten")
        return 0

    if was == "neustart":
        sagen(f"Kiosk fehlt nach {lz:.0f} s — EIN Neustart des Kiosks")
        if trocken:
            return 0
        merker_schreiben("neustart")
        neustart_kiosk()
        return 0

    if was == "fehlerbild":
        sagen(f"Kiosk fehlt nach {lz:.0f} s auch nach dem Neustart — Fehlerbild")
        if trocken:
            return 0
        merker_schreiben("fehlerbild")
        # Im Hintergrund: das Bild steht, solange sein Prozess lebt, und der
        # Wachhund darf darauf nicht warten.
        subprocess.Popen(                                   # noqa: S603
            [FEHLERBILD, "--text", "Die Oberflaeche ist nicht gekommen",
             "Die Box laeuft, zeigt aber nichts"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Ab hier ist alles gesagt. Der Zeitgeber duerfte weiterlaufen, aber er
        # koennte nur noch dasselbe wiederholen — und alle 20 s `pgrep` auf
        # einer ohnehin kranken Box ist keine Hilfe, sondern Rauschen im
        # Protokoll, in dem man spaeter sucht.
        subprocess.run(["systemctl", "stop", "mupibox-kioskwache.timer"],
                       check=False)
        return 0

    return 0


def neustart_kiosk():
    """Den Kiosk auf DEM WEG neu starten, auf dem er auch beim Booten kommt.

    NICHT ueber restart_kiosk.sh, obwohl es danebenliegt und genau so heisst.
    Dieses Skript ist fuer den Aufruf aus der Verwaltung gedacht und laeuft
    dort als www-data; es ruft chromium-autostart.sh direkt auf. Aus einer
    systemd-Unit heraus liefe derselbe Aufruf als ROOT — und das Skript
    entscheidet an `[ "$USER" = 'root' ]`, ob es `startx` oder `xinit` nimmt.
    Der Kiosk kaeme dann als root hoch, mit anderem Zuhause, anderem
    Chromium-Profil und ohne die Rechte ueber systemd-logind, die `startx`
    gerade besorgt.

    Der richtige Griff ist eine Etage tiefer: getty@tty1 neu starten. Dort
    haengt die automatische Anmeldung als dietpi dran, und die ruft
    chromium-autostart.sh so auf, wie es beim Booten passiert. Ein Wachhund
    soll den bekannten Weg noch einmal gehen, nicht einen zweiten erfinden.
    """
    subprocess.run(["systemctl", "restart", "getty@tty1.service"], check=False)


def selbsttest():
    ok = bad = 0

    def chk(name, bedingung):
        nonlocal ok, bad
        print(("  OK    " if bedingung else "  FEHLT ") + name)
        ok += bool(bedingung)
        bad += (not bedingung)

    # Der gute Fall: der Kiosk kommt in der gemessenen Zeit (19 bis 24 s).
    chk("Kiosk nach 25 s da -> fertig",
        entscheidung(25, True, False, False) == "fertig")
    chk("Kiosk spaeter da -> immer noch fertig, nie ein Nachtreten",
        entscheidung(500, True, True, True) == "fertig")

    # Die Sperrfrist. WICHTIGSTE ZEILE DES TESTS: solange die Boot-Animation
    # laeuft (bis 120 s), darf hier NICHTS passieren — sonst streiten zwei
    # Programme um /dev/fb0 und der Zuschauer verliert die einzige Auskunft,
    # die er hat.
    for t in (0, 30, 100, 120, 129):
        chk(f"{t} s ohne Kiosk -> abwarten (Animation laeuft noch)",
            entscheidung(t, False, False, False) == "nichts")

    chk("130 s ohne Kiosk -> Neustart",
        entscheidung(130, False, False, False) == "neustart")
    chk("nur EIN Neustart je Start",
        entscheidung(150, False, True, False) == "nichts")
    chk("190 s, Neustart half nicht -> Fehlerbild",
        entscheidung(190, False, True, False) == "fehlerbild")
    chk("Fehlerbild nur EINMAL",
        entscheidung(600, False, True, True) == "nichts")
    chk("Fehlerbild NIE ohne vorherigen Neustartversuch",
        entscheidung(600, False, False, False) == "neustart")

    print(f"\nKioskwache: {ok} bestanden, {bad} fehlgeschlagen")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
