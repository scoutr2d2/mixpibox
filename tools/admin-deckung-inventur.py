#!/usr/bin/env python3
"""
WOZU
  Beantwortet G2 und G3 aus dem Backlog WIEDERHOLBAR — die Frage stellt sich
  jedes Mal neu, sobald ein Schluessel dazukommt oder eine Seite umzieht:

    G2  DECKUNGSLUECKE  Welcher Schluessel aus /etc/mupibox/mupiboxconfig.json
                        hat KEIN Feld im neuen Angular-Board?
    G3  FUNKTIONSLUECKE Welche Seite des alten PHP-Admin (AdminInterface/www)
                        hat kein Gegenstueck im neuen Board?

  Zu jedem ungedeckten Schluessel sucht das Werkzeug ausserdem die LESER im
  Baum. Das ist die eigentlich interessante Spalte: ein Schluessel, den niemand
  mehr liest, braucht kein Feld — er braucht eine Loeschung.

WAS ES AENDERT
  NICHTS. Es liest nur. Die Box wird ausschliesslich lesend angefasst
  (ein `ssh ... cat`), es wird nichts geschrieben, nichts neu gestartet.
  Ausgabe geht nach stdout.

FALLEN, die dieses Werkzeug bewusst umgeht
  * `jq -r 'paths(scalars)'` UNTERSCHLAEGT alle booleschen Schluessel mit Wert
    `false` — auf der Box am 30.07.2026 elf Stueck (mqtt.active, telegram.active,
    wled.active …). Wer damit zaehlt, uebersieht genau die abgeschalteten
    Funktionen. Deshalb wird hier mit Pythons json-Modul gelaufen.
  * Nach dem BLOSSEN Blattnamen zu greppen ("active", "port", "name") liefert
    Hunderte Falschtreffer. Gesucht wird deshalb nach PFADFORMEN
    (.gruppe.blatt / ['gruppe']['blatt'] / gruppe?.blatt); nur wo keine
    Pfadform trifft, wird schwach nachgesucht (Blatt UND Gruppe in derselben
    Datei) und das Ergebnis als "schwach" gekennzeichnet.
  * Der tote PHP-Admin (AdminInterface/) und `update/conf_update.sh` (das
    Schluessel nur SETZT, nicht liest) zaehlen nicht als Leser — sonst sieht
    jeder verwaiste Schluessel benutzt aus.

AUFRUF
  python3 tools/admin-deckung-inventur.py                  # Konfiguration von der Box holen
  python3 tools/admin-deckung-inventur.py --datei box.json # aus einer Datei statt per ssh
  python3 tools/admin-deckung-inventur.py --host 192.168.178.99
  python3 tools/admin-deckung-inventur.py --g2             # nur die Deckungsluecke
  python3 tools/admin-deckung-inventur.py --g3             # nur die Funktionsluecke
  python3 tools/admin-deckung-inventur.py --markdown       # Tabellen fuer BACKLOG.md
"""

import argparse
import json
import os
import re
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KONFIG_TS = os.path.join(WURZEL, "src", "backend-api", "src", "konfiguration.ts")
BOX_PFAD = "/etc/mupibox/mupiboxconfig.json"
BOX_STANDARD = "dietpi@192.168.178.169"

# Was gar nicht erst eingelesen wird.
AUSGESCHLOSSEN = (
    "node_modules/",
    ".git/",
    "AdminInterface/",
    "dist/",
    "www/",
)

# Eingelesen, aber KEIN Leser eines Schluessels:
#   konfiguration.ts    ist die Feldtabelle SELBST — sie waere ihr eigener Beleg
#   conf_update.sh      SETZT Schluessel beim Update, liest sie nicht
# FALLE: konfiguration.ts muss trotzdem eingelesen werden, weil G3 dort nach
# `jellyfinServer` und `spotifyClientId` sucht. Beim ersten Anlauf war die Datei
# ganz ausgeschlossen — und Jellyfin galt als fehlende Funktion, obwohl es ein
# Feld dafuer gibt.
NICHT_LESER = (
    "src/backend-api/src/konfiguration.ts",
    "src/backend-api/src/konfiguration.spec.ts",
    "update/conf_update.sh",
)

# Kein Leser, sondern nur eine VORLAGE: hier steht der Schluessel drin, damit er
# bei der Installation entsteht. Ein Schluessel, der NUR hier vorkommt, wird von
# niemandem gelesen — das ist der interessante Fall und darf nicht als Leser
# durchgehen.
NUR_VORLAGE = ("config/templates/", "harness/seed/", "config/beispiel")

DURCHSUCHTE_ENDUNGEN = (
    ".ts", ".js", ".mjs", ".py", ".sh", ".json", ".html", ".css",
    ".service", ".conf", ".txt", ".yaml", ".yml",
)
# .md fehlt mit Absicht: eine Analyse, die einen Schluessel ERWAEHNT, liest ihn
# nicht. Beim ersten Anlauf galt ADMIN-BOARD-ANALYSE.md als Leser von
# `mupibox.AudioDevice` — genau der Schluessel, von dem sie sagt, niemand liest ihn.

# Was als "das neue Board" zaehlt. BEWUSST ENG: `dienste.ts` gehoert NICHT
# dazu, obwohl es zum Backend des Boards zaehlt — dort stehen die Dienstnamen
# `mupi_vnc` und `mupi_mqtt`, und ein Suchbegriff "vnc" haette daran getroffen.
# Einen Dienst starten zu koennen ist aber nicht dasselbe wie ihn einstellen
# oder benutzen zu koennen. Genau daran ist der erste Anlauf gescheitert.
BOARD_QUELLEN = (
    "src/frontend-admin/src/",
    "src/backend-api/src/konfiguration.ts",
    "src/backend-api/src/system.ts",
    "src/backend-api/src/protokolle.ts",
)

# ── G3: was der alte PHP-Admin kann ────────────────────────────────────────
#
# Handgepflegt, weil sich die FUNKTION einer PHP-Seite nicht aus ihrem
# Quelltext ableiten laesst. Je Zeile:
#   php      welche Datei(en) im alten Admin
#   funktion was der Benutzer dort tun kann
#   muster   Regeln, an denen ein Gegenstueck im Board erkennbar waere
#   route    Regeln fuer den Endpunkt im Backend (server.ts)
# Trifft kein Muster, aber eine Route, dann gibt es die Faehigkeit — nur
# keinen Weg, sie zu benutzen. Das ist ein eigener Befund, keine Luecke.
PHP_FUNKTIONEN = [
    (["mupi.php"], "Einstellungen als Formular", [r"api/konfiguration"], [r"^post /api/konfiguration$"]),
    (["mupi.php"], "Anmeldung ein/aus und Passwort setzen", [r"interfacelogin|passwort"], [r"konfiguration/passwort"]),
    (["tweaks.php"], "CPU-Regler, Auslagerung, aufs Netz warten", [r"api/schrauben"], [r"schrauben"]),
    (["tweaks.php", "mupi.php"], "config.txt-Schrauben: SD-Uebertaktung, Initial Turbo, Warnungen aus", [r"initial_turbo|over_voltage|avoid_warnings"], [r"initial_turbo"]),
    (["mupi.php"], "Bildschirm DREHEN (HDMI/LCD-Rotation)", [r"drehung setzen|rotation setzen|hdmi_rotate"], [r"drehung/setzen"]),
    (["mupi.php"], "Bildschirmaufloesung resX/resY", [r"resX|resY"], [r"aufloesung"]),
    (["mupi.php"], "Hintergrundbild und Helligkeit", [r"[Hh]intergrundbild|[Hh]elligkeit|backlight"], [r"helligkeit|backlight"]),
    (["mupi.php"], "Tonausgabe/Soundkarte waehlen", [r"api/ton"], [r"^post /api/ton$"]),
    (["service.php"], "Dienste starten/stoppen", [r"api/dienste"], [r"dienste"]),
    (["network.php"], "Netzwerk und WLAN", [r"api/netzwerk"], [r"netzwerk"]),
    (["bluetooth.php"], "Bluetooth koppeln", [r"api/bluetooth"], [r"bluetooth"]),
    (["media.php"], "Medien ANZEIGEN", [r"api/medien"], [r"medien"]),
    (["mupihat.php"], "MuPiHAT-Werte", [r"api/mupihat"], [r"mupihat"]),
    (["logviewer.php", "pm2logs.php", "backend.php"], "Protokolle und Dienst-Monitor", [r"api/protokolle"], [r"protokolle"]),
    (["index.php"], "Uebersicht und Version", [r"api/system|api/version"], [r"^get /api/system$"]),
    (["jellyfin.php"], "Jellyfin-Server eintragen", [r"jellyfinServer"], [r"jellyfin"]),
    (["spotify.php"], "Spotify Client-ID und Verbindungsstatus", [r"spotifyClientId|api/spotify/config"], [r"spotify/config|spotify/bereit"]),
    (["spotify.php"], "Spotify: Zwischenspeicher leeren / ALLE DATEN zuruecksetzen", [r"[Zz]wischenspeicher leeren|cache leeren"], [r"spotify.*(cache|reset|zuruecksetzen)"]),
    (["cover.php"], "Cover-Bild HOCHLADEN (Datei vom PC)", [r"FormData|type=[\"']file[\"']|multer|multipart"], [r"upload|cover"]),
    (["smart.php"], "MQTT einstellen (Broker, Topic, Zugang, Home Assistant)", [r"mqtt\.(broker|topic|clientId)|MQTT-Broker"], [r"mqtt"]),
    (["smart.php"], "Telegram einstellen (Token, ChatID)", [r"telegram\.(token|chatId)|Telegram-Token"], [r"^post /api/telegram/(?!screen)"]),
    (["smart.php"], "WLED einstellen (Presets, Helligkeit, Com-Port)", [r"wled"], [r"wled"]),
    (["backup.php", "fullbackup.php"], "Sicherung als ZIP herunterladen (Konfiguration bzw. alles)", [r"config_backup|full_backup|Sicherung herunterladen"], [r"backup|sicherung"]),
    (["support_data.php"], "Support-Paket herunterladen (geschwaerzt)", [r"support_data|Support-Paket"], [r"support"]),
    (["debug.php"], "Chromium-Protokoll herunterladen", [r"chrome_debug"], [r"chrome_debug"]),
    (["vnc.php"], "VNC: den Bildschirm der Box fernsteuern", [r"vnc"], [r"vnc"]),
    (["content.php"], "Die Box-Oberflaeche im Rahmen mitsehen und bedienen", [r"<iframe"], [r"oberflaeche/stand"]),
    (["jsoneditor.php"], "JSON-Editor: 7 Dateien frei bearbeiten", [r"[Rr]oheditor|jsoneditor"], [r"roh|jsoneditor"]),
    (["admin.php"], "RRD-Diagramme (Last, Netz, Temperatur)", [r"\brrd\b"], [r"rrd"]),
    (["admin.php"], "Bildschirmfoto der Box (scrot)", [r"scrot"], [r"scrot|telegram/screen"]),
    (["update_batteryicon.php", "update_fanicon.php", "update_wifiicon.php", "update_mupihattable.php"], "Statussymbole nachladen (Akku, Luefter, WLAN)", [r"akkustand|api/mupihat"], [r"akku|mupihat"]),
    (["logout.php"], "Abmelden", [r"[Aa]bmelden"], [r"abmeld|logout"]),
    (["index.php", "admin.php"], "Update einspielen (Knopf gegen den Upstream)", [r"aktualisierung einspielen|einspielen\(\)"], [r"aktualisierung/einspielen"]),
    ([], "Kiosk/Oberflaeche neu laden", [r"oberflaeche/neuladen"], [r"oberflaeche/neuladen"]),
]

# Was das Board ABSEITS der Feldtabelle bedient. Ohne diese Liste erschienen
# Schluessel als Luecke, die sehr wohl einstellbar sind — nur eben nicht auf
# der Konfigurationsseite.
BOARD_SONSTWO = {
    "interfacelogin.password": "Konfiguration → Passwort setzen (POST /api/konfiguration/passwort)",
    "mupibox.einstellungsPin": "Konfiguration → PIN setzen (POST /api/konfiguration/einstellungs-pin)",
    "mupibox.version": "Aktualisierung (nur ANZEIGE, server.ts:2035)",
    "mupibox.installedThemes": "Auswahlquelle des Feldes „Farbthema\"",
    # TOT SEIT 04.08.2026, aber weiter in der Konfiguration jeder Box: Google
    # TTS ist abgeloest (Piper), das Feld „Sprache beim Vorlesen" ist entfallen.
    # Die Schluessel bleiben stehen — sie herauszunehmen waere ein Datenumzug
    # auf fremden Geraeten fuer null Gewinn. Sie stehen hier, damit sie in der
    # Inventur nicht als LUECKE erscheinen: sie sind kein Versaeumnis, sondern
    # bewusst inaktiv. Vollstaendige Begruendung in konfiguration.ts.
    "mupibox.googlettslanguages": "TOT (Google-TTS abgeloest 04.08.2026) — Stimme jetzt unter Verwaltung → Vorlesen",
    "mupibox.ttsLanguage": "TOT (Google-TTS abgeloest 04.08.2026) — Stimme jetzt unter Verwaltung → Vorlesen",
    "mupihat.battery_types": "MuPiHAT-Seite (akkustand.ts:69)",
}


# ── Konfiguration beschaffen ───────────────────────────────────────────────


def konfig_von_box(host: str) -> dict:
    """Holt die Konfiguration LESEND von der Box. Schreibt dort nichts."""
    try:
        roh = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, f"cat {BOX_PFAD}"],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        sys.exit(f"Box {host} nicht erreichbar ({e}). Alternative: --datei <auszug.json>")
    return json.loads(roh)


def schluessel_sammeln(o, praefix="") -> list:
    """Alle Pfade als (pfad, art). Listen zaehlen als EIN Eintrag mit Laenge."""
    raus = []
    if isinstance(o, dict):
        for k, v in o.items():
            raus += schluessel_sammeln(v, f"{praefix}.{k}" if praefix else k)
    elif isinstance(o, list):
        raus.append((praefix, f"Liste[{len(o)}]"))
    else:
        raus.append((praefix, {"bool": "Schalter", "int": "Zahl", "float": "Zahl", "str": "Text"}.get(type(o).__name__, type(o).__name__)))
    return raus


# ── Die Feldtabelle des Boards lesen ───────────────────────────────────────


def felder_lesen() -> list:
    """
    Zieht id + pfad aus der FELDER-Tabelle in konfiguration.ts.

    FALLE, in die der erste Anlauf lief: zwischen `id:` und `pfad:` steht bei
    `spotifyCacheStufe` ein Kommentar. Ein Muster, das beide direkt
    hintereinander erwartet, verliert dieses eine Feld STILL — und der
    zugehoerige Box-Schluessel erscheint faelschlich als Luecke. Deshalb wird
    der Block in Eintraege zerlegt und je Eintrag einzeln gesucht.
    """
    text = open(KONFIG_TS, encoding="utf-8").read()
    block = text[text.index("export const FELDER"):]
    felder = []
    for eintrag in re.split(r"\n  \{", block):
        k = re.search(r"\bid:\s*'([^']+)'", eintrag)
        p = re.search(r"\bpfad:\s*\[([^\]]+)\]", eintrag)
        if not (k and p):
            continue
        teile = [t.strip().strip("'\"") for t in p.group(1).split(",")]
        felder.append((k.group(1), ".".join(teile)))
    return felder


# ── Leser suchen ───────────────────────────────────────────────────────────


def dateien_sammeln() -> list:
    """Alle vom git verwalteten Textdateien, ohne die ausgeschlossenen."""
    liste = subprocess.run(
        ["git", "-C", WURZEL, "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    raus = []
    for p in liste:
        if any(p.startswith(a) or f"/{a}" in p or p == a for a in AUSGESCHLOSSEN):
            continue
        if not p.endswith(DURCHSUCHTE_ENDUNGEN):
            continue
        raus.append(p)
    return raus


def inhalte_laden(dateien: list) -> dict:
    inhalt = {}
    for p in dateien:
        try:
            inhalt[p] = open(os.path.join(WURZEL, p), encoding="utf-8", errors="replace").read()
        except OSError:
            pass
    return inhalt


def leser_suchen(pfad: str, inhalt: dict) -> tuple:
    """
    Sucht die Leser eines Schluessels. Gibt (starke, schwache) zurueck.

    STARK  = eine Pfadform trifft (.gruppe.blatt, ['gruppe']['blatt'], …).
             Das ist ein echter Zugriff auf genau diesen Schluessel.
    SCHWACH = nur der Blattname trifft, und die Gruppe kommt in derselben
             Datei vor. Muss von Hand nachgesehen werden.
    """
    teile = pfad.split(".")
    blatt = teile[-1]
    gruppe = teile[0] if len(teile) > 1 else None

    muster = [re.escape(pfad)]  # .mqtt.active (jq), config.mqtt.active (JS)
    if gruppe:
        for auf, zu in (("'", "'"), ('"', '"')):
            muster.append(rf"\[{auf}{re.escape(gruppe)}{zu}\]\s*\[{auf}{re.escape(blatt)}{zu}\]")
        muster.append(rf"{re.escape(gruppe)}\?\.\s*{re.escape(blatt)}")
        muster.append(rf"{re.escape(gruppe)}\[{re.escape(blatt)}\]")
    else:
        muster.append(rf"\[['\"]{re.escape(blatt)}['\"]\]")
        muster.append(rf"\.{re.escape(blatt)}\b")

    regex = re.compile("|".join(muster))
    blatt_regex = re.compile(rf"['\"\.\[]{re.escape(blatt)}\b")

    stark, schwach, vorlage = [], [], []
    for datei, text in inhalt.items():
        if blatt not in text or datei in NICHT_LESER:
            continue
        if datei.startswith(NUR_VORLAGE):
            if regex.search(text) or blatt_regex.search(text):
                vorlage.append(datei)
            continue
        if regex.search(text):
            stark.append(datei)
        elif blatt_regex.search(text) and (gruppe is None or gruppe in text):
            schwach.append(datei)
    return sorted(stark), sorted(schwach), sorted(vorlage)


# ── G2 ─────────────────────────────────────────────────────────────────────


def g2(konfig: dict, inhalt: dict, markdown: bool) -> None:
    schluessel = schluessel_sammeln(konfig)
    felder = felder_lesen()
    nach_pfad = {p: k for k, p in felder}
    box_pfade = {p for p, _ in schluessel}

    gedeckt, offen = [], []
    for pfad, art in schluessel:
        if pfad in nach_pfad:
            gedeckt.append((pfad, art, f"Feld `{nach_pfad[pfad]}`"))
        elif pfad in BOARD_SONSTWO:
            gedeckt.append((pfad, art, BOARD_SONSTWO[pfad]))
        else:
            stark, schwach, vorlage = leser_suchen(pfad, inhalt)
            offen.append((pfad, art, stark, schwach, vorlage))

    ins_leere = [(k, p) for k, p in felder if p not in box_pfade]

    print(f"\n## G2 — Deckungsluecke ({len(schluessel)} Schluessel auf der Box, "
          f"{len(felder)} Felder im Board)\n")
    print(f"  gedeckt:    {len(gedeckt)}")
    print(f"  ungedeckt:  {len(offen)}")
    print(f"  ins Leere zeigende Felder: {len(ins_leere)}")
    if ins_leere:
        for k, p in ins_leere:
            print(f"      Feld `{k}` → `{p}` (auf der Box nicht vorhanden)")
    print()

    ohne_leser = [z for z in offen if not z[2] and not z[3]]
    print(f"  davon ohne JEDEN Leser: {len(ohne_leser)}\n")

    if markdown:
        print("| Schluessel | Art | Leser im Baum | Einschaetzung |")
        print("|---|---|---|---|")
        for pfad, art, stark, schwach, vorlage in offen:
            if stark:
                leser = ", ".join(f"`{d}`" for d in stark[:3])
                if len(stark) > 3:
                    leser += f" (+{len(stark) - 3})"
            elif schwach:
                leser = "*(schwach)* " + ", ".join(f"`{d}`" for d in schwach[:2])
            else:
                leser = "**keiner**" + (" (nur Vorlage)" if vorlage else "")
            print(f"| `{pfad}` | {art} | {leser} | |")
    else:
        for pfad, art, stark, schwach, vorlage in offen:
            print(f"  {pfad:42s} {art:12s} stark={len(stark):2d} schwach={len(schwach):2d} vorlage={len(vorlage):2d}")
            for d in stark:
                print(f"      + {d}")
            for d in schwach:
                print(f"      ? {d}")


# ── G3 ─────────────────────────────────────────────────────────────────────


def routen_lesen(inhalt: dict) -> list:
    """Alle Express-Routen aus server.ts als 'methode /pfad'."""
    text = inhalt.get("src/backend-api/src/server.ts", "")
    return sorted({
        f"{m.group(1)} {m.group(2)}"
        for m in re.finditer(r"app\.(get|post|put|delete)\('([^']+)'", text)
    })


def ohne_kommentare(text: str) -> str:
    """
    Kommentare wegwerfen, bevor im Board gesucht wird.

    FALLE, die zwei Anlaeufe gekostet hat: `konfiguration.ts` begruendet im
    Kopfkommentar, warum es fuer `resX`/`resY` ABSICHTLICH kein Feld gibt, und
    nennt `jsoneditor.php` als abgeloest. Eine Suche ueber den rohen Text
    findet genau diese Woerter — und meldet die fehlende Funktion als
    vorhanden. Ein Kommentar ist kein Bedienelement.
    """
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"^\s*(//|\*|#).*$", " ", text, flags=re.M)


def g3(inhalt: dict, markdown: bool) -> None:
    """Prueft je PHP-Funktion, ob es im NEUEN Board ein Gegenstueck gibt."""
    board = {p: ohne_kommentare(t) for p, t in inhalt.items()
             if p.startswith(BOARD_QUELLEN) and not p.endswith(".spec.ts")}
    routen = routen_lesen(inhalt)

    zeilen = []
    for dateien, funktion, muster, routenmuster in PHP_FUNKTIONEN:
        im_board = []
        for m in muster:
            r = re.compile(m)
            for p, t in sorted(board.items()):
                if r.search(t):
                    im_board.append(p)
                    break
        im_backend = [route for m in routenmuster for route in routen if re.search(m, route)]
        if im_board:
            stand = "im Board"
        elif im_backend:
            stand = "nur Endpunkt"
        else:
            stand = "FEHLT"
        zeilen.append((dateien, funktion, stand, im_board, im_backend))

    fehlt = sum(1 for z in zeilen if z[2] == "FEHLT")
    nur = sum(1 for z in zeilen if z[2] == "nur Endpunkt")
    print(f"\n## G3 — Funktionsluecke ({len(zeilen)} Funktionen geprueft, "
          f"{fehlt} fehlen, {nur} nur als Endpunkt)\n")

    if markdown:
        print("| Funktion | alte PHP-Seite | im neuen Board | Einschaetzung |")
        print("|---|---|---|---|")
        for dateien, funktion, stand, im_board, im_backend in zeilen:
            alt = ", ".join(f"`{d}`" for d in dateien) or "—"
            if stand == "im Board":
                wo = ", ".join(f"`{p.split('/')[-1]}`" for p in dict.fromkeys(im_board))
            elif stand == "nur Endpunkt":
                wo = "**nur Endpunkt** — " + ", ".join(f"`{r}`" for r in dict.fromkeys(im_backend))
            else:
                wo = "**fehlt**"
            print(f"| {funktion} | {alt} | {wo} | |")
    else:
        for dateien, funktion, stand, im_board, im_backend in zeilen:
            print(f"  [{stand:12s}] {funktion}")
            print(f"                 alt: {', '.join(dateien) or '—'}")
            for p in dict.fromkeys(im_board):
                print(f"                 + {p}")
            for r in dict.fromkeys(im_backend):
                print(f"                 → {r}")


def main() -> None:
    p = argparse.ArgumentParser(description="Deckungs- und Funktionsabgleich altes PHP-Admin ↔ neues Board")
    p.add_argument("--datei", help="Konfiguration aus einer Datei statt per ssh von der Box")
    p.add_argument("--host", default=BOX_STANDARD, help=f"ssh-Ziel (Standard: {BOX_STANDARD})")
    p.add_argument("--g2", action="store_true", help="nur die Deckungsluecke")
    p.add_argument("--g3", action="store_true", help="nur die Funktionsluecke")
    p.add_argument("--markdown", action="store_true", help="Tabellen fuer BACKLOG.md")
    a = p.parse_args()

    beides = not (a.g2 or a.g3)
    inhalt = inhalte_laden(dateien_sammeln())

    if a.g2 or beides:
        konfig = json.load(open(a.datei, encoding="utf-8")) if a.datei else konfig_von_box(a.host)
        g2(konfig, inhalt, a.markdown)
    if a.g3 or beides:
        g3(inhalt, a.markdown)


if __name__ == "__main__":
    main()
