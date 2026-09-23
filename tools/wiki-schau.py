#!/usr/bin/env python3
"""Das Wissenspaket ansehen — und pruefen, was `yaml.safe_load` NICHT prueft.

WOZU: Die id `mupi-kiosk-als-dietpi` war in `pack.yaml` ZWEIMAL vergeben —
einmal fuer den howto "Kiosk als normaler Benutzer statt als root starten",
einmal fuer den offenen Punkt "Autologin allein genuegt nicht". Zwei ganz
verschiedene Dinge unter einem Namen.

WARUM ES NIEMANDEM AUFFIEL: Die uebliche Pruefung lautet `yaml.safe_load(...)`
und sagt "gueltig". Das ist auch richtig — nur beantwortet es eine ANDERE
Frage. Die ids stehen als WERTE in einer Liste, nicht als Schluessel einer
Abbildung; doppelte Werte sind YAML voellig gleichgueltig. Die Datei ist
gueltig, beide Eintraege ueberleben, und wer nach der id sucht, bekommt
irgendeinen der beiden — ohne Warnung, ohne Fehlermeldung. Kosten: der Zustand
ueberlebte gut zwei Wochen und mindestens drei Sitzungen; zwei davon haben ihn
GEMELDET und bewusst liegengelassen, weil nichts ihn erzwang.

UND DIE ZWEITE HAELFTE DESSELBEN FEHLERS: Wer eine doppelte id aufloest, muss
eine davon umbenennen — und ab da zeigt jeder `[[alte-id]]` anderswo in der
Datei ins Leere. Auch das meldet niemand. Ein Verweis, der nirgendwohin fuehrt,
sieht im Text genauso aus wie einer, der trifft; gemerkt wird es erst, wenn
jemand ihm folgen will. Beim Aufloesen am 02.08.2026 musste genau so ein
Verweis von Hand mitgezogen werden. Dieses Werkzeug haette es gesagt.

DRITTENS, dieselbe Bauart noch einmal: doppelte SCHLUESSEL innerhalb eines
Eintrags. Da schluckt `safe_load` wirklich etwas — es behaelt still den
LETZTEN. Ein zweites `body:` loescht das erste, ohne ein Wort. "Gueltig" sagt
die Pruefung auch dann.

VIERTENS, seit dem 21.08.2026: die `related:`-LISTEN. Sie wurden bis dahin gar
nicht angesehen — geprueft war nur der Fliesstext. Dabei ist `related:` genau
das, was ein Leser am Ende eines Eintrags anklickt. Beim ersten Lauf mit dieser
Pruefung: 32 Verweise auf 9 Namen, die es im Paket nicht gab. Sie zeigten auf
private Merkdateien ausserhalb des Repos — fuer jeden anderen Leser Sackgassen.
Die Meldung "1 Verweis ins Leere" war die ganze Zeit richtig UND irrefuehrend,
weil sie fuer die gepruefte Haelfte galt und wie eine Aussage ueber alle klang.

ALLE DREI VERWEISFORMEN WERDEN GEPRUEFT. Die Datei benutzt `[[id]]` (62 Stellen)
und im Fliesstext auch `[id]` (10 Stellen); beim Aufloesen der doppelten id war
es die EINFACHE Klammer, die beinahe stehengeblieben waere. Als Verweis gilt
ein Wort in einfachen Klammern nur, wenn es die Form einer id hat: klein,
Bindestriche, mindestens drei Teile. Wer solch ein Wort NICHT als Verweis meint,
schreibt es ohne Klammern — die Ausnahme steht damit im Text und nicht in einer
Liste hier drin, die als erstes veraltet.

WAS ES NICHT TUT: Es beurteilt keine Inhalte, prueft keine `source:`-Angaben
nach, fasst das Netz nicht an und schreibt NICHTS in `pack.yaml`. Es ist eine
Textpruefung — deshalb laeuft es ohne Box, ohne Browser und in Sekundenbruch-
teilen.

WO DIE DATEI LIEGT: Das Wissenspaket ist ein EIGENES Repo neben diesem
(`llmwiki_mupibox`). Ist es nicht ausgecheckt, meldet sich dieses Werkzeug ab,
statt rot zu werden — ein Pruefschritt, der bei jedem fehlt, dem nur das
Nachbarrepo fehlt, wird binnen einer Woche weggeschaut.

AUFRUF
    tools/wiki-schau.py                 Uebersicht und Befunde
    tools/wiki-schau.py --pruefen       still, Ende 1 bei Befund
                                        (haengt in tools/pruefen.sh)
    tools/wiki-schau.py --datei <pfad>  ein anderes pack.yaml
    MUPI_WIKI=<pfad> tools/wiki-schau.py
"""

import argparse
import collections
import os
import pathlib
import re
import sys

import yaml

WURZEL = pathlib.Path(__file__).resolve().parent.parent

# Ein Verweis in DOPPELTEN Klammern. Die Verneinung von ':' haelt die
# POSIX-Zeichenklassen heraus, die in zitierten Shell-Zeilen vorkommen:
# `grep -qE ':[[:space:]]*0 Fehler'` sieht sonst aus wie ein Verweis auf
# einen Eintrag namens ':space:'.
VERWEIS_DOPPELT = re.compile(r"\[\[(?!:)([^\[\]\n]+)\]\]")

# Ein Verweis in EINFACHEN Klammern. Erkannt wird nur die Form einer id:
# klein, Bindestriche, mindestens drei Teile. Ausgeschlossen sind die
# Nachbarklammern (sonst faengt sich die doppelte Form hier noch einmal) und
# ein folgendes '(' — das waere ein Markdown-Link und kein Eintragsverweis.
VERWEIS_EINFACH = re.compile(
    r"(?<![\[!])\[([a-z0-9]+(?:-[a-z0-9]+){2,})\](?![\]\(])"
)

# Was in BACKTICKS steht, ist zitiert und nicht gemeint.
#
# WOZU (selbst hineingelaufen, 02.08.2026): Der Eintrag, der diese
# Fehlerklasse ERKLAERT, meldete sich prompt selbst — er schreibt
# `[[alte-id]]`, `[[mupi-einstellungssperre]]` und `[[wiki-zuerst-lesen]]`
# als Beispiele hin. Drei Verweise ins Leere, die keiner sind. Ein
# Pruefschritt, der beim Beschreiben eines Fehlers rot wird, erzieht dazu,
# ihn wegzuschauen.
#
# DIE KONVENTION IST IM BESTAND BELEGT, nicht ausgedacht: An allen echten
# Fundstellen steht der Verweis OHNE Backticks („Siehe [[mupi-mqtt-
# reparatur]]", „steht in [[mupi-offene-optimierungen]]"). Wer einen Verweis
# meint, setzt ihn in den Satz; wer ueber seine Form redet, zitiert ihn.
ZITAT = re.compile(r"`[^`\n]*`")


class TreuerLader(yaml.SafeLoader):
    """`SafeLoader`, der doppelte Schluessel MELDET statt sie zu schlucken.

    Der normale Lader behaelt bei `a: 1` / `a: 2` still die 2. Das ist nach
    YAML erlaubt und genau deshalb gefaehrlich: ein versehentlich zweites
    `body:` loescht das erste, und die Datei bleibt "gueltig".
    """

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.doppelte: list[tuple[str, int]] = []

    def construct_mapping(self, knoten, deep=False):
        gesehen = set()
        for schluessel_knoten, _ in knoten.value:
            schluessel = self.construct_object(schluessel_knoten, deep=deep)
            if schluessel in gesehen:
                self.doppelte.append(
                    (str(schluessel), schluessel_knoten.start_mark.line + 1)
                )
            gesehen.add(schluessel)
        return super().construct_mapping(knoten, deep)


def _als_datei(p: pathlib.Path) -> pathlib.Path:
    """Datei ODER Repo-Verzeichnis darf angegeben werden — beides kommt vor,
    und der Unterschied ist keine Fehlermeldung wert."""
    p = p.expanduser()
    return p / "pack.yaml" if p.is_dir() else p


def wiki_finden(vorgabe: str | None) -> pathlib.Path | None:
    """Das `pack.yaml` suchen. Rueckgabe `None` heisst: nirgends gefunden.

    EIN GENANNTER PFAD WIRD NICHT UEBERGANGEN. Wer `--datei` oder `MUPI_WIKI`
    setzt und danebengreift, bekommt einen Fehler und nicht klammheimlich die
    Datei von nebenan geprueft. Sonst waere dieses Werkzeug selbst ein Fall
    seiner eigenen Fehlerklasse: es sagte "in Ordnung" ueber etwas anderes,
    als der Aufrufer gemeint hat.
    """
    for was, wert in (("--datei", vorgabe), ("MUPI_WIKI", os.environ.get("MUPI_WIKI"))):
        if wert:
            pfad = _als_datei(pathlib.Path(wert))
            if not pfad.is_file():
                raise FileNotFoundError(f"{was}={wert}: {pfad} gibt es nicht")
            return pfad

    # Ohne Ansage: ERST IM BAUM. Das Wissenspaket liegt seit dem 08.08.2026
    # unter llmwiki/ in diesem Repo (git subtree, siehe ZUGEZOGEN.md); die
    # alten Nachbarorte sind seit dem 10.08.2026 STILLGELEGT und veralten.
    # Genau dieses Werkzeug hat bis zum 13.08.2026 den ALTEN Stand geprueft
    # und dessen Fehler gemeldet, waehrend der Baum-Stand ungeprueft blieb —
    # ein Waechter, der auf die falsche Tuer schaut. Die Nachbarorte bleiben
    # als Rueckfall fuer alte Checkouts ohne llmwiki/.
    for k in (WURZEL / "llmwiki" / "pack.yaml",
              WURZEL.parent / "llmwiki_mupibox" / "pack.yaml",
              pathlib.Path.home() / "Downloads" / "llmwiki_mupibox" / "pack.yaml"):
        if k.is_file():
            return k
    return None


def zeilen_je_id(roh: str) -> dict[str, list[int]]:
    """Zu jeder id die Zeilennummer(n) im Rohtext.

    Aus dem TEXT gelesen und nicht aus dem Baum, weil der Baum die doppelte
    id gerade nicht mehr auseinanderhaelt — die zweite Fundstelle ist aber
    genau das, was man sehen will.
    """
    treffer: dict[str, list[int]] = collections.defaultdict(list)
    for nr, zeile in enumerate(roh.split("\n"), 1):
        m = re.match(r"\s*-?\s*id:\s*(\S+)\s*$", zeile)
        if m:
            treffer[m.group(1).strip("\"'")].append(nr)
    return treffer


def verweise(roh: str) -> list[tuple[str, str, int]]:
    """Alle Verweise als (form, ziel, zeile). `form` ist '[[..]]' oder '[..]'.

    ZITIERTES ZAEHLT NICHT MIT (siehe ZITAT). Ersetzt wird laengengetreu
    durch Leerzeichen und nicht geloescht — die Spalten bleiben damit die der
    Datei, und eine spaetere Fundstelle in derselben Zeile behaelt ihre
    Stelle.
    """
    gefunden: list[tuple[str, str, int]] = []
    for nr, zeile in enumerate(roh.split("\n"), 1):
        zeile = ZITAT.sub(lambda m: " " * len(m.group(0)), zeile)
        for m in VERWEIS_DOPPELT.finditer(zeile):
            gefunden.append(("[[..]]", m.group(1).strip(), nr))
        for m in VERWEIS_EINFACH.finditer(zeile):
            gefunden.append(("[..]", m.group(1).strip(), nr))
    return gefunden


def related_verweise(
    eintraege: list, stellen: dict[str, list[int]]
) -> list[tuple[str, str, int]]:
    """Die Ziele aller `related:`-Listen als (form, ziel, zeile).

    WOZU: Bis zum 21.08.2026 hat dieses Werkzeug NUR den Fliesstext angesehen.
    Die `related:`-Liste ist aber genau das, was ein Leser am Ende eines
    Eintrags anklickt — und dort standen 32 Verweise auf 9 Namen, die es im
    Paket ueberhaupt nicht gab (sie existierten nur als private Merkdateien
    ausserhalb des Repos). Ein gruenes `[[..]]`-Ergebnis hat das gedeckt:
    geprueft war die eine Haelfte, gemeldet wurde fuer beide.

    Die Zeile ist die des Eintrags, nicht die der `related:`-Zeile — sie
    genuegt zum Auffinden und braucht keinen zweiten Textdurchlauf.
    """
    gefunden: list[tuple[str, str, int]] = []
    for e in eintraege:
        eid = e.get("id")
        nr = (stellen.get(eid) or [0])[0]
        for ziel in e.get("related") or []:
            if isinstance(ziel, str):
                gefunden.append(("related:", ziel.strip(), nr))
    return gefunden


def pruefen(pfad: pathlib.Path) -> tuple[list[str], dict]:
    """Alle Befunde als Zeilen, dazu ein paar Zahlen fuer die Uebersicht."""
    roh = pfad.read_text(encoding="utf-8")

    lader = TreuerLader(roh)
    try:
        daten = lader.get_single_data()
    finally:
        lader.dispose()
    doppelte_schluessel = lader.doppelte

    eintraege = daten.get("entries") or []
    ids = [e.get("id") for e in eintraege]
    bekannt = {i for i in ids if i}
    stellen = zeilen_je_id(roh)
    alle_verweise = verweise(roh) + related_verweise(eintraege, stellen)

    befunde: list[str] = []

    mehrfach = sorted(i for i, n in collections.Counter(ids).items() if i and n > 1)
    if mehrfach:
        befunde.append(
            "DOPPELTE ID — wer sie nachschlaegt, bekommt einen der beiden, ohne Warnung:"
        )
        for i in mehrfach:
            wo = ", ".join(f"Zeile {z}" for z in stellen.get(i, []))
            befunde.append(f"    {i}   ({wo or 'Zeile unbekannt'})")

    ohne = [n for n, e in enumerate(eintraege, 1) if not e.get("id")]
    if ohne:
        befunde.append(
            "EINTRAG OHNE ID — auf ihn kann nichts verweisen: "
            + ", ".join(f"Nr. {n}" for n in ohne)
        )

    ins_leere = [(f, z, nr) for f, z, nr in alle_verweise if z not in bekannt]
    if ins_leere:
        befunde.append(
            "VERWEIS INS LEERE — nichts meldet sich, der Leser findet nur nichts:"
        )
        for form, ziel, nr in ins_leere:
            if form == "[[..]]":
                klammer = f"[[{ziel}]]"
            elif form == "related:":
                klammer = f"related: {ziel}"
            else:
                klammer = f"[{ziel}]"
            befunde.append(f"    {klammer}   (Zeile {nr})")

    if doppelte_schluessel:
        befunde.append(
            "DOPPELTER SCHLUESSEL — safe_load behaelt still den LETZTEN, der erste ist weg:"
        )
        for schluessel, nr in doppelte_schluessel:
            befunde.append(f"    {schluessel}:   (Zeile {nr})")

    zahlen = {
        "fassung": daten.get("version"),
        "eintraege": len(eintraege),
        "arten": collections.Counter(e.get("kind") or "—" for e in eintraege),
        "verweise": collections.Counter(f for f, _, _ in alle_verweise),
    }
    return befunde, zahlen


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--pruefen", action="store_true",
                   help="still; Ende 1 bei Befund (fuer tools/pruefen.sh)")
    p.add_argument("--datei", help="Pfad zu pack.yaml oder zum Wiki-Repo")
    a = p.parse_args()

    try:
        pfad = wiki_finden(a.datei)
    except FileNotFoundError as e:
        print(e)
        return 1

    if pfad is None:
        # KEIN Fehler: das Wissenspaket ist ein eigenes Repo. Wer es nicht
        # daneben liegen hat, soll deswegen nicht rot werden.
        print("Wissenspaket nicht gefunden (erwartet neben diesem Repo als "
              "llmwiki_mupibox/pack.yaml, oder MUPI_WIKI setzen) — uebersprungen")
        return 0

    try:
        befunde, zahlen = pruefen(pfad)
    except yaml.YAMLError as e:
        print(f"{pfad}: nicht einmal gueltiges YAML\n{e}")
        return 1

    if not a.pruefen:
        print(f"Wissenspaket — {pfad}")
        print(f"Fassung {zahlen['fassung']}, {zahlen['eintraege']} Eintraege")
        arten = "  ".join(f"{k} {n}" for k, n in zahlen["arten"].most_common())
        print(f"  {arten}")
        v = zahlen["verweise"]
        print(
            f"Verweise: {v['[[..]]']} in [[..]], {v['[..]']} in [..], "
            f"{v['related:']} in related:"
        )
        print()

    if befunde:
        print("\n".join(befunde))
        return 1

    if not a.pruefen:
        print("ids eindeutig, jeder Verweis trifft, keine doppelten Schluessel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
