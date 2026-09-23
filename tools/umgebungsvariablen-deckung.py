#!/usr/bin/env python3
"""UMGEBUNGSVARIABLEN-DECKUNG — die Stellschrauben des laufenden Systems gegen
die Handbuecher.

WARUM ES DAS GIBT (25.08.2026): Elf Doku-Wachen halten die Handbuecher gegen
den Quelltext — Endpunkte, Rechte, Ereignisse, Konfigurationsfelder, Dienste,
Ablagen, npm-Skripte. Keine davon kannte die UMGEBUNG. Gemessen am 25.08.2026:
`src/` und `scripts/` lesen 69 Variablen mit `MUPIBOX_`/`MUPI_`-Praefix; VIER
davon standen in einem Handbuch. Die uebrigen 65 waren nur zu finden, indem man
den Quelltext aufmacht — und man muss wissen, dass es sie ueberhaupt gibt.

DER TEURE FALL, DER DAS AUSGELOEST HAT, ist `MUPIBOX_STANDWACHE_NIE_HANDELN`
(`scripts/box/mupibox-standwache.py:215`). Die Hausregel „was am Geraet dreht,
braucht eine benannte Naht UND einen Umgebungsriegel" ist umgesetzt — die
Standwache faehrt ohne den Riegel wirklich herunter. Der Riegel stand in
keinem Handbuch. Wer einen Test um diese Datei herum schreibt und den Riegel
nicht kennt, schaltet die Box ab; die Datei sagt es ihm erst, wenn er sie
liest, und dann ist es zu spaet. Ein Sicherheitsriegel, den man nur durch
Quelltextlesen findet, ist die halbe Sicherung.

Zweitwichtigster Fall: `MUPIBOX_SICHERUNG_PW`. Es ist der EINZIGE Weg, die
Sicherung ohne Tastatur zu entschluesseln (`ps` zeigt Argumente jedem
Benutzer, darum kein Befehlszeilenschalter). Ein Weg, den die Doku nicht kennt,
existiert fuer den Betreiber nicht.

WAS ALS GELESEN ZAEHLT — und warum die Frage nicht trivial ist: gesucht wird
nach dem ZUGRIFF, nicht nach dem NAMEN.

    process.env.NAME / process.env['NAME']     JS/TS
    os.environ[…] / .get(…) / os.getenv(…)     Python
    $NAME / ${NAME…} / ${NAME:-…}              Shell

Eine Namenssuche haette `MUPIBOX_STANDWACHE_ECHT` gemeldet — der Name steht in
`mupibox-standwache.py:211`, aber nur im Kommentar, als die VERWORFENE
Gegenrichtung des Riegels („ein Riegel, der Handeln erst freigibt, waere hier
falsch"). Eine Variable, die nur in Prosa vorkommt, gibt es nicht; sie zu
dokumentieren waere schlimmer als sie wegzulassen, weil jemand sie dann setzt.
Denselben Fehler machte die Namenssuche des 24.08. bei den Wachen (llmwiki
`namenssuche-nach-wachen-laesst-die-geschwister-stehen`).

WAS DRAUSSEN BLEIBT UND WARUM:
  * `*.spec.ts` / `*.test.*` und alles unter `tools/` — Attrappenschalter wie
    `MUPI_STUB_AUS` oder `MPVTEST_EREIGNISSE` steuern eine Vorrichtung, nicht
    die Box. Sie stehen im Test daneben, wo sie gebraucht werden.
  * `src/deploy/` — das ist das gebaute Ergebnis von `src/backend-api`, jede
    Variable dort ist eine Dublette der Quelle.
  * `__pycache__` — beim ersten Lauf meldete die Wache `MUPIBOX_SICHERUNG_PW`
    aus einer `.pyc`.

DER PRAEFIX WAR DIE NAMENSSUCHE, DIE OBEN VERWORFEN WIRD (27.08.2026). Bis
heute stand in jedem Zugriffsmuster `(?:MUPIBOX|MUPI)_…`. Gesucht wurde also
nicht der Zugriff, sondern der Zugriff auf einen Namen mit dem HAUSPRAEFIX —
die Namenssuche kam durch die Hintertuer zurueck. Wer sich an die
Namenskonvention haelt, wurde geprueft; wer nicht, war unsichtbar. Eine Wache,
die nur findet, was der Konvention folgt, findet nie den Fall, der von ihr
abweicht — und genau der ist der wahrscheinlichere Doku-Fehler, weil er auch
dem Menschen durchrutscht, der das Handbuch pflegt.

GEFUNDEN HAT DAS `PLAYER_PROXY_HOST` / `PLAYER_PROXY_PORT`
(`src/backend-api/src/server.ts:2116-2117`). Sie sagen, wohin die API den
Wiedergabedienst weiterreicht — dieselbe Sorte Stellschraube wie
`MUPIBOX_HTTP_PORT`, das zwei Tabellenzeilen weiter oben dokumentiert IST. Sie
standen in KEINER Doku-Datei, nicht einmal in einem Audit. Ohne Praefix, ohne
Wache, ohne Eintrag.

DAS MERKMAL IST JETZT DIE SORTE, NICHT DER NAME: gelesen wird jede Variable in
Grossbuchstaben, und wer NICHT gemeldet werden soll, muss unten mit Grund
danebenstehen. Es ist derselbe Fehler wie in llmwiki
[[namenssuche-nach-wachen-laesst-die-geschwister-stehen]], nur eine Stufe
subtiler: dort suchte eine Wache nach Namen STATT nach der Sache, hier suchte
sie nach der Sache — aber nur bei Namen einer bestimmten Machart.

WAS ES NICHT TUT: es fuehrt nichts aus, setzt nichts und liest keine
Vorgabewerte gegen. Ob der in der Doku genannte Vorgabewert stimmt, prueft es
NICHT — es prueft, dass die Variable ueberhaupt vorkommt.

Findet die Wache gar keine Variable, meldet sie eine Warnung statt gruen
(llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/umgebungsvariablen-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLBAEUME = ("src", "scripts")
DOKU_DATEIEN = ("README.md", "plugins/README.md")
DOKU_BAEUME = ("dokumentation", "documentation")

# Ordner, deren Inhalt keine Aussage ueber die laufende Box macht.
AUSSEN = ("node_modules", "__pycache__", "/dist", ".angular", "src/deploy/")

# Jeder Grossbuchstabenname. NICHT mehr `(?:MUPIBOX|MUPI)_…` — siehe Kopf.
PRAEFIX = r"[A-Z][A-Z0-9_]{2,}"

# WER DRAUSSEN BLEIBT, STEHT HIER MIT GRUND. Eine stille Obergrenze waere
# schlimmer als der Praefix, den sie ersetzt: sie saehe aus wie Deckung.
#
# (1) Gehoert dem Betriebssystem oder der Werkzeugkette. Nicht unsere
#     Stellschraube — wer `PATH` dokumentiert, dokumentiert Linux.
SYSTEM = {
    "PATH", "HOME", "USER", "SHELL", "PWD", "LANG", "LC_ALL", "TERM", "TMPDIR",
    "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS",
    "NODE_ENV", "NODE_OPTIONS", "CI", "DEBUG", "FORCE_COLOR", "NO_COLOR",
    "CHROME_BIN", "PYTHONPATH", "PYTHONUNBUFFERED", "SUDO_USER", "LOGNAME",
    # Von der Bash selbst gesetzt — `$EUID`, `$PPID`, `$BASH_SOURCE` liest man,
    # setzen kann man sie nicht.
    "BASH_SOURCE", "BASH_VERSION", "BASHPID", "COPROC", "EPOCHREALTIME",
    "EPOCHSECONDS", "EUID", "UID", "PPID", "LINES", "COLUMNS", "RANDOM",
    "SECONDS", "IFS", "OLDPWD", "REPLY", "FUNCNAME", "HOSTNAME", "OSTYPE",
}

# (2) Steuert eine Vorrichtung, nicht die Box — dieselbe Begruendung, mit der
#     `*.spec.ts` und `tools/` schon draussen sind. Sie stehen im Test daneben,
#     wo sie gebraucht werden. Erkannt am Namen, weil die Attrappe im
#     Produktivcode ABGEFRAGT wird (`if (process.env.MPVTEST)`) und darum nicht
#     ueber den Dateipfad auszusortieren ist.
VORRICHTUNG = re.compile(r"^(?:MPTEST|MPVTEST|MUPI_STUB)\b|_STUB(?:_|$)")

# Die drei Zugriffsformen. Nur ein Treffer hier zaehlt als „wird gelesen".
ZUGRIFF = (
    re.compile(rf"process\.env\.({PRAEFIX})"),
    re.compile(rf"process\.env\[['\"]({PRAEFIX})['\"]\]"),
    re.compile(rf"os\.environ(?:\.get)?[\[(]\s*['\"]({PRAEFIX})['\"]"),
    re.compile(rf"os\.getenv\(\s*['\"]({PRAEFIX})['\"]"),
    # `${NAME:-vorgabe}` / `${NAME:=…}` — die Form sagt selbst, dass sie von
    # aussen kommen darf, auch wenn die Datei den Namen woanders setzt.
    re.compile(rf"\$\{{({PRAEFIX}):[-=]"),
)

# DAS NACKTE `$NAME` IN DER SHELL BEHAELT DAS PRAEFIX — und das ist kein
# Rueckfall in die Namenssuche, sondern die Grenze der Aussagekraft der FORM.
# `process.env.X`, `os.environ[X]` und `${X:-vorgabe}` sagen selbst, dass der
# Wert von aussen kommen darf; das Merkmal steckt in der Schreibweise, darum
# duerfen sie jeden Namen nehmen. Ein blankes `$X` sagt das NICHT — in einer
# Shell-Datei ist es viel wahrscheinlicher eine Zwischenablage der Datei
# selbst. Ohne Praefix meldete dieser Zweig `TAKT`, `GELESEN`, `BEREICH`,
# `LOG` — Schleifenvariablen aus `idle_shutdown.sh`, die zu dokumentieren
# Unsinn und deren Dauerrot die naechste echte Luecke verdecken wuerde
# (llmwiki `dauerrote-wache-ist-keine`).
#
# Zaehlt weiter nur, wenn die Datei den Namen nirgends selbst setzt: eine
# hausinterne Variable, die zufaellig das Praefix traegt, ist keine
# Stellschraube. `chromium-autostart.sh` baut sich `MUPI_URL` aus dem
# TLS-Zustand selbst zusammen, `make-boot-sd.sh` exportiert `MUPI_LOCAL_SRC`
# fuer sein Kind. Beide als Stellschraube zu dokumentieren waere eine
# Einladung, sie zu setzen — und sie wuerden ueberschrieben.
HAUSPRAEFIX = r"(?:MUPIBOX|MUPI|MIXPI)_[A-Z0-9_]+"
SHELL_NACKT = re.compile(rf"\$\{{?({HAUSPRAEFIX})\b")


def shell_setzt_selbst(inhalt: str, name: str) -> bool:
    """Belegt die Datei den Namen irgendwo selbst?

    Gilt fuer BEIDE Shell-Formen, auch fuer `${NAME:-vorgabe}`. Diese Pruefung
    fehlte dort, und deshalb meldete der Lauf vom 27.08. `GELESEN`,
    `SCHREIBGRUND`, `QUELLE` und `DEV`: alle vier werden in ihrer Datei per
    `NAME=$(…)` belegt und danach mit `${NAME:-ersatz}` nur noch VORSICHTIG
    ausgegeben, falls der Aufruf davor nichts lieferte. Das ist eine
    Ausweichmeldung, keine Stellschraube — `${SCHREIBGRUND:-kein Grund
    genannt}` als dokumentierte Variable zu fuehren waere schlicht falsch.

    `: "${NAME:=vorgabe}"` faellt hier NICHT herein: die Zeile beginnt mit dem
    Doppelpunkt, nicht mit dem Namen. Genau richtig — das ist die uebliche
    Schreibweise fuer „darf von aussen kommen, sonst nimm das hier".

    DIE ZUWEISUNG AN SICH SELBST IST KEIN SETZEN. `TMP_DIR="${TMP_DIR:-/tmp}"`
    (`remove_max_resume.sh:66`) beginnt mit dem Namen und waere der Zeilenform
    nach ein Selbstsetzen — gemeint ist das GENAUE GEGENTEIL: nimm, was von
    aussen kam, sonst `/tmp`. Diese eine Zeile hat die Wache beim ersten
    strengeren Lauf still verschluckt. Darum zaehlt nur eine Zuweisung, in der
    der Name NICHT auch rechts steht. `CACHE_SIZE` bleibt trotzdem draussen:
    es hat neben `CACHE_SIZE=$(( $CACHE_SIZE * … ))` auch eine echte Belegung
    aus der Konfiguration.
    """
    for zeile in re.finditer(
        rf"^\s*(?:export\s+|local\s+(?:-\w+\s+)?|declare\s+(?:-\w+\s+)?|readonly\s+)?"
        rf"{re.escape(name)}=(.*)$",
        inhalt,
        re.MULTILINE,
    ):
        if not re.search(rf"\$\{{?{re.escape(name)}\b", zeile.group(1)):
            return True
    return re.search(
        rf"^\s*for\s+{re.escape(name)}\b|\bread\s+(?:-\w+\s+)*{re.escape(name)}\b",
        inhalt,
        re.MULTILINE,
    ) is not None
# Alle Formen, mit denen eine Shell-Datei einen Namen selbst belegt. Ein
# blosses `NAME=` reichte nicht: `for NAME in …`, `read -r NAME` und
# `local -a NAME` setzen genauso, und jede davon erzeugte einen Fehlbefund.
SHELL_SETZT = re.compile(
    rf"^\s*(?:export\s+|local\s+(?:-\w+\s+)?|declare\s+(?:-\w+\s+)?|readonly\s+)?({HAUSPRAEFIX})="
    rf"|^\s*for\s+({HAUSPRAEFIX})\b"
    rf"|\bread\s+(?:-\w+\s+)*({HAUSPRAEFIX})\b",
    re.MULTILINE,
)

# DER ZUGRIFF UEBER EINE KONSTANTE. Der erste Lauf dieser Wache meldete 61
# Luecken und liess ausgerechnet die beiden wichtigsten aus:
#
#   RIEGEL      = "MUPIBOX_STANDWACHE_NIE_HANDELN"   (mupibox-standwache.py)
#   PW_UMGEBUNG = "MUPIBOX_SICHERUNG_PW"             (mupibox-sicherung.py)
#
# Beide werden spaeter als `os.environ.get(RIEGEL)` gelesen — im Zugriff steht
# kein Name mehr. Genau die zwei Variablen, denen jemand einen eigenen
# benannten Platz gegeben hat, weil sie wichtig sind, waren fuer eine Suche
# nach der Zugriffsform unsichtbar. Darum zusaetzlich: eine Zeichenkette mit
# dem Praefix, die einer Konstanten zugewiesen wird — aber NUR in Dateien, die
# ueberhaupt irgendwo die Umgebung anfassen. Sonst waere jede Namensliste
# wieder eine Namenssuche.
KONSTANTE = re.compile(rf"^[A-Z_][A-Z0-9_]*\s*=\s*['\"]({PRAEFIX})['\"]", re.MULTILINE)
BERUEHRT_UMGEBUNG = re.compile(r"os\.environ|os\.getenv|process\.env")

LESBAR = (".ts", ".js", ".mjs", ".cjs", ".py", ".sh", ".bash")


# AUSKOMMENTIERTE ZEILEN ZAEHLEN NICHT. Die Wache hat es schon immer so
# gehalten — „eine Variable, die nur in Prosa vorkommt, gibt es nicht" — aber
# durchgesetzt hat es bis zum 27.08. der Praefix: ein `$NAME` in einem
# Kommentar traf einfach kein Muster. Ohne Praefix trifft es. Der erste
# gemeldete Fall war `URL` aus `chromium-autostart.sh:115`, einer
# STILLGELEGTEN Startzeile (`#sudo nice -n -19 …`). Der lebende Weg zehn Zeilen
# weiter unten benutzt `MUPI_URL`. `URL` als Stellschraube zu dokumentieren
# hiesse, jemanden auf eine Zeile zu schicken, die nicht mehr laeuft.
KOMMENTARZEILE = re.compile(r"^[ \t]*(?:#|//)[^\n]*$", re.MULTILINE)


def ohne_kommentarzeilen(inhalt: str) -> str:
    """Ganze Kommentarzeilen raus, Zeilenzahl unveraendert (leere Zeile bleibt).

    Bewusst NUR ganze Zeilen: ein `#` am Zeilenende kann in einer Shell-Datei
    Teil eines Wertes sein (`FARBE='#ff0000'`), und ein halbherziges Abschneiden
    dort wuerde echten Code verstuemmeln.
    """
    return KOMMENTARZEILE.sub("", inhalt)


def dateien(baum: Path):
    for pfad in baum.rglob("*"):
        if not pfad.is_file() or pfad.suffix not in LESBAR:
            continue
        text = str(pfad.relative_to(WURZEL))
        if any(a.strip("/") in text.split("/") or a in text for a in AUSSEN):
            continue
        if ".spec." in pfad.name or ".test." in pfad.name:
            continue
        yield pfad


def merken(gefunden: dict[str, str], name: str, pfad: Path) -> None:
    if name in SYSTEM or VORRICHTUNG.search(name):
        return
    gefunden.setdefault(name, str(pfad.relative_to(WURZEL)))


gefunden: dict[str, str] = {}
for name in QUELLBAEUME:
    baum = WURZEL / name
    if not baum.is_dir():
        print(f"  WARNUNG: {name}/ nicht gefunden — umgezogen?")
        sys.exit(1)
    for pfad in dateien(baum):
        try:
            inhalt = pfad.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        inhalt = ohne_kommentarzeilen(inhalt)
        schale = pfad.suffix in (".sh", ".bash")
        for muster in ZUGRIFF:
            for treffer in muster.findall(inhalt):
                if schale and shell_setzt_selbst(inhalt, treffer):
                    continue
                merken(gefunden, treffer, pfad)
        if pfad.suffix in (".sh", ".bash"):
            # findall liefert je Treffer ein Tupel der drei Zweige; nur der
            # gefuellte zaehlt.
            selbst_gesetzt = {n for t in SHELL_SETZT.findall(inhalt) for n in t if n}
            for treffer in SHELL_NACKT.findall(inhalt):
                if treffer not in selbst_gesetzt:
                    merken(gefunden, treffer, pfad)
        if BERUEHRT_UMGEBUNG.search(inhalt):
            for treffer in KONSTANTE.findall(inhalt):
                merken(gefunden, treffer, pfad)

if not gefunden:
    print("  WARNUNG: keine einzige Umgebungsvariable gelesen — Praefix geaendert?")
    sys.exit(1)

doku = ""
for name in DOKU_DATEIEN:
    pfad = WURZEL / name
    if pfad.exists():
        doku += pfad.read_text(encoding="utf-8", errors="ignore")
for name in DOKU_BAEUME:
    baum = WURZEL / name
    if not baum.is_dir():
        continue
    for pfad in sorted(baum.rglob("*.md")):
        doku += pfad.read_text(encoding="utf-8", errors="ignore")

# ABSICHTLICH NICHT gegen `AUDIT-*.md` gehalten. Eine Audit-Datei ruft
# niemanden; `test:frontend-api` stand dort zweimal und war 22 Tage kaputt
# (siehe tools/npm-skripte-deckung.py). Ein Befund ist keine Doku.
if not doku:
    print("  WARNUNG: kein Handbuch gefunden — umbenannt?")
    sys.exit(1)

luecken: list[str] = []
print("── Umgebungsvariablen, die src/ oder scripts/ liest und kein Handbuch nennt ──")
for name in sorted(gefunden):
    # In Backticks gesucht, wie bei Rechten und Sektionen: ein nackter Name
    # koennte zufaellig in einem Beispielblock stehen. `NAME=1` zaehlt mit —
    # bei den Riegeln ist der WERT die halbe Aussage, und `MUPIBOX_HERKUNFT_AUS`
    # ohne die `=1` zu nennen waere die schlechtere Doku.
    if not re.search(rf"`{name}(?:`|=)", doku):
        print(f"  FEHLT in der Doku: {name}  ({gefunden[name]})")
        luecken.append(name)

print()
if not luecken:
    print(f"KEINE LUECKE. {len(gefunden)} Umgebungsvariablen, alle dokumentiert.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N) von {len(gefunden)} Umgebungsvariablen.")
sys.exit(1)
