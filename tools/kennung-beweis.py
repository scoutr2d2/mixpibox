#!/usr/bin/env python3
"""Geht die Messreihe wirklich NICHT in die Inhalts-Kennung ein? Am Geraet.

WARUM ES DAS GIBT — und warum NICHT der naheliegende Weg gewaehlt wurde:
`akkuverlauf.json` steht seit E29/B6 in `BEIWERK`: sie geht in den Stand, zaehlt
aber nicht bei der Frage „hat sich die Konfiguration geaendert?". Der
naheliegende Beweis waere, zu warten, bis der Server die Reihe schreibt, und
dann `--anlegen --wenn-anders` zu rufen.

DIESER WEG IST AN EINER LAUFENDEN BOX WERTLOS. Am 05.08.2026 so gefahren: die
Reihe wurde um 14:02:37 geschrieben (195870 -> 196300 B), es entstand ein neuer
Stand — aber im selben Zeitraum hatten sich auch network.json,
offline_resume.json und resume.json geaendert. Die Messung sagte also nichts
ueber den Akkuverlauf, sondern nur, dass die Box laeuft.

WAS DIESES WERKZEUG STATTDESSEN TUT: Die Kennung ist eine reine Funktion der
Dateiliste ohne BEIWERK. Also wird sie aus einem ECHTEN Stand nachgerechnet —
einmal mit seiner eigenen Messreihe, einmal mit der eines anderen Standes
(nachweislich andere sha256). Sind beide gleich UND gleich der im Stand
hinterlegten, ist die Aussage belegt. Die Gegenprobe (data.json verbogen) muss
eine ANDERE Kennung geben, sonst prueft das Werkzeug gar nichts.

Es ist REIN LESEND: es oeffnet vorhandene Staende und rechnet. Es schreibt
nichts, weder in die Konfiguration noch in die Staende.

AUFRUF (auf der Box)
    python3 kennung-beweis.py
    python3 kennung-beweis.py --skript scripts/mupibox/mupibox-sicherung.py
"""
import argparse
import importlib.util, os, sys

p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
p.add_argument("--skript", default="/usr/local/bin/mupibox/mupibox-sicherung.py")
a = p.parse_args()

spec = importlib.util.spec_from_file_location("m", a.skript)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def kennung(dateien):
    return m.sha("\n".join(f"{d['pfad']}:{d['sha256']}"
                           for d in sorted(dateien, key=lambda x: x["pfad"])
                           if d["pfad"] not in m.BEIWERK).encode())

alle = m.staende_lesen()
staende = []
for n in alle:
    try:
        s, _ = m.stand_oeffnen(os.path.join(m.STAENDE, n))
    except Exception:
        continue
    if any(d["pfad"] in m.BEIWERK for d in s["dateien"]):
        staende.append((n, s))
if len(staende) < 2:
    raise SystemExit("weniger als zwei Staende mit Messreihe — nichts zu vergleichen")

neu_n, neu_s = staende[0]
alt_n, alt_s = staende[-1]
reihe = "server/config/akkuverlauf.json"
sha_neu = next(d["sha256"] for d in neu_s["dateien"] if d["pfad"] == reihe)
sha_alt = next(d["sha256"] for d in alt_s["dateien"] if d["pfad"] == reihe)
print(f"Stand    {neu_n}")
print(f"         Messreihe sha {sha_neu[:16]}…")
print(f"Vergleich mit der Messreihe aus {alt_n}")
print(f"         Messreihe sha {sha_alt[:16]}…   verschieden: {sha_neu != sha_alt}")

eigene = kennung(neu_s["dateien"])
getauscht = kennung([dict(d, sha256=sha_alt) if d["pfad"] == reihe else d
                     for d in neu_s["dateien"]])
print()
print(f"Kennung mit eigener Messreihe    {eigene[:32]}")
print(f"Kennung mit fremder  Messreihe   {getauscht[:32]}")
print(f"GLEICH: {eigene == getauscht}   (im Stand steht {neu_s['inhalt_kennung'][:32]})")
print(f"stimmt mit dem Stand ueberein: {eigene == neu_s['inhalt_kennung']}")

# Gegenprobe: eine Datei, die NICHT Beiwerk ist, muss sehr wohl durchschlagen.
andere = "server/config/data.json"
gegen = kennung([dict(d, sha256="00" * 32) if d["pfad"] == andere else d
                 for d in neu_s["dateien"]])
print(f"\nGegenprobe: data.json verbogen -> Kennung anders: {gegen != eigene}")
