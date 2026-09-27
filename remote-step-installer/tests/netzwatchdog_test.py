#!/usr/bin/env python3
"""
Tests fuer tools/mupibox-netz-watchdog.py — reine Entscheidungslogik.

Der Watchdog hat genau eine Aufgabe, und die muss er in dem Moment richtig
machen, in dem niemand mehr zusieht. Deshalb wird hier die ENTSCHEIDUNG
geprueft, nicht das Kopieren von Dateien.

  python3 tests/netzwatchdog_test.py
"""
import importlib.util
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location(
    "wd", os.path.join(REPO, "tools", "mupibox-netz-watchdog.py")
)
wd = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(wd)

ok = bad = 0


def pruefe(name, ist, soll):
    global ok, bad
    if ist == soll:
        ok += 1
    else:
        bad += 1
        print(f"  FEHLER {name}: {ist!r} statt {soll!r}")


# ── frist_klemmen ─────────────────────────────────────────────────────────
# Unter 30 s schafft es kein Mensch zu bestaetigen; ueber 30 min ist es kein
# Sicherheitsnetz mehr, sondern eine Zeitbombe.
pruefe("normale Frist bleibt", wd.frist_klemmen(120), 120)
pruefe("zu kurz wird angehoben", wd.frist_klemmen(5), wd.FRIST_MIN)
pruefe("zu lang wird gedeckelt", wd.frist_klemmen(99999), wd.FRIST_MAX)
pruefe("Unsinn wird zum Mindestwert", wd.frist_klemmen("abc"), wd.FRIST_MIN)
pruefe("None wird zum Mindestwert", wd.frist_klemmen(None), wd.FRIST_MIN)
pruefe("Text mit Zahl geht", wd.frist_klemmen("120"), 120)

# ── marker_bauen / marker_lesen ───────────────────────────────────────────
m = wd.marker_bauen(1000, 120, "WLAN gewechselt")
pruefe("faellig = jetzt + Frist", m["faellig"], 1120)
pruefe("Grund bleibt erhalten", m["grund"], "WLAN gewechselt")
pruefe("Runde durch JSON", wd.marker_lesen(json.dumps(m)), m)

# Ein halb geschriebener Marker darf den Rollback beim naechsten Start nicht
# auf ewig scheitern lassen — unlesbar heisst „kein Marker".
for kaputt in ["", "{", "null", "[]", '"text"', '{"frist":1}', '{"faellig":"bald"}']:
    pruefe(f"unlesbar -> None ({kaputt[:14]})", wd.marker_lesen(kaputt), None)

# ── restsekunden ──────────────────────────────────────────────────────────
pruefe("Rest ohne Marker", wd.restsekunden(None, 1000), None)
pruefe("Rest bei Halbzeit", wd.restsekunden(m, 1060), 60)
pruefe("Rest wird nicht negativ", wd.restsekunden(m, 9999), 0)
pruefe("Rest direkt nach dem Scharfstellen", wd.restsekunden(m, 1000), 120)

# ── soll_zurueckrollen: die eigentliche Entscheidung ──────────────────────
pruefe("ohne Marker niemals", wd.soll_zurueckrollen(None, 9999), False)
pruefe("vor Ablauf nicht", wd.soll_zurueckrollen(m, 1119), False)
pruefe("genau bei Ablauf ja", wd.soll_zurueckrollen(m, 1120), True)
pruefe("nach Ablauf ja", wd.soll_zurueckrollen(m, 5000), True)

# Beim Start IMMER, sobald ein Marker existiert: dass die Box neu gestartet
# ist, ohne dass jemand bestaetigt hat, ist genau der Fall, fuer den es den
# Watchdog gibt — der fluechtige Zeitgeber hat den Neustart nicht ueberlebt.
pruefe("beim Start auch VOR Ablauf", wd.soll_zurueckrollen(m, 1001, beim_start=True), True)
pruefe("beim Start ohne Marker nicht", wd.soll_zurueckrollen(None, 1001, beim_start=True), False)

print(f"\nnetz-watchdog: {ok} bestanden, {bad} fehlgeschlagen")
sys.exit(1 if bad else 0)
