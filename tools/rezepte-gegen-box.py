#!/usr/bin/env python3
"""WAS DIE BOX HAT UND KEIN REZEPT HERSTELLT — die Installer-Rezepte gegen ein
laufendes Geraet halten, rein lesend.

WOZU ES DAS GIBT (31.08.2026)
ANGLEICH-PI4-PI5.md, 30.07.2026: „Der Pi 5 ist von Hand grossgezogen, der Pi 4
ist der reine Rezept-Stand. Alles, was den Pi 5 gut macht, ist an den Rezepten
vorbei entstanden." Fuenf harte Ausfaelle standen dort — librespot, mpv,
PipeWire, Kiosk-Benutzer, zram. Alle fuenf haben inzwischen einen Schritt.

Genau das ist die Falle. „Gibt es einen Schritt namens X" ist beantwortet und
sagt trotzdem nichts: die Box waechst weiter, und schneller, als jemand die
Rezepte nachzieht. Ob ein Rezept den heutigen Stand herstellt, weiss man erst,
wenn man eine frische Karte bootet — oder wenn man fragt wie hier.

DIE FRAGE: WAS LAEUFT AUF DIESER BOX, DAS EINE FRISCHE KARTE NICHT BEKAEME?
Jede Antwort ist Handarbeit, die beim naechsten Neuaufbau fehlt.

══ WARUM „STEHT DER NAME IM REZEPT" DIE FALSCHE FRAGE IST ══════════════════
Die erste Fassung dieses Werkzeugs suchte jeden Dateinamen der Box im
Rezepttext. Ergebnis: 80 Befunde, davon 71 falsch. Die Rezepte legen die
Skripte naemlich nicht einzeln hin, sondern in EINER Sammelkopie:

    for d in mupibox bluetooth wled telegram mupihat fan wifi mqtt; do
      [ -d "mupi-x/scripts/$d" ] && cp -a mupi-x/scripts/$d/* /usr/local/bin/mupibox/
    done

Kein einziger Dateiname steht darin — und trotzdem kommen 60 Skripte an. Eine
Wache, die so etwas nicht aufloest, ist dauerrot, und eine dauerrote Wache
verdeckt den naechsten echten Fund.

Deshalb loest dieses Werkzeug die Sammelwege AUF: es liest die Verzeichnisse
aus der Schleife und aus `install …/services/*.service`, sucht die zugehoerigen
Quellen IM REPO und rechnet daraus aus, welche Dateien wirklich ankommen. Die
Verzeichnisliste wird dabei AUS DEM REZEPT gelesen, nicht hier eingetragen —
sonst driftet die Wache an genau der Stelle, die sie bewachen soll.

DAMIT WIRD AUCH DIE URSACHE SICHTBAR, nicht nur die Wirkung: `scripts/` hat
heute 17 Verzeichnisse, die Schleife nennt 8. Die neun anderen kommen nur an,
soweit einzelne `dest:`-Eintraege sie nachreichen.

ZWEI WEITERE FALLEN, beide vermieden:
  * KOMMENTARE SIND KEINE GEGENSTELLE. Die Rezepte zitieren abgeschaffte
    Namen ausfuehrlich („FRUEHER stand hier …"). Wer gegen die rohe Datei
    prueft, laesst sich das Fehlen einer Sache durch die BESCHREIBUNG ihres
    Fehlens decken. Zeilen, die eingerueckt mit `#` beginnen, fliegen raus.
  * AEHNLICHKEIT IST KEIN BELEG. `mupi_hat.service` und
    `mupi_hat_control.service` sind zwei Dinge; `grep mupi_hat` trifft beide.
    Gesucht wird auf Wortgrenze mit vollstaendigem Namen.

WAS ES NICHT KANN, und das ehrlich
Es prueft, ob ein Rezept die Datei IN DIE HAND NIMMT — nicht, ob der Schritt
gelingt. Ein `cp` von einer falschen Quelle zaehlt hier als abgedeckt.

UND ES ZAEHLT EINEN AUFRUF WIE EIN HINLEGEN. Steht im Rezept nur
`bash /usr/local/bin/mupibox/enable_mupihat.sh`, gilt die Datei als abgedeckt,
obwohl kein Schritt sie hinlegt — dieselbe Falle, die
`tools/ausrollwege-vergleich.py` fuer den Update-Weg beschreibt
(`systemctl start …` sieht aus wie Pflege, legt die Unit aber nie hin). Die
Zahl unten ist deshalb eine UNTERGRENZE. Das ist die richtige Richtung fuer
eine Wache — lieber ein paar echte Funde als Dauerrot, das niemand mehr liest —
aber man darf eine 0 hier nicht fuer einen Freispruch halten.

Der einzige Beweis bleibt der Lauf gegen eine frische Karte; dieses Werkzeug
sagt, woran man dabei hinsehen muss, und findet die Loecher, die auch ein
erfolgreicher Lauf hinterlaesst.

AUFRUF
    tools/rezepte-gegen-box.py
    tools/rezepte-gegen-box.py --box dietpi@192.168.178.78
    tools/rezepte-gegen-box.py --json

Vorgabe `dietpi@mupibox.local` — NICHT 192.168.178.169, das viele Werkzeuge
dieses Baums noch eintragen: die Box hat am 31.08.2026 per DHCP .78 bekommen.

RUECKGABEWERTE
    0  jede Einrichtung der Box wird von einem Rezept angefasst
    1  Aufruf oder Umgebung — Box nicht erreichbar, recipes/ fehlt
    2  mindestens eine Einrichtung, die eine frische Karte nicht bekaeme
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
REZEPTE = WURZEL / "remote-step-installer" / "recipes"
BOX_VORGABE = "dietpi@mupibox.local"

# Rueckweg-Erzeugnisse der Auslieferung und Uebersetzungsreste. Sie gehoeren auf
# KEINE frische Karte — ihr Fehlen im Rezept ist kein Befund, sondern richtig.
KEIN_BEFUND = re.compile(r"(\.zurueck$|\.vor-|\.alt$|^__pycache__$|\.pyc$|~$)")

SCHLUESSELPROGRAMME = ["cog", "chromium", "mpv", "librespot", "pipewire", "wireplumber"]

# Wie die Rezepte ihre entpackten Baeume nennen -> wo dasselbe im Repo liegt.
# Auf SORTE gematcht (Praefix), damit ein neuer Unterpfad nicht durchfaellt.
BAUM_ZU_REPO = {
    "mupi-x/scripts": WURZEL / "scripts",
    "mupi-svc/services": WURZEL / "config" / "services",
    "mupi-x/themes": WURZEL / "themes",
}


def ssh(box: str, befehl: str, zeitlimit: int = 40) -> tuple[int, str]:
    try:
        e = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", box, befehl],
            capture_output=True, text=True, timeout=zeitlimit,
        )
        return e.returncode, e.stdout
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError:
        return 127, ""


def wirksame_zeilen() -> list[str]:
    """Alle Rezeptzeilen ohne Kommentare — siehe Kopf, Falle 1."""
    zeilen = []
    for f in sorted(REZEPTE.glob("*.yaml")):
        for z in f.read_text(errors="replace").splitlines():
            if z.strip().startswith("#"):
                continue
            zeilen.append(z)
    return zeilen


def kommt_vor(name: str, text: str) -> bool:
    """Wortgrenze statt Teilzeichenkette — siehe Kopf, Falle 2."""
    return re.search(r"(?<![\w.-])" + re.escape(name) + r"(?![\w-])", text) is not None


def sammelwege(zeilen: list[str]) -> tuple[set[Path], list[str]]:
    """Die Sammelkopien der Rezepte aufloesen -> Quellverzeichnisse im Repo.

    Zwei Bauarten kommen vor:
      a) `for d in A B C; do … cp -a <baum>/$d/* <ziel>`  (Schleife)
      b) `install … <baum>/*.service <ziel>`              (Sternchen direkt)
    Die Schleifenliste wird AUS DER ZEILE gelesen, nicht hier gepflegt."""
    verzeichnisse: set[Path] = set()
    erklaerung: list[str] = []
    letzte_for: list[str] = []

    for z in zeilen:
        s = z.strip()
        m_for = re.match(r"for\s+(\w+)\s+in\s+([^;]+);\s*do", s)
        if m_for:
            letzte_for = [m_for.group(1), m_for.group(2).strip()]
            continue

        # a) Schleife ueber Unterverzeichnisse
        m = re.search(r"(mupi-[\w-]+/[\w-]+)/\$(\w+)/\*", s)
        if m and letzte_for and m.group(2) == letzte_for[0]:
            basis = BAUM_ZU_REPO.get(m.group(1))
            if basis:
                namen = letzte_for[1].split()
                for n in namen:
                    verzeichnisse.add(basis / n)
                erklaerung.append(f"Schleife ueber {len(namen)} Verzeichnisse in {m.group(1)}/")
            continue

        # b) Sternchen direkt auf einem Baum
        m = re.search(r"(mupi-[\w-]+/[\w-]+)/\*([\w.]*)", s)
        if m:
            basis = BAUM_ZU_REPO.get(m.group(1))
            if basis:
                verzeichnisse.add(basis)
                erklaerung.append(f"Sammelkopie {m.group(1)}/*{m.group(2)}")

    return verzeichnisse, sorted(set(erklaerung))


def abgedeckte_namen(verzeichnisse: set[Path]) -> set[str]:
    """Alle Dateinamen, die ueber die Sammelwege wirklich ankommen."""
    namen = set()
    for v in verzeichnisse:
        if not v.is_dir():
            continue
        for p in v.iterdir():
            if p.is_file():
                namen.add(p.name)
    return namen


def box_lesen(box: str) -> dict | None:
    rc, aus = ssh(box, (
        "systemctl list-unit-files --state=enabled --no-legend 2>/dev/null "
        "| awk '{print $1}' | grep -iE 'mupi|mixpi|librespot' | sort; "
        "echo '---SKRIPTE---'; ls -1 /usr/local/bin/mupibox/ 2>/dev/null | sort; "
        "echo '---PROGRAMME---'; "
        + "; ".join(f"command -v {p} >/dev/null && echo {p}" for p in SCHLUESSELPROGRAMME)
    ))
    if rc != 0 and not aus.strip():
        return None
    units, skripte, programme = [], [], []
    ziel = units
    for z in aus.splitlines():
        z = z.strip()
        if z == "---SKRIPTE---":
            ziel = skripte
            continue
        if z == "---PROGRAMME---":
            ziel = programme
            continue
        if z:
            ziel.append(z)
    return {
        "units": units,
        "skripte": [s for s in skripte if not KEIN_BEFUND.search(s)],
        "programme": programme,
        "uebergangen": [s for s in skripte if KEIN_BEFUND.search(s)],
    }


def main() -> int:
    t = argparse.ArgumentParser(description="Installer-Rezepte gegen eine laufende Box halten")
    t.add_argument("--box", default=BOX_VORGABE)
    t.add_argument("--json", action="store_true")
    a = t.parse_args()

    if not REZEPTE.is_dir():
        print(f"{REZEPTE} fehlt", file=sys.stderr)
        return 1

    stand = box_lesen(a.box)
    if stand is None:
        print(f"Box {a.box} nicht erreichbar.\n"
              "Die Adresse 192.168.178.169 aus vielen Werkzeugen ist tot — die Box\n"
              "hat am 31.08.2026 per DHCP .78 bekommen. Mit --box uebersteuern.",
              file=sys.stderr)
        return 1

    zeilen = wirksame_zeilen()
    text = "\n".join(zeilen)
    verzeichnisse, erklaerung = sammelwege(zeilen)
    ueber_sammelweg = abgedeckte_namen(verzeichnisse)

    # WAS EIN AUSGEROLLTES SKRIPT INSTALLIERT, IST AUCH ABGEDECKT.
    # `cog` steht in keinem Rezept — aber `scripts/mupibox/mixpi-kiosk-pakete.sh`
    # holt es per apt, und dieses Skript liegt in einem Verzeichnis, das die
    # Sammelschleife mitnimmt. Ein Rezept, das ein Installationsskript hinlegt,
    # deckt damit ab, was das Skript installiert. Ohne diese Regel meldet die
    # Wache jedes selbstheilende Nachladen als Loch.
    text_ausgerollt = [text]
    for v in verzeichnisse:
        if not v.is_dir():
            continue
        for p in v.iterdir():
            if p.is_file() and p.suffix in (".sh", ".py", ""):
                try:
                    text_ausgerollt.append(p.read_text(errors="replace"))
                except OSError:
                    continue
    text_mit_skripten = "\n".join(text_ausgerollt)

    # WO LIEGT DIE DATEI IM REPO? Das entscheidet, was zu tun ist, und die zwei
    # Faelle sind voellig verschiedene Arbeit:
    #   im Repo  -> die Datei gibt es, nur kein Weg bringt sie hin. Ein
    #               Verzeichnis in die Schleife aufnehmen, fertig.
    #   nicht da -> die Box hat etwas, das dieser Baum gar nicht kennt (Rest
    #               eines fremden Ausrollwegs oder reine Handarbeit). Erst
    #               herausfinden, woher es kommt.
    # Sie in einen Topf zu werfen hiesse, die leichte Haelfte hinter der
    # schweren zu verstecken.
    # DEN GANZEN BAUM absuchen, nicht nur scripts/ und config/services/.
    # `mixpibox-selbstlauf.service` liegt unter remote-step-installer/tools/ und
    # wurde von einer engeren Suche als „nicht einmal im Baum" gemeldet — die
    # schwerere der beiden Kategorien, fuer eine Datei, die einfach woanders
    # liegt. Eine Fehleinordnung nach OBEN kostet hier am meisten: sie schickt
    # jemanden auf Herkunftssuche nach etwas, das er schon hat.
    ausgeschlossen = {"node_modules", ".git", ".claude", "dist", "www", "www-admin"}
    im_repo: dict[str, Path] = {}
    for p in WURZEL.rglob("*"):
        if p.is_file() and not (ausgeschlossen & set(p.relative_to(WURZEL).parts)):
            im_repo.setdefault(p.name, p)

    luecken = {"units": [], "skripte": [], "programme": []}
    for art in ("units", "skripte", "programme"):
        for name in stand[art]:
            # Programme duerfen auch von einem ausgerollten Skript kommen;
            # Dateien muessen im Rezept selbst stehen oder ueber einen
            # Sammelweg kommen — ein Skript, das eine Datei nur ERWAEHNT,
            # legt sie nicht hin.
            gegenstelle = text_mit_skripten if art == "programme" else text
            if name in ueber_sammelweg or kommt_vor(name, gegenstelle):
                continue
            quelle = im_repo.get(name)
            luecken[art].append({
                "name": name,
                "im_repo": str(quelle.relative_to(WURZEL)) if quelle else None,
            })

    # Die URSACHE, unabhaengig von der Box: Quellverzeichnisse, die kein
    # Sammelweg erfasst. Sie erklaeren, warum Einzelnes durchfaellt.
    scripts_wurzel = WURZEL / "scripts"
    unerfasst = []
    if scripts_wurzel.is_dir():
        for p in sorted(scripts_wurzel.iterdir()):
            if p.is_dir() and p not in verzeichnisse:
                unerfasst.append((p.name, len([x for x in p.iterdir() if x.is_file()])))

    gesamt = sum(len(v) for v in luecken.values())

    if a.json:
        print(json.dumps({
            "box": a.box,
            "rezepte": sorted(p.name for p in REZEPTE.glob("*.yaml")),
            "sammelwege": erklaerung,
            "ueber_sammelweg": len(ueber_sammelweg),
            "geprueft": {k: len(stand[k]) for k in ("units", "skripte", "programme")},
            "luecken": luecken,
            "scripts_ohne_sammelweg": [{"verzeichnis": n, "dateien": c} for n, c in unerfasst],
            "anzahl": gesamt,
        }, ensure_ascii=False, indent=2))
        return 2 if gesamt else 0

    print(f"BOX      {a.box}")
    print(f"REZEPTE  {', '.join(sorted(p.name for p in REZEPTE.glob('*.yaml')))}")
    for e in erklaerung:
        print(f"         {e}")
    print(f"         -> {len(ueber_sammelweg)} Dateien kommen ueber Sammelwege an")
    print(f"GEPRUEFT {len(stand['units'])} Units, {len(stand['skripte'])} Skripte, "
          f"{len(stand['programme'])} Programme"
          + (f"  ({len(stand['uebergangen'])} Rueckweg-Reste uebergangen)"
             if stand["uebergangen"] else ""))
    print()

    ueberschrift = {
        "programme": "PROGRAMME, die kein Rezept installiert",
        "units": "DIENSTE, die eine frische Karte nicht bekaeme",
        "skripte": "SKRIPTE, die kein Rezept hinlegt",
    }
    for art in ("programme", "units", "skripte"):
        if not luecken[art]:
            continue
        # DREI Koerbe, nicht zwei. „Schleife ergaenzen" stimmt nur fuer Dateien,
        # die unter scripts/ liegen — dort greift die Sammelkopie. Liegt der
        # gleiche Name irgendwo sonst im Baum (tools/mupihat-analyse/parse_log.py
        # etwa), ist das ein NAMENSGLEICHSTAND und noch kein Beleg, dass es
        # dieselbe Datei ist. Diesen Rat zu geben, waere geraten.
        in_scripts = [b for b in luecken[art]
                      if b["im_repo"] and b["im_repo"].startswith(("scripts/", "config/services/"))]
        woanders = [b for b in luecken[art]
                    if b["im_repo"] and b not in in_scripts]
        fehlt_ganz = [b for b in luecken[art] if not b["im_repo"]]
        print(f"── {ueberschrift[art]} ({len(luecken[art])}) ──")
        if in_scripts:
            print("   IN scripts/, nur kein Weg dorthin — Verzeichnis in die Schleife:")
            for b in in_scripts:
                print(f"     {b['name']:28} {b['im_repo']}")
        if woanders:
            print("   Gleicher NAME anderswo im Baum — ob es dieselbe Datei ist, ist offen:")
            for b in woanders:
                print(f"     {b['name']:28} {b['im_repo']}")
        if fehlt_ganz:
            print("   NICHT EINMAL IM BAUM — Herkunft unbekannt, erst klaeren:")
            for b in fehlt_ganz:
                print(f"     {b['name']}")
        print()

    if unerfasst:
        print(f"── URSACHE: scripts/-Verzeichnisse ohne Sammelweg ({len(unerfasst)}) ──")
        print("   Die Schleife im Rezept nennt sie nicht; was daraus ankommt, kommt")
        print("   nur ueber einzelne dest:-Eintraege.")
        for n, c in unerfasst:
            print(f"   {n:12} {c} Dateien")
        print()

    if not gesamt:
        print("Jede Einrichtung dieser Box wird von einem Rezept angefasst.")
        return 0
    print(f"{gesamt} Einrichtungen ohne Rezept. Jede davon ist Handarbeit, die beim")
    print("naechsten Neuaufbau fehlt — und die ein erfolgreicher Installer-Lauf")
    print("NICHT meldet, weil er nicht weiss, dass es sie gibt.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
