#!/usr/bin/env python3
"""DIE FERNBEDIENUNG STEUERT DIE BOX — und NICHT den Browser.

══ WOZU ES DIESEN DIENST GIBT (06.09.2026, am Geraet gelernt) ═══════════════

Eine gekoppelte BLE-Fernbedienung meldet sich beim Kernel als ganz normale
TASTATUR. Der Kiosk-Browser bekommt ihre Tastendruecke damit direkt — und
Chromium hat eigene Vorstellungen davon, was sie bedeuten:

    Home    (172)  ->  Chromium oeffnet seine STARTSEITE. Auf der Box .81 war
                       das google.com. Ein Kind drueckt Home und sitzt im
                       offenen Internet.
    Zurueck (158)  ->  Chromium geht im Verlauf zurueck.

Das ist der Grund fuer diesen Dienst, und es ist kein Schoenheitsfehler: Auf
einer Kinderbox darf eine Fernbedienungstaste nie den Browser erreichen.

══ DER EXKLUSIVE GRIFF IST DER KERN ═════════════════════════════════════════

`EVIOCGRAB` gibt das Eingabegeraet EINEM Leser allein. Danach sieht weder X
noch Wayland noch Chromium auch nur einen einzigen Tastendruck — sie kommen
ausschliesslich hier an. Am Geraet nachgemessen: mit Griff passiert im Browser
NICHTS mehr.

Der Griff wird beim Beenden geloest (und vom Kernel ohnehin, wenn der Prozess
stirbt). Eine haengende Fernbedienung sperrt sich also nicht dauerhaft aus.

══ WARUM PYTHON MIT STANDARDBIBLIOTHEK, NICHT NODE MIT evdev-PAKET ══════════

Ein npm-evdev-Paket waere ein NATIVES Modul ueber den Update-Weg — dieselbe
Falle, die bei der Datenbank-Wahl gegen LMDB entschieden hat (BACKLOG E132),
und der Docker-Bau stirbt heute schon an einer solchen Abhaengigkeit. Der
Praezedenzfall im Haus ist `scripts/box/touch-bridge.py`, die Eingaben
„bewusst nur mit Standardbibliothek" liest: auf der Box liegt weder
python3-evdev noch smbus, und eine Eingabemethode darf nicht an einem
nachzuinstallierenden Paket haengen.

`struct input_event` ist seit Jahrzehnten stabil (`long, long, u16, u16, s32`)
— mehr braucht es nicht.

══ DAS GERAET WIRD AM NAMEN ERKANNT, NICHT AN DER NUMMER ════════════════════

`/dev/input/event6` ist keine Eigenschaft der Fernbedienung, sondern die
Reihenfolge, in der sie sich angemeldet hat. Nach einem Neustart oder einem
Wiederverbinden ist es event5 oder event9. Gesucht wird deshalb ueber
`/proc/bus/input/devices` nach dem NAMEN — so verlangt es auch die
Spezifikation (E134: „Geraet per udev-Attribut wiedererkennen, nicht per
event-Nummer").

══ DER DIENST WARTET, ER STIRBT NICHT ═══════════════════════════════════════

Eine BLE-Fernbedienung ist die MEISTE ZEIT weg — sie schlaeft nach Minuten
ein und meldet sich erst beim naechsten Druck zurueck. Bis 06.09.2026 brach
dieser Dienst dann ab („kein Geraet gefunden", Rueckgabe 1); systemd startete
neu, fand wieder nichts, und nach `StartLimitBurst` LEGTE ES IHN STILL:

    Active: failed (Result: exit-code) since 16:47:42; 1h 58min ago

Ab da war die Fernbedienung tot, bis jemand von Hand eingriff. Deshalb sucht,
greift und liest der Dienst jetzt in einer Schleife im selben Prozess.

AUFRUF
    fernbedienung.py                       # Dauerbetrieb (systemd)
    fernbedienung.py --zeigen              # nur anzeigen, was ankommt
    fernbedienung.py --zeigen --ohne-griff # ohne exklusiven Griff (Diagnose)
    fernbedienung.py --roh --ohne-griff --geraet Xbox
                                           # ein NEUES Geraet ausmessen:
                                           # zeigt jedes Ereignis mit typ/code/wert

Rueckgabe 0 nur bei sauberem Abbruch (Ctrl-C, systemd stop) — im Normalbetrieb
kehrt der Dienst nicht zurueck.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# _IOW(69, 0x90, int) — der Griff. Fest verdrahtet, weil `fcntl` die Makros
# nicht kennt; der Wert ist auf allen Linux-Architekturen dieser Box gleich.
EVIOCGRAB = 0x40044590

EREIGNIS = struct.Struct("llHHi")
EV_KEY = 1
EV_ABS = 3
GEDRUECKT = 1
LANG = 2  # Wiederholung, die der Kernel selbst schickt

# ══ WARUM ES EV_ABS BRAUCHT (06.09.2026, am Xbox-Controller gemessen) ════════
#
# Eine Fernbedienung hat nur Tasten. Ein GAMEPAD nicht: sein Steuerkreuz ist
# beim Xbox Wireless Controller (045e:0b13) keine Taste, sondern eine ACHSE.
# Das steht in /proc/bus/input/devices und musste nicht geraten werden:
#
#     B: EV=20001b     <- Bit 3 gesetzt, also EV_ABS
#     B: ABS=30627     <- Bits 16 und 17, also ABS_HAT0X und ABS_HAT0Y
#
# Wer nur EV_KEY auswertet, sieht vom Steuerkreuz NICHTS — kein Fehler, keine
# Meldung, es passiert schlicht nichts. Genau die Sorte Schweigen, die diesen
# Abend mehrfach Stunden gekostet hat.
#
# STEUERKREUZ UND STICKS WERDEN GETRENNT BEHANDELT, obwohl beides EV_ABS ist:
# das Kreuz meldet -1/0/+1, ein Stick eine ganze Werteleiter. Siehe die
# Begruendung am Stick-Abschnitt gleich darunter.
ABS_HAT0X = 16
ABS_HAT0Y = 17

# ══ DIE STICKS BRAUCHEN EINE TOTZONE UND EINE FLANKE ═════════════════════════
#
# Das Steuerkreuz meldet -1, 0 oder +1 — fertig. Ein Daumenstick meldet eine
# ganze LEITER: bei 16 Bit liegt die Mitte um 32768, und beim Auslenken kommen
# Dutzende Zwischenwerte. Zwei Dinge folgen daraus:
#
# 1. TOTZONE. In Ruhe zittert der Stick. Am Geraet gemessen (06.09.2026,
#    Xbox-Controller, unberuehrt auf dem Tisch): Werte zwischen 32139 und
#    33883, also rund +/-900 um die Mitte — und in 40 Sekunden 148 Ereignisse
#    allein auf der Y-Achse. Ohne Totzone wanderte die Auswahl von allein.
#
# 2. FLANKE STATT WERT. Wer jeden Wert oberhalb der Schwelle auslost, bekommt
#    bei EINER Auslenkung ein Dutzend Schritte. Gezaehlt wird deshalb der
#    UEBERGANG: einmal ueber ANSCHLAG hinaus = ein Schritt, und erst wenn der
#    Stick unter LOSLASSEN zurueckkehrt, ist er wieder scharf. Zwei Schwellen
#    statt einer, damit ein zitternder Daumen an der Grenze nicht flattert.
#
# ANSCHLAG ist bewusst niedrig: 12000 von 32768 sind gut ein Drittel des Wegs.
# Die Messung erreichte ohne Vollausschlag schon 48470 (also +15700) — ein
# Kind kommt dort sicher hin, ein liegender Controller nie.
STICK_MITTE = 32768
STICK_ANSCHLAG = 12000
STICK_LOSLASSEN = 6000
# Wo jeder Stick gerade steht: -1, 0 oder +1. Nur der WECHSEL loest aus.
_stick_lage: dict = {}

ZUORDNUNG = Path(os.environ.get("MIXPI_FERNBEDIENUNG_ZUORDNUNG", "/etc/mupibox/fernbedienung.json"))
BOX = os.environ.get("MIXPI_BOX_ADRESSE", "http://127.0.0.1:8200")
GERAETE = Path(os.environ.get("MIXPI_INPUT_DEVICES", "/proc/bus/input/devices"))

# Was eine Aktion beim Abspieldienst ausloest. Die NAMEN links sind die
# Kennungen aus src/backend-api/src/box-aktionen.ts — sie sind dort
# festgenagelt, weil sie in gespeicherten Zuordnungen stehen.
WEGE = {
    "naechster-titel": "/player/current/next",
    "voriger-titel": "/player/current/previous",
    "stoppen": "/player/current/stop",
}

# `lauter`/`leiser` STANDEN HIER BIS ZUM 06.09.2026 ABENDS — als
# `/player/current/volume/+5` und `-5`, also als GENAU DER WEG, der am selben
# Tag mit E130 als wirkungslos erkannt und gefaellt wurde. Am Geraet gemessen:
# dreimal hintereinander +5, der Wert stand jedes Mal unveraendert bei 100.
#
# WARUM DAS MONATE UEBERLEBEN KONNTE: Keine Taste zeigte darauf. Die
# Fire-TV-Fernbedienung hat gar keine Lautstaerketasten (ihre laufen ueber
# Infrarot und erreichen den Pi nie), also lag der tote Weg unbenutzt da.
# Aufgefallen ist er erst, als das Steuerkreuz des Xbox-Controllers fest auf
# lauter/leiser gelegt werden sollte — und ihn geerbt haette.
#
# Sie gehen deshalb jetzt AN DIE SEITE (siehe AN_DIE_SEITE): dort rechnet
# `lautstaerkeSchritt()` den absoluten Wert aus und schickt ihn ueber
# denselben Weg wie der Regler.

# `abspielen-anhalten` STEHT ABSICHTLICH NICHT DARIN.
#
# AM GERAET GEMESSEN (06.09.2026, Betreiber: „play stop klappt noch nicht"):
# `/player/current/playpause` antwortet mit HTTP 200 — und tut NICHTS. Der
# Abspieldienst kennt den Befehl gar nicht; im ganzen spotify-control.ts
# kommt „playpause" nicht ein einziges Mal vor, nur `play`, `pause`, `stop`,
# `next`, `previous`. Ein 200 ist hier also keine Auskunft ueber Wirkung,
# sondern nur darueber, dass jemand zugehoert hat.
#
# Die Oberflaeche macht es laengst richtig: sie schickt `play` ODER `pause`,
# je nachdem was gerade laeuft (app.js, `spielerBefehl`). Genau das tut
# `umschalten()` unten — erst den Zustand lesen, dann den passenden Befehl.
ZUSTAND = "/player/local"


def geraete_lesen() -> list[tuple[str, str]]:
    """(Name, event-Datei) aller Eingabegeraete — aus /proc, ohne Fremdpaket."""
    raus: list[tuple[str, str]] = []
    name = ""
    try:
        text = GERAETE.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return raus
    for zeile in text.splitlines():
        if zeile.startswith('N: Name="'):
            name = zeile.split('"')[1]
        elif zeile.startswith("H: Handlers=") and name:
            for teil in zeile.split("=", 1)[1].split():
                if teil.startswith("event"):
                    raus.append((name, f"/dev/input/{teil}"))
            name = ""
    return raus


def geraet_finden(gesucht: list[str]) -> tuple[str, str] | None:
    """Das erste Geraet, dessen Name einen der gesuchten Teile enthaelt."""
    for name, pfad in geraete_lesen():
        for teil in gesucht:
            if teil.lower() in name.lower():
                return name, pfad
    return None


def zuordnung_lesen() -> dict:
    """Was welche Taste tun soll. Fehlt die Datei, tut dieser Dienst NICHTS —
    er greift dann auch nicht zu, denn eine Fernbedienung ohne Zuordnung
    stumm zu schalten waere schlimmer als sie zu ignorieren."""
    try:
        d = json.loads(ZUORDNUNG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


# Was die OBERFLAECHE tun muss, nicht der Abspieldienst. „Zur Startseite" ist
# eine Anweisung an die Seite im Kiosk, und an die kommt von aussen niemand
# heran — sie holt sie sich im Sekundentakt aus einem Fach im Server ab
# (`/api/fernbedienung/anweisung`, dort begruendet).
# Alles, was die OBERFLAECHE tun muss. Navigation gehoert dazu: welche Kachel
# gerade dran ist, weiss nur die Seite — und `auswaehlen` heisst „druecke,
# was dort steht".
AN_DIE_SEITE = {
    "startseite", "zurueck", "hoch", "runter", "links", "rechts", "auswaehlen",
    # Die Lautstaerke gehoert dazu, seit sie absolut gesetzt wird: den Stand
    # kennt die Seite (sie zeigt ihn im Regler), der Abspieldienst rechnet ihn
    # nicht. Siehe die Begruendung an WEGE.
    "lauter", "leiser",
    # Die Spielecke ist eine Ansicht der Seite, kein Befehl an den
    # Abspieldienst — die Musik laeuft waehrenddessen weiter.
    "spielecke",
    # Die Buehne ist eine Ansicht IM Player — nur die Seite weiss, was
    # dort gerade steht und was als naechstes kommt.
    "buehne-weiter",
}


# Wann welche Taste zuletzt ANKAM — gegen doppelte Funk-Reports (siehe die
# Begruendung an der Prellsperre in `hauptlauf`).
_prell: dict = {}
PRELL_S = 0.25

# ══ ACHSEN PRELLEN NICHT — UND EIN SPIEL MERKT DEN UNTERSCHIED ══════════════
#
# Die 250 ms oben sind die Antwort auf einen doppelten FUNK-REPORT der
# Fire-TV-Fernbedienung: ein Druck kam zweimal an (06.09.2026, im Journal
# gesehen). Das ist ein Tastenproblem.
#
# EV_ABS meldet dagegen nur ZUSTANDSAENDERUNGEN — das Steuerkreuz schickt -1,
# dann 0, und dazwischen nichts. Ein doppelter Bericht kann hier gar nicht
# entstehen, die lange Sperre kostet also nur Zeit. Betreiber beim ersten
# Spiel: „die Steuerung ist zu langsam fuer das Spiel", und er hat recht:
# 250 ms Sperre plus Abholtakt sind fuer eine Kachelauswahl unmerklich und
# fuer Snake zu traege.
#
# 50 ms bleiben als Rest — nicht null, weil ein wackelnder Daumen am
# Stick-Anschlag sonst eine Kaskade ausloest.
PRELL_ACHSE_S = 0.05

# Was zuletzt geschickt wurde, und wann. Siehe `umschalten()`.
_zuletzt: dict = {"befehl": "", "zeit": 0.0}
# Wie lange der eigene Befehl schwerer wiegt als die Meldung des Players.
NACHHALL_S = 3.0


def umschalten(laut: bool = True) -> None:
    """Laeuft etwas? Dann anhalten. Sonst weiterspielen.

    Der Abspieldienst hat keinen Umschalt-Befehl (siehe WEGE oben), also wird
    hier gefragt und entschieden — dieselbe Reihenfolge wie in der Oberflaeche.

    ══ DAS GEDAECHTNIS (06.09.2026, Betreiber: „pause und play klappen nicht
    im wechsel") ═══════════════════════════════════════════════════════════
    Der Player meldet seinen neuen Zustand nicht sofort: zwischen `pause` und
    `playing: false` liegt eine knappe Sekunde, bei Spotify auch mehr. Wer in
    dieser Zeit noch einmal drueckt, bekommt vom Zustand die ALTE Antwort —
    und der Dienst schickt denselben Befehl ein zweites Mal. Fuer den
    Menschen sieht das aus, als reagiere die Taste nur jedes zweite Mal.

    Deshalb wiegt der EIGENE letzte Befehl innerhalb von NACHHALL_S schwerer
    als die Meldung: Wer gerade `pause` geschickt hat, schickt als naechstes
    `play` — ganz gleich, was der Player noch behauptet. Danach gilt wieder
    die Messung, denn inzwischen kann jemand anderes (Finger, Oberflaeche,
    Titelende) den Zustand geaendert haben.
    """
    jetzt = time.time()
    if _zuletzt["befehl"] and jetzt - _zuletzt["zeit"] < NACHHALL_S:
        befehl = "play" if _zuletzt["befehl"] == "pause" else "pause"
        _zuletzt.update(befehl=befehl, zeit=jetzt)
        try:
            with urllib.request.urlopen(f"{BOX}/player/current/{befehl}", timeout=4) as a:
                a.read(64)
            if laut:
                print(f"  -> {befehl} (aus dem Gedaechtnis)", flush=True)
        except (urllib.error.URLError, OSError) as e:
            print(f"  FEHLER bei '{befehl}': {e}", flush=True)
        return

    lauft = None
    try:
        with urllib.request.urlopen(f"{BOX}{ZUSTAND}", timeout=4) as a:
            d = json.loads(a.read(65536).decode("utf-8", "replace"))
        # AM GERAET NACHGESEHEN (06.09.2026, Betreiber: „play funktioniert
        # nicht nur pause"): `currentPlayer` bleibt im PAUSIERTEN Zustand
        # gesetzt — der Abspieler hat den Titel ja noch. Wer daran misst, haelt
        # eine Pause fuer Wiedergabe und schickt ewig „pause".
        #
        # Die Wahrheit steht in `playing` und `pause`; beide meldet
        # /player/local ausdruecklich (nachgemessen: pause=True,
        # playing=False, currentPlayer='spotify').
        if "playing" in d:
            lauft = bool(d.get("playing"))
        elif "pause" in d:
            lauft = not bool(d.get("pause"))
        else:
            # Aeltere Faelle: `state` wie beim Sonos-Erbe, sonst gar nichts.
            zustand = str(d.get("state") or "").lower()
            lauft = zustand == "play" if zustand else bool(d.get("currentPlayer"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"  Zustand nicht lesbar ({e}) — nehme 'pause'", flush=True)
    # IM ZWEIFEL ANHALTEN: Wer die Taste drueckt und nichts hoert, drueckt
    # noch einmal. Wer sie drueckt und es wird LAUTER, erschrickt.
    befehl = "pause" if lauft is not False else "play"
    _zuletzt.update(befehl=befehl, zeit=time.time())
    try:
        with urllib.request.urlopen(f"{BOX}/player/current/{befehl}", timeout=4) as a:
            a.read(64)
        if laut:
            print(f"  -> {befehl}", flush=True)
    except (urllib.error.URLError, OSError) as e:
        print(f"  FEHLER bei '{befehl}': {e}", flush=True)


def tun(aktion: str, laut: bool = True) -> None:
    """Eine Box-Aktion ausloesen. Fehler werden GEMELDET und verschluckt: ein
    Netzfehler darf den Dienst nicht beenden, sonst ist die Fernbedienung nach
    dem ersten Schluckauf tot."""
    if aktion in AN_DIE_SEITE:
        try:
            bitte = urllib.request.Request(
                f"{BOX}/api/fernbedienung/anweisung",
                data=json.dumps({"was": aktion}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(bitte, timeout=4) as a:
                a.read(64)
            if laut:
                print(f"  -> {aktion} (an die Oberflaeche)", flush=True)
        except (urllib.error.URLError, OSError) as e:
            print(f"  FEHLER bei '{aktion}': {e}", flush=True)
        return

    if aktion == "abspielen-anhalten":
        umschalten(laut)
        return

    weg = WEGE.get(aktion)
    if not weg:
        # `ausschalten` braucht die Rueckfrage der Oberflaeche und kommt, wenn
        # die dafuer einen Weg hat. Bis dahin: sagen statt schweigen.
        if laut:
            print(f"  (noch kein Weg fuer '{aktion}')", flush=True)
        return
    try:
        with urllib.request.urlopen(f"{BOX}{weg}", timeout=4) as a:
            a.read(64)
        if laut:
            print(f"  -> {aktion}", flush=True)
    except (urllib.error.URLError, OSError) as e:
        print(f"  FEHLER bei '{aktion}': {e}", flush=True)


def hauptlauf(argv: list[str] | None = None) -> int:
    z = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    z.add_argument("--zeigen", action="store_true", help="jeden Tastendruck ausgeben")
    z.add_argument("--roh", action="store_true",
                   help="JEDES Ereignis zeigen (typ/code/wert) — so misst man ein neues Geraet aus")
    z.add_argument("--ohne-griff", action="store_true", help="das Geraet NICHT exklusiv greifen (Diagnose)")
    z.add_argument("--geraet", help="Namensteil des Eingabegeraets (sonst aus der Zuordnung)")
    args = z.parse_args(argv)

    lage = zuordnung_lesen()
    namen = [args.geraet] if args.geraet else lage.get("geraete", [])
    if not namen:
        print(f"Keine Zuordnung in {ZUORDNUNG} — nichts zu tun.", file=sys.stderr)
        return 1

    tasten = {str(k): v for k, v in (lage.get("tasten") or {}).items()}
    # Achsen: {"16": ["links", "rechts"]} — erst die Richtung fuer den
    # NEGATIVEN Ausschlag, dann die fuer den positiven. Fehlt der Abschnitt,
    # bleibt es beim reinen Tastenbetrieb; eine Fernbedienung braucht ihn nicht.
    achsen = {str(k): v for k, v in (lage.get("achsen") or {}).items() if isinstance(v, list) and len(v) == 2}
    # Sticks werden GETRENNT von den Achsen gefuehrt, obwohl beides EV_ABS
    # ist: das Steuerkreuz meldet -1/0/+1, ein Stick eine Werteleiter. Wer
    # sie in einen Topf wirft, behandelt zwangslaeufig eines von beiden
    # falsch.
    sticks = {str(k): v for k, v in (lage.get("sticks") or {}).items() if isinstance(v, list) and len(v) == 2}

    # ══ WARTEN STATT STERBEN (06.09.2026, am Geraet gefunden) ════════════════
    #
    # Hier wurde bis heute abgebrochen, wenn kein Geraet da war — und beim
    # Verschwinden endete der Dienst mit der Bemerkung „systemd startet neu".
    # BEIDES ZUSAMMEN IST EINE FALLE, und sie hat zugeschlagen: Eine BLE-
    # Fernbedienung ist die MEISTE ZEIT weg. Sie schlaeft nach wenigen Minuten
    # ein und meldet sich erst beim naechsten Tastendruck zurueck. Der Dienst
    # startete also im Kreis, fand nichts, brach ab — bis `StartLimitBurst`
    # griff und systemd ihn STILLLEGTE:
    #
    #     Active: failed (Result: exit-code) since 16:47:42; 1h 58min ago
    #     Duration: 119ms
    #
    # Ab da war die Fernbedienung tot, bis jemand von Hand eingriff. Genau das
    # darf ein Geraet nicht verlangen, das ein Kind bedient.
    #
    # Der Dienst wartet deshalb, statt zu enden: Geraet suchen, greifen, lesen
    # — verschwindet es, geht es zurueck ins Suchen, im selben Prozess.
    # GEMELDET WIRD NUR DER WECHSEL, nicht jeder Suchlauf: alle zwei Sekunden
    # eine Zeile fuellte das Journal, das auf dieser Box ohnehin nur rund
    # zwanzig Minuten zurueckreicht.
    # JEDE RUNDE ENDET MIT EINER PAUSE, und jede Meldung haengt an einem
    # WECHSEL. Ohne beides floss dieser Dienst ueber: in der Gegenprobe stand
    # ein Geraet in /proc, liess sich aber nicht oeffnen (genau die Lage
    # zwischen Auftauchen und fertigem udev-Knoten) — die Schleife drehte
    # ungebremst und schrieb 38 MB in sechs Sekunden. Auf der Box waere das
    # das Journal gewesen, das ohnehin nur zwanzig Minuten zurueckreicht:
    # der Spam haette genau die Zeilen verdraengt, wegen derer man hinsieht.
    suchtakt = 2.0
    gemeldet = ""  # "" = noch nichts, "fehlt", sonst der zuletzt gemeldete Pfad
    while True:
        gefunden = geraet_finden(namen)
        if not gefunden:
            if gemeldet != "fehlt":
                print(f"Warte auf: {', '.join(namen)}", flush=True)
                gemeldet = "fehlt"
            time.sleep(suchtakt)
            continue
        name, pfad = gefunden
        ende = lesen(pfad, name, tasten, achsen, sticks, args, melden=gemeldet != pfad)
        if ende is not None:
            return ende
        gemeldet = pfad
        # Die Prellsperre gehoert dem alten Anschluss und wuerde sonst den
        # ersten Druck nach dem Aufwachen schlucken.
        _prell.clear()
        time.sleep(suchtakt)


def lesen(pfad: str, name: str, tasten: dict, achsen: dict, sticks: dict, args, melden: bool = True) -> int | None:
    """Ereignisse eines Geraets verarbeiten, bis es verschwindet.

    Rueckgabe: None heisst „Geraet weg, bitte neu suchen"; eine Zahl heisst
    „dieser Dienst ist fertig" und wird zum Rueckgabewert des Prozesses.
    """
    try:
        f = open(pfad, "rb")
    except OSError as e:
        # Zwischen Finden und Oeffnen kann es schon wieder weg sein — oder der
        # udev-Knoten ist noch nicht fertig. Nur beim WECHSEL melden, sonst
        # schreibt genau dieser Fall das Journal voll.
        if melden:
            print(f"Konnte {pfad} nicht oeffnen ({e}) — suche weiter.", flush=True)
        return None
    with f:
        if melden:
            print(f"Fernbedienung: {name} ({pfad}), {len(tasten)} Tasten zugeordnet", flush=True)
        if not args.ohne_griff:
            try:
                fcntl.ioctl(f, EVIOCGRAB, 1)
                print("Exklusiv gegriffen — der Browser sieht diese Tasten nicht mehr.", flush=True)
            except OSError as e:
                # OHNE GRIFF WEITERLESEN WAERE FALSCH: dann steuerte die
                # Fernbedienung den Browser MIT, und jeder Druck wirkte
                # doppelt — einmal hier, einmal dort.
                #
                # ABBRECHEN IST ES SEIT HEUTE AUCH NICHT MEHR (siehe die
                # Warteschleife oben): ein Abbruch legt den Dienst dauerhaft
                # still, und dann hilft auch kein spaeterer, geglueckter Griff
                # mehr. Also nicht lesen, aber am Leben bleiben und es gleich
                # noch einmal versuchen. Die laengere Pause haelt das Journal
                # frei, falls dauerhaft ein anderer das Geraet haelt.
                print(f"Griff nicht moeglich ({e}) — lese nicht, versuche es erneut.", flush=True)
                time.sleep(5.0)
                return None
        fl = fcntl.fcntl(f, fcntl.F_GETFL)
        fcntl.fcntl(f, fcntl.F_SETFL, fl | os.O_NONBLOCK)
        try:
            while True:
                try:
                    roh = f.read(EREIGNIS.size)
                except BlockingIOError:
                    time.sleep(0.02)
                    continue
                except OSError:
                    # Geraet weg (Fernbedienung schlaeft, Bluetooth getrennt).
                    # DAS IST DER NORMALFALL, kein Fehler: der Dienst geht
                    # zurueck ins Suchen und wartet, bis sie aufwacht.
                    print("Geraet verschwunden — warte auf Rueckkehr.", flush=True)
                    return None
                if not roh or len(roh) < EREIGNIS.size:
                    time.sleep(0.02)
                    continue
                _s, _us, typ, code, wert = EREIGNIS.unpack(roh)
                # Die Rohsicht ist das MESSWERKZEUG fuer ein neues Geraet: sie
                # zeigt, was wirklich ankommt, statt es aus einem Datenblatt zu
                # raten. EV_SYN (0) bleibt draussen — davon kommt nach jedem
                # Ereignis eines, und es traegt keine Auskunft.
                if args.roh and typ != 0:
                    print(f"roh: typ={typ} code={code} wert={wert}", flush=True)

                if typ == EV_KEY:
                    if wert == LANG:
                        # Die Wiederholung des Kernels ist NICHT der lange Druck
                        # aus der Spezifikation — sie kaeme zwanzigmal je
                        # Sekunde. Der lange Druck bekommt seine eigene
                        # Behandlung, wenn er dran ist; bis dahin verworfen.
                        continue
                    if wert != GEDRUECKT:
                        continue
                    schluessel = ("taste", code)
                    aktion = tasten.get(str(code))
                    was = f"Taste {code}"
                elif typ == EV_ABS and str(code) in sticks:
                    # Ein Daumenstick: Totzone und Flanke, siehe oben.
                    ab = wert - STICK_MITTE
                    alt = _stick_lage.get(code, 0)
                    if abs(ab) >= STICK_ANSCHLAG:
                        neu = -1 if ab < 0 else 1
                    elif abs(ab) <= STICK_LOSLASSEN:
                        neu = 0
                    else:
                        # Dazwischen bleibt es, wie es war — das ist die
                        # Hysterese, die das Flattern an der Grenze verhindert.
                        neu = alt
                    _stick_lage[code] = neu
                    # Nur der Weg von der Mitte nach aussen zaehlt. Die
                    # Rueckkehr zur Mitte ist kein zweiter Schritt.
                    if neu == 0 or neu == alt:
                        continue
                    aktion = sticks[str(code)][0 if neu < 0 else 1]
                    schluessel = ("stick", code, neu < 0)
                    was = f"Stick {code} {'-' if neu < 0 else '+'}"
                elif typ == EV_ABS:
                    richtungen = achsen.get(str(code))
                    # Nur zugeordnete Achsen, und NUR der Ausschlag: die 0 ist
                    # das Loslassen und darf nicht noch einmal ausloesen.
                    if not richtungen or wert == 0:
                        continue
                    aktion = richtungen[0] if wert < 0 else richtungen[1]
                    # Beide Richtungen prellen GETRENNT — sonst schluckt ein
                    # Wisch nach links den unmittelbar folgenden nach rechts.
                    schluessel = ("achse", code, wert < 0)
                    was = f"Achse {code} {'-' if wert < 0 else '+'}"
                else:
                    continue
                now = time.time()
                # ══ ENTPRELLEN (06.09.2026, am Journal gesehen) ══════════
                #
                # Betreiber: „nur einmal gedrueckt, es stoppt nicht". Im
                # Protokoll standen fuer EINEN Druck zwei Zeilen in derselben
                # Sekunde:
                #     16:43:47  -> pause (aus dem Gedaechtnis)
                #     16:43:47  -> play  (aus dem Gedaechtnis)
                # Die beiden hoben sich auf, und fuer den Menschen passierte
                # nichts. Die Fernbedienung schickt den Druck also doppelt —
                # ueber Funk keine Seltenheit, und der Kernel reicht beide
                # brav weiter.
                #
                # 250 ms: schneller kann ein Mensch dieselbe Taste nicht
                # absichtlich zweimal druecken (die schnellste bewusste
                # Doppelbetaetigung liegt bei etwa 300 ms). Wiederholtes
                # Blaettern mit gedrueckter Taste laeuft ohnehin ueber die
                # Kernel-Wiederholung, die weiter oben schon verworfen wird.
                # Tasten prellen, Achsen nicht — siehe PRELL_ACHSE_S.
                sperre = PRELL_S if schluessel[0] == "taste" else PRELL_ACHSE_S
                letzte = _prell.get(schluessel, 0.0)
                if now - letzte < sperre:
                    continue
                _prell[schluessel] = now

                # IMMER PROTOKOLLIEREN, nicht nur bei `--zeigen`. Ein Dienst,
                # der schweigt, laesst sich nicht diagnostizieren: als die
                # Wiedergabe-Taste nicht wirkte, war im Journal nicht einmal
                # zu sehen, ob der Druck ueberhaupt ankam (06.09.2026). Es ist
                # eine Zeile je Tastendruck — ein Kind drueckt nicht hundertmal
                # in der Sekunde.
                print(was + (f" = {aktion}" if aktion else " (nicht zugeordnet)"), flush=True)
                if aktion:
                    tun(aktion, laut=True)
        except KeyboardInterrupt:
            return 0
        finally:
            if not args.ohne_griff:
                try:
                    fcntl.ioctl(f, EVIOCGRAB, 0)
                except OSError:
                    pass


if __name__ == "__main__":
    sys.exit(hauptlauf())
