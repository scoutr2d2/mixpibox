#!/usr/bin/env python3
"""
Tests fuer die Touch-Bruecke (tools/mupibox-touch-bridge.py) — reine Arithmetik
und Ausstiegswege, KEINE Hardware.

Der Anlass fuer die Drehung war real: eine Beruehrung OBEN LINKS meldete
x~750 y~415 (beide Achsen nahe Maximum) — der Controller sitzt im Gehaeuse
180 Grad verdreht zum Panel. Die vorherige Pruefung hatte nur die WERTEBEREICHE
verglichen (0..800 x 0..480) und den Versatz deshalb nicht bemerkt.

  python3 tests/touchbridge_test.py
"""
import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location("tb", os.path.join(REPO, "tools", "mupibox-touch-bridge.py"))
tb = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(tb)

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


class Geraet(tb.Eingabegeraet):
    """Nur die Rechenteile — ohne /dev/uinput."""
    def __init__(self, drehung, b=800, h=480):
        self.roh_b, self.roh_h, self.drehung = b, h, drehung % 360


# ── Drehung ────────────────────────────────────────────────────────────────
g0, g180 = Geraet(0), Geraet(180)
chk("ohne Drehung bleibt alles, wie es ist", g0.dreh(123, 45) == (123, 45))
chk("180 Grad: die gemessene Ecke landet OBEN LINKS", g180.dreh(750, 415) == (49, 64))
chk("180 Grad: roh oben-links -> unten-rechts", g180.dreh(0, 0) == (799, 479))
chk("180 Grad: roh unten-rechts -> oben-links", g180.dreh(799, 479) == (0, 0))
chk("180 Grad ist seine eigene Umkehrung",
    g180.dreh(*g180.dreh(321, 99)) == (321, 99))

g90, g270 = Geraet(90), Geraet(270)
chk("90 Grad bleibt im gedrehten Bildbereich",
    all(0 <= x < 480 and 0 <= y < 800 for x, y in
        (g90.dreh(0, 0), g90.dreh(799, 479), g90.dreh(400, 240))))
chk("270 Grad ebenso",
    all(0 <= x < 480 and 0 <= y < 800 for x, y in
        (g270.dreh(0, 0), g270.dreh(799, 479), g270.dreh(400, 240))))
chk("90 und 270 heben sich auf",
    g90.dreh(*Geraet(270, 480, 800).dreh(123, 456)) == (123, 456))
chk("jede Ecke bleibt eine Ecke (180)",
    sorted(g180.dreh(x, y) for x, y in ((0, 0), (799, 0), (0, 479), (799, 479)))
    == sorted(((0, 0), (799, 0), (0, 479), (799, 479))))

# ── Ausstiegswege: fehlende Hardware ist KEIN Fehler ───────────────────────
tb.I2C_BUS = 99
chk("ohne I2C-Bus: Rueckgabe 0 (kein Neustart-Karussell)", tb.laufen() == 0)


class _Ctl:
    zu = False
    def __init__(self, *a, **k): pass
    def schliessen(self): _Ctl.zu = True


class _Ger:
    def __init__(self, *a, **k): raise OSError(13, "Permission denied")


tb.Controller, tb.Eingabegeraet = _Ctl, _Ger
chk("ohne /dev/uinput: Rueckgabe 0", tb.laufen() == 0)
chk("und der I2C-Zugriff wird geschlossen", _Ctl.zu is True)

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
