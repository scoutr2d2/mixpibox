#!/usr/bin/env python3
"""Misst den Zustand der VIER Auslieferungsziele an der Box — unabhaengig von
tools/ausliefern.py.

WOZU: ein Ausrollweg, der sich selbst nachmisst, beweist nur, dass er mit sich
selbst uebereinstimmt. Dieses Werkzeug rechnet dieselben Groessen mit EIGENEM
Code (md5 ueber `find|sort|md5sum` am Geraet statt ueber den Boxhelfer), zaehlt
die Rueckdreh-Erzeugungen und liest die Inode-Nummern — damit ein Tausch und ein
Rueckweg auch dann belegbar sind, wenn ausliefern.py sich irrt.

    python3 tools/ausliefern-gegenlesen.py            # Zustand als Text
    python3 tools/ausliefern-gegenlesen.py --json     # als JSON
    python3 tools/ausliefern-gegenlesen.py --vergleiche <datei.json>

Rueckgabe: 0 gemessen, 1 Box nicht erreichbar, 2 Vergleich weicht ab.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

BOX = "dietpi@192.168.178.169"
APPDIR = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
PLAYERDIR = "/home/dietpi/.mupibox/spotifycontroller-main"

ZIELE = {
    "server": ("datei", f"{APPDIR}/server.js"),
    "player": ("datei", f"{PLAYERDIR}/spotify-control.js"),
    "www": ("baum", f"{APPDIR}/www"),
    "admin": ("baum", f"{APPDIR}/www-admin"),
}

# Am Geraet, mit Bordmitteln — bewusst NICHT der Boxhelfer aus ausliefern.py.
SKRIPT = r"""
set -u
echo "{"
erst=1
for eintrag in %s; do
  name=${eintrag%%%%:*}; rest=${eintrag#*:}; art=${rest%%%%:*}; pfad=${rest#*:}
  [ $erst -eq 1 ] || echo ","
  erst=0
  printf '"%%s": {' "$name"
  if [ "$art" = baum ]; then
    if [ -L "$pfad" ]; then printf '"verweis": true, "da": false'
    elif [ -d "$pfad" ]; then
      h=$(cd "$pfad" && find . -type f -print0 | sort -z | xargs -0 md5sum 2>/dev/null | md5sum | cut -d' ' -f1)
      n=$(find "$pfad" -type f | wc -l)
      by=$(du -sb "$pfad" | cut -f1)
      ino=$(stat -c %%i "$pfad")
      idx=false; [ -f "$pfad/index.html" ] && idx=true
      printf '"da": true, "hash": "%%s", "dateien": %%s, "bytes": %%s, "inode": %%s, "index": %%s' "$h" "$n" "$by" "$ino" "$idx"
    else printf '"da": false'; fi
  else
    if [ -f "$pfad" ]; then
      h=$(md5sum "$pfad" | cut -d' ' -f1)
      printf '"da": true, "hash": "%%s", "bytes": %%s, "inode": %%s, "links": %%s' \
             "$h" "$(stat -c %%s "$pfad")" "$(stat -c %%i "$pfad")" "$(stat -c %%h "$pfad")"
    else printf '"da": false'; fi
  fi
  # die Rueckdreh-Erzeugung zum selben Ziel
  if [ -e "$pfad.zurueck" ]; then
    printf ', "zurueck_da": true, "zurueck_inode": %%s' "$(stat -c %%i "$pfad.zurueck")"
    if [ -d "$pfad.zurueck" ]; then
      zh=$(cd "$pfad.zurueck" && find . -type f -print0 | sort -z | xargs -0 md5sum 2>/dev/null | md5sum | cut -d' ' -f1)
    else zh=$(md5sum "$pfad.zurueck" | cut -d' ' -f1); fi
    printf ', "zurueck_hash": "%%s"' "$zh"
  else printf ', "zurueck_da": false'; fi
  printf '}'
done
echo
echo ', "rueckwege": ['
komma=""
for d in %s %s; do
  for f in "$d"/*.zurueck; do
    [ -e "$f" ] || continue
    printf '%%s"%%s"' "$komma" "$f"; komma=", "
  done
done
echo ']'
echo ', "lager_da": ' ; [ -d /home/dietpi/.mupibox/.ausliefern ] && echo true || echo false
echo ', "eintraege_appdir": ' ; ls -A %s | wc -l
echo ', "belegt_kb": ' ; du -s %s | cut -f1
echo "}"
""" % (
    " ".join(f"{n}:{a}:{p}" for n, (a, p) in ZIELE.items()),
    APPDIR, PLAYERDIR, APPDIR, APPDIR,
)


def messen(box: str) -> dict:
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", box, "bash -s"],
        input=SKRIPT, capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        raise RuntimeError(f"ssh rc={p.returncode}: {p.stderr.strip()[:400]}")
    return json.loads(p.stdout)


def dienste(box: str) -> dict:
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", box,
         "systemctl show -p ActiveState -p SubState -p NRestarts "
         "-p ExecMainStartTimestampMonotonic mupibox-server.service mupibox-player.service"],
        capture_output=True, text=True, timeout=60)
    bloecke, jetzt = [], {}
    for zeile in p.stdout.splitlines():
        if not zeile.strip():
            if jetzt:
                bloecke.append(jetzt)
            jetzt = {}
            continue
        k, _, v = zeile.partition("=")
        jetzt[k] = v
    if jetzt:
        bloecke.append(jetzt)
    namen = ["mupibox-server.service", "mupibox-player.service"]
    return {namen[i]: b for i, b in enumerate(bloecke) if i < len(namen)}


def main() -> int:
    t = argparse.ArgumentParser()
    t.add_argument("--box", default=BOX)
    t.add_argument("--json", action="store_true")
    t.add_argument("--vergleiche", help="frueher gespeicherte JSON-Messung")
    a = t.parse_args()

    try:
        stand = messen(a.box)
        stand["dienste"] = dienste(a.box)
    except Exception as e:  # noqa: BLE001
        print(f"X Box nicht messbar: {e!r}", file=sys.stderr)
        return 1

    if a.json:
        print(json.dumps(stand, indent=1, ensure_ascii=False))
    else:
        for n in ZIELE:
            z = stand.get(n, {})
            print(f"{n:8s} {'da' if z.get('da') else 'FEHLT':5s} "
                  f"hash={str(z.get('hash'))[:12]} inode={z.get('inode')} "
                  f"rueckweg={'ja' if z.get('zurueck_da') else 'nein'} "
                  f"({str(z.get('zurueck_hash'))[:12]})")
        print(f"Rueckwege insgesamt: {len(stand['rueckwege'])} -> {stand['rueckwege']}")
        print(f"Eintraege in APPDIR: {stand['eintraege_appdir']}  belegt: {stand['belegt_kb']} KB")
        print(f"Zwischenlager liegt noch da: {stand['lager_da']}")
        for d, f in stand["dienste"].items():
            print(f"{d}: {f.get('ActiveState')}/{f.get('SubState')} "
                  f"NRestarts={f.get('NRestarts')} start={f.get('ExecMainStartTimestampMonotonic')}")

    if a.vergleiche:
        alt = json.loads(open(a.vergleiche).read())
        abweichungen = []
        for n in ZIELE:
            for feld in ("hash", "da"):
                if alt.get(n, {}).get(feld) != stand.get(n, {}).get(feld):
                    abweichungen.append(f"{n}.{feld}: {alt.get(n, {}).get(feld)} -> {stand.get(n, {}).get(feld)}")
        if abweichungen:
            print("ABWEICHUNG gegenueber " + a.vergleiche)
            for x in abweichungen:
                print("  " + x)
            return 2
        print("Gleich wie " + a.vergleiche + " (alle vier Ziele, Hash fuer Hash).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
