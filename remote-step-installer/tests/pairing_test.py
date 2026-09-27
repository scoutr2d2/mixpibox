#!/usr/bin/env python3
"""
Tests fuer die Pairing-Bremse des Agenten — gegen einen ECHTEN Agenten.

WARUM ES DIESE BREMSE UEBERHAUPT GIBT: Der Pair-Code hat sechs Ziffern, also
eine Million Moeglichkeiten. Solange der Agent auf 127.0.0.1 lauscht und man
ihn durch einen SSH-Tunnel erreicht, genuegt das — wer dort schon ist, hat
ohnehin gewonnen. Der Einrichtungsassistent bringt ihn aber ins LAN, damit ein
Handy ihn erreicht. Ohne Bremse waeren eine Million Versuche dann in Minuten
durchprobiert, bei einem Programm, das beliebige Befehle als ROOT ausfuehrt.

GEPRUEFT WIRD DESHALB DAS, WAS WIRKLICH SCHUETZT: nicht die Wartezeit (die
haelt einen parallelen Angriff nicht auf), sondern der HARTE DECKEL — nach
PAIR_MAX_FEHLER Fehlversuchen nimmt der Agent gar keinen Code mehr an, auch
nicht den richtigen.

  python3 tests/pairing_test.py
"""
import atexit
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ok = bad = 0


def pruefe(bedingung, was, hinweis=""):
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


def freier_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def agent_starten():
    """Einen Agenten hochfahren und seinen Pair-Code abfangen."""
    port = freier_port()
    p = subprocess.Popen(
        [sys.executable, REPO + "/agent/agent.py", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    atexit.register(lambda: p.poll() is None and p.terminate())
    code = None
    t0 = time.time()
    while time.time() - t0 < 10:
        zeile = p.stdout.readline() or ""
        m = re.search(r"PAIR CODE:\s+(\d{6})", zeile)
        if m:
            code = m.group(1)
            break
    if not code:
        p.terminate()
        raise RuntimeError("kein Pair-Code vom Agenten — kam er ueberhaupt hoch?")
    return p, port, code


def pair(port, code):
    """Einen Code anbieten. Gibt (status, antwort) zurueck."""
    daten = json.dumps({"code": code}).encode()
    anfrage = urllib.request.Request(
        f"http://127.0.0.1:{port}/pair", data=daten,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(anfrage, timeout=10) as a:
            return a.status, json.loads(a.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


print("── 1. Der richtige Code oeffnet")
p, port, code = agent_starten()
try:
    status, antwort = pair(port, code)
    pruefe(status == 200, f"richtiger Code -> 200 (war {status})")
    pruefe(bool(antwort.get("token")), "es kommt ein Token zurueck")
finally:
    p.terminate()

print("── 2. Ein falscher Code wird abgewiesen und mitgezaehlt")
p, port, code = agent_starten()
try:
    status, antwort = pair(port, "000000" if code != "000000" else "111111")
    pruefe(status == 403, f"falscher Code -> 403 (war {status})")
    pruefe(
        antwort.get("verbleibend") is not None,
        "die Antwort sagt, wie viele Versuche bleiben",
        f"Antwort: {antwort}",
    )
finally:
    p.terminate()

print("── 3. Nach genug Fehlversuchen ist zu — auch fuer den RICHTIGEN Code")
# DAS IST DER EIGENTLICHE SCHUTZ. Eine blosse Wartezeit waere wirkungslos:
# der Agent bedient jede Anfrage in einem eigenen Thread, ein Angreifer kann
# also parallel raten und wartet nur einmal.
p, port, code = agent_starten()
try:
    falsch = "000000" if code != "000000" else "111111"
    letzter = None
    for i in range(8):
        letzter = pair(port, falsch)
    pruefe(letzter[0] == 429, f"nach 8 Fehlversuchen -> 429 (war {letzter[0]})")

    status, antwort = pair(port, code)
    pruefe(
        status == 429,
        f"jetzt wird sogar der RICHTIGE Code abgewiesen (war {status})",
        f"Antwort: {antwort}",
    )
    pruefe(
        not antwort.get("token"),
        "und es kommt kein Token — sonst waere die Sperre nur Zierde",
    )
    pruefe(
        "neu starten" in json.dumps(antwort, ensure_ascii=False)
        or "gesperrt" in json.dumps(antwort, ensure_ascii=False),
        "die Antwort sagt, was zu tun ist",
        f"Antwort: {antwort}",
    )
finally:
    p.terminate()

print("── 4. Ein geglueckter Versuch setzt den Zaehler zurueck")
# Sonst summierten sich Vertipper ueber eine ganze Einrichtung hinweg und die
# Box spraeche irgendwann grundlos nicht mehr mit dem Handy.
p, port, code = agent_starten()
try:
    falsch = "000000" if code != "000000" else "111111"
    for _ in range(5):
        pair(port, falsch)
    status, _ = pair(port, code)
    pruefe(status == 200, f"nach 5 Vertippern geht der richtige Code noch (war {status})")
    for _ in range(5):
        pair(port, falsch)
    status, _ = pair(port, code)
    pruefe(
        status == 200,
        f"und nach weiteren 5 immer noch — der Zaehler stand wieder auf 0 (war {status})",
    )
finally:
    p.terminate()

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
