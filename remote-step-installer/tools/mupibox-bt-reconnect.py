#!/usr/bin/env python3
"""
Bluetooth-Lautsprecher von selbst wieder verbinden.

WARUM ES DAS BRAUCHT
BlueZ verbindet bekannte Geraete NICHT von sich aus, wenn sie beim Booten aus
waren und spaeter eingeschaltet werden. Es reagiert nur auf einen Abriss einer
bestehenden Verbindung — und darauf, dass das Geraet SELBST die Verbindung
sucht. Viele Lautsprecher tun das nicht, der hier getestete Xiaomi nicht.
Ergebnis in der Praxis: Box einstecken, Lautsprecher einschalten, und nichts
passiert, bis jemand in der Verwaltung auf „Verbinden" tippt. In einer
Sitzung am Geraet musste das FUENFMAL von Hand gemacht werden.

WAS ES TUT
Im Takt (systemd-Timer) und einmal beim Start: jedes VERTRAUTE Audio-Geraet,
das gerade nicht verbunden ist, einmal anstupsen. Mehr nicht.

WAS ES BEWUSST NICHT TUT
  * Nicht koppeln. Koppeln ist eine bewusste Handlung des Menschen; ein
    Dienst, der von selbst koppelt, ist ein Sicherheitsproblem.
  * Nicht die Tonausgabe umstellen. Unter PipeWire wird ein neu verbundener
    Lautsprecher von selbst Standard-Senke (am Geraet geprueft) — hier
    etwas zu erzwingen, wuerde nur mit PipeWire streiten.
  * Keine Geraete anfassen, die nicht als AUDIO erkennbar sind. Ein
    vertrautes Handy oder eine Fernbedienung geht das nichts an.

VERHAELTNIS ZUR TONWACHE (mupibox-tonwache.py)
Die Wache stammt aus der ALSA-Zeit und schreibt bei Erfolglosigkeit die
Ausgabe auf intern zurueck, damit die Box nicht stumm bleibt. Unter PipeWire
ist das gegenstandslos: ein ausgeschalteter Lautsprecher ist dort einfach
keine Senke, es wird weiter auf der internen gespielt. Wer PipeWire faehrt,
braucht nur DIESES hier.
"""
import argparse
import os
import re
import subprocess
import sys

MAC_RE = re.compile(r"^([0-9A-F]{2}(?::[0-9A-F]{2}){5})$", re.I)


# ── reine Auswertung ──────────────────────────────────────────────────────

def parse_devices(text):
    """`bluetoothctl devices Trusted` -> [(mac, name)]. Pure.

    Zeilen sehen so aus: `Device 00:9E:C8:61:1A:EA 小米蓝牙音箱`.
    Unpassendes wird uebergangen — die Ausgabe enthaelt je nach Fassung auch
    Hinweiszeilen, und daran darf ein Dienst nicht scheitern.
    """
    res = []
    for zeile in (text or "").splitlines():
        teile = zeile.strip().split(None, 2)
        if len(teile) < 2 or teile[0] != "Device":
            continue
        if not MAC_RE.match(teile[1]):
            continue
        res.append((teile[1].upper(), teile[2].strip() if len(teile) > 2 else ""))
    return res


def verbunden(info_text):
    """Aus `bluetoothctl info <MAC>` ablesen, ob es verbunden ist. Pure.

    Am ZUSTAND ablesen, nicht am Rueckgabewert: bluetoothctl endet auch nach
    Fehlern mit 0 (siehe Wiki mupi-bluetooth-skripte-kaputt).
    """
    for zeile in (info_text or "").splitlines():
        s = zeile.strip()
        if s.lower().startswith("connected:"):
            return s.split(":", 1)[1].strip().lower() == "yes"
    return False


def ist_audio(info_text):
    """Ist das ein Lautsprecher/Kopfhoerer? Pure.

    Zwei Anhaltspunkte, weil nicht jedes Geraet beide liefert: das Icon
    (audio-card / audio-headset) und die Dienst-Kennung „Audio Sink".
    """
    t = (info_text or "").lower()
    if re.search(r"^\s*icon:\s*audio", t, re.M):
        return True
    return "audio sink" in t


def bt_spielt(sinks_text):
    """Spielt gerade ein Bluetooth-Lautsprecher? Pure.

    Zeilen von `pactl list short sinks` sehen so aus:
    `158\tbluez_output.00_9E_C8_61_1A_EA.1\tPipeWire\ts16le 2ch 48000Hz\tRUNNING`.
    Es zaehlt nur RUNNING — eine SUSPENDED-Senke stoert niemand.
    """
    for zeile in (sinks_text or "").splitlines():
        if "bluez_output" in zeile and zeile.rstrip().endswith("RUNNING"):
            return True
    return False


def zu_verbinden(geraete, infos):
    """
    Welche Geraete anstupsen? Pure.

    geraete : [(mac, name)] aus `devices Trusted`
    infos   : {mac: info_text}

    Nur Audio, nur nicht-verbundene. Unbekannte Geraete (kein info) werden
    uebergangen: lieber nichts tun als blind verbinden.
    """
    res = []
    for mac, name in geraete:
        info = infos.get(mac)
        if not info:
            continue
        if not ist_audio(info):
            continue
        if verbunden(info):
            continue
        res.append((mac, name))
    return res


# ── Umgebung ──────────────────────────────────────────────────────────────

def sag(*teile):
    print("[bt-reconnect]", *teile, flush=True)


# Der Adapter, den der Mensch in der Verwaltung gewaehlt hat. DIESELBE Datei,
# die das Backend schreibt (BT_WAHL_DATEI in server.ts).
WAHL_DATEI = "/etc/mupibox/bt-adapter"


def gewaehlter_adapter():
    """Die Adresse des gewaehlten Adapters — oder leer, wenn keiner gewaehlt ist."""
    try:
        with open(WAHL_DATEI) as f:
            roh = f.read().strip().upper()
    except OSError:
        return ""
    return roh if MAC_RE.match(roh) else ""


def _btctl(args, frist=25):
    """bluetoothctl aufrufen — auf dem GEWAEHLTEN Adapter.

    WARUM DAS NOETIG IST (nach einem Neustart gemessen, 2026-07-28): die Box
    hat mehrere Adapter. Ohne Auswahl nimmt bluetoothctl seinen eigenen
    Standard, und der ist nach einem Neustart beliebig. So landete der
    Lautsprecher wieder auf einem alten, schwachen USB-Stecker (ACL-MTU 310
    Byte), obwohl in der Verwaltung laengst ein besserer gewaehlt war (1021
    Byte) - mit hoerbaren Aussetzern als Folge. Die Wahl des Menschen zu
    ueberschreiben, weil ein anderes Programm nicht hinsieht, ist der
    unangenehmste Fehler von allen: sie war ja getroffen.

    `select` wirkt nur INNERHALB einer Sitzung, deshalb wird es zusammen mit
    dem eigentlichen Befehl ueber die Eingabe geschickt und nicht als
    Argument (ein Einzelaufruf `bluetoothctl select <mac>` waehlt aus und
    beendet sich sofort wieder).
    """
    wahl = gewaehlter_adapter()
    try:
        if wahl:
            eingabe = "select %s\n%s\nquit\n" % (wahl, " ".join(args))
            r = subprocess.run(
                ["bluetoothctl"], input=eingabe, capture_output=True, text=True, timeout=frist
            )
        else:
            r = subprocess.run(
                ["bluetoothctl", *args], capture_output=True, text=True, timeout=frist
            )
        return (r.stdout or "") + (r.stderr or "")
    except (OSError, subprocess.SubprocessError):
        return ""


# Der Benutzer, dem der Tonserver gehoert — derselbe, den alle Rezepte
# anlegen. Die Skripte des Hauses nehmen ihn ueberall beim Namen.
TON_BENUTZER = "dietpi"


def _pactl_sinks():
    """`pactl list short sinks` des Tonbenutzers — leer, wenn kein PipeWire.

    ALS DER TONBENUTZER, NICHT ALS ROOT (Gegenprobe am Geraet, 15.08.2026):
    pipewire-pulse weist einen fremden Benutzer ohne passenden Cookie ab —
    `sudo pactl` gegen /run/user/1000 gibt rc=1 und NICHTS, und der leere
    Rueckfall unten haette daraus still „nichts spielt" gemacht. Genau so
    lief der erste Einbau wirkungslos durch.

    Leer heisst bewusst „nichts spielt": lieber einmal zu viel anstupsen als
    auf einer Box ohne PipeWire nie wieder.
    """
    befehl = ["pactl", "list", "short", "sinks"]
    if os.geteuid() == 0:
        befehl = ["runuser", "-u", TON_BENUTZER, "--", *befehl]
    try:
        r = subprocess.run(
            befehl,
            capture_output=True,
            text=True,
            timeout=8,
            env={**os.environ, "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000")},
        )
        return r.stdout or ""
    except (OSError, subprocess.SubprocessError):
        return ""


def laufen(argv=None):
    p = argparse.ArgumentParser(description="Vertraute Bluetooth-Lautsprecher wieder verbinden.")
    p.add_argument("--trocken", action="store_true", help="nur zeigen, nichts verbinden")
    p.add_argument("--leise", action="store_true", help="nichts ausgeben, wenn es nichts zu tun gibt")
    # argv=None BEWUSST durchreichen: argparse liest dann sys.argv. Hier stand
    # einmal `[] if argv is None else argv` — das warf beim Aufruf von der
    # Kommandozeile JEDEN Schalter weg, also auch --trocken. Ein Trockenlauf,
    # der in Wahrheit verbindet, ist schlimmer als gar keiner.
    a = p.parse_args(argv)

    geraete = parse_devices(_btctl(["devices", "Trusted"]))
    if not geraete:
        if not a.leise:
            sag("keine vertrauten Geraete")
        return 0

    infos = {mac: _btctl(["info", mac]) for mac, _ in geraete}
    offen = zu_verbinden(geraete, infos)
    if not offen:
        if not a.leise:
            sag("alles verbunden")
        return 0

    # WAEHREND BLUETOOTH SPIELT, WIRD NICHT ANGERUFEN (15.08.2026, am Geraet
    # gemessen): das Anstupsen eines ABWESENDEN Geraets blockiert das Radio
    # rund 5 Sekunden (Paging, btmon: Create Connection -> Connect Complete
    # nach 5,1 s) — auf DEMSELBEN Adapter, ueber den gerade Musik laeuft. Der
    # Betreiber hoerte den Takt dieses Timers als abgehackten Ton, waehrend
    # der PipeWire-Graph fehlerfrei lief. Ein ausgeschalteter Lautsprecher
    # kann warten; verbunden wird im naechsten ruhigen Takt.
    if offen and bt_spielt(_pactl_sinks()):
        if not a.leise:
            sag("Bluetooth spielt gerade — kein Anstupsen, naechster Takt")
        return 0

    for mac, name in offen:
        if a.trocken:
            sag(f"(Trockenlauf) wuerde {name or mac} verbinden")
            continue
        sag(f"verbinde {name or mac}")
        _btctl(["connect", mac], frist=30)
        # Erfolg am ZUSTAND pruefen, nicht am Rueckgabewert.
        if verbunden(_btctl(["info", mac])):
            sag(f"{name or mac}: verbunden")
        else:
            # Kein Fehler: der Lautsprecher ist vermutlich aus. Beim naechsten
            # Durchlauf wieder — deshalb auch kein lautes Gejammer.
            sag(f"{name or mac}: nicht erreichbar (aus?)")
    return 0


if __name__ == "__main__":
    sys.exit(laufen())
