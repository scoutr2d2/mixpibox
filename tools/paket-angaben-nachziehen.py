#!/usr/bin/env python3
"""Zieht JEDE Umfangsangabe ueber das Wissenspaket im Baum nach.

WARUM ES DIESES WERKZEUG GIBT
-----------------------------
Mehrere Prosadateien nennen, wie gross das Wissenspaket ist:

    ... im Wissenspaket `llmwiki/pack.yaml` (<Zahl> Eintraege, Fassung <Zahl>).

Beide Zahlen sind ABGELEITET — sie stehen so auch in `llmwiki/pack.yaml`
selbst. Von Hand abgeschrieben veralten sie zuverlaessig: `git log -p` auf
die Kopfzeile der Doku zeigte fuer den 27.08.2026 neun Commits
hintereinander, von denen jeder die Zahl um genau eins weiterschob. Die
Wache in `tools/doku-luecken-probe.sh` meldet den Drift zwar — aber EINEN
LAUF ZU SPAET:

    Lauf N  : Wache laeuft (gruen)  ->  Lauf haengt seinen Wiki-Eintrag an
              -> Paket hat jetzt N+1 Eintraege, Kopfzeile sagt weiter N
    Lauf N+1: Wache meldet die Luecke, die Lauf N erzeugt hat

Der Doku-Lauf erzeugt seinen eigenen naechsten Befund. Deshalb wird hier
NACH dem Anhaengen nachgezogen, statt vor dem Anhaengen zu pruefen; gerufen
wird es aus `tools/wiki-anhaengen.py`.

WARUM ES NICHT MEHR `kopfzeile-nachziehen.py` HEISST (27.08.2026)
-----------------------------------------------------------------
Der Vorgaenger kannte GENAU EINEN PFAD, `dokumentation/mixpibox.md`, und die
Wache daneben ebenso. Dieselbe Angabe stand aber an drei Stellen, und die
beiden ungewachten waren weit auseinandergelaufen:

    dokumentation/mixpibox.md        857 / Fassung 359   (gewacht, richtig)
    README.md                        799 / —             58 Eintraege zurueck
    dokumentation/benutzerhandbuch.html  777 / Fassung 287   80 zurueck, und
        es nannte als Quelle `llmwiki_mupibox` — das seit dem 10.08.2026
        stillgelegte Nachbarrepo, nicht das Paket im Baum

Ein Werkzeug, das nach dem PFAD sucht, findet die naechste Kopie nie: sie
entsteht in einer Datei, die beim Bau des Werkzeugs niemand im Kopf hatte.
Gesucht wird deshalb nach dem MERKMAL — „diese Datei behauptet den Umfang
des Pakets" — ueber alle von `git ls-files` gefuehrten Dateien. Wer die
Angabe morgen in eine vierte Datei schreibt, wird ab dem naechsten Lauf
mitgezogen, ohne dass jemand hier eine Zeile aendert.

WAS ES NICHT ANFASST — Absicht, keine Luecke
--------------------------------------------
  * `llmwiki/pack.yaml` selbst: dort ist die Zahl die Wahrheit, keine Kopie.
  * `AUDIT-*.md`: datierte Momentaufnahmen. Ihre Zahlen sollen den Stand des
    Audit-Tages festhalten und duerfen nicht mitwandern.
  * Diese Datei: sonst belegt das Werkzeug seinen Gegenstand mit sich selbst.
    Das Muster im Text oben steht deshalb mit `<Zahl>` statt mit Ziffern da —
    es soll auch dann nicht treffen, wenn der Ausschluss einmal faellt.
  * Saetze, die eine FRUEHERE Groesse berichten („drei Paare aus 787
    Eintraegen"), tragen die Form nicht und bleiben stehen.

FINDET ES GAR KEINE ANGABE, ist das kein Gruen, sondern WARNUNG (Ausgang 2):
entweder ist die Form umgeschrieben worden oder der Aufruf steht im falschen
Verzeichnis. Eine Wache ohne Fund muss das sagen koennen.

WARUM ES EINEN INDEX-MODUS GIBT (28.08.2026)
--------------------------------------------
Das Nachziehen haengt hier an EINEM Aufrufer, `tools/wiki-anhaengen.py`. Wer
seinen Eintrag von Hand in `llmwiki/pack.yaml` schreibt, umgeht die Naht — und
genau das ist am 28.08. passiert (`179d69a7` fasste nur `AUDIT-*.md` und
`pack.yaml` an, die drei Kopfzeilen blieben bei 861/363 stehen). Derselbe
Befund am zweiten Tag in Folge ist kein Doku-Fehler mehr, sondern ein
Ablauffehler: die Wache stand HINTER dem Ereignis (llmwiki
`umfangsdrift-kehrt-wieder-weil-die-naht-an-einem-aufrufer-haengt`).

`--index` misst deshalb, was WIRKLICH COMMITTET WIRD — die Blobs aus dem
Index (`git show :pfad`), nicht den Arbeitsbaum. Der Unterschied ist der
ganze Zweck: eine im Baum gerichtete, aber nicht gestagte README ginge einer
Baum-Pruefung als gruen durch und driftete im Commit trotzdem (llmwiki
`amend-am-gemeinsamen-baum-frisst-fremde-commits`). Gerufen wird der Modus aus
`tools/git-hooks/pre-commit`; er SCHREIBT NIE.

AUFRUF
    paket-angaben-nachziehen.py            # richtet alle Fundstellen
    paket-angaben-nachziehen.py --pruefen  # meldet nur (Ausgang 1 bei Drift)
    paket-angaben-nachziehen.py --index    # prueft den Index (Ausgang 1 bei Drift)

AUSGANG
    0  alle Angaben stimmen (bzw. wurden gerichtet)
    1  Drift gefunden (nur bei --pruefen/--index)
    2  unmessbar: Paket fehlt, oder keine einzige Angabe gefunden
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "llmwiki" / "pack.yaml"
SELBST = Path(__file__).resolve()

# DIE FORM DER BEHAUPTUNG. Der Paketname davor ist Pflicht — ohne ihn faengt
# das Muster jede beliebige Aufzaehlung mit dem Wort „Einträge". Zwischen
# Name und Klammer darf Auszeichnung stehen (`**`, `</code>`), zwischen den
# beiden Zahlen Weissraum inklusive Zeilenumbruch: in `mixpibox.md` bricht
# die Kopfzeile genau dort um.
ANGABE = re.compile(
    r"(?P<vor>llmwiki/pack\.yaml[^\n(]{0,20}\()(?P<eintraege>\d+)"
    # SEIT DEM 23.09.2026 AUCH ENGLISCH: README.en.md sagt „(N entries,
    # version N)". Die Woerter stehen in `mitte` und werden beim Nachziehen
    # unveraendert zurueckgeschrieben — die Sprache der Datei bleibt ihre.
    # Ohne diese Zeile hinkte die englische Fassung nach dem ersten
    # Wiki-Eintrag um eins (gefunden von tools/readme-paritaet-pruefen.py).
    r"(?P<mitte>\s+(?:Einträge|entries),\s+(?:Fassung|version)\s+)(?P<fassung>\d+)"
)

# Wo nicht gesucht wird. Begruendung je Eintrag steht im Kopf dieser Datei.
AUSGENOMMEN = {"llmwiki/pack.yaml"}
AUSGENOMMEN_MUSTER = ("AUDIT-",)

# Nur Prosa. Eine Zahl im Quelltext waere ein anderer Fall (sie gehoerte
# dorthin gar nicht) und braucht eine eigene Wache, keinen stillen Umschreiber.
ENDUNGEN = (".md", ".html", ".txt")


def wahrheit(roh: str | None = None) -> tuple[int, str]:
    """Liest Eintragszahl und Fassung aus dem Paket. Nur lesend.

    `roh` gesetzt = der Text kommt aus dem Index statt von der Platte.
    """
    import yaml

    paket = yaml.safe_load(PAKET.read_text(encoding="utf-8") if roh is None else roh)
    return len(paket["entries"]), str(paket["version"])


def aus_index(name: str) -> str | None:
    """Der Inhalt, den ein Commit JETZT festschreiben wuerde — oder None."""
    fertig = subprocess.run(
        ["git", "-C", str(WURZEL), "show", f":{name}"],
        capture_output=True,
        text=True,
    )
    if fertig.returncode != 0:
        return None
    return fertig.stdout


def ist_kandidat(name: str) -> bool:
    """Dieselbe Auswahlregel fuer Baum und Index — eine Stelle, kein Zwilling."""
    if not name.endswith(ENDUNGEN):
        return False
    if name in AUSGENOMMEN or name.startswith(AUSGENOMMEN_MUSTER):
        return False
    return (WURZEL / name).resolve() != SELBST


def kandidaten() -> list[tuple[Path, bool]]:
    """Die Prosadateien des Baums, je mit der Angabe „ist verfolgt".

    Ueber `git ls-files`, nicht ueber `rglob`: auf der Arbeitsmaschine liegt
    Ruecklass herum, und wer ihn mitliest, richtet Dateien, die kein anderer
    hat (llmwiki `gegenprobe-statt-gruen-glauben`). `--others
    --exclude-standard` kommt trotzdem dazu, denn der haeufigste Fall einer
    VIERTEN Kopie ist eine Datei, die derselbe Lauf gerade erst anlegt — die
    ist noch nicht verfolgt und waere sonst genau dann unsichtbar, wenn es
    darauf ankommt. Sie wird nur GEMELDET, nicht geschrieben: eine untrackte
    Datei gehoert auf dieser Maschine regelmaessig einer PARALLELEN Sitzung,
    und in deren Arbeit schreibt man nicht hinein.
    """

    def frag(*schalter: str) -> list[str]:
        return subprocess.run(
            ["git", "-C", str(WURZEL), "ls-files", "-z", *schalter],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split("\0")

    verfolgt = {n for n in frag("--cached") if n}
    raus = []
    for name in sorted(verfolgt | {n for n in frag("--others", "--exclude-standard") if n}):
        if not ist_kandidat(name):
            continue
        raus.append((WURZEL / name, name in verfolgt))
    return raus


def index_kandidaten() -> list[str]:
    """Die Prosadateien, so wie sie IM INDEX stehen — nicht im Baum."""
    aus = subprocess.run(
        ["git", "-C", str(WURZEL), "ls-files", "-z", "--cached"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split("\0")
    return sorted(n for n in aus if n and ist_kandidat(n))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--pruefen",
        action="store_true",
        help="nur melden, nichts schreiben (Ausgang 1 bei Drift)",
    )
    p.add_argument(
        "--index",
        action="store_true",
        help="den Index pruefen statt den Baum — was der Commit festschreibt",
    )
    args = p.parse_args()

    if not PAKET.exists():
        print(f"UNMESSBAR: {PAKET} fehlt — es wurde nichts geprueft.")
        return 2

    # ── DIE QUELLE: BAUM ODER INDEX ────────────────────────────────────────
    # Im Index-Modus stammt AUCH die Wahrheit aus dem Index. Den Baum-Stand
    # des Pakets gegen die gestagte README zu halten waere die Mischung, die
    # den Fund vom 28.08. erst erzeugt hat.
    quellen: list[tuple[str, str, bool, Path | None]] = []
    if args.index:
        paket_roh = aus_index("llmwiki/pack.yaml")
        if paket_roh is None:
            print("UNMESSBAR: llmwiki/pack.yaml steht nicht im Index.")
            return 2
        eintraege, fassung = wahrheit(paket_roh)
        for name in index_kandidaten():
            text = aus_index(name)
            if text is not None:
                quellen.append((name, text, True, None))
    else:
        eintraege, fassung = wahrheit()
        for pfad, verfolgt in kandidaten():
            try:
                quellen.append(
                    (
                        str(pfad.relative_to(WURZEL)),
                        pfad.read_text(encoding="utf-8"),
                        verfolgt,
                        pfad,
                    )
                )
            except (UnicodeDecodeError, OSError):
                continue

    gefunden = 0
    drift = 0

    for rel, text, verfolgt, pfad in quellen:
        treffer = list(ANGABE.finditer(text))
        if not treffer:
            continue
        gefunden += len(treffer)
        falsch = [
            t
            for t in treffer
            if (int(t.group("eintraege")), t.group("fassung")) != (eintraege, fassung)
        ]
        if not falsch:
            print(f"ok    {rel}: {eintraege} Einträge, Fassung {fassung}")
            continue
        drift += len(falsch)
        for t in falsch:
            print(
                f"DRIFT {rel}: sagt {t.group('eintraege')} Einträge/"
                f"Fassung {t.group('fassung')}, das Paket hat {eintraege}/{fassung}"
            )
        if args.pruefen or args.index:
            continue
        if not verfolgt:
            print(
                f"      {rel} ist NICHT verfolgt — nur gemeldet, nicht geschrieben.\n"
                f"      Gehoert sie zu diesem Lauf: `git add` und noch einmal rufen."
            )
            continue
        neu = ANGABE.sub(
            lambda m: f"{m.group('vor')}{eintraege}{m.group('mitte')}{fassung}", text
        )
        pfad.write_text(neu, encoding="utf-8")
        print(f"      gerichtet: {rel}")

    if gefunden == 0:
        print(
            "UNMESSBAR: keine einzige Umfangsangabe gefunden — es wurde NICHTS\n"
            "gerichtet. Entweder ist die Form umgeschrieben worden oder der\n"
            "Aufruf steht im falschen Verzeichnis.\n"
            "Erwartet wurde: `llmwiki/pack.yaml` (<Zahl> Einträge, Fassung <Zahl>)"
        )
        return 2

    if drift and (args.pruefen or args.index):
        return 1
    if not drift:
        print(f"      {gefunden} Angabe(n) geprueft, keine veraltet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
