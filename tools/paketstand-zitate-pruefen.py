#!/usr/bin/env python3
"""PAKETSTAND-ZITATE — steht der Pin noch so im package.json, wie die Doku ihn abtippt?

WOZU (30.08.2026): der Doku-Lauf dieser Stunde fand die Probe gruen und
`ungerufene-wachen.py` leer. Was dann bleibt, ist die Frage, welche ACHSE
ueberhaupt keine Wache hat — eine gruene Probe belegt nur, dass IHRE Wachen
gruen sind (llmwiki: `eine-wache-die-eine-ablage-nicht-kennt-meldet-dort-ewig-gruen`).
Eine davon: die Prosa zitiert Abhaengigkeiten MIT IHREM PIN.

    > Was bleibt: Express **4** stimmt (`package.json` `^4.17.1`),
    > `backend-api` steht auf `^5.1.0`.                    (MODERNIZATION.md)

    | `"protobufjs": "^7.4.0"` | steht unter `dependencies` … |   (BACKLOG.md)

`doku-pfade-pruefen.py` sieht hier nur `package.json` und sagt: gibt es.
Niemand liest die Zahl daneben. Ein `npm update`, das `^4.17.1` auf `^4.21.2`
hebt, laesst die Datei am Platz und macht den Satz still falsch — und dieser
Satz ist genau der, auf den sich eine spaetere Sitzung beruft, wenn sie
entscheidet, ob der Express-Sprung noch aussteht. Der Schaden ist derselbe wie
beim toten Schalter: kein Fehler, nur eine Auskunft, die nicht mehr stimmt.

── WAS DER ERSTE LAUF FAND ────────────────────────────────────────────────
NICHTS — alle vier aufloesbaren Pins stimmen (Express `^4.17.1` in
`src/backend-player`, `^5.1.0` in `src/backend-api`, `protobufjs ^7.4.0` und
`protobufjs-cli ^1.1.3`). Das ist die ehrliche Auskunft und kein Grund, die
Wache wegzulassen; dieselbe Lage wie beim ersten Lauf von
`zitierte-schalter-pruefen.py`. Die Achse war ungeprueft, sie faellt still,
sie ist ab jetzt gehalten.

── WARUM NUR PIN-FORM UND KEINE NACKTE ZAHL ───────────────────────────────
Der Ausschlag faellt auf `^` und `~`, nicht auf jede `x.y.z` im Text. Das ist
kein Geiz, sondern der Unterschied zwischen zwei Aussagen:

    `spotify-web-api-node` … is abandoned (last release 4.0.0, ~2+ yr)

Das ist eine Aussage ueber den UPSTREAM, nicht ueber unseren Pin — unser Pin
ist `^5.0.0`. Eine Wache auf nackte Zahlen meldete diesen Satz jeden Lauf als
Fund, waere dauerrot und zu Recht ignoriert (llmwiki:
`dauerrote-wache-ist-keine`). `^` und `~` schreibt man nur, wenn man den
Eintrag im `package.json` meint.

── WAS SIE NICHT TUT, und warum das Absicht ist ───────────────────────────
  * Sie prueft die ZEICHENKETTE des Pins, nicht den installierten Stand.
    `^4.17.1` im Baum und 4.21.2 in `node_modules` ist kein Fund — die Doku
    zitiert den Pin, also wird der Pin geprueft.
  * Ein Pin, den KEIN `package.json` unter diesem Namen fuehrt, ist ein Fund;
    ein Pin, dessen Paketname sich nicht aufloesen liess, ist eine gemeldete
    ZAHL. Ein stiller Ausschluss liest sich wie Deckung.
  * Ein Paket in mehreren `package.json` mit verschiedenen Pins (Express: 4
    und 5) gilt als gedeckt, sobald EINE Datei den zitierten Pin fuehrt. Die
    Doku nennt den Ort meist im selben Satz, aber nicht maschinenlesbar; die
    Gegenrichtung waere ein Satzparser.
  * `AUDIT-JJJJ-MM-TT.md` sind Momentaufnahmen und bleiben draussen, aus
    demselben Grund wie bei `doku-pfade-pruefen.py`. Ihre Zahl wird gemeldet.

WARNUNG STATT GRUEN, wenn sie kein einziges aufloesbares Paar findet: dann
hat sich die Schreibweise geaendert und die Wache ist blind, nicht sauber.
"""

import json
import os
import re
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(WURZEL)

MOMENTAUFNAHME = re.compile(r"(^|/)AUDIT-\d{4}-\d{2}-\d{2}\.md$")
PIN = re.compile(r"[\^~]\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?")
# `"protobufjs": "^7.4.0"` — Name und Pin in EINEM Backtick-Stueck
PAAR_IM_STUECK = re.compile(r"[\"']([@A-Za-z0-9._/-]+)[\"']\s*:\s*[\"']([\^~][^\"']+)[\"']")
BACKTICK = re.compile(r"`([^`]+)`")


def git_dateien():
    aus = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.split("\n")
    return [p for p in aus if p]


def pakete_des_baums():
    """{paketname: {pin, ...}} ueber alle package.json ausserhalb node_modules."""
    gefunden = {}
    orte = {}
    for pfad in git_dateien():
        if os.path.basename(pfad) != "package.json":
            continue
        if "node_modules" in pfad.split("/"):
            continue
        try:
            with open(pfad, encoding="utf-8") as f:
                daten = json.load(f)
        except (OSError, ValueError):
            continue
        for feld in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name, pin in (daten.get(feld) or {}).items():
                gefunden.setdefault(name, set()).add(str(pin))
                orte.setdefault((name, str(pin)), set()).add(pfad)
    return gefunden, orte


def quellen():
    md = [p for p in git_dateien() if p.endswith(".md")]
    uebersprungen = [p for p in md if MOMENTAUFNAHME.search(p)]
    return [p for p in md if p not in uebersprungen], uebersprungen


def zitate(zeile, bekannt):
    """[(paketname|None, pin)] fuer eine Zeile."""
    ergebnis = []
    stuecke = BACKTICK.findall(zeile)
    # (1) Name und Pin im selben Backtick-Stueck
    verbraucht = set()
    for stueck in stuecke:
        for name, pin in PAAR_IM_STUECK.findall(stueck):
            ergebnis.append((name, pin.strip()))
            verbraucht.add(pin.strip())
    # (2) Pin allein — der naechste Paketname LINKS davon in derselben Zeile
    for m in PIN.finditer(zeile):
        pin = m.group(0)
        if pin in verbraucht:
            continue
        davor = zeile[: m.start()]
        kandidaten = [t for t in BACKTICK.findall(davor) if t in bekannt]
        if not kandidaten:
            # auch ohne Backticks: **Express** 4 … `^4.17.1`
            worte = re.findall(r"[@A-Za-z0-9._/-]+", davor)
            kandidaten = [w for w in worte if w in bekannt]
            kandidaten += [w.lower() for w in worte if w.lower() in bekannt]
        ergebnis.append((kandidaten[-1] if kandidaten else None, pin))
    return ergebnis


def main():
    bekannt, orte = pakete_des_baums()
    if not bekannt:
        print("WARNUNG: kein package.json gefunden — die Wache ist blind.")
        return 1

    dateien, uebersprungen = quellen()
    luecken = []
    unaufloesbar = []
    geprueft = 0

    for pfad in dateien:
        try:
            with open(pfad, encoding="utf-8") as f:
                zeilen = f.read().splitlines()
        except OSError:
            continue
        for nr, zeile in enumerate(zeilen, 1):
            if not PIN.search(zeile):
                continue
            for name, pin in zitate(zeile, bekannt):
                if name is None:
                    unaufloesbar.append((pfad, nr, pin))
                    continue
                geprueft += 1
                if pin not in bekannt.get(name, set()):
                    luecken.append((pfad, nr, name, pin, sorted(bekannt.get(name, set()))))

    print("── Zitierte Paketstaende gegen package.json ──")
    for pfad, nr, name, pin, ist in luecken:
        steht = ", ".join(ist) if ist else "gar nicht mehr gefuehrt"
        print(f"  VERALTETER PIN  {pfad}:{nr}  {name} zitiert {pin} — im Baum: {steht}")

    if unaufloesbar:
        print(f"  {len(unaufloesbar)} Pin-Nennung(en) ohne aufloesbaren Paketnamen (keine Luecke):")
        for pfad, nr, pin in unaufloesbar:
            print(f"      {pfad}:{nr}  {pin}")
    if uebersprungen:
        print(f"  {len(uebersprungen)} Momentaufnahme(n) AUDIT-*.md uebersprungen.")

    if geprueft == 0:
        print("WARNUNG: kein einziges aufloesbares Paar — die Schreibweise hat sich")
        print("geaendert, die Wache ist blind und nicht sauber.")
        return 1

    if luecken:
        return 1
    print(f"Kein veralteter Pin. {geprueft} Zitat(e) gegen den Baum gehalten.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
