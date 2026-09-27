#!/usr/bin/env python3
"""
Totmannschalter fuer Aenderungen an der WLAN-Konfiguration.

WOZU
Wer das WLAN einer Box aendert, auf die er nur ueber genau dieses WLAN
zugreift, saegt an dem Ast, auf dem er sitzt. Geht die Aenderung schief, ist
die Box weg — und zwar genau dann, wenn niemand mehr etwas dagegen tun kann.

DAS MUSTER dagegen ist alt und bewaehrt (Cisco nennt es `commit confirmed`,
Mikrotik „safe mode"): VOR der Aenderung einen Wecker stellen, der den alten
Zustand wiederherstellt. Bleibt die Box erreichbar, schaltet man den Wecker
ab. Bleibt sie es nicht, kann man es NICHT — und genau dann soll er feuern.

Der Kniff ist, dass die Entwarnung nur ueber eine FUNKTIONIERENDE Verbindung
kommen kann. Sie ist damit kein Knopf, den man aus Versehen drueckt, sondern
ein Beweis.

ABLAUF
    watchdog scharf 120     # sichert die Konfiguration, stellt den Wecker
    …Aenderung…             # z. B. neues Netz eintragen
    watchdog entwarnung     # NUR moeglich, wenn die Box erreichbar blieb
    (sonst: nach 120 s stellt der Wecker den alten Zustand wieder her)

WAS ER BEWUSST NICHT TUT
  * Er stellt NUR die WLAN-Konfiguration zurueck, nichts anderes. Ein
    Watchdog, der „alles" zuruecksetzt, ist unberechenbar — und wer ihn
    fuerchtet, benutzt ihn nicht.
  * Er startet die Box nicht neu. Ein Neustart als Rettung ist ein grosses
    Werkzeug fuer ein kleines Problem und kostet die laufende Wiedergabe.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

STAND_DIR = "/var/lib/mupibox/netzwatch"
MARKER = os.path.join(STAND_DIR, "scharf.json")
SICHERUNG = os.path.join(STAND_DIR, "wpa_supplicant.conf.vor")
WPA_CONF = "/etc/wpa_supplicant/wpa_supplicant.conf"
EINHEIT = "mupibox-netz-rollback"
# Grenzen mit Absicht eng: unter 30 s schafft es kein Mensch zu bestaetigen,
# ueber 30 min ist es kein Sicherheitsnetz mehr, sondern eine Zeitbombe.
FRIST_MIN = 30
FRIST_MAX = 1800


# ── reine Auswertung ──────────────────────────────────────────────────────

def frist_klemmen(sek):
    """Frist auf einen brauchbaren Bereich begrenzen. Pure."""
    try:
        n = int(sek)
    except (TypeError, ValueError):
        return FRIST_MIN
    return max(FRIST_MIN, min(FRIST_MAX, n))


def marker_bauen(jetzt, frist, grund=""):
    """Den Inhalt der Marker-Datei bauen. Pure."""
    f = frist_klemmen(frist)
    return {"scharf_seit": int(jetzt), "frist": f, "faellig": int(jetzt) + f, "grund": str(grund or "")}


def marker_lesen(text):
    """Marker-Datei auswerten. Pure. Unlesbares gilt als „kein Marker".

    Bewusst nachsichtig: ein halb geschriebener Marker darf nicht dazu
    fuehren, dass der Rollback beim naechsten Start auf ewig scheitert.
    """
    try:
        d = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(d, dict):
        return None
    try:
        return {
            "scharf_seit": int(d["scharf_seit"]),
            "frist": int(d["frist"]),
            "faellig": int(d["faellig"]),
            "grund": str(d.get("grund", "")),
        }
    except (KeyError, TypeError, ValueError):
        return None


def restsekunden(marker, jetzt):
    """Wie lange bleibt noch zum Bestaetigen? Pure. None = nicht scharf."""
    if not marker:
        return None
    return max(0, int(marker["faellig"]) - int(jetzt))


def soll_zurueckrollen(marker, jetzt, beim_start=False):
    """
    Jetzt zurueckrollen? Pure.

    Beim START (`beim_start`) IMMER, sobald ein Marker da ist: dass die Box
    neu gestartet ist, ohne dass jemand bestaetigt hat, ist genau der Fall,
    fuer den es den Watchdog gibt — der fluechtige Zeitgeber hat den Neustart
    ja nicht ueberlebt. Sonst zaehlt die Frist.
    """
    if not marker:
        return False
    if beim_start:
        return True
    return int(jetzt) >= int(marker["faellig"])


# ── Umgebung ──────────────────────────────────────────────────────────────

def sag(*teile):
    print("[netz-watchdog]", *teile, flush=True)


def _lauf(args, frist=20):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=frist)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except (OSError, subprocess.SubprocessError) as e:
        return 1, str(e)


def _marker_da():
    try:
        with open(MARKER, "r") as f:
            return marker_lesen(f.read())
    except OSError:
        return None


def wpa_neu_einlesen():
    """Die (wiederhergestellte) Konfiguration uebernehmen.

    `reconfigure` ist der sanfte Weg und reisst eine BESTEHENDE Verbindung
    nicht ab (an der Box geprueft). Nur wenn das scheitert, wird das grobe
    Werkzeug genommen.
    """
    for pfad in ("/sbin/wpa_cli", "/usr/sbin/wpa_cli"):
        rc, aus = _lauf([pfad, "-i", "wlan0", "reconfigure"])
        if rc == 0 and "OK" in aus:
            return True
    rc, _ = _lauf(["systemctl", "restart", "wpa_supplicant"], frist=30)
    return rc == 0


def scharf(frist, grund=""):
    if not os.path.exists(WPA_CONF):
        sag("keine WLAN-Konfiguration gefunden — nichts zu sichern")
        return 1
    os.makedirs(STAND_DIR, mode=0o700, exist_ok=True)
    # Die Sicherung enthaelt das WLAN-Passwort im Klartext — wie das Original.
    shutil.copy2(WPA_CONF, SICHERUNG)
    os.chmod(SICHERUNG, 0o600)
    m = marker_bauen(time.time(), frist, grund)
    with open(MARKER, "w") as f:
        json.dump(m, f)
    os.chmod(MARKER, 0o600)

    # Einen etwaigen alten Wecker abraeumen, sonst feuern zwei.
    _lauf(["systemctl", "stop", f"{EINHEIT}.timer"])
    rc, aus = _lauf([
        "systemd-run", "--quiet", f"--on-active={m['frist']}", f"--unit={EINHEIT}",
        sys.argv[0], "rollback",
    ])
    if rc != 0:
        sag(f"Wecker liess sich nicht stellen: {aus.strip()[:120]}")
        os.remove(MARKER)
        return 1
    sag(f"scharf — ohne Entwarnung wird in {m['frist']} s zurueckgerollt")
    return 0


def entwarnung():
    m = _marker_da()
    _lauf(["systemctl", "stop", f"{EINHEIT}.timer"])
    for p in (MARKER,):
        try:
            os.remove(p)
        except OSError:
            pass
    if not m:
        sag("war nicht scharf — nichts zu tun")
        return 0
    sag("Entwarnung — die Aenderung bleibt")
    return 0


def rollback(beim_start=False):
    m = _marker_da()
    if not soll_zurueckrollen(m, time.time(), beim_start):
        if beim_start:
            sag("kein Marker — nichts zurueckzurollen")
        return 0
    if not os.path.exists(SICHERUNG):
        sag("Marker da, aber keine Sicherung — von Hand nachsehen")
        return 1
    shutil.copy2(SICHERUNG, WPA_CONF)
    os.chmod(WPA_CONF, 0o600)
    try:
        os.remove(MARKER)
    except OSError:
        pass
    ok = wpa_neu_einlesen()
    sag(f"zurueckgerollt auf den Stand vor der Aenderung ({'uebernommen' if ok else 'Uebernahme unklar'})")
    return 0


def stand():
    m = _marker_da()
    rest = restsekunden(m, time.time())
    if rest is None:
        print(json.dumps({"scharf": False}))
        return 0
    print(json.dumps({"scharf": True, "restSek": rest, "frist": m["frist"], "grund": m["grund"]}))
    return 0


def laufen(argv=None):
    p = argparse.ArgumentParser(description="Totmannschalter fuer WLAN-Aenderungen.")
    u = p.add_subparsers(dest="befehl", required=True)
    s = u.add_parser("scharf", help="sichern und Wecker stellen")
    s.add_argument("frist", nargs="?", default=120, help=f"Sekunden ({FRIST_MIN}-{FRIST_MAX})")
    s.add_argument("--grund", default="")
    u.add_parser("entwarnung", help="Wecker abstellen, Aenderung behalten")
    r = u.add_parser("rollback", help="jetzt zuruecksetzen (der Wecker ruft das)")
    r.add_argument("--beim-start", action="store_true")
    u.add_parser("stand", help="Zustand als JSON")
    a = p.parse_args(argv)

    if a.befehl == "scharf":
        return scharf(a.frist, a.grund)
    if a.befehl == "entwarnung":
        return entwarnung()
    if a.befehl == "rollback":
        return rollback(a.beim_start)
    return stand()


if __name__ == "__main__":
    sys.exit(laufen())
