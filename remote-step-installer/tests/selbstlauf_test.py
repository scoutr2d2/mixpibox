#!/usr/bin/env python3
"""Tests fuer den Selbstlauf — vor allem: haengt er sich auf?

DER ANLASS: Am 09.08.2026 stand die Box neun Minuten lang bei Last 0,01 und
0 kB/s. `systemctl enable --now mupibox-touch-bridge` wartete auf einen
Dienst, der auf den Selbstlauf wartete — und der Selbstlauf hatte keine
Grenze, die das beendet haette. Es GAB einen `timeout:`-Mechanismus, aber er
konnte nicht greifen: die Ausgabe wurde erst vollstaendig gelesen
(`for zeile in p.stdout`) und danach `p.wait(timeout=...)` gerufen. Ein
haengender Schritt schreibt nichts und schliesst nichts — die Schleife endete
nie, die Grenze wurde nie erreicht.

Hier laufen deshalb ECHTE Prozesse, die wirklich haengen. Ein Test mit
Attrappen haette den Fehler nie gefunden: die Attrappe schliesst brav ihre
Ausgabe.

  python3 tests/selbstlauf_test.py       # exit 0 = alles gruen
"""
import importlib.util
import os
import sys
import tempfile
import time

_HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "selbstlauf", os.path.join(_HIER, "tools", "selbstlauf.py"))
sl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sl)

# Nicht nach /var/lib schreiben, wenn hier jemand ohne Rechte testet.
sl.PROTOKOLL = os.path.join(tempfile.mkdtemp(), "lauf.log")

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


print("── Ein Schritt, der einfach seine Arbeit tut ──")
_t0 = time.time()
code, ab = sl.schritt_fahren({"run": "echo hallo; exit 0"}, "")
chk("Rueckgabe 0 wird durchgereicht", code == 0)
chk("nicht als abgelaufen gemeldet", ab is False)
chk("und es ging schnell", time.time() - _t0 < 5)

code, ab = sl.schritt_fahren({"run": "echo kaputt >&2; exit 7"}, "")
chk("ein Fehlercode kommt unveraendert an", code == 7 and ab is False)

print("\n── Ein Schritt, der HAENGT und dabei schweigt ──")
# Genau der Fall der Touch-Bruecke: laeuft, sagt nichts, schliesst nichts.
# Der alte Code haette hier bis in alle Ewigkeit gewartet.
_t0 = time.time()
code, ab = sl.schritt_fahren({"run": "sleep 300"}, "", leerlaufgrenze=3)
_dauer = time.time() - _t0
chk("die Leerlaufgrenze beendet ihn", ab is True and code == 124)
chk(f"und zwar zuegig ({_dauer:.0f} s statt 300)", _dauer < 20)

print("\n── Ein Schritt, der redet, darf weiterreden ──")
# Wer alle 0,5 s etwas sagt, arbeitet — den darf die Leerlaufgrenze NICHT
# treffen, auch wenn sie knapp steht. Sonst wuerde ein langsamer, aber
# gesunder Posten mitten in der Arbeit erschlagen.
_t0 = time.time()
code, ab = sl.schritt_fahren(
    {"run": "for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 0.5; done"},
    "", leerlaufgrenze=3)
chk("er laeuft zu Ende, obwohl die Grenze knapp ist", ab is False and code == 0)
chk("und hat laenger gebraucht als die Grenze", time.time() - _t0 > 3)

print("\n── Die Gesamtgrenze faengt den Dauerlaeufer ──")
# Dieser redet ununterbrochen — die Leerlaufgrenze greift also nie. Trotzdem
# darf er den Lauf nicht ewig festhalten.
_t0 = time.time()
code, ab = sl.schritt_fahren({"run": "while :; do echo lala; sleep 0.2; done"},
                             "", zeitgrenze=3, leerlaufgrenze=0)
chk("die Gesamtgrenze beendet ihn", ab is True and code == 124)
chk(f"und zwar zuegig ({time.time() - _t0:.0f} s)", time.time() - _t0 < 20)

print("\n── Die Enkel sterben mit ──")
# `run:` ist eine Shell. Ein SIGTERM nur an sie liesse apt/systemctl am
# Leben, und die halten dann die Paketsperren — die naechste Box haengt an
# einer Sperre, deren Halter niemand mehr findet.
_marke = os.path.join(tempfile.mkdtemp(), "enkel-lebt")
sl.schritt_fahren(
    {"run": f"( while :; do touch {_marke}; sleep 0.3; done ) & sleep 300"},
    "", leerlaufgrenze=3)
time.sleep(1.5)
_vorher = os.path.exists(_marke) and os.path.getmtime(_marke)
time.sleep(1.5)
chk("kein Enkel schreibt nach dem Abwuergen weiter",
    not _vorher or os.path.getmtime(_marke) == _vorher)

print("\n── Grenzen sind je Schritt abschaltbar ──")
# Fuer den einen Posten, der wirklich stundenlang stumm rechnen darf.
_t0 = time.time()
code, ab = sl.schritt_fahren({"run": "sleep 1"}, "", zeitgrenze=0, leerlaufgrenze=0)
chk("mit 0 laeuft er ungestoert durch", ab is False and code == 0)

# Und ohne Angabe gelten die Vorgaben — nicht "gar keine Grenze", wie es
# vor dem 09.08.2026 der Fall war.
chk("ohne Angabe gilt eine Leerlaufgrenze", sl.LEERLAUF_GRENZE > 0)
chk("ohne Angabe gilt eine Gesamtgrenze", sl.GESAMT_GRENZE > 0)
chk("die Leerlaufgrenze ist die schaerfere von beiden",
    sl.LEERLAUF_GRENZE < sl.GESAMT_GRENZE)

print("\n── Die Meldung muss lesbar sein ──")
# "laeuft seit 0 Minuten" ist keine Auskunft, sondern ein Rechenfehler zum
# Mitlesen. Unter einer Minute wird in Sekunden gesagt.
chk("unter einer Minute in Sekunden", sl._dauer_sagen(12) == "12 Sekunden")
chk("eine Minute steht im Singular", sl._dauer_sagen(90) == "1 Minute")
chk("mehrere im Plural", sl._dauer_sagen(605) == "10 Minuten")

print("\n── Am Ende wird EINMAL neu gestartet, nicht immer wieder ──")
# DER GEFAEHRLICHSTE TEIL DIESER DATEI. Die Unit laeuft bei JEDEM Start,
# damit sie einen unterbrochenen Lauf fortsetzen kann. Steht schon alles,
# kommt sie trotzdem bis ans Ende — ein bedingungsloser Neustart waere eine
# Schleife, aus der die Box nie wieder herausfaende.
#
# UND: DIESER TEST DARF NIEMALS DEN RECHNER HERUNTERFAHREN, auf dem er
# laeuft. Stillgelegt wird deshalb die EINE benannte Naht
# `neustart_ausloesen` — nicht `subprocess.run` im Modul. Der frueheren
# Fassung griff der Schutz nur zufaellig: haette jemand den Neustart auf
# `os.system` umgestellt, waere beim naechsten Testlauf der Arbeitsrechner
# ausgegangen. Die Zusicherung unten prueft VOR dem Lauf, dass die Naht
# wirklich ersetzt ist — sonst bricht der Test ab, statt es darauf ankommen
# zu lassen.
_rufe = []
_echt_neustart = sl.neustart_ausloesen
sl.neustart_ausloesen = lambda: _rufe.append("reboot")
assert sl.neustart_ausloesen is not _echt_neustart, \
    "ABBRUCH: der Neustart ist nicht stillgelegt — das haette den Rechner heruntergefahren"
_d = tempfile.mkdtemp()
sl.STAND_DATEI = os.path.join(_d, "stand.json")
_rezept = {"steps": [{"id": "nichts", "run": "true"}]}
_lauf = tempfile.mkdtemp()
with open(os.path.join(_lauf, "rezept.json"), "w") as f:
    import json as _json
    _json.dump(_rezept, f)
try:
    sl.fahren(_lauf, stand_datei=sl.STAND_DATEI)
    chk("erster Durchlauf startet neu", "reboot" in _rufe)
    chk("und hinterlaesst die Marke",
        os.path.exists(os.path.join(_d, "fertig")))
    _rufe.clear()
    sl.fahren(_lauf, stand_datei=sl.STAND_DATEI)
    chk("zweiter Durchlauf startet NICHT neu — keine Schleife",
        "reboot" not in _rufe)
finally:
    sl.neustart_ausloesen = _echt_neustart

# DER ZWEITE RIEGEL, und der wirkt auch ohne Test-Attrappe: der ECHTE
# Neustart weigert sich auf allem, was keine Box ist. Hier wird er also
# wirklich aufgerufen — und darf nichts tun. Auf einem Arbeitsrechner gibt
# es weder /boot/dietpi noch /etc/mupibox.
if not (os.path.isdir("/boot/dietpi") or os.path.isdir("/etc/mupibox")):
    _t0 = time.time()
    sl.neustart_ausloesen()
    chk("der echte Neustart weigert sich ausserhalb einer Box",
        time.time() - _t0 < 2)
else:
    print("  \033[33mHINWEIS\033[0m  laeuft auf einer Box — Neustart-Riegel nicht geprueft")

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
