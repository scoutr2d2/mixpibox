#!/usr/bin/env python3
"""
TONWEG-DURCHGANG — misst, WIE VIEL von einem Ton am Ende wirklich ankommt.

══ WARUM ES DAS GIBT (23.08.2026) ══════════════════════════════════════════
`tools/tonweg-pegel.mjs` liest die eingestellten Werte und rechnet sie
zusammen. Fuer die Box kam dabei -82 dB heraus — das waere STUMM, und die Box
ist nicht stumm. Eine Rechnung, die dem widerspricht, was man hoert, ist
falsch oder unvollstaendig; welches von beidem, sagt nur eine Messung.

Der Unterschied ist wichtig genug, um dafuer ein eigenes Werkzeug zu haben:
die eingestellten Werte sagen, was jemand GEWOLLT hat, diese Messung sagt,
was die Kette TUT. Bei einer Beschwerde ueber Lautstaerke zaehlt das zweite.

══ WIE GEMESSEN WIRD ═══════════════════════════════════════════════════════
Ein 1-kHz-Ton mit bekanntem Pegel geht vorne in die Vorgabe-Senke — denselben
Weg, den die Musik nimmt. Gleichzeitig wird der MONITOR der Endstation
mitgeschnitten; der haengt HINTER deren Lautstaerkeregler, faengt also genau
das ab, was zur Karte geht. Der Unterschied beider Pegel ist die Kette.

DER TON IST ABSICHTLICH LEISE (-20 dBFS) und kurz. Die Messung braucht keine
Lautstaerke, sie braucht ein Verhaeltnis — und auf der Box steht ein echter
Lautsprecher in einem Kinderzimmer.

Aufruf:  python3 tools/tonweg-durchgang.py [box]
"""
import subprocess
import sys

BOX = sys.argv[1] if len(sys.argv) > 1 else "192.168.178.62"

# Das Stueck, das auf der BOX laeuft. Es steht hier als Text, damit das
# Werkzeug eine Datei bleibt und nichts auf der Box zurueckbleibt.
AM_GERAET = r'''
import array, json, math, os, struct, subprocess, sys, time, wave

RATE, SEK, PEGEL = 48000, 2.0, 0.1          # 0,1 = -20 dBFS
TON, MIT = "/tmp/tonweg-ton.wav", "/tmp/tonweg-mit.wav"

# ── der Prueston ──────────────────────────────────────────────────────────
n = int(RATE * SEK)
proben = array.array("h", (int(PEGEL * 32767 * math.sin(2*math.pi*1000*i/RATE)) for i in range(n)))
with wave.open(TON, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(proben.tobytes())

def rms(pfad):
    with wave.open(pfad, "rb") as w:
        roh = w.readframes(w.getnframes())
        breite, kanaele = w.getsampwidth(), w.getnchannels()
    if not roh: return 0.0
    werte = array.array({1:"b",2:"h",4:"i"}[breite]); werte.frombytes(roh[:len(roh)//breite*breite])
    if not werte: return 0.0
    voll = float(2**(8*breite-1))
    # Nur den mittleren Teil messen: Anfang und Ende enthalten das Anlaufen
    # der Kette, und ein Mittelwert ueber eine Rampe ist keine Aussage.
    m = werte[len(werte)//4 : 3*len(werte)//4] or werte
    return math.sqrt(sum((x/voll)**2 for x in m) / len(m))

vorgabe = subprocess.run(["pactl","get-default-sink"], capture_output=True, text=True).stdout.strip()

# Die Endstation ist die ALSA-Senke — dort geht es zur Karte.
d = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True).stdout)
ende = None
for k in d:
    if k.get("type") != "PipeWire:Interface:Node": continue
    p = k.get("info",{}).get("props",{})
    if p.get("media.class") == "Audio/Sink" and "alsa_output" in (p.get("node.name") or ""):
        ende = p["node.name"]
if not ende:
    print(json.dumps({"fehler":"keine ALSA-Senke gefunden"})); sys.exit(2)

auf = subprocess.Popen(["pw-record","--target",ende+".monitor","--rate","48000","--channels","1",MIT],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.7)
subprocess.run(["pw-play","--target",vorgabe,TON], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
time.sleep(0.4)
auf.terminate(); auf.wait(timeout=5)

hinein, heraus = rms(TON), rms(MIT)
print(json.dumps({
    "vorgabe": vorgabe, "ende": ende,
    "hinein": hinein, "heraus": heraus,
    "dB": (20*math.log10(heraus/hinein) if hinein > 0 and heraus > 0 else None),
}))
for f in (TON, MIT):
    try: os.remove(f)
    except OSError: pass
'''

lauf = subprocess.run(
    ["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", f"dietpi@{BOX}", "python3 - "],
    input=AM_GERAET, capture_output=True, text=True, timeout=120,
)
zeile = next((z for z in lauf.stdout.splitlines() if z.startswith("{")), None)
if not zeile:
    print(f"Die Messung lief nicht durch.\n{lauf.stderr.strip()[:600]}")
    sys.exit(2)

import json
e = json.loads(zeile)
if "fehler" in e:
    print(f"Die Messung lief nicht durch: {e['fehler']}")
    sys.exit(2)

print(f"\n  DURCHGANG DER TONKETTE — {BOX}\n")
print(f"  hinein bei   {e['vorgabe']}")
print(f"  heraus an    {e['ende']}.monitor\n")
print(f"  Pegel hinein   {e['hinein']:.5f}")
print(f"  Pegel heraus   {e['heraus']:.5f}")
if e["dB"] is None:
    print("\n  Am Ende kam NICHTS an — die Kette ist unterbrochen oder stumm.\n")
    sys.exit(1)
print(f"\n  Die Kette macht {e['dB']:+.1f} dB.\n")
# Ein Kinderzimmer-Lautsprecher, der 20 dB verschenkt, ist nicht mehr laut
# zu bekommen — der Regler steht dann schon oben.
if e["dB"] < -20:
    print("  DAS IST DIE DECKELUNG: mehr als 20 dB gehen unterwegs verloren,\n"
          "  und der Regler der Box erreicht sie nicht.\n")
    sys.exit(1)
