#!/usr/bin/env python3
"""Vermisst Netz-Abrisse einer Box: War sie eingefroren oder nur vom Funk?

WOZU (Muster: DIE BOX IST WEG, ABER KEINER WEISS WIE)
Am 15.08.2026 riss die MixPiBox fuenfmal fuer Minuten vom Netz ab (kein Ping,
"No route to host"), ohne Neustart. Der erste Verdacht — WLAN-Powersave, siehe
Wiki mupi-wifi-powersave — war am Geraet bereits BEHOBEN (power_save off,
Dienst aktiv). Die Ursache musste also woanders liegen, und das Journal ist
voller sudo-Zeilen der eigenen Oberflaeche (alle ~30 s wpa_cli/iwconfig), die
jede Handsuche ersticken. Genau dieser Poll-Laerm ist aber ein HERZSCHLAG:
Reisst er ab, stand die ganze Box; laeuft er durch, war nur das Netz weg.

Das Werkzeug holt in EINEM SSH-Zugriff alles Fluechtige (Journal, Akku-
verlauf, Bluetooth, Throttle) auf den Entwicklungsrechner und wertet lokal
aus — die Box darf danach ruhig wieder abreissen.

    python3 tools/netzabriss-diagnose.py                  # holen + auswerten
    python3 tools/netzabriss-diagnose.py --seit "2026-08-15 15:30"
    python3 tools/netzabriss-diagnose.py --nur-auswerten  # ohne Box, aus Ablage
    python3 tools/netzabriss-diagnose.py --wache          # Ping-Wache von aussen
    python3 tools/netzabriss-diagnose.py --sonde          # Logger AUF der Box

Die Sonde ist fuer die Frage, die das Journal nicht beantwortet: WIE war das
Funksignal, als die Box unerreichbar wurde? Sie schreibt alle 5 s Signal,
Gateway-Ping (aus Box-Sicht!) und IBAT nach /home/dietpi/netzabriss/sonde.log auf der
Box; der naechste normale Lauf holt die Datei mit und wertet sie aus. Kein
Dienst, kein Neustart-Ueberleben — eine Messkampagne, kein Einbau.

WAS ES NICHT TUT
Es aendert nichts an der Box (nur lesend). Es liefert keine Funk-Historie —
Signalstaerke gibt es nur fuer JETZT, rueckwirkend steht sie nirgends. Die
Wache misst vom Entwicklungsrechner aus: haengt DER am WLAN, faerbt dessen
eigener Funk die Messung (erst gegen das Gateway pruefen).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import time
from pathlib import Path

BOX_VORGABE = "dietpi@192.168.178.57"  # MixPiBox; MuPiBox ist .169
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6"]

# Ein SSH-Zugriff sammelt alles ein und schiebt es als tar durch stdout.
# sudo -n: die Journale brauchen root (dietpi ist nicht in systemd-journal).
HOL_SKRIPT = r"""
set -e
A=/tmp/netzabriss-daten
rm -rf "$A"; mkdir -p "$A"
sudo -n journalctl -b --no-pager -o short-iso --since "__SEIT__" > "$A/journal.txt"
sudo -n journalctl -b --no-pager -o short-iso _COMM=wpa_supplicant > "$A/wpa.txt" || true
sudo -n journalctl -b -k --no-pager -o short-iso > "$A/kernel.txt" || true
sudo -n journalctl -b --no-pager -o short-iso -u bluetooth > "$A/bluetooth.txt" || true
cp /tmp/mupihat.json "$A/mupihat.json" 2>/dev/null || true
AV=$(find /home/dietpi -maxdepth 5 -name akkuverlauf.json 2>/dev/null | head -1)
[ -n "$AV" ] && cp "$AV" "$A/akkuverlauf.json" || true
/usr/sbin/iw dev wlan0 link > "$A/link.txt" 2>&1 || true
/usr/sbin/iw dev wlan0 get power_save >> "$A/link.txt" 2>&1 || true
sudo -n vcgencmd get_throttled > "$A/throttled.txt" 2>&1 || true
vcgencmd measure_temp >> "$A/throttled.txt" 2>&1 || true
hciconfig -a > "$A/bt-adapter.txt" 2>&1 || true
ps aux | grep -E "mpv|librespot|bluetoothd" | grep -v grep > "$A/prozesse.txt" || true
ip -br addr > "$A/ip.txt" 2>&1 || true
for d in wifi-powersave-off dietpi-wifi-monitor mupi_autoconnect-wifi mupi_wifi; do
  printf "%s: %s\n" "$d" "$(systemctl is-active $d 2>&1)" >> "$A/dienste.txt"
done
cp /home/dietpi/netzabriss/sonde.log "$A/sonde.log" 2>/dev/null || true
tar -C /tmp -cf - netzabriss-daten
"""

# Laeuft per nohup auf der Box weiter, wenn SSH laengst tot ist. Schreibt nach
# /tmp (RAM-Disk): ueberlebt den Abriss, nicht den Neustart — das reicht, denn
# gemessen wird ja gerade, dass die Box NICHT neu startet.
SONDE_SKRIPT = r"""
if [ -f /tmp/netzabriss-sonde.pid ] && kill -0 "$(cat /tmp/netzabriss-sonde.pid)" 2>/dev/null; then
  echo "Sonde laeuft schon (PID $(cat /tmp/netzabriss-sonde.pid))"; exit 0
fi
nohup sh -c 'while :; do
  s=$(/usr/sbin/iw dev wlan0 link 2>/dev/null | grep -o "signal: -[0-9]*" | grep -o -- "-[0-9]*")
  i=$(grep -o "\"Ibat\": -\{0,1\}[0-9]*" /tmp/mupihat.json 2>/dev/null | grep -o -- "-\{0,1\}[0-9]*$")
  if ping -c1 -W1 __GW__ >/dev/null 2>&1; then g=ok; else g=WEG; fi
  echo "$(date -Is) signal=${s:-?} gw=$g ibat=${i:-?}"
  sleep 5
done >> /home/dietpi/netzabriss/sonde.log' >/dev/null 2>&1 &
echo $! > /tmp/netzabriss-sonde.pid
echo "Sonde gestartet (PID $(cat /tmp/netzabriss-sonde.pid)) -> /home/dietpi/netzabriss/sonde.log"
"""

# journalctl -o short-iso schreibt die Zone je nach systemd-Version mit oder
# ohne Doppelpunkt (+0200 vs +02:00). Der erste Wurf kannte nur +0200 und hat
# damit JEDE Zeile verworfen — "keine Luecken" war ein Parse-Ausfall, kein
# Befund. Deshalb beide Formen, und auswerten() weigert sich bei 0 Treffern.
ZEIT_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})")


def zeit(zeile: str) -> dt.datetime | None:
    m = ZEIT_RE.match(zeile)
    if not m:
        return None
    return dt.datetime.strptime(
        m.group(1) + m.group(2) + m.group(3), "%Y-%m-%dT%H:%M:%S%z")


def holen(box: str, seit: str, ablage: Path) -> None:
    ablage.mkdir(parents=True, exist_ok=True)
    skript = HOL_SKRIPT.replace("__SEIT__", seit)
    with (ablage / "daten.tar").open("wb") as f:
        lauf = subprocess.run(SSH + [box, skript], stdout=f, stderr=subprocess.PIPE)
    if lauf.returncode != 0:
        sys.stderr.write(lauf.stderr.decode(errors="replace"))
        sys.exit(f"Einsammeln fehlgeschlagen (Box {box} erreichbar?)")
    subprocess.run(["tar", "-xf", "daten.tar", "--strip-components=1"],
                   cwd=ablage, check=True)
    print(f"Daten liegen in {ablage}")


def herzschlag_luecken(journal: Path, schwelle_s: int) -> tuple[list[tuple[dt.datetime, dt.datetime]], int]:
    """Luecken im Journal. Oberflaeche (sudo, ~30 s) und MuPiHAT-Logger (~5 s)
    schlagen staendig — laenger als schwelle_s ohne EINE Zeile heisst: die Box
    hat nichts mehr getan. Liefert (luecken, anzahl_gelesener_zeitstempel)."""
    luecken = []
    vorher = None
    gelesen = 0
    for zeile in journal.read_text(errors="replace").splitlines():
        t = zeit(zeile)
        if t is None:
            continue
        gelesen += 1
        if vorher and (t - vorher).total_seconds() > schwelle_s:
            luecken.append((vorher, t))
        vorher = t
    return luecken, gelesen


def zeilen_im_fenster(datei: Path, seit: dt.datetime, muster: str | None = None) -> list[str]:
    if not datei.exists():
        return []
    r = re.compile(muster, re.I) if muster else None
    treffer = []
    for zeile in datei.read_text(errors="replace").splitlines():
        t = zeit(zeile)
        if t is None or t < seit:
            continue
        if r is None or r.search(zeile):
            treffer.append(zeile)
    return treffer


def akku_bei(ablage: Path, wann: dt.datetime) -> str:
    """Naechster Punkt aus akkuverlauf.json: i < 0 heisst Entladen (Akku)."""
    datei = ablage / "akkuverlauf.json"
    if not datei.exists():
        return "keine akkuverlauf.json"
    try:
        punkte = json.loads(datei.read_text())
    except ValueError:
        return "akkuverlauf.json unlesbar"
    ziel = wann.timestamp() * 1000
    nah = min(punkte, key=lambda p: abs(p.get("t", 0) - ziel), default=None)
    if not nah:
        return "leer"
    abstand = abs(nah["t"] - ziel) / 1000
    lage = "AKKU (entlaedt)" if nah.get("i", 0) < 0 else "Netzteil/laedt"
    return f"{lage}  i={nah.get('i')} v={nah.get('v')} p={nah.get('p')}% ({abstand:.0f} s daneben)"


IBAT_RE = re.compile(r"IBAT \[mA\]: (-?\d+)")


def akku_fenster(journal: Path) -> list[str]:
    """Der MuPiHAT-Dienst loggt alle ~5 s IBAT ins Journal. Daraus die
    Wechsel zwischen Entladen (IBAT < 0, Akkubetrieb) und Laden/Netz."""
    fenster = []
    lage = None
    for zeile in journal.read_text(errors="replace").splitlines():
        m = IBAT_RE.search(zeile)
        if not m:
            continue
        t = zeit(zeile)
        neu = "AKKU" if int(m.group(1)) < 0 else "NETZ"
        if neu != lage and t is not None:
            fenster.append(f"{t:%H:%M:%S}  ab hier {neu}")
            lage = neu
    return fenster


SONDE_RE = re.compile(r"signal=(-?\d+|\?) gw=(ok|WEG) ibat=(-?\d+|\?)")


def sonde_auswerten(ablage: Path, seit: dt.datetime) -> list[str]:
    """WEG-Fenster aus der Sonde: wann sah die BOX ihr Gateway nicht, und wie
    stark war ihr Funksignal dabei? Das scheidet 'ausser Reichweite' (Signal
    bricht ein) von 'Funk gut, trotzdem taub' (Signal bleibt, gw=WEG)."""
    datei = ablage / "sonde.log"
    if not datei.exists():
        return []
    zeilen = []
    fenster_von = None
    signale: list[int] = []
    letzte = None
    for zeile in datei.read_text(errors="replace").splitlines():
        t = zeit(zeile)
        m = SONDE_RE.search(zeile)
        if t is None or m is None or t < seit:
            continue
        sig, gw, ibat = m.groups()
        if gw == "WEG" and fenster_von is None:
            fenster_von = t
            signale = []
        if gw == "WEG" and sig != "?":
            signale.append(int(sig))
        if gw == "ok" and fenster_von is not None:
            dauer = (t - fenster_von).total_seconds()
            lage = "AKKU" if ibat != "?" and int(ibat) < 0 else "Netz/laedt"
            spanne = (f"Signal {min(signale)}..{max(signale)} dBm"
                      if signale else "Signal unlesbar")
            zeilen.append(f"{fenster_von:%H:%M:%S} - {t:%H:%M:%S}  ({dauer:.0f} s)  "
                          f"{spanne}, danach {sig} dBm, {lage}")
            fenster_von = None
        letzte = t
    if fenster_von is not None and letzte is not None:
        zeilen.append(f"{fenster_von:%H:%M:%S} - offen (bis Sondenende {letzte:%H:%M:%S})")
    return zeilen


def auswerten(ablage: Path, seit: dt.datetime, schwelle_s: int) -> None:
    print("=== Momentaufnahme (beim Einsammeln) ===")
    for name in ("link.txt", "throttled.txt", "dienste.txt", "prozesse.txt"):
        p = ablage / name
        if p.exists():
            print(f"-- {name} --")
            print(p.read_text(errors="replace").strip() or "(leer)")
    print()

    print(f"=== Herzschlag-Luecken im Journal (> {schwelle_s} s) ===")
    luecken, gelesen = herzschlag_luecken(ablage / "journal.txt", schwelle_s)
    if gelesen == 0:
        sys.exit("FEHLER: kein einziger Zeitstempel gelesen — Format ansehen, "
                 "nicht 'keine Luecken' glauben.")
    print(f"({gelesen} Zeitstempel gelesen)")
    if not luecken:
        print("KEINE — die Box lief durchgehend; Abrisse waren reine Netz-Abrisse.")
    for von, bis in luecken:
        dauer = (bis - von).total_seconds()
        print(f"{von:%H:%M:%S} - {bis:%H:%M:%S}  ({dauer:.0f} s)  Akku dabei: {akku_bei(ablage, von)}")
    print()

    print("=== Akku-/Netzfenster (IBAT aus dem MuPiHAT-Journal) ===")
    fw = akku_fenster(ablage / "journal.txt")
    print("\n".join(fw) if fw else "keine IBAT-Zeilen (Box ohne MuPiHAT-Logger?)")
    print()

    print("=== Bluetooth-Lautsprecher-Verbindungen (Kernel: input ... AVRCP) ===")
    bt_verb = zeilen_im_fenster(ablage / "kernel.txt", seit, r"input:.*AVRCP")
    print("\n".join(bt_verb) if bt_verb else "keine — kein Lautsprecher (neu) verbunden.")
    print()

    print("=== Sonde: Gateway-WEG-Fenster aus Box-Sicht ===")
    sf = sonde_auswerten(ablage, seit)
    if sf:
        print("\n".join(sf))
    else:
        print("keine Sondendaten (Sonde nicht gestartet oder kein WEG-Fenster).")
    print()

    print("=== wpa_supplicant im Fenster ===")
    wpa = zeilen_im_fenster(ablage / "wpa.txt", seit)
    print("\n".join(wpa) if wpa else "keine Zeilen — kein Disconnect/Roaming aus Sicht des Supplicants.")
    print()

    print("=== Kernel (wlan/brcmfmac/Spannung) im Fenster ===")
    kern = zeilen_im_fenster(ablage / "kernel.txt", seit,
                             r"wlan|brcmfmac|ieee80211|voltage|undervolt|throttl")
    print("\n".join(kern) if kern else "keine Zeilen — kein Treiber-/Firmwarefehler, keine Unterspannung.")
    print()

    print("=== Bluetooth im Fenster ===")
    bt = zeilen_im_fenster(ablage / "bluetooth.txt", seit)
    print("\n".join(bt[-30:]) if bt else "keine Zeilen.")


def wache(box: str, ablage: Path, gateway: str) -> None:
    """Ping-Wache von aussen: schreibt NUR Zustandswechsel mit Zeitstempel.
    Sie pingt IMMER auch das Gateway mit — haengt der Messrechner selbst am
    WLAN, saehe ein eigener Funkabriss sonst genauso aus wie einer der Box.
    GW:WEG in derselben Zeile heisst: der Messung nicht trauen."""
    ziel = box.split("@")[-1]
    ablage.mkdir(parents=True, exist_ok=True)
    protokoll = ablage / "wache.log"
    zustand = None
    fehlschlaege = 0
    print(f"Wache auf {ziel} (Vergleich: {gateway}), Wechsel -> {protokoll}")
    while True:
        ok = subprocess.run(["ping", "-c", "1", "-W", "2", ziel],
                            stdout=subprocess.DEVNULL).returncode == 0
        # EIN verlorener Ping ist keine Messung: am 15.08. kippte die Wache
        # auf einen einzelnen Fehlping (WEG -> DA binnen 37 s), waehrend Box
        # und Messrechner beide am Funk haengen. Erst zwei Fehlpings in Folge
        # (~4 s) gelten als Abriss; zurueck auf DA reicht ein Treffer.
        if not ok:
            fehlschlaege += 1
            if fehlschlaege < 2 and zustand is not False:
                time.sleep(2)
                continue
        else:
            fehlschlaege = 0
        if ok != zustand:
            gw = subprocess.run(["ping", "-c", "1", "-W", "2", gateway],
                                stdout=subprocess.DEVNULL).returncode == 0
            zeile = (f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} "
                     f"{'DA' if ok else 'WEG'}  GW:{'da' if gw else 'WEG'}")
            print(zeile, flush=True)
            with protokoll.open("a") as f:
                f.write(zeile + "\n")
            zustand = ok
        time.sleep(2)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--box", default=BOX_VORGABE)
    p.add_argument("--seit", default=f"{dt.date.today()} 00:00",
                   help="Journal ab hier holen/auswerten (YYYY-MM-DD HH:MM)")
    p.add_argument("--schwelle", type=int, default=90,
                   help="Sekunden ohne Journalzeile = Herzschlag-Luecke")
    p.add_argument("--ablage", type=Path,
                   default=Path("/tmp") / f"netzabriss-{dt.date.today()}")
    p.add_argument("--nur-auswerten", action="store_true",
                   help="nichts holen, vorhandene Ablage auswerten")
    p.add_argument("--wache", action="store_true", help="nur Ping-Wache")
    p.add_argument("--sonde", action="store_true",
                   help="Logger auf der Box starten (Signal/GW/IBAT alle 5 s)")
    p.add_argument("--gateway", default="192.168.178.1",
                   help="Vergleichsziel der Wache und Ziel der Sonde")
    a = p.parse_args()

    if a.wache:
        wache(a.box, a.ablage, a.gateway)
        return
    if a.sonde:
        lauf = subprocess.run(
            SSH + [a.box, SONDE_SKRIPT.replace("__GW__", a.gateway)])
        sys.exit(lauf.returncode)
    if not a.nur_auswerten:
        holen(a.box, a.seit, a.ablage)
    seit = dt.datetime.strptime(a.seit, "%Y-%m-%d %H:%M").astimezone()
    auswerten(a.ablage, seit, a.schwelle)


if __name__ == "__main__":
    main()
