#!/usr/bin/env python3
"""Warum hat der Kiosk-Browser keinen Ton? — gemessen, nicht geraten.

    scp tools/box/kiosk-ton-probe.py dietpi@<box>:/tmp/
    ssh dietpi@<box> 'python3 /tmp/kiosk-ton-probe.py'

Muss AUF DER BOX laufen.

══ DER ANLASS (20.09.2026) ════════════════════════════════════════════════

Betreiber, nach dem ersten Belohnungs-Video: „beim spielen vom video gibt es
keinen ton." Bild lief, Ton nicht — und die Box selbst spielt Hoerspiele
tadellos. Das ist der Hinweis: es ist KEIN Tonproblem der Box, sondern eines
des BROWSERS.

══ DIE FRAGE, DIE DIESES WERKZEUG BEANTWORTET ════════════════════════════

PipeWire ist ein SITZUNGSDIENST. Es gehoert einem Benutzer (hier `dietpi`,
uid 1000) und haelt seine Sockets unter `/run/user/1000/`. Wer Ton machen
will, muss

  1. als DIESER Benutzer laufen — oder
  2. ausdruecklich auf dessen Socket zeigen (`PULSE_SERVER`).

Der Kiosk-Browser tut auf einer Bestandsbox WEDER das eine NOCH das andere:
`chromium-autostart.sh` wird aus der Autostart-Kette von DietPi als ROOT
gestartet. Ein Browser als root findet unter `/run/user/0/` nichts, faellt
auf ALSA zurueck — und dort haelt PipeWire die Karte. Ergebnis: eine
Tonausgabe, die es gar nicht gibt. Kein Fehler, keine Meldung, kein Ton.

ES FIEL JAHRELANG NICHT AUF, weil nichts im Browser je Ton gemacht hat: Die
Musik kommt aus mpv/librespot, und das Vorlesen spielt seit E123 der SERVER
(`/api/vorlesen/sprich?abspielen=1` liefert nur die Dauer zurueck). Das
Video ist der ERSTE Ton aus dem Browser dieser Box.

DIESES WERKZEUG RAET NICHT, sondern misst vier Dinge einzeln:
  * als wer der Kiosk laeuft,
  * ob dessen Umgebung auf einen erreichbaren Tonserver zeigt,
  * ob dieser Weg von dort aus WIRKLICH traegt (Verbindungsversuch),
  * und ob gerade ein Tonstrom des Browsers am Server haengt.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

BOXNUTZER = os.environ.get("MUPI_BOXNUTZER", "dietpi")


def lauf(befehl: list[str], umgebung: dict[str, str] | None = None, frist: int = 8) -> tuple[int, str]:
    """Einen Befehl fahren und (Rueckgabewert, Ausgabe) liefern."""
    try:
        p = subprocess.run(
            befehl,
            capture_output=True,
            text=True,
            timeout=frist,
            env={**os.environ, **(umgebung or {})},
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError:
        return 127, f"{befehl[0]} gibt es nicht"
    except subprocess.TimeoutExpired:
        return 124, "Zeit abgelaufen"


def kiosk_prozesse() -> list[tuple[int, str, str]]:
    """(pid, benutzer, befehlszeile) aller Kiosk-Prozesse."""
    rc, aus = lauf(["ps", "-eo", "pid=,user=,args="])
    if rc != 0:
        return []
    raus = []
    for zeile in aus.splitlines():
        # NUR DER BROWSER SELBST UND SEIN STARTER. `pgrep -f chromium` faengt
        # sonst auch diese Probe mit (ihre Befehlszeile enthaelt das Wort) —
        # dieselbe Falle wie bei `pgrep -f` ueberall sonst.
        if not re.search(r"(^|/)(chromium|cog|xinit)\b", zeile.split(maxsplit=2)[-1]):
            continue
        if "kiosk-ton-probe" in zeile:
            continue
        teile = zeile.split(maxsplit=2)
        if len(teile) < 3:
            continue
        raus.append((int(teile[0]), teile[1], teile[2]))
    return raus


def uid_von(nutzer: str) -> int | None:
    rc, aus = lauf(["id", "-u", nutzer])
    return int(aus.strip()) if rc == 0 and aus.strip().isdigit() else None


def hauptbrowser(prozesse: list[tuple[int, str, str]]) -> tuple[int, str, str] | None:
    """Der Browser selbst, nicht sein Starter — er traegt die Tonausgabe."""
    for pid, nutzer, zeile in prozesse:
        if re.search(r"(^|/)(chromium|cog)\b", zeile) and "--type=" not in zeile:
            return (pid, nutzer, zeile)
    return prozesse[0] if prozesse else None


def main() -> int:
    befund = 0
    print("── Hat der Kiosk-Browser einen Weg zum Ton? ──\n")

    prozesse = kiosk_prozesse()
    if not prozesse:
        print("  ABBRUCH: kein Kiosk-Prozess gefunden (chromium/cog/xinit).")
        print("  Laeuft der Kiosk ueberhaupt? `systemctl status` oder am Schirm nachsehen.")
        return 2

    browser = hauptbrowser(prozesse)
    pid, nutzer, zeile = browser
    print(f"  Kiosk laeuft als       {nutzer} (pid {pid})")
    stumm = "--mute-audio" in zeile
    print(f"  --mute-audio gesetzt   {'JA — das allein macht schon stumm' if stumm else 'nein'}")
    if stumm:
        befund += 1

    # ── 1. WEM GEHOERT PIPEWIRE? ──────────────────────────────────────────
    uid = uid_von(BOXNUTZER)
    socket = f"/run/user/{uid}/pulse/native" if uid is not None else ""
    da = bool(socket) and os.path.exists(socket)
    print(f"  PipeWire-Socket        {socket or '(unbekannt)'}  {'da' if da else 'FEHLT'}")
    if not da:
        print(f"\n  BEFUND: {BOXNUTZER} hat keinen laufenden Tonserver — dann ist die Frage")
        print("  nach dem Browser die zweite. Erst `systemctl --user status pipewire`.")
        return 1

    # ── 2. SIEHT DER BROWSER IHN? ─────────────────────────────────────────
    #
    # Die Umgebung eines fremden Prozesses ist nur mit Rechten zu lesen.
    # `sudo -n`, NIE ohne: ein `sudo` ohne Terminal sammelt Fehlversuche, und
    # faillock sperrt danach das Konto (llmwiki sudo-ohne-terminal-sperrt-das-konto).
    umgebung = ""
    rc, aus = lauf(["sudo", "-n", "cat", f"/proc/{pid}/environ"])
    if rc == 0:
        umgebung = aus.replace("\0", "\n")
    else:
        try:
            with open(f"/proc/{pid}/environ", "rb") as f:
                umgebung = f.read().decode("utf8", "replace").replace("\0", "\n")
        except OSError as e:
            print(f"  Umgebung des Browsers  nicht lesbar ({e.__class__.__name__})")

    def feld(name: str) -> str:
        for z in umgebung.splitlines():
            if z.startswith(f"{name}="):
                return z.split("=", 1)[1]
        return ""

    if umgebung:
        pulse = feld("PULSE_SERVER")
        xdg = feld("XDG_RUNTIME_DIR")
        print(f"  PULSE_SERVER           {pulse or '(nicht gesetzt)'}")
        print(f"  XDG_RUNTIME_DIR        {xdg or '(nicht gesetzt)'}")
        zeigt_hin = socket in pulse or xdg == f"/run/user/{uid}"
        if nutzer != BOXNUTZER and not zeigt_hin:
            befund += 1
            print()
            print(f"  BEFUND: Der Browser laeuft als {nutzer}, der Tonserver gehoert {BOXNUTZER} —")
            print("  und nichts in seiner Umgebung zeigt auf dessen Socket. Er hat damit")
            print("  GAR KEINE Tonausgabe: unter /run/user/0/ steht nichts, und der")
            print("  ALSA-Rueckfall trifft eine Karte, die PipeWire haelt.")

    # ── 3. TRAEGT DER WEG WIRKLICH? ───────────────────────────────────────
    #
    # ROOT DARF AUF EINEN FREMDEN SOCKET: die Rechte von /run/user/1000 sind
    # 0700, aber root umgeht die Pruefung. Das ist keine Theorie — dieser
    # Zweig PROBIERT es, statt es zu behaupten.
    rc, aus = lauf(["sudo", "-n", "env", f"PULSE_SERVER=unix:{socket}", "pactl", "info"])
    traegt = rc == 0 and "Server Name" in aus
    senke = ""
    for z in aus.splitlines():
        if z.startswith("Default Sink:"):
            senke = z.split(":", 1)[1].strip()
    print(f"  root ueber PULSE_SERVER {'traegt' if traegt else 'traegt NICHT'}" + (f" (Vorgabe-Senke {senke})" if senke else ""))

    # ── 4. HAENGT GERADE EIN TONSTROM DES BROWSERS? ───────────────────────
    rc, aus = lauf(["pactl", "list", "sink-inputs"])
    stroeme = []
    if rc == 0:
        for block in aus.split("Sink Input #")[1:]:
            name = ""
            for z in block.splitlines():
                z = z.strip()
                if z.startswith(("application.name =", "media.name =", "application.process.binary =")):
                    name += z.split("=", 1)[1].strip().strip('"') + " "
            stroeme.append(name.strip() or "(ohne Namen)")
    print(f"  Tonstroeme gerade      {len(stroeme)}")
    for s in stroeme:
        print(f"                         {s}")
    vom_browser = [s for s in stroeme if re.search(r"chrom|cog|wpe", s, re.I)]
    if vom_browser:
        print("  -> ein Strom des Browsers haengt am Server: der Weg steht.")

    print()
    if befund:
        print(f"  {befund} BEFUND(E).")
        print("  ZU TUN, der kleine Weg: in scripts/chromium-autostart.sh vor dem Start")
        print(f"     export PULSE_SERVER=unix:{socket}")
        print(f"     export PULSE_COOKIE=/home/{BOXNUTZER}/.config/pulse/cookie")
        print("  setzen. Der grosse Weg waere, den Kiosk als Benutzer zu fahren")
        print("  (llmwiki mupi-kiosk-als-dietpi-anleitung) — das ruehrt an X, Autologin")
        print("  und DSI und gehoert nicht in dieselbe Sitzung wie eine Tonfrage.")
        return 1
    print("  KEIN BEFUND an dieser Stelle.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
