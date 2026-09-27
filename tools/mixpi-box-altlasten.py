#!/usr/bin/env python3
"""Raeumt die Altstaende im App- und im Player-Ordner der Box — von hier aus.

ANLASS (11.09.2026, Box .62): `tools/ausliefern.py` MELDET solche Altstaende
seit langem am Ende jedes Laufs und fragt „Sollen diese Altstaende weg?" — und
dann passiert nichts, weil es keinen Weg gab, der sie wegraeumt. Eine Frage
ohne Antwortmoeglichkeit erzieht dazu, sie zu ueberlesen; nach drei Laeufen
liest man den ganzen Absatz nicht mehr. Dieses Werkzeug ist die fehlende
Haelfte: ausliefern.py fragt, dieses hier antwortet.

WARUM NICHT IN ausliefern.py: ein Ausrollweg, der nebenbei loescht, ist eine
zweite Zusage in einem Werkzeug, das schon eine hat. Der Bericht dort sagt
ausdruecklich, das Wegraeumen sei „eine Entscheidung des Betreibers, nicht die
eines Ausrollwegs". Das bleibt richtig — die Entscheidung faellt jetzt nur
nicht mehr ins Leere.

LOESCHEN NACH POSITIVLISTE, nicht nach „alles ausser". Was dieses Werkzeug
nicht beim Namen kennt, bleibt liegen und wird gemeldet. Dieselbe Bauart wie
tools/box/mixpi-angular-nachlass.py, das denselben Dienst fuer www/ tut; die
beiden Positivlisten ueberschneiden sich nicht.

DIE `.zurueck`-DATEIEN BLEIBEN. Sie sind kein Nachlass, sondern der Rueckweg
des LETZTEN Tauschs: ausliefern.py legt je Ziel genau einen an und
ueberschreibt ihn beim naechsten Mal. Sie wachsen also nicht, und wer sie
wegraeumt, nimmt der naechsten Auslieferung ihr Netz.

DER SONDERFALL spotify-control.js
Neben server.js liegt eine zweite spotify-control.js, die NIEMAND ausfuehrt —
der Dienst startet die aus spotifycontroller-main/. Sie ist die Falle aus dem
Wissenspaket [[spotify-control-liegt-woanders]]: am 28.07.2026 blieben zwei
Korrekturen wirkungslos, weil sie dort gelandet waren.

Sie ist trotzdem kein reiner Muell, und deshalb faellt sie hier NICHT unter
dieselbe Regel wie die .vor-Dateien: beide Ausrollwege kopieren sie von genau
dort an den Betriebsort (autosetup.sh:455, update/start_mupibox_update.sh:741).
Beim Update wird sie allerdings zuvor mitsamt dem ganzen Baum geloescht und
frisch aus deploy.zip entpackt (Zeile 715/717) — sie wird also nie gebraucht,
sondern immer neu gelegt. Was liegenbleibt, ist eine ALTE Fassung, die aussieht
wie die laufende. Am 11.09.2026 gemessen: die daneben war vom 11.08., die
laufende vom 11.09. — einen Monat auseinander, bei gleichem Namen.

Geloescht wird sie deshalb nur, wenn die laufende Kopie nachweislich dasteht.
Dieses Werkzeug nimmt der Box nicht ihre einzige Fassung.

AUFRUF
    python3 tools/mixpi-box-altlasten.py                       # Probe, aendert nichts
    python3 tools/mixpi-box-altlasten.py --wirklich            # raeumt, mit Wartungsschirm
    python3 tools/mixpi-box-altlasten.py --box dietpi@…        # andere Box
    python3 tools/mixpi-box-altlasten.py --wirklich --ohne-wartung

Ohne --wirklich wird nur gezeigt, was fiele. Exit 0 = gelaufen (auch wenn
nichts zu tun war), Exit 1 = Box nicht erreichbar oder Ordner nicht plausibel.
"""
from __future__ import annotations

import argparse
import shlex
import subprocess
import sys

BOX_VORGABE = "dietpi@192.168.178.62"

# Abgeschrieben aus tools/ausliefern.py (APPDIR/PLAYERDIR) — dieselben Ordner,
# und wenn sie dort einmal wandern, muessen sie hier mitwandern. Die Wache
# tools/zwillingsdateien-abgleich.py sieht solche Paare.
APPDIR = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
PLAYERDIR = "/home/dietpi/.mupibox/spotifycontroller-main"

# Die Positivliste. Jedes Muster wird gegen `ls -d <ordner>/<muster>` gehalten;
# ein Muster ohne Treffer kostet nichts.
#
# WARUM `*.vor-*` UND NICHT `*.vor*`: der zweite Stern faenge auch
# `server.js.vorlage` oder `.vorgemerkt` — Namen, die es heute nicht gibt und
# morgen geben kann. Der Bindestrich ist der Zeitstempel-Trenner, den
# ausliefern.py setzt (`.vor-<grund>-<datum>`), und er macht das Muster
# zusagefaehig statt bloss wahrscheinlich.
RAEUMBAR = {
    APPDIR: [
        "server.js.vor-*",
        "spotify-control.js.vor-*",
        "plugin-laufwerk.js.vor-*",
        "herkunft.json.vor-*",
        "*.js.alt",
        "*.js.kaputt",
        "*.f1-fassung-*",
    ],
    PLAYERDIR: [
        "spotify-control.js.vor-*",
        "*.js.alt",
        "*.js.kaputt",
        "*.f1-fassung-*",
    ],
}

# Was gemeldet, aber NIE angefasst wird. Steht hier ausdruecklich, damit der
# Bericht sagen kann „gesehen und absichtlich liegengelassen" statt zu
# schweigen — Schweigen liest sich wie „ist nicht da".
GESCHONT = ["*.zurueck"]


class Box:
    def __init__(self, ziel: str):
        self.ziel = ziel

    def lauf(self, befehl: str, frist: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", self.ziel, befehl],
            capture_output=True, text=True, timeout=frist)


def zeilen(text: str | None) -> list[str]:
    return [z for z in (text or "").strip().splitlines() if z.strip()]


def suchen(box: Box, ordner: str, muster: list[str]) -> list[str]:
    """Alle Treffer der Positivliste in EINEM Ordner.

    EIN Aufruf fuer alle Muster: jede weitere SSH-Sitzung kostet rund eine
    Sekunde. `ls -d` je Muster in einer Schleife, Fehler nach /dev/null — ein
    Muster ohne Treffer soll nicht den ganzen Aufruf faerben.
    """
    teile = " ".join(f"{shlex.quote(ordner)}/{m}" for m in muster)
    erg = box.lauf(f"ls -d {teile} 2>/dev/null || true")
    return sorted(zeilen(erg.stdout))


def groesse(box: Box, pfade: list[str]) -> str:
    if not pfade:
        return "0"
    erg = box.lauf("du -sck " + " ".join(shlex.quote(p) for p in pfade) + " 2>/dev/null | tail -1")
    stueck = (erg.stdout or "").split()
    return stueck[0] if stueck else "?"


def falsche_kopie(box: Box) -> tuple[bool, str]:
    """Darf APPDIR/spotify-control.js fallen? Nur wenn die laufende dasteht.

    Rueckgabe (faellt, begruendung). Die Begruendung wird IMMER gedruckt, auch
    im Ja-Fall — wer hier spaeter etwas aendert, soll lesen koennen, warum es
    so herum entschieden wurde.
    """
    erg = box.lauf(
        f"test -f {shlex.quote(APPDIR)}/spotify-control.js && echo DANEBEN; "
        f"test -f {shlex.quote(PLAYERDIR)}/spotify-control.js && echo LAEUFT")
    gefunden = set(zeilen(erg.stdout))
    if "DANEBEN" not in gefunden:
        return False, "Die Kopie am falschen Ort gibt es nicht (mehr) — nichts zu tun."
    if "LAEUFT" not in gefunden:
        return False, (f"HALT: {PLAYERDIR}/spotify-control.js fehlt. Die Kopie neben "
                       f"server.js bleibt liegen — sie koennte die einzige sein. "
                       f"Erst den Abspieldienst nachsehen.")
    md = box.lauf(f"md5sum {shlex.quote(APPDIR)}/spotify-control.js "
                  f"{shlex.quote(PLAYERDIR)}/spotify-control.js")
    stueck = (md.stdout or "").split()
    gleich = len(stueck) >= 3 and stueck[0] == stueck[2]
    wie = "gleichen Inhalts wie die laufende" if gleich else "mit ANDEREM Inhalt als die laufende"
    return True, (f"Faellt: die Kopie neben server.js ({wie}). Ausgefuehrt wird sie nie; "
                  f"beide Ausrollwege legen sie beim naechsten Update frisch an.")


def wartung(box_ip: str, zustand: str) -> bool:
    """Wartungsschirm schalten. Rueckgabe: hat es geklappt?

    Der Betreiber verlangt ihn bei jedem schreibenden Eingriff (10.09.2026:
    „wenn du aufs geraet musst den wartungsscreen benutzen kinder laufen frei
    rum"). Ein halb geraeumter Ordner mitten im Hoerspiel ist nichts, was ein
    Kind einordnen kann.
    """
    verb = "an" if zustand == "an" else "aus"
    erg = subprocess.run(["bash", "tools/mixpi-wartung.sh", verb, box_ip],
                         capture_output=True, text=True, timeout=30)
    return erg.returncode == 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default=BOX_VORGABE, help=f"Vorgabe: {BOX_VORGABE}")
    p.add_argument("--wirklich", action="store_true",
                   help="loescht wirklich (ohne diesen Schalter nur zeigen)")
    p.add_argument("--ohne-wartung", action="store_true",
                   help="den Wartungsschirm NICHT schalten (z.B. wenn er schon an ist)")
    a = p.parse_args()

    box = Box(a.box)
    box_ip = a.box.split("@")[-1]

    probe = box.lauf(f"test -d {shlex.quote(APPDIR)} && test -d {shlex.quote(PLAYERDIR)} && echo DA")
    if "DA" not in zeilen(probe.stdout):
        print(f"Box {a.box} antwortet nicht, oder die Ordner fehlen.", file=sys.stderr)
        print(f"  erwartet: {APPDIR}\n            {PLAYERDIR}", file=sys.stderr)
        return 1

    print(f"── Altstaende auf {a.box} ──\n")

    faellt: list[str] = []
    for ordner, muster in RAEUMBAR.items():
        treffer = suchen(box, ordner, muster)
        geschont = suchen(box, ordner, GESCHONT)
        print(f"{ordner}")
        if treffer:
            for t in treffer:
                print(f"   faellt   {t}")
            faellt.extend(treffer)
        else:
            print("   (nichts aus der Positivliste)")
        for g in geschont:
            print(f"   bleibt   {g}   ← Rueckweg des letzten Tauschs")
        print()

    faellt_kopie, warum = falsche_kopie(box)
    print(f"spotify-control.js am falschen Ort:\n   {warum}\n")
    if faellt_kopie:
        faellt.append(f"{APPDIR}/spotify-control.js")

    if not faellt:
        print("Nichts zu raeumen. Die Ordner sind sauber.")
        return 0

    kb = groesse(box, faellt)
    print(f"Summe: {len(faellt)} Eintraege, {kb} KB.")

    if not a.wirklich:
        print("\nDas war die PROBE — es wurde nichts geloescht.")
        print("Wenn die Liste stimmt: noch einmal mit --wirklich.")
        return 0

    schirm = False
    if not a.ohne_wartung:
        schirm = wartung(box_ip, "an")
        if not schirm:
            print("Der Wartungsschirm liess sich nicht einschalten — ABBRUCH.", file=sys.stderr)
            print("Mit --ohne-wartung laesst sich das uebergehen, wenn niemand hoert.",
                  file=sys.stderr)
            return 1
        print("\nWartungsschirm an.")

    try:
        # EIN Aufruf, nicht je Datei einer: ein halb geraeumter Ordner nach
        # einem Verbindungsabriss ist schlechter als ein ganzer oder gar keiner.
        befehl = "rm -rf " + " ".join(shlex.quote(f) for f in faellt)
        erg = box.lauf(befehl, frist=60)
        if erg.returncode != 0:
            print(f"Loeschen scheiterte: {erg.stderr.strip()}", file=sys.stderr)
            return 1
        print(f"{len(faellt)} Eintraege geloescht ({kb} KB frei).")

        # NACHMESSEN, nicht glauben. `rm` meldet Erfolg auch fuer Pfade, die es
        # gar nicht gab — der Beweis ist die Abwesenheit danach.
        rest = []
        for ordner, muster in RAEUMBAR.items():
            rest.extend(suchen(box, ordner, muster))
        if faellt_kopie:
            nach = box.lauf(f"test -f {shlex.quote(APPDIR)}/spotify-control.js && echo NOCHDA")
            if "NOCHDA" in zeilen(nach.stdout):
                rest.append(f"{APPDIR}/spotify-control.js")
        if rest:
            print("ABER: das hier liegt noch:", file=sys.stderr)
            for r in rest:
                print(f"   {r}", file=sys.stderr)
            return 1
        print("Nachgemessen: nichts davon liegt mehr da.")

        # Laeuft die Box noch? Der Player startet aus PLAYERDIR, und dort haben
        # wir angefasst. Eine Raeumaktion, nach der die Musik weg ist, waere
        # der schlechtere Tausch.
        dienste = box.lauf("systemctl is-active mupibox-server mupibox-player")
        stand = zeilen(dienste.stdout)
        print(f"Dienste danach: mupibox-server={stand[0] if stand else '?'}, "
              f"mupibox-player={stand[1] if len(stand) > 1 else '?'}")
        if not all(s == "active" for s in stand[:2]):
            print("EIN DIENST STEHT NICHT MEHR — nachsehen!", file=sys.stderr)
            return 1
    finally:
        if schirm:
            if wartung(box_ip, "aus"):
                print("Wartungsschirm aus.")
            else:
                print(f"WARNUNG: Wartungsschirm liess sich NICHT ausschalten. "
                      f"Von Hand: bash tools/mixpi-wartung.sh aus {box_ip}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
