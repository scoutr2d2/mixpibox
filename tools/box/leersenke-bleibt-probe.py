#!/usr/bin/env python3
"""Bleibt ein Strom in der mixpi-Leersenke, wenn der Tonausgang wechselt?

    python3 tools/box/leersenke-bleibt-probe.py [dietpi@]<adresse>

Laeuft AUF DEM ARBEITSRECHNER, redet per ssh und HTTP mit der Box.

══ WOFUER ═════════════════════════════════════════════════════════════════

POST /api/ton/ausgang nimmt beim Wechsel jeden laufenden Strom mit
(`move-sink-input`) — sonst hoerte man den Wechsel erst beim naechsten
Stueck. Der Mitschnitt (plugins/mixpi-mitschnitt) parkt seinen
Aufnahme-Strom aber ABSICHTLICH still in der Leersenke `mixpi-mitschnitt`:
wandert der mit, toent der stumme Mitschnitt ploetzlich auf dem
Lautsprecher, und die Aufnahme greift den falschen Weg ab.

Seit dem 22.08.2026 schont der Server Stroeme, deren Senke `mixpi-…`
heisst (mixpiLeersenken/stroemeAus in src/backend-api/src/tonausgang.ts).
Diese Sonde prueft die WIRKUNG am Geraet, nicht den Code:

    1. Zustand sichern: alle Stroeme samt Senke, die Vorgabe.
    2. Einen Probestrom in die Leersenke legen (mpv, Endlosschleife —
       eine Leersenke schluckt alles, hoerbar ist nichts).
    3. Den ECHTEN Elternweg gehen: POST /api/ton/ausgang auf den
       eingebauten Ausgang (alsa_output…).
    4. Nachsehen: Der Probestrom muss in der Leersenke GEBLIEBEN sein;
       die uebrigen Stroeme muessen mitgewandert sein.
    5. ALLES zurueckdrehen: jeder Strom auf seine alte Senke, die alte
       Vorgabe, Probestrom beenden. Die Box verlaesst die Sonde so,
       wie sie sie vorgefunden hat.

Endet mit 0 (geschont), 1 (BEFUND: der Strom wurde mitgerissen — alter
Serverstand oder Rueckfall) oder 2 (Umgebung traegt nicht). Der
Probestrom wird ueber seine PID beendet, nicht per pkill -f — ein Muster
traefe auch die eigene ssh-Huelle ([[pkill-toetet-die-eigene-shell]]).
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request

PROBEDATEI = "/home/dietpi/MuPiBox/sysmedia/sound/startup.wav"
LEERSENKEN_PRAEFIX = "mixpi-"


def ssh(ziel: str, befehl: str, frist: int = 15) -> tuple[int, str]:
    """Ein Befehl auf der Box, mit XDG_RUNTIME_DIR — pactl findet den
    Tonserver sonst nicht (Sitzungsdienst unter /run/user/<uid>)."""
    ganz = f"export XDG_RUNTIME_DIR=/run/user/$(id -u); {befehl}"
    try:
        e = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", ziel, ganz],
            capture_output=True, text=True, timeout=frist,
        )
        return e.returncode, (e.stdout or "").strip()
    except Exception as f:
        return -1, str(f)


def senken(ziel: str) -> dict[str, str]:
    """Name -> Kennung aus `pactl list short sinks`. Die Fehlerzeilen, die
    pactl auf die Standardausgabe schreibt, fallen am Tab-Format raus."""
    _, aus = ssh(ziel, "pactl list short sinks")
    raus: dict[str, str] = {}
    for z in aus.splitlines():
        t = z.split("\t")
        if len(t) >= 2 and t[0].strip().isdigit():
            raus[t[1].strip()] = t[0].strip()
    return raus


def stroeme(ziel: str) -> dict[str, str]:
    """Strom-Kennung -> Senken-Kennung aus `pactl list short sink-inputs`."""
    _, aus = ssh(ziel, "pactl list short sink-inputs")
    raus: dict[str, str] = {}
    for z in aus.splitlines():
        t = z.split("\t")
        if len(t) >= 2 and t[0].strip().isdigit():
            raus[t[0].strip()] = t[1].strip()
    return raus


def vorgabe(ziel: str) -> str:
    _, aus = ssh(ziel, "pactl get-default-sink")
    return aus.splitlines()[-1].strip() if aus else ""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    adresse = sys.argv[1] if "@" in sys.argv[1] else f"dietpi@{sys.argv[1]}"
    host = adresse.split("@", 1)[1]

    print(f"══ Leersenke-bleibt-Probe an {adresse} ══\n")

    alle_senken = senken(adresse)
    if not alle_senken:
        print("pactl antwortet nicht — Box erreichbar, Tonserver oben?")
        return 2
    leer = {n: k for n, k in alle_senken.items() if n.startswith(LEERSENKEN_PRAEFIX)}
    ziel_sink = next((n for n in alle_senken if n.startswith("alsa_output.")), None)
    if not leer:
        print(f"Keine {LEERSENKEN_PRAEFIX}*-Senke auf der Box — 62-mixpi-mitschnitt.conf ausgerollt?")
        return 2
    if not ziel_sink:
        print("Kein eingebauter Ausgang (alsa_output…) — auf DIESER Box unerwartet.")
        return 2
    leername, leerkennung = next(iter(leer.items()))
    print(f"Leersenke:  {leername} (Kennung {leerkennung})")
    print(f"Zielsenke:  {ziel_sink}")

    davor_stroeme = stroeme(adresse)
    davor_vorgabe = vorgabe(adresse)
    print(f"Vorgabe:    {davor_vorgabe}")
    print(f"Stroeme:    {davor_stroeme or '(keine)'}\n")

    # ── Probestrom in die Leersenke ──────────────────────────────────────
    rc, pid = ssh(
        adresse,
        "nohup mpv --no-terminal --really-quiet --loop=inf --ao=pulse "
        f"--audio-device=pulse/{leername} {PROBEDATEI} >/dev/null 2>&1 & echo $!",
    )
    if rc != 0 or not pid.isdigit():
        print(f"mpv startet nicht: {pid}")
        return 2
    probestrom = None
    for _ in range(20):
        time.sleep(0.5)
        jetzt = stroeme(adresse)
        neu = [k for k, s in jetzt.items() if k not in davor_stroeme and s == leerkennung]
        if neu:
            probestrom = neu[0]
            break
    if not probestrom:
        ssh(adresse, f"kill {pid} 2>/dev/null")
        print("Kein neuer Strom in der Leersenke angekommen — mpv/pulse pruefen.")
        return 2
    print(f"Probestrom: {probestrom} liegt in der Leersenke (mpv-PID {pid})\n")

    # ── Der echte Elternweg ──────────────────────────────────────────────
    print(f"POST /api/ton/ausgang -> {ziel_sink}")
    try:
        antwort = urllib.request.urlopen(
            urllib.request.Request(
                f"http://{host}:8200/api/ton/ausgang",
                data=json.dumps({"name": ziel_sink}).encode(),
                headers={"Content-Type": "application/json"},
            ),
            timeout=30,
        )
        print(f"  HTTP {antwort.status}")
    except Exception as f:
        print(f"  Aufruf gescheitert: {f}")
        ssh(adresse, f"kill {pid} 2>/dev/null")
        return 2

    danach = stroeme(adresse)
    geblieben = danach.get(probestrom) == leerkennung
    mitgewandert = [
        k for k in davor_stroeme
        if k in danach and danach[k] != davor_stroeme[k]
    ]
    print(f"\nProbestrom danach auf Senke {danach.get(probestrom)} "
          f"({'GEBLIEBEN — geschont' if geblieben else 'MITGERISSEN — Befund!'})")
    print(f"Mitgewandert (erwuenscht): {mitgewandert or 'keiner'}")
    _, log = ssh(adresse, "sudo -n journalctl -u mupibox-server.service -n 30 --no-pager 2>/dev/null | grep Tonausgang | tail -2")
    if log:
        print(f"Serverlog:\n  {log}")

    # ── Zurueckdrehen: die Box verlaesst die Sonde wie vorgefunden ───────
    print("\n── Zurueckdrehen ──")
    ssh(adresse, f"kill {pid} 2>/dev/null")
    for k, s in davor_stroeme.items():
        if k in danach and danach[k] != s:
            ssh(adresse, f"pactl move-sink-input {k} {s}")
    if davor_vorgabe:
        ssh(adresse, f"pactl set-default-sink {davor_vorgabe}")
    time.sleep(1)
    endstand = stroeme(adresse)
    endvorgabe = vorgabe(adresse)
    sauber = endvorgabe == davor_vorgabe and all(
        endstand.get(k) == s for k, s in davor_stroeme.items() if k in endstand
    ) and probestrom not in endstand
    print(f"Vorgabe wieder: {endvorgabe}   Stroeme wieder: {endstand or '(keine)'}")
    print(f"Rueckbau {'vollstaendig' if sauber else 'UNVOLLSTAENDIG — von Hand nachsehen!'}\n")

    # BEIDE Haelften des Versprechens (Schritt 4 im Kopf): geschont wird der
    # Leersenken-Strom, MITGENOMMEN werden die uebrigen. Ein Server, der gar
    # nichts verschiebt, saehe sonst wie geschont aus — Urteil nur an
    # `geblieben` zu haengen war eine halbe Messung (Ableger-Pruefung,
    # 22.08.2026). Gab es keine uebrigen Stroeme, ist das keine Auskunft.
    wanderpflicht = [k for k in davor_stroeme if davor_stroeme[k] != leerkennung and k != probestrom]
    gewandert_ok = (not wanderpflicht) or bool(mitgewandert)
    if not gewandert_ok:
        print("▸ BEFUND: es gab Stroeme ausserhalb der Leersenke, und KEINER wanderte — der Wechsel griff nicht.")
        return 1
    print(f"▸ {'GESCHONT: der Leersenken-Strom blieb beim Ausgangswechsel stehen.' if geblieben else 'BEFUND: der Leersenken-Strom wurde mitverschoben.'}")
    return 0 if geblieben else 1


if __name__ == "__main__":
    sys.exit(main())
