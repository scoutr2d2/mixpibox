#!/usr/bin/env python3
"""
Tests fuer die Bootwache (tools/mupibox-bootwache.py) — reine Entscheidung,
KEIN Dateisystem, KEIN Neustart.

Der Anlass ist die Feinheit, die die ganze Sache traegt: ein schwarzer
Bildschirm BOOTET SAUBER. Die Wache darf deshalb nicht am Bootvorgang haengen,
sondern an einer Bestaetigung — und muss handeln, wenn keine kommt.

  python3 tests/bootwache_test.py
"""
import importlib.util
import os
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location(
    "bw", os.path.join(REPO, "tools", "mupibox-bootwache.py")
)
bw = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(bw)

ok = bad = 0


def pruefe(name, ist, soll):
    global ok, bad
    if ist == soll:
        ok += 1
    else:
        bad += 1
        print(f"  FEHLER {name}: {ist!r} statt {soll!r}")


JETZT = 1_000_000.0
FRIST = bw.FRIST_S

# ── entscheide: der Kern ──────────────────────────────────────────────────
pruefe(
    "ohne Marke passiert nichts",
    bw.entscheide(None, JETZT, True),
    "nichts",
)
pruefe(
    "ohne Marke auch ohne Sicherung nichts",
    bw.entscheide(None, JETZT, False),
    "nichts",
)
pruefe(
    "frische Marke: warten (das ist der Probelauf selbst)",
    bw.entscheide(JETZT - 5, JETZT, True),
    "warten",
)
pruefe(
    "kurz vor Fristende: noch warten",
    bw.entscheide(JETZT - (FRIST - 1), JETZT, True),
    "warten",
)
pruefe(
    "genau bei Fristende: zuruecknehmen",
    bw.entscheide(JETZT - FRIST, JETZT, True),
    "zuruecknehmen",
)
pruefe(
    "lange her: zuruecknehmen",
    bw.entscheide(JETZT - 10 * FRIST, JETZT, True),
    "zuruecknehmen",
)

# Ohne Sicherung darf sie NICHTS einspielen — raten waere schlimmer als warten.
pruefe(
    "Marke ohne Sicherung: nicht raten",
    bw.entscheide(JETZT - 10 * FRIST, JETZT, False),
    "keine-sicherung",
)

# Ein Pi ohne Echtzeituhr startet gern im Jahr 1970 oder springt vor. Eine
# Marke aus der Zukunft duerfte sonst ewig "warten" bedeuten.
pruefe(
    "Marke weit in der Zukunft laeuft nicht ewig",
    bw.entscheide(JETZT + 10 * FRIST, JETZT, True),
    "zuruecknehmen",
)
pruefe(
    "Marke knapp in der Zukunft gilt als frisch",
    bw.entscheide(JETZT + 10, JETZT, True),
    "warten",
)

# ── bootdir: Bookworm legt die Partition woanders hin ─────────────────────
with tempfile.TemporaryDirectory() as t:
    firmware = os.path.join(t, "firmware")
    alt = os.path.join(t, "alt")
    os.makedirs(firmware)
    os.makedirs(alt)
    pruefe("ohne config.txt: nichts gefunden", bw.bootdir((firmware, alt)), None)
    open(os.path.join(alt, "config.txt"), "w").close()
    pruefe("findet die vorhandene", bw.bootdir((firmware, alt)), alt)
    open(os.path.join(firmware, "config.txt"), "w").close()
    pruefe("erste Stelle gewinnt", bw.bootdir((firmware, alt)), firmware)

# ── marke_lesen: muss auch Unfug ueberleben ───────────────────────────────
with tempfile.TemporaryDirectory() as t:
    pruefe("keine Marke -> None", bw.marke_lesen(t), None)
    p = os.path.join(t, bw.MARKE)
    open(p, "w").write("1234567.5 drehung\n")
    pruefe("liest den Zeitstempel", bw.marke_lesen(t), 1234567.5)
    open(p, "w").write("kaputt")
    gelesen = bw.marke_lesen(t)
    pruefe("unlesbare Marke faellt auf die Dateizeit zurueck", isinstance(gelesen, float), True)
    open(p, "w").write("")
    gelesen = bw.marke_lesen(t)
    pruefe("leere Marke ebenso", isinstance(gelesen, float), True)

# ── zurueck: der riskante Teil, echt geprueft ─────────────────────────────
with tempfile.TemporaryDirectory() as t:
    open(os.path.join(t, "config.txt"), "w").write("dtoverlay=KAPUTT\n")
    open(os.path.join(t, bw.SICHERUNG), "w").write("dtoverlay=vc4-kms-v3d\n")
    open(os.path.join(t, bw.MARKE), "w").write("1.0\n")

    pruefe("Wiederherstellung meldet Erfolg", bw.zurueck(t), True)
    pruefe(
        "config.txt traegt wieder die bewaehrte Fassung",
        open(os.path.join(t, "config.txt")).read().strip(),
        "dtoverlay=vc4-kms-v3d",
    )
    pruefe(
        "die kaputte Fassung ist zur Fehlersuche aufgehoben",
        open(os.path.join(t, "config.txt.verworfen")).read().strip(),
        "dtoverlay=KAPUTT",
    )
    pruefe("die Marke ist weg", os.path.exists(os.path.join(t, bw.MARKE)), False)
    pruefe("die Sicherung bleibt liegen", os.path.exists(os.path.join(t, bw.SICHERUNG)), True)

    # Zweiter Lauf ohne Marke: entscheide() sagt "nichts", es passiert nichts mehr.
    pruefe(
        "danach ist nichts mehr offen",
        bw.entscheide(bw.marke_lesen(t), JETZT, True),
        "nichts",
    )

with tempfile.TemporaryDirectory() as t:
    # Fehlende Sicherung darf nicht zum Absturz fuehren.
    open(os.path.join(t, "config.txt"), "w").write("x\n")
    open(os.path.join(t, bw.MARKE), "w").write("1.0\n")
    pruefe("ohne Sicherung meldet zurueck() sauber Misserfolg", bw.zurueck(t), False)
    pruefe(
        "und laesst config.txt unangetastet",
        open(os.path.join(t, "config.txt")).read().strip(),
        "x",
    )

# ── --zuruecknehmen: der Weg, den man ueber SSH oder die Verwaltung nimmt ──
with tempfile.TemporaryDirectory() as t:
    merk = bw.BOOT_KANDIDATEN
    bw.BOOT_KANDIDATEN = (t,)
    try:
        # Ohne Sicherung: sauber verweigern statt zu raten.
        open(os.path.join(t, "config.txt"), "w").write("dtoverlay=KAPUTT\n")
        pruefe(
            "ohne Sicherung wird nichts zurueckgenommen",
            bw.laufen(["--zuruecknehmen", "--trocken"]),
            1,
        )
        # Mit Sicherung: Trockenlauf meldet Erfolg und fasst nichts an.
        open(os.path.join(t, bw.SICHERUNG), "w").write("dtoverlay=GUT\n")
        pruefe(
            "mit Sicherung meldet der Trockenlauf Erfolg",
            bw.laufen(["--zuruecknehmen", "--trocken"]),
            0,
        )
        pruefe(
            "und hat im Trockenlauf nichts geaendert",
            open(os.path.join(t, "config.txt")).read().strip(),
            "dtoverlay=KAPUTT",
        )
        # Es braucht KEINE Marke — man nimmt zurueck, weil man den schwarzen
        # Bildschirm sieht, nicht weil eine Frist abgelaufen ist.
        pruefe(
            "funktioniert ohne Marke",
            os.path.exists(os.path.join(t, bw.MARKE)),
            False,
        )
    finally:
        bw.BOOT_KANDIDATEN = merk

# ── laufen: ohne config.txt darf nichts passieren ─────────────────────────
with tempfile.TemporaryDirectory() as t:
    merk = bw.BOOT_KANDIDATEN
    bw.BOOT_KANDIDATEN = (t,)
    try:
        pruefe("ohne config.txt: sauberer Ruecklauf", bw.laufen(["--trocken"]), 0)
    finally:
        bw.BOOT_KANDIDATEN = merk

print(f"\nbootwache: {ok} bestanden, {bad} fehlgeschlagen")
sys.exit(1 if bad else 0)
