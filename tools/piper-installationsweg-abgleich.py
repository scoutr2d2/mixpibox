#!/usr/bin/env python3
"""Kommt Piper ueberhaupt auf eine frische Box — und an dieselbe Stelle?

WOZU: Bis zum 04.08.2026 lautete die Antwort schlicht NEIN. Der Server erwartet
Piper unter `/home/dietpi/.mupibox/piper-venv`, die Stimmen daneben — dorthin
gebracht hat ihn aber niemand. Er wurde auf der Entwicklungsbox VON HAND
eingerichtet ([[vorlesen-tts]], Abschnitt EINRICHTUNG); weder `autosetup.sh`
noch `update/start_mupibox_update.sh` noch der remote-step-installer kannten ihn
(nachgesehen: 0 Treffer fuer "piper" in allen drei Ausrollwegen). Solange
Vorlesen ein Zusatz war, fiel das nicht auf. Seit Google TTS abgeloest ist
([[google-tts-abgeloest]]), ist Sprechen ein beworbenes Merkmal — und eine
frische SD-Karte spraeche gar nicht.

DIE FEHLERKLASSE, DIE DIESES WERKZEUG BEWACHT, ist aber nicht "es fehlt ganz",
sondern die leisere danach: die Pfade stehen an VIER Stellen (server.ts,
vorlesen.ts, das Einrichtungsskript, die zwei Ausrollwege). Wer einen davon
verschiebt, bekommt keine Fehlermeldung — er bekommt eine Box, die `bereit:
false` meldet, und niemand weiss warum. `bereit` haengt an der schieren
Existenz EINER Datei (server.ts: `fs.existsSync(piperBin)`); ein Tippfehler im
Pfad sieht davon genauso aus wie eine fehlende Installation.

WAS ES PRUEFT
  1. Der venv-Pfad, den server.ts erwartet, ist der, den das Skript anlegt.
  2. Dasselbe fuer das Stimmenverzeichnis.
  3. Die Vorgabestimme aus vorlesen.ts (STIMME_VORGABE) ist die, die das Skript
     herunterlaedt. Laufen sie auseinander, zeigt die Verwaltung eine Stimme
     an, die auf der Karte fehlt.
  4. BEIDE Ausrollwege rufen das Skript wirklich auf — autosetup.sh fuer die
     frische SD, start_mupibox_update.sh fuer die laufende Box. Nur einer von
     beiden hiesse: es haengt davon ab, wie die Box entstanden ist.
  5. Das Skript liegt in scripts/mupibox/ (nur von dort wird es nach
     /usr/local/bin/mupibox kopiert) und ist ausfuehrbar.
  6. AB WERK AN NUR AUF DEN ERSTWEGEN (BACKLOG E12/X12, 28.09.2026): die zwei
     Wege, die eine Box NEU aufsetzen (autosetup.sh, Rezeptschritt `piper` in
     mupibox-app.yaml), uebergeben `--ab-werk-an` bei JEDEM Aufruf — und der
     Update-Weg bei KEINEM. Der zweite Teil ist der wichtigere: dort hiesse
     der Schalter, dass jede laufende Box ohne vorlesen.json nach dem Update
     ploetzlich bei jedem Tipp spricht (llmwiki
     `ein-neuer-schalter-darf-nichts-wegnehmen`). Gezaehlt werden nur echte
     Aufrufe: Kommentarzeilen, `--pruefen` und `--stimme` nicht, im Rezept nur
     das `run:` des Schritts — ein zitierender Kommentar ist keine Gegenstelle.
     Dass das Skript den Schalter richtig befolgt, prueft
     tools/piper-ab-werk.test.sh am echten Skript.

WAS ES NICHT KANN: sagen, ob `pip install piper-tts` auf DER Box durchlaeuft.
Das haengt an Rad und Architektur (fuer armhf gibt es kein onnxruntime-Rad) und
ist ohne Geraet nicht zu beantworten. Die Gegenprobe am Geraet lautet:

    ssh <box> "sudo /usr/local/bin/mupibox/piper-einrichten.sh --pruefen"
    curl -s http://<box>:8200/api/vorlesen | jq '{bereit, stimmen: (.stimmen|length)}'

AUFRUF
    python3 tools/piper-installationsweg-abgleich.py
    python3 tools/piper-installationsweg-abgleich.py --pruefen   # still, RC=1 bei Befund
    python3 tools/piper-installationsweg-abgleich.py --selbsttest  # Punkt 6 ohne Dateien
"""

import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(WURZEL, "src/backend-api/src/server.ts")
VORLESEN = os.path.join(WURZEL, "src/backend-api/src/vorlesen.ts")
SKRIPT = os.path.join(WURZEL, "scripts/mupibox/piper-einrichten.sh")
AUSROLLWEGE = [
    os.path.join(WURZEL, "autosetup/autosetup.sh"),
    os.path.join(WURZEL, "update/start_mupibox_update.sh"),
]
# Punkt 6: wer eine Box NEU aufsetzt, schaltet Vorlesen ein; das Update nicht.
AUTOSETUP = AUSROLLWEGE[0]
UPDATE = AUSROLLWEGE[1]
REZEPT = os.path.join(WURZEL, "remote-step-installer/recipes/mupibox-app.yaml")
AB_WERK = "--ab-werk-an"


def lies(pfad: str) -> str:
    try:
        return open(pfad, encoding="utf-8").read()
    except OSError:
        return ""


def ts_vorgabe(text: str, variable: str) -> str:
    """`const x = process.env.FOO || '/pfad'` -> '/pfad'."""
    t = re.search(
        rf"const\s+{re.escape(variable)}\s*=\s*process\.env\.[A-Z_]+\s*\|\|\s*'([^']+)'",
        text,
    )
    return t.group(1) if t else ""


def sh_vorgabe(text: str, variable: str) -> str:
    """`VENV="${FOO:-/pfad}"` -> '/pfad'."""
    t = re.search(rf'^{re.escape(variable)}="\$\{{[A-Z_]+:-([^}}]+)\}}"', text, re.M)
    return t.group(1) if t else ""


def ist_einrichtungsaufruf(zeile: str) -> bool:
    """Ruft diese Zeile das Skript zum EINRICHTEN? Kommentar, Pruefen und
    Stimme-Nachladen zaehlen nicht."""
    z = zeile.strip()
    return ("piper-einrichten.sh" in z and not z.startswith("#")
            and "--pruefen" not in z and "--stimme" not in z)


def aufrufe_sh(text: str) -> list:
    return [z.strip() for z in text.splitlines() if ist_einrichtungsaufruf(z)]


def aufrufe_rezept(pfad: str) -> list:
    """Nur das `run:` des Schritts `piper` — die `note:` zitiert den Aufruf."""
    try:
        import yaml
        doc = yaml.safe_load(lies(pfad)) or {}
    except Exception:  # noqa: BLE001 — kaputtes Rezept ist ein Befund, kein Absturz
        return []
    for schritt in doc.get("steps") or []:
        if isinstance(schritt, dict) and schritt.get("id") == "piper":
            return aufrufe_sh(str(schritt.get("run") or ""))
    return []


def ab_werk_befunde(autosetup: str, rezept: list, update: str) -> list:
    """Punkt 6 als reine Funktion, damit der Selbsttest sie ohne Dateien faehrt."""
    befunde = []
    for name, aufrufe in (("autosetup/autosetup.sh", aufrufe_sh(autosetup)),
                          ("mupibox-app.yaml (Schritt piper)", rezept)):
        if not aufrufe:
            befunde.append(f"{name}: kein Einrichtungsaufruf gefunden — Muster veraltet?")
        for a in aufrufe:
            if AB_WERK not in a:
                befunde.append(
                    f"{name} ruft piper-einrichten.sh OHNE {AB_WERK} — eine frisch "
                    f"aufgesetzte Box liest dann nicht vor:\n      {a}")
    for a in aufrufe_sh(update):
        if AB_WERK in a:
            befunde.append(
                f"update/start_mupibox_update.sh uebergibt {AB_WERK} — jede laufende "
                f"Box ohne vorlesen.json spraeche nach dem Update bei jedem Tipp:\n      {a}")
    if not aufrufe_sh(update):
        befunde.append("update/start_mupibox_update.sh: kein Einrichtungsaufruf gefunden.")
    return befunde


def selbsttest() -> int:
    ok = "  timeout 1200 /usr/local/bin/mupibox/piper-einrichten.sh --ab-werk-an >&3"
    ohne = "  timeout 1200 /usr/local/bin/mupibox/piper-einrichten.sh >&3"
    faelle = [
        ("so gehoert es", ab_werk_befunde(ok, [ok.strip()], ohne) == []),
        ("autosetup ohne Schalter faellt auf", len(ab_werk_befunde(ohne, [ok.strip()], ohne)) == 1),
        ("Rezept ohne Schalter faellt auf", len(ab_werk_befunde(ok, [ohne.strip()], ohne)) == 1),
        ("Update MIT Schalter faellt auf", len(ab_werk_befunde(ok, [ok.strip()], ok)) == 1),
        ("zitierender Kommentar ist kein Aufruf",
         aufrufe_sh("# piper-einrichten.sh --ab-werk-an\n" + ohne) == [ohne.strip()]),
        ("--pruefen ist kein Einrichtungsaufruf",
         aufrufe_sh("piper-einrichten.sh --pruefen >/dev/null") == []),
        ("fehlendes Rezept faellt auf", len(ab_werk_befunde(ok, [], ohne)) == 1),
    ]
    schlecht = [n for n, g in faelle if not g]
    for n, g in faelle:
        print(f"  {'ok  ' if g else 'NEIN'}  {n}")
    return 1 if schlecht else 0


def main() -> int:
    if "--selbsttest" in sys.argv:
        return selbsttest()
    still = "--pruefen" in sys.argv
    befunde = []

    server = lies(SERVER)
    vorlesen = lies(VORLESEN)
    skript = lies(SKRIPT)

    erwartet = {
        "venv": ts_vorgabe(server, "piperVenv"),
        "stimmen": ts_vorgabe(server, "stimmenDir"),
    }
    t = re.search(r"export const STIMME_VORGABE\s*=\s*'([^']+)'", vorlesen)
    erwartet["stimme"] = t.group(1) if t else ""

    legt_an = {
        "venv": sh_vorgabe(skript, "VENV"),
        "stimmen": sh_vorgabe(skript, "STIMMEN"),
        "stimme": sh_vorgabe(skript, "STIMME"),
    }

    if not skript:
        befunde.append(
            "scripts/mupibox/piper-einrichten.sh fehlt — keine Box bekommt Piper."
        )
    elif not os.access(SKRIPT, os.X_OK):
        befunde.append(
            "piper-einrichten.sh ist nicht ausfuehrbar (chmod 755). autosetup.sh "
            "ruft es direkt auf, nicht ueber `bash`."
        )

    beschriftung = {
        "venv": "venv-Pfad",
        "stimmen": "Stimmenverzeichnis",
        "stimme": "Vorgabestimme",
    }
    for schluessel, name in beschriftung.items():
        a, b = erwartet[schluessel], legt_an[schluessel]
        if not a:
            befunde.append(f"{name}: im Quelltext nicht gefunden — Muster veraltet?")
        elif not b:
            befunde.append(f"{name}: im Einrichtungsskript nicht gefunden.")
        elif a != b:
            befunde.append(
                f"{name} laeuft auseinander:\n"
                f"      Server erwartet     : {a}\n"
                f"      Skript legt an      : {b}"
            )

    for weg in AUSROLLWEGE:
        if "piper-einrichten.sh" not in lies(weg):
            befunde.append(
                f"{os.path.relpath(weg, WURZEL)} ruft piper-einrichten.sh NICHT auf — "
                "dieser Weg liefert eine stumme Box."
            )

    befunde += ab_werk_befunde(lies(AUTOSETUP), aufrufe_rezept(REZEPT), lies(UPDATE))

    if still:
        for b in befunde:
            print(f"  {b}")
        return 1 if befunde else 0

    print("Was der Server erwartet:")
    for schluessel, name in beschriftung.items():
        print(f"  {name:20s} {erwartet[schluessel] or '(nicht gefunden)'}")
    print()
    print("Was der Installationsweg anlegt:")
    for schluessel, name in beschriftung.items():
        print(f"  {name:20s} {legt_an[schluessel] or '(nicht gefunden)'}")
    print()
    for weg in AUSROLLWEGE:
        ruft = "piper-einrichten.sh" in lies(weg)
        print(f"  {os.path.relpath(weg, WURZEL):34s} {'ruft auf' if ruft else 'RUFT NICHT AUF'}")
    print()
    if befunde:
        print("BEFUNDE:")
        for b in befunde:
            print(f"  * {b}")
    else:
        print("Alles deckungsgleich. Eine frische Box kann sprechen —")
        print("sofern pip und HuggingFace erreichbar waren; das sagt nur das Geraet.")
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
