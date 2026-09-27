#!/usr/bin/env python3
"""
Haelt "Verbrauchte Hoerzeit von heute" JE PROFIL?

NUR LESEND. Fragt die Box ueber Port 8200 und vergleicht drei Dinge, die
zusammenpassen muessen, damit die Aussage stimmt:

  1. GIBT ES DIE ABLAGE JE PROFIL — und zwar je WIRKLICHEM Profil.
     Ein Ordner unter profile/ ist KEIN Profil. Nur was in profile.json
     steht, zaehlt; alles andere ist Rest eines geloeschten Kindes und
     blaeht jede `find | wc -l`-Zaehlung auf.
  2. WIRD DAS FELD GEFUELLT — zaehlt also jemand hinein? Der Takt im Server
     zaehlt NUR bei `regeln.aktiv`. Ist die Kinderzeit aus, bleibt
     `verbrauchtMin` fuer immer 0, egal wie lange gehoert wurde.
     Gegenprobe: gespielt.json/resume.json des Profils von HEUTE.
  3. KOMMT DIE OBERFLAECHE DA HIN — ruft die ausgelieferte Verwaltung
     `?profil=` auf? Ohne das sieht ein Elternteil immer nur das gerade
     aktive Kind und kann kein anderes Konto ansehen oder zuruecksetzen.

Aufruf:  python3 tools/hoerzeit-je-profil-probe.py [box]
"""

import json
import subprocess
import sys
import urllib.request

BOX = sys.argv[1] if len(sys.argv) > 1 else "192.168.178.169"
API = f"http://{BOX}:8200/api"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{BOX}"]
CONF = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
AUSGELIEFERT = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www-admin"


def hole(weg):
    try:
        with urllib.request.urlopen(f"{API}{weg}", timeout=8) as a:
            return json.load(a)
    except Exception as e:  # noqa: BLE001 - die Meldung IST das Ergebnis
        return {"fehler": str(e)}


def am_geraet(befehl):
    p = subprocess.run(SSH + [befehl], capture_output=True, text=True, timeout=25)
    return p.stdout.strip()


def erreichbar():
    """Steht die Box ueberhaupt? EINMAL, vor jeder Messung.

    WARUM (24.08.2026): diese Probe LUEGT nicht, sie stirbt — an der
    abgeschalteten Box endete sie in einem JSONDecodeError-Rueckverfolg ueber
    `json.loads(am_geraet(...))`, weil leerer Text kein JSON ist. Das ist die
    harmlosere Haelfte derselben Familie; ein Rueckverfolg liest sich aber wie
    ein Fehler IM WERKZEUG, und wer ihn sieht, sucht an der falschen Stelle.
    """
    p = subprocess.run(
        SSH + ["echo da"], capture_output=True, text=True, timeout=20)
    return p.stdout.strip() == "da"


def main():
    if not erreichbar():
        print(f"ABBRUCH: {BOX} antwortet nicht auf ssh — es wurde NICHTS gemessen.")
        print("Kein Urteil. Box einschalten und erneut laufen lassen.")
        return 2

    print("== 1. Profile (Wahrheit) gegen Ordner (Schein) ==")
    profile = json.loads(am_geraet(f"cat {CONF}/profile.json"))
    echte = [p["kennung"] for p in profile.get("profile", [])]
    ordner = am_geraet(f"ls -1 {CONF}/profile").split()
    dateien = am_geraet(
        f"find {CONF}/profile -name kinderzeit-verbrauch.json | wc -l"
    )
    print(f"   profile.json : {echte}   aktiv={profile.get('aktiv')!r}")
    print(f"   Ordner       : {ordner}")
    print(f"   Dateien      : {dateien}  <- zaehlt auch Reste geloeschter Profile")
    for k in ordner:
        if k not in echte:
            print(f"   !! '{k}' ist KEIN Profil (mehr) - die Datei dort ist tot")

    print("\n== 2. Wird gezaehlt? ==")
    for k in echte:
        stand = hole(f"/kinderzeit/stand?profil={k}")
        gespielt = am_geraet(
            f"stat -c %y {CONF}/profile/{k}/gespielt.json 2>/dev/null || echo -"
        )
        verbrauch = am_geraet(
            f"stat -c %y {CONF}/profile/{k}/kinderzeit-verbrauch.json 2>/dev/null || echo -"
        )
        print(
            f"   {k:8} aktiv={str(stand.get('aktiv')):5} "
            f"verbrauchtMin={stand.get('verbrauchtMin')}"
        )
        print(f"            zuletzt gehoert : {gespielt}")
        print(f"            zuletzt gebucht : {verbrauch}")
        if stand.get("aktiv") is False:
            print("            !! Kinderzeit AUS -> der Takt zaehlt gar nicht")

    print("\n== 3. Kommt die Verwaltung an ein anderes Profil? ==")
    rufe = am_geraet(
        "grep -rho \"kinderzeit[^\\\"'\\`]\\{0,40\\}\" " + AUSGELIEFERT + "/*.js | sort -u"
    )
    print(rufe or "   (nichts gefunden)")
    if "profil=" not in rufe:
        print("   !! KEIN '?profil=' - die Verwaltung sieht immer nur das AKTIVE Kind")


if __name__ == "__main__":
    # Der Ausgang muss ANKOMMEN: `main()` allein wirft die 2 fuer „unmessbar"
    # weg, und ein Laeufer saehe gruen.
    sys.exit(main())
