#!/usr/bin/env python3
"""
SICHERT DIE SICHERUNG NOCH, WAS EINEM PROFIL GEHOERT — UND WENN NICHT,
HOERT ES JEMAND?

WOFUER DIESES WERKZEUG:
Seit E18 Stufe 2 liegt alles, was einem Profil gehoert, in dessen BEREICH —
`server/config/profile/<kennung>/gespielt.json` statt
`server/config/gespielt.gast.json`. Die Sicherung
(`scripts/mupibox/mupibox-sicherung.py`) sammelt aber FLACH ein: sie geht
`os.listdir` ueber `server/config` und haelt jeden Namen gegen eine Liste von
fnmatch-Mustern. Ein UNTERORDNER trifft keines dieser Muster.

Die Folge ist NICHT still — die Sicherung meldet „nicht eingeordnet, NICHT
gesichert: server/config/profile" —, aber sie ist leicht zu ueberlesen, und was
dann fehlt, ist genau das, was ein Kind nicht wiederbekommt: sein Verlauf, sein
Zeitkonto, seine Listen. Eine Sicherung, die gruen meldet und den Verlauf eines
Jahres auslaesst, ist schlimmer als keine (Wiki `sicherung-leere-datei-besteht-
jede-pruefung`).

DIESES WERKZEUG MISST DIE LUECKE, statt sie sich zu merken. Es liest BEIDE
Seiten am Quelltext:
  * die EINE Liste der Bereichs-Ablagen aus `src/backend-api/src/profile.ts`
    (`BEREICH_ABLAGEN`) — kommt dort eine dazu, faellt sie hier auf;
  * die Muster und die Sammelart aus `scripts/mupibox/mupibox-sicherung.py`.

ES SCHREIBT NICHTS UND FASST NICHTS AN. Beide Dateien werden nur gelesen.

DER ZWEITE TEIL, seit dem 07.08.2026 — UND WARUM ER HIERHER GEHOERT:
Das Netz oben deckt nur die BEREICHE je Kind ab. `server/config/profile.json`
selbst — die Datei, die sagt, DASS es die Kinder gibt — lag ausserhalb und ist
genau deshalb aus jeder Sicherung gefallen. Die Warnung dazu STAND DA
(„! nicht eingeordnet, NICHT gesichert: server/config/profile.json"), aber nur
auf stdout eines Werkzeugs, das seit `/api/sicherung` niemand mehr von Hand
aufruft: die Antwort dieses Weges SIND die Archivbytes, stdout wird verworfen.

Eine dritte Deckungsliste haette das nicht gefangen — sie haette dieselbe
Sorte Luecke eine Stelle weiter gehabt. Was es faengt, ist der KANAL: dass die
dritte Spalte (`unbekannt`) vom Python bis auf den Bildschirm durchgereicht
wird. Ist der Kanal ganz, faellt die naechste neue Ablage AUF, egal ob
irgendeine Liste sie kennt. Deshalb steht die Messung hier und nicht daneben:
es ist dieselbe Frage („faellt eine neue Ablage auf?"), nur eine Etage tiefer.

Gemessen werden vier Glieder, jedes an seiner Quelle:
  1. mupibox-sicherung.py schreibt `unbekannt` in den Stand und ruft es aus;
  2. src/backend-api/src/sicherung.ts LIEST das Feld (`standKopfLesen`);
  3. dieselbe Datei traegt es aus /api/sicherung hinaus und meldet die Zahl
     im Kopf des Downloads (dort, wo sonst nur die Bytes sind);
  4. src/frontend-admin/src/app/seiten/sicherung.ts ZEIGT es.
Bricht ein Glied, ist die Warnung wieder taub — und dieser Lauf rot.

DASS ES WIRKLICH AUFFAELLT, misst `tools/sicherung-warnung-kommt-an.ts` gegen
einen eigenen Server im Sandkasten: es legt eine Ablage an, die in keinem
Muster steht, und weist sie am Bildschirm nach. Hier steht, was OHNE Lauf
entscheidbar ist — damit es in pruefen.sh haengen kann, ohne python3, gpg und
einen freien Port zu brauchen.

AUFRUF
    python3 tools/bereich-sicherung-deckung.py
    python3 tools/bereich-sicherung-deckung.py --json
    python3 tools/bereich-sicherung-deckung.py --sicherung /tmp/kopie.py

ENDE 0, wenn jede Bereichs-Ablage eingesammelt wird UND die Warnung ueber die
nicht eingeordneten Ablagen bei einem Menschen ankommt.
ENDE 1, solange eines von beidem fehlt — mit dem Wortlaut, was fehlt.
"""

import argparse
import ast
import fnmatch
import json
import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE_TS = os.path.join(WURZEL, "src/backend-api/src/profile.ts")
SICHERUNG = os.path.join(WURZEL, "scripts/mupibox/mupibox-sicherung.py")
SICHERUNG_TS = os.path.join(WURZEL, "src/backend-api/src/sicherung.ts")
SEITE_TS = os.path.join(WURZEL, "src/frontend-admin/src/app/seiten/sicherung.ts")
BAUM = "server/config"

# ── Die KETTE: von der dritten Spalte des Pythons bis auf den Bildschirm ───
#
# Jedes Glied ist ein Muster IN SEINER EIGENEN QUELLE. Abgeschrieben wird
# nichts — sonst gaebe dieses Werkzeug gruenes Licht fuer eine Kette, die es
# sich selbst ausgedacht hat (derselbe Grund wie oben bei `bereichs_ablagen`).
#
# WARUM MUSTER UND NICHT EIN LAUF: dieser Schritt haengt in tools/pruefen.sh
# und muss ueberall laufen — ohne python3-Kindprozess, ohne gpg, ohne freien
# Port. Was nur ein Lauf zeigen kann („faellt es wirklich auf?"), misst
# tools/sicherung-warnung-kommt-an.ts.
KETTE = [
    (SICHERUNG, "das Werkzeug fuehrt die dritte Spalte im Stand",
     r'"unbekannt":\s*auf\["unbekannt"\]',
     "mupibox-sicherung.py schreibt `unbekannt` nicht mehr in stand.json — "
     "damit gibt es nichts mehr weiterzureichen."),
    (SICHERUNG, "… und ruft sie auch aus",
     r'nicht eingeordnet, NICHT gesichert',
     "die Zeile auf stdout ist weg. Sie ist der Rueckweg fuer den, der das "
     "Werkzeug doch von Hand faehrt."),
    (SICHERUNG_TS, "der Server LIEST das Feld",
     r"nichtEingeordnet\s*=\s*Array\.isArray\(d\['unbekannt'\]\)",
     "standKopfLesen liest `unbekannt` nicht mehr. GENAU HIER ist "
     "server/config/profile.json still aus jeder Sicherung gefallen."),
    (SICHERUNG_TS, "die Seite bekommt es beim Aufschlagen",
     r"nichtEingeordnet:\s*letzteNichtEingeordnet\(umg\.staende\)",
     "/api/sicherung traegt es nicht mehr hinaus — dann sieht es nur noch, "
     "wer die Archivbytes von Hand aufmacht."),
    (SICHERUNG_TS, "der Download meldet die Zahl im Kopf",
     r"'X-Mupi-Nicht-Eingeordnet'",
     "die Antwort auf /api/sicherung/anlegen SIND die Archivbytes; ohne "
     "diese Kopfzeile hat der Erfolgssatz keine Chance, sich einzuschraenken."),
    (SICHERUNG_TS, "die Vorschau vorm Zurueckspielen sagt es mit",
     r"nichtEingeordnetDeuten\(kopf\.nichtEingeordnet,\s*'stand'\)",
     "wer einen fremden Stand einspielt, erfaehrt nicht mehr, was nie darin "
     "war."),
    (SEITE_TS, "und die Verwaltungsseite ZEIGT es",
     r"@if \(l\.nichtEingeordnet; as n\)",
     "das Backend sagt es, die Seite wirft es weg — derselbe Fehler eine "
     "Etage hoeher."),
    (SEITE_TS, "… mit Pfad und mit dem, was daraus folgt",
     r"@for \(p of n\.pfade; track p\)[\s\S]{0,400}@for \(r of n\.rat; track r\)",
     "ohne Pfad weiss niemand, WAS fehlt; ohne die Folgen weiss niemand, "
     "warum ihn das angeht."),
]


def bereichs_ablagen() -> tuple[str, list[str]]:
    """
    Die EINE Liste aus profile.ts — Ordnername und Dateinamen.

    AM QUELLTEXT GELESEN, NICHT ABGESCHRIEBEN. Eine eigene Kopie waere die
    zweite Wahrheit, und dieses Werkzeug gaebe dann gruenes Licht fuer eine
    Liste, die es sich selbst ausgedacht hat.
    """
    quelle = open(PROFILE_TS, encoding="utf-8").read()
    ordner = re.search(r"export const BEREICH_ORDNER = '([^']+)'", quelle)
    liste = re.search(r"export const BEREICH_ABLAGEN = \[([^\]]*)\]", quelle)
    if not ordner or not liste:
        raise SystemExit(
            "profile.ts: BEREICH_ORDNER oder BEREICH_ABLAGEN nicht gefunden — "
            "hat der Bereich einen anderen Namen bekommen?")
    namen = []
    for teil in liste.group(1).split(","):
        teil = teil.strip()
        if not teil:
            continue
        # Die Liste fuehrt Konstanten (ABLAGE_GESPIELT), nicht die Namen selbst.
        wert = re.search(rf"export const {re.escape(teil)} = '([^']+)'", quelle)
        if not wert:
            raise SystemExit(f"profile.ts: zu {teil} steht kein Dateiname da")
        namen.append(wert.group(1))
    if not namen:
        raise SystemExit("profile.ts: BEREICH_ABLAGEN ist leer")
    return ordner.group(1), namen


def sicherungs_muster(pfad: str = SICHERUNG) -> tuple[list[str], bool]:
    """
    Die Muster fuer server/config und die Frage: sammelt sie FLACH ein?

    Ueber `ast` statt ueber `import`: die Sicherung ist ein Programm mit
    Nebenwirkungen (Sperrdatei, Karte), und ein Werkzeug, das zum Messen ein
    fremdes Programm ausfuehrt, ist kein Messgeraet.
    """
    quelle = open(pfad, encoding="utf-8").read()
    baum = ast.parse(quelle)
    muster: list[str] = []
    for knoten in baum.body:
        if not isinstance(knoten, ast.Assign):
            continue
        namen = [z.id for z in knoten.targets if isinstance(z, ast.Name)]
        if "HINEIN" not in namen:
            continue
        hinein = ast.literal_eval(knoten.value)
        muster = list(hinein.get(BAUM, []))
    if not muster:
        raise SystemExit(f"{pfad}: HINEIN['{BAUM}'] nicht gefunden")
    # WIE eingesammelt wird, entscheidet alles: `os.listdir` sieht nur die
    # oberste Ebene, `os.walk`/`rglob` gingen in den Bereich hinein.
    flach = "os.listdir(wurzel)" in quelle and "os.walk" not in quelle
    return muster, flach


def kette_messen(sicherung: str = SICHERUNG) -> list[dict]:
    """
    Geht die Warnung ueber die nicht eingeordneten Ablagen bis zum Bildschirm?

    LIEST NUR. Fehlt eine der Dateien (etwa in einem verkuerzten Arbeitsbaum),
    ist das ein BEFUND und kein Absturz — ein Werkzeug, das bei fehlender
    Quelle mit einem Stapelabzug endet, wird abgeschaltet statt gelesen.
    """
    zwischenspeicher: dict[str, str] = {}
    befunde = []
    for datei, satz, muster, folge in KETTE:
        # Die Gegenprobe (--sicherung) soll auch fuer die Kette gelten.
        pfad = sicherung if datei == SICHERUNG else datei
        if pfad not in zwischenspeicher:
            try:
                zwischenspeicher[pfad] = open(pfad, encoding="utf-8").read()
            except OSError as e:
                zwischenspeicher[pfad] = ""
                befunde.append({"satz": satz, "datei": pfad, "haelt": False,
                                "folge": f"nicht lesbar ({e})"})
                continue
        haelt = re.search(muster, zwischenspeicher[pfad]) is not None
        befunde.append({"satz": satz, "datei": os.path.relpath(pfad, WURZEL),
                        "haelt": haelt, "folge": folge})
    return befunde


def messen(pfad: str = SICHERUNG) -> dict:
    ordner, ablagen = bereichs_ablagen()
    muster, flach = sicherungs_muster(pfad)
    befunde = []
    for datei in ablagen:
        # So heisst die Ablage nach dem Umzug, aus Sicht des Archivs.
        im_archiv = f"{ordner}/<kennung>/{datei}"
        # Zwei Fragen, und BEIDE muessen ja sein:
        #   1. Reicht die Sammelart ueberhaupt in den Unterordner?
        #   2. Trifft irgendein Muster den Pfad?
        trifft = any(fnmatch.fnmatch(f"{ordner}/x/{datei}", m) for m in muster)
        gedeckt = (not flach) and trifft
        befunde.append({
            "datei": datei,
            "im_archiv": im_archiv,
            "gedeckt": gedeckt,
            "warum": ("gedeckt" if gedeckt else
                      "die Sicherung sammelt FLACH ein (os.listdir) — ein "
                      "Unterordner wird nie betreten" if flach else
                      "kein Muster in HINEIN trifft diesen Pfad"),
        })
    # DIE GEGENRICHTUNG: ein Muster, das die ALTE Form je Profil nennt, zeigt
    # nach dem Umzug auf nichts mehr. Es schadet nicht, aber es behauptet eine
    # Deckung, die es nicht mehr gibt — und genau daran hat hier schon einmal
    # jemand geglaubt.
    veraltet = [m for m in muster
                if ".*." in m and any(m.startswith(d.split(".")[0]) for d in ablagen)]
    return {"ordner": ordner, "ablagen": ablagen, "muster": muster,
            "flach": flach, "befunde": befunde, "veraltet": veraltet,
            "kette": kette_messen(pfad)}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON")
    # NUR FUER DIE GEGENPROBE: ein Werkzeug, das nie GRUEN werden kann, ist
    # keine Messung, sondern eine Behauptung. Damit laesst sich an einer KOPIE
    # zeigen, dass es umschlaegt, sobald die Muster nachgezogen sind — ohne die
    # echte Sicherung anzufassen (fremdes Gebiet).
    p.add_argument("--sicherung", default=SICHERUNG, metavar="DATEI",
                   help="andere mupibox-sicherung.py lesen (Gegenprobe)")
    a = p.parse_args()
    e = messen(a.sicherung)
    gerissen = [b for b in e["kette"] if not b["haelt"]]
    if a.json:
        print(json.dumps(e, indent=2, ensure_ascii=False))
        return 0 if all(b["gedeckt"] for b in e["befunde"]) and not gerissen else 1

    print()
    print("Sichert die Sicherung noch, was einem Profil gehoert?")
    print("──────────────────────────────────────────────────────")
    print(f"  Bereich:     {BAUM}/{e['ordner']}/<kennung>/")
    print(f"  Sammelart:   {'FLACH (os.listdir)' if e['flach'] else 'rekursiv'}")
    print()
    fehlt = [b for b in e["befunde"] if not b["gedeckt"]]
    for b in e["befunde"]:
        zeichen = "ok    " if b["gedeckt"] else "FEHLT "
        print(f"  {zeichen} {b['im_archiv']}")
        if not b["gedeckt"]:
            print(f"         {b['warum']}")
    if e["veraltet"]:
        print()
        print("  MUSTER, DIE NACH DEM UMZUG AUF NICHTS MEHR ZEIGEN:")
        for m in e["veraltet"]:
            print(f"    {m}")
    # ── Und wenn doch etwas herausfaellt: hoert es jemand? ────────────────
    print()
    print("Und wenn eine Ablage in KEINER Liste steht — hoert es jemand?")
    print("──────────────────────────────────────────────────────────────")
    print("  (server/config/profile.json ist genau hier durchgefallen: die")
    print("   Warnung stand da, nur ohne Empfaenger.)")
    print()
    for b in e["kette"]:
        print(f"  {'ok    ' if b['haelt'] else 'GERISSEN'} {b['satz']}")
        if not b["haelt"]:
            print(f"         in {b['datei']}: {b['folge']}")
    print()
    if gerissen:
        print(f"  DIE KETTE IST AN {len(gerissen)} STELLE(N) GERISSEN.")
        print("  Die Sicherung meldet dann weiterhin, was sie nicht einordnen")
        print("  kann — und niemand bekommt es zu sehen. Genau so ist")
        print("  server/config/profile.json aus jeder Sicherung gefallen.")
        print("  Gegenprobe mit einem echten Lauf:")
        print("    npx tsx tools/sicherung-warnung-kommt-an.ts")
        print()
        return 1
    print("  Die Warnung kommt bis auf den Bildschirm.")

    print()
    if not fehlt:
        print("  Beides haelt.")
        return 0
    print("  OFFEN — und es ist FREMDES GEBIET (dort laeuft E29).")
    print("  Zu tun in scripts/mupibox/mupibox-sicherung.py, zwei Dinge:")
    print("    1. bestandsaufnahme() muss in den Bereich hineinsehen (os.walk")
    print(f"       statt os.listdir, oder ein Sonderweg fuer '{e['ordner']}/').")
    print("    2. In HINEIN['server/config'] die Muster nachziehen:")
    for b in fehlt:
        print(f"         \"{e['ordner']}/*/{b['datei']}\",")
    print("  Bis dahin meldet die Sicherung bei jedem Lauf")
    print(f"    ! nicht eingeordnet, NICHT gesichert: {BAUM}/{e['ordner']}")
    print("  — das ist die Meldung, die man NICHT ueberlesen darf.")
    print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
