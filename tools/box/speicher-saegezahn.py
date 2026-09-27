#!/usr/bin/env python3
"""WIE OFT LAEUFT DER SPEICHER DER BOX VOLL? — Saegezahn im Systemverlauf.

WOZU ES DAS GIBT
----------------
Am 05.09.2026, 13:37:29 hat der OOM-Killer den Kiosk-Renderer erschossen
(`Killed process 1277 (WPEWebProcess)`, anon-rss 1082672 kB). Die naechste
Frage lautet immer: WAR DAS DAS ERSTE MAL? Der Journal der Box konnte sie
nicht beantworten — er reichte zum Zeitpunkt der Untersuchung nur rund
20 Minuten zurueck, weil der MuPiHAT-Logger alle fuenf Sekunden schreibt und
alles Aeltere hinausdrueckt.

Der Server fuehrt aber selbst Buch: `/api/system/verlauf` liefert 600 Punkte
ueber 24 Stunden (alle ~144 s) mit Prozessorlast, SPEICHER IN PROZENT,
Temperatur und Netzlaufzeit. Darin steht die Antwort — man muss sie nur lesen:

    m: 65 -> 74 -> 83 -> 81 -> 86 -> 44 -> 44 -> 45 -> ...
                                     ^^ hier ist jemand gestorben

Ein SAEGEZAHN (langsamer Anstieg, senkrechter Absturz) ist die Signatur eines
Lecks mit OOM-Kill am Ende. Ein einzelner Absturz kann ein Neustart sein; eine
Reihe gleichmaessiger Zaehne ist ein Befund.

WAS DIESES WERKZEUG NICHT KANN
------------------------------
Es sieht nur die SUMME. Welcher Prozess den Speicher hielt, steht hier nicht —
das sagt `dmesg` (solange der Kill im Ringpuffer liegt) oder, waehrend es
laeuft, `tools/box/renderer-speicher-verlauf.py`. Ein Absturz in dieser Kurve
kann auch ein sauberer Neustart der Box sein; deshalb wird die LAUFZEIT
danebengestellt, wo sie zu haben ist.

AUFRUF
------
    python3 tools/box/speicher-saegezahn.py
    python3 tools/box/speicher-saegezahn.py --box 192.168.178.62
    python3 tools/box/speicher-saegezahn.py --datei verlauf.json
    python3 tools/box/speicher-saegezahn.py --schwelle 10 --json

Rein LESEND: ein GET auf /api/system/verlauf, sonst nichts.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.request

VORGABE_BOX = "192.168.178.62"
VORGABE_PORT = 8200

# Ein Absturz ist ein Fall um mindestens so viele PROZENTPUNKTE zwischen zwei
# benachbarten Punkten. 15 ist bewusst grob: die normale Atmung der Box (ein
# Album laedt, ein Zwischenspeicher wird frei) liegt darunter, ein
# freigeraeumtes Gigabyte auf einer 2-GB-Box liegt bei rund 50 Punkten.
VORGABE_SCHWELLE = 15


def verlauf_holen(box: str, port: int, frist: int = 25) -> list[dict]:
    adresse = f"http://{box}:{port}/api/system/verlauf"
    with urllib.request.urlopen(adresse, timeout=frist) as antwort:
        daten = json.loads(antwort.read().decode("utf-8"))
    punkte = daten.get("punkte") or []
    if not punkte:
        raise ValueError("Der Verlauf ist leer.")
    return punkte


def zeit(ms: float) -> dt.datetime:
    return dt.datetime.fromtimestamp(ms / 1000)


def abstuerze_finden(punkte: list[dict], schwelle: int) -> list[dict]:
    """Benachbarte Punkte, zwischen denen der Speicher einbricht."""
    gefunden = []
    for vorher, nachher in zip(punkte, punkte[1:]):
        fall = vorher.get("m", 0) - nachher.get("m", 0)
        if fall >= schwelle:
            gefunden.append(
                {
                    "zeit": nachher["t"],
                    "von": vorher["m"],
                    "auf": nachher["m"],
                    "fall": fall,
                }
            )
    return gefunden


def anstieg_je_stunde(punkte: list[dict]) -> float | None:
    """Steigung in Prozentpunkten/Stunde ueber kleinste Quadrate."""
    if len(punkte) < 3:
        return None
    stunden = [(p["t"] - punkte[0]["t"]) / 3_600_000 for p in punkte]
    werte = [p["m"] for p in punkte]
    n = len(punkte)
    mx = sum(stunden) / n
    my = sum(werte) / n
    oben = sum((x - mx) * (y - my) for x, y in zip(stunden, werte))
    unten = sum((x - mx) ** 2 for x in stunden)
    return None if unten == 0 else oben / unten


def hauptlauf(argv: list[str] | None = None) -> int:
    zerleger = argparse.ArgumentParser(
        description="Saegezahn im Speicherverlauf der Box finden (rein lesend).",
    )
    zerleger.add_argument("--box", default=VORGABE_BOX, help=f"Adresse (Vorgabe {VORGABE_BOX})")
    zerleger.add_argument("--port", type=int, default=VORGABE_PORT)
    zerleger.add_argument("--datei", help="statt der Box eine gespeicherte Antwort lesen")
    zerleger.add_argument(
        "--schwelle",
        type=int,
        default=VORGABE_SCHWELLE,
        help=f"Absturz ab wie vielen Prozentpunkten Fall (Vorgabe {VORGABE_SCHWELLE})",
    )
    zerleger.add_argument("--json", action="store_true")
    args = zerleger.parse_args(argv)

    try:
        if args.datei:
            punkte = (json.load(open(args.datei, encoding="utf-8")) or {}).get("punkte") or []
        else:
            punkte = verlauf_holen(args.box, args.port)
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as fehler:
        print(f"Verlauf nicht lesbar: {fehler}", file=sys.stderr)
        return 1

    punkte = sorted(punkte, key=lambda p: p["t"])
    abstuerze = abstuerze_finden(punkte, args.schwelle)
    von, bis = zeit(punkte[0]["t"]), zeit(punkte[-1]["t"])
    stunden = (punkte[-1]["t"] - punkte[0]["t"]) / 3_600_000

    if args.json:
        print(json.dumps({"punkte": len(punkte), "abstuerze": abstuerze}, indent=2))
        return 0

    print(f"# Speicherverlauf {args.box}")
    print(f"# {len(punkte)} Punkte, {von:%d.%m. %H:%M} bis {bis:%d.%m. %H:%M} ({stunden:.1f} h)")
    print(f"# Speicher {min(p['m'] for p in punkte)} % bis {max(p['m'] for p in punkte)} %\n")

    if not abstuerze:
        print(f"  Kein Fall um {args.schwelle} Prozentpunkte oder mehr.")
        print("  Kein Saegezahn in diesem Fenster — was auch heisst: kein OOM-Kill,")
        print("  der genug freigeraeumt haette, um hier aufzufallen.")
        return 0

    print(f"── {len(abstuerze)} Einbrueche um mindestens {args.schwelle} Punkte ──────────")
    vorige = None
    for a in abstuerze:
        wann = zeit(a["zeit"])
        luecke = ""
        if vorige is not None:
            luecke = f"   (+{(a['zeit'] - vorige) / 3_600_000:.1f} h)"
        print(f"  {wann:%d.%m. %H:%M:%S}   {a['von']:>3} % -> {a['auf']:>3} %   (-{a['fall']}){luecke}")
        vorige = a["zeit"]

    if len(abstuerze) >= 2:
        spanne = (abstuerze[-1]["zeit"] - abstuerze[0]["zeit"]) / 3_600_000
        mittel = spanne / (len(abstuerze) - 1)
        print(f"\n  Mittlerer Abstand: {mittel:.1f} h")

    # Die Steigung zwischen den letzten beiden Einbruechen: so schnell fuellt
    # sich die Box, wenn sie gerade wieder von vorn anfaengt.
    if abstuerze:
        letzter = abstuerze[-1]["zeit"]
        danach = [p for p in punkte if p["t"] > letzter]
        steig = anstieg_je_stunde(danach)
        if steig is not None:
            jetzt = danach[-1]["m"]
            print(f"\n  Seit dem letzten Einbruch: {jetzt} %, Anstieg {steig:+.1f} Punkte/h")
            if steig > 1:
                rest = (95 - jetzt) / steig
                print(f"  Bei dieser Steigung sind 95 % in etwa {rest:.1f} h erreicht.")

    print("\n  Ein Saegezahn ist eine SUMMENKURVE — sie nennt keinen Schuldigen.")
    print("  Wer der Speicherfresser ist, sagt `dmesg | grep -i oom` (solange der")
    print("  Kill im Ringpuffer liegt) oder tools/box/renderer-speicher-verlauf.py")
    print("  waehrend es laeuft.")
    return 0


if __name__ == "__main__":
    sys.exit(hauptlauf())
