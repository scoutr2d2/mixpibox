#!/usr/bin/env python3
"""
Tests fuer tools/mupibox-bt-reconnect.py — reine Auswertung, KEIN bluetoothctl.

Der Anlass ist die Frage, die dieses Werkzeug entscheidet: WEN stupse ich an?
Ein Dienst, der sich auf ein vertrautes Handy oder eine Fernbedienung stuerzt,
waere aufdringlich; einer, der den ausgeschalteten Lautsprecher uebergeht,
nutzlos.

  python3 tests/bt_reconnect_test.py
"""
import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_sp = importlib.util.spec_from_file_location(
    "btr", os.path.join(REPO, "tools", "mupibox-bt-reconnect.py")
)
btr = importlib.util.module_from_spec(_sp)
_sp.loader.exec_module(btr)

ok = bad = 0


def pruefe(name, ist, soll):
    global ok, bad
    if ist == soll:
        ok += 1
    else:
        bad += 1
        print(f"  FEHLER {name}: {ist!r} statt {soll!r}")


# ── parse_devices — Wortlaut von der Box ──────────────────────────────────
ECHT = "Device 00:9E:C8:61:1A:EA 小米蓝牙音箱\n"
pruefe("liest MAC und Namen", btr.parse_devices(ECHT), [("00:9E:C8:61:1A:EA", "小米蓝牙音箱")])
pruefe("Name mit Leerzeichen bleibt ganz",
       btr.parse_devices("Device AA:BB:CC:DD:EE:FF JBL Go 3\n"),
       [("AA:BB:CC:DD:EE:FF", "JBL Go 3")])
pruefe("Name darf fehlen",
       btr.parse_devices("Device AA:BB:CC:DD:EE:FF\n"), [("AA:BB:CC:DD:EE:FF", "")])
pruefe("MAC wird gross geschrieben",
       btr.parse_devices("Device aa:bb:cc:dd:ee:ff x\n")[0][0], "AA:BB:CC:DD:EE:FF")
# Hinweiszeilen kommen je nach bluetoothctl-Fassung dazwischen.
pruefe("Unfug wird uebergangen",
       btr.parse_devices("Agent registered\nDevice KEINMAC name\n\nirgendwas\n"), [])
pruefe("leere Ausgabe", btr.parse_devices(""), [])
pruefe("None faellt nicht auf die Nase", btr.parse_devices(None), [])

# ── verbunden ─────────────────────────────────────────────────────────────
pruefe("Connected: yes", btr.verbunden("\tPaired: yes\n\tConnected: yes\n"), True)
pruefe("Connected: no", btr.verbunden("\tConnected: no\n"), False)
pruefe("ohne Angabe gilt als NICHT verbunden", btr.verbunden("\tPaired: yes\n"), False)
pruefe("leer", btr.verbunden(""), False)

# ── ist_audio ─────────────────────────────────────────────────────────────
pruefe("Icon audio-card", btr.ist_audio("\tIcon: audio-card\n"), True)
pruefe("Icon audio-headset", btr.ist_audio("\tIcon: audio-headset\n"), True)
pruefe("UUID Audio Sink reicht auch",
       btr.ist_audio("\tUUID: Audio Sink   (0000110b-0000-1000-8000-00805f9b34fb)\n"), True)
pruefe("Telefon ist kein Lautsprecher", btr.ist_audio("\tIcon: phone\n"), False)
pruefe("Eingabegeraet auch nicht", btr.ist_audio("\tIcon: input-keyboard\n"), False)
pruefe("leer", btr.ist_audio(""), False)

# ── zu_verbinden: die eigentliche Entscheidung ────────────────────────────
LS = "00:9E:C8:61:1A:EA"
TEL = "AA:BB:CC:DD:EE:FF"
geraete = [(LS, "Lautsprecher"), (TEL, "Handy")]

pruefe(
    "getrennter Lautsprecher wird angestupst",
    btr.zu_verbinden(geraete, {LS: "\tIcon: audio-card\n\tConnected: no\n",
                               TEL: "\tIcon: phone\n\tConnected: no\n"}),
    [(LS, "Lautsprecher")],
)
pruefe(
    "verbundener Lautsprecher wird in Ruhe gelassen",
    btr.zu_verbinden(geraete, {LS: "\tIcon: audio-card\n\tConnected: yes\n",
                               TEL: "\tIcon: phone\n\tConnected: no\n"}),
    [],
)
pruefe(
    "ein getrenntes Handy geht uns nichts an",
    btr.zu_verbinden([(TEL, "Handy")], {TEL: "\tIcon: phone\n\tConnected: no\n"}),
    [],
)
pruefe(
    "ohne info wird NICHT geraten",
    btr.zu_verbinden(geraete, {}),
    [],
)
pruefe(
    "zwei Lautsprecher: beide",
    btr.zu_verbinden(
        [(LS, "A"), (TEL, "B")],
        {LS: "\tIcon: audio-card\n\tConnected: no\n",
         TEL: "\tIcon: audio-headset\n\tConnected: no\n"},
    ),
    [(LS, "A"), (TEL, "B")],
)

# ── Schalter: --trocken MUSS trocken sein ─────────────────────────────────
# Rueckfall-Test. Hier stand einmal `parse_args([] if argv is None else argv)`;
# damit warf ein Aufruf von der Kommandozeile jeden Schalter weg, und
# `--trocken` hat in Wahrheit verbunden. Ein Trockenlauf, der luegt, ist
# schlimmer als gar keiner — also wird beides festgenagelt: die Uebergabe als
# Liste UND der Weg ueber sys.argv, den systemd und die Konsole nehmen.
GERAETE = "Device 00:9E:C8:61:1A:EA Lautsprecher\n"
INFO = "\tIcon: audio-card\n\tConnected: no\n"


def _mit_falschem_btctl(argv, sys_argv=None):
    """laufen() aufrufen, ohne bluetoothctl anzufassen -> Liste der Aufrufe."""
    gerufen = []
    echt, echt_argv = btr._btctl, sys.argv

    def gefaelscht(args, frist=25):
        gerufen.append(list(args))
        if args[0] == "devices":
            return GERAETE
        if args[0] == "info":
            return INFO
        return ""

    btr._btctl = gefaelscht
    if sys_argv is not None:
        sys.argv = ["bt-reconnect.py", *sys_argv]
    try:
        btr.laufen(argv)
    finally:
        btr._btctl, sys.argv = echt, echt_argv
    return [c[0] for c in gerufen]


pruefe("ohne Schalter wird verbunden",
       "connect" in _mit_falschem_btctl([]), True)
pruefe("--trocken als Liste verbindet NICHT",
       "connect" in _mit_falschem_btctl(["--trocken"]), False)
pruefe("--trocken ueber sys.argv verbindet NICHT",
       "connect" in _mit_falschem_btctl(None, sys_argv=["--trocken"]), False)
pruefe("ohne Schalter ueber sys.argv wird verbunden",
       "connect" in _mit_falschem_btctl(None, sys_argv=[]), True)

print(f"\nbt-reconnect: {ok} bestanden, {bad} fehlgeschlagen")
sys.exit(1 if bad else 0)
