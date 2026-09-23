#!/usr/bin/env python3
"""RUECKSTANDS-ZAHL — sagen alle Prosastellen DASSELBE, und sagen sie, WANN?

WARUM ES DAS GIBT (03.09.2026, stuendlicher Doku-Lauf): der Rueckstand der
Abschnitts-Deckung steht an mehreren Orten, und am 03.09. war er an allen
falsch abgeschrieben. Keine Wache hat das gemerkt, und das war der Fund. Die
Messung selbst DRUCKT die Zahl bei jedem Lauf — aber niemand hielt sie gegen
das, was die Prosa behauptet. Ein Messwert ohne Gegenstelle ist eine Zeile,
die vorbeirauscht.

WAS AM 19.09.2026 UMGEBAUT WURDE UND WARUM
==========================================
Die erste Fassung verlangte, dass jede Prosastelle die HEUTE gemessene Zahl
woertlich nennt. Das hat sie unbrauchbar gemacht, und zwar aus einem Grund,
den man erst im Betrieb sieht:

  * Sie war ab dem ersten neuen `<h2>` rot. Am 19.09. mass sie `51 von 79`,
    die Prosa sagte `44 von 70` — vier gemeldete „Luecken", von denen KEINE
    ein Fehler war. Die Prosa ist datiert („Gemessen am 30.08.2026"), und
    eine datierte Zustandsaussage wird nicht falsch, wenn die Zeit
    weiterlaeuft. Sie ist genau das, was AGENTS.md Schritt 5 verlangt.
  * Damit hing sie in keinem Laeufer: seit dem 05.09. steht im BACKLOG
    „Einhaengen steht aus". Eine Wache, die dauerrot waere, haengt niemand
    ein — und ungerufen faengt sie gar nichts ([[dauerrote-wache-ist-keine]],
    [[wiederkehrender-befund-ist-ablauffehler]]).
  * Und sie zaehlte einen Ort mit, den es nie gab: ihr Kopf nannte
    `tools/doku-luecken-probe.sh` als vierte Stelle. Nachgesehen am 19.09.:
    `git log -S admin-abschnitte-deckung -- tools/doku-luecken-probe.sh` ist
    LEER — die Zeichenkette stand dort nie. Ein Viertel ihrer Befunde war die
    Abwesenheit einer Zahl an einem Ort, der sie nie trug.

Geprueft wird deshalb nicht mehr der WERT, sondern die FORM — die haelt,
waehrend die Zahl wandert ([[tests-duerfen-keine-zahlen-festnageln]]):

  R1  Jeder Ort fuehrt einen Stand.       Sonst ist die Gegenstelle weg.
  R2  Jeder Stand traegt sein DATUM.      Undatiert heisst „gilt heute" —
                                          und das stimmt fast nie.
  R3  Staende mit demselben Datum sind    Das ist der Fund vom 03.09.:
      identisch.                          vier Orte, vier Zahlen, ein Tag.

Die HEUTIGE Messung wird geliehen und als DRIFT gedruckt, nicht als Urteil:
sie sagt dem Leser, wie weit die datierte Prosa inzwischen zurueckliegt. Wer
den Rueckstand neu misst, schreibt einen neuen Stand MIT neuem Datum an alle
Orte — und R3 haelt ihn zusammen.

DIE ORTE UND IHRE SCHREIBWEISEN
===============================
    tools/admin-abschnitte-deckung.py   Kopf, „WARUM SIE NICHT IM GATTER HAENGT"
    llmwiki/pack.yaml                   `fix:` und `body:` von
                                        `doku-deckung-der-verwaltung-…`
    BACKLOG.md                          Tabelle „Topf | Zahl (Datum) | …"

Zwei Schreibweisen werden gelesen, weil es zwei gibt:
  A  `<ungenannt> von <gesamt>` mit einem Datum in der Naehe — die Fliesstext-Form.
  B  eine Tabelle mit `Zahl (<Datum>)` in der Kopfzeile und je einer Zeile
     `sicher genannt` / `ungenannt` / `unentscheidbar`. Ihre Summe ist der
     Gesamtwert; so ist sie mit A vergleichbar.
Eine dritte Schreibweise faende diese Wache nicht. Wer eine anfaengt, traegt
sie hier nach — sonst altert genau der Ort still weiter.

DIE MESSUNG WIRD GELIEHEN, nicht nachgebaut ([[zwei-quellen-fuer-dieselbe-tatsache-laufen-am-geraet-auseinander]]):
`tools/admin-abschnitte-deckung.py` ist die eine Stelle, die zaehlt.

GEGENPROBE (`--sabotage`): schreibt in eine WEGWERFKOPIE der Orte einen
abweichenden Stand unter demselben Datum. Danach MUSS R3 anschlagen. Der Baum
wird dabei nicht angefasst.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/rueckstands-zahl-pruefen.py
Rueckgabe: 0 = alle Orte sagen dasselbe und sagen, wann. 1 = sie tun es nicht.
2 = ABBRUCH mit Anleitung (ein Ort oder die Messung fehlt) — nie gruen.
"""

from __future__ import annotations

import importlib.util
import io
import re
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ZAEHLER = WURZEL / "tools/admin-abschnitte-deckung.py"

# Die Orte, die denselben Stand fuehren. `doku-luecken-probe.sh` stand hier
# bis zum 19.09.2026 und kam wieder heraus: nachgemessen hat diese Datei die
# Zahl nie getragen (siehe Kopf).
ORTE = (
    ZAEHLER,
    WURZEL / "llmwiki/pack.yaml",
    WURZEL / "BACKLOG.md",
)

DATUM = r"\d{2}\.\d{2}\.\d{4}"
# Schreibweise A: das Paar im Fliesstext. Ein Fenster darum herum muss das
# Datum enthalten — und das Wort, um das es geht, damit nicht jedes „3 von 4"
# im Haus als Rueckstand gelesen wird.
PAAR = re.compile(r"(\d+)\s+von\s+(\d+)")
UMFELD = 260
# DER ANKER MUSS ENG SEIN, und das ist beim Bauen gemessen worden: mit dem
# blossen Wort „Abschnitt" zog diese Wache am 19.09. vier fremde Paare mit
# herein (`4 von 6`, `9 von 17`, `13 von 17`, `7 von 14` — andere Deckungen,
# andere Tatsachen) und meldete sie als undatiert. Gesucht wird deshalb die
# MESSUNG, nicht das Thema: der Name des Zaehlers oder der Satz, in dem
# dieser Rueckstand steht.
ANKER = (
    "admin-abschnitte-deckung",
    "Abschnitten im Handbuch ungenannt",
    "Abschnitten sind ungenannt",
)

# Schreibweise B: die Tabelle. Kopfzeile mit Datum, darunter die drei Toepfe.
TABELLE_KOPF = re.compile(r"Zahl\s*\((" + DATUM + r")\)")
TOPF = {
    "sicher": re.compile(r"sicher genannt\s*\|\s*\**\s*(\d+)"),
    "ungenannt": re.compile(r"\**ungenannt\**\s*\|\s*\**\s*(\d+)"),
    "unentscheidbar": re.compile(r"unentscheidbar\s*\|\s*\**\s*(\d+)"),
}


class Stand:
    """Ein Rueckstand, wie EINE Stelle ihn behauptet."""

    def __init__(self, ort: Path, datum: str | None, ungenannt: int, gesamt: int, wie: str) -> None:
        self.ort = ort
        self.datum = datum
        self.ungenannt = ungenannt
        self.gesamt = gesamt
        self.wie = wie

    @property
    def paar(self) -> tuple[int, int]:
        return (self.ungenannt, self.gesamt)

    def __str__(self) -> str:
        wann = self.datum or "OHNE DATUM"
        return f"{self.ungenannt} von {self.gesamt} ({wann}, {self.wie})"


def staende_im_fliesstext(ort: Path, text: str) -> list[Stand]:
    gefunden: list[Stand] = []
    for treffer in PAAR.finditer(text):
        fenster = text[max(0, treffer.start() - UMFELD) : treffer.end() + UMFELD]
        if not any(wort in fenster for wort in ANKER):
            continue
        datum = re.search(DATUM, fenster)
        gefunden.append(
            Stand(ort, datum.group(0) if datum else None, int(treffer.group(1)), int(treffer.group(2)), "Fliesstext")
        )
    return gefunden


def staende_in_tabelle(ort: Path, text: str) -> list[Stand]:
    gefunden: list[Stand] = []
    for kopf in TABELLE_KOPF.finditer(text):
        rumpf = text[kopf.end() : kopf.end() + 600]
        zahlen = {}
        for name, muster in TOPF.items():
            treffer = muster.search(rumpf)
            if treffer:
                zahlen[name] = int(treffer.group(1))
        if "ungenannt" not in zahlen:
            continue
        gefunden.append(Stand(ort, kopf.group(1), zahlen["ungenannt"], sum(zahlen.values()), "Tabelle"))
    return gefunden


def staende(ort: Path, text: str) -> list[Stand]:
    return staende_im_fliesstext(ort, text) + staende_in_tabelle(ort, text)


def messung() -> tuple[int, int]:
    """Leiht die Zaehlung von `admin-abschnitte-deckung.py`.

    Nicht nachbauen: zwei Zaehler fuer dieselbe Tatsache laufen auseinander,
    und dann misst diese Wache die Prosa gegen ihre EIGENE Vorstellung.
    """
    # Der Dateiname traegt Bindestriche und ist damit kein Modulname — ueber
    # den Pfad laden, nicht ueber `import`.
    spec = importlib.util.spec_from_file_location("_abschnitte_zaehler", ZAEHLER)
    if spec is None or spec.loader is None:
        raise ImportError(f"{ZAEHLER} laesst sich nicht laden")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    handbuch = m._normal(m.HANDBUCH.read_text(encoding="utf-8"))
    # `abschnitte()` druckt Uebersprungenes auf stdout — hier nicht erwuenscht.
    with redirect_stdout(io.StringIO()):
        gefunden = m.abschnitte()
    ungenannt = [t for _, t in gefunden if m._normal(t) not in handbuch]
    return len(ungenannt), len(gefunden)


def abbruch(grund: list[str]) -> int:
    """Gegenstand weg: ABBRECHEN MIT ANLEITUNG, niemals gruen."""
    print("ABBRUCH — diese Wache hat ihren Gegenstand verloren:\n")
    for zeile in grund:
        print("  ?    " + zeile)
    print("\nSie haelt Prosastellen gegeneinander. Faellt eine weg oder laesst sich")
    print("die Messung nicht mehr leihen, ist hier nichts zu pruefen — und „nichts")
    print("zu pruefen\" ist nicht dasselbe wie „in Ordnung\". Deshalb Rueckgabe 2.")
    print("\nWas zu tun ist:")
    print("  * Ort umbenannt oder verschoben? ORTE in diesem Werkzeug nachziehen.")
    print("  * Ort traegt den Stand nicht mehr? Dann ist die Aussage dort")
    print("    verschwunden — entweder sie kommt zurueck, oder der Ort kommt aus")
    print("    ORTE heraus, MIT Begruendung im Kopf (so wie doku-luecken-probe.sh")
    print("    am 19.09.2026).")
    print("  * Messung nicht leihbar? tools/admin-abschnitte-deckung.py ansehen —")
    print("    ohne sie hat diese Wache keinen Massstab.")
    return 2


def main() -> int:
    sabotage = "--sabotage" in sys.argv

    fehlend = [f"{ort.relative_to(WURZEL)} gibt es nicht" for ort in ORTE if not ort.is_file()]
    if fehlend:
        return abbruch(fehlend)

    with tempfile.TemporaryDirectory(prefix="rueckstands-zahl-") as tmp:
        quellen: list[tuple[Path, Path]] = []
        for nr, ort in enumerate(ORTE):
            lesen = ort
            if sabotage:
                # In eine WEGWERFKOPIE schreiben, nie in den Baum: die Orte
                # gehoeren anderen Sitzungen ([[dateikopie-toetet-nachbarsitzung]]).
                lesen = Path(tmp) / f"{nr}-{ort.name}"
                shutil.copy2(ort, lesen)
                text = lesen.read_text(encoding="utf-8", errors="replace")
                if nr == 0:
                    text = PAAR.sub(lambda t: f"{int(t.group(1)) + 1} von {t.group(2)}", text, count=1)
                lesen.write_text(text, encoding="utf-8")
            quellen.append((ort, lesen))

        alle: list[Stand] = []
        leer: list[str] = []
        for ort, lesen in quellen:
            gefunden = staende(ort, lesen.read_text(encoding="utf-8", errors="replace"))
            if not gefunden:
                leer.append(f"{ort.relative_to(WURZEL)} fuehrt keinen Stand mehr")
            alle.extend(gefunden)

    if leer:
        return abbruch(leer)

    rot = False
    print("Rueckstand der Abschnitts-Deckung — was die Prosa sagt\n")
    for stand in alle:
        print(f"  {str(stand.ort.relative_to(WURZEL)):35s} {stand}")

    # ── R2: jeder Stand traegt sein Datum ────────────────────────────────
    undatiert = [s for s in alle if s.datum is None]
    print()
    if undatiert:
        rot = True
        for stand in undatiert:
            print(f"  ROT  {stand.ort.relative_to(WURZEL)} beziffert den Rueckstand ohne Datum")
            print(f"       ({stand.ungenannt} von {stand.gesamt}) — undatiert heisst „gilt heute\", und das")
            print("       stimmt nach dem naechsten neuen Kasten nicht mehr.")
    else:
        print(f"  ok   alle {len(alle)} Staende sind datiert")

    # ── R3: gleiches Datum, gleicher Stand ───────────────────────────────
    je_datum: dict[str, list[Stand]] = {}
    for stand in alle:
        if stand.datum:
            je_datum.setdefault(stand.datum, []).append(stand)
    for datum, gruppe in sorted(je_datum.items()):
        paare = {s.paar for s in gruppe}
        if len(paare) > 1:
            rot = True
            print(f"  ROT  zum {datum} stehen VERSCHIEDENE Zahlen da:")
            for stand in gruppe:
                print(f"       {stand.ort.relative_to(WURZEL)}: {stand.ungenannt} von {stand.gesamt}")
            print("       Eine Messung, mehrere Zahlen — eine davon ist abgeschrieben worden.")
        else:
            print(f"  ok   zum {datum} sagen {len(gruppe)} Stelle(n) dasselbe: "
                  f"{gruppe[0].ungenannt} von {gruppe[0].gesamt}")

    # ── Drift: kein Urteil, aber die Zeile, um die es geht ───────────────
    # EIN ABBRUCH DARF EINEN FUND NICHT UEBERDECKEN: steht oben schon rot,
    # bleibt es rot, auch wenn die Drift-Zeile hier nicht mehr zu holen ist.
    # Die Reihenfolge ist Absicht — wer zuerst abbraeche, verloere den Befund.
    try:
        ungenannt, gesamt = messung()
        if gesamt == 0:
            raise ValueError("kein einziger Abschnitt gefunden — Merkmal `<h2>` umbenannt?")
    except Exception as fehler:  # noqa: BLE001 - die Ursache gehoert in den Bericht
        if rot:
            print(f"\n  ?    Drift nicht messbar ({fehler}) — am Urteil oben aendert das nichts")
            print("\nROT — die Orte sagen nicht dasselbe, oder sie sagen nicht, wann.")
            return 1
        return abbruch([f"Messung liess sich nicht leihen: {fehler}"])

    juengste = max(je_datum) if je_datum else None
    prosa = je_datum[juengste][0] if juengste else None
    print(f"\n  heute gemessen: {ungenannt} von {gesamt} Abschnitten ungenannt")
    if prosa and prosa.paar != (ungenannt, gesamt):
        print(f"  DRIFT: die juengste Prosa steht auf {prosa.ungenannt} von {prosa.gesamt} ({juengste}).")
        print("         Das ist KEIN Fehler — eine datierte Aussage altert nicht, sie")
        print("         wird nur aelter. Wer neu misst, schreibt den neuen Stand MIT")
        print("         Datum an alle Orte oben; R3 haelt sie dann zusammen.")
    elif prosa:
        print(f"  ok     die juengste Prosa ({juengste}) nennt genau diesen Stand")

    print()
    if sabotage:
        traf = rot
        print(f"GEGENPROBE (ein Ort auf einen abweichenden Stand gesetzt): erkannt? "
              f"{'JA - die Wache haelt die Orte gegeneinander' if traf else 'NEIN - sie liest sie NICHT'}")
        return 0 if traf else 1

    if rot:
        print("ROT — die Orte sagen nicht dasselbe, oder sie sagen nicht, wann.")
        return 1
    print(f"KEINE LUECKE ({len(alle)} Staende an {len(ORTE)} Orten, datiert und einig).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
