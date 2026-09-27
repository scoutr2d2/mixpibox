#!/usr/bin/env python3
"""Laeuft das Installer-Rezept dem Repo hinterher?

WOFUER
`tools/ausrollwege-vergleich.py` und `tools/paketlisten-deckung.py` vergleichen
die ZWEI Shell-Wege miteinander:

    autosetup/autosetup.sh          der Erstweg   — die frische SD-Karte
    update/start_mupibox_update.sh  der Update-Weg — die Box im Haus

Beide uebersehen denselben dritten Weg, und `paketlisten-deckung.py` sagt das
in seinem eigenen Kopf ausdruecklich („WAS DIESES WERKZEUG NICHT SIEHT … die
Rezepte des remote-step-installers"):

    remote-step-installer/recipes/mupibox.yaml       das System
    remote-step-installer/recipes/mupibox-app.yaml   die App

Das ist kein Nebenweg. `tools/ausrollweg-deckung.py` haelt seit dem 31.08.2026
fest: „DER WEG, DER HEUTE DIE KARTEN BAUT" ist der remote-step-installer, nicht
mehr `autosetup.sh`. Eine Abweichung DORT trifft also jede neu bespielte Karte —
und zwar an einem Geraet, das gerade behauptet, fertig zu sein.

BELEGT AM 19.09.2026, beides von Hand gefunden:
  * `wireguard-tools` stand in autosetup.sh (seit E30) und kam am selben Tag in
    den Update-Weg (f97fcbce, Rang 1). Im REZEPT fehlte es — eine frische Karte
    bekam eine VPN-Seite, die nur „Das Werkzeug fehlt" sagt und den Betreiber
    per SSH auf die Box schickt.
  * Der Schritt `app-paket` beschrieb `deploy.zip` mit vier Stuecken. Drin
    liegen sieben. Unter den drei ungenannten: `plugin-laufwerk.js` — fehlt es,
    startet die Box tadellos und laedt einfach KEIN Plugin (src/deploy.sh bricht
    auf der BAUseite genau dafuer hart ab; die Empfangsseite fragte nicht nach).

DIE FEHLERKLASSE ist dieselbe wie bei [[zwei-ausrollwege-eine-handgefuehrte-
liste]], nur eine Liste weiter: DREI von Hand gefuehrte Beschreibungen derselben
Sache laufen auseinander, jede fuer sich ist gruen, und auffallen wuerde es erst
an einer frisch bespielten Karte.

WAS GEPRUEFT WIRD — drei Fragen, jede einzeln rot

  1. TRAGENDE STUECKE DES PAKETS. `src/deploy.sh` fuehrt in seiner
     Schlussschleife (`for STUECK in …`) die Stuecke, ohne die es NICHTS
     ausliefert. Genau die muss der Schritt `app-paket` in seinem `check:`
     nachsehen — sonst prueft der Bau strenger als der Empfang, und ein
     halbes Paket landet unbemerkt auf der Karte.
     KEINE HANDLISTE: die Stuecke werden aus deploy.sh GELESEN. Wer dort eines
     ergaenzt, macht diesen Abschnitt rot, bis das Rezept nachzieht.

  2. BESCHREIBUNG GEGEN DAS ZIP. Jeder Eintrag der obersten Ebene von
     `bin/nodejs/deploy.zip` muss im Schritt `app-paket` vorkommen, und jeder
     Pfad, den der `note:` nennt, muss im Zip wirklich liegen. Beide Richtungen,
     weil beide schon passiert sind: ein neues Stueck im Paket, das niemand
     erwaehnt (plugin-laufwerk.js), und eine Beschreibung, die auf eine Ebene
     zeigt, die es nicht mehr gibt (`www/` statt `www/neu/`, seit E118/1e liegt
     direkt unter www/ nichts).
     AUCH HIER KEINE HANDLISTE: gelesen wird das Zip.

  3. MERKMALS-PAKETE AUF ALLEN DREI WEGEN. Ein Paket, an dem eine Funktion der
     Verwaltung haengt, muss auf JEDEM Weg installiert werden, der eine Box
     herstellt oder pflegt. Hier steht als einziges eine kurze Tabelle — und
     jede Zeile traegt einen ANKER (`gilt_solange`) in fremden Code. Faellt der
     Grund weg, meldet sich die Zeile SELBST als verrottet, statt still
     weiterzugelten ([[dauerrote-wache-ist-keine]] von der anderen Seite: eine
     Regel ohne lebenden Grund ist eine Falschauskunft, die genau einmal hilft).

WARUM ABSCHNITT 3 KEINE VOLLE MENGENGLEICHHEIT PRUEFT
Nachgemessen am 19.09.2026: 32 Pakete stehen in beiden Shell-Listen und nicht
im Rezept, 15 nur im Rezept. Das ist gewollt — das Rezept baut den Tonstapel,
den Kiosk und den Touch anders auf (`speech-dispatcher`, `xinput`, `x11vnc`,
`mpv`, `zram-tools`), und mehrere Pakete holt es in eigenen Schritten statt in
der Sammelzeile. Eine Gleichheitspruefung waere ab der ersten Minute rot und
damit keine Wache. Gefragt wird deshalb nach dem MERKMAL, nicht nach der Menge.

WAS DIESES WERKZEUG NICHT SIEHT — und wo also weiter von Hand gelesen wird:
`dietpi-software`-Nummern, npm-Globals, Node selbst, alles was ein Skript unter
`scripts/` nachinstalliert, und die Reihenfolge der Schritte im Rezept.

    python3 tools/rezept-deckung.py            # Bericht
    python3 tools/rezept-deckung.py --pruefen  # dasselbe, Rueckgabe 1 bei Befund
"""

import argparse
import re
import sys
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

BAUSKRIPT = WURZEL / "src" / "deploy.sh"
PAKET = WURZEL / "bin" / "nodejs" / "deploy.zip"
REZEPT_APP = WURZEL / "remote-step-installer" / "recipes" / "mupibox-app.yaml"
REZEPT_SYS = WURZEL / "remote-step-installer" / "recipes" / "mupibox.yaml"
NETZLAUFWERK_TS = WURZEL / "src" / "backend-api" / "src" / "netzlaufwerk.ts"
ERSTWEG = WURZEL / "autosetup" / "autosetup.sh"
UPDATEWEG = WURZEL / "update" / "start_mupibox_update.sh"
SERVER_TS = WURZEL / "src" / "backend-api" / "src" / "server.ts"
PACK = WURZEL / "llmwiki" / "pack.yaml"

# ── Abschnitt 3: die Tabelle, und warum sie kurz bleiben darf ───────────────
#
# Jede Zeile nennt ein Paket, die Funktion, die daran haengt, und was OHNE das
# Paket am Geraet passiert — die Folge gehoert dazu, sonst liest ein spaeterer
# Leser nur einen Paketnamen und streicht ihn beim naechsten Aufraeumen.
#
# `gilt_solange` ist (Datei, Regex). Trifft der Regex nicht mehr, ist der Grund
# weg und die Zeile meldet sich als verrottet. Der Anker zeigt bewusst NICHT
# auf die Ausrollwege selbst — das waere im Kreis geprueft: „das Paket muss in
# autosetup stehen, weil es in autosetup steht".
MERKMALS_PAKETE = [
    {
        "paket": "wireguard-tools",
        "merkmal": "VPN-Heimweg der Verwaltung (BACKLOG E30)",
        "folge": (
            "die VPN-Seite zeigt nur die Karte 'Das Werkzeug fehlt' und "
            "schickt den Betreiber per SSH auf die Box"
        ),
        # Der Server schaltet GENAU EINE Einheit; steht die Konstante nicht
        # mehr da, gibt es den Heimweg nicht mehr.
        "gilt_solange": (SERVER_TS, r"wg-quick@"),
    },
    {
        "paket": "cifs-utils",
        "merkmal": "Netzlaufwerk per SMB (BACKLOG E28/N6-N9, E29/B4)",
        "folge": (
            "die Netzlaufwerk-Seite zeigt nur die Karte 'Das Werkzeug fehlt' — "
            "am 20.09.2026 an Box .62 genau so gemessen, bevor das Paket in die "
            "Listen kam"
        ),
        # Der Anker steht im reinen Modul, nicht in einem Ausrollweg: solange
        # eine Einheit mit Type=cifs entsteht, wird mount.cifs gebraucht.
        "gilt_solange": (NETZLAUFWERK_TS, r"'cifs'"),
    },
    {
        "paket": "davfs2",
        "merkmal": "Netzlaufwerk per WebDAV (BACKLOG E28/N6-N9)",
        "folge": (
            "der WebDAV-Knopf der Netzlaufwerk-Seite bleibt grau; eine "
            "Nextcloud-Freigabe laesst sich gar nicht erst eintragen"
        ),
        "gilt_solange": (NETZLAUFWERK_TS, r"'davfs'"),
    },
    {
        "paket": "python3-rpi-lgpio",
        "statt": "python3-rpi.gpio",
        "merkmal": "GPIO auf dem Pi 5 (Taster, Luefter)",
        "folge": (
            "RPi.GPIO greift per /dev/mem auf CPU-Register, die beim Pi 5 im "
            "RP1 sitzen — der Zugriff ist dort schlicht tot"
        ),
        # Der Grund steht im Wissenspaket, nicht in einem der Ausrollwege.
        "gilt_solange": (PACK, r"\bmupi-rpi-lgpio\b"),
    },
]

# Die Wege, die eine Box HERSTELLEN oder PFLEGEN. Ein Merkmals-Paket muss auf
# jedem davon ankommen — sonst haengt die Funktion daran, auf welchem Weg die
# Box entstanden ist.
WEGE = [
    ("erstweg", ERSTWEG),
    ("updateweg", UPDATEWEG),
    ("rezept", REZEPT_SYS),
]

SCHRITT_APP_PAKET = "app-paket"


# ── Lesehilfen ──────────────────────────────────────────────────────────────

def lies(pfad: Path) -> str:
    return pfad.read_text(encoding="utf-8", errors="replace")


def ohne_kommentare(text: str) -> str:
    """Shell- und YAML-Kommentare raus.

    OHNE DAS IST DIE WACHE GRUEN AUF DIE GEFAEHRLICHSTE ART: der Update-Weg
    ERKLAERT in den Zeilen 399-413, warum `python3-rpi.gpio` weichen musste —
    und nennt den alten Namen dabei viermal. Eine Literalsuche haelt das fuer
    eine Installation. Dieselbe Falle steht im Wissenspaket unter
    [[kommentar-und-kompilat-sind-keine-gegenstelle]].

    Ein `#` INNERHALB von Anfuehrungszeichen bleibt stehen (Farbcodes, Anker
    in URLs) — deshalb wird die Zeile zeichenweise gelesen und nicht gesplittet.
    """
    raus = []
    for zeile in text.splitlines():
        in_einfach = in_doppel = False
        schnitt = None
        for i, z in enumerate(zeile):
            if z == "'" and not in_doppel:
                in_einfach = not in_einfach
            elif z == '"' and not in_einfach:
                in_doppel = not in_doppel
            elif z == "#" and not in_einfach and not in_doppel:
                schnitt = i
                break
        raus.append(zeile if schnitt is None else zeile[:schnitt])
    return "\n".join(raus)


def schritt_text(rezept: Path, schritt_id: str) -> str | None:
    """Der ganze Block EINES Rezeptschritts als Rohtext.

    Bewusst ohne YAML-Parser: gesucht wird auch in `note:`-Prosa und in
    Kommentarzeilen des `run:`-Blocks, und genau die sind hier der Gegenstand.
    Der Block laeuft von `- id: <name>` bis zum naechsten `- id:` derselben
    Einrueckung.
    """
    text = lies(rezept)
    anfang = re.search(rf"^(\s*)- id:\s*{re.escape(schritt_id)}\s*$", text, re.M)
    if not anfang:
        return None
    tiefe = anfang.group(1)
    rest = text[anfang.end():]
    naechster = re.search(rf"^{tiefe}- id:\s", rest, re.M)
    return rest[: naechster.start()] if naechster else rest


def zip_oberste_ebene(paket: Path) -> list[str]:
    """Die oberste Ebene des Pakets: Dateien mit Namen, Ordner mit `<name>/`."""
    with zipfile.ZipFile(paket) as z:
        namen = z.namelist()
    oben = set()
    for n in namen:
        oben.add(n.split("/")[0] + "/" if "/" in n else n)
    return sorted(oben)


# ── Abschnitt 1: tragende Stuecke ───────────────────────────────────────────

def abschnitt_tragende_stuecke(befunde: list[str]) -> list[tuple[str, str]]:
    zeilen = []
    quelle = lies(BAUSKRIPT)
    treffer = re.search(r"^for STUECK in ([^;\n]+);", quelle, re.M)
    if not treffer:
        befunde.append(
            "src/deploy.sh fuehrt keine `for STUECK in …`-Schlussschleife mehr — "
            "die Grundlage dieses Abschnitts ist weg. Entweder die Schleife wurde "
            "umbenannt (dann hier nachziehen) oder der Bau prueft sein Paket nicht "
            "mehr (dann ist DAS der Befund)."
        )
        return [("!!", "Schlussschleife in src/deploy.sh nicht gefunden")]

    stuecke = treffer.group(1).split()
    block = schritt_text(REZEPT_APP, SCHRITT_APP_PAKET)
    if block is None:
        befunde.append(
            f"Schritt '{SCHRITT_APP_PAKET}' steht nicht mehr in {REZEPT_APP.name} — "
            "wurde er umbenannt, prueft hier ab sofort niemand mehr das Paket."
        )
        return [("!!", f"Schritt '{SCHRITT_APP_PAKET}' fehlt")]

    pruefblock = re.search(r"^\s*check:\s*\|?(.*?)(?=^\s*- id:|\Z)", block, re.M | re.S)
    pruef = pruefblock.group(1) if pruefblock else ""

    for stueck in stuecke:
        if stueck in pruef:
            zeilen.append(("ok", f"{stueck}: steht im check: des Rezepts"))
        else:
            zeilen.append(("!!", f"{stueck}: FEHLT im check: des Schritts '{SCHRITT_APP_PAKET}'"))
            befunde.append(
                f"src/deploy.sh bricht den BAU ab, wenn `{stueck}` im Paket fehlt — "
                f"das Rezept nimmt das Paket entgegen, ohne danach zu sehen. "
                f"Die Bauseite prueft damit strenger als die Empfangsseite."
            )
    return zeilen


# ── Abschnitt 2: Beschreibung gegen das Zip ─────────────────────────────────

def abschnitt_beschreibung(befunde: list[str]) -> list[tuple[str, str]]:
    zeilen = []
    if not PAKET.is_file():
        zeilen.append(("--", f"{PAKET.relative_to(WURZEL)} liegt nicht da — uebersprungen"))
        return zeilen

    block = schritt_text(REZEPT_APP, SCHRITT_APP_PAKET)
    if block is None:
        return [("!!", f"Schritt '{SCHRITT_APP_PAKET}' fehlt")]

    # Richtung 1: was im Paket liegt, muss der Schritt erwaehnen.
    for eintrag in zip_oberste_ebene(PAKET):
        name = eintrag.rstrip("/")
        if name in block:
            zeilen.append(("ok", f"{eintrag}: im Schritt genannt"))
        else:
            zeilen.append(("!!", f"{eintrag}: liegt im Paket, der Schritt nennt es NICHT"))
            befunde.append(
                f"`{eintrag}` reist im deploy.zip mit, aber der Schritt "
                f"'{SCHRITT_APP_PAKET}' erwaehnt es nirgends. Wer das Rezept liest, "
                f"weiss nicht, dass es auf die Karte kommt — und merkt nicht, wenn "
                f"es eines Tages fehlt."
            )

    # Richtung 2: was der note: als Paketinhalt AUFZAEHLT, muss im Paket liegen.
    #
    # ZWEIMAL ENG GEFASST, und beide Male, weil die weite Fassung Unsinn meldete
    # (erster Lauf am 19.09.2026: vier Befunde, alle falsch):
    #   * NUR DIE AUFZAEHLUNG, also der Absatz ab `deploy.zip =`. Was danach als
    #     Begruendung folgt, nennt Pfade DIESES Baums (src/deploy.sh, dieses
    #     Werkzeug hier) — die liegen natuerlich nicht im Paket.
    #   * NUR, WAS NACH PAKETINHALT AUSSIEHT: Ordner mit Schraegstrich am Ende
    #     oder eine bekannte Endung. Sonst faellt eine Backlog-Nummer wie
    #     `E118/1e` als „Pfad" heraus, und ein Satzpunkt macht aus `www-admin/`
    #     ein `www-admin/.`.
    # Eine Wache, die bei gesundem Zustand meldet, wird abgeschaltet — dann
    # sieht niemand mehr den echten Befund daneben.
    notiz = re.search(r"^\s*note:.*?(deploy\.zip\s*=.*?)(?:\n\s*\n|\Z)",
                      block, re.M | re.S)
    if notiz:
        with zipfile.ZipFile(PAKET) as z:
            namen = set(z.namelist())
        kandidaten = set(re.findall(r"\b([a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*/?)(?=[\s,)])",
                                    notiz.group(1)))
        for k in sorted(kandidaten):
            if not (k.endswith("/") or k.endswith((".js", ".json", ".md", ".css", ".html"))):
                continue  # Prosa oder Backlog-Nummer, kein Paketinhalt
            da = k in namen or any(n.startswith(k) for n in namen)
            if not da:
                zeilen.append(("!!", f"note: nennt `{k}` — im Paket liegt nichts darunter"))
                befunde.append(
                    f"Der `note:` des Schritts '{SCHRITT_APP_PAKET}' beschreibt `{k}`, "
                    f"aber im deploy.zip gibt es diesen Pfad nicht. Eine Anleitung, die "
                    f"auf eine Ebene zeigt, die es nicht mehr gibt, kostet den naechsten "
                    f"Leser genau die Zeit, die sie sparen sollte."
                )
    return zeilen


# ── Abschnitt 3: Merkmals-Pakete ────────────────────────────────────────────

# Zeilenfortsetzung mit Rueckstrich — sonst endet die Paketliste des
# PipeWire-Schritts (mupibox.yaml:935) nach dem ersten Wort.
FORTSETZUNG = re.compile(r"\\\n\s*")

# NUR STELLEN, DIE WIRKLICH INSTALLIEREN. Der fuehrende `(?<!\x60)` haelt
# zitierte Befehle draussen: mupibox-app.yaml:1384 erklaert im `note:`, dass
# "`apt-get install -y mplayer` holt, was an dem Tag da ist" — eine Erklaerung,
# keine Installation.
INSTALLSTELLEN = [
    re.compile(r"(?<!`)\bapt(?:-get)?\s+(?:-y\s+)?install\b([^\n]*)"),
    re.compile(r"\bpackages2install\s*=\s*\"([^\"]*)\""),
    re.compile(r"\bAUDIO_PAKETE\s*=\s*\"([^\"]*)\""),
    re.compile(r"\bfor\s+package\s+in\s+([^\n;]*)"),
]


def installzeilen(weg: Path) -> str:
    """Nur der Text, der Pakete WIRKLICH installiert.

    ZWEI SORTEN PROSA MUESSEN VORHER RAUS, und die zweite hat diese Wache beim
    ersten Anlauf stumpf gemacht:

      * `#`-Kommentare. Der Update-Weg ERKLAERT in den Zeilen 399-413, warum
        `python3-rpi.gpio` weichen musste, und nennt den alten Namen dabei
        viermal ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
      * `note:`-BLOECKE DER REZEPTE. Das ist dieselbe Falle eine Etage tiefer,
        und sie ist gemeiner: die Doku eines Rezeptschritts steht NICHT hinter
        einem `#`, sondern ist ein ganz normaler YAML-Wert. Belegt am
        19.09.2026 in der Gegenprobe dieser Wache: `wireguard-tools` aus der
        `run:`-Zeile geloescht — die Wache blieb GRUEN, weil der `note:`
        daneben den Paketnamen erklaert. Eine gruene Gegenprobe IST der Fund
        ([[gegenprobe-bleibt-gruen-ist-der-fund]]).

    Statt Prosa zu erkennen wird der umgekehrte Weg gegangen: gesammelt wird
    nur, was hinter einem Installationsbefehl steht.
    """
    text = FORTSETZUNG.sub(" ", ohne_kommentare(lies(weg)))
    return "\n".join(m.group(1) for r in INSTALLSTELLEN for m in r.finditer(text))


def installiert(weg: Path, paket: str) -> bool:
    """Wird das Paket auf diesem Weg installiert?

    Der Paketname wird als eigenes Wort gesucht — `.` ist zu maskieren, sonst
    traefe `python3-rpi.gpio` auch `python3-rpi-gpio`.
    """
    return re.search(rf"(?<![\w.-]){re.escape(paket)}(?![\w.-])", installzeilen(weg)) is not None


def abschnitt_merkmalspakete(befunde: list[str]) -> list[tuple[str, str]]:
    zeilen = []
    for regel in MERKMALS_PAKETE:
        paket = regel["paket"]
        ankerdatei, ankerregex = regel["gilt_solange"]
        if not ankerdatei.is_file() or not re.search(ankerregex, lies(ankerdatei)):
            zeilen.append(("!!", f"{paket}: der Grund ist WEG (Anker {ankerregex!r} "
                                 f"trifft in {ankerdatei.name} nicht mehr)"))
            befunde.append(
                f"Die Regel zu `{paket}` stuetzt sich auf {ankerdatei.name}, und der "
                f"Anker trifft dort nicht mehr. Entweder ist das Merkmal gefallen "
                f"(dann gehoert die Zeile hier weg) oder es ist umgezogen (dann der "
                f"Anker). Eine Regel ohne lebenden Grund ist eine Falschauskunft."
            )
            continue

        fehlt = [name for name, weg in WEGE if not installiert(weg, paket)]
        if fehlt:
            zeilen.append(("!!", f"{paket}: fehlt auf {', '.join(fehlt)}"))
            befunde.append(
                f"`{paket}` traegt {regel['merkmal']}. Auf {', '.join(fehlt)} wird es "
                f"nicht installiert. Folge auf einer so entstandenen Box: {regel['folge']}."
            )
        else:
            zeilen.append(("ok", f"{paket}: auf allen {len(WEGE)} Wegen"))

        verboten = regel.get("statt")
        if verboten:
            steht = [name for name, weg in WEGE if installiert(weg, verboten)]
            if steht:
                zeilen.append(("!!", f"{verboten}: steht noch auf {', '.join(steht)}"))
                befunde.append(
                    f"`{verboten}` ist von `{paket}` abgeloest, wird aber auf "
                    f"{', '.join(steht)} weiter installiert. Was das anrichtet: "
                    f"{regel['folge']}."
                )
            else:
                zeilen.append(("ok", f"{verboten}: auf keinem Weg mehr (nur in Kommentaren)"))
    return zeilen


# ── Bericht ─────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--pruefen", action="store_true",
                   help="Rueckgabe 1, sobald ein Befund dasteht")
    args = p.parse_args()

    befunde: list[str] = []
    abschnitte = [
        ("Tragende Stuecke des Pakets (aus src/deploy.sh gelesen)", abschnitt_tragende_stuecke),
        ("Beschreibung des Schritts 'app-paket' gegen deploy.zip", abschnitt_beschreibung),
        ("Merkmals-Pakete auf allen Wegen", abschnitt_merkmalspakete),
    ]
    for titel, fn in abschnitte:
        print(f"── {titel}")
        for marke, text in fn(befunde):
            print(f"  {marke:<4} {text}")

    print()
    if not befunde:
        print("Das Rezept deckt sich mit dem Repo.")
        return 0

    print(f"{len(befunde)} Befund(e) — das Rezept laeuft dem Repo hinterher:")
    for b in befunde:
        print(f"  * {b}")
    print()
    print("  Das Rezept ist die Anleitung, nach der eine FRISCHE Karte entsteht.")
    print("  Was hier fehlt, fehlt auf jeder neu bespielten Box — und dort faellt")
    print("  es erst am Geraet auf, wenn ueberhaupt.")
    return 1 if args.pruefen else 0


if __name__ == "__main__":
    sys.exit(main())
