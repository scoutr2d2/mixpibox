#!/usr/bin/env python3
"""VERWORFENE WEGE — traegt eine verworfene Anleitung auch den Riegel im Kopf?

WOZU (30.08.2026): Das BACKLOG fuehrt einen Abschnitt „Verworfen — nicht erneut
recherchieren". Dort steht die ENTSCHEIDUNG. Wer aber die verworfene Datei
aufmacht, sieht die Entscheidung nicht — er sieht eine saubere, vollstaendige,
plausible Anleitung und folgt ihr.

Gemessen: `documentation/build-spotifyd.md` ist eine 101-zeilige Bauanleitung
fuer spotifyd. Das BACKLOG fuehrt „build-spotifyd.md-Pfad" seit Wochen unter
Verworfen (spotifyd ist tote Alt-Unit, librespot hat abgeloest, das OS-Update
schaltet spotifyd sogar ab). AUDIT-2026-08-23 §6.4 forderte woertlich
„Riegel-Kopf oder loeschen". Am 30.08.2026 — sieben Tage spaeter — stand die
Datei unveraendert da, ohne ein Wort davon. Alle Doku-Wachen waren dabei gruen:
sie fragen, ob Pfade, Zeilen, Beschriftungen und Endpunkte EXISTIEREN. Der
spotifyd-Weg existiert ja — er ist nur verworfen. Das fragte keine.

Das ist ein Ablauffehler, kein Einzelfund (llmwiki
`wiederkehrender-befund-ist-ablauffehler`): der Fund stand im Audit, das Audit
war gebucht, die Buchung galt als Erledigung — nur die Datei wusste nichts
davon. Diese Wache setzt an der Naht an: wer etwas verwirft, schreibt es ins
BACKLOG; von dort erbt die Wache den Eintrag, ohne dass jemand sie anfasst.

WACHE AUF DER SORTE, NICHT AUF DEM PFAD.
Das Merkmal ist „im Verworfen-Abschnitt des BACKLOG genannt", nicht
„heisst build-spotifyd.md". Wird morgen ein anderer Weg verworfen, deckt die
Wache ihn mit, sobald die Entscheidung im BACKLOG steht. Verschwindet
build-spotifyd.md, verschwindet mit ihr nur ihr eigener Fall.

WAS SIE NICHT TUT — Absicht, keine Luecke:
  * Sie erkennt nur Namen MIT Endung im Verworfen-Abschnitt. „Mopidy",
    „log2ram", „Amazon Music" nennen kein Repo-Artefakt und werden uebergangen;
    ein verworfener Dienst hat keine Datei, die man markieren koennte.
  * Sie kann Aufzaehlung nicht von Prosa unterscheiden: JEDER Dateiname mit
    Endung in diesem Abschnitt gilt als verworfen. Beim Bauen dieser Wache ist
    genau das passiert — ein erklaerender Nebensatz nannte `tools/pruefen.sh`,
    und die Wache verlangte prompt einen Riegel in der Pruefbatterie. Der
    Abschnitt im BACKLOG sagt das jetzt dazu. Die Alternative waere, die Liste
    an einer zweiten Stelle von Hand zu pflegen — und genau die laeuft
    auseinander.
  * Sie loest ueber den BASISNAMEN im Baum auf. Gibt es den Namen zweimal,
    verlangt sie den Riegel in JEDER Fundstelle — lieber einmal zu viel
    markiert als die falsche Kopie sauber gemeldet.
  * Sie liest nur den KOPF (die ersten 12 nichtleeren Zeilen). Ein Riegel in
    Zeile 80 erreicht den Leser nicht, der oben anfaengt und dem ersten
    Codeblock folgt. Genau darum ging der Fund verloren.
  * Sie prueft nicht, ob der Riegel INHALTLICH stimmt. Sie prueft, dass er da
    ist und auf die Entscheidung zeigt. Was drinsteht, prueft ein Mensch.

Findet sie den Abschnitt nicht, oder loest kein einziger Name auf eine Datei
auf, meldet sie WARNUNG statt gruen (llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/verworfene-wege-markiert.py
Gegenprobe:                        python3 tools/verworfene-wege-markiert.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BACKLOG = WURZEL / "BACKLOG.md"
ABSCHNITT = "Verworfen — nicht erneut recherchieren"

# Wie weit oben der Riegel stehen muss, gezaehlt in nichtleeren Zeilen. Zwoelf,
# weil der Leser dem ersten Codeblock folgt: was danach kommt, haelt ihn nicht
# mehr auf.
KOPFZEILEN = 12

# Endungen, hinter denen ein Weg stecken kann, dem jemand folgt.
ENDUNGEN = ("md", "sh", "ts", "js", "mjs", "py", "yaml", "yml", "conf", "service")

# Der Riegel selbst UND der Verweis auf die Entscheidung. Beides, weil ein
# blosses „verworfen" den Leser nicht sagt, wo er nachliest — und weil ein
# blosser BACKLOG-Verweis auch in einer gueltigen Datei stehen kann.
RIEGEL = re.compile(r"\bverworfen\b|\bgilt nicht mehr\b|\bnicht ausf(?:ü|ue)hren\b", re.I)
VERWEIS = re.compile(r"BACKLOG\.md", re.I)

# Ordner, in denen nicht gesucht wird. `.claude` ist dabei, weil dort die
# Arbeitsbaeume anderer Sitzungen liegen: eine Kopie derselben Datei, die noch
# den Stand von vorgestern traegt. Wer sie mitmisst, meldet fremde Baustellen
# als eigene Luecke (llmwiki `vorschau-wird-geliehen` beschreibt dieselbe
# Verwechslung von der anderen Seite).
TABU = {"node_modules", ".git", "dist", "build", ".angular", "coverage", ".claude"}


def verworfene_namen() -> list[str]:
    """Basisnamen mit Endung aus dem Verworfen-Abschnitt des BACKLOG."""
    if not BACKLOG.exists():
        return []
    text = BACKLOG.read_text(encoding="utf-8", errors="replace")
    treffer = re.search(rf"^#+ {re.escape(ABSCHNITT)}\s*$(.*?)(?=^#+ |\Z)", text, re.S | re.M)
    if not treffer:
        return []
    roh = re.findall(
        rf"([A-Za-z0-9][A-Za-z0-9._-]*\.(?:{'|'.join(ENDUNGEN)}))\b",
        treffer.group(1),
    )
    return sorted(set(roh))


def fundstellen(name: str) -> list[Path]:
    """Alle Dateien im Baum, die so heissen."""
    gefunden = []
    for pfad in WURZEL.rglob(name):
        if any(teil in TABU for teil in pfad.relative_to(WURZEL).parts):
            continue
        if pfad.is_file():
            gefunden.append(pfad)
    return sorted(gefunden)


def kopf(pfad: Path, entriegeln: bool = False) -> str:
    """Die ersten KOPFZEILEN nichtleeren Zeilen einer Datei."""
    zeilen = []
    for zeile in pfad.read_text(encoding="utf-8", errors="replace").splitlines():
        if not zeile.strip():
            continue
        zeilen.append(zeile)
        if len(zeilen) >= KOPFZEILEN:
            break
    text = "\n".join(zeilen)
    if entriegeln:
        # GEGENPROBE: den Riegel herausnehmen und pruefen, dass die Wache rot
        # wird. Gruen am sauberen Baum beweist nur, dass sie laeuft.
        text = RIEGEL.sub("XXX", text)
    return text


def main() -> int:
    sabotage = "--sabotage" in sys.argv
    luecken: list[str] = []

    namen = verworfene_namen()
    if not namen:
        print(f"  WARNUNG: kein Dateiname mit Endung im Abschnitt '{ABSCHNITT}' in BACKLOG.md")
        print("  — Abschnitt umbenannt, verschoben, oder die Schreibweise geaendert?")
        return 1
    print(f"  {len(namen)} verworfene(r) Name(n) aus BACKLOG.md: {', '.join(namen)}")

    geprueft = 0
    for name in namen:
        stellen = fundstellen(name)
        if not stellen:
            # Kein Fehler: ein verworfener Weg darf auch geloescht worden sein.
            print(f"  (kein Artefakt im Baum zu '{name}' — geloescht, das ist die andere gueltige Antwort)")
            continue
        for pfad in stellen:
            geprueft += 1
            rel = pfad.relative_to(WURZEL)
            text = kopf(pfad, entriegeln=sabotage)
            fehlt = []
            if not RIEGEL.search(text):
                fehlt.append("Riegel-Wort")
            if not VERWEIS.search(text):
                fehlt.append("Verweis auf BACKLOG.md")
            if fehlt:
                print(f"  VERWORFEN, ABER UNMARKIERT: {rel}")
                print(f"    im Kopf (erste {KOPFZEILEN} Zeilen) fehlt: {', '.join(fehlt)}")
                luecken.append(str(rel))

    if geprueft == 0:
        print("  WARNUNG: kein einziger verworfener Name loeste auf eine Datei auf — Liste veraltet?")
        return 1

    print(f"  {geprueft} Artefakt(e) geprueft.")
    if luecken:
        print(f"{len(luecken)} LUECKE(N).")
        return 1
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
