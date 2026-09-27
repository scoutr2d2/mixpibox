#!/usr/bin/env python3
"""ZITIERTE SCHALTER — nimmt das Skript den Schalter noch an, den die Doku tippt?

WOZU (27.08.2026): die Wachen in `tools/doku-luecken-probe.sh` decken den
AUFRUF inzwischen von mehreren Seiten ab — `doku-pfade-pruefen.py` fragt, ob
die Datei existiert, `endpunkt-zitate-pruefen.py` und `endpunkt-verben-
pruefen.py` fragen nach Pfad und Verb einer Route, `npm-skripte-deckung.py`
nach den Skripten der Wurzel. KEINE liest, was HINTER dem Dateinamen steht.

Die Doku tippt aber ganze Befehlszeilen ab:

    bash tools/pruefen.sh --schnell
    python3 controller/wiki.py capture --wiki <ordner> --set kind=signature
    sudo /opt/mupibox-tools/bootwache.py --zuruecknehmen

Der Schaden hat dieselbe Bauart wie beim falschen Verb: ein Schalter, den es
nicht mehr gibt, ist kein Tippfehler mit Fehlermeldung „unbekannte Option"
und fertig. `argparse` bricht ab, ein `case` in Bash faellt in den
`*)`-Zweig, und ein Werkzeug, das seine Argumente per `"--x" in argv` liest
(so wie `mupibox-bootwache.py`), IGNORIERT den unbekannten Schalter still und
tut stattdessen seine Standardsache. Beim Zuruecknehmen einer `config.txt`
heisst das: der Leser glaubt, er habe sofort zurueckgedreht, und in Wahrheit
lief nur die Fristpruefung.

── WAS DER ERSTE LAUF FAND ────────────────────────────────────────────────
NICHTS — alle zitierten Schalter gibt es. Das ist die ehrliche Auskunft und
kein Grund, die Wache wegzulassen: die Achse war ungeprueft, und sie faellt
still (siehe oben). Sie ist ab jetzt gehalten.

── DER EIGENTLICHE FUND WAR DIE AUFLOESUNG ────────────────────────────────
Die erste, schnelle Fassung dieser Suche loeste den Befehl ueber den
BASISNAMEN auf (`wiki.py` → irgendein `wiki.py` im Baum). Sie meldete vier
Funde, und DREI davon waren falsch:

    llmwiki/README.md `--llm`     → sie las tools/wiki-*.py statt
                                    remote-step-installer/controller/rsi.py
    README.md `--set` an rsi.py   → der Satz ruft wiki.py capture, nicht rsi.py
    `/opt/…/bootwache.py`         → als Repo-Pfad gelesen, den es nie gab

Ein Basisname ist im Baum nicht eindeutig (fuenf `wiki*.py` allein in
`tools/`), und eine Befehlszeile nennt ihr Ziel so, wie der LESER es tippt:
relativ zu dem Ordner, in dem sein Handbuch liegt, oder als GERAETEPFAD, den
es im Repo per Definition nicht gibt. Diese Wache loest darum in dieser
Reihenfolge auf und meldet, was sie nicht aufloesen konnte, statt es
stillschweigend als „gedeckt" zu zaehlen — ein stiller Ausschluss liest
sich wie Deckung.

── SIE LIEST AUCH QUELLTEXTE (31.08.2026) ─────────────────────────────────
Die erste Fassung las nur `.md`. Der Fund, der sie hierher gebracht hat, lag
in einem PYTHON-STRING — und zwar in einem, der dem Betreiber ANGEZEIGT wird:

    sdstart.py:1467  'Anlegen mit tools/paketbuendel-bauen.py --box …'

`--box` gab es zu dem Zeitpunkt seit einem Tag nicht mehr (Commit eb9af74f
nahm es weg, weil der Beschaffungsweg keine Box mehr voraussetzt). Der Satz
erschien genau dann, wenn kein Buendel dalag — also genau dem Leser, der ihn
befolgen wollte, und `argparse` haette ihm den Aufruf um die Ohren gehauen.

EINE HANDLUNGSANWEISUNG IST DOKU, EGAL IN WELCHER DATEI SIE STEHT. Ein
`print()` mit einem Befehl darin ist naeher am Leser als jede README. Darum
sind `.py`, `.sh` und `.mjs` jetzt Teil des Korpus (99 → 1183 gepruefte
Paare).

── ZWEI FEHLALARM-BAUARTEN, DIE DAS ERST MOEGLICH MACHTEN ─────────────────
Der erste Lauf ueber Quelltexte meldete 12 Funde, wovon 11 falsch waren. Sie
hatten nur zwei Bauarten, und beide sind jetzt ausgeschlossen:

  1. DAS ZIEL IST EINGABE, NICHT BEFEHL (6×).
     `esbuild src/backend-api/src/server.ts --bundle --minify` — die Schalter
     gehoeren esbuild, `server.ts` ist die Eingabedatei. → `ist_lauffaehig()`
  2. DER SCHALTER GEHOERT EINEM ZITIERTEN FREMDBEFEHL (2×).
     `rsi.py exec 'dpkg --configure -a'` — `--configure` gehoert dpkg auf der
     BOX, nicht rsi.py hier. → `ohne_fremdbefehl()`
  Dazu 3× die Wache selbst: ihr Sabotage-Text zitiert absichtlich einen toten
  Schalter. Ihre eigene Datei bleibt darum draussen.

EIN VERWORFENER WEG, DAMIT IHN NIEMAND WIEDER NIMMT: Bauart (1) ueber die
BEFEHLSPOSITION auszuschliessen („steht vor dem Ziel schon ein Befehl?")
raeumte zwar alle 11 Fehlalarme ab — und verschluckte den ECHTEN Fund gleich
mit. Vor `tools/paketbuendel-bauen.py` steht dort das deutsche Wort „mit",
und das sieht wie ein Befehlsname aus. Prosa und Shell teilen sich diese
Achse; sie taugt nicht zum Trennen.

── WAS SIE NICHT TUT, und warum das Absicht ist ───────────────────────────
  * Sie fragt nur, ob die Zeichenkette des Schalters in der Zieldatei
    VORKOMMT — nicht, ob sie dort ausgewertet wird. Ein Schalter, der nur
    noch im Kopfkommentar steht, kommt durch. Untergrenze, kein falsches
    Gruen; die Gegenrichtung waere ein Parser je Sprache.
  * Mehrdeutige und unaufloesbare Nennungen sind KEINE Luecke, sondern eine
    gemeldete Zahl. Sonst meldete die Wache dauerhaft rot und wuerde zu Recht
    ignoriert (llmwiki: `dauerrote-wache-ist-keine`).
  * Ein Ausrollweg, der beim Kopieren UMBENENNT, entwischt der Regel aus (3).
    `/opt/mupibox-tools/bootwache.py` loest auf `scripts/box/bootwache.py`
    auf, weil nur dieser eine Basisname passt — die zweite, auseinander-
    gelaufene Fassung heisst `remote-step-installer/tools/mupibox-bootwache.py`
    und wird gar nicht erst als Kandidatin gesehen. Heute nehmen BEIDE
    Fassungen `--zuruecknehmen`, der Befund waere also derselbe; verlassen
    darf man sich darauf nicht.
  * VERNEINUNG kommt durch: „`--kalt` gibt es nicht mehr" ist die Wahrheit
    ueber einen Schalter, keine falsche Anleitung — derselbe Grund wie bei
    `endpunkt-verben-pruefen.py`.
  * `AUDIT-JJJJ-MM-TT.md` sind Momentaufnahmen und bleiben draussen, aus
    demselben Grund wie bei `doku-pfade-pruefen.py`. Ihre Zahl wird gemeldet.

WARNUNG STATT GRUEN, wenn sie kein einziges aufloesbares Paar findet: dann
hat sich eine Schreibweise geaendert und die Wache ist blind, nicht sauber
(llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/zitierte-schalter-pruefen.py
Gegenprobe:                        python3 tools/zitierte-schalter-pruefen.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = Wache blind.
"""

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Dieselbe SORTE wie `doku-pfade-pruefen.py`: jede getrackte Prosadatei, nicht
# eine gepflegte Namensliste (llmwiki: `bauanleitung-ist-eine-vierte-sorte-datei`).
PROSA_ZUSATZ = ("dokumentation/benutzerhandbuch.html", "harness/docker-compose.yml")
MOMENTAUFNAHME = re.compile(r"(^|/)AUDIT-\d{4}-\d{2}-\d{2}\.md$")

# Ein Befehlsziel ist eine Datei mit ausfuehrbarer Endung, mit oder ohne Pfad.
ZIEL = r"[\w./@-]*?([\w.@-]+\.(?:py|sh|mjs|js|ts))"
# Danach Argumente bis zum Zeilen- oder Codeende. `\\\n` haelt umbrochene
# Befehlszeilen zusammen — die README schreibt `capture … \` ueber drei Zeilen.
ARGUMENTE = r"((?:[ \t]+(?:\\\n[ \t]*)?[^\s`|;&]+)*)"
NENNUNG = re.compile(ZIEL + ARGUMENTE)

# Mindestens ein Buchstabe nach den zwei Strichen: das haelt `---` (Trennlinie
# in Markdown, YAML-Kopf) und `------` aus Kaesten heraus.
SCHALTER = re.compile(r"(?<![\w-])(--[a-zA-Z][\w-]*)")

# Platzhalter, die kein echter Schalter sind.
PLATZHALTER = re.compile(r"[<>…\[\]{}]")

VERNEINT = re.compile(
    r"\b(kein|keine|keinen|keinerlei|nicht|nie|entfernt|weg|abgeschafft|"
    r"hiess|frueher)\b",
    re.IGNORECASE,
)


def prosadateien():
    """Jede getrackte Prosadatei — abgeleitet, nicht gepflegt."""
    aus = subprocess.run(
        ["git", "ls-files", "-z"],
        capture_output=True,
        text=True,
        check=True,
        cwd=WURZEL,
    ).stdout.split("\0")
    getrackt = {p for p in aus if p}
    # Auch Quelltexte: eine Handlungsanweisung im `print()` ist Doku (s. Kopf).
    # Die eigene Datei bleibt draussen — ihr Sabotage-Text zitiert absichtlich
    # einen toten Schalter, den sie sonst bei sich selbst faende.
    md = [
        p
        for p in getrackt
        if p.endswith((".md", ".py", ".sh", ".mjs"))
        and not p.endswith("zitierte-schalter-pruefen.py")
    ]
    uebersprungen = [p for p in md if MOMENTAUFNAHME.search(p)]
    dateien = sorted(set(md) - set(uebersprungen))
    dateien += [p for p in PROSA_ZUSATZ if p in getrackt]
    return sorted(dateien), sorted(uebersprungen), getrackt


def aufloesen(ziel, doku, getrackt, nach_basis):
    """So aufloesen, wie der LESER den Befehl tippt — nicht ueber den Basisnamen.

    Rueckgabe: (pfad, None) aufgeloest | (None, grund) nicht aufgeloest.
    """
    roh = ziel.strip().rstrip(".,;:")

    # 1) Wie geschrieben, von der Wurzel aus — so ruft die Doku Werkzeuge auf,
    #    die im Wurzel-Repo liegen (`tools/pruefen.sh --schnell`).
    if roh in getrackt:
        return roh, None

    # 2) Relativ zum ORDNER DES HANDBUCHS. `remote-step-installer/README.md`
    #    schreibt `controller/rsi.py`, weil sein Leser dort steht.
    naeher = str((Path(doku).parent / roh)).replace("\\", "/")
    naeher = str(Path(naeher).as_posix())
    if naeher in getrackt:
        return naeher, None

    # 3) GERAETEPFAD (`/opt/mupibox-tools/bootwache.py`). Im Repo gibt es ihn
    #    per Definition nicht; gemeint ist die Quelle, die dorthin ausgerollt
    #    wird. Nur bei GENAU EINER Quelle ist das eine Aussage — sonst raet man.
    basis = Path(roh).name
    kandidaten = nach_basis.get(basis, [])
    if roh.startswith("/"):
        if len(kandidaten) == 1:
            return kandidaten[0], None
        if not kandidaten:
            return None, f"Geraetepfad ohne Quelle im Baum ({roh})"
        return None, f"Geraetepfad, {len(kandidaten)} moegliche Quellen ({roh})"

    # 4) Blosser Name ohne Pfad — nur eindeutig verwertbar.
    if len(kandidaten) == 1:
        return kandidaten[0], None
    if not kandidaten:
        return None, f"kein Ziel im Baum ({roh})"
    return None, f"{len(kandidaten)} Ziele gleichen Namens ({roh})"


def ohne_fremdbefehl(argumente):
    """Alles ab dem ersten Anfuehrungszeichen abschneiden.

    `rsi.py exec 'dpkg --configure -a'` — `--configure` gehoert dpkg auf der
    BOX, nicht rsi.py hier. Ein zitierter Blob ist ein fremder Befehl oder ein
    Wert, nie ein Schalter des aeusseren Werkzeugs.
    """
    for zeichen in ("'", '"'):
        i = argumente.find(zeichen)
        if i != -1:
            argumente = argumente[:i]
    return argumente


# Ein Werkzeug, das Schalter annimmt, LIEST seine Argumente. Das ist die SORTE,
# nach der hier gefragt wird — nicht `tools/` und nicht die Endung; dieselbe
# Denkweise wie bei der Korpuswahl oben
# (llmwiki: `bauanleitung-ist-eine-vierte-sorte-datei`).
#
# NICHT `shift` oder `$1` mitnehmen: `.shift()` ist eine Array-Methode und
# machte `server.ts` prompt wieder „lauffaehig" — samt aller sechs Fehlalarme.
NIMMT_ARGUMENTE = re.compile(r"process\.argv|sys\.argv|argparse|getopts")

_lauffaehig = {}


def ist_lauffaehig(zielpfad, modi):
    """Ruft man das Ziel AUF — oder ist es die Eingabe eines anderen Befehls?

    `esbuild src/server.ts --bundle` nennt `server.ts` als EINGABE; die
    Schalter gehoeren esbuild. `server.ts` hat weder Shebang noch Ausfuehrbit
    noch liest es argv, `paketbuendel-bauen.py` hat alles drei.

    DREI MERKMALE ODER-VERKNUEPFT, weil jedes einzeln Loecher hat: ein Edit
    nimmt das Ausfuehrbit still weg, und `.mjs`-Werkzeuge laufen ueber `node`
    und haben nie einen Shebang.
    """
    if zielpfad not in _lauffaehig:
        kopf, inhalt = "", ""
        try:
            roh = (WURZEL / zielpfad).read_bytes()
            kopf = roh[:2].decode("ascii", "replace")
            inhalt = roh.decode("utf-8", "replace")
        except OSError:
            pass
        _lauffaehig[zielpfad] = (
            kopf == "#!"
            or modi.get(zielpfad, "").endswith("755")
            or bool(NIMMT_ARGUMENTE.search(inhalt))
        )
    return _lauffaehig[zielpfad]


def dateimodi():
    """Ausfuehrbit laut Index — nicht laut Arbeitsbaum."""
    modi = {}
    aus = subprocess.run(
        ["git", "ls-files", "-s"],
        capture_output=True,
        text=True,
        check=True,
        cwd=WURZEL,
    ).stdout
    for zeile in aus.splitlines():
        teil = zeile.split("\t", 1)
        if len(teil) == 2:
            modi[teil[1]] = teil[0].split()[0]
    return modi


def zeile_von(text, pos):
    return text.count("\n", 0, pos) + 1


def main():
    sabotage = "--sabotage" in sys.argv
    handbuecher, momentaufnahmen, getrackt = prosadateien()
    if not handbuecher:
        print("  WARNUNG: keine Prosadatei gefunden — laeuft die Wache im Repo?")
        return 2

    modi = dateimodi()

    nach_basis = defaultdict(list)
    for p in getrackt:
        nach_basis[Path(p).name].append(p)

    print(f"  {len(handbuecher)} Prosadatei(en) gelesen.")
    if momentaufnahmen:
        print(f"  {len(momentaufnahmen)} Momentaufnahme(n) (AUDIT-*.md) uebersprungen.")

    paare = 0
    funde = 0
    offen = defaultdict(int)

    for rel in handbuecher:
        pfad = WURZEL / rel
        try:
            text = pfad.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        if sabotage:
            # GEGENPROBE: ein Aufruf eines Werkzeugs, das es gibt, mit einem
            # Schalter, den es sicher nicht kennt. Nichts wird auf Platte
            # geschrieben (llmwiki: `gegenprobe-statt-gruen-glauben`).
            if rel == handbuecher[0]:
                text += "\n\nZum Pruefen ruft man `bash tools/pruefen.sh --gibtsnicht` auf.\n"

        for m in NENNUNG.finditer(text):
            schalter = [
                s
                for s in SCHALTER.findall(ohne_fremdbefehl(m.group(2)))
                if not PLATZHALTER.search(s)
            ]
            if not schalter:
                continue

            zielpfad, grund = aufloesen(m.group(0)[: m.end(1) - m.start(0)],
                                        rel, getrackt, nach_basis)
            if zielpfad is None:
                offen[grund] += 1
                continue

            # Ist das Ziel ueberhaupt etwas, das Schalter annimmt? Sonst
            # gehoeren sie dem Befehl davor (Bauart 1 im Kopf).
            if not ist_lauffaehig(zielpfad, modi):
                continue

            try:
                quelle = (WURZEL / zielpfad).read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError:
                offen[f"Ziel nicht lesbar ({zielpfad})"] += 1
                continue

            nr = zeile_von(text, m.start())
            zeilentext = text.splitlines()[nr - 1] if nr <= len(text.splitlines()) else ""

            for s in schalter:
                paare += 1
                if re.search(rf"(?<![\w-]){re.escape(s)}(?![\w-])", quelle):
                    continue
                if VERNEINT.search(zeilentext):
                    continue
                funde += 1
                kurz = re.sub(r"\s+", " ", zeilentext).strip()[:150]
                print(f"  TOTER SCHALTER: {rel}:{nr} → {s}")
                print(f"    {zielpfad} kennt ihn nicht.")
                print(f"    {kurz}")

    if offen:
        gesamt = sum(offen.values())
        print(f"  {gesamt} Nennung(en) nicht aufloesbar (keine Luecke, nur ungeprueft):")
        for grund, n in sorted(offen.items(), key=lambda x: -x[1])[:8]:
            print(f"    {n}×  {grund}")

    if paare == 0:
        print("  WARNUNG: kein einziger aufloesbarer Befehl mit Schalter gefunden.")
        print("  — schreibt die Doku Aufrufe anders, oder ist der Korpus leer?")
        return 2

    print(f"  {paare} zitierte(r) Schalter mit aufloesbarem Ziel geprueft.")
    if funde:
        print(f"\n{funde} LUECKE(N).")
        return 1
    print("\nKEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
