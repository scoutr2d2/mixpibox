#!/usr/bin/env python3
"""Tonweg messen - kommt heraus, was hineingeht?

DIE FRAGE, die dieses Werkzeug beantwortet: es knackt beim Hoeren. Liegt das am
Zuspieler (Spotify, Jellyfin, die Sprachausgabe) oder am Tonweg (PipeWire,
Bluetooth)?

DER TRICK: PipeWire laesst sich an jedem Ausgang MITLESEN (der `.monitor`).
Wir spielen ein Signal, das wir GENAU kennen - einen reinen Sinus - und lesen
gleichzeitig mit, was PipeWire tatsaechlich hinausschickt. Danach vergleichen
wir Ton fuer Ton. Ein reiner Sinus ist dafuer ideal: bei 440 Hz und 48 kHz kann
sich der Wert von einem Ton zum naechsten hoechstens um einen genau
berechenbaren Betrag aendern. Jeder groessere Sprung IST ein Knacken - da muss
man nichts schaetzen.

WAS DAS ERGEBNIS BEDEUTET - und das ist der eigentliche Zweck:

  Mitschrift SAUBER, es knackt aber hoerbar
      -> der Fehler liegt HINTER PipeWire. Also an der Bluetooth-Strecke:
         Funkstoerung, zu kleiner Puffer, schwacher Codec. Der Zuspieler ist
         entlastet.

  Mitschrift SCHMUTZIG (Spruenge oder Luecken)
      -> der Fehler liegt VOR dem Ausgang. Also am Zuspieler oder an PipeWire
         selbst (zu wenig Rechenzeit, xruns).

WICHTIGE EINSCHRAENKUNG, die man kennen muss: der Monitor zeigt, was PipeWire
ABGESCHICKT hat - nicht, was der Lautsprecher wirklich gespielt hat. Verliert
die Bluetooth-Strecke danach Pakete, sieht die Mitschrift trotzdem sauber aus.
Genau diese Trennung ist hier erwuenscht; das Werkzeug behauptet nichts ueber
die Funkstrecke, es schliesst nur den Zuspieler aus oder ein.

AUFRUF
  mupi-ton.py            Weg zeigen + Messung mit Sinus
  mupi-ton.py --nur-weg  nur zeigen, was eingestellt ist (spielt nichts)
  mupi-ton.py --sek 10   laenger messen (Vorgabe 6 s)
  mupi-ton.py --leise    Signal leiser (Vorgabe 0.25 der Vollaussteuerung)
"""

import argparse
import math
import os
import struct
import subprocess
import sys
import time
import wave

HZ = 440.0
RATE = 48000
KANAELE = 2

GRUEN = "\033[32m"
ROT = "\033[31m"
GELB = "\033[33m"
GRAU = "\033[90m"
AUS = "\033[0m"


def lauf(befehl, zeit=20):
    """Ein Programm aufrufen und seine Ausgabe holen. Fehler sind hier normal."""
    try:
        p = subprocess.run(befehl, shell=True, capture_output=True, text=True, timeout=zeit)
        return p.stdout.strip()
    except Exception:
        return ""


def umgebung():
    # Ohne diese Variable findet pactl den Tonserver des Benutzers nicht.
    os.environ.setdefault("XDG_RUNTIME_DIR", "/run/user/1000")


def weg_zeigen():
    """Was ist eingestellt? Ohne das ist jede Messung nicht einzuordnen."""
    print("\nTONWEG")
    print("─" * 62)
    ziel = lauf("pactl get-default-sink").splitlines()
    ziel = [z for z in ziel if not z.startswith("Failed")]
    ziel = ziel[-1] if ziel else ""
    print(f"  Ausgang           {ziel or '(unbekannt)'}")

    for zeile in lauf("pactl list sinks short").splitlines():
        if zeile.startswith("Failed"):
            continue
        teile = zeile.split("\t")
        if len(teile) >= 5 and teile[1] == ziel:
            print(f"  Format            {teile[3]}")
            print(f"  Zustand           {teile[4]}")

    per_bt = ziel.startswith("bluez_output")
    print(f"  Ueber Bluetooth   {'ja' if per_bt else 'nein'}")

    if per_bt:
        # Der Codec entscheidet ueber die Datenmenge auf der Funkstrecke und
        # ist der haeufigste Grund fuer Aussetzer - SBC bricht frueher ein.
        codec = ""
        # Die Eigenschaft haengt am AUSGANG, nicht an der Karte - dort stand
        # zuerst gesucht und nichts gefunden.
        karte = lauf("pactl list sinks")
        for zeile in karte.splitlines():
            z = zeile.strip()
            if z.startswith("api.bluez5.codec"):
                codec = z.split("=", 1)[-1].strip().strip('"')
        print(f"  Codec             {codec or '(nicht gemeldet)'}")

        adr = ziel.replace("bluez_output.", "").split(".")[0].replace("_", ":")
        info = lauf(f"bluetoothctl info {adr}")
        for schluessel in ("Name:", "Connected:"):
            for zeile in info.splitlines():
                if schluessel in zeile:
                    print(f"  {zeile.strip()}")
        adapter_zeigen(adr)
    return ziel, per_bt


def adapter_zeigen(adr):
    """WELCHER Bluetooth-Adapter traegt den Ton - und taugt er dafuer?

    WARUM DAS HIER STEHT (am Geraet gefunden, 2026-07-28): die Box hat ZWEI
    Adapter - den eingebauten des Pi und einen USB-Stick. Der Ton lief ueber
    den STICK, und der meldet eine ACL-MTU von 310 Byte bei 10 Puffern, wo der
    eingebaute 1021 Byte hat. Kleine Pakete bedeuten mehr Funkverkehr fuer
    dieselbe Musik; genau daran bricht A2DP als Erstes. Ohne diese Zeilen sucht
    man den Fehler bei der Musik, obwohl er an der Steckverbindung haengt.
    """
    print("\n  Bluetooth-Adapter")
    text = lauf("hciconfig -a")
    jetzt, adapter = None, {}
    for zeile in text.splitlines():
        z = zeile.strip()
        if zeile.startswith("hci"):
            jetzt = zeile.split(":")[0]
            adapter[jetzt] = {"bus": "", "mtu": "", "puffer": ""}
            if "Bus:" in zeile:
                adapter[jetzt]["bus"] = zeile.split("Bus:")[-1].strip()
        elif jetzt and "ACL MTU:" in z:
            teil = z.split("ACL MTU:")[-1].split()[0]
            adapter[jetzt]["mtu"], _, adapter[jetzt]["puffer"] = teil.partition(":")

    traeger = ""
    for h in adapter:
        if adr.upper() in lauf(f"hcitool -i {h} con").upper():
            traeger = h

    for h, d in adapter.items():
        marke = "  <- traegt den Ton" if h == traeger else ""
        print(f"    {h}  {d['bus']:<8} ACL-MTU {d['mtu'] or '?'} Byte, {d['puffer'] or '?'} Puffer{marke}")

    if traeger:
        lq = lauf(f"hcitool -i {traeger} lq {adr}").split(":")[-1].strip()
        # 0 heisst bei vielen Adaptern "nicht gemeldet", nicht "miserabel".
        # Als "0 von 255" sah das aus wie ein Befund - und war keiner.
        if lq and lq.isdigit() and int(lq) > 0:
            print(f"    Verbindungsguete {lq} von 255")
        else:
            print(f"    Verbindungsguete {GRAU}meldet dieser Adapter nicht{AUS}")
        mtu = adapter.get(traeger, {}).get("mtu") or "0"
        beste = max((int(d["mtu"]) for d in adapter.values() if d["mtu"].isdigit()), default=0)
        if mtu.isdigit() and beste > int(mtu):
            print(f"    {GELB}Ein anderer Adapter kann groessere Pakete ({beste} statt {mtu} Byte).{AUS}")
            print(f"    {GELB}Das ist der erste Verdaechtige bei Aussetzern.{AUS}")


def xruns():
    """Zaehler fuer Aussetzer im Tonserver. Steigt er waehrend der Messung,
    kam PipeWire nicht rechtzeitig hinterher - dann liegt es NICHT am Funk."""
    text = lauf("pw-top -b -n 1", zeit=15)
    summe = 0
    for zeile in text.splitlines():
        teile = zeile.split()
        # Spalte "ERR" im Kopf finden waere sauberer; pw-top gibt sie aber je
        # nach Fassung anders aus. Robuster: die letzte Zahl vor dem Namen.
        if len(teile) > 8 and teile[0].isdigit():
            try:
                summe += int(teile[7])
            except (ValueError, IndexError):
                pass
    return summe


def sinus_schreiben(pfad, sekunden, pegel):
    """Ein Signal, das wir GENAU kennen - darin ist jeder Sprung ein Fehler."""
    n = int(RATE * sekunden)
    voll = int(32767 * pegel)
    daten = bytearray()
    for i in range(n):
        w = int(voll * math.sin(2 * math.pi * HZ * i / RATE))
        daten += struct.pack("<hh", w, w)
    with wave.open(pfad, "wb") as f:
        f.setnchannels(KANAELE)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(bytes(daten))


def spielt_schon():
    """Laeuft gerade etwas anderes auf dem Ausgang?

    DER GRUND (zweimal falscher Alarm, 2026-07-28): der Monitor traegt ALLES,
    was zum Ausgang geht - nicht nur unser Signal. Lief nebenher Musik, mass
    das Werkzeug die MISCHUNG aus Sinus und Musik. Jede Note der Musik ist
    dann ein "Sprung", und es meldete 41849 Knackser bei einer voellig
    gesunden Anlage. Ein Werkzeug, das falschen Alarm schlaegt, ist schlimmer
    als keins - deshalb wird jetzt vorher nachgesehen.
    """
    text = lauf("pactl list sink-inputs")
    laeuft = []
    name, offen = "", False
    for zeile in text.splitlines():
        z = zeile.strip()
        if z.startswith("Sink Input"):
            if offen and name:
                laeuft.append(name)
            name, offen = "", False
        elif z.startswith("Corked:"):
            offen = z.endswith("no")
        elif "application.name" in z:
            name = z.split("=", 1)[-1].strip().strip('"')
    if offen and name:
        laeuft.append(name)

    # AUSNAHME librespot: es haelt seinen Datenstrom auch im PAUSENZUSTAND
    # offen und unkorkiert - ein offener Ausgang beweist bei ihm also nichts.
    # (Genau deshalb misst der Waechter das Symptom und nicht den Prozess.)
    # Der verlaessliche Zustand steht in /tmp/playerstate, wohin der
    # Wiedergabedienst 'play'/'pause' schreibt - fuer BEIDE Tonmaschinen.
    try:
        with open("/tmp/playerstate") as f:
            pausiert = f.read().strip() != "play"
    except OSError:
        pausiert = False
    if pausiert:
        laeuft = [n for n in laeuft if "librespot" not in n.lower() and "mpv" not in n.lower()]
    return laeuft


def lautsprecher_da(ziel):
    """Ist der Lautsprecher ueberhaupt erreichbar?

    DER GRUND (selbst hereingefallen, 2026-07-28): der Lautsprecher war
    AUSGESCHALTET. bluetoothctl meldete trotzdem noch "Connected: yes", und
    eine Momentaufnahme kurz davor zeigte eine aktive Uebertragung mit
    fliessenden Daten. Erst das Systemprotokoll verriet es -
    "nicht erreichbar (aus?)". Wer nur EINMAL vorher hinsieht, misst gegen ein
    Geraet, das mitten in der Messung verschwindet, und sucht den Fehler
    danach in der Anlage.

    Geprueft wird der Zustand der A2DP-Uebertragung. Ist sie nicht "active",
    kommt am Lautsprecher nichts an, egal wie sauber PipeWire liefert.
    """
    adr = ziel.replace("bluez_output.", "").split(".")[0]
    baum = lauf(f"busctl tree org.bluez", zeit=10)
    pfad = ""
    for zeile in baum.splitlines():
        z = zeile.strip().lstrip("│├└─ ")
        if adr in z and "/fd" in z:
            pfad = z
            break
    if not pfad:
        return False, "keine Uebertragung - der Lautsprecher ist aus oder ausser Reichweite"
    text = lauf(
        f"dbus-send --system --print-reply --dest=org.bluez {pfad} "
        "org.freedesktop.DBus.Properties.GetAll string:org.bluez.MediaTransport1",
        zeit=10,
    )
    if '"active"' in text:
        return True, ""
    if '"idle"' in text:
        return False, "Uebertragung im Leerlauf - es wird gerade nichts gesendet"
    return False, "Zustand der Uebertragung unklar"


def messen(ziel, sekunden, pegel):
    import numpy as np

    if ziel.startswith("bluez_output"):
        da, warum = lautsprecher_da(ziel)
        if not da:
            print(f"\n  {ROT}Der Lautsprecher antwortet nicht:{AUS} {warum}")
            print("  Erst einschalten und in Reichweite bringen, dann messen.")
            return None

    andere = spielt_schon()
    if andere:
        print(f"\n  {ROT}Es laeuft schon etwas:{AUS} {', '.join(andere)}")
        print("  Der Monitor traegt ALLES, was zum Ausgang geht. Waehrend Musik")
        print("  laeuft, wuerde hier die Mischung gemessen und jede Note als")
        print("  Knacken gezaehlt. Erst die Wiedergabe anhalten, dann messen.")
        return None

    signal = "/tmp/mupi-ton-signal.wav"
    mitschrift = "/tmp/mupi-ton-mitschrift.wav"
    sinus_schreiben(signal, sekunden, pegel)

    print("\nMESSUNG")
    print("─" * 62)
    print(f"  Signal            {HZ:.0f} Hz Sinus, {sekunden} s, Pegel {pegel}")

    vorher = xruns()

    # Erst das Mitlesen starten, dann spielen - sonst fehlt der Anfang.
    lesen = subprocess.Popen(
        [
            "parec", f"--device={ziel}.monitor",
            "--format=s16le", f"--rate={RATE}", f"--channels={KANAELE}",
            "--file-format=wav", mitschrift,
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    # Der Bluetooth-Ausgang haelt einen betraechtlichen Puffer. paplay ist
    # fertig, sobald der Tonserver alles hat - gespielt wird dann noch. Wer
    # hier zu frueh aufhoert mitzulesen, misst seinen EIGENEN Fensterschnitt
    # und haelt ihn fuer einen Fehler der Box. Genau das ist beim ersten Lauf
    # passiert (6,6 s von 8 s "verloren", ohne eine einzige Luecke im Inneren).
    time.sleep(1.0)
    subprocess.run(["paplay", signal], capture_output=True, timeout=sekunden + 30)
    time.sleep(2.5)
    lesen.terminate()
    try:
        lesen.wait(timeout=5)
    except subprocess.TimeoutExpired:
        lesen.kill()

    nachher = xruns()

    # NACH der Messung noch einmal nachsehen. Verschwindet der Lautsprecher
    # mittendrin (ausgeschaltet, aus der Reichweite getragen), ist die
    # Mitschrift wertlos - und ohne diese zweite Frage sucht man den Fehler
    # anschliessend in der Anlage statt am Geraet.
    if ziel.startswith("bluez_output"):
        da, warum = lautsprecher_da(ziel)
        if not da:
            print(f"\n  {ROT}Der Lautsprecher ist WAEHREND der Messung verschwunden:{AUS} {warum}")
            print("  Die Mitschrift sagt darum nichts ueber die Tonqualitaet.")
            return None

    if not os.path.exists(mitschrift) or os.path.getsize(mitschrift) < 1000:
        fehler = (lesen.stderr.read().decode() if lesen.stderr else "")[:200]
        print(f"  {ROT}Mitlesen fehlgeschlagen{AUS} — {fehler or 'keine Mitschrift entstanden'}")
        return None

    with wave.open(mitschrift, "rb") as f:
        roh = f.readframes(f.getnframes())
    x = np.frombuffer(roh, dtype="<i2").astype(np.float32)
    if KANAELE == 2:
        x = x.reshape(-1, 2)[:, 0]
    x /= 32768.0

    # Nur den Teil ansehen, in dem wirklich etwas lief - Stille davor und
    # danach ist kein Fehler, sondern der Rand der Aufnahme.
    laut = np.abs(x) > (pegel * 0.15)
    if not laut.any():
        print(f"  {ROT}Nichts angekommen{AUS} — auf dem Ausgang war kein Ton zu lesen.")
        return None
    a, b = int(np.argmax(laut)), int(len(laut) - np.argmax(laut[::-1]))
    kern = x[a:b]
    dauer = len(kern) / RATE
    print(f"  Mitgelesen        {dauer:.2f} s von {sekunden} s")

    # Ein 440-Hz-Sinus kann sich je Ton hoechstens um diesen Betrag aendern.
    # Alles darueber ist ein Sprung, und ein Sprung IST das Knacken.
    grenze = pegel * 2 * math.pi * HZ / RATE
    d = np.abs(np.diff(kern))
    spruenge = int((d > grenze * 3).sum())

    # Luecken: eine Reihe von Nullen mitten im Ton. Ab 1 ms hoert man sie.
    still = np.abs(kern) < 0.002
    luecken, laenge, laengste = 0, 0, 0
    mindest = int(RATE * 0.001)
    for s in still:
        if s:
            laenge += 1
        else:
            if laenge >= mindest:
                luecken += 1
                laengste = max(laengste, laenge)
            laenge = 0
    if laenge >= mindest:
        luecken += 1
        laengste = max(laengste, laenge)

    print(f"  Spruenge (Knacks) {spruenge}")
    print(f"  Luecken (Stille)  {luecken}" + (f", laengste {laengste/RATE*1000:.1f} ms" if luecken else ""))
    print(f"  Aussetzer PipeWire {nachher - vorher}" + (f" {GRAU}(vorher {vorher}){AUS}" if vorher else ""))

    return {"spruenge": spruenge, "luecken": luecken, "xruns": nachher - vorher, "dauer": dauer, "soll": sekunden}


def urteil(m, per_bt):
    print("\nURTEIL")
    print("─" * 62)
    if m is None:
        print(f"  {GELB}Keine Messung moeglich.{AUS} Ohne Mitschrift laesst sich nichts trennen.")
        return 2

    schmutzig = m["spruenge"] > 0 or m["luecken"] > 0 or m["xruns"] > 0
    # Fehlt am Rand etwas, OHNE dass im Inneren eine Luecke war, dann hat das
    # Messfenster geschnitten und nicht die Box. Nur ein grosser Verlust ODER
    # ein Verlust MIT Luecken ist ein echter Befund.
    fehlt = m["soll"] - m["dauer"]
    kurz = fehlt > m["soll"] * 0.25 and m["luecken"] > 0

    if not schmutzig and not kurz:
        print(f"  {GRUEN}Was PipeWire hinausschickt, ist sauber.{AUS}")
        if fehlt > 0.4:
            print(f"  {GRAU}({fehlt:.1f} s fehlen am Rand der Mitschrift - das ist das")
            print(f"   Messfenster, nicht die Box: im Inneren war keine einzige Luecke.){AUS}")
        if per_bt:
            print("  Hoerbare Aussetzer entstehen dann HINTER PipeWire, also auf der")
            print("  Bluetooth-Strecke. Naechste Schritte in dieser Reihenfolge:")
            # Der Vergleich ueber einen anderen Ausgang ist der beste Beweis -
            # aber nur, wenn dort ueberhaupt ein Lautsprecher haengt. Diese Box
            # hat keinen eingebauten; der Rat waere ins Leere gegangen.
            if "alsa_output" in lauf("pactl list sinks short"):
                print("    0. Falls am Klinken-/HAT-Ausgang ein Lautsprecher haengt:")
                print("       dort zum Vergleich hoeren. Knackt es NICHT, ist der Funk")
                print(f"       bestaetigt. {GRAU}(Ohne angeschlossenen Lautsprecher entfaellt das.){AUS}")
            print("    1. Den ADAPTER ansehen (oben). Traegt ein USB-Stick mit kleiner")
            print("       ACL-MTU den Ton, waehrend ein besserer daneben steckt, ist das")
            print("       die wahrscheinlichste Ursache - noch vor dem Codec.")
            print("    2. Codec ansehen. SBC bricht am ehesten ein, aptX braucht Bandbreite.")
            print("    3. WLAN-Band pruefen: liegt es auf 2,4 GHz, stoert es den Funk.")
            print("    4. Abstand und Hindernisse zwischen Box und Lautsprecher.")
        else:
            print("  Der Ausgang ist nicht Bluetooth; hoerbare Aussetzer waeren dann")
            print("  eher am Verstaerker oder an der Verkabelung zu suchen.")
        return 0

    print(f"  {ROT}Schon vor dem Ausgang ist der Ton nicht sauber.{AUS}")
    if m["xruns"] > 0:
        print(f"  {m['xruns']} Aussetzer im Tonserver: PipeWire kam nicht rechtzeitig")
        print("  hinterher. Das ist Rechenzeit oder ein zu kleiner Puffer - NICHT der Funk.")
    if m["spruenge"]:
        print(f"  {m['spruenge']} Spruenge im Signal: dort knackt es hoerbar.")
    if m["luecken"]:
        print(f"  {m['luecken']} Luecken: der Ton setzte kurz ganz aus.")
    if kurz:
        print(f"  Nur {m['dauer']:.1f} s von {m['soll']} s angekommen - es fehlt ein Stueck.")
    print("  Weil das Signal aus einer LOKALEN Datei kam, ist ein Zuspieler aus")
    print("  dem Netz (Spotify, Jellyfin) als Ursache ausgeschlossen.")
    return 1


def main():
    p = argparse.ArgumentParser(add_help=True, description="Tonweg messen")
    p.add_argument("--nur-weg", action="store_true", help="nur zeigen, nichts spielen")
    p.add_argument("--sek", type=int, default=6, help="Messdauer in Sekunden")
    p.add_argument("--leise", action="store_true", help="leiser messen")
    a = p.parse_args()

    umgebung()
    ziel, per_bt = weg_zeigen()
    if a.nur_weg:
        return 0
    if not ziel:
        print(f"\n  {ROT}Kein Ausgang gefunden.{AUS}")
        return 2
    m = messen(ziel, a.sek, 0.1 if a.leise else 0.25)
    return urteil(m, per_bt)


if __name__ == "__main__":
    sys.exit(main())
