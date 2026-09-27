#!/usr/bin/env python3
"""BOX-ADRESSE-DECKUNG — die Namen, die entscheiden, WELCHE Box ein Werkzeug
anfasst, gegen die Handbuecher. Und die Ausnahmeliste des Handbuchs gegen den
Baum.

WARUM ES DAS GIBT (25.08.2026): `tools/umgebungsvariablen-deckung.py` haelt
seit dem 25.08. die Umgebung gegen die Handbuecher — und laesst `tools/`
vollstaendig draussen, begruendet mit „Attrappenschalter wie `MUPI_STUB_AUS`
steuern eine Vorrichtung, nicht die Box". Fuer den grossen Teil stimmt das
(`MUPI_STROMAUS` in `update-bestand-probe.py` ist eine Stromausfall-Falle im
Sandkasten). Fuer eine Klasse stimmt es genau nicht: die Variablen, die einem
Werkzeug sagen, WELCHE ADRESSE es anfasst. Die steuern keine Vorrichtung, sie
richten das Werkzeug auf ein echtes Geraet.

Gemessen am 25.08.2026 lagen dort VIER Namen fuer dieselbe Sache, mit zwei
unvereinbaren Vorgaben:

    MUPI_URL      -> https://mupibox:8443     tools/pruefen.sh (4 Stellen)
    MUPI_HOST     -> mupibox                  aufraeumen.sh, mitmessen.mjs
    MUPI_BOX      -> 192.168.178.169          anlauf-am-geraet.mjs, …
    MUPIBOX_BOX   -> 192.168.178.169:8200     vorlesen-am-geraet.mjs

Der teure Fall ist nicht der Absturz, sondern die stille Fehlmessung: wer
`MUPI_HOST` setzt (der Name, den `aufraeumen.sh` in seinem AUFRUF-Block nennt
und den der Laeufer sich aus `MUPI_URL` ableitet) und danach
`tools/anlauf-am-geraet.mjs` startet, misst `192.168.178.169` — ohne Hinweis.
Auf einem fremden Netz ist das ein anderes Geraet. Eine falsche BESTAETIGUNG
wiegt schwerer als eine falsche Widerlegung (llmwiki
`gegenprobe-statt-gruen-glauben`): sie schliesst eine Frage.

DIE ZWEITE RICHTUNG, UND SIE IST DER EIGENTLICHE ANLASS. `mixpibox.md`
Abschnitt 7 fuehrt einen Kasten „Zwei Namen, die hier absichtlich fehlen" und
sagt ueber `MUPI_URL` und `MUPI_LOCAL_SRC`: „das Skript setzt sie sich selbst.
Wer sie von aussen setzt, sieht seinen Wert ueberschrieben." Fuer
`MUPI_LOCAL_SRC` stimmt das (`make-boot-sd.sh` exportiert es fuer sein Kind).
Fuer `MUPI_URL` stimmt es an der BELEGTEN Stelle (`chromium-autostart.sh:152`
weist ohne Bedingung zu) und ist an der Stelle falsch, die ein Entwickler
tippt: `tools/pruefen.sh` liest `${MUPI_URL:-…}` an vier Stellen von aussen.
Damit ist der EINZIGE dokumentierte Name, mit dem man den ganzen Pruefla uf auf
eine andere Box richten kann, als „bringt nichts" dokumentiert.

Die Form ist bekannt: eine AUFZAEHLUNG macht aus dem einen Gewollten und dem
einen Vergessenen zwei Gewollte — der richtige Nachbar leiht dem falschen
seine Glaubwuerdigkeit (llmwiki `begruendung-liest-sich-als-stand`). Eine
Ausnahmeliste ist Text im Baum und gehoert gegen den Baum gehalten.

WAS GEPRUEFT WIRD:

  1. AUSSENSCHRAUBE OHNE HANDBUCH — jeder Umgebungsname mit `MUPI`-Praefix,
     den `tools/` liest und dessen VORGABE AN DER LESESTELLE eine Adresse ist
     (IP, `mupibox`, `localhost`, `host:port`, `http(s)://`), steht in
     Backticks in einem Handbuch. Die Liste kommt aus dem WERT, nicht aus dem
     Namen — ein Name wie `MUPI_HORT` klingt nach Adresse und ist ein
     Verzeichnis, `MUPIBOX_BOX` klingt nach Schalter und ist eine Adresse.
     (Warum nicht nach dem Namen: llmwiki
     `namenssuche-nach-wachen-laesst-die-geschwister-stehen`.)

  2. AUSNAHME, DIE NICHT MEHR STIMMT — jeder Name, den ein Handbuch als
     hausintern ausnimmt („setzt sie sich selbst", „von aussen … ueber-
     schrieben"), wird nirgends im Baum von AUSSEN GELESEN. Ein `X=…` zaehlt
     nicht als Lesen, ein `${X:-…}` oder `process.env.X` schon.

  3. HINWEIS, nicht gezaehlt: mehrere Namen fuer dieselbe Sache mit
     verschiedenen Vorgaben. Das zu VEREINHEITLICHEN ist eine Aenderung am
     Code, keine an der Doku; die Wache haelt es sichtbar, damit die Zahl
     nicht als Deckungsgrad gelesen wird (llmwiki
     `wache-sieht-die-schleife-nicht-die-scharf-schaltet`).

WAS ES NICHT TUT: es fasst keine Box an, loest nichts aus und setzt nichts. Es
liest Quelltext und Text. Ob die dokumentierte Vorgabe der gemessenen
entspricht, prueft es NICHT — es prueft, dass der Name ueberhaupt dasteht.

Findet die Wache keine einzige Adress-Schraube oder keinen Ausnahme-Kasten,
meldet sie FEHLER statt gruen — eine Wache, die eine Umbenennung ueberlebt,
ist keine (llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/box-adresse-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Werkzeuge sind der Grund fuer diese Wache; `scripts/` und `src/` deckt
# `umgebungsvariablen-deckung.py` bereits ab. Beide Baeume trotzdem lesen
# kostet nichts und macht Richtung 2 vollstaendig — eine Wache, die eine
# Ablage nicht kennt, meldet dort ewig gruen (llmwiki
# `eine-wache-die-eine-ablage-nicht-kennt-meldet-dort-ewig-gruen`).
QUELLBAEUME = ("tools", "scripts", "src")

# ── WARUM `BACKLOG.md` HIER NICHT STEHT ────────────────────────────────────
# Dieselbe Begruendung wie bei `umgebungsvariablen-deckung.py` fuer die
# AUDIT-Dateien: eine Liste offener Punkte ruft niemanden, sie wird einmal
# gelesen und altert still. Und hier ist es MESSBAR die richtige Wahl —
# `MUPI_HOST` steht dort genau einmal (Z. 1727) und meint etwas ANDERES: einen
# Schluessel in `remote-step-installer/boxen.yaml`, nicht die Umgebungsschraube
# der Werkzeuge. Mit `BACKLOG.md` in der Liste galt der wichtigste Name als
# dokumentiert. Ein Namenstreffer taugt als Alibi (llmwiki
# `wache-sieht-die-schleife-nicht-die-scharf-schaltet`).
HANDBUECHER = (
    "README.md",
    "plugins/README.md",
    "dokumentation/mixpibox.md",
    "dokumentation/benutzerhandbuch.html",
)

# Ordner, die keine Aussage ueber ein Werkzeug machen: Bau-Ergebnisse,
# Zwischenspeicher, fremde Baeume.
UEBERGEHEN = (
    "node_modules",
    "__pycache__",
    ".angular",
    ".git",
    "dist",
    "deploy",
    "e2e-artefakte",
)

ENDUNGEN = {".py", ".sh", ".bash", ".mjs", ".js", ".ts", ".tsx"}

# Diese Datei selbst. Ihr Kopfkommentar ZITIERT `${MUPI_URL:-…}` als Beleg —
# ohne diesen Riegel belegt die Wache ihren eigenen Befund mit sich selbst.
# Dieselbe Falle wie bei der Ablagen-Wache: ein Name im Fliesstext ist ein
# Verweis, kein Zugriff.
SELBST = Path(__file__).resolve().relative_to(WURZEL).as_posix()

# ZWEI PRAEFIXE, NICHT EINS MIT OPTIONALEM BUCHSTABEN. Die erste Fassung
# schrieb `MUPIBOX?_` und meinte „MUPI_ oder MUPIBOX_" — gelesen hat Python
# „MUPIBO_ oder MUPIBOX_", und `MUPI_BOX`, `MUPI_HOST`, `MUPI_URL` fielen
# lautlos heraus. Uebrig blieb EIN Treffer, und der sah nach einem Befund aus.
# Ein Muster, das ploetzlich fast nichts findet, ist kaputt und nicht sauber
# (llmwiki `gegenprobe-statt-gruen-glauben`).
PRAEFIX = r"MUPI(?:BOX)?_[A-Z0-9_]+"

# ── LESEN, NICHT SETZEN ────────────────────────────────────────────────────
# Dieselben Formen wie in `umgebungsvariablen-deckung.py`, plus der Shell-Fall
# MIT Vorgabe, denn genau dort steht der Wert, den diese Wache braucht. Die
# Gruppen heissen `name` und `wert`, damit die Nummerierung beim Erweitern
# nicht verrutscht.
LESEN = (
    re.compile(rf"process\.env\.(?P<name>{PRAEFIX})\s*\|\|\s*(['\"`])(?P<wert>[^'\"`]*)\2"),
    re.compile(rf"process\.env\[['\"](?P<name>{PRAEFIX})['\"]\]\s*\|\|\s*(['\"`])(?P<wert>[^'\"`]*)\2"),
    re.compile(rf"os\.environ\.get\(\s*['\"](?P<name>{PRAEFIX})['\"]\s*,\s*(['\"])(?P<wert>[^'\"]*)\2"),
    re.compile(rf"os\.getenv\(\s*['\"](?P<name>{PRAEFIX})['\"]\s*,\s*(['\"])(?P<wert>[^'\"]*)\2"),
    re.compile(rf"\$\{{(?P<name>{PRAEFIX}):[-=](?P<wert>[^}}]*)\}}"),
)

# Lesen OHNE Vorgabe — zaehlt fuer Richtung 2 (wird von aussen gelesen), traegt
# aber keinen Wert fuer Richtung 1.
LESEN_NACKT = (
    re.compile(rf"process\.env\.(?P<name>{PRAEFIX})"),
    re.compile(rf"process\.env\[['\"](?P<name>{PRAEFIX})['\"]\]"),
    re.compile(rf"os\.environ(?:\.get)?[\[(]\s*['\"](?P<name>{PRAEFIX})['\"]"),
    re.compile(rf"os\.getenv\(\s*['\"](?P<name>{PRAEFIX})['\"]"),
    re.compile(rf"\$\{{(?P<name>{PRAEFIX})[:}}]"),
)

# ── WAS EINE ADRESSE IST ───────────────────────────────────────────────────
# Gemessen am WERT. `mupibox` ist der Rechnername der Box im Heimnetz.
ADRESSE = re.compile(
    r"^(?:https?://)?(?:"
    r"\d{1,3}(?:\.\d{1,3}){3}"          # 192.168.178.169
    r"|mupibox|localhost|mixpibox"       # Rechnernamen
    r")(?::\d{2,5})?(?:/.*)?$",
    re.I,
)

# Ausnahmen fuer Richtung 1, jede mit Grund. Eine Ausnahmeliste ist Text im
# Baum und wird unten gegen ihn gehalten.
AUSNAHMEN_ADRESSE: dict[str, str] = {}

# ── DER AUSNAHME-KASTEN DES HANDBUCHS ──────────────────────────────────────
# Nicht auf den Titel des Kastens greppen, sondern auf die BEGRUENDUNG — der
# Titel nennt eine Zahl („Zwei Namen"), und die aendert sich beim Nachtragen.
HAUSINTERN_SATZ = re.compile(
    r"(setzt (?:sie|es|ihn) sich selbst|setzt das Skript sich selbst"
    r"|von au(?:ss|ß)en setzt|hausinterne?[nrs]? (?:Variable|Variablen))",
    re.I,
)

# ── DER MARKER, DER EINE AUSNAHME ALS HISTORISCH AUSWEIST ──────────────────
# Dasselbe Vokabular wie `tools/doku-widerruf-probe.sh` (MARKER, Z. 75) — eine
# zweite Liste liefe auseinander. Der Grund fuer diesen Riegel ist gemessen:
# die KORREKTUR des Befundes zitiert den widerrufenen Satz, um zu erklaeren,
# was daran falsch war. Ohne den Marker faellt die Wache ueber das Zitat und
# meldet die Berichtigung als Fehler. Dieselbe Falle wie beim Widerruf-Marker
# (llmwiki `wiki-zustand-hat-haltbarkeit`).
HISTORISCH = re.compile(
    r"überholt|ueberholt|NACHTRAG|Nachtrag|Stand vor|galt bis|nicht mehr"
    r"|widerlegt|widerruf|Widerruf|stand hier bis|war falsch",
)


def dateien(baum: Path):
    if not baum.is_dir():
        return
    for pfad in sorted(baum.rglob("*")):
        if not pfad.is_file() or pfad.suffix not in ENDUNGEN:
            continue
        if any(teil in UEBERGEHEN for teil in pfad.parts):
            continue
        if pfad.relative_to(WURZEL).as_posix() == SELBST:
            continue
        yield pfad


# Setzt eine Datei den Namen SELBST, ehe sie ihn liest? Dann ist die
# Handbuch-Ausnahme „das Skript setzt sie sich selbst" fuer diese Datei WAHR.
# `make-boot-sd.sh` exportiert `MUPI_LOCAL_SRC` in Zeile 126 und liest es in
# 128 — das ist kein Griff von aussen. Ohne diese Frage meldet die Wache den
# einen richtigen Teil der Ausnahme als Fehler und macht sich unglaubwuerdig.
SETZT = re.compile(rf"^\s*(?:export\s+|local\s+)?\\?(?P<name>{PRAEFIX})=", re.MULTILINE)


def setzt_selbst(rel: str, name: str) -> bool:
    pfad = WURZEL / rel
    try:
        text = pfad.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return any(t.group("name") == name for t in SETZT.finditer(text))


# ══ SAMMELN ════════════════════════════════════════════════════════════════
# name -> {"werte": {wert: [orte]}, "gelesen": [orte]}
schrauben: dict[str, dict] = {}

for name_baum in QUELLBAEUME:
    for pfad in dateien(WURZEL / name_baum):
        rel = pfad.relative_to(WURZEL).as_posix()
        try:
            text = pfad.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for nr, zeile in enumerate(text.splitlines(), 1):
            for muster in LESEN:
                for tref in muster.finditer(zeile):
                    name = tref.group("name")
                    wert = tref.group("wert")
                    eintrag = schrauben.setdefault(name, {"werte": {}, "gelesen": []})
                    eintrag["werte"].setdefault(wert, []).append(f"{rel}:{nr}")
                    if f"{rel}:{nr}" not in eintrag["gelesen"]:
                        eintrag["gelesen"].append(f"{rel}:{nr}")
            for muster in LESEN_NACKT:
                for tref in muster.finditer(zeile):
                    name = tref.group("name")
                    eintrag = schrauben.setdefault(name, {"werte": {}, "gelesen": []})
                    if f"{rel}:{nr}" not in eintrag["gelesen"]:
                        eintrag["gelesen"].append(f"{rel}:{nr}")

if not schrauben:
    print("  FEHLER: kein einziger Umgebungszugriff gefunden — Praefix geaendert?")
    sys.exit(1)

doku = ""
for name in HANDBUECHER:
    pfad = WURZEL / name
    if pfad.exists():
        doku += pfad.read_text(encoding="utf-8", errors="ignore") + "\n"
if not doku:
    print("  FEHLER: kein Handbuch gefunden — umbenannt?")
    sys.exit(1)


def genannt(name: str) -> bool:
    """In Backticks, wie bei Rechten und Sektionen — ein nackter Name koennte
    zufaellig im Fliesstext stehen. `NAME=wert` zaehlt mit."""
    return bool(re.search(rf"`{re.escape(name)}(?:`|=)", doku))


luecken: list[str] = []

# ══ 1. AUSSENSCHRAUBEN, DIE AUF EINE ADRESSE ZEIGEN ════════════════════════
print("── Namen, die eine Box-Adresse setzen, und kein Handbuch nennt sie ──")
adress_schrauben: dict[str, dict[str, list[str]]] = {}
for name, eintrag in sorted(schrauben.items()):
    treffer = {w: o for w, o in eintrag["werte"].items() if w and ADRESSE.match(w.strip())}
    if treffer:
        adress_schrauben[name] = treffer

if not adress_schrauben:
    print("  FEHLER: keine einzige Adress-Schraube gefunden — Muster kaputt?")
    sys.exit(1)

for name, werte in sorted(adress_schrauben.items()):
    if name in AUSNAHMEN_ADRESSE:
        continue
    if not genannt(name):
        ort = sorted(werte.values())[0][0]
        vorgaben = ", ".join(sorted(werte))
        print(f"  FEHLT in der Doku: {name} -> {vorgaben}  ({ort})")
        luecken.append(f"Adress-Schraube {name} in keinem Handbuch")

# ══ 2. AUSNAHMEN DES HANDBUCHS GEGEN DEN BAUM ══════════════════════════════
print()
print("── Namen, die ein Handbuch als hausintern ausnimmt, und doch von aussen gelesen werden ──")
kasten_gefunden = False
# Ein Kasten ist ein ABSATZ und trifft das Muster oft mehrfach („setzt sie
# sich selbst" und „von aussen setzt" stehen in aufeinanderfolgenden Zeilen).
# Ohne diesen Merker steht derselbe Befund zweimal da und die Schlusszahl ist
# doppelt so gross wie die Sache.
schon: set[tuple[str, str]] = set()
for name_doku in HANDBUECHER:
    pfad = WURZEL / name_doku
    if not pfad.exists():
        continue
    zeilen = pfad.read_text(encoding="utf-8", errors="ignore").splitlines()
    for nr, zeile in enumerate(zeilen, 1):
        if not HAUSINTERN_SATZ.search(zeile):
            continue
        kasten_gefunden = True
        # Der Kasten ist ein Absatz, nicht eine Zeile: die Namen stehen in den
        # Zeilen davor und danach. Fenster statt Zeile — dieselbe Lehre wie
        # beim Widerruf-Marker (llmwiki `wiki-zustand-hat-haltbarkeit`).
        fenster = "\n".join(zeilen[max(0, nr - 4) : nr + 3])
        # Weist sich der Absatz selbst als historisch aus, ist er kein
        # Anspruch, sondern ein Rueckblick.
        if HISTORISCH.search(fenster):
            continue
        for name in sorted(set(re.findall(rf"`({PRAEFIX})`", fenster))):
            if (name_doku, name) in schon:
                continue
            eintrag = schrauben.get(name)
            if not eintrag:
                continue
            # Nur Stellen, die den Namen NICHT selbst setzen. Bleibt keine
            # uebrig, haelt die Ausnahme.
            fremd = [o for o in eintrag["gelesen"] if not setzt_selbst(o.rsplit(":", 1)[0], name)]
            if not fremd:
                continue
            schon.add((name_doku, name))
            weitere = len(fremd) - 1
            mehr = f" und {weitere} weitere" if weitere > 0 else ""
            print(f"  AUSNAHME STIMMT NICHT: {name_doku}:{nr} nimmt {name} als hausintern aus,")
            print(f"                         von aussen gelesen in {fremd[0]}{mehr}")
            luecken.append(f"{name_doku}:{nr} nimmt {name} zu Unrecht aus")

if not kasten_gefunden:
    print("  FEHLER: kein Ausnahme-Kasten in den Handbuechern gefunden — umformuliert?")
    sys.exit(1)

# ══ 3. HINWEIS: MEHRERE NAMEN FUER DIESELBE SACHE ══════════════════════════
print()
print("── HINWEIS (nicht gezaehlt): mehrere Namen fuer dieselbe Adresse ──")
if len(adress_schrauben) > 1:
    print(f"  {len(adress_schrauben)} Namen richten ein Werkzeug auf eine Box:")
    for name, werte in sorted(adress_schrauben.items()):
        for wert, orte in sorted(werte.items()):
            print(f"    {name:<16} -> {wert:<26} ({len(orte)} Stelle(n), z.B. {orte[0]})")
    print("  Wer den einen setzt, wird vom Werkzeug mit dem anderen still")
    print("  uebergangen. Das zu vereinheitlichen ist eine Aenderung am Code.")
else:
    print("  Nur ein Name — nichts zu verwechseln.")

# ══ SELBSTPRUEFUNG DER AUSNAHMELISTE ═══════════════════════════════════════
for name, grund in sorted(AUSNAHMEN_ADRESSE.items()):
    if name not in adress_schrauben:
        print()
        print(f"  FEHLER: Ausnahme `{name}` ({grund}) trifft nichts mehr — entfernen.")
        luecken.append(f"tote Ausnahme {name}")

print()
if not luecken:
    print(f"KEINE LUECKE. {len(adress_schrauben)} Adress-Schrauben, alle dokumentiert;")
    print("jede Handbuch-Ausnahme haelt.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
