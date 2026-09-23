#!/usr/bin/env python3
"""Ruft die AUSGELIEFERTE Oberflaeche Wege, die der LAUFENDE Server nicht kennt?

WOZU (Muster A: AUSGELIEFERT, ABER NICHT DA — die Variante mit zwei Haelften)
`tools/ausliefern.py` kennt vier Ziele: server, player, www, admin. Sie werden
EINZELN ausgeliefert. Wer nur `www` ausliefert, hat eine Oberflaeche auf der
Box, die zu einem Server spricht, der aelter ist als sie.

Das faellt in keinem Test auf. Im Baum passen beide Haelften zusammen, die
Tests bauen beide frisch, und `git status` ist sauber. Nur auf der Box liegen
zwei Staende nebeneinander — und der Fehler zeigt sich erst, wenn ein Kind
einen Knopf drueckt, hinter dem ein 404 steht.

GEMESSEN am 08.08.2026: www lag vom 21:32 auf der Box, server.js vom 20:44.
Der Bauordner src/deploy/server.js (21:31) hatte `/api/profil/merken`, die
Box nicht. `PUT /api/profil/merken` an die laufende Box: 404.

WAS DAS WERKZEUG TUT
  1. Es liest die /api-Wege aus den ausgelieferten Frontend-Buendeln (www und
     www-admin auf der BOX, nicht im Baum).
  2. Es liest die registrierten Wege aus dem ausgelieferten server.js.
  3. Es fragt fuer jeden gerufenen Weg den LAUFENDEN Server (OPTIONS, damit
     nichts geschrieben wird).

WARUM ALLE DREI. Schritt 1 gegen 2 ist ein Textvergleich und kann irren
(Wege, die aus Bausteinen zusammengesetzt werden, stehen nirgends ganz da).
Schritt 3 fragt das laufende Programm — aber nur er allein wuerde jeden Weg
uebersehen, den die Oberflaeche zwar kennt, heute Nacht aber nicht ruft.

NUR LESEND. Es schickt ausschliesslich GET/OPTIONS und schreibt nichts —
weder auf die Box noch in eine Konfiguration.

    python3 tools/oberflaeche-gegen-server.py
    python3 tools/oberflaeche-gegen-server.py --box dietpi@192.168.178.169
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

BOX_VORGABE = "dietpi@192.168.178.169"
FERN = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"

# Wie ein Weg in einem gebauten Buendel aussieht. Beide Anfuehrungsarten und
# der Anfang eines Schablonentextes (`/api/x/${...}`) werden erfasst.
WEG = re.compile(r"""["'`](/api/[A-Za-z0-9_./:-]*)""")

# Wie eine Registrierung im gebauten server.js aussieht: `.get("/api/…"`.
ROUTE = re.compile(r"""\.(get|put|post|delete|patch|all)\(["'](/api/[A-Za-z0-9_./:-]+)["']""")

# Wege, die kein fester Text sind, sondern zusammengesetzt werden. Sie enden
# im Buendel als Bruchstueck und wuerden sonst als "fehlt" gemeldet.
BRUCHSTUECK = re.compile(r"/api/?$|/$")


def am_geraet(box: str, befehl: str) -> str:
    """Einen Lesebefehl auf der Box ausfuehren."""
    fertig = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=8", box, befehl],
        capture_output=True,
        text=True,
    )
    return fertig.stdout


def wege_der_oberflaeche(box: str, ordner: str) -> set[str]:
    """Jeden /api-Weg aus den ausgelieferten Buendeln eines Ordners."""
    text = am_geraet(box, f"cat {FERN}/{ordner}/*.js 2>/dev/null")
    gefunden = set()
    for treffer in WEG.findall(text):
        if BRUCHSTUECK.search(treffer):
            continue
        gefunden.add(treffer.rstrip("/"))
    return gefunden


def wege_des_servers(box: str) -> set[str]:
    """Jeden registrierten /api-Weg aus dem ausgelieferten server.js."""
    text = am_geraet(box, f"cat {FERN}/server.js")
    return {weg for _, weg in ROUTE.findall(text)}


def teil_passt(muster: str, teil: str) -> bool:
    """Ein Wegstueck gegen ein Musterstueck — `:id` und `datei.:format`."""
    if muster == teil:
        return True
    if muster.startswith(":"):
        return True
    # `protokoll.:format` trifft `protokoll.csv`
    if ".:" in muster:
        return teil.startswith(muster.split(".:")[0] + ".")
    return False


def passt_auf_muster(weg: str, muster: set[str]) -> bool:
    """Trifft ein gerufener Weg eine Registrierung mit Platzhalter?"""
    wt = [t for t in weg.split("/") if t]
    for m in muster:
        mt = [t for t in m.split("/") if t]
        if len(mt) != len(wt):
            continue
        if all(teil_passt(a, b) for a, b in zip(mt, wt)):
            return True
    return False


def lebend_fragen(adresse: str, weg: str) -> str:
    """Den LAUFENDEN Server fragen — mit GET, ohne etwas zu schreiben.

    WARUM NICHT OPTIONS: gemessen am 08.08.2026 antwortet dieser Server auf
    OPTIONS mit 204, egal ob es den Weg gibt. Die Zahl saehe gesund aus und
    waere ohne jeden Aussagewert.

    WARUM DIE ART DES INHALTS ZAEHLT, NICHT DIE ZAHL: auf einen unbekannten
    /api-Weg antwortet dieser Server mit 200 und der START SEITE (text/html) —
    der Auffang der Oberflaeche greift vor dem 404. Fuer den Rufer heisst das
    `res.ok === true` und ein Rumpf, der kein JSON ist. Genau daran erkennt
    man den fehlenden Weg, nicht an der Zahl.
    """
    bitte = urllib.request.Request(f"{adresse}{weg}", method="GET")
    try:
        with urllib.request.urlopen(bitte, timeout=8) as antwort:
            art = antwort.headers.get("Content-Type", "")
            if "text/html" in art:
                return f"{antwort.status} ABER HTML — Startseite statt Antwort"
            return f"{antwort.status} {art.split(';')[0]}"
    except urllib.error.HTTPError as fehler:
        return str(fehler.code)
    except Exception as fehler:  # Netz weg, Zeit um
        return f"?{type(fehler).__name__}"


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__)
    zerleger.add_argument("--box", default=BOX_VORGABE)
    zerleger.add_argument("--adresse", default=None, help="Vorgabe: http://<box-rechner>:8200")
    zerleger.add_argument("--json", action="store_true")
    wahl = zerleger.parse_args()

    rechner = wahl.box.split("@")[-1]
    adresse = wahl.adresse or f"http://{rechner}:8200"

    registriert = wege_des_servers(wahl.box)
    if not registriert:
        print("Kein server.js auf der Box gelesen — Abbruch.", file=sys.stderr)
        return 2

    bericht: dict[str, dict] = {}
    fehlend: list[tuple[str, str, str]] = []

    for ordner in ("www", "www-admin"):
        gerufen = wege_der_oberflaeche(wahl.box, ordner)
        if not gerufen:
            continue
        offen = sorted(w for w in gerufen if not passt_auf_muster(w, registriert))
        bericht[ordner] = {"gerufen": len(gerufen), "ohne_route": offen}
        for weg in offen:
            lebt = lebend_fragen(adresse, weg)
            fehlend.append((ordner, weg, lebt))

    if wahl.json:
        print(json.dumps({"bericht": bericht, "lebend": fehlend}, indent=1, ensure_ascii=False))
        return 1 if fehlend else 0

    print(f"Server auf der Box kennt {len(registriert)} /api-Wege.\n")
    for ordner, zahlen in bericht.items():
        print(f"{ordner}: {zahlen['gerufen']} gerufene Wege, "
              f"{len(zahlen['ohne_route'])} ohne Route im server.js")
    if not fehlend:
        print("\nJeder gerufene Weg hat eine Route. Die Haelften passen zusammen.")
        return 0

    print("\nGERUFEN, ABER KEINE ROUTE (und was der laufende Server sagt):")
    for ordner, weg, lebt in fehlend:
        print(f"  {ordner:10s} {weg:40s} lebend: {lebt}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
