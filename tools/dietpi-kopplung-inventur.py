#!/usr/bin/env python3
"""Wie fest haengt die Box an DietPi — und wie fest am Raspberry Pi?

WOZU (30.09.2026, BETRIEBSSYSTEM-ANALYSE.md): Die Frage des Betreibers war,
ob die Box auch auf einer schlankeren Basis als DietPi und auf anderen Boards
laufen koennte. Ein `grep -ci dietpi` ueber den Baum gibt darauf eine Zahl von
rund 1800 Treffern — und die ist wertlos, weil sie drei ganz verschiedene
Dinge in einen Topf wirft:

  * den NUTZERNAMEN `dietpi` und `/home/dietpi` (eine Variable, mechanisch
    ersetzbar, mit DietPi als System hat er nichts zu tun),
  * DietPis WERKZEUGE (`dietpi-software`, `/boot/dietpi/func/…`,
    `dietpi-login`) — die echte Kopplung,
  * die ERSTSTART-AUTOMATIK (`dietpi.txt`, `AUTO_SETUP_*`).

Und eine vierte Sorte, die beim Boardwechsel zaehlt statt beim OS-Wechsel:
  * PI-EIGENES (`config.txt`, `dtoverlay`, `vcgencmd`, `rpi-eeprom`).

Dazu kommt, WO die Zeile steht: eine DietPi-Zeile im Einrichtungsrezept ist
eine andere Baustelle als eine im laufenden Server. Das Werkzeug zaehlt
deshalb zweiachsig (Sorte x Bereich) und trennt Code von Kommentar — im
Server stehen viele Erklaerungen wie "der Dienst laeuft als dietpi", die an
nichts koppeln.

WAS ES AENDERT
  NICHTS. Es liest die von git verfolgten Dateien und druckt Tabellen. Es ist
  ein Messgeraet, keine Wache: der Ausgang ist immer 0 (ausser beim
  Selbsttest, der die Einteilungsregeln an festen Beispielen prueft).

AUFRUF
  python3 tools/dietpi-kopplung-inventur.py              # Tabellen
  python3 tools/dietpi-kopplung-inventur.py --laufzeit   # + jede DietPi-
                                                         #   Werkzeugzeile, die
                                                         #   zur LAUFZEIT greift
  python3 tools/dietpi-kopplung-inventur.py --rezept     # + Rezeptschritte
                                                         #   mit DietPi-Werkzeug
  python3 tools/dietpi-kopplung-inventur.py --selbsttest # Regeln pruefen

GRENZEN, ehrlich gesagt
  * Kommentar wird an der ZEILE erkannt (#, //, *, /*, <!--, ;). Ein
    Kommentar hinter Code zaehlt als Code. Ein Docstring in Python zaehlt als
    Code, weil er zeilenweise nicht zu erkennen ist.
  * `/proc/device-tree/model` ist streng genommen allgemeines Device-Tree,
    wird hier aber zu PI gezaehlt: im Baum dient es ausschliesslich der
    Pi-Erkennung (nachgesehen 30.09.2026).
  * Doku (*.md, llmwiki/, dokumentation/, documentation/) wird NICHT gezaehlt:
    sie koppelt nichts, sie beschreibt.
"""

import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# ── Sorten: die ERSTE passende gewinnt ────────────────────────────────────
# Reihenfolge zaehlt: `/boot/dietpi/dietpi-login` ist ein WERKZEUG, obwohl
# "dietpi" auch im Nutzermuster vorkaeme; `dietpi.txt` ist ERSTSTART, obwohl
# es wie ein Werkzeugname aussieht.
SORTEN = [
    ("erststart", re.compile(
        r"dietpi\.txt|AUTO_SETUP_|dietpi-wifi\.txt|Automation_Custom_(Pre)?Script"
        r"|\.install_stage", re.I)),
    ("werkzeug", re.compile(
        r"/boot/dietpi|/var/lib/dietpi|\bdietpi-[a-z_]+|\bG_(AGI|AGP|AGUP|EXEC"
        r"|DIETPI|CONFIG_INJECT|WHIP|INTERACTIVE)\b|\$DIETPI_DIR|98-dietpi-", re.I)),
    ("nutzer", re.compile(
        r"/home/dietpi|dietpi:dietpi|dietpi:www-data|-u\s+dietpi|User=dietpi"
        r"|su\s+-\s+dietpi|-a\s+dietpi|:-dietpi|['\"]dietpi['\"]|\bdietpi@"
        r"|\bid\s+(-nG\s+)?dietpi|-aG\s+\S+\s+dietpi|\bdietpi\b", re.I)),
    ("pi", re.compile(
        r"config\.txt|\bdtoverlay\b|\bdtparam\b|vcgencmd|rpi-eeprom|raspi-config"
        r"|/proc/device-tree/model|/boot/firmware|\bbcm27\d\d\b|\bbcm2835\b"
        r"|raspberrypi-(kernel|bootloader|sys-mods)|rpi-update", re.I)),
]

SORT_TEXT = {
    "nutzer": "Nutzername/Heimordner `dietpi` (Variable, mechanisch)",
    "werkzeug": "DietPi-Werkzeuge (/boot/dietpi, dietpi-*)",
    "erststart": "Erststart-Automatik (dietpi.txt, AUTO_SETUP_)",
    "pi": "Pi-Eigenes (config.txt, dtoverlay, vcgencmd …)",
}

# ── Bereiche: der ERSTE passende Pfad gewinnt ─────────────────────────────
BEREICHE = [
    (None, r"(^|/)node_modules/|\.md$|^llmwiki/|^dokumentation/|^documentation/"
           r"|package-lock\.json$|(^|/)www/|(^|/)dist/|^screenshots/|^media/"),
    ("werkzeuge", r"^tools/|^harness/|^remote-step-installer/tests/"
                  r"|\.spec\.[a-z]+$|\.test\.[a-z]+$|\.fixture\.|^\.github/"),
    ("laufzeit", r"^src/|^plugins/|^NewDesign/|^handy-app/|^desktop/"),
    ("box-skripte", r"^scripts/|^config/|^bin/"),
    ("einrichtung", r"^autosetup/|^update/|^remote-step-installer/|^mupictl$"),
]
BEREICH_TEXT = {
    "laufzeit": "Laufzeit-Code (src, plugins, Oberflaeche)",
    "box-skripte": "Box-Skripte + Units (scripts, config)",
    "einrichtung": "Einrichtung (autosetup, update, Rezepte)",
    "werkzeuge": "Entwicklerwerkzeuge + Tests",
    "sonst": "Sonstiges",
}
BEREICH_REIHE = ["laufzeit", "box-skripte", "einrichtung", "werkzeuge", "sonst"]
SORT_REIHE = ["werkzeug", "erststart", "nutzer", "pi"]

KOMMENTAR = re.compile(r"^\s*(#(?!!)|//|\*|/\*|<!--|;|--\s)")


def bereich_von(pfad: str):
    for name, muster in BEREICHE:
        if re.search(muster, pfad):
            return name if name else "__weg__"
    return "sonst"


def sorte_von(zeile: str):
    for name, muster in SORTEN:
        if muster.search(zeile):
            return name
    return None


def ist_kommentar(zeile: str) -> bool:
    return bool(KOMMENTAR.match(zeile))


def dateien():
    aus = subprocess.run(["git", "ls-files", "-z"], cwd=WURZEL,
                         capture_output=True, check=True).stdout
    return [p for p in aus.decode("utf-8", "replace").split("\0") if p]


def lesen(pfad: str):
    try:
        roh = (WURZEL / pfad).read_bytes()
    except OSError:
        return None
    if b"\0" in roh[:4096]:
        return None  # Binaerdatei
    return roh.decode("utf-8", "replace").splitlines()


def zaehlen():
    code = defaultdict(Counter)      # bereich -> sorte -> zeilen
    kommentar = defaultdict(Counter)
    dateien_je = defaultdict(set)    # (bereich, sorte) -> dateien
    fundstellen = []                 # (bereich, sorte, pfad, nr, text) nur Code
    for pfad in dateien():
        b = bereich_von(pfad)
        if b == "__weg__":
            continue
        zeilen = lesen(pfad)
        if zeilen is None:
            continue
        for nr, z in enumerate(zeilen, 1):
            s = sorte_von(z)
            if not s:
                continue
            if ist_kommentar(z):
                kommentar[b][s] += 1
                continue
            code[b][s] += 1
            dateien_je[(b, s)].add(pfad)
            fundstellen.append((b, s, pfad, nr, z.strip()))
    return code, kommentar, dateien_je, fundstellen


def tabelle(code, kommentar, dateien_je):
    print("DietPi- und Pi-Kopplung im Baum (nur von git verfolgte Dateien,")
    print("ohne Doku). Zahl = CODE-Zeilen / Dateien; [k] = reine Kommentarzeilen.\n")
    breite = 44
    kopf = f"{'Bereich':<{breite}}" + "".join(f"{s:>16}" for s in SORT_REIHE)
    print(kopf)
    print("-" * len(kopf))
    summe = Counter()
    for b in BEREICH_REIHE:
        if not code[b] and not kommentar[b]:
            continue
        zeile = f"{BEREICH_TEXT[b]:<{breite}}"
        for s in SORT_REIHE:
            n = code[b][s]
            f = len(dateien_je[(b, s)])
            k = kommentar[b][s]
            summe[s] += n
            zelle = f"{n}/{f}" + (f" [{k}]" if k else "")
            zeile += f"{zelle:>16}"
        print(zeile)
    print("-" * len(kopf))
    print(f"{'Summe Code-Zeilen':<{breite}}" + "".join(f"{summe[s]:>16}" for s in SORT_REIHE))
    print()
    for s in SORT_REIHE:
        print(f"  {s:<10} {SORT_TEXT[s]}")
    print()
    lauf = code["laufzeit"]["werkzeug"] + code["box-skripte"]["werkzeug"]
    print(f"KERNZAHL: {lauf} Code-Zeilen rufen zur LAUFZEIT ein DietPi-Werkzeug")
    print("(Laufzeit-Code + Box-Skripte, Sorte `werkzeug`). Das ist, was eine andere")
    print("Basis ERSETZEN muesste; alles andere ist Einrichtung, Name oder Board.")
    print("Einzeln: --laufzeit")


def laufzeit_liste(fundstellen):
    print("\nDietPi-WERKZEUG zur LAUFZEIT — jede Code-Zeile:\n")
    for b, s, pfad, nr, text in fundstellen:
        if s == "werkzeug" and b in ("laufzeit", "box-skripte"):
            print(f"  {pfad}:{nr}: {text[:110]}")


def rezept_liste():
    """Schritte der Einrichtungsrezepte, die ein DietPi-Werkzeug oder die
    Erststart-Automatik anfassen. Gelesen wird nur `run` und `check`: die
    `note` erklaert, sie koppelt nicht."""
    try:
        import yaml
    except ImportError:
        print("\n(--rezept braucht PyYAML)")
        return
    rezepte = sorted((WURZEL / "remote-step-installer/recipes").glob("*.yaml"))
    print("\nRezeptschritte mit DietPi-Werkzeug oder Erststart-Automatik:\n")
    for r in rezepte:
        try:
            daten = yaml.safe_load(r.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            print(f"  {r.name}: nicht lesbar ({e.__class__.__name__})")
            continue
        schritte = []

        def sammeln(knoten):
            if isinstance(knoten, dict):
                if "id" in knoten and ("run" in knoten or "check" in knoten):
                    schritte.append(knoten)
                for v in knoten.values():
                    sammeln(v)
            elif isinstance(knoten, list):
                for v in knoten:
                    sammeln(v)

        sammeln(daten)
        treffer = []
        for st in schritte:
            text = "\n".join(str(st.get(k, "")) for k in ("run", "check"))
            sorten = {sorte_von(z) for z in text.splitlines()
                      if not ist_kommentar(z)} - {None}
            if sorten & {"werkzeug", "erststart"}:
                treffer.append((st["id"], sorted(sorten)))
        print(f"  {r.name}: {len(treffer)} von {len(schritte)} Schritten")
        for sid, so in treffer:
            print(f"      {sid:<40} {', '.join(so)}")


def selbsttest() -> int:
    """Die Regeln an festen Zeilen — ohne den Baum, damit der Test nicht rot
    wird, nur weil jemand die Kopplung ABBAUT (das ist ja das Ziel)."""
    faelle = [
        ("sorte", "  run: \"$DIETPI_DIR/dietpi-software install 5\"", "werkzeug"),
        ("sorte", "args: (w) => ['/boot/dietpi/func/dietpi-set_cpu', w],", "werkzeug"),
        ("sorte", "sed -i 's/^AUTO_SETUP_AUTOMATED=.*/1/' /boot/dietpi.txt", "erststart"),
        ("sorte", "install -d -o dietpi -g dietpi /home/dietpi/.config", "nutzer"),
        ("sorte", "User=dietpi", "nutzer"),
        ("sorte", "const besitzer = (e.besitzer ?? 'dietpi').trim()", "nutzer"),
        ("sorte", "dtoverlay=vc4-kms-dsi-waveshare-panel,5_0_inch", "pi"),
        ("sorte", "vcgencmd get_throttled", "pi"),
        ("sorte", "echo hallo welt", None),
        ("sorte", "Dietrich Pieper", None),
        ("kommentar", "   # der Server laeuft als dietpi", True),
        ("kommentar", " * noatime ist bei DietPi ueblich", True),
        ("kommentar", "#!/bin/bash", False),
        ("kommentar", "chown dietpi:dietpi x  # Kommentar dahinter", False),
        ("bereich", "src/backend-api/src/server.ts", "laufzeit"),
        ("bereich", "src/backend-api/src/server.spec.ts", "werkzeuge"),
        ("bereich", "scripts/mupibox/chromium-autostart.sh", "box-skripte"),
        ("bereich", "remote-step-installer/recipes/mupibox.yaml", "einrichtung"),
        ("bereich", "remote-step-installer/tests/bootwache_test.py", "werkzeuge"),
        ("bereich", "tools/pruefen.sh", "werkzeuge"),
        ("bereich", "README.md", "__weg__"),
        ("bereich", "llmwiki/pack.yaml", "__weg__"),
    ]
    fehler = 0
    for art, eingabe, soll in faelle:
        ist = {"sorte": sorte_von, "kommentar": ist_kommentar,
               "bereich": bereich_von}[art](eingabe)
        if ist != soll:
            print(f"FALSCH {art}: {eingabe!r} -> {ist!r}, erwartet {soll!r}")
            fehler += 1
    print(f"{len(faelle) - fehler} von {len(faelle)} Faellen richtig eingeteilt")
    return 1 if fehler else 0


def main() -> int:
    if "--selbsttest" in sys.argv:
        return selbsttest()
    if "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__)
        return 0
    code, kommentar, dateien_je, fundstellen = zaehlen()
    tabelle(code, kommentar, dateien_je)
    if "--laufzeit" in sys.argv:
        laufzeit_liste(fundstellen)
    if "--rezept" in sys.argv:
        rezept_liste()
    return 0


if __name__ == "__main__":
    sys.exit(main())
