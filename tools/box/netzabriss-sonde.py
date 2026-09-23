#!/usr/bin/env python3
"""Die Netzabriss-Sonde — laeuft DAUERHAFT auf der Box und schreibt, was das
Funkbild tut, damit der naechste Abriss von INNEN dokumentiert ist.

══ WARUM ES SIE (WIEDER) GIBT ═══════════════════════════════════════════════

Die erste Sonde lief aus /tmp — und der erste Abriss MIT Sonde endete in
einem Neustart, der /tmp samt Protokoll leerte (16.08.2026). Ausgerechnet
der Moment, fuer den sie gebaut war, ist verloren. Deshalb jetzt:

  * Skript und Protokoll unter /home/dietpi/netzabriss/ (ueberlebt Neustart),
  * systemd-Dienst mit Autostart (ueberlebt Neustart),
  * eigene Groessenbremse (die Karte soll nicht volllaufen).

══ WAS SIE MISST — die Koexistenz-Frage ═════════════════════════════════════

Beobachtung des Betreibers am 16.08.2026: „bluetooth stottert manchmal /
jetzt gerade extrem" — Minuten spaeter war die Box vom Netz. Und: „ich habe
nur bluetooth" — JEDER bisherige Abriss geschah also beim BT-Hoeren. Auf dem
Pi teilen sich WLAN und Bluetooth einen Kombichip (BCM4345); die klassische
Koexistenz-Falle ist: BT-Audio + WLAN-Streaming -> erst Stottern, dann
Abriss. Die Sonde protokolliert deshalb JE TAKT:

  wlan   Frequenz (faellt sie von 5 GHz auf 2,4 zurueck?), Signal, Bitrate
  ping   eine Laufzeit zum Gateway (wird das Netz zaeh, BEVOR es reisst?)
  bt     ist eine bluez-Senke da, und traegt sie RUNNING (hoert gerade wer?)
  last   loadavg 1min
  kern   NEUE Kernelzeilen zu brcmfmac/hci/wlan seit dem letzten Takt

Ernten: tools/netzabriss-diagnose.py, oder das Protokoll direkt lesen:
/home/dietpi/netzabriss/sonde.log (eine JSON-Zeile je Takt).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time

ORDNER = "/home/dietpi/netzabriss"
LOG = f"{ORDNER}/sonde.log"
TAKT_S = 5
# ~2 MB, dann wird EINMAL rotiert (sonde.log.alt). Zwei Dateien reichen: die
# Frage ist immer „was geschah um den letzten Abriss", nicht „letzten Monat".
MAX_BYTES = 2_000_000


def lauf(befehl: list[str], frist: float = 3.0) -> str:
    try:
        return subprocess.run(befehl, capture_output=True, text=True, timeout=frist).stdout
    except Exception:
        return ""


def wlan() -> dict:
    raus = lauf(["iw", "dev", "wlan0", "link"])
    if "Connected" not in raus:
        return {"verbunden": False}
    freq = re.search(r"freq: (\d+)", raus)
    sig = re.search(r"signal: (-?\d+)", raus)
    tx = re.search(r"tx bitrate: ([\d.]+)", raus)
    return {
        "verbunden": True,
        "freq": int(freq.group(1)) if freq else None,
        "signal": int(sig.group(1)) if sig else None,
        "tx": float(tx.group(1)) if tx else None,
    }


def gateway() -> str:
    raus = lauf(["ip", "route", "show", "default"])
    m = re.search(r"default via (\S+)", raus)
    return m.group(1) if m else "192.168.178.1"


def ping_ms(ziel: str) -> float | None:
    raus = lauf(["ping", "-c", "1", "-W", "1", ziel], frist=2.5)
    m = re.search(r"time=([\d.]+)", raus)
    return float(m.group(1)) if m else None


def bluetooth() -> dict:
    senken = lauf(["pactl", "list", "short", "sinks"])
    zeile = next((z for z in senken.splitlines() if "bluez" in z), "")
    if not zeile:
        aus: dict = {"senke": False}
    else:
        teile = zeile.split("\t")
        aus = {"senke": True, "name": teile[1] if len(teile) > 1 else "?", "zustand": teile[-1].strip()}
    # WELCHER ADAPTER TRAEGT? (Betreiber: "verwende ich nicht den bt500") Auf
    # der Box stecken ZWEI Controller - der eingebaute (hci0, Kombichip mit
    # dem WLAN) und der USB-Stick BT500 (hci1, Realtek). Nur wenn der Ton
    # ueber hci0 laeuft, greift die Koexistenz-These; laeuft er ueber hci1,
    # faellt sie. Und wechselt der Lautsprecher zwischen beiden, erklaert
    # GENAU DAS die Wechselhaftigkeit ("gestern lief es sehr gut").
    for h in ("hci0", "hci1"):
        con = lauf(["hcitool", "-i", h, "con"], frist=2.0)
        macs = re.findall(r"([0-9A-F]{2}(?::[0-9A-F]{2}){5})", con)
        if macs:
            aus[h] = macs
    return aus


def strom() -> dict:
    """Throttle-Bits und Akkulage - die Unterspannungs-Spur.

    Die Bits sind KLEBRIG nur bis zum Neustart: beim Abriss vom 16.08. hat
    der Neustart sie geleert, bevor jemand sie lesen konnte. Im Protokoll
    stehen sie deshalb JEDEN Takt - dann ist der letzte Satz vor der Luecke
    die Auskunft, die das Register selbst nicht mehr geben kann."""
    aus: dict = {}
    roh = lauf(["vcgencmd", "get_throttled"], frist=2.0)
    m = re.search(r"0x([0-9a-fA-F]+)", roh)
    if m:
        aus["throttled"] = m.group(1)
    try:
        import urllib.request
        d = json.load(urllib.request.urlopen("http://localhost:8200/api/mupihat", timeout=2))
        aus["vbat"] = d.get("Vbat")
        aus["ibat"] = d.get("Ibat")
    except Exception:
        pass
    return aus


def kernel_neues(schon: set[str]) -> list[str]:
    raus = lauf(["dmesg"], frist=4.0)
    neu: list[str] = []
    for zeile in raus.splitlines()[-200:]:
        if not re.search(r"brcmf|hci\d|wlan|Bluetooth", zeile, re.I):
            continue
        if zeile in schon:
            continue
        schon.add(zeile)
        neu.append(zeile[-180:])
    # Das Gedaechtnis deckeln — sonst waechst es tagelang.
    if len(schon) > 3000:
        schon.clear()
    return neu[-5:]


def rotieren() -> None:
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > MAX_BYTES:
            os.replace(LOG, f"{LOG}.alt")
    except OSError:
        pass


def main() -> None:
    os.makedirs(ORDNER, exist_ok=True)
    gw = gateway()
    gesehen: set[str] = set()
    # Der Start selbst ist eine Auskunft: nach einem Neustart steht hier,
    # WANN die Sonde wieder da war — und damit, wie lange die Luecke ist.
    with open(LOG, "a") as f:
        f.write(json.dumps({"t": time.time(), "start": True, "gw": gw}) + "\n")
    while True:
        rotieren()
        satz = {
            "t": round(time.time(), 1),
            "wlan": wlan(),
            "ping": ping_ms(gw),
            "bt": bluetooth(),
            "strom": strom(),
            "last": round(os.getloadavg()[0], 2),
        }
        kern = kernel_neues(gesehen)
        if kern:
            satz["kern"] = kern
        with open(LOG, "a") as f:
            f.write(json.dumps(satz, ensure_ascii=False) + "\n")
        time.sleep(TAKT_S)


if __name__ == "__main__":
    main()
