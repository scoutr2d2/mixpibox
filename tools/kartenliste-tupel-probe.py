#!/usr/bin/env python3
"""Nachmessen: Was macht `_karten_gesetzt`, wenn es statt einer LISTE das
ganze TUPEL von `geraete.karten_finden()` bekommt?

WOZU: `geraete.karten_finden()` liefert seit jeher `(beschreibbar,
ausgeschlossen)` — zwei Listen. `sdstart._karten_thread` (Zeile 753/754)
packt heute NUR die erste in die Warteschlange:

    gefunden = geraete.karten_finden()
    liste = gefunden[0] if isinstance(gefunden, tuple) else gefunden

Wer beim Umbau die Ausschlussgruende MIT anzeigen will, braucht die zweite
Liste — und der kuerzeste Weg dorthin ist, das Tupel unbesehen
weiterzureichen. `_karten_gesetzt` nimmt es dann mit `self.karten = liste or
[]` (Zeile 760) genauso an, und `len()` zaehlt danach die beiden LISTEN
statt der Karten.

Diese Probe misst genau das — und zwar auch die Faelle, in denen es GAR
KEINE zwei Karten gibt (eine Karte, keine Karte). Wenn dort ebenfalls
„2 Wechseldatenträger gefunden" steht, haengt die Zahl nachweislich an der
Tupelbreite und nicht an den Karten.

Sie laeuft auf einem EIGENEN Xvfb-Display (die Vorschau des Betreibers wird
nicht angefasst) und ruft KEINE modalen Dialoge auf.

AUFRUF
    python3 tools/kartenliste-tupel-probe.py     # Ende 0 = Nebenwirkung belegt
"""
import json
import os
import subprocess
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HIER)
# Gegen einen ANDEREN Baum messen (z. B. eine gepatchte Kopie im Kratzplatz):
#     KARTEN_CTRL=/pfad/zu/controller python3 tools/kartenliste-tupel-probe.py
CTRL = os.environ.get("KARTEN_CTRL") or os.path.join(
    REPO, "remote-step-installer", "controller")

KARTE = {"pfad": "/dev/sda", "name": "sda", "modell": "MassStorageClass",
         "groesse": "238,3G", "wechselbar": True}
LEER = {"pfad": "/dev/sdb", "name": "sdb", "modell": "MassStorageClass",
        "groesse": "0B", "wechselbar": True, "grund": "kein Medium"}


def messen(wert_ausdruck):
    """`_karten_gesetzt(<wert_ausdruck>)` fahren -> was steht auf der Seite?

    Im Unterprozess, weil Tk ein Display braucht und ein Absturz dieser
    Messung nicht die ganze Probe mitnehmen soll.
    """
    code = (
        "import json,sys\n"
        f"sys.path.insert(0, {CTRL!r})\n"
        "import sdstart\n"
        f"KARTE = json.loads({json.dumps(json.dumps(KARTE))})\n"
        f"LEER = json.loads({json.dumps(json.dumps(LEER))})\n"
        "f = sdstart.Fenster(probe=True)\n"
        "f.withdraw()\n"
        "f.board = 'RPi5'\n"
        "f._seite_karte()\n"
        "f.update_idletasks()\n"
        "fehler = None\n"
        "try:\n"
        f"    f._karten_gesetzt({wert_ausdruck})\n"
        "except Exception as e:\n"
        "    fehler = repr(e)\n"
        "f.update_idletasks()\n"
        "print('ERG' + json.dumps({'fehler': fehler,\n"
        "                  'gewaehlt': (f.karte or {}).get('pfad'),\n"
        "                  'knopf_frei': bool(f.knopf.an),\n"
        "                  'gross': f.l_karte.cget('text'),\n"
        "                  'klein': f.l_wo.cget('text')}))\n"
        "f.destroy()\n")
    r = subprocess.run(["xvfb-run", "-a", "-s", "-screen 0 1024x900x24",
                        sys.executable, "-c", code],
                       capture_output=True, text=True, timeout=180)
    for zeile in reversed((r.stdout or "").splitlines()):
        if zeile.startswith("ERG{"):
            return json.loads(zeile[3:])
    print("    (Tk-Messung ging nicht:)")
    print("    " + (r.stderr or "")[-1200:].replace("\n", "\n    "))
    return None


FAELLE = [
    ("A  nackte Liste, zwei Traeger (der Fall von heute)", "[KARTE, LEER]"),
    ("B  nackte Liste, nur die echte Karte (der Sollzustand)", "[KARTE]"),
    ("C  TUPEL (ok, ausgeschlossen) — eine Karte, ein Schacht", "([KARTE], [LEER])"),
    ("D  TUPEL, eine Karte, NICHTS ausgeschlossen", "([KARTE], [])"),
    ("E  TUPEL, gar kein Traeger am Rechner", "([], [])"),
]

print("══ Was `_karten_gesetzt` aus dem Uebergebenen macht ═══════════════════")
gemessen = {}
for name, ausdruck in FAELLE:
    e = messen(ausdruck)
    gemessen[name] = e
    print(f"\n  {name}")
    print(f"    uebergeben : {ausdruck}")
    if e is None:
        print("    UNGEMESSEN")
        continue
    if e["fehler"]:
        print(f"    FEHLER     : {e['fehler']}")
    print(f"    gewaehlt   : {e['gewaehlt']}")
    print(f"    Knopf frei : {e['knopf_frei']}")
    print(f"    Anzeige    : {e['gross']!r}")
    print(f"                 {e['klein']!r}")

MELDUNG = "2 Wechseldatenträger gefunden"
fehler = []
a = gemessen[FAELLE[0][0]]
b = gemessen[FAELLE[1][0]]
c = gemessen[FAELLE[2][0]]
d = gemessen[FAELLE[3][0]]
e5 = gemessen[FAELLE[4][0]]

if not a or a["gross"] != MELDUNG:
    fehler.append("A: die heutige Meldung ist gar nicht die behauptete.")
if not b or b["gross"] == MELDUNG or not b["knopf_frei"]:
    fehler.append("B: eine einzelne Karte fuehrt nicht zum freien Knopf — "
                  "dann ist der Vergleich schief.")
if not c or c["gross"] != MELDUNG:
    fehler.append("C: das Tupel bringt die Meldung NICHT zurueck — "
                  "die Nebenwirkung ist widerlegt.")
if c and c["knopf_frei"]:
    fehler.append("C: der Knopf bleibt NICHT zu — die Folge ist eine andere.")
for kennung, mess in (("D", d), ("E", e5)):
    if mess and mess["gross"] == MELDUNG:
        print(f"\n  ACHTUNG ({kennung}): Auch OHNE zwei Traeger steht dort {MELDUNG!r}. "
              f"Die Zahl 2 ist die Breite des Tupels, nicht die Zahl der Karten.")

print("\n══ ERGEBNIS ═══════════════════════════════════════════════════════════")
for f in fehler:
    print("FEHLER: " + f)
if not fehler:
    print("Die Nebenwirkung ist belegt: das ganze Tupel an `_karten_gesetzt` "
          "bringt exakt die Meldung zurueck, die repariert werden soll,\n"
          "und der Schreibknopf bleibt zu.")
sys.exit(1 if fehler else 0)
