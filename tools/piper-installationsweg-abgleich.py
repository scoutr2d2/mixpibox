#!/usr/bin/env python3
"""Kommt Piper ueberhaupt auf eine frische Box — und an dieselbe Stelle?

WOZU: Bis zum 04.08.2026 lautete die Antwort schlicht NEIN. Der Server erwartet
Piper unter `/home/dietpi/.mupibox/piper-venv`, die Stimmen daneben — dorthin
gebracht hat ihn aber niemand. Er wurde auf der Entwicklungsbox VON HAND
eingerichtet ([[vorlesen-tts]], Abschnitt EINRICHTUNG); weder `autosetup.sh`
noch `update/start_mupibox_update.sh` noch der remote-step-installer kannten ihn
(nachgesehen: 0 Treffer fuer "piper" in allen drei Ausrollwegen). Solange
Vorlesen ein Zusatz war, fiel das nicht auf. Seit Google TTS abgeloest ist
([[google-tts-abgeloest]]), ist Sprechen ein beworbenes Merkmal — und eine
frische SD-Karte spraeche gar nicht.

DIE FEHLERKLASSE, DIE DIESES WERKZEUG BEWACHT, ist aber nicht "es fehlt ganz",
sondern die leisere danach: die Pfade stehen an VIER Stellen (server.ts,
vorlesen.ts, das Einrichtungsskript, die zwei Ausrollwege). Wer einen davon
verschiebt, bekommt keine Fehlermeldung — er bekommt eine Box, die `bereit:
false` meldet, und niemand weiss warum. `bereit` haengt an der schieren
Existenz EINER Datei (server.ts: `fs.existsSync(piperBin)`); ein Tippfehler im
Pfad sieht davon genauso aus wie eine fehlende Installation.

WAS ES PRUEFT
  1. Der venv-Pfad, den server.ts erwartet, ist der, den das Skript anlegt.
  2. Dasselbe fuer das Stimmenverzeichnis.
  3. Die Vorgabestimme aus vorlesen.ts (STIMME_VORGABE) ist die, die das Skript
     herunterlaedt. Laufen sie auseinander, zeigt die Verwaltung eine Stimme
     an, die auf der Karte fehlt.
  4. BEIDE Ausrollwege rufen das Skript wirklich auf — autosetup.sh fuer die
     frische SD, start_mupibox_update.sh fuer die laufende Box. Nur einer von
     beiden hiesse: es haengt davon ab, wie die Box entstanden ist.
  5. Das Skript liegt in scripts/mupibox/ (nur von dort wird es nach
     /usr/local/bin/mupibox kopiert) und ist ausfuehrbar.

WAS ES NICHT KANN: sagen, ob `pip install piper-tts` auf DER Box durchlaeuft.
Das haengt an Rad und Architektur (fuer armhf gibt es kein onnxruntime-Rad) und
ist ohne Geraet nicht zu beantworten. Die Gegenprobe am Geraet lautet:

    ssh <box> "sudo /usr/local/bin/mupibox/piper-einrichten.sh --pruefen"
    curl -s http://<box>:8200/api/vorlesen | jq '{bereit, stimmen: (.stimmen|length)}'

AUFRUF
    python3 tools/piper-installationsweg-abgleich.py
    python3 tools/piper-installationsweg-abgleich.py --pruefen   # still, RC=1 bei Befund
"""

import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(WURZEL, "src/backend-api/src/server.ts")
VORLESEN = os.path.join(WURZEL, "src/backend-api/src/vorlesen.ts")
SKRIPT = os.path.join(WURZEL, "scripts/mupibox/piper-einrichten.sh")
AUSROLLWEGE = [
    os.path.join(WURZEL, "autosetup/autosetup.sh"),
    os.path.join(WURZEL, "update/start_mupibox_update.sh"),
]


def lies(pfad: str) -> str:
    try:
        return open(pfad, encoding="utf-8").read()
    except OSError:
        return ""


def ts_vorgabe(text: str, variable: str) -> str:
    """`const x = process.env.FOO || '/pfad'` -> '/pfad'."""
    t = re.search(
        rf"const\s+{re.escape(variable)}\s*=\s*process\.env\.[A-Z_]+\s*\|\|\s*'([^']+)'",
        text,
    )
    return t.group(1) if t else ""


def sh_vorgabe(text: str, variable: str) -> str:
    """`VENV="${FOO:-/pfad}"` -> '/pfad'."""
    t = re.search(rf'^{re.escape(variable)}="\$\{{[A-Z_]+:-([^}}]+)\}}"', text, re.M)
    return t.group(1) if t else ""


def main() -> int:
    still = "--pruefen" in sys.argv
    befunde = []

    server = lies(SERVER)
    vorlesen = lies(VORLESEN)
    skript = lies(SKRIPT)

    erwartet = {
        "venv": ts_vorgabe(server, "piperVenv"),
        "stimmen": ts_vorgabe(server, "stimmenDir"),
    }
    t = re.search(r"export const STIMME_VORGABE\s*=\s*'([^']+)'", vorlesen)
    erwartet["stimme"] = t.group(1) if t else ""

    legt_an = {
        "venv": sh_vorgabe(skript, "VENV"),
        "stimmen": sh_vorgabe(skript, "STIMMEN"),
        "stimme": sh_vorgabe(skript, "STIMME"),
    }

    if not skript:
        befunde.append(
            "scripts/mupibox/piper-einrichten.sh fehlt — keine Box bekommt Piper."
        )
    elif not os.access(SKRIPT, os.X_OK):
        befunde.append(
            "piper-einrichten.sh ist nicht ausfuehrbar (chmod 755). autosetup.sh "
            "ruft es direkt auf, nicht ueber `bash`."
        )

    beschriftung = {
        "venv": "venv-Pfad",
        "stimmen": "Stimmenverzeichnis",
        "stimme": "Vorgabestimme",
    }
    for schluessel, name in beschriftung.items():
        a, b = erwartet[schluessel], legt_an[schluessel]
        if not a:
            befunde.append(f"{name}: im Quelltext nicht gefunden — Muster veraltet?")
        elif not b:
            befunde.append(f"{name}: im Einrichtungsskript nicht gefunden.")
        elif a != b:
            befunde.append(
                f"{name} laeuft auseinander:\n"
                f"      Server erwartet     : {a}\n"
                f"      Skript legt an      : {b}"
            )

    for weg in AUSROLLWEGE:
        if "piper-einrichten.sh" not in lies(weg):
            befunde.append(
                f"{os.path.relpath(weg, WURZEL)} ruft piper-einrichten.sh NICHT auf — "
                "dieser Weg liefert eine stumme Box."
            )

    if still:
        for b in befunde:
            print(f"  {b}")
        return 1 if befunde else 0

    print("Was der Server erwartet:")
    for schluessel, name in beschriftung.items():
        print(f"  {name:20s} {erwartet[schluessel] or '(nicht gefunden)'}")
    print()
    print("Was der Installationsweg anlegt:")
    for schluessel, name in beschriftung.items():
        print(f"  {name:20s} {legt_an[schluessel] or '(nicht gefunden)'}")
    print()
    for weg in AUSROLLWEGE:
        ruft = "piper-einrichten.sh" in lies(weg)
        print(f"  {os.path.relpath(weg, WURZEL):34s} {'ruft auf' if ruft else 'RUFT NICHT AUF'}")
    print()
    if befunde:
        print("BEFUNDE:")
        for b in befunde:
            print(f"  * {b}")
    else:
        print("Alles deckungsgleich. Eine frische Box kann sprechen —")
        print("sofern pip und HuggingFace erreichbar waren; das sagt nur das Geraet.")
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
