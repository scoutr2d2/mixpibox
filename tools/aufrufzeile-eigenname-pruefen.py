#!/usr/bin/env python3
"""AUFRUFZEILE — nennt ein Werkzeug im eigenen Kopf seinen eigenen Namen?

WOZU (30.08.2026): Fast jedes Werkzeug im Baum erklaert sich oben selbst mit
einer Zeile „Aufruf: python3 tools/xyz.py ...". Diese Zeile ist die einzige
Doku, die ein Leser garantiert sieht — er hat die Datei ja schon offen. Wird
das Werkzeug spaeter umbenannt, wandert der Dateiname im Dateisystem mit, der
Name IN der Zeile nicht. Zurueck bleibt eine Anleitung, die auf ein Werkzeug
zeigt, das es nicht gibt.

Gemessen: `tools/import-abdruck-messen.py` trug in Zeile 3 „Aufruf: python3
pssmess.py". Eine Datei dieses Namens gibt es im ganzen Baum nicht — der Name
stammt aus der Zeit vor der Umbenennung. Wer der Zeile folgt, bekommt
„No such file or directory" und haelt das Werkzeug fuer kaputt.

Warum keine der 46 Doku-Wachen das fand: sie messen die Doku GEGEN den Code —
Pfade, die die Doku nennt (`doku-pfade-pruefen.py`), Zeilenzitate, Endpunkte,
Beschriftungen. Sie schauen alle nach AUSSEN. Was ein Werkzeug UEBER SICH
SELBST behauptet, gilt in keiner davon als Doku. `doku-pfade-pruefen.py` haette
den Fund sogar sehen koennen — sie sieht ihn nur nicht an, weil ihr Suchraum
`dokumentation/` und die Markdown-Dateien sind, nicht die Kopfzeilen von Code.

WACHE AUF DER SORTE, NICHT AUF DEM PFAD.
Das Merkmal ist „eine Zeile, die mit Aufruf/Nutzung/Usage/Verwendung + Doppel-
punkt beginnt und einen Skriptnamen nennt". Nicht „heisst import-abdruck-
messen.py", nicht „liegt in tools/". Jedes neue Werkzeug bringt seine Pruefung
selbst mit, sobald es sich erklaert; wird `import-abdruck-messen.py` geloescht,
verschwindet nur sein eigener Fall.

WAS SIE NICHT TUT — Absicht, keine Luecke:
  * Sie liest NUR die Selbstauskunfts-Etiketten (Aufruf, Nutzung, Usage,
    Verwendung). „Gegenprobe:" ist bewusst NICHT dabei: dort nennt ein Werkzeug
    zu Recht ein FREMDES. `scripts/box/touch-bridge.py` und sein Zwilling im
    Installer schicken den Leser per „Gegenprobe: python3
    tools/zwillingsdateien-abgleich.py" auf ein anderes Werkzeug — richtig, und
    ohne diese Trennung waeren beide Dauerfehlalarm (llmwiki
    `dauerrote-wache-ist-keine`).
  * Sie ueberliest `$(basename "$0")`. Das ist die sh-Form derselben Aussage,
    und sie kann per Bauart nicht veralten — genau das Verhalten, das diese
    Wache erzwingen will.
  * Sie streicht `<platzhalter>` vor dem Lesen. „Aufruf: prog <modul.py>" nennt
    kein Werkzeug, sondern ein Argument.
  * Sie vergleicht ueber den BASISNAMEN, nicht ueber den Pfad. „python3
    tools/x.py" in tools/x.py gilt als richtig, ebenso „./x.py". Ob das Praefix
    stimmt, prueft `doku-pfade-pruefen.py`, wo die Zeile in Doku steht.
  * Eine Zeile darf mehrere Skripte nennen (Pipe, zwei Schritte). Es genuegt,
    dass der EIGENE Name unter ihnen ist.
  * Sie prueft nicht, ob die Argumente in der Zeile noch stimmen. Nur den
    Namen. Was die Optionen tun, prueft ein Mensch.

Findet sie im ganzen Baum keine einzige Aufrufzeile, meldet sie WARNUNG statt
gruen: dann ist das Etikett umbenannt und die Wache misst nichts mehr
(llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/aufrufzeile-eigenname-pruefen.py
Gegenprobe:                        python3 tools/aufrufzeile-eigenname-pruefen.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import os
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Dateiarten, die sich selbst erklaeren koennen.
ENDUNGEN = (".py", ".sh", ".mjs")

# Ordner, in denen nicht gesucht wird. `.claude` ist dabei, weil dort die
# Arbeitsbaeume anderer Sitzungen liegen — fremde Baustellen als eigene Luecke
# zu melden ist derselbe Fehler wie in llmwiki `vorschau-wird-geliehen`.
TABU = {"node_modules", ".git", "dist", "build", ".angular", "coverage", ".claude"}

# Nur Selbstauskunft. „Gegenprobe" fehlt hier mit Absicht (siehe Kopf).
ETIKETT = re.compile(
    r"^[#\s]*(?:Aufruf|Nutzung|Usage|Verwendung)[^\n:]{0,40}:\s*(\S.*)$",
    re.M,
)

# Die sh-Form, die nicht veralten kann.
SELBSTBEZUG = ("basename \"$0\"", "basename $0", "${0##*/}")

PLATZHALTER = re.compile(r"<[^>]*>")
SKRIPTNAME = re.compile(r"[\w\-./]+\.(?:py|sh|mjs)")


def dateien() -> list[Path]:
    gefunden = []
    for pfad in WURZEL.rglob("*"):
        if pfad.suffix not in ENDUNGEN or not pfad.is_file():
            continue
        if any(teil in TABU for teil in pfad.relative_to(WURZEL).parts):
            continue
        gefunden.append(pfad)
    return sorted(gefunden)


def genannte_namen(zeile: str) -> list[str]:
    """Basisnamen der Skripte, die diese Zeile nennt — ohne Platzhalter."""
    roh = PLATZHALTER.sub("", zeile)
    return [os.path.basename(n) for n in SKRIPTNAME.findall(roh)]


def main() -> int:
    sabotage = "--sabotage" in sys.argv
    luecken: list[str] = []
    zeilen_gesamt = 0

    alle = dateien()
    vorhanden = {p.name for p in alle}

    for pfad in alle:
        rel = pfad.relative_to(WURZEL)
        eigen = pfad.name
        if sabotage:
            # GEGENPROBE: den eigenen Namen aus dem Vergleich nehmen. Danach
            # MUSS jede Aufrufzeile im Baum auffallen. Wird sie hier gruen,
            # misst sie auch im Ernstfall nichts. Nur im Speicher — es wird
            # keine Datei angefasst.
            eigen = "GIBT-ES-NICHT.py"
        text = pfad.read_text(encoding="utf-8", errors="replace")
        for zeile in ETIKETT.findall(text):
            if any(form in zeile for form in SELBSTBEZUG):
                continue
            namen = genannte_namen(zeile)
            if not namen:
                # Eine Aufrufzeile ohne Skriptnamen („Aufruf: siehe README")
                # behauptet nichts, was veralten koennte.
                continue
            zeilen_gesamt += 1
            if eigen in namen:
                continue
            fehlend = [n for n in namen if n not in vorhanden]
            print(f"  FREMDER NAME IM EIGENEN AUFRUF: {rel}")
            print(f"    Zeile nennt: {', '.join(namen)} — aber nicht sich selbst ({pfad.name})")
            if fehlend:
                print(f"    und im Baum gibt es nicht: {', '.join(fehlend)}")
            luecken.append(str(rel))

    if zeilen_gesamt == 0:
        print("  WARNUNG: keine einzige Aufrufzeile mit Skriptnamen im Baum gefunden")
        print("  — Etikett umbenannt, oder die Wache sucht am falschen Ort?")
        return 1

    print(f"  {zeilen_gesamt} Aufrufzeile(n) in {len(alle)} Skripten geprueft.")
    if luecken:
        print(f"{len(luecken)} LUECKE(N).")
        return 1
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
