#!/usr/bin/env python3
"""
Prueft die Behauptung: "Verbrauchte Kinderzeit heute" gilt JE PROFIL.

NUR LESEND. Kein POST/PUT, kein Schreiben auf der Box, kein systemctl.
Gemessen wird an drei Stellen, weil die Behauptung an drei Stellen
auseinanderfallen kann:

  A  DIE ABLAGE      liegt je Profil eine Datei, und gehoert sie zu einem
                     Profil, das es wirklich gibt?
  B  DIE SCHNITTSTELLE  antwortet ?profil=<x> mit x -- und weist Unbekanntes ab?
  C  DIE OBERFLAECHE  ruft die ausgelieferte Verwaltung jemals MIT ?profil=,
                     und liest sie das Feld `profil` ueberhaupt? Und zaehlt
                     die Box-Oberflaeche nebenher im Browserspeicher mit?

C ist der Teil, der ueblicherweise fehlt: profilbewusst gebaut, aber ohne
Weg dorthin. Ein Betreiber, der nicht hinkommt, hat es nicht.

ES GAB DIESE PROBE ZWEIMAL (aufgeloest am 19.09.2026). `kinderzeit-je-kind-
probe.py` (08.08.2026) stellte dieselben drei Fragen an dieselben Endpunkte,
kannte diese Datei nicht und umgekehrt -- zwei Antworten auf eine Frage, von
denen die aeltere NIE urteilte (Rueckgabe immer 0) und ohne Erreichbarkeits-
riegel an einer abgeschalteten Box „WIDERLEGT" gedruckt haette. Vor dem
Loeschen nachgemessen, was nur SIE konnte; drei Stuecke, alle hier
eingezogen und im Quelltext als uebernommen vermerkt:

    * die anderen Ablagen desselben Profils mit Zeitstempel (Teil A) --
      ein alter Zaehler neben einem frischen Verlauf ist ein Befund,
    * die Regeln je Kennung BEIM DIENST erfragt statt in der Datei
      gelesen (Teil B),
    * der Zaehler im Browserspeicher der Box-Oberflaeche (Teil C2) --
      die einzige Frage, die der Server nicht beantwortet.

Aufruf:  python3 tools/kinderzeit-je-kind-pruefen.py [--box 192.168.178.169]
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.request

BOX = "192.168.178.169"
PORT = 8200
SSH = "dietpi@{}"
WURZEL = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"


def hole(pfad, box):
    url = f"http://{box}:{PORT}{pfad}"
    try:
        with urllib.request.urlopen(url, timeout=10) as a:
            return a.status, json.loads(a.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None
    except Exception as e:
        return 0, {"fehler": str(e)}


def amGeraet(befehl, box):
    r = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", SSH.format(box), befehl],
        capture_output=True, text=True, timeout=40,
    )
    return r.stdout


def erreichbar(box):
    """Steht die Box ueberhaupt? EINMAL, vor jeder Messung.

    WARUM (24.08.2026): jede Messung hier liest ueber ssh. Ist die Box aus,
    gibt `amGeraet` leeren Text — und JEDER Test unten liest leeren Text als
    „nichts gefunden". Ohne diesen Riegel lief die Probe an der abgeschalteten
    Box durch und druckte „WIDERLEGT -- die Verwaltung ruft KEINEN einzigen
    /api/profil*-Endpunkt": ein Urteil ueber ein Bundle, das sie nie gesehen
    hat. Nicht gemessen ist nicht dasselbe wie null gemessen.
    """
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", SSH.format(box), "echo da"],
        capture_output=True, text=True, timeout=20,
    )
    return r.stdout.strip() == "da"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--box", default=BOX)
    a = p.parse_args()
    box = a.box
    urteile = []

    if not erreichbar(box):
        print(f"ABBRUCH: {box} antwortet nicht auf ssh — es wurde NICHTS gemessen.")
        print("Kein Urteil. Box einschalten und erneut laufen lassen.")
        return 2

    print("== A  DIE ABLAGE ==")
    dateien = amGeraet(
        f"find {WURZEL}/server/config/profile -name kinderzeit-verbrauch.json -printf '%p\\t%s\\t%TY-%Tm-%Td\\n'",
        box).strip().splitlines()
    _, stand = hole("/api/profile", box)
    bekannt = [x["kennung"] for x in (stand or {}).get("profile", [])]
    print(f"   profile.json kennt: {bekannt}   aktiv: {(stand or {}).get('aktiv')}")
    verwaist = []
    for z in dateien:
        teile = z.split("\t")
        kennung = teile[0].split("/")[-2]
        inhalt = amGeraet(f"cat {teile[0]}", box)
        try:
            d = json.loads(inhalt)
            kurz = f"tag={d.get('tag')} sekunden={d.get('sekunden')} bonusMin={d.get('bonusMin')}"
        except Exception:
            kurz = "unlesbar"
        marke = "" if kennung in bekannt else "  <-- VERWAIST, kein Profil dieses Namens"
        if kennung not in bekannt:
            verwaist.append(kennung)
        print(f"   {kennung:10s} {kurz}{marke}")
    if verwaist:
        urteile.append(f"A: {len(verwaist)} verwaiste Datei(en) {verwaist} -- eine Datei ist kein Kind")

    # Die ANDEREN Ablagen desselben Profils, mit Zeitstempel. Uebernommen am
    # 19.09.2026 aus tools/kinderzeit-je-kind-probe.py, bevor die geloescht
    # wurde: sie ist die Gegenprobe zur Zaehlung. Wer heute gehoert hat, hat
    # einen frischen Verlauf -- und muesste dann auch heute gezaehlt worden
    # sein. Ein alter Zaehler neben einem frischen Verlauf ist der Fall, den
    # die Zahlen allein nicht zeigen.
    print("\n   zum Vergleich, Verlauf/Fortsetzen derselben Bereiche:")
    print(amGeraet(
        f"find {WURZEL}/server/config/profile -maxdepth 2 -type f "
        "-printf '   %TY-%Tm-%Td %TH:%TM  %8s  %p\\n'", box).rstrip() or "   (nichts gefunden)")

    print("\n== B  DIE SCHNITTSTELLE ==")
    for k in bekannt + ["probe", "gibtsnicht"]:
        code, d = hole(f"/api/kinderzeit/stand?profil={k}", box)
        if code == 200:
            print(f"   ?profil={k:12s} -> {code} profil={d.get('profil')!r} "
                  f"aktiv={d.get('aktiv')} verbrauchtMin={d.get('verbrauchtMin')}")
        else:
            print(f"   ?profil={k:12s} -> {code} {d}")
    code, d = hole("/api/kinderzeit/stand", box)
    print(f"   ohne ?profil       -> {code} profil={d.get('profil')!r} (= das AKTIVE)")
    code, regeln = hole("/api/kinderzeit", box)
    print(f"   /api/kinderzeit    -> aktiv={regeln.get('aktiv')} (die HAUSREGEL)")
    if not regeln.get("aktiv"):
        urteile.append("B: Kinderzeit ist AUS -- es wird ueberhaupt nichts gezaehlt (kzTakt zaehlt nur bei regeln.aktiv)")

    # Die REGELN je Kind, beim DIENST erfragt statt in der Datei gelesen
    # (19.09.2026 aus tools/kinderzeit-je-kind-probe.py uebernommen). Der
    # Unterschied ist nicht akademisch: `je` in kinderzeit.json zu haben
    # heisst nicht, dass der Weg dorthin antwortet -- und umgekehrt kann der
    # Dienst je Kennung dieselbe Hausregel ausliefern, obwohl die Datei
    # verschiedene fuehrt. Gelesen wird nur; kein POST, kein PUT.
    for k in bekannt:
        code, jeRegeln = hole(f"/api/kinderzeit?profil={k}", box)
        minuten = {t: v.get("minuten") for t, v in ((jeRegeln or {}).get("tage") or {}).items()}
        print(f"   ?profil={k:12s} -> {code} aktiv={(jeRegeln or {}).get('aktiv')} minuten={minuten}")

    roh = amGeraet(f"cat {WURZEL}/server/config/kinderzeit.json", box)
    try:
        je = json.loads(roh).get("je", {})
        print(f"   kinderzeit.json    -> je = {je}")
        if not je:
            urteile.append("B: `je` ist LEER -- alle Kinder teilen sich EINE Grenze; nur das Konto ist getrennt, nicht das Budget")
    except Exception:
        print("   kinderzeit.json    -> unlesbar")

    print("\n== C  DIE OBERFLAECHE (ausgeliefertes Bundle) ==")
    for name, ort in (("Verwaltung", "www-admin"), ("Box", "www")):
        rufe = amGeraet(f"grep -rho '/api/profil[a-z/]*' {WURZEL}/{ort}/ | sort | uniq -c", box).strip()
        print(f"   {name}: /api/profil*-Aufrufe: {rufe if rufe else '(KEINE)'}")
        if ort == "www-admin" and not rufe:
            urteile.append("C: die Verwaltung ruft KEINEN einzigen /api/profil*-Endpunkt -- sie kennt keine Profile")
        umfeld = amGeraet(
            "grep -rho '.\\{50\\}kinderzeit/\\(stand\\|bonus\\|zuruecksetzen\\).\\{20\\}' "
            f"{WURZEL}/{ort}/ | sort -u", box).strip().splitlines()
        for z in umfeld:
            mit = "?profil=" in z or "profil:" in z
            print(f"     {'MIT' if mit else 'OHNE'} profil | ...{z[-90:]}")
            if ort == "www-admin" and not mit:
                pass
    ohneProfil = amGeraet(
        f"grep -c 'kinderzeit/stand?profil' {WURZEL}/www-admin/*.js 2>/dev/null | grep -v ':0' | wc -l", box).strip()
    if ohneProfil == "0":
        urteile.append("C: kein einziger Aufruf der Verwaltung traegt ?profil= -- Anzeige, Bonus und Zuruecksetzen treffen immer das AKTIVE Profil")

    # Liest die Verwaltung das Feld `profil` aus der Antwort?
    liest = amGeraet(
        f"grep -rho 'verbrauchtMin[^;]\\{{0,120\\}}' {WURZEL}/www-admin/ | head -3", box).strip()
    print(f"\n   Verwaltung, Umfeld von verbrauchtMin:\n     {liest if liest else '(nichts)'}")

    # C2  ZAEHLT DIE BOX-OBERFLAECHE IM BROWSERSPEICHER MIT?
    # Uebernommen am 19.09.2026 aus tools/kinderzeit-je-kind-probe.py. Es ist
    # die einzige Frage dieser Probe, die NICHT der Server beantwortet: ein
    # Zaehler in localStorage haengt am BROWSER, nicht am Profil. Zwei Kinder
    # an derselben Box teilen sich dann einen Stand, egal wie sauber der
    # Dienst trennt -- und ein Kind, das die Seite neu laedt, faengt von vorn.
    speicher = amGeraet(
        "grep -rho 'localStorage[^;]\\{0,60\\}\\(kinderzeit\\|verbrauch\\|kzeit\\)[^;]\\{0,30\\}' "
        f"{WURZEL}/www/ | sort -u", box).strip().splitlines()
    print("\n   Box-Oberflaeche, Zaehler im Browserspeicher:")
    for z in speicher:
        print(f"     {z}")
    if not speicher:
        print("     (keiner -- richtig so: gezaehlt wird auf der Box, nicht im Browser)")
    else:
        urteile.append(
            f"C2: die Box-Oberflaeche fuehrt {len(speicher)} Zaehler in localStorage -- "
            "der haengt am Browser, nicht am Kind")

    print("\n== URTEIL ==")
    if urteile:
        for u in urteile:
            print(f"   WIDERLEGT -- {u}")
    else:
        print("   Kein Einwand gefunden.")
    return 1 if urteile else 0


if __name__ == "__main__":
    sys.exit(main())
