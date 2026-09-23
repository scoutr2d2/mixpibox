#!/usr/bin/env python3
"""Tests fuer tools/phase-vorab.sh — der QR darf nicht mehr aufblitzen.

DER ANLASS (09.08.2026, am Geraet): "es wird immer noch kurz der qr screen
angezeigt beim vor dem grundsystem wird eingerichtet und auch nach dem
neustart", spaeter auch "auch vor mixpibox wird vorbereitet der qr code
noch".

DIE URSACHE: Die Phasendatei liegt in /run und ist nach JEDEM Neustart weg.
`mixpibox-einrichtung.service` startet den Schirm unabhaengig vom Vorstart —
findet er keine Auskunft, zeigt er seinen Grundzustand mit QR-Code. Erst
danach traegt der Vorstart die richtige Phase nach. Der Schirm hat nichts
falsch gemacht; ihm fehlte die Auskunft.

  python3 tests/phase_vorab_test.py       # exit 0 = alles gruen
"""
import os
import subprocess
import sys
import tempfile

_HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKRIPT = os.path.join(_HIER, "tools", "phase-vorab.sh")

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


def lauf(stufe=None, vorhandene_phase=None, ohne_stufendatei=False):
    """-> Inhalt der Phasendatei nach dem Lauf ('' = keine geschrieben)."""
    d = tempfile.mkdtemp()
    ordner = os.path.join(d, "run")
    os.makedirs(ordner)
    if vorhandene_phase is not None:
        with open(os.path.join(ordner, "phase"), "w") as f:
            f.write(vorhandene_phase + "\n")
    stufendatei = os.path.join(d, "install_stage")
    if not ohne_stufendatei:
        with open(stufendatei, "w") as f:
            f.write(str(stufe) + "\n")
    umgebung = dict(os.environ,
                    MIXPI_PHASE_ORDNER=ordner,
                    MIXPI_STUFEN=stufendatei)
    r = subprocess.run(["sh", SKRIPT], env=umgebung, capture_output=True, text=True)
    assert r.returncode == 0, f"Rueckgabe {r.returncode}: {r.stderr}"
    try:
        with open(os.path.join(ordner, "phase")) as f:
            return f.read().strip()
    except OSError:
        return ""


print("── Was DietPis Stufendatei sagt, steht danach in der Phase ──")
chk("Stufe 0 -> grundsystem", lauf(stufe=0) == "grundsystem")
chk("Stufe 1 -> grundsystem", lauf(stufe=1) == "grundsystem")
# Stufe 2 heisst: DietPi ist fertig, jetzt kommt unser Lauf. Genau hier
# blitzte der QR zuletzt noch auf ("auch vor mixpibox wird vorbereitet").
chk("Stufe 2 -> vorbereitung", lauf(stufe=2) == "vorbereitung")

print("\n── Was schon dasteht, bleibt stehen ──")
# Laeuft der Vorstart bereits und hat eine genauere Phase gemeldet, waere
# ein Ueberschreiben ein Rueckschritt.
chk("eine gemeldete Phase wird nicht ueberschrieben",
    lauf(stufe=0, vorhandene_phase="neustart") == "neustart")

print("\n── Ohne Stufendatei wird NICHTS behauptet ──")
# Dann ist es kein DietPi in der Erstinstallation, und der Schirm darf
# seinen Grundzustand zeigen — das ist genau der Fall, in dem der QR-Code
# RICHTIG ist: Einrichtung ohne Netz, das Handy soll ihn scannen.
chk("keine Stufendatei -> keine Phase, der QR bleibt erlaubt",
    lauf(ohne_stufendatei=True) == "")

print("\n── Das Skript selbst ──")
r = subprocess.run(["sh", "-n", SKRIPT], capture_output=True, text=True)
chk("Syntax sauber", r.returncode == 0)
chk("ausfuehrbar", os.access(SKRIPT, os.X_OK))
# Der Pfad in der Unit muss zum Namen passen, unter dem die Datei auf der
# Box landet — der Selbstabgleich kopiert sie unter ihrem eigenen Namen.
unit = open(os.path.join(_HIER, "tools", "mixpibox-einrichtung.service")).read()
chk("die Unit ruft es VOR dem Schirm auf",
    "ExecStartPre=-/opt/mixpibox-einrichtung/phase-vorab.sh" in unit
    and unit.index("ExecStartPre=-/opt/mixpibox-einrichtung/phase-vorab.sh")
    < unit.index("ExecStart=/usr/bin/python3"))
# Und die Karte muss sie ueberhaupt mitbringen.
sdprep = open(os.path.join(_HIER, "controller", "sdprep.py")).read()
chk("die Karte nimmt es mit (beide Listen)",
    sdprep.count('("tools", "phase-vorab.sh")') == 2)

print(f"\n{ok}/{ok + bad} bestanden")
sys.exit(1 if bad else 0)
