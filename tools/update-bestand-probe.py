#!/usr/bin/env python3
"""
UEBERLEBT DER BESTAND DAS UPDATE? — im Sandkasten durchgespielt, nicht geglaubt.

WOFUER DIESES WERKZEUG:
`update/start_mupibox_update.sh` raeumt das ganze Verzeichnis
`Sonos-Kids-Controller-master` mit `rm -R` weg und packt es aus deploy.zip neu
aus. Fuer den CODE ist das richtig: ein Angular-Bau schreibt `chunk-<hash>.js`,
und ein blosses Ueberkopieren liesse die Bruchstuecke des Vorgaengers liegen
(nachgemessen: die Hashes in bin/nodejs/deploy.zip und die an der Box sind
verschieden). Fuer die DATEN war es toedlich — darunter liegt `server/config`.

Bis zum 07.08.2026 wurden drei Dinge davor gerettet, namentlich aufgezaehlt.
An der laufenden Box gezaehlt: 20 Eintraege in `server/config`, 19 waeren
gefallen — darunter `profile.json` (die KINDER SELBST) und `profile/<kennung>/`
mit Weiterhoeren, Verlauf, eigenen Listen, Hoerzeit und Medienauswahl je Kind.
Und EINE der drei Rettungen griff ins Leere: `www/cover` gibt es dort nicht
mehr, die 434 Titelbilder liegen unter `server/config/coverspeicher`, also
INNERHALB des geloeschten Verzeichnisses.

DAS IST DAS MUSTER, GEGEN DAS DIESES WERKZEUG GEBAUT IST. Eine von Hand
gepflegte Liste laeuft auseinander — hier zweimal, unbemerkt, jahrelang. Das
Skript zaehlt deshalb nicht mehr auf, WAS gerettet wird; es legt `server/config`
im Ganzen beiseite. Aufzuzaehlen bleibt nur, was AUSSERHALB davon liegt und
trotzdem der Box gehoert. Und genau diese eine Liste misst das Werkzeug hier
gegen den Quelltext nach — dasselbe Netz wie
`tools/bereich-sicherung-deckung.py` fuer die Sicherung.

WAS ES TUT — drei Proben, alle unter /tmp, NIE an der Box:

  1. DURCHSPIELEN. Es baut einen Sandkasten, der den Baum der Box nachstellt
     (samt Symlinks und Bereichsordnern je Kind), fuehrt die MARKIERTEN BLOECKE
     AUS DEM ECHTEN SKRIPT aus — nicht eine Nacherzaehlung davon — und zaehlt
     danach nach, was noch da ist.

  2. STROMAUSFALL. Derselbe Lauf, aber an JEDEM Befehlsuebergang abgebrochen
     (DEBUG-Falle mit `functrace`). Nach jedem Abbruch zwei Fragen: liegt der
     Bestand noch irgendwo vollstaendig? Und holt ein zweiter Lauf ihn zurueck?
     WARUM AM BEFEHLSUEBERGANG UND NICHT MITTENDRIN: Beiseitelegen und
     Zurueckstellen sind je ein `mv` innerhalb derselben Platte, also
     rename(2) — unteilbar. Es GIBT kein Mittendrin. Dass die Probe an
     Befehlsgrenzen schneidet, ist keine Vereinfachung, sondern genau die
     Behauptung, die sie prueft.

  3. DECKUNG. Es liest aus dem Quelltext zusammen, wo die Box ueberhaupt
     hinschreibt (`mupibox-sicherung.py`, `profile.ts`, `server.ts`, die
     Skripte, das alte PHP-Menue), zieht ab, was deploy.zip ohnehin
     mitbringt, und fragt zu jedem Rest: liegt er unter `server/config` (dann
     ist er automatisch dabei) oder steht er in `MUPI_BESTAND_AUSSEN`?
     WAS WEDER NOCH IST, MACHT DIESES WERKZEUG ROT. Genau dafuer ist es da:
     entsteht morgen eine neue Ablage neben `server/config`, faellt das hier
     auf und nicht erst an einer Box, an der ein Kind sitzt.

ES FASST DIE BOX NICHT AN und schreibt nur in sein eigenes Sandkastenverzeichnis
unter /tmp. Das Update-Skript wird gelesen, nie veraendert.

DASS DIE PROBEN UMSCHLAGEN KOENNEN, IST NACHGEWIESEN — an Kopien des Skripts
unter /tmp, ueber `--skript` (07.08.2026):
  * alte Rettung (die drei Dateien) wieder eingebaut  -> Probe 1 rot,
    455 von 471 Eintraegen weg, darunter jedes coverspeicher/-Bild und jeder
    Bereichsordner.
  * Hort ins Fluechtige gelegt, wie es /tmp war       -> Probe 2 rot an 35 von
    59 Abbruchstellen. Das ist genau der Bereich zwischen Beiseitelegen und
    Zurueckstellen; es ist der Beweis, dass die Wahl des Ortes das Tragende ist
    und nicht die Reihenfolge der Befehle.
  * `www/active_theme.css` aus MUPI_BESTAND_AUSSEN gestrichen -> Probe 3 rot,
    mit dem Hinweis, wo im Quelltext der Pfad steht.
Diese Gegenproben haben zwei echte Fehler gefunden, bevor irgendetwas eine Box
erreicht hat: `[ -e ]` sah den toten Verweis `active_theme.css` nicht (und
haette ihn fallen lassen), und die Deckungsprobe hielt alles unter `www/` fuer
Bauergebnis, weil deploy.zip den ORDNER `www/` enthaelt. Beide sind im Code
vermerkt, wo sie sassen.

AUFRUF
    python3 tools/update-bestand-probe.py
    python3 tools/update-bestand-probe.py --json
    python3 tools/update-bestand-probe.py --ohne-stromausfall   (schneller)
    python3 tools/update-bestand-probe.py --behalten            (Sandkasten stehen lassen)

ENDE 0, wenn alle drei Proben durchgehen. ENDE 1 sonst.
"""

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKRIPT = os.path.join(WURZEL, "update/start_mupibox_update.sh")
SICHERUNG = os.path.join(WURZEL, "scripts/mupibox/mupibox-sicherung.py")
PROFILE_TS = os.path.join(WURZEL, "src/backend-api/src/profile.ts")
SERVER_TS = os.path.join(WURZEL, "src/backend-api/src/server.ts")
DEPLOY_ZIP = os.path.join(WURZEL, "bin/nodejs/deploy.zip")

# So heisst der Baum im Skript. Nur zum Wiedererkennen von Pfadangaben in
# fremden Dateien (Skripte, PHP) — der Sandkasten liegt woanders.
BAUM_NAME = "Sonos-Kids-Controller-master"

# ── WAS IM BAUM LIEGT, ABER ABSICHTLICH NICHT GERETTET WIRD ────────────────
# Eine Ausnahme braucht einen Grund, und der steht hier. Was NICHT hier steht
# und nicht unter server/config liegt, macht die Deckungsprobe rot — die
# Vorgabe ist also "gerettet", und Weglassen ist der bewusste Schritt.
NICHT_RETTEN = {
    "cache": (
        "Librespot-Zwischenspeicher. Das alte PHP-Menue leert ihn selbst "
        "(AdminInterface/www/spotify.php: `rm -r .../cache/*`), er wird beim "
        "naechsten Abspielen neu gefuellt. Nichts geht verloren."
    ),
    "node_modules": (
        "Abhaengigkeiten. Das Update laesst danach `npm install` laufen; "
        "mitschleppen brachte alte und neue Pakete durcheinander."
    ),
    "www/theme-data": (
        "Schriften und Hintergruende der Farbthemen. Das Update legt sie in "
        "jedem Lauf frisch aus ${MUPI_SRC}/themes/ an."
    ),
    "www/mupi.png": (
        "Verweis auf /var/www/images/mupif.png, den das Update neu setzt."
    ),
    "www/neu": (
        "Bauergebnis der neuen Oberflaeche (NewDesign/ wandert beim Bau nach "
        "www/neu). Kommt mit deploy.zip."
    ),
}


# ══ TEIL 1: WAS DAS SKRIPT SAGT ════════════════════════════════════════════

def skript_bloecke(pfad: str = SKRIPT) -> dict[str, str]:
    """
    Die markierten Bloecke aus dem echten Update-Skript.

    AM QUELLTEXT GELESEN, NICHT ABGESCHRIEBEN. Eine Kopie hier waere die zweite
    Wahrheit, und dieses Werkzeug gaebe dann gruenes Licht fuer Code, den es
    sich selbst ausgedacht hat.
    """
    quelle = open(pfad, encoding="utf-8").read()
    bloecke = {}
    for name in ("WERKZEUG", "WIEDERAUFNAHME", "BEISEITE", "TAUSCH"):
        muster = (rf"^# >>> MUPI-BESTAND-{name}-ANFANG >>>\n(.*?)"
                  rf"^# <<< MUPI-BESTAND-{name}-ENDE <<<")
        treffer = re.search(muster, quelle, re.S | re.M)
        if not treffer:
            raise SystemExit(
                f"{pfad}: Block MUPI-BESTAND-{name} nicht gefunden. Hat jemand "
                "die Marken umbenannt? Dann misst dieses Werkzeug nichts mehr.")
        bloecke[name] = treffer.group(1)
    return bloecke


def bestand_aussen(bloecke: dict[str, str]) -> list[str]:
    """Die Liste dessen, was ausserhalb server/config gerettet wird."""
    treffer = re.search(r"MUPI_BESTAND_AUSSEN=\(([^)]*)\)", bloecke["WERKZEUG"])
    if not treffer:
        raise SystemExit("MUPI_BESTAND_AUSSEN nicht gefunden")
    return re.findall(r'"([^"]+)"', treffer.group(1))


# ══ TEIL 2: WO DIE BOX HINSCHREIBT ═════════════════════════════════════════

def bereichs_ablagen() -> tuple[str, list[str]]:
    """Ordnername und Dateinamen je Kind — aus profile.ts, wie die Sicherung."""
    quelle = open(PROFILE_TS, encoding="utf-8").read()
    ordner = re.search(r"export const BEREICH_ORDNER = '([^']+)'", quelle)
    liste = re.search(r"export const BEREICH_ABLAGEN = \[([^\]]*)\]", quelle)
    if not ordner or not liste:
        raise SystemExit("profile.ts: BEREICH_ORDNER/BEREICH_ABLAGEN fehlen")
    namen = []
    for teil in liste.group(1).split(","):
        teil = teil.strip()
        if not teil:
            continue
        wert = re.search(rf"export const {re.escape(teil)} = '([^']+)'", quelle)
        if not wert:
            raise SystemExit(f"profile.ts: zu {teil} steht kein Dateiname da")
        namen.append(wert.group(1))
    return ordner.group(1), namen


def sicherungs_muster() -> list[str]:
    """
    Was die Sicherung unter server/config fuer schuetzenswert haelt.

    DIE BOX FUEHRT DIESE LISTE SCHON. Sie hier noch einmal zu tippen hiesse,
    dieselbe Drift ein drittes Mal einzubauen.
    """
    import ast
    quelle = open(SICHERUNG, encoding="utf-8").read()
    for knoten in ast.parse(quelle).body:
        if not isinstance(knoten, ast.Assign):
            continue
        if "HINEIN" not in [z.id for z in knoten.targets if isinstance(z, ast.Name)]:
            continue
        return list(ast.literal_eval(knoten.value).get("server/config", []))
    raise SystemExit(f"{SICHERUNG}: HINEIN['server/config'] nicht gefunden")


def cover_speicher() -> str | None:
    """Wo die Titelbilder liegen — aus server.ts, nicht aus dem Gedaechtnis."""
    quelle = open(SERVER_TS, encoding="utf-8").read()
    t = re.search(r"COVER_SPEICHER\s*=[^\n]*?\$\{configBasePath\}/([A-Za-z0-9_.-]+)", quelle)
    return t.group(1) if t else None


def schreibstellen_im_baum() -> dict[str, list[str]]:
    """
    Jeder Pfad IM Baum, den irgendeine Quelle im Repo namentlich nennt.

    Zwei Fundarten, beide absichtlich grob — lieber ein Fund zuviel, den man
    einmal begruendet, als eine Ablage, die niemand gesehen hat:
      * `path.join(wwwDir, '<name>')` im Backend (der www-Wurzel angehaengt),
      * `Sonos-Kids-Controller-master/<pfad>` woertlich in Skripten, Werkzeugen
        und dem alten PHP-Menue.
    """
    funde: dict[str, list[str]] = {}

    def merken(pfad: str, wo: str) -> None:
        pfad = pfad.strip("/")
        if pfad:
            funde.setdefault(pfad, []).append(wo)

    for datei in sorted(os.listdir(os.path.dirname(SERVER_TS))):
        if not datei.endswith(".ts") or ".spec." in datei:
            continue
        voll = os.path.join(os.path.dirname(SERVER_TS), datei)
        quelle = open(voll, encoding="utf-8").read()
        for name in re.findall(r"wwwDir\s*,\s*'([^']+)'", quelle):
            merken(f"www/{name}", f"src/backend-api/src/{datei}")
        for name in re.findall(r"wwwDir\}/([A-Za-z0-9_.-]+)", quelle):
            merken(f"www/{name}", f"src/backend-api/src/{datei}")

    for ordner in ("scripts", "tools", "AdminInterface", "update", "autosetup"):
        wurzel = os.path.join(WURZEL, ordner)
        if not os.path.isdir(wurzel):
            continue
        for hier, unter, dateien in os.walk(wurzel):
            # UEBERSETZTES NICHT LESEN. `__pycache__/*.pyc` enthaelt dieselben
            # Pfade wie die Quelle, aber mit Bytemuell direkt dahinter — daraus
            # wurden Namen wie `data.jsonNr-`. Ein Fund, der nur so aussieht wie
            # ein Pfad, macht das Werkzeug unglaubwuerdig.
            unter[:] = [u for u in unter if u not in ("node_modules", "__pycache__", ".git")]
            for d in dateien:
                if d.endswith((".pyc", ".zip", ".png", ".jpg", ".otf", ".ttf", ".gz")):
                    continue
                voll = os.path.join(hier, d)
                try:
                    quelle = open(voll, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                for pfad in re.findall(rf"{BAUM_NAME}/([A-Za-z0-9_./*-]*)", quelle):
                    # Platzhalter und Endschraegstriche abschneiden: uns
                    # interessiert der Ort, nicht der einzelne Treffer.
                    pfad = pfad.split("*")[0].rstrip("/")
                    merken(pfad, os.path.relpath(voll, WURZEL))
    return funde


def bauzeug() -> set[str]:
    """Was deploy.zip mitbringt — das darf und soll ersetzt werden."""
    if not os.path.exists(DEPLOY_ZIP):
        raise SystemExit(f"{DEPLOY_ZIP} fehlt — ohne sie ist nicht zu sagen, "
                         "was Bauergebnis ist und was Bestand.")
    with zipfile.ZipFile(DEPLOY_ZIP) as z:
        return {n.rstrip("/") for n in z.namelist() if n.strip("/")}


# ══ TEIL 3: DER SANDKASTEN ═════════════════════════════════════════════════

# So sah der Baum an der Box am 07.08.2026 aus (nur lesend nachgesehen). Die
# Namen unter server/config kommen NICHT von hier, sondern aus dem Quelltext —
# hier stehen nur die Formen, die man sonst nirgends ablesen kann.
KINDER = ["gast", "kalea", "probe"]
COVER_ANZAHL = 434
ALTE_CHUNKS = ["chunk-ALT0001.js", "chunk-ALT0002.js", "main-ALT0003.js"]
# Zwei Verweise, die es an der Box wirklich gibt. Sie stehen hier, weil die
# ALTE Rettung sie zerstoert haette: `mv data.json` liess active_data.json als
# toten Verweis zurueck, und resume.json zeigt in einen Bereichsordner, den es
# nach dem Update nicht mehr gab.
VERWEISE = {
    "active_data.json": "data.json",
    "active_resume.json": "resume.json",
    "resume.json": "profile/kalea/resume.json",
}


def muster_zu_namen(muster: str) -> str:
    """`gespielt.*.json` -> `gespielt.probe.json`; `profile/*/x` -> `profile/probe/x`."""
    return muster.replace("*", "probe")


def sandkasten_bauen(ort: str) -> dict:
    """Baut den Baum nach, wie er an der Box steht. Gibt zurueck, was drin ist."""
    baum = os.path.join(ort, "baum")
    konfig = os.path.join(baum, "server", "config")
    os.makedirs(konfig, exist_ok=True)

    ordner, ablagen = bereichs_ablagen()
    muster = sicherungs_muster()
    speicher = cover_speicher()

    bestand: set[str] = set()

    def datei(rel: str, inhalt: str = "alt") -> None:
        voll = os.path.join(baum, rel)
        os.makedirs(os.path.dirname(voll), exist_ok=True)
        with open(voll, "w", encoding="utf-8") as f:
            f.write(inhalt)
        bestand.add(rel)

    # a) Alles, was die Sicherung unter server/config kennt.
    for m in muster:
        datei(f"server/config/{muster_zu_namen(m)}", f"inhalt-{m}")
    # b) Der Bereich JE KIND — die Form, die am 07.08. dazukam.
    for kind in KINDER:
        for ablage in ablagen:
            datei(f"server/config/{ordner}/{kind}/{ablage}", f"{kind}-{ablage}")
    # c) Die Titelbilder, dort wo sie wirklich liegen.
    if speicher:
        for i in range(COVER_ANZAHL):
            datei(f"server/config/{speicher}/{i:04d}", "bild")
    # d) Dinge, die die Box zusaetzlich fuehrt und die keine Liste nennt.
    for name in ("data.json.bak", "akkuverlauf.json", "verfuegbarkeit.json",
                 "offline_data.json", "offline_resume.json", "network.json",
                 "vorlesen.json", "verschmelzung.json", "profile.json",
                 "wlan.json", "monitor.json", "config.json"):
        datei(f"server/config/{name}", f"inhalt-{name}")
    # e) Die Verweise.
    for name, ziel in VERWEISE.items():
        voll = os.path.join(konfig, name)
        if os.path.lexists(voll):
            os.remove(voll)
        os.symlink(ziel, voll)
        bestand.add(f"server/config/{name}")
    # f) Ausserhalb von server/config: die Wahl des Farbthemas.
    os.makedirs(os.path.join(baum, "www"), exist_ok=True)
    os.symlink("themes/unicorn.css", os.path.join(baum, "www", "active_theme.css"))
    bestand.add("www/active_theme.css")
    # g) Und der ALTE Bau, der weg muss.
    for chunk in ALTE_CHUNKS:
        voll = os.path.join(baum, "www", chunk)
        with open(voll, "w", encoding="utf-8") as f:
            f.write("alter bau")
    os.makedirs(os.path.join(baum, "node_modules", "irgendwas"), exist_ok=True)

    # Der frische Stand, den das Update auspackt.
    quelle = os.path.join(ort, "quelle")
    os.makedirs(os.path.join(quelle, "bin", "nodejs"), exist_ok=True)
    os.makedirs(os.path.join(quelle, "config", "templates"), exist_ok=True)
    for name in ("monitor.json", "www.json"):
        with open(os.path.join(quelle, "config", "templates", name), "w") as f:
            f.write('{"aus":"vorlage"}')
    with zipfile.ZipFile(os.path.join(quelle, "bin", "nodejs", "deploy.zip"), "w") as z:
        z.writestr("server.js", "neuer server")
        z.writestr("spotify-control.js", "neu")
        z.writestr("www/index.html", "<html>neu</html>")
        z.writestr("www/chunk-NEU0001.js", "neuer bau")
        z.writestr("www-admin/index.html", "<html>admin</html>")

    return {"baum": baum, "quelle": quelle, "bestand": sorted(bestand),
            "ordner": ordner, "ablagen": ablagen, "speicher": speicher}


def laeufer_schreiben(ort: str, bloecke: dict[str, str], stromaus: int | None) -> str:
    """
    Baut das Skript, das im Sandkasten laeuft — aus den ECHTEN Bloecken.

    Der Kopf setzt nur, was die Bloecke von aussen erwarten. Die
    Stromausfall-Falle zaehlt Befehle und steigt beim n-ten aus; `functrace`
    sorgt dafuer, dass sie auch INNERHALB der Funktionen greift, denn genau
    dort liegen die interessanten Augenblicke.
    """
    fallen = ""
    if stromaus is not None:
        fallen = (
            "set -o functrace\n"
            "MUPI_ZAEHLER=0\n"
            f"MUPI_STROMAUS={stromaus}\n"
            "mupi_stromausfall() {\n"
            "  MUPI_ZAEHLER=$((MUPI_ZAEHLER+1))\n"
            "  if [ \"${MUPI_ZAEHLER}\" -ge \"${MUPI_STROMAUS}\" ]; then exit 137; fi\n"
            "}\n"
            "trap mupi_stromausfall DEBUG\n"
        )
    text = f"""#!/bin/bash
# Von tools/update-bestand-probe.py erzeugt. Der Inhalt zwischen den Marken
# stammt WOERTLICH aus update/start_mupibox_update.sh.
LOG="{ort}/log"
exec 3>>"${{LOG}}"
MUPI_SRC="{ort}/quelle"
{fallen}
{bloecke['WERKZEUG']}
{bloecke['WIEDERAUFNAHME']}
{bloecke['BEISEITE']}
{bloecke['TAUSCH']}
exit 0
"""
    pfad = os.path.join(ort, "laufen.sh")
    with open(pfad, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(pfad, 0o755)
    return pfad


def laufen(ort: str, laeufer: str) -> int:
    umgebung = dict(os.environ)
    umgebung["MUPI_BAUM"] = os.path.join(ort, "baum")
    umgebung["MUPI_HORT"] = os.path.join(ort, "hort")
    umgebung["MUPI_ABBRUCH"] = os.path.join(ort, "abgebrochen")
    e = subprocess.run(["bash", laeufer], env=umgebung,
                       capture_output=True, text=True)
    return e.returncode


def inhalt_lesen(baum: str, hort: str, rel: str) -> str | None:
    """
    Wo steckt dieser Eintrag — im Baum, im Hort, oder nirgends?

    Der Hort zaehlt mit. Ein Bestand, der nach einem Stromausfall im Hort
    liegt, ist NICHT verloren; er liegt nur an der falschen Stelle, und der
    naechste Lauf holt ihn. Das ist der ganze Unterschied zwischen „mir ist das
    passiert" und „ich muss das Update noch einmal starten".
    """
    for wurzel, vorsatz in ((baum, ""), (hort, "")):
        if wurzel is hort:
            # Im Hort heisst server/config einfach `config`, und was von
            # aussen kommt, traegt den Pfad mit Unterstrichen im Namen.
            if rel.startswith("server/config/"):
                kandidat = os.path.join(hort, "config", rel[len("server/config/"):])
            else:
                kandidat = os.path.join(hort, rel.replace("/", "_"))
        else:
            kandidat = os.path.join(wurzel, rel)
        if os.path.lexists(kandidat):
            if os.path.islink(kandidat):
                return "->" + os.readlink(kandidat)
            try:
                return open(kandidat, encoding="utf-8").read()
            except (IsADirectoryError, OSError):
                return "<ordner>"
        del vorsatz
    return None


# ══ TEIL 4: DIE DREI PROBEN ════════════════════════════════════════════════

def probe_durchspielen(ort: str, bloecke: dict[str, str], welt: dict) -> dict:
    """Ein gewoehnlicher Lauf. Danach: ist alles da, und ist der Code neu?"""
    baum, hort = welt["baum"], os.path.join(ort, "hort")
    vorher = {rel: inhalt_lesen(baum, hort, rel) for rel in welt["bestand"]}
    ende = laufen(ort, laeufer_schreiben(ort, bloecke, None))

    fehlt, verbogen = [], []
    for rel, alt in vorher.items():
        neu = inhalt_lesen(baum, hort, rel)
        if neu is None:
            fehlt.append(rel)
        elif rel in ("server/config/monitor.json", "server/config/config.json"):
            # Diese beiden ersetzt das Update absichtlich aus den Vorlagen.
            continue
        elif neu != alt:
            verbogen.append(rel)

    # Der Code MUSS neu sein — sonst waere die Rettung zwar heil, aber das
    # Update wirkungslos, und die Mischung aus zwei Staenden ist ihr eigener
    # Fehler.
    alt_geblieben = [c for c in ALTE_CHUNKS
                     if os.path.exists(os.path.join(baum, "www", c))]
    neu_da = os.path.exists(os.path.join(baum, "www", "chunk-NEU0001.js"))
    vorlagen_da = all(
        open(os.path.join(baum, "server/config", n), encoding="utf-8").read()
        == '{"aus":"vorlage"}'
        for n in ("monitor.json", "config.json")
        if os.path.exists(os.path.join(baum, "server/config", n)))
    hort_weg = not os.path.exists(hort)

    gut = (ende == 0 and not fehlt and not verbogen and not alt_geblieben
           and neu_da and vorlagen_da and hort_weg)
    return {"gut": gut, "ende": ende, "geprueft": len(vorher),
            "fehlt": fehlt, "verbogen": verbogen,
            "alter_bau_geblieben": alt_geblieben, "neuer_bau_da": neu_da,
            "vorlagen_eingespielt": vorlagen_da, "hort_aufgeraeumt": hort_weg}


def probe_stromausfall(ort_vater: str, bloecke: dict[str, str],
                       bis: int = 400) -> dict:
    """
    Denselben Lauf an JEDEM Befehlsuebergang abbrechen — und zweimal fragen.

    Frage 1: liegt der Bestand nach dem Abbruch noch vollstaendig irgendwo?
    Frage 2: holt ein zweiter, vollstaendiger Lauf ihn in den Baum zurueck?

    Frage 2 ist die eigentliche: ein Update, das man nach einem Stromausfall
    einfach noch einmal startet, ist ein Weg zurueck, den ein Elternteil ohne
    SSH und ohne zweites Geraet gehen kann.
    """
    schlecht, geprueft = [], 0
    n = 1
    while n <= bis:
        ort = os.path.join(ort_vater, f"aus{n:03d}")
        os.makedirs(ort, exist_ok=True)
        welt = sandkasten_bauen(ort)
        baum, hort = welt["baum"], os.path.join(ort, "hort")
        vorher = {rel: inhalt_lesen(baum, hort, rel) for rel in welt["bestand"]}

        ende = laufen(ort, laeufer_schreiben(ort, bloecke, n))
        if ende != 137:
            # Der Lauf war vor dem n-ten Befehl schon fertig — weiter zaehlen
            # bringt nichts mehr.
            shutil.rmtree(ort, ignore_errors=True)
            break
        geprueft += 1

        # Frage 1
        nach_aus = [rel for rel, alt in vorher.items()
                    if inhalt_lesen(baum, hort, rel) is None]
        # Frage 2 — der zweite Lauf, wie ihn ein Mensch starten wuerde.
        ende2 = laufen(ort, laeufer_schreiben(ort, bloecke, None))
        nach_zwei = []
        for rel, alt in vorher.items():
            neu = inhalt_lesen(baum, hort, rel)
            if neu is None:
                nach_zwei.append(rel)
            elif rel.endswith(("/monitor.json", "/config.json")):
                continue
            elif neu != alt:
                nach_zwei.append(f"{rel} (veraendert)")

        if nach_aus or ende2 != 0 or nach_zwei:
            schlecht.append({"stromaus_bei": n, "nach_abbruch_weg": nach_aus[:5],
                             "zweiter_lauf_ende": ende2,
                             "nach_zweitem_lauf_weg": nach_zwei[:5]})
        shutil.rmtree(ort, ignore_errors=True)
        n += 1
    return {"gut": not schlecht, "abbruchstellen": geprueft, "schlecht": schlecht}


def probe_deckung(aussen: list[str]) -> dict:
    """
    Laeuft die Liste auseinander? — die Probe, die es beim letzten Mal nicht gab.

    Jeder Ort, den der Quelltext im Baum nennt, muss in genau eine Schublade:
    unter `server/config` (dann traegt ihn der Umzug automatisch), in
    `MUPI_BESTAND_AUSSEN`, in `NICHT_RETTEN` mit Begruendung, oder er kommt aus
    deploy.zip. Alles andere ist eine Ablage, die beim naechsten Update faellt.
    """
    gebaut = bauzeug()
    offen, eingeordnet = [], []
    for pfad, woher in sorted(schreibstellen_im_baum().items()):
        if pfad.startswith("server/config") or pfad == "server":
            grund = "unter server/config — wandert im Ganzen mit"
        elif any(pfad == a or pfad.startswith(a + "/") for a in aussen):
            grund = "steht in MUPI_BESTAND_AUSSEN"
        elif any(pfad == g or pfad.startswith(g + "/") for g in NICHT_RETTEN):
            treffer = next(g for g in NICHT_RETTEN
                           if pfad == g or pfad.startswith(g + "/"))
            grund = f"NICHT_RETTEN: {NICHT_RETTEN[treffer]}"
        elif pfad in gebaut:
            # NUR DER GENAUE EINTRAG. „Liegt unter einem Ordner, den das Zip
            # anlegt" hat hier zuerst gestanden und war falsch: deploy.zip
            # bringt den Ordner `www/` mit, also galt ALLES unter www/ als
            # Bauergebnis — auch `www/active_theme.css`, das gerade KEINES ist.
            # Damit haette die Deckungsprobe genau die Luecke durchgewunken,
            # gegen die sie gebaut ist. Die Gegenprobe hat es aufgedeckt.
            grund = "kommt aus deploy.zip — Bauergebnis, darf ersetzt werden"
        else:
            offen.append({"pfad": pfad, "genannt_in": sorted(set(woher))[:3]})
            continue
        eingeordnet.append({"pfad": pfad, "grund": grund})
    return {"gut": not offen, "eingeordnet": eingeordnet, "offen": offen,
            "aussen": aussen}


# ══ AUSGABE ════════════════════════════════════════════════════════════════

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    p.add_argument("--json", action="store_true")
    p.add_argument("--ohne-stromausfall", action="store_true",
                   help="nur Durchspielen und Deckung (schnell)")
    p.add_argument("--behalten", action="store_true",
                   help="Sandkasten nicht wegraeumen")
    # NUR FUER DIE GEGENPROBE. Ein Werkzeug, das nie rot werden kann, ist keine
    # Messung, sondern eine Behauptung — und ein gruener Haken, hinter dem
    # nichts steht, ist genau der Grund, warum die alte Rettung jahrelang
    # niemandem auffiel. Damit laesst sich an einer KOPIE des Update-Skripts
    # zeigen, dass die Proben umschlagen: alte Rettung wieder einbauen ->
    # Probe 1 rot; Wiederaufnahme entfernen -> Probe 2 rot; einen Eintrag aus
    # MUPI_BESTAND_AUSSEN streichen -> Probe 3 rot.
    p.add_argument("--skript", default=SKRIPT, metavar="DATEI",
                   help="anderes Update-Skript lesen (Gegenprobe)")
    a = p.parse_args()

    bloecke = skript_bloecke(a.skript)
    aussen = bestand_aussen(bloecke)

    ort_vater = tempfile.mkdtemp(prefix="mupi-update-bestand-")
    try:
        eins_ort = os.path.join(ort_vater, "lauf")
        os.makedirs(eins_ort)
        welt = sandkasten_bauen(eins_ort)
        eins = probe_durchspielen(eins_ort, bloecke, welt)
        zwei = ({"gut": True, "uebersprungen": True} if a.ohne_stromausfall
                else probe_stromausfall(ort_vater, bloecke))
        drei = probe_deckung(aussen)
    finally:
        if a.behalten:
            print(f"Sandkasten bleibt: {ort_vater}", file=sys.stderr)
        else:
            shutil.rmtree(ort_vater, ignore_errors=True)

    gut = eins["gut"] and zwei["gut"] and drei["gut"]
    if a.json:
        print(json.dumps({"gut": gut, "durchspielen": eins,
                          "stromausfall": zwei, "deckung": drei},
                         indent=2, ensure_ascii=False))
        return 0 if gut else 1

    print()
    print("Ueberlebt der Bestand das Update?")
    print("═════════════════════════════════════════════════════════════")
    print()
    print("1) DURCHSPIELEN — ein gewoehnlicher Lauf im Sandkasten")
    print(f"   {eins['geprueft']} Eintraege vorher angelegt "
          f"(server/config samt Bereichen je Kind, Titelbilder, Verweise)")
    print(f"   {'ok    ' if not eins['fehlt'] else 'FEHLT '} "
          f"alles wieder da{'' if not eins['fehlt'] else ': ' + ', '.join(eins['fehlt'][:8])}")
    if eins["verbogen"]:
        print(f"   VERAENDERT: {', '.join(eins['verbogen'][:8])}")
    print(f"   {'ok    ' if not eins['alter_bau_geblieben'] else 'FEHLER'} "
          f"alter Bau weg" +
          ("" if not eins["alter_bau_geblieben"]
           else f" — liegt noch: {', '.join(eins['alter_bau_geblieben'])}"))
    print(f"   {'ok    ' if eins['neuer_bau_da'] else 'FEHLER'} neuer Bau da")
    print(f"   {'ok    ' if eins['vorlagen_eingespielt'] else 'FEHLER'} "
          "monitor.json/config.json aus den Vorlagen")
    print(f"   {'ok    ' if eins['hort_aufgeraeumt'] else 'FEHLER'} "
          "Hort danach leer und weg")
    print()

    print("2) STROMAUSFALL — an jedem Befehlsuebergang abgebrochen")
    if zwei.get("uebersprungen"):
        print("   uebersprungen (--ohne-stromausfall)")
    else:
        print(f"   {zwei['abbruchstellen']} Abbruchstellen durchgespielt")
        if zwei["gut"]:
            print("   ok     nach jedem Abbruch lag der Bestand vollstaendig vor")
            print("   ok     nach jedem zweiten Lauf stand er wieder im Baum")
        else:
            for s in zwei["schlecht"][:5]:
                print(f"   FEHLER Abbruch bei Befehl {s['stromaus_bei']}: "
                      f"weg {s['nach_abbruch_weg']}, "
                      f"nach dem zweiten Lauf {s['nach_zweitem_lauf_weg']}")
    print()

    print("3) DECKUNG — laeuft die Liste auseinander?")
    print(f"   MUPI_BESTAND_AUSSEN: {', '.join(aussen)}")
    # NACH GRUND GEBUENDELT, nicht Zeile fuer Zeile: allein die Themendaten
    # sind ueber 40 Pfade, und eine Liste, die man wegscrollt, liest niemand.
    # Jeder einzelne Pfad steht in --json.
    nach_grund: dict[str, list[str]] = {}
    for e in drei["eingeordnet"]:
        nach_grund.setdefault(e["grund"], []).append(e["pfad"])
    for grund, pfade in sorted(nach_grund.items(), key=lambda x: -len(x[1])):
        print(f"   ok     {len(pfade):3d} Pfade: {grund}")
        gezeigt = ", ".join(sorted(pfade)[:4])
        print(f"          {gezeigt}{' …' if len(pfade) > 4 else ''}")
    if drei["offen"]:
        print()
        print("   NICHT EINGEORDNET — das faellt beim naechsten Update:")
        for o in drei["offen"]:
            print(f"   ROT    {o['pfad']}")
            print(f"          genannt in {', '.join(o['genannt_in'])}")
        print()
        print("   Zu tun, eines von beiden:")
        print("     * gehoert es der Box? Dann in update/start_mupibox_update.sh")
        print("       zu MUPI_BESTAND_AUSSEN dazu.")
        print("     * ist es Bauergebnis oder Zwischenspeicher? Dann hier in")
        print("       NICHT_RETTEN eintragen — MIT GRUND.")
    print()
    print("═════════════════════════════════════════════════════════════")
    if gut:
        print("  ALLE DREI PROBEN GRUEN.")
        print()
        print("  DIESER LAUF GEHOERT IN tools/pruefen.sh. Er ist heute gruen —")
        print("  und nur ein Schritt, der gruen ist, taugt als Wachhund; ein")
        print("  dauerhaft roter erzieht dazu, das Rot zu uebersehen. Die Zeile:")
        print("      python3 tools/update-bestand-probe.py --ohne-stromausfall")
        print("  (die Stromausfallprobe dauert eine knappe Minute — die lohnt")
        print("   sich, wenn jemand an den Bloecken selbst etwas aendert.)")
        print("  NICHT VON HIER AUS EINGEHAENGT: in tools/pruefen.sh liegt")
        print("  gerade unfestgeschriebene Arbeit einer anderen Sitzung.")
    else:
        print("  ROT — siehe oben.")
    print()
    return 0 if gut else 1


if __name__ == "__main__":
    sys.exit(main())
