#!/usr/bin/env python3
"""
Tests fuer agent.put_file — die Dateiuebernahme.

Anlass: ein Aufruf mit mode=0o755 (Python-Literal) liess `int(str(mode), 8)`
mit ValueError auffliegen. Gefangen wurde nur OSError, also starb der
Anfrage-Handler, und der Controller sah lediglich "Remote end closed
connection without response". Man sucht den Fehler dann im Tunnel oder im
Netz — an der falschen Stelle, minutenlang. Ein falscher Parameter darf eine
saubere Fehlermeldung ergeben, niemals einen Verbindungsabbruch.

  python3 tests/put_test.py       # exit 0 = alles gruen
"""
import base64
import importlib.util
import os
import stat
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location("ag", os.path.join(REPO, "agent", "agent.py"))
ag = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(ag)

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


b64 = lambda s: base64.b64encode(s.encode()).decode()

with tempfile.TemporaryDirectory() as t:
    ziel = os.path.join(t, "unter", "datei.sh")

    # ── der Fall, der den Agenten umgebracht hat ──────────────────────────
    r = ag.put_file(ziel, b64("#!/bin/sh\necho hallo\n"), mode=0o755)
    chk("int-Modus 0o755 wird angenommen (nicht als '493' gelesen)", r.get("ok") is True)
    chk("Datei liegt da", os.path.isfile(ziel))
    chk("Rechte sind 755", stat.S_IMODE(os.stat(ziel).st_mode) == 0o755)

    # ── die dokumentierte Form ────────────────────────────────────────────
    r = ag.put_file(ziel, b64("x"), mode="644")
    chk("Zeichenkette '644' wird oktal gelesen", r.get("ok") is True)
    chk("Rechte sind 644", stat.S_IMODE(os.stat(ziel).st_mode) == 0o644)

    # ── Unsinn: sauberer Fehler, KEIN Absturz ─────────────────────────────
    for schlecht in ("999", "abc", "0x1ff", [], {}):
        r = ag.put_file(ziel, b64("x"), mode=schlecht)
        chk(f"mode={schlecht!r} ergibt einen Fehler statt eines Absturzes", bool(r.get("error")))

    # Verzeichnisse werden angelegt, Inhalt stimmt
    tief = os.path.join(t, "a", "b", "c.txt")
    ag.put_file(tief, b64("inhalt"), mode=None)
    chk("legt fehlende Verzeichnisse an", os.path.isfile(tief))
    chk("Inhalt kommt unveraendert an", open(tief).read() == "inhalt")

    # kein Modus -> Standardrechte, kein Fehler
    r = ag.put_file(os.path.join(t, "ohne.txt"), b64("y"))
    chk("ohne Modus geht es auch", r.get("ok") is True)

    # keine .part-Reste (os.replace ist atomar, aber ein Fehlschlag darf nichts liegen lassen)
    reste = [p for p, _, fs in os.walk(t) for f in fs if f.endswith(".part")]
    chk("keine .part-Reste", not reste)

    # ── Wachposten ────────────────────────────────────────────────────────
    r = ag.put_file("relativ/pfad", b64("x"))
    chk("relativer Pfad wird abgewiesen", bool(r.get("error")))
    r = ag.put_file(os.path.join(t, "k.txt"), "kein base64!!")
    chk("kaputtes base64 wird abgewiesen", bool(r.get("error")))
    r = ag.put_file(os.path.join(t, "gross.txt"), b64("x" * (ag.MAX_PUT_BYTES + 1)))
    chk("zu grosse Datei wird abgewiesen", bool(r.get("error")))

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
