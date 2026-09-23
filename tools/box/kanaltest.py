#!/usr/bin/env python3
"""
WELCHER LAUTSPRECHER BEKOMMT WELCHEN KANAL? — die Frage, die nur Ohren beantworten.

══ WOZU ══════════════════════════════════════════════════════════════════════
Der MuPiHAT traegt 2x MAX98357A, laut Datenblatt "Stereo/Mono umschaltbar".
WELCHE Stellung eine gebaute Box hat, steht in KEINER Software: das Overlay
(`dtoverlay=max98357a,sdmode-pin=16`) erzeugt so oder so EINE Karte mit zwei
Kanaelen, und PipeWire meldet brav "2ch". Ob hinten zwei verschiedene Signale
herauskommen oder zweimal dasselbe, entscheidet die Beschaltung des SD_MODE-
Pins — also Hardware.

Das ist keine Spielerei, sondern die Weiche fuer die ganze Klangfrage
(Betreiber, 21.08.2026: seitlich abstrahlende Lautsprecher, "komisches
Hoergefuehl" direkt davor):

  * ECHTES STEREO -> das Gefuehl kommt von der zerfallenen Phantommitte. Bei
    grossem Oeffnungswinkel hoert jedes Ohr fast nur seinen Lautsprecher, der
    Gesang reisst nach links und rechts auseinander. DAGEGEN HILFT die
    Stereobasis des Klangwerks (mixpi-klang).
  * MONO GEBRUECKT (beide Chassis dasselbe Signal) -> es ist ein KAMMFILTER:
    gleiches Signal, verschiedene Laufzeit zu jedem Ohr, Ausloeschungen in den
    Mitten. DAGEGEN HILFT KEINE SOFTWARE — nur ein Chassis abschalten oder die
    Aufstellung aendern. Wer hier die Stereobasis verstellt, dreht an einem
    Regler, der nichts tut.

══ WAS ES TUT UND WAS NICHT ══════════════════════════════════════════════════
Es spielt Rauschen: erst NUR LINKS, dann NUR RECHTS, dann BEIDE. Rauschen und
nicht ein Sinus, weil tiefe Sinustoene kaum zu orten sind — Rauschen kann das
Ohr im Raum verorten, und genau das ist hier die Messung.

NICHTS WIRD VERSTELLT: keine Lautstaerke, kein Routing, keine Standard-Senke.
Gespielt wird ueber `pw-play`, also durch DIESELBE Kette wie die Musik (mit
Entzerrer und Klangwerk, falls sie haengen) — was du hoerst, ist der echte
Signalweg der Box und nicht ein Sonderfall.

══ AUFRUF ════════════════════════════════════════════════════════════════════
    tools/box/kanaltest.py [BOX] [--pegel 0.2] [--sekunden 2]

    tools/box/kanaltest.py mixpibox.local
    tools/box/kanaltest.py 192.168.178.169 --pegel 0.1

VORHER LEISE DREHEN, wenn Kinder schlafen: das Skript liest die Lautstaerke aus
und schreibt sie hin, aendert sie aber NICHT — eine Messung, die die Box
umstellt, ist keine Messung ([[aufraeumen-nachmessen]]).

══ SO LIEST DU DAS ERGEBNIS ══════════════════════════════════════════════════
    "links" nur aus der linken Box, "rechts" nur aus der rechten  -> STEREO
    beide Durchgaenge aus BEIDEN Boxen gleich laut                -> MONO
    beide Durchgaenge nur aus EINER Box                           -> der zweite
        Verstaerker ist stumm oder nicht angeschlossen (ein eigener Fehler,
        der wie Mono klingt)
"""

import argparse
import shlex
import subprocess
import sys

# Der Ton wird AUF DER BOX erzeugt, nicht uebertragen: eine WAV-Datei von ein
# paar hundert Kilobyte ueber scp zu schieben, waere Zeit fuer nichts — und
# `sox` gibt es auf der Box nicht (nachgesehen, 21.08.2026).
ERZEUGER = r'''
import math, struct, sys, wave
pegel = float(sys.argv[1]); sek = float(sys.argv[2]); ziel = sys.argv[3]
rate = 48000
n = int(rate * sek)

# ══ ZWEI VERSCHIEDENE TOENE STATT RAUSCHEN — DAS IST DER GANZE TRICK ═══════
#
# Die erste Fassung dieses Werkzeugs spielte bandbegrenztes Rauschen und
# fragte "aus welcher Box kam es?". DAS WAR UNTAUGLICH, und zwar aus zwei
# Gruenden, die sich addieren (am 21.08.2026 am Geraet aufgeflogen):
#
#   1. Der Tiefpass nahm den Hochton weg — also genau das, woran das Ohr
#      RICHTUNG erkennt. Unter etwa 500 Hz ist Ortung kaum moeglich.
#   2. Beide Chassis sitzen in EINEM Gehaeuse, wenige Zentimeter auseinander.
#      Spielt eines, schwingt das Gehaeuse mit. Aus Hoerabstand klingt das
#      auch bei perfektem Stereo nach "kommt aus beiden".
#
# Ergebnis: der Test meldete Mono, obwohl der Hardware-Schalter SW3 ab Werk
# auf Stereo steht. Ein Werkzeug, das die haeufigste Stellung nicht von ihrem
# Gegenteil unterscheiden kann, misst nichts.
#
# Deshalb jetzt: LINKS EIN TIEFER TON, RECHTS EIN HOHER. Unterschieden wird
# nicht mehr die Richtung (schwer), sondern die TONHOEHE (kinderleicht, und
# aus jedem Winkel gleich). Haelt man das Ohr an ein Chassis, muss dort bei
# Stereo genau EIN Ton zu hoeren sein. Kommen aus jedem Chassis BEIDE Toene,
# ist es Mono — und das kann kein Gehaeuseschwingen vortaeuschen.
TIEF = 220.0    # gut hoerbar, liegt ueber dem, was kleine Chassis nicht koennen
HOCH = 2200.0   # eine Dekade darueber - kein Oberton des tiefen Tons

def ton(freq):
    roh = [math.sin(2 * math.pi * freq * i / rate) for i in range(n)]
    rampe = int(rate * 0.05)  # ein-/ausblenden, sonst knackt es
    for i in range(rampe):
        f = i / rampe
        roh[i] *= f
        roh[-(i + 1)] *= f
    return roh

t, h = ton(TIEF), ton(HOCH)
still = [0.0] * n

def schreiben(name, links, rechts):
    with wave.open(name, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        rahmen = bytearray()
        for a, b in zip(links, rechts):
            rahmen += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, a)) * pegel * 32767),
                int(max(-1.0, min(1.0, b)) * pegel * 32767),
            )
        w.writeframes(bytes(rahmen))

# ══ EINZELKANAL: IMMER DER HOHE TON ═══════════════════════════════════════
# Wird nur EIN Kanal gespielt, lautet die Frage wieder „aus welchem Chassis
# kommt es?" — also eine ORTUNGSfrage. Dafuer taugt der tiefe Ton nicht: er
# strahlt kaum gerichtet ab und wandert als Koerperschall durch das gemeinsame
# Gehaeuse. Der hohe Ton ist gerichtet und bleibt, wo er erzeugt wird.
# (Der tiefe Ton hat nur im Doppeltest einen Sinn, wo TONHOEHE unterschieden
# wird und nicht Richtung.)
schreiben(ziel + "-links.wav", h, still)
schreiben(ziel + "-rechts.wav", still, h)
schreiben(ziel + "-beide.wav", t, h)
print("erzeugt")
'''


# ══ ANSAGE STATT TON ══════════════════════════════════════════════════════
#
# Betreiber, 21.08.2026: „man könnte auch so eine left right ansage machen".
# Genau richtig — und es kostet nichts, denn alsa-utils bringt die Ansagen
# mit (auf der Box nachgesehen: /usr/share/sounds/alsa/Front_Left.wav und
# Front_Right.wav sind da).
#
# WARUM DAS BESSER IST ALS JEDER TESTTON: Sprache traegt Konsonanten, also
# Hochton mit klarer Struktur — sie ist im Raum leichter zu orten als ein
# Sinus, und man muss sich nicht merken, welcher Ton welcher Seite gehoerte.
# Man HOERT einfach „Front Left" aus der linken Box.
#
# Die WAVs sind MONO. Sie werden hier auf den gewuenschten Kanal gelegt und
# bis zur gewuenschten Dauer wiederholt — wer wandert, soll die Ansage
# mehrfach hoeren und nicht einmal.
ANSAGE_LINKS = "/usr/share/sounds/alsa/Front_Left.wav"
ANSAGE_RECHTS = "/usr/share/sounds/alsa/Front_Right.wav"

ANSAGE_ERZEUGER = r'''
import struct, sys, wave
sek = float(sys.argv[1]); ziel = sys.argv[2]
quellen = {"links": (sys.argv[3], True), "rechts": (sys.argv[4], False)}

def lesen(pfad):
    with wave.open(pfad, "rb") as w:
        roh = w.readframes(w.getnframes())
        br, kan, rate = w.getsampwidth(), w.getnchannels(), w.getframerate()
    if br != 2:
        raise SystemExit("Ansage ist nicht 16 Bit - unerwartet")
    werte = struct.unpack("<%dh" % (len(roh) // 2), roh)
    # Auf einen Kanal herunterbrechen, falls die Ansage stereo waere.
    if kan > 1:
        werte = werte[::kan]
    return list(werte), rate

for name, (pfad, ist_links) in quellen.items():
    werte, rate = lesen(pfad)
    stille = [0] * int(rate * 0.7)   # Atempause zwischen den Wiederholungen
    einer = werte + stille
    n = max(1, int((rate * sek) / len(einer)))
    folge = einer * n
    with wave.open(ziel + "-" + name + ".wav", "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        rahmen = bytearray()
        for v in folge:
            rahmen += struct.pack("<hh", v if ist_links else 0, 0 if ist_links else v)
        w.writeframes(bytes(rahmen))

# "beide": erst die linke Ansage, dann die rechte - nacheinander, damit die
# Zuordnung eindeutig bleibt.
l, rate = lesen(quellen["links"][0])
r, _ = lesen(quellen["rechts"][0])
stille = [0] * int(rate * 0.7)
folge_l = l + stille
folge_r = r + stille
runde = [(v, True) for v in folge_l] + [(v, False) for v in folge_r]
n = max(1, int((rate * sek) / len(runde)))
with wave.open(ziel + "-beide.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
    rahmen = bytearray()
    for v, ist_links in runde * n:
        rahmen += struct.pack("<hh", v if ist_links else 0, 0 if ist_links else v)
    w.writeframes(bytes(rahmen))
print("erzeugt")
'''


def ssh(box: str, befehl: str, frist: int = 30, versuche: int = 3) -> subprocess.CompletedProcess:
    """
    Ein Befehl auf der Box. Immer mit Frist — eine haengende Box darf die
    Messung nicht aufhalten.

    ══ WARUM WIEDERHOLT WIRD ═════════════════════════════════════════════════
    Am 21.08.2026 beim ersten Einsatz gemessen: von zwei Laeufen gegen dieselbe
    erreichbare Box scheiterte JEDER ZWEITE schon am `echo da` — waehrend ein
    `ping` durchlief und ein Bash-`ssh` unmittelbar davor funktionierte. Das
    passt zur laufenden Netzabriss-Spur (WLAN/BT-Koexistenz, Stottern vor dem
    Abriss).

    Ein Werkzeug, das daran scheitert, misst die Netzlage statt der Kanaele.
    Deshalb drei Anlaeufe — und wenn alle scheitern, ist das eine Aussage ueber
    das NETZ und wird auch so gemeldet, nicht als "Box antwortet nicht".
    """
    letzte = None
    for n in range(versuche):
        try:
            letzte = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{box}", befehl],
                capture_output=True,
                text=True,
                timeout=frist,
            )
            if letzte.returncode == 0:
                if n > 0:
                    print(f"    (erst im {n + 1}. Anlauf durchgekommen — die Box stottert)")
                return letzte
        except subprocess.TimeoutExpired:
            letzte = subprocess.CompletedProcess([], 124, "", "Frist gerissen")
    return letzte


def main() -> int:
    p = argparse.ArgumentParser(description="Kanalzuordnung der Box hoerbar pruefen")
    p.add_argument("box", nargs="?", default="mixpibox.local")
    p.add_argument("--pegel", type=float, default=0.2, help="0.0 bis 1.0 (Vorgabe 0.2 - bewusst leise)")
    p.add_argument("--sekunden", type=float, default=2.0)
    p.add_argument(
        "--wandern",
        type=float,
        metavar="SEKUNDEN",
        help="EINEN Durchgang lange spielen — Zeit, mit dem Ohr von einem Chassis "
        "zum anderen zu gehen. 5 Sekunden reichen zum Wechseln nicht.",
    )
    p.add_argument(
        "--kanal",
        choices=["links", "rechts", "beide"],
        default="beide",
        help="Welcher Durchgang bei --wandern laeuft. 'links'/'rechts' spielt einen "
        "hohen Ton auf NUR diesem Kanal — das andere Chassis muss dann still "
        "bleiben, und das ist die klarste Aussage. 'beide' spielt tief links / "
        "hoch rechts gleichzeitig (Vorgabe).",
    )
    p.add_argument(
        "--ansage",
        action="store_true",
        help="Statt Toenen die gesprochenen ALSA-Ansagen 'Front Left' / 'Front Right' "
        "spielen. Meist die beste Wahl: Sprache traegt Konsonanten, ist im Raum "
        "leichter zu orten als ein Sinus, und man muss sich nicht merken, welcher "
        "Ton welcher Seite gehoerte.",
    )
    p.add_argument(
        "--direkt",
        action="store_true",
        help="An den Durchgangsstationen VORBEI direkt auf die Soundkarte spielen. "
        "Der entscheidende Gegentest: klingt es hier getrennt und ueber den "
        "normalen Weg nicht, mischt die SOFTWARE zu Mono und nicht die Hardware.",
    )
    a = p.parse_args()

    if not 0.0 < a.pegel <= 1.0:
        print("--pegel muss zwischen 0 und 1 liegen.", file=sys.stderr)
        return 2
    if a.wandern is not None:
        if not 1 <= a.wandern <= 300:
            print("--wandern muss zwischen 1 und 300 Sekunden liegen.", file=sys.stderr)
            return 2
        a.sekunden = a.wandern

    print(f"== Box {a.box} ==")
    if ssh(a.box, "echo da").returncode != 0:
        print(
            "Die Box war in drei Anlaeufen nicht erreichbar. Das ist eine Aussage ueber\n"
            "das NETZ, nicht ueber den Ton — siehe die Netzabriss-Spur.",
            file=sys.stderr,
        )
        return 1

    # Die Lautstaerke wird GELESEN und hingeschrieben, nicht angefasst.
    lautst = ssh(a.box, "export XDG_RUNTIME_DIR=/run/user/1000; amixer -c MAX98357A sget Master 2>/dev/null | grep -o '\\[[0-9]*%\\]' | head -1")
    print(f"Lautstaerke der Box (unveraendert): {lautst.stdout.strip() or '(nicht gelesen)'}")

    ziel = "/tmp/mixpi-kanaltest"
    # shlex.quote, NICHT list2cmdline: das Skript geht durch eine sh auf der
    # Box, und list2cmdline quotet nach Windows-Regeln — der Erzeuger kaeme
    # dort zerrissen an.
    if a.ansage:
        da = ssh(a.box, f"test -f {ANSAGE_LINKS} && test -f {ANSAGE_RECHTS} && echo ja")
        if "ja" not in da.stdout:
            print(
                f"Die ALSA-Ansagen fehlen ({ANSAGE_LINKS}). Ohne sie geht --ansage nicht;\n"
                "nachruesten mit `sudo apt install alsa-utils`, oder ohne --ansage fahren.",
                file=sys.stderr,
            )
            return 1
        bau = ssh(
            a.box,
            f"python3 -c {shlex.quote(ANSAGE_ERZEUGER)} {a.sekunden} {ziel} {ANSAGE_LINKS} {ANSAGE_RECHTS}",
        )
    else:
        bau = ssh(a.box, f"python3 -c {shlex.quote(ERZEUGER)} {a.pegel} {a.sekunden} {ziel}")
    if "erzeugt" not in bau.stdout:
        print(f"Testton liess sich nicht erzeugen: {bau.stderr.strip()}", file=sys.stderr)
        return 1

    # ══ WELCHER WEG WIRD GEMESSEN? ═══════════════════════════════════════════
    # Normalerweise der ECHTE: ueber die Standard-Senke, also durch Entzerrer
    # und Klangwerk hindurch — was man hoert, ist der Signalweg der Musik.
    #
    # Mit --direkt dagegen an allen Stationen VORBEI auf die Soundkarte. Der
    # Unterschied ist die eigentliche Diagnose: klingt es direkt GETRENNT und
    # ueber den normalen Weg MONO, dann mischt eine Station in der Software zu
    # Mono — und niemand muss an der Hardware schrauben.
    ziel_sink = ""
    if a.direkt:
        sinks = ssh(a.box, "export XDG_RUNTIME_DIR=/run/user/1000; pactl list short sinks")
        for zeile in sinks.stdout.splitlines():
            teile = zeile.split("\t")
            if len(teile) > 1 and teile[1].startswith("alsa_output."):
                ziel_sink = teile[1]
                break
        if not ziel_sink:
            print("Keine alsa_output-Senke gefunden — --direkt geht nicht.", file=sys.stderr)
            return 1
        print(f"DIREKT auf die Soundkarte: {ziel_sink}\n(an Entzerrer und Klangwerk vorbei)")

    print(
        "\n══ SO MISST DU RICHTIG ══════════════════════════════════════════════\n"
        "  HALTE DAS OHR NAH AN EIN CHASSIS — nicht aus Hoerabstand raten.\n"
        "  Beide sitzen in EINEM Gehaeuse; aus zwei Metern klingt auch sauberes\n"
        "  Stereo nach 'kommt aus beiden'.\n\n"
        "  Durchgang 1 spielt einen TIEFEN Ton (220 Hz, brummt).\n"
        "  Durchgang 2 spielt einen HOHEN Ton (2200 Hz, pfeift).\n"
        "  Am selben Chassis darf bei Stereo nur EINER davon laut sein.\n"
    )
    was = "die Ansage 'Front Left'" if a.ansage else "ein hoher Ton"
    wasr = "die Ansage 'Front Right'" if a.ansage else "ein hoher Ton"
    if a.wandern is not None:
        ansagen = {
            "links": f"NUR LINKER KANAL ({was}) — {a.sekunden:.0f} s. "
            "Das RECHTE Chassis muss still bleiben.",
            "rechts": f"NUR RECHTER KANAL ({wasr}) — {a.sekunden:.0f} s. "
            "Das LINKE Chassis muss still bleiben.",
            "beide": (
                f"LINKS und RECHTS im Wechsel, angesagt — {a.sekunden:.0f} s"
                if a.ansage
                else f"TIEF LINKS / HOCH RECHTS — {a.sekunden:.0f} s Zeit zum Wandern"
            ),
        }
        durchgaenge = ((a.kanal, ansagen[a.kanal]),)
    else:
        durchgaenge = (
            ("links", f"LINKER Kanal ({was})"),
            ("rechts", f"RECHTER Kanal ({wasr})"),
            (
                "beide",
                "LINKS und RECHTS im Wechsel, angesagt"
                if a.ansage
                else "BEIDE zugleich — tief links, hoch rechts",
            ),
        )
        print("Drei Durchgaenge, je", a.sekunden, "Sekunden:\n")
    for name, ansage in durchgaenge:
        print(f"  ▶ {ansage}")
        wahl = f"--target {shlex.quote(ziel_sink)} " if ziel_sink else ""
        r = ssh(
            a.box,
            f"export XDG_RUNTIME_DIR=/run/user/1000; pw-play {wahl}{ziel}-{name}.wav",
            frist=int(a.sekunden) + 20,
        )
        if r.returncode != 0:
            print(f"    (Wiedergabe scheiterte: {r.stderr.strip()[:200]})")

    ssh(a.box, f"rm -f {ziel}-links.wav {ziel}-rechts.wav {ziel}-beide.wav")

    print(
        "\n== So liest du das Ergebnis (Ohr AM Chassis) ==\n"
        "  Am linken Chassis nur das BRUMMEN, am rechten nur das PFEIFEN\n"
        "     -> ECHTES STEREO. Die Stereobasis im Klangwerk ist dein Hebel.\n"
        "  An JEDEM Chassis sind BEIDE Toene gleich laut\n"
        "     -> MONO gebrueckt (SW3). Dann ist das komische Gefuehl ein\n"
        "        Kammfilter, und die Stereobasis kann nichts ausrichten.\n"
        "  Ein Chassis bleibt bei beiden Durchgaengen still\n"
        "     -> dieser Verstaerker ist stumm oder nicht angeschlossen.\n"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired:
        print("Die Box hat die Frist gerissen.", file=sys.stderr)
        sys.exit(1)
