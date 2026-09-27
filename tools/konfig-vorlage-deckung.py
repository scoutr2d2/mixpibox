#!/usr/bin/env python3
"""KONFIG-VORLAGE-DECKUNG — jeder Schluessel der ausgelieferten Konfiguration
gegen die Handbuecher und das Wissenspaket.

WARUM ES DAS GIBT (25.08.2026): `tools/doku-luecken-probe.sh` haelt seit dem
23.08. die Konfigurationsfelder aus `src/backend-api/src/konfiguration.ts`
gegen Doku und Paket — und meldet dort gruen. `FELDER` ist aber die Liste
dessen, was die VERWALTUNG anbietet. Die Datei, die auf der Box liegt, ist
`config/templates/mupiboxconfig.json`, und die fuehrt 95 Schluessel. Gemessen
standen FUENFZEHN davon in keinem der vier Handbuecher und mit null Treffern
im Paket.

WARUM DAS DIE TEUERE SORTE IST: es sind genau die Schluessel, die KEINE
Oberflaeche hat. Wer `mupibox.startVolume` sucht, findet den Schieber in der
Verwaltung und braucht kein Handbuch. Wer den Taster auf eine andere Leitung
legen will, hat nur die Datei — und `shim.triggerPin`, `shim.cutPin`,
`shim.ledPin` und `fan.fan_gpio` stehen nirgends. Die PIN-NUMMERN stehen in
Abschnitt 4.1 sehr wohl da ("GPIO17", "GPIO13"), nur als feste Tatsache und
ohne den Schluessel, mit dem man sie aendert. Eine Doku, die eine Zahl nennt
und den Stellhebel verschweigt, liest sich wie geloetet.

WARUM NICHT `konfiguration.ts` ERWEITERN, sondern eine zweite Wache: die
beiden Listen sind absichtlich verschieden. `FELDER` waechst mit der
Verwaltung, die Vorlage mit der BOX — `wled.com_port` und
`mupihat.battery_types` gehoeren dort hin und in keine Verwaltungsmaske. Eine
Wache, die beides in einen Topf wirft, meldet auf Dauer rot fuer Felder, die
zu Recht keine Maske haben.

GESUCHT WIRD VOLLER SCHLUESSEL ODER LETZTES GLIED, und das ist keine
Bequemlichkeit: die Handbuecher schreiben mal `mupibox.startVolume`, mal nur
`startVolume`, das Paket meist den blossen Namen. Eine Wache auf den vollen
Pfad meldete 60 Luecken, von denen 55 keine waren — dieselbe Falle, in die
die FELDER-Pruefung schon getreten ist (siehe dort, "22 Luecken, davon 16
keine").

BLAETTER, NICHT KNOTEN: `mupihat.battery_types` ist eine Liste von Objekten
und zaehlt als EIN Schluessel. Die Spannungsschwellen darin (`v_75`,
`th_shutdown`) sind Daten, keine Stellschrauben — wer sie einzeln einfordert,
verlangt ein Handbuch ueber Akkukennlinien und wird zu Recht ignoriert.

GEGENPROBE: eine leere oder umbenannte Vorlage meldet WARNUNG, nicht gruen —
eine Wache, die das Verschwinden ihrer Quelle ueberlebt, ist keine
(llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/konfig-vorlage-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import json
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
VORLAGE = WURZEL / "config/templates/mupiboxconfig.json"
DOKU = [
    WURZEL / "dokumentation/mixpibox.md",
    WURZEL / "dokumentation/benutzerhandbuch.html",
    WURZEL / "plugins/README.md",
    WURZEL / "README.md",
    WURZEL / "llmwiki/pack.yaml",
]

luecken: list[str] = []


def blaetter(d: dict, vorne: str = "") -> list[str]:
    """Die Blattschluessel in Punktschreibweise.

    Ein `dict` wird aufgeklappt, alles andere (Zahl, Text, Liste) ist ein
    Blatt — auch eine Liste von Objekten wie `mupihat.battery_types`.
    """
    raus: list[str] = []
    for k, v in d.items():
        pfad = f"{vorne}{k}"
        if isinstance(v, dict):
            raus.extend(blaetter(v, pfad + "."))
        else:
            raus.append(pfad)
    return raus


def wer_liest(voll: str) -> str:
    """Die erste Stelle im Baum, die den Schluessel liest — als Fingerzeig.

    Rein informativ: die Wache urteilt nicht danach. Sie soll nur dem, der
    die Luecke schliesst, den Weg zur Wahrheit zeigen, statt ihn 470 Dateien
    durchsuchen zu lassen.

    ERST DER VOLLE SCHLUESSEL, DANN DAS LETZTE GLIED: `cachepath` gibt es
    zweimal (`spotify.` und `chromium.`), und die Suche auf das blosse Glied
    zeigte fuer beide auf dieselbe Zeile — ein Fingerzeig, der in die falsche
    Richtung deutet, ist schlechter als keiner.
    """
    letztes = voll.rsplit(".", 1)[-1]
    for muster in (voll, letztes):
        try:
            rez = subprocess.run(
                ["grep", "-rn", "-m1", "-F", "--exclude-dir=node_modules",
                 "--exclude-dir=dist", "--exclude-dir=.angular",
                 muster, "scripts", "src/backend-api/src"],
                cwd=WURZEL,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        for zeile in rez.stdout.splitlines():
            teile = zeile.split(":", 2)
            return teile[0] + ":" + teile[1]
    return "kein Leser im Baum gefunden"


print("── Schluessel der ausgelieferten Konfiguration ohne Doku ──")

if not VORLAGE.exists():
    print(f"  WARNUNG: {VORLAGE.relative_to(WURZEL)} nicht gefunden —")
    print("  ist die Vorlage umgezogen? Ohne sie prueft diese Wache nichts.")
    luecken.append("vorlage")
else:
    try:
        vorlage = json.loads(VORLAGE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as f:
        print(f"  WARNUNG: {VORLAGE.name} ist kein lesbares JSON: {f}")
        luecken.append("vorlage-kaputt")
        vorlage = {}

    schluessel = blaetter(vorlage) if isinstance(vorlage, dict) else []
    if not schluessel:
        print("  WARNUNG: kein einziger Schluessel in der Vorlage —")
        print("  eine leere Vorlage ist kein gruener Befund.")
        luecken.append("vorlage-leer")
    else:
        texte = []
        for d in DOKU:
            if not d.exists():
                print(f"  WARNUNG: {d.relative_to(WURZEL)} nicht gefunden —")
                luecken.append(f"doku-fehlt:{d.name}")
                continue
            texte.append(d.read_text(encoding="utf-8", errors="replace"))
        if not texte:
            print("  WARNUNG: keine einzige Doku-Datei lesbar — nichts geprueft.")
            luecken.append("keine-doku")
        else:
            for k in schluessel:
                letztes = k.rsplit(".", 1)[-1]
                if any(k in t or letztes in t for t in texte):
                    continue
                print(f"  FEHLT ueberall: {k}  (liest: {wer_liest(k)})")
                luecken.append(k)
        print(f"  {len(schluessel)} Schluessel geprueft.")

print()
if not luecken:
    print("KEINE LUECKE.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
