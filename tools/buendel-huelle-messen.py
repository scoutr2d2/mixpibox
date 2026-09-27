#!/usr/bin/env python3
"""Misst, welche .js-Dateien eines ausgelieferten Angular-Buendels von index.html
aus wirklich erreichbar sind - und welche tote Altstaende sind.

Nur lesend. Holt die Import-Kanten per ssh von der Box (oder liest sie aus einem
lokalen Verzeichnis) und bildet die transitive Huelle ab index.html.

Aufruf:
  tools/buendel-huelle-messen.py --ssh dietpi@192.168.178.169 \
      --pfad /home/dietpi/.mupibox/Sonos-Kids-Controller-master/www-admin
  tools/buendel-huelle-messen.py --lokal /pfad/zu/www-admin
  ... [--muster "ab hier bremst sie sich"]  -> zeigt, ob ein Treffer lebt oder tot ist
"""
import argparse
import re
import subprocess
import sys

DATEI = re.compile(r"(?:chunk|main|polyfills|styles)-[A-Z0-9]{8}\.(?:js|css)")


def hole_text(ssh, pfad, datei):
    if ssh:
        return subprocess.run(
            ["ssh", "-o", "ConnectTimeout=10", ssh, f"cat {pfad}/{datei}"],
            capture_output=True, text=True, errors="replace").stdout
    with open(f"{pfad}/{datei}", encoding="utf-8", errors="replace") as f:
        return f.read()


def liste(ssh, pfad):
    if ssh:
        aus = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=10", ssh, f"cd {pfad} && ls *.js"],
            capture_output=True, text=True).stdout
    else:
        import os
        aus = "\n".join(sorted(d for d in os.listdir(pfad) if d.endswith(".js")))
    return [z.strip() for z in aus.splitlines() if z.strip()]


def kanten(ssh, pfad, dateien):
    """Ein einziger ssh-Aufruf fuer alle Kanten - sonst dauert es ewig."""
    befehl = (f"cd {pfad} && for f in *.js; do "
              f"echo \"@@ $f\"; grep -o -E '(chunk|main|polyfills)-[A-Z0-9]{{8}}\\.js' \"$f\" | sort -u; done")
    if ssh:
        aus = subprocess.run(["ssh", "-o", "ConnectTimeout=10", ssh, befehl],
                             capture_output=True, text=True).stdout
    else:
        aus = subprocess.run(["bash", "-c", befehl], capture_output=True, text=True).stdout
    graph, aktuell = {}, None
    for zeile in aus.splitlines():
        zeile = zeile.strip()
        if zeile.startswith("@@ "):
            aktuell = zeile[3:]
            graph[aktuell] = set()
        elif zeile and aktuell:
            graph[aktuell].add(zeile)
    return graph


def suche(ssh, pfad, muster):
    befehl = f"cd {pfad} && grep -l -F {muster!r} *.js 2>/dev/null || true"
    if ssh:
        aus = subprocess.run(["ssh", "-o", "ConnectTimeout=10", ssh, befehl],
                             capture_output=True, text=True).stdout
    else:
        aus = subprocess.run(["bash", "-c", befehl], capture_output=True, text=True).stdout
    return [z.strip() for z in aus.splitlines() if z.strip()]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ssh")
    p.add_argument("--pfad", required=True)
    p.add_argument("--muster", action="append", default=[])
    a = p.parse_args()

    dateien = liste(a.ssh, a.pfad)
    index = hole_text(a.ssh, a.pfad, "index.html")
    graph = kanten(a.ssh, a.pfad, dateien)

    start = {t for t in DATEI.findall(index) if t.endswith(".js")}
    huelle, rand = set(), list(start)
    while rand:
        d = rand.pop()
        if d in huelle:
            continue
        huelle.add(d)
        rand.extend(graph.get(d, ()))

    tot = sorted(set(dateien) - huelle)
    print(f".js-Dateien im Verzeichnis : {len(dateien)}")
    print(f"von index.html erreichbar  : {len(huelle & set(dateien))}")
    print(f"tote Altstaende            : {len(tot)}")
    print(f"Einstiege aus index.html   : {' '.join(sorted(start))}")
    if tot:
        print("tot: " + " ".join(tot))

    for m in a.muster:
        treffer = suche(a.ssh, a.pfad, m)
        print(f"\nMuster {m!r}: {len(treffer)} Treffer")
        for t in treffer:
            print(f"  {'LEBT' if t in huelle else 'TOT '}  {t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
