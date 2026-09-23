#!/usr/bin/env python3
"""
Gilt das Kinderzeit-Guthaben auf der Kinderzeit-SEITE je Profil?

Die Frage ist NICHT, ob der Server je Profil rechnet — das tut er. Die Frage
ist, was der Betreiber in der Verwaltung davon hat. Deshalb misst dieses
Werkzeug drei Dinge getrennt:

  1. SERVER: liefert /api/kinderzeit/stand je Profil verschiedene Konten?
  2. ABLAGE: liegen die Konten getrennt auf der Platte?
  3. OBERFLAECHE: schickt das AUSGELIEFERTE Verwaltungs-Buendel jemals ein
     ?profil=, und zeigt es das mitgelieferte Feld `profil` ueberhaupt an?

Punkt 3 entscheidet. Ein Konto, das je Profil gefuehrt wird, aber in der
Verwaltung weder benannt noch gewechselt werden kann, ist fuer den Betreiber
EIN Konto — naemlich das des Profils, das gerade an der Box aktiv ist.

NUR LESEND: GET und ssh mit ls/cat/grep. Kein POST, kein PUT, nichts wird
angefasst.

Aufruf:  python3 tools/kinderzeit-guthaben-je-profil.py [--box 192.168.178.169]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request

BOX = "192.168.178.169"
PORT = 8200
SSH = "dietpi@{host}"
ADMIN = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www-admin"
KONTEN = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/profile"


def holen(host: str, weg: str) -> dict | None:
    url = f"http://{host}:{PORT}{weg}"
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def am_geraet(host: str, befehl: str) -> str:
    r = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=15", SSH.format(host=host), befehl],
        capture_output=True,
        text=True,
    )
    return (r.stdout or "") + (r.stderr or "")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--box", default=BOX)
    a = p.parse_args()
    host = a.box

    print("== 1. SERVER: rechnet er je Profil? ==")
    liste = holen(host, "/api/profile") or {}
    profile = [x.get("kennung") for x in (liste.get("profile") or [])]
    aktiv = liste.get("aktiv")
    print(f"   Profile: {profile}   aktiv: {aktiv}")

    ohne = holen(host, "/api/kinderzeit/stand") or {}
    print(f"   ohne ?profil=  -> profil={ohne.get('profil')!r} "
          f"verbrauchtMin={ohne.get('verbrauchtMin')} bonusMin={ohne.get('bonusMin')}")
    for k in profile:
        s = holen(host, f"/api/kinderzeit/stand?profil={k}") or {}
        print(f"   ?profil={k:<8} -> profil={s.get('profil')!r} "
              f"verbrauchtMin={s.get('verbrauchtMin')} bonusMin={s.get('bonusMin')}")
    folgt_aktivem = ohne.get("profil") == aktiv
    print(f"   -> ohne Angabe nimmt der Server das AKTIVE Profil: {folgt_aktivem}")

    print()
    print("== 2. ABLAGE: getrennte Konten auf der Platte? ==")
    print(am_geraet(host, f"ls -1 {KONTEN}/*/kinderzeit-verbrauch.json 2>&1").rstrip())
    verwaist = [d for d in am_geraet(host, f"ls -1 {KONTEN} 2>/dev/null").split()
                if d and d not in profile]
    if verwaist:
        print(f"   VERWAIST (Ordner ohne Profil): {verwaist}")

    print()
    print("== 3. OBERFLAECHE: was kann der Betreiber davon nutzen? ==")
    chunk = am_geraet(host, f'grep -rl "Heute geh" {ADMIN} | head -1').strip()
    print(f"   Kinderzeit-Buendel: {chunk or '(nicht gefunden)'}")
    if chunk:
        wege = am_geraet(host, f"grep -oh 'api/kinderzeit[^\"'\\''\\`]*' {chunk} | sort -u")
        print("   gerufene Wege:", " ".join(wege.split()) or "(keine)")
        n_profil = am_geraet(host, f'grep -c "profil" {chunk}').strip()
        print(f"   Vorkommen von 'profil' im Buendel: {n_profil}")
    ganz = am_geraet(host, f'grep -rl "profil=" {ADMIN} | head -3').strip()
    print(f"   Dateien der Verwaltung mit '?profil=': {ganz or '(KEINE)'}")
    prof_api = am_geraet(host, f'grep -rl "api/profile" {ADMIN} | head -3').strip()
    print(f"   Dateien der Verwaltung mit 'api/profile': {prof_api or '(KEINE)'}")

    print()
    print("== URTEIL ==")
    getrennt = folgt_aktivem and len(profile) > 1
    waehlbar = bool(ganz) or bool(prof_api)
    print(f"   Konten je Profil getrennt gefuehrt : {getrennt}")
    print(f"   In der Verwaltung waehlbar/benannt : {waehlbar}")
    if getrennt and not waehlbar:
        print("   -> JE PROFIL im Server, aber NICHT auf der Seite: die Karte zeigt")
        print("      immer das gerade AKTIVE Profil, ungenannt und nicht wechselbar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
