#!/usr/bin/env python3
"""Die Spielelisten stehen an je drei Orten — decken sie sich?

WOZU
────
Die Box hat ZWEI Spielorte, und jeder hat seine Liste:

  SPIELECKE   Controller, Vollbild (`schlange`, `memory`, `dreigewinnt`,
              `farben`). Einzelschalter seit 20.09.2026.
  SCHUBLADE   Tipp-Apps am Schirm (`memory`, `puzzle`, `rechnen`, `uhr`,
              `lesen`, `malen`, seit 03.09.2026). Einzelschalter ebenfalls
              seit 20.09.2026.

Jede Liste steht dreimal, und das ist kein Versehen:

  1. src/backend-api/src/spiele.ts   die WAHRHEIT. Der Server normalisiert
                                     danach und wirft jede Kennung weg, die
                                     dort nicht steht.
  2. NewDesign/app.js bzw. apps.js   was wirklich spielbar ist.
  3. tools/neu-vorschau.mjs          die Attrappe, die ohne gebauten Server
                                     auskommen soll.

WAS PASSIERT, WENN SIE AUSEINANDERLAUFEN — und warum es niemand merkt:

  * Kennung im Server umbenannt, in der Oberflaeche nicht: Der Server wirft
    den alten Schluessel beim naechsten Schreiben weg, und die Oberflaeche
    fragt nach einer Kennung, die es nicht mehr gibt. `!== false` sagt dann
    „an" — das Spiel laesst sich also NICHT MEHR ABSCHALTEN, und der
    Schalter in der Verwaltung wirkt trotzdem, nur auf nichts.
  * Neues Spiel nur in der Oberflaeche: Es steht auf der Box, kommt in der
    Verwaltung aber nicht vor. Wer es abschalten will, findet keinen Ort.
  * Neues Spiel nur in der Vorschau: Jede Wache misst gruen an einem Spiel,
    das es an der Box nicht gibt.

Keiner der drei Faelle erzeugt einen Fehler, und keiner faellt beim Bauen auf.

DASS `memory` IN BEIDEN LISTEN STEHT, IST KEIN FEHLER: Die Schubladen-App
zeigt Bilder aus der Bibliothek und will einen Finger, „Paare" in der
Spielecke zeigt Formen und will ein Steuerkreuz. Sie liegen in getrennten
Faechern der Datei (`spiele` und `apps`) — deshalb prueft dieses Werkzeug
jede Liste FUER SICH und nicht beide gegeneinander.

AUFRUF
    python3 tools/spiele-liste-deckung.py
    python3 tools/spiele-liste-deckung.py --pruefen   # Rueckgabe 1 bei Abweichung
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Je Liste: Anzeigename -> (Datei, Anker, an dem der Block beginnt)
LISTEN: dict[str, dict[str, tuple[str, str]]] = {
    "Spielecke": {
        "Server (spiele.ts)": ("src/backend-api/src/spiele.ts", "export const SPIELE_WERKE"),
        "Box (app.js)": ("NewDesign/app.js", "const SPIEL_ORDNUNG ="),
        "Vorschau (neu-vorschau.mjs)": ("tools/neu-vorschau.mjs", "const SPIEL_WERKE_VORSCHAU ="),
    },
    "Schublade": {
        "Server (spiele.ts)": ("src/backend-api/src/spiele.ts", "export const APP_WERKE"),
        "Box (apps.js)": ("NewDesign/apps.js", "const SCHUBLADE_APPS ="),
        "Vorschau (neu-vorschau.mjs)": ("tools/neu-vorschau.mjs", "const APP_WERKE_VORSCHAU ="),
    },
}


def block(text: str, anker: str) -> str:
    """Von `anker` bis zur schliessenden Klammer der Liste.

    ABSICHTLICH UEBER KLAMMERN GEZAEHLT und nicht bis zur ersten `]`: Die
    Schubladen-Apps tragen SVG-Pfade und verschachtelte Werte; wer bis zur
    ersten schliessenden Klammer liest, bekommt die halbe Liste und haelt
    den Rest fuer geloescht.
    """
    start = text.find(anker)
    if start < 0:
        return ""
    # NICHT die erste `[` nach dem Anker: In TypeScript steht dort die
    # TYPANGABE (`readonly SpielWerk[] = [`), und wer die nimmt, liest ein
    # leeres Klammerpaar und meldet „nichts gefunden". Gesucht wird deshalb
    # die Klammer NACH dem Gleichheitszeichen.
    gleich = text.find("= [", start)
    auf = gleich + 2 if gleich >= 0 else -1
    if auf < 0:
        return ""
    tiefe = 0
    for i in range(auf, len(text)):
        if text[i] == "[":
            tiefe += 1
        elif text[i] == "]":
            tiefe -= 1
            if tiefe == 0:
                return text[auf : i + 1]
    return ""


def kennungen(pfad: str, anker: str) -> list[str]:
    datei = WURZEL / pfad
    if not datei.exists():
        raise SystemExit(f"FEHLER  {pfad} gibt es nicht — der Baum sieht anders aus als erwartet")
    b = block(datei.read_text(encoding="utf-8"), anker)
    if not b:
        return []
    mit_namen = re.findall(r"\bid:\s*'([a-z]+)'", b)
    if mit_namen:
        return mit_namen
    # Eine reine Namensliste (`['schlange', 'memory', …]`).
    return re.findall(r"'([a-z]+)'", b)


def main() -> int:
    pruefen = "--pruefen" in sys.argv
    abweichungen = 0

    for liste, orte in LISTEN.items():
        print(f"── {liste} ──")
        gefunden: dict[str, list[str]] = {}
        for name, (pfad, anker) in orte.items():
            ids = kennungen(pfad, anker)
            gefunden[name] = ids
            print(f"  {name:32s} {', '.join(ids) if ids else '— NICHTS GEFUNDEN'}")
            if not ids:
                # EINE LEERE LISTE IST EIN BEFUND UND KEIN „passt schon": Wer
                # den Anker mit einem Umbau kaputtmacht, bekaeme sonst eine
                # gruene Wache, die gar nichts mehr misst.
                print(f"  FEHLER  in {pfad}: keine einzige Kennung beim Anker {anker!r} — die Wache misst nichts")
                abweichungen += 1

        mengen = {n: set(i) for n, i in gefunden.items() if i}
        if len(mengen) > 1:
            erste = next(iter(mengen))
            for name, menge in mengen.items():
                if menge == mengen[erste]:
                    continue
                fehlt = sorted(mengen[erste] - menge)
                zuviel = sorted(menge - mengen[erste])
                print(f"  FEHLER  {name} weicht von {erste} ab: fehlt {fehlt or '—'}, zuviel {zuviel or '—'}")
                abweichungen += 1

        # UND DIE REIHENFOLGE gegen den Server: Sie ist zwar nur Ansicht, aber
        # eine Auswahl, die anders sortiert ist als die Verwaltung, laesst
        # einen Betreiber am Geraet das falsche Spiel abschalten.
        server = gefunden.get("Server (spiele.ts)") or []
        for name, ids in gefunden.items():
            if name.startswith("Box") and server and ids and server != ids:
                print(f"  HINWEIS Reihenfolge weicht ab: Server {server} / {name} {ids}")
        print()

    print(f"  {abweichungen} Abweichung(en)" if abweichungen else "  ohne Abweichung")
    return 1 if (pruefen and abweichungen) else 0


if __name__ == "__main__":
    raise SystemExit(main())
