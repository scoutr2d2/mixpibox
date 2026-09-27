#!/usr/bin/env python3
"""Warum erreicht der Server PipeWire nicht? — und was hilft.

    nohup python3 pipewire-erreichbar.py > /home/dietpi/pw-erreichbar.log 2>&1 &

Muss AUF DER BOX laufen.

══ WOFUER ═════════════════════════════════════════════════════════════════

Das Mitschnitt-Plugin startet `pw-record` aus dem Server heraus und bekam
(16.08.2026):

    pw_context_connect() failed: Host is down

PipeWire laeuft als Sitzungsdienst des Benutzers und haelt seinen Socket
unter `/run/user/<uid>/`. Wer ihn finden will, braucht `XDG_RUNTIME_DIR` —
eine Umgebungsvariable, die eine Anmeldung setzt und ein systemd-Dienst
nicht unbedingt erbt. Von Hand ueber ssh laeuft alles, weil die Anmeldung
sie mitbringt; aus dem Dienst heraus nicht. Deshalb faellt das nicht auf,
solange man es von Hand probiert — dieselbe Sorte Unterschied wie bei den
Diensten, die nur auf der Box lagen und niemand startete.

Dieses Werkzeug RAET NICHT, sondern probiert beide Faelle durch und sagt,
welcher traegt.
"""
from __future__ import annotations

import os
import pwd
import subprocess
import sys


def lauf(befehl: list[str], umgebung: dict | None = None, frist: int = 8) -> tuple[int, str]:
    try:
        e = subprocess.run(befehl, capture_output=True, text=True, timeout=frist, env=umgebung)
        return e.returncode, (e.stderr or e.stdout or "").strip()
    except Exception as f:
        return -1, str(f)


def main() -> int:
    print("══ Erreicht der Server PipeWire? ══\n")

    print("── Wer laeuft wie ──")
    rc, aus = lauf(["systemctl", "show", "mupibox-server.service", "-p", "User", "-p", "Environment"])
    for zeile in aus.splitlines():
        print(f"  {zeile}")

    pids = subprocess.run(["pgrep", "-f", "server.js"], capture_output=True, text=True).stdout.split()
    if not pids:
        print("  KEIN server.js-Prozess gefunden.")
        return 2
    pid = pids[0]
    try:
        besitzer = pwd.getpwuid(os.stat(f"/proc/{pid}").st_uid).pw_name
    except Exception:
        besitzer = "?"
    print(f"  server.js laeuft als: {besitzer} (PID {pid})")

    print("\n── Was steht in seiner Umgebung? ──")
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            umg = dict(
                z.split("=", 1) for z in f.read().decode(errors="replace").split("\0") if "=" in z
            )
    except Exception as f:
        print(f"  nicht lesbar: {f}")
        umg = {}
    for schluessel in ("XDG_RUNTIME_DIR", "PULSE_SERVER", "PIPEWIRE_RUNTIME_DIR", "USER", "HOME"):
        print(f"  {schluessel:<22} {umg.get(schluessel, '— FEHLT —')}")

    print("\n── Wo liegt der Socket wirklich? ──")
    gefunden = []
    for uid in sorted({0, 1000, os.stat(f"/proc/{pid}").st_uid}):
        ort = f"/run/user/{uid}"
        if not os.path.isdir(ort):
            continue
        try:
            eintraege = [n for n in os.listdir(ort) if n.startswith("pipewire")]
        except PermissionError:
            # /run/user/0 gehoert root und ist fuer dietpi zu. Das ist kein
            # Befund, sondern der Normalfall — nur eben einer, der dieses
            # Werkzeug im ersten Lauf abstuerzen liess.
            print(f"  {ort}: nicht lesbar (gehoert einem anderen Benutzer)")
            continue
        print(f"  {ort}: {', '.join(eintraege) or 'nichts'}")
        if eintraege:
            gefunden.append(ort)

    print("\n── Die eigentliche Frage: welcher Aufruf traegt? ──")
    # GENAU SO, wie das Plugin es tut — nur die Umgebung unterscheidet sich.
    fall = [
        ("wie der Server ihn jetzt hat", dict(umg)),
    ]
    for ort in gefunden:
        erweitert = dict(umg)
        erweitert["XDG_RUNTIME_DIR"] = ort
        fall.append((f"mit XDG_RUNTIME_DIR={ort}", erweitert))

    fuer_plugin = None
    for was, umgebung in fall:
        ziel = f"/tmp/pw-probe-{abs(hash(was)) % 10000}.wav"
        rc, meldung = lauf(["timeout", "3", "pw-record", "--rate", "48000", ziel], umgebung, frist=8)
        gross = os.path.getsize(ziel) if os.path.exists(ziel) else 0
        ok = gross > 10_000
        print(f"  {was:<44} {'GEHT' if ok else 'geht nicht'}  ({gross} Bytes)")
        if not ok and meldung:
            print(f"      {meldung.splitlines()[0][:90]}")
        if ok and fuer_plugin is None and "XDG_RUNTIME_DIR" in was:
            fuer_plugin = umgebung.get("XDG_RUNTIME_DIR")
        try:
            os.remove(ziel)
        except Exception:
            pass

    print("\n── URTEIL ──")
    if fuer_plugin:
        print(f"  Das Plugin muss XDG_RUNTIME_DIR={fuer_plugin} mitgeben, wenn es")
        print("  pw-record startet. Der Server erbt es nicht.")
    elif any(os.path.isdir(o) for o in gefunden):
        print("  Der Socket ist da, aber auch mit XDG_RUNTIME_DIR geht es nicht —")
        print("  dann fehlen Rechte (Benutzer passt nicht zum Socket-Eigentuemer).")
    else:
        print("  Es gibt gar keinen PipeWire-Socket unter /run/user — laeuft")
        print("  PipeWire ueberhaupt, und als wer?")
    return 0


if __name__ == "__main__":
    sys.exit(main())
