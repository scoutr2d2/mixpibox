#!/usr/bin/env python3
"""
ANSAGE-KOMMT-AN — kommt eine Vorlese-Ansage wirklich am Lautsprecher an?

══ WARUM ES DAS GIBT (20.09.2026) ══════════════════════════════════════════
Der Betreiber, nachdem die Box die Uhrzeit sagen sollte: „ich habe nichts
gehoert." Die Antwort der Box war `{"ok":true,"dauerMs":2528}` — und die sagt
GENAU NICHTS darueber, ob ein Ton den Lautsprecher erreicht hat:

    ok:true      heisst „die WAV ist entstanden".
    dauerMs      ist aus dem WAV-Kopf gerechnet, nicht gemessen.
    pw-play      startet der Server mit `stdio: 'ignore'`, und sein
                 `error`-Hoerer loest nur die Daempfung (server.ts,
                 `ansageAbspielen`). Faellt das Abspielen aus, steht in der
                 Antwort weiterhin `ok:true`.

Sprache ist der einzige Ausgang dieser Box, der kein Pixel bewegt — genau
deshalb war das Vorlesen hier schon einmal eingebaut, verdrahtet und STUMM
[llmwiki vorlesen-beim-halten]. Ein „ok" ist kein Ton.

══ WAS DIESES WERKZEUG ANDERS MACHT ALS DIE ZWEI NACHBARN ══════════════════
`tools/tonweg-pegel.mjs` liest die eingestellten Pegel (was jemand WOLLTE),
`tools/tonweg-durchgang.py` schickt einen 1-kHz-Prueston durch die Kette (was
die Kette KANN). Beide sagen nichts darueber, ob die ANSAGE diesen Weg auch
geht: Sie laeuft nicht durch den Browser, sondern durch `pw-play` im Server,
mit der Daempfung in Haushand und einem eigenen Notloeser.

Gemessen wird deshalb die echte Naht: `GET /api/vorlesen/sprich?abspielen=1`
ausloesen und gleichzeitig den MONITOR der Endstation mitschneiden — der haengt
HINTER deren Lautstaerkeregler und fuehrt genau das, was zur Karte geht.

══ WAS ES SAGT, UND WAS NICHT ══════════════════════════════════════════════
Es sagt: am Ende der Kette liegt (kein) Signal, und wie laut. Es sagt NICHT,
ob es im Zimmer zu hoeren war — dazwischen liegen der Verstaerker (MAX98357A,
SD-Mode-Pin) und ein Lautsprecher. Ein Pegel ueber der Schwelle bei Stille im
Zimmer ist deshalb ein Befund fuer die HARDWARE, kein Widerspruch.

══ WAS ES AN DER BOX AENDERT ═══════════════════════════════════════════════
Es laesst die Box einen Satz SPRECHEN — das ist hoerbar, und es ist der Sinn
der Sache. Sonst nichts: keine Einstellung wird angefasst, der Mitschnitt
liegt in /tmp und wird am Ende entfernt. Der Satz landet als WAV im
Zwischenspeicher (~/.mupibox/vorlesen-cache), wie jede Ansage im Alltag.

Aufruf:
    python3 tools/ansage-kommt-an.py [box] [--text "Es ist 15 Uhr 43."]
    python3 tools/ansage-kommt-an.py --pruefen        (Exit 1, wenn still)
"""
import json
import shlex
import subprocess
import sys

ARGV = sys.argv[1:]
PRUEFEN = "--pruefen" in ARGV
BOX = next((a for a in ARGV if not a.startswith("-")), "192.168.178.62")
TEXT = ""
if "--text" in ARGV:
    i = ARGV.index("--text")
    if i + 1 < len(ARGV):
        TEXT = ARGV[i + 1]

# ── DIE SCHWELLE ─────────────────────────────────────────────────────────────
# Ein RMS von 0,001 (-60 dBFS) ist nichts, was ein Mensch je hoert; es ist der
# Rauschboden der Kette. Alles darueber heisst: es lief ein Signal.
STILL = 0.001

AM_GERAET = r'''
import array, json, math, os, subprocess, sys, time, urllib.parse, wave

MIT = "/tmp/ansage-mit.wav"
TEXT = sys.argv[1] if len(sys.argv) > 1 else ""
if not TEXT:
    t = time.localtime()
    TEXT = "Es ist %d Uhr." % t.tm_hour if t.tm_min == 0 else "Es ist %d Uhr %d." % (t.tm_hour, t.tm_min)

def rms(pfad):
    with wave.open(pfad, "rb") as w:
        roh = w.readframes(w.getnframes())
        breite = w.getsampwidth()
    if not roh:
        return 0.0, 0.0
    werte = array.array({1: "b", 2: "h", 4: "i"}[breite])
    werte.frombytes(roh[: len(roh) // breite * breite])
    if not werte:
        return 0.0, 0.0
    voll = float(2 ** (8 * breite - 1))
    # UEBER DAS GANZE STUECK, nicht ueber die Mitte wie beim Dauerton: Eine
    # Ansage hat Pausen, und der Anfang IST hier die Aussage.
    quadrat = sum((x / voll) ** 2 for x in werte) / len(werte)
    spitze = max(abs(x) for x in werte) / voll
    return math.sqrt(quadrat), spitze

d = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True).stdout)
ende = None
for k in d:
    if k.get("type") != "PipeWire:Interface:Node":
        continue
    p = k.get("info", {}).get("props", {})
    if p.get("media.class") == "Audio/Sink" and "alsa_output" in (p.get("node.name") or ""):
        ende = p["node.name"]
if not ende:
    print(json.dumps({"fehler": "keine ALSA-Senke gefunden"}))
    sys.exit(2)

auf = subprocess.Popen(
    ["pw-record", "--target", ende + ".monitor", "--rate", "48000", "--channels", "1", MIT],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
time.sleep(0.7)
# DIE ECHTE NAHT, nicht pw-play von Hand: Nur so laeuft die Messung durch
# `ansageAbspielen` im Server samt Daempfung und Notloeser.
url = "http://127.0.0.1:8200/api/vorlesen/sprich?abspielen=1&text=" + urllib.parse.quote(TEXT)
antwort = subprocess.run(["curl", "-s", "-m", "30", url], capture_output=True, text=True).stdout
try:
    a = json.loads(antwort)
except Exception:
    a = {"rohantwort": antwort[:200]}
# Die gemeldete Dauer abwarten, damit der Mitschnitt die ganze Ansage traegt.
time.sleep(min(15.0, (float(a.get("dauerMs") or 0) / 1000.0) + 0.8))
auf.terminate()
auf.wait(timeout=5)

pegel, spitze = rms(MIT)
# Und WER gerade regelt — dieselbe Frage wie in mupi-lautstaerke.sh.
lauts = {}
for k in d:
    if k.get("type") != "PipeWire:Interface:Node":
        continue
    p = k.get("info", {}).get("props", {})
    if p.get("media.class") != "Audio/Sink":
        continue
    v = None
    for par in (k.get("info", {}).get("params", {}) or {}).get("Props", []) or []:
        if isinstance(par, dict) and par.get("channelVolumes"):
            v = par["channelVolumes"][0]
    lauts[p.get("node.name")] = v
print(json.dumps({
    "text": TEXT, "ende": ende, "antwort": a,
    "pegel": pegel, "spitze": spitze,
    "senken": lauts,
    "vorgabe": subprocess.run(["pactl", "get-default-sink"], capture_output=True, text=True).stdout.strip(),
}))
try:
    os.remove(MIT)
except OSError:
    pass
'''

# DER TEXT MUSS GEQUOTET WERDEN, und das hat schon einmal gekostet: `ssh host
# "python3 - " text` uebergibt die ganze Zeile an die REMOTE-Shell, die sie neu
# in Woerter zerlegt. Aus „Hallo, hoerst du mich?" wurde damit das Wort
# „Hallo," — gesprochen hat die Box brav, nur nicht den Satz, um den es ging.
befehl = "python3 - " + shlex.quote(TEXT) if TEXT else "python3 -"
lauf = subprocess.run(
    ["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", f"dietpi@{BOX}", befehl],
    input=AM_GERAET, capture_output=True, text=True, timeout=180,
)
zeile = next((z for z in lauf.stdout.splitlines() if z.startswith("{")), None)
if not zeile:
    print(f"Die Messung lief nicht durch.\n{lauf.stderr.strip()[:600]}")
    sys.exit(2)
e = json.loads(zeile)
if "fehler" in e:
    print(f"Die Messung lief nicht durch: {e['fehler']}")
    sys.exit(2)

print(f"\n  KOMMT DIE ANSAGE AN? — {BOX}\n")
print(f"  gesprochen     \"{e['text']}\"")
print(f"  Antwort        {json.dumps(e['antwort'], ensure_ascii=False)}")
print(f"  gemessen an    {e['ende']}.monitor")
print(f"  Vorgabe-Senke  {e['vorgabe']}")
print(f"\n  Pegel (RMS)    {e['pegel']:.5f}")
print(f"  Spitze         {e['spitze']:.5f}")
print("\n  Lautstaerke je Senke (linear, channelVolumes):")
for n, v in sorted(e["senken"].items()):
    print(f"    {n:70s} {('—' if v is None else f'{v:.3f}')}")

if e["pegel"] < STILL:
    print(
        "\n  AM ENDE DER KETTE KAM NICHTS AN. Die Antwort der Box sagt trotzdem ok —\n"
        "  `pw-play` laeuft im Server mit stdio:'ignore', ein Fehlschlag ist von\n"
        "  aussen nicht zu sehen. Als naechstes: pw-play von Hand auf dieselbe\n"
        "  Senke, und die Umgebung des Dienstes pruefen (XDG_RUNTIME_DIR).\n"
    )
    sys.exit(1)

print(
    f"\n  ES LIEF EIN SIGNAL ({e['pegel']:.4f} RMS). Die Box hat gesprochen — wer nichts\n"
    "  gehoert hat, sucht weiter hinten: Lautstaerke der regelnden Senke,\n"
    "  Verstaerker (MAX98357A, SD-Mode-Pin) oder Lautsprecher.\n"
)
