#!/usr/bin/env python3
"""Welche Klassen und Farbtoken in NewDesign/app.css liest niemand mehr?

WOZU. Am 19.09.2026 stand `NewDesign/app.css` mit 473.145 B ueber dem Deckel
von 465.000 B (tools/neu-groessen-schau.mjs). Das Audit desselben Tages (Rang 6)
nannte ~1.000 abbaubare Zeilen — und im selben Atemzug die Falle, an der jede
Textsuche scheitert: `pwf-*`, `pw-*` und `marke-*` SEHEN tot aus, werden aber
ZUSAMMENGESETZT (`pwf-${i}` in app.js, `marke-${d}` ebenda). Wer nach dem
vollen Klassennamen sucht, findet sie NIE und loescht lebenden Stil.

Genau das ist auch der Grund, warum `tools/dienste-deckung.mjs` falsch-rot
stand: ihr Regex frisst `.marke-gilt`/`.marke-nebenher`, die keine Dienste sind.

WAS ES TUT — UND WAS AUSDRUECKLICH NICHT.
Es LOESCHT NICHTS und es urteilt nicht ueber einzelne Namen. Es sortiert sie
in Toepfe; nur die beiden ersten sind Kandidaten, alle anderen sind Gruende,
die Finger davonzulassen:

  TOT            kein Treffer im Code, kein zusammengesetzter Name passt
  NUR-KOMMENTAR  der einzige Treffer steht in Prosa — dieser Baum zitiert
                 Klassennamen in Begruendungen, und ein Zitat ist keine
                 Gegenstelle ([[kommentar-und-kompilat-sind-keine-gegenstelle]])
  NUR-GENANNT    der Name steht als blosse Zeichenkette da (Token), ohne dass
                 ihn jemand liest — etwa ein Test, der seine NICHTbenutzung
                 festhaelt
  NUR-WACHE      nur ein Werkzeug in tools/ liest ihn. Loeschen macht die
                 Wache rot, nicht die Oberflaeche kaputt — beides pruefen
  ERZEUGER       ein Werkzeug ERZEUGT diesen Wert und prueft ihn zurueck
                 (`--line` steht dort als Farbrolle `line:` ohne die zwei
                 Striche — jede `--`-Suche geht daran vorbei)
  ZUSAMMENGESETZT  ein `praefix-${...}` oder `${...}-endung` im Code KOENNTE
                 den Namen bauen -> FINGER WEG, auch wenn er nirgends steht

`--pruefen` urteilt ueber KEINEN dieser Toepfe, sondern ueber die andere
Richtung: jeder Wert, den eine Zusammensetzung bauen kann, braucht seine
Regel in app.css. Wer `.marke-plugin` loescht, weil die Textsuche nichts
fand, wird hier rot. Die Befundliste urteilt NICHT — waere sie ein Verbot,
stuende die Wache am Tag nach dem ersten bewusst vorgehaltenen Entwurf
dauerrot und verdeckte den naechsten echten Fund
([[dauerrote-wache-ist-keine]]).

WELCHE DATEIEN GEGENSTELLE SIND. `NewDesign/*.js|*.mjs|*.html` und `src/`
ohne `src/deploy/`. NICHT dabei, und das ist kein Versehen:

  src/deploy/…            Auslieferstand/Kompilat — es BEWEIST keine Benutzung,
                          es ist eine Kopie ([[kommentar-und-kompilat-sind-keine-gegenstelle]])
  NewDesign/MixPiBox-standalone.html
                          Schnappschuss vom 31.07.2026, 3,8 MB, vollstaendig
                          in sich (eigenes <style>) — laedt app.css nicht
  tools/…                 Wachen. Ein Treffer dort heisst „eine Wache liest
                          das", nicht „die Oberflaeche benutzt es"; deshalb
                          wird er getrennt gemeldet (Spalte WACHE)

AUFRUF
  python3 tools/tote-stile-schau.py                Bilanz + alle Toepfe
  python3 tools/tote-stile-schau.py --lang         jeden Namen einzeln
  python3 tools/tote-stile-schau.py --ids          statt Klassen: die
                                                   id-Attribute in index.html
  python3 tools/tote-stile-schau.py --fragen .kopf-knopf --fragen=--line
                                                   genau diese Namen pruefen
                                                   (Ende 1, wenn einer LEBT).
                                                   `--fragen=--x` mit
                                                   Gleichheitszeichen, sonst
                                                   haelt argparse `--x` fuer
                                                   einen eigenen Schalter.
  python3 tools/tote-stile-schau.py --pruefen      still; Ende 1, wenn ein
                                                   Wert einer Zusammensetzung
                                                   keine Regel mehr hat
                                                   (haengt in tools/pruefen.sh)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
CSS = WURZEL / "NewDesign" / "app.css"

# ── Die Zusammensetzungen, die keine Textsuche findet ─────────────────────
#
# ── DER ERSTE ANLAUF WAR EINE NAMENSLISTE, UND SIE WAR SCHON BEIM SCHREIBEN
#    VERALTET ───────────────────────────────────────────────────────────────
# Hier standen am 19.09.2026 acht Namen fuer `marke-` (sechs Dienste plus
# `gilt`/`nebenher`). Es fehlte `marke-plugin` — der siebte Dienst, seit
# Wochen im Baum. Eine Nachbarsitzung hat es gefunden, nicht diese Wache. Eine
# Liste von Namen veraltet beim naechsten Dienst genau so wieder, und dann
# laesst sie durch, was sie bewachen soll: [[gegenprobe-bleibt-gruen-ist-der-fund]].
#
# ── DAS KRITERIUM IST DIE QUELLE DER WERTE, NICHT IHRE AUFZAEHLUNG ─────────
# Hier steht deshalb nur, WO im Code die Werte herkommen, die der Praefix
# anhaengt — gelesen wird sie bei jedem Lauf. Kommt ein Dienst dazu, ist er
# sofort mitbewacht; nur wenn jemand die QUELLE umbaut (Objekt umbenennt,
# anders aufzaehlt), muss hier etwas nachgezogen werden — und dann wirft der
# Leser laut, statt still gruen zu bleiben. Dieselbe Bauart wie
# `plakettenFarbenAus`/`objektSchluessel` in tools/dienste-deckung.mjs, und
# dieselbe Hausregel: [[wache-auf-sorte-nicht-auf-pfad]].
#
# WOERTLICHE ZUSTANDSKLASSEN GEHOEREN NICHT HIERHER. `marke-gilt` und
# `marke-nebenher` stehen woertlich am Bauplatz (app.js:3455) — die gewoehnliche
# Textsuche findet sie. Was hier gebraucht wird, ist nur das, was NIE woertlich
# dasteht.
ZUSAMMENSETZUNGEN: tuple[dict[str, str], ...] = (
    {
        "praefix": "marke-",
        "bauplatz": "NewDesign/app.js  `marke marke-${d}` (und `np-quelle marke marke-${dienst}`)",
        "quelle": "NewDesign/app.js",
        "lesen": "objekt-schluessel:DIENST_MARKEN",
        "warum": "Jeder Dienst braucht seine Plakette; fehlt die Regel, ist sie unsichtbar.",
    },
    {
        "praefix": "pwf-",
        "bauplatz": "NewDesign/app.js  `pw-farbe pwf-${i}`",
        "quelle": "NewDesign/app.js",
        "lesen": "feld-index:PW_FARBEN",
        "warum": "Eine Farbtaste je Eintrag in PW_FARBEN — ohne Regel ist die Taste farblos.",
    },
)


# ── Die Werte einer Zusammensetzung aus dem Code lesen ────────────────────
#
# BEIDE LESER WERFEN, wenn sie ihre Quelle nicht finden. Eine Wache, die den
# Gegenstand verliert und daraufhin nichts mehr meldet, ist die schlimmste
# Sorte Gruen — derselbe Grund, aus dem `plakettenFarbenAus` in
# tools/dienste-deckung.mjs zweimal wirft.
def _block(text: str, auf: str, zu: str, ab: int) -> str:
    """Von `ab` bis zur passenden schliessenden Klammer — Klammern gezaehlt.

    Ein `[^}]*` scheitert hier: DIENST_MARKEN enthaelt je Dienst ein eigenes
    Objekt, die erste `}` schliesst also den Dienst und nicht die Liste.
    """
    tiefe, i = 0, ab
    while i < len(text):
        if text[i] == auf:
            tiefe += 1
        elif text[i] == zu:
            tiefe -= 1
            if tiefe == 0:
                return text[ab + 1 : i]
        i += 1
    raise ValueError(f"Klammer ab Zeichen {ab} wird nie geschlossen")


def objekt_schluessel(code: str, name: str) -> list[str]:
    """Die Schluessel der OBERSTEN Ebene eines `const NAME = { … }`."""
    m = re.search(r"\bconst\s+" + re.escape(name) + r"\b[^=]*=\s*\{", code)
    if not m:
        raise ValueError(f"`const {name} = {{ … }}` nicht gefunden — heisst es noch so?")
    rumpf = _block(code, "{", "}", m.end() - 1)
    schluessel, tiefe = [], 0
    for t in re.finditer(r"[{}\[\]]|(^|,)\s*'?([A-Za-z_][\w-]*)'?\s*:", rumpf, flags=re.M):
        if t.group(0) in "{[":
            tiefe += 1
        elif t.group(0) in "}]":
            tiefe -= 1
        elif tiefe == 0 and t.group(2):
            schluessel.append(t.group(2))
    if not schluessel:
        raise ValueError(f"{name} hat keine Schluessel — anders aufgezaehlt?")
    return schluessel


def feld_index(code: str, name: str) -> list[str]:
    """Die INDIZES eines `const NAME = [ … ]` — '0', '1', … als Namensteile."""
    m = re.search(r"\bconst\s+" + re.escape(name) + r"\b[^=]*=\s*\[", code)
    if not m:
        raise ValueError(f"`const {name} = [ … ]` nicht gefunden — heisst es noch so?")
    rumpf = _block(code, "[", "]", m.end() - 1)
    anzahl = len([s for s in re.split(r",(?![^\[{]*[\]}])", rumpf) if s.strip()])
    if not anzahl:
        raise ValueError(f"{name} ist leer — anders aufgezaehlt?")
    return [str(i) for i in range(anzahl)]


def werte_der_zusammensetzung(eintrag: dict[str, str]) -> list[str]:
    art, name = eintrag["lesen"].split(":", 1)
    code = entkommentieren(
        WURZEL / eintrag["quelle"],
        (WURZEL / eintrag["quelle"]).read_text(encoding="utf-8"),
    )
    if art == "objekt-schluessel":
        return objekt_schluessel(code, name)
    if art == "feld-index":
        return feld_index(code, name)
    raise ValueError(f"unbekannte Leseart `{art}`")


# ── Kommentare weg, sonst ist jedes Zitat eine Gegenstelle ────────────────
def js_ohne_kommentar(text: str) -> str:
    """Zeilen- und Blockkommentare aus JS entfernen, Strings in Ruhe lassen.

    WARUM VON HAND UND NICHT MIT EINEM REGEX: in diesem Baum steht die halbe
    Begruendung in Kommentaren, und die zitieren Klassennamen. Ein Regex ueber
    `/\\*.*?\\*/` trifft auch das, was in einem String steht — und ein Backtick
    im Kommentar innerhalb eines Template-Literals reisst ohnehin alles ab
    ([[backticks-beenden-jede-vorlage]]).

    REGEX-LITERALE werden uebersprungen, damit `/\\//` nicht als Kommentar
    gilt. Erkannt werden sie an dem, was DAVOR steht: nach einem Wert kann
    kein Regex beginnen, nach `( , = : [ ! & | ? { } ; + - * % ~ ^ return`
    schon.
    """
    raus: list[str] = []
    i, n = 0, len(text)
    letztes = ""  # letztes bedeutungstragendes Zeichen
    while i < n:
        c = text[i]
        if c in "'\"":
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == c:
                    break
                if text[j] == "\n":  # unabgeschlossen — nicht weiterraten
                    break
                j += 1
            raus.append(text[i : j + 1])
            letztes = c
            i = j + 1
            continue
        if c == "`":
            j, tiefe = i + 1, 0
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                    tiefe += 1
                    j += 2
                    continue
                if text[j] == "}" and tiefe:
                    tiefe -= 1
                    j += 1
                    continue
                if text[j] == "`" and not tiefe:
                    break
                j += 1
            raus.append(text[i : j + 1])
            letztes = "`"
            i = j + 1
            continue
        if c == "/" and i + 1 < n:
            if text[i + 1] == "*":
                ende = text.find("*/", i + 2)
                bis = n if ende < 0 else ende + 2
                # Zeilenumbrueche BLEIBEN stehen: sonst wandern alle
                # Zeilennummern hinter dem ersten Kommentar, und eine Wache,
                # die auf die falsche Zeile zeigt, kostet mehr Zeit als sie
                # spart.
                raus.append("\n" * text.count("\n", i, bis))
                i = bis
                continue
            if text[i + 1] == "/":
                ende = text.find("\n", i)
                i = n if ende < 0 else ende
                raus.append(" ")
                continue
            if letztes == "" or letztes in "(,=:[!&|?{};+-*%~^<>":
                j = i + 1
                while j < n:
                    if text[j] == "\\":
                        j += 2
                        continue
                    if text[j] == "[":
                        while j < n and text[j] != "]":
                            j += 2 if text[j] == "\\" else 1
                    if text[j] in "/\n":
                        break
                    j += 1
                raus.append(text[i : j + 1])
                letztes = "/"
                i = j + 1
                continue
        raus.append(c)
        if not c.isspace():
            letztes = c
        i += 1
    return "".join(raus)


def _leer_mit_zeilen(m: re.Match[str]) -> str:
    """Kommentar durch seine eigenen Zeilenumbrueche ersetzen — Zeilen halten."""
    return "\n" * m.group(0).count("\n")


def html_ohne_kommentar(text: str) -> str:
    return re.sub(r"<!--.*?-->", _leer_mit_zeilen, text, flags=re.S)


def css_ohne_kommentar(text: str) -> str:
    return re.sub(r"/\*.*?\*/", _leer_mit_zeilen, text, flags=re.S)


def entkommentieren(pfad: Path, text: str) -> str:
    if pfad.suffix in (".js", ".mjs", ".ts", ".cjs"):
        return js_ohne_kommentar(text)
    if pfad.suffix in (".html", ".htm", ".svg"):
        return html_ohne_kommentar(js_ohne_kommentar(html_ohne_kommentar(text)))
    if pfad.suffix in (".css", ".scss"):
        return css_ohne_kommentar(text)
    return text


# ── Korpus ───────────────────────────────────────────────────────────────
AUSGENOMMEN_TEIL = (
    "/node_modules/",
    "/.claude/",
    "/src/deploy/",
    "/dist/",
    "/.git/",
    # Angulars Baucache: dieselben Quellen, einmal durch babel gedreht. Er
    # sagte beim ersten Lauf `--line` LEBT, obwohl dort nur ein Test steht,
    # der die Nichtbenutzung festhaelt.
    "/.angular/",
)
# Schnappschuss, kein Verbraucher: vollstaendig in sich, laedt app.css nicht.
AUSGENOMMEN_DATEI = ("NewDesign/MixPiBox-standalone.html",)
ENDUNGEN = (".js", ".mjs", ".ts", ".html", ".htm", ".json", ".css", ".svg")


def dateien(wurzeln: list[str]) -> list[Path]:
    raus: list[Path] = []
    for w in wurzeln:
        basis = WURZEL / w
        if basis.is_file():
            raus.append(basis)
            continue
        for p in sorted(basis.rglob("*")):
            if not p.is_file() or p.suffix not in ENDUNGEN:
                continue
            s = "/" + str(p.relative_to(WURZEL))
            if any(a in s for a in AUSGENOMMEN_TEIL):
                continue
            if any(str(p.relative_to(WURZEL)) == a for a in AUSGENOMMEN_DATEI):
                continue
            raus.append(p)
    return raus


class Korpus:
    """Ein Textbestand, einmal roh und einmal ohne Kommentare."""

    def __init__(self, wurzeln: list[str], ohne: Path | None = None) -> None:
        self.roh: dict[Path, str] = {}
        self.code: dict[Path, str] = {}
        for p in dateien(wurzeln):
            if ohne is not None and p == ohne:
                continue
            try:
                t = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            self.roh[p] = t
            self.code[p] = entkommentieren(p, t)

    def suchen(self, muster: re.Pattern[str], quelle: dict[Path, str]) -> list[str]:
        raus = []
        for p, t in quelle.items():
            m = muster.search(t)
            if m:
                # Traegt das Muster eine Gruppe, gilt IHR Anfang: sonst zeigt
                # die Fundstelle auf das Komma der Zeile davor, weil `\s*`
                # ueber den Zeilenumbruch laeuft.
                ab = m.start(1) if m.re.groups else m.start()
                zeile = t.count("\n", 0, ab) + 1
                raus.append(f"{p.relative_to(WURZEL)}:{zeile}")
        return raus


# ── Namen aus app.css holen ──────────────────────────────────────────────
def klassen_aus_css(css_code: str) -> dict[str, int]:
    """Klassennamen aus den SELEKTOREN, mit der Zeile ihres ersten Auftretens."""
    raus: dict[str, int] = {}
    # Nur vor einer `{`-Klammer stehende Teile sind Selektoren; Werte wie
    # `content: '.foo'` sollen nicht mitkommen.
    # `{` und `;` sind ebenfalls Grenzen: sonst faellt jede Regel INNERHALB
    # eines `@media { … }` heraus — davor steht keine `}`, sondern `{`.
    for m in re.finditer(r"(^|[{};])([^{}@;]*)\{", css_code, flags=re.S):
        block = m.group(2)
        start = m.start(2)
        for k in re.finditer(r"\.(-?[A-Za-z_][A-Za-z0-9_-]*)", block):
            name = k.group(1)
            if name not in raus:
                raus[name] = css_code.count("\n", 0, start + k.start()) + 1
    return raus


def ids_aus_html(html_code: str) -> dict[str, int]:
    """Jedes `id="…"` in index.html, mit seiner Zeile."""
    raus: dict[str, int] = {}
    for m in re.finditer(r"""\bid=["']([A-Za-z][\w:.-]*)["']""", html_code):
        if m.group(1) not in raus:
            raus[m.group(1)] = html_code.count("\n", 0, m.start()) + 1
    return raus


def id_urteil(name: str, korpus: Korpus, wachen: Korpus, css_code: str) -> tuple[str, str]:
    """Liest irgendwer diese `id`?

    DIE LESER EINER `id` SIND ANDERE ALS DIE EINER KLASSE, und wer sie
    verwechselt, loescht das Falsche:

      getElementById / querySelector('#x') / getElementsByIdentifier   Skript
      der BLANKE Name in Anfuehrungszeichen                            Skript
      `#x` als Wahler in app.css                                       Stil
      for= / aria-labelledby= / aria-controls= / aria-describedby=     HTML
      href="#x" / list= / form= / headers= / usemap=                   HTML

    Die aria-Verweise sind der gefaehrlichste Topf: sie sind fuer Sehende
    unsichtbar, und wer die `id` zieht, merkt es nie — die Vorlesestimme sagt
    dann nur nichts mehr.

    ── DER BLANKE NAME IST PFLICHT, SONST LUEGT DIESE WACHE ──────────────────
    app.js:262 haelt `const $ = (id) => document.getElementById(id)` und ruft
    danach `$('mp-zeit')`. Ohne diese Zeile meldete der erste Lauf 48 tote
    `id`s, darunter reihenweise lebende. Der Preis ist Absicht: ein Name, der
    nur zufaellig auch als Zeichenkette vorkommt, gilt hier als Leser und die
    `id` bleibt stehen. Zu viel stehen zu lassen kostet Bytes, zu viel zu
    ziehen kostet eine stumme Oberflaeche.
    """
    n = re.escape(name)
    m_code = re.compile(
        r"""getElementById\(\s*['"]""" + n + r"""['"]"""
        r"""|querySelector(?:All)?\(\s*['"][^'"]*#""" + n + r"""(?![\w-])"""
        r"""|['"`]#?""" + n + r"""['"`]"""
        # REGEX-ALTERNATIVE: tools/maskottchen-zaehlen.mjs:199 liest `e.id`
        # und prueft ihn gegen `/ich-kachel-bild|kachel-bild|mp-cover|gr-cover/`.
        # Kein Anfuehrungszeichen weit und breit — der erste Lauf hielt
        # `#mp-cover` deshalb fuer tot, obwohl seine Entfernung die Wache
        # umgeurteilt haette (Katalogplatz -> Stimmungstraeger).
        r"""|[/|]""" + n + r"""[/|]"""
        r"""|\b(?:for|aria-labelledby|aria-controls|aria-describedby|aria-owns|aria-activedescendant|list|form|headers|usemap|popovertarget|href)=["'][^"']*(?<![\w-])#?"""
        + n
        + r"""(?![\w-])"""
    )
    m_css = re.compile(r"#" + n + r"(?![\w-])")

    if m_css.search(css_code):
        z = css_code.count("\n", 0, m_css.search(css_code).start()) + 1
        return "LEBT", f"NewDesign/app.css:{z} (Wahler)"
    treffer = korpus.suchen(m_code, korpus.code)
    if treffer:
        return "LEBT", ", ".join(treffer[:3])
    roh = korpus.suchen(m_code, korpus.roh)
    w = sorted(set(wachen.suchen(m_code, wachen.code)))
    if roh:
        return "NUR-KOMMENTAR", ", ".join(roh[:2])
    if w:
        return "NUR-WACHE", ", ".join(w[:2])
    return "TOT", "kein Leser"


def token_aus_css(css_code: str) -> dict[str, int]:
    raus: dict[str, int] = {}
    for m in re.finditer(r"(--[A-Za-z][A-Za-z0-9_-]*)\s*:", css_code):
        if m.group(1) not in raus:
            raus[m.group(1)] = css_code.count("\n", 0, m.start()) + 1
    return raus


def zusammensetzbar(korpus: Korpus) -> tuple[set[str], set[str]]:
    """Welche Praefixe und Endungen baut der Code selbst zusammen?

    Praefix: `foo-${…}` oder `'foo-' +`.  Endung: `${…}-foo` oder `+ '-foo'`.
    Beides bewusst GROSSZUEGIG: ein zu breit erkannter Praefix kostet einen
    Befund, ein uebersehener kostet eine geloeschte lebende Regel.
    """
    praefixe: set[str] = set()
    endungen: set[str] = set()
    p_tmpl = re.compile(r"([A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*-)\$\{")
    p_kett = re.compile(r"['\"]([A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*-)['\"]\s*\+")
    e_tmpl = re.compile(r"\}(-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)")
    e_kett = re.compile(r"\+\s*['\"](-[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)['\"]")
    for t in korpus.code.values():
        for m in p_tmpl.finditer(t):
            praefixe.add(m.group(1))
        for m in p_kett.finditer(t):
            praefixe.add(m.group(1))
        for m in e_tmpl.finditer(t):
            endungen.add(m.group(1))
        for m in e_kett.finditer(t):
            endungen.add(m.group(1))
    return praefixe, endungen


def urteil(
    name: str,
    ist_token: bool,
    verbraucher: Korpus,
    wachen: Korpus,
    praefixe: set[str],
    endungen: set[str],
    css_code: str = "",
) -> tuple[str, str]:
    """(Topf, Begruendung) fuer EINEN Namen.

    EIN TOKEN UND EINE KLASSE HABEN VERSCHIEDENE GEGENSTELLEN, und das ist der
    Kern dieser Wache: `var(--x)` INNERHALB von app.css ist eine echte
    Benutzung — `.foo .bar` innerhalb von app.css ist keine, denn dort steht
    nur eine weitere Regel und kein Element, das die Klasse traegt.
    """
    if ist_token:
        # ZWEI ECHTE LESER, und nur die zaehlen: `var(--x)` im Stil und
        # `setProperty`/`getPropertyValue` im Skript. Der bloss GENANNTE Name
        # (`'--x'` irgendwo in einem String) ist KEINE Benutzung — beim ersten
        # Lauf meldete er `--line` als lebend, obwohl der einzige Treffer ein
        # Test war, der die NICHTbenutzung festhaelt.
        m_code = re.compile(
            r"var\(\s*" + re.escape(name) + r"\s*[,)]"
            r"|(?:setProperty|getPropertyValue|removeProperty)\(\s*['\"]" + re.escape(name) + r"['\"]"
        )
        m_js = re.compile(r"['\"]" + re.escape(name) + r"['\"]")
        # ── DER DRITTE LESER, UND ER HAT DIESE WACHE FAST BLAMIERT ─────────
        # `--line` sah am 19.09.2026 nach 24 Deklarationen ohne einen einzigen
        # Leser aus. Es hat einen: tools/farbsaetze-bauen.mjs ERZEUGT alle
        # sechzehn Farbsaetze und fuehrt die Rolle dort als `line: '#F3EDE2'`
        # — als blanken Objektschluessel OHNE die zwei Striche. Jede Suche
        # nach `--line` geht daran vorbei; `--pruefen` dieses Erzeugers haette
        # nach dem Loeschen 24 Mal „(fehlt)" gemeldet, und der naechste Lauf
        # des Erzeugers haette das Token wieder hineingeschrieben.
        #
        # Das Merkmal ist deshalb die SORTE und nicht der Name: ein
        # Objektschluessel, der eine HEX-FARBE traegt, ist eine Farbrolle.
        m_rolle = re.compile(
            r"(?:^|[{,])\s*('?" + re.escape(name[2:]) + r"'?\s*:\s*['\"]#[0-9A-Fa-f]{3,8}['\"])", re.M
        )
    else:
        # Wortgrenze von Hand: `-` gehoert zum Namen, `\b` wuerde
        # `.fach-fort` in `.fach-fortschritt` finden.
        m_code = re.compile(r"(?<![A-Za-z0-9_-])" + re.escape(name) + r"(?![A-Za-z0-9_-])")
        m_js = m_code

    # ZUERST DER WOERTLICHE TREFFER, DANN DIE ZUSAMMENSETZUNG. Umgekehrt
    # verschwanden `.marke-gilt`, `.pw-farbe` und `.ton-laeuft` im Topf
    # ZUSAMMENGESETZT, obwohl sie woertlich im Code stehen — die Auskunft „wo
    # steht es" ging dabei verloren, und `.ton-laeuft` haette sie sogar an
    # eine `id`-Bindung der Verwaltung verloren (`'ton-' + f.id`), die mit
    # Klassen nichts zu tun hat.
    if ist_token and css_code:
        m = re.search(r"var\(\s*" + re.escape(name) + r"\s*[,)]", css_code)
        if m:
            return "LEBT", f"NewDesign/app.css:{css_code.count(chr(10), 0, m.start()) + 1} var()"

    treffer = verbraucher.suchen(m_code, verbraucher.code)
    if treffer:
        return "LEBT", ", ".join(treffer[:3])

    if ist_token:
        erz = verbraucher.suchen(m_rolle, verbraucher.code) + wachen.suchen(m_rolle, wachen.code)
        if erz:
            return "ERZEUGER", "Farbrolle in " + ", ".join(sorted(set(erz))[:3])

    for pre in sorted(praefixe):
        if name.startswith(pre) and name != pre.rstrip("-"):
            return "ZUSAMMENGESETZT", f"Praefix `{pre}${{…}}` im Code"
    for end in sorted(endungen):
        if name.endswith(end) and name != end:
            return "ZUSAMMENGESETZT", f"Endung `${{…}}{end}` im Code"

    roh = verbraucher.suchen(m_code, verbraucher.roh)
    w = sorted(set(wachen.suchen(m_code, wachen.code) + wachen.suchen(m_js, wachen.code)))
    genannt = verbraucher.suchen(m_js, verbraucher.code) if ist_token else []
    if roh:
        return "NUR-KOMMENTAR", ", ".join(roh[:3]) + (f"  [WACHE: {w[0]}]" if w else "")
    if genannt:
        return "NUR-GENANNT", ", ".join(genannt[:3]) + (f"  [WACHE: {w[0]}]" if w else "")
    if w:
        return "NUR-WACHE", ", ".join(w[:3])
    return "TOT", "kein Treffer"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", action="store_true", help="jeden Namen einzeln zeigen")
    ap.add_argument("--pruefen", action="store_true", help="still; Ende 1 bei fehlendem Bauteil")
    ap.add_argument("--fragen", action="append", default=[], metavar="NAME", help=".klasse oder --token")
    ap.add_argument("--ids", action="store_true", help="statt Klassen: die id-Attribute in index.html")
    args = ap.parse_args()

    css_roh = CSS.read_text(encoding="utf-8")
    css_code = css_ohne_kommentar(css_roh)
    verbraucher = Korpus(["NewDesign", "src"], ohne=CSS)
    wachen = Korpus(["tools"])
    praefixe, endungen = zusammensetzbar(verbraucher)

    # ── Haelfte 1: jeder Wert, den eine Zusammensetzung bauen kann, ───────
    #    braucht seine Regel in app.css.
    fehlend: list[str] = []
    for e in ZUSAMMENSETZUNGEN:
        pre, platz = e["praefix"], e["bauplatz"]
        if pre not in praefixe:
            fehlend.append(f"`{pre}${{…}}` steht nicht mehr im Code ({platz}) — Eintrag veraltet")
            continue
        try:
            werte = werte_der_zusammensetzung(e)
        except ValueError as f:
            fehlend.append(f"Quelle von `{pre}${{…}}` nicht lesbar: {f}")
            continue
        for w in werte:
            if not re.search(r"\." + re.escape(pre + w) + r"(?![A-Za-z0-9_-])", css_code):
                fehlend.append(f".{pre}{w} fehlt in app.css — `{pre}${{…}}` baut es ({platz}). {e['warum']}")

    if args.fragen:
        schlecht = 0
        for name in args.fragen:
            ist_token = name.startswith("--")
            reiner = name[1:] if name.startswith(".") else name
            topf, warum = urteil(reiner, ist_token, verbraucher, wachen, praefixe, endungen, css_code)
            print(f"{name:26} {topf:16} {warum}")
            if topf in ("LEBT", "ZUSAMMENGESETZT", "ERZEUGER"):
                schlecht += 1
        print(f"\n{schlecht} von {len(args.fragen)} Namen LEBEN — die gehoeren NICHT geloescht.")
        return 1 if schlecht else 0

    if args.ids:
        html = WURZEL / "NewDesign" / "index.html"
        h_code = entkommentieren(html, html.read_text(encoding="utf-8"))
        # index.html gehoert in den Korpus — eine `id` wird oft in derselben
        # Datei per `for=`/`aria-labelledby` gelesen. Aber das `id="…"` SELBST
        # ist kein Leser: ohne diesen Schnitt fand der Lauf 157 von 157 `id`s
        # lebendig, weil jede sich selbst zitierte. Gleich lang ersetzt, damit
        # die Zeilennummern stehen bleiben.
        eigene = Korpus(["NewDesign", "src"])
        selbst = re.compile(r"""(\bid=)(["'])([A-Za-z][\w:.-]*)(["'])""")
        for wo in (eigene.code, eigene.roh):
            for p in list(wo):
                if p.suffix in (".html", ".htm"):
                    wo[p] = selbst.sub(lambda m: m.group(1) + m.group(2) + " " * len(m.group(3)) + m.group(4), wo[p])
        gefunden = ids_aus_html(h_code)
        toepfe_id: dict[str, list[str]] = {}
        for name, zeile in gefunden.items():
            # Der eigene Fundort zaehlt nicht als Leser.
            topf, warum = id_urteil(name, eigene, wachen, css_code)
            toepfe_id.setdefault(topf, []).append(f"#{name:28} index.html:{zeile:<6} {warum}")
        print(f"index.html: {len(gefunden)} id-Attribute")
        for topf in ("TOT", "NUR-KOMMENTAR", "NUR-WACHE", "LEBT"):
            z = sorted(toepfe_id.get(topf, []))
            print(f"\n── {topf}: {len(z)} ──")
            if topf == "LEBT" and not args.lang:
                continue
            for x in z:
                print("  " + x)
        return 0

    klassen = klassen_aus_css(css_code)
    tokens = token_aus_css(css_code)
    toepfe: dict[str, list[str]] = {}
    for name, zeile in klassen.items():
        topf, warum = urteil(name, False, verbraucher, wachen, praefixe, endungen)
        toepfe.setdefault(topf, []).append(f".{name:34} app.css:{zeile:<6} {warum}")
    for name, zeile in tokens.items():
        topf, warum = urteil(name, True, verbraucher, wachen, praefixe, endungen, css_code)
        toepfe.setdefault(topf, []).append(f"{name:35} app.css:{zeile:<6} {warum}")

    if not args.pruefen:
        print(f"app.css: {len(klassen)} Klassen, {len(tokens)} Token")
        print(f"Gegenstelle: {len(verbraucher.roh)} Dateien; {len(praefixe)} Praefixe, {len(endungen)} Endungen zusammengesetzt")
        for topf in ("TOT", "NUR-KOMMENTAR", "NUR-GENANNT", "NUR-WACHE", "ERZEUGER", "ZUSAMMENGESETZT", "LEBT"):
            zeilen = sorted(toepfe.get(topf, []))
            print(f"\n── {topf}: {len(zeilen)} ──")
            if topf == "LEBT" and not args.lang:
                continue
            for z in zeilen if args.lang else zeilen[:40]:
                print("  " + z)
            if not args.lang and len(zeilen) > 40:
                print(f"  … {len(zeilen) - 40} weitere (--lang)")
        print(
            "\nDIESE LISTE IST EIN BEFUND, KEIN AUFTRAG. Jeder Name gehoert vor dem\n"
            "Loeschen einzeln nachgemessen — TOT heisst „diese Wache fand nichts\",\n"
            "nicht „es gibt nichts\"."
        )

    for f in fehlend:
        print(f"FEHL {f}")
    print(f"\n{len(fehlend)} BAUTEIL(E) EINER ZUSAMMENSETZUNG FEHLEN.")
    return 1 if fehlend else 0


if __name__ == "__main__":
    sys.exit(main())
