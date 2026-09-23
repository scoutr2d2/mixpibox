#!/usr/bin/env python3
"""HERKUNFT-ANNAHME-PROBE — die Voraussetzung, auf der der Herkunftsriegel ruht.

WARUM ES DAS GIBT (25.08.2026, Doku-Lauf)

`src/backend-api/src/herkunft.ts` zaehlt unter „WAS DIESER RIEGEL NICHT KANN"
drei Luecken auf. Die dritte ist keine Luecke, sondern eine ANNAHME:

    „Websockets und Eventstreams gehorchen CORS nicht — die Box fuehrt keine
     (am 07.08.2026 in server.ts nachgesehen: kein `ws`, kein
     `text/event-stream`, kein `upgrade`). Kaeme je einer dazu, muesste er
     seine Herkunft SELBST pruefen; dieser Riegel sieht ihn nicht."

Der Satz nennt sein eigenes Verfallsdatum („Kaeme je einer dazu") und hatte
niemanden, der nachsieht. Am 22.08.2026 kam einer dazu: E75 oeffnet in
`server.ts` einen `new WebSocket('ws://…')` zu Soloist. Gemessen am
25.08.2026 stand die Nachsehen-Zeile vom 07.08. woertlich noch da — mit dem
Wort `ws`, das es inzwischen gibt.

WARUM DER RIEGEL TROTZDEM HAELT, und warum das genau der Grund fuer eine Wache
statt fuer eine Korrektur ist: der Soloist-Draht geht HINAUS. Ein Client, den
die Box selbst oeffnet, hat keine fremde Herkunft — niemand von aussen kann
ihn ausloesen. Gefaehrlich waere der umgekehrte Fall, ein Websocket, den die
Box ANBIETET: der ginge am Riegel vorbei, und die einzige Stelle, die davor
warnt, ist ein Kommentar, dessen Messung 18 Tage alt war.

Diese Wache prueft darum GENAU DIE RICHTUNG, auf die es ankommt:
  * kein WebSocket-SERVER in den Quellen des Backends (`WebSocketServer`,
    `ws.Server`, ein `upgrade`-Horcher, `express-ws`, `socket.io`),
  * kein `text/event-stream` in einer Antwort,
  * jeder AUSGEHENDE WebSocket-Client steht in `AUSGEHEND` mit Grund.

Die dritte Zeile ist der Punkt: ein neuer Client faellt auf, ohne rot zu sein.
Wer ihn eintraegt, hat ihn angesehen; wer ihn nicht eintraegt, wird gefragt.
Eine Wache, die ausgehende Drahte einfach durchwinkt, haette den Umbau vom
22.08. genauso verschlafen wie der Kommentar.

GEBAUT WIRD NUR GEGEN QUELLEN. `src/deploy/server.js` ist ein Bau-Ergebnis
(in `.gitignore`, Zeile 22) und traegt gebuendelte Fremdbibliotheken — dort
nach `WebSocketServer` zu suchen hiesse, jede Abhaengigkeit zu ruegen, die je
einen anbietet.

SELBSTPRUEFUNG (llmwiki: `gegenprobe-statt-gruen-glauben`): findet die Wache
die Riegel-Datei nicht oder darin den Annahme-Absatz nicht, meldet sie FEHLER
statt gruen. Sonst waere sie ab der ersten Umbenennung eine Nullnummer — und
zwar eine, die ueber Sicherheit gruen meldet.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/herkunft-annahme-probe.py
Rueckgabe: 0 = Annahme haelt, 1 = mindestens ein Fund.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
RIEGEL = WURZEL / "src/backend-api/src/herkunft.ts"
QUELLEN = WURZEL / "src/backend-api/src"

# Der Satz, dessen Voraussetzung diese Wache haelt. Steht er nicht mehr da,
# ist die Wache verwaist und sagt das, statt gruen zu melden.
ANNAHME = "gehorchen CORS nicht"

# ── Ausgehende Drahte, die angesehen wurden ────────────────────────────────
# Datei -> warum das keine fremde Herkunft ist. Eine Ausnahmeliste ohne
# Gruende ist in drei Wochen eine Muellhalde (siehe ungerufene-wachen.py).
AUSGEHEND: dict[str, str] = {
    "server.ts": (
        "E75, 22.08.2026: Client-Draht zu Soloist auf ws://<addr>:<port> aus "
        "/var/lib/soloist/ws.{addr,port}. Die Box VERBINDET SICH, sie bietet "
        "nichts an — eine fremde Seite kann ihn nicht ausloesen."
    ),
}

# Muster, die einen ANGEBOTENEN Draht verraten. Absichtlich eng: `WebSocket`
# allein trifft auch den Client und waere damit ewig rot.
SERVER_MUSTER = (
    (r"\bWebSocketServer\b", "WebSocket-Server"),
    (r"\bws\.Server\b", "ws.Server"),
    (r"""\.on\(\s*['"]upgrade['"]""", "upgrade-Horcher"),
    (r"\bexpress-ws\b", "express-ws"),
    (r"""\bsocket\.io\b|\brequire\(['"]socket\.io""", "socket.io"),
    (r"text/event-stream", "Eventstream"),
)

# Ein ausgehender Client — das ist die Form, die eingetragen sein muss.
CLIENT_MUSTER = re.compile(r"new WebSocket\(")


def main() -> int:
    funde: list[str] = []

    # ── Selbstpruefung: gibt es den Riegel und die Annahme ueberhaupt? ─────
    if not RIEGEL.exists():
        print(f"  FEHLER: {RIEGEL.relative_to(WURZEL)} gibt es nicht — umbenannt?")
        return 1
    riegeltext = RIEGEL.read_text(encoding="utf-8")
    if ANNAHME not in riegeltext:
        print(f"  FEHLER: der Annahme-Absatz ({ANNAHME!r}) steht nicht mehr in")
        print(f"          {RIEGEL.relative_to(WURZEL)}. Diese Wache haelt dann nichts.")
        return 1

    dateien = sorted(p for p in QUELLEN.glob("*.ts") if not p.name.endswith(".spec.ts"))
    if not dateien:
        print(f"  FEHLER: keine Quelldatei in {QUELLEN.relative_to(WURZEL)} gefunden.")
        return 1

    # ── Richtung 1: bietet die Box einen Draht an? ─────────────────────────
    print("── Angebotene Drahte, die am Riegel vorbeigingen ──")
    for datei in dateien:
        text = datei.read_text(encoding="utf-8")
        for zeilennr, zeile in enumerate(text.splitlines(), 1):
            # Kommentarzeilen ausnehmen: der Riegel BESCHREIBT diese Muster.
            if zeile.lstrip().startswith(("*", "//", "/*")):
                continue
            for muster, was in SERVER_MUSTER:
                if re.search(muster, zeile):
                    print(f"  ANGEBOTEN: {was} in {datei.name}:{zeilennr}")
                    print("             Der Herkunftsriegel sieht ihn NICHT (herkunft.ts,")
                    print("             Abschnitt WAS DIESER RIEGEL NICHT KANN, Punkt 3).")
                    print("             Er muss seine Herkunft selbst pruefen.")
                    funde.append(f"server/{datei.name}:{zeilennr}")

    # ── Richtung 2: ausgehende Drahte, die niemand angesehen hat ───────────
    print("── Ausgehende Drahte ohne Eintrag ──")
    gesehen: set[str] = set()
    for datei in dateien:
        text = datei.read_text(encoding="utf-8")
        for zeilennr, zeile in enumerate(text.splitlines(), 1):
            if zeile.lstrip().startswith(("*", "//", "/*")):
                continue
            if CLIENT_MUSTER.search(zeile):
                gesehen.add(datei.name)
                if datei.name not in AUSGEHEND:
                    print(f"  NEUER DRAHT: {datei.name}:{zeilennr} oeffnet einen WebSocket.")
                    print("               Hinaus (dann in AUSGEHEND eintragen, mit Grund)")
                    print("               oder herein (dann geht er am Riegel vorbei)?")
                    funde.append(f"client/{datei.name}:{zeilennr}")

    # ── Die andere Richtung, damit die Liste nicht verrottet ───────────────
    for name, grund in AUSGEHEND.items():
        if name not in gesehen:
            print(f"  EINTRAG OHNE DRAHT: {name} steht in AUSGEHEND, oeffnet aber keinen")
            print(f"                      WebSocket mehr. Grund war: {grund[:60]}…")
            funde.append(f"tot/{name}")

    print()
    if funde:
        print(f"{len(funde)} FUND(E).")
        return 1
    zahl = len(AUSGEHEND)
    print(f"ANNAHME HAELT: kein angebotener Draht, {zahl} ausgehende(r) mit Grund.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
