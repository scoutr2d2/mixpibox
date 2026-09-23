#!/usr/bin/env python3
"""ADMIN-ABSCHNITTE-DECKUNG — nennt das Handbuch die ABSCHNITTE einer Seite?

WARUM ES DAS GIBT (30.08.2026, stuendlicher Doku-Lauf): mit dem
Aufnahme-Steuerpult (7b929d32) bekam `Verwaltung → Medien` einen neuen
Kasten `Aufnahmen` samt Knopf `Aufnehmen` an jeder Spotify-Zeile. Das
Benutzerhandbuch kannte davon nichts — und KEINE der bestehenden Wachen
schlug an. Der ganze Doku-Lauf meldete `KEINE LUECKE.`

Der Grund ist eine Schichtgrenze, und sie ist die eigentliche Lehre:

    Die Code→Doku-Deckung der Verwaltung hoert bei der SEITE auf.

`tools/doku-luecken-probe.sh` haelt die Verwaltungsseiten aus `rahmen.ts`
und die Wege aus `app.routes.ts` gegen das Handbuch. `medien.ts` steht
dort laengst — die Seite ist genannt, also gruen. Ein neuer `<h2>`-Kasten
INNERHALB einer schon genannten Seite ist fuer jede dieser Wachen
unsichtbar. Ein Abschnitt, der zu einer bestehenden Seite dazuwaechst,
kann damit beliebig gross werden, ohne je gemeldet zu werden.

Dieselbe Achse ist im Baum schon zweimal beschrieben, jeweils eine
Schicht tiefer:
  * `tools/beschriftungen-deckung.py`  misst die OBERFLAECHE (admin/box)
  * `tools/handbuch-ort-deckung.py`    misst die SEITE (welche Unterseite)
  * diese Wache                        misst den ABSCHNITT auf der Seite

Und die Richtung ist die andere: die beiden Schwestern pruefen, was die
Doku BEHAUPTET (cite-getrieben). Sie schweigen zwangslaeufig ueber etwas,
das die Doku gar nicht erst erwaehnt. Diese hier geht von der Seite aus.

WARUM SIE NICHT IM GATTER HAENGT (wichtig, bitte so lassen):
Gemessen am 30.08.2026 sind 44 von 70 Abschnitten im Handbuch ungenannt.
Ein Teil davon ist ABSICHT — `leistung.ts` („Speicher je Posten", „Zeitachse
des Starts") ist Diagnosewerkzeug fuer den Entwickler, kein Betreiberstoff.
Eine Wache, die ab dem ersten Lauf 44 Zeilen rot meldet, ist keine Wache;
sie verdeckt den naechsten echten Fund, statt ihn zu zeigen. Deshalb
laeuft dieses Werkzeug als MESSINSTRUMENT (Rueckgabe 0) und wird erst
scharf (`--streng`, Rueckgabe 1), wenn der Rueckstand abgetragen und eine
Ausnahmeliste mit BEGRUENDUNG gepflegt ist.

DIE GRENZE DIESES WERKZEUGS (beim Bau gemessen, nicht vermutet):
Der Vergleich ist ein Textvergleich gegen das ganze Handbuch. Fuer den
Kasten, der diese Wache ausgeloest hat, traegt er NICHT — `Aufnahmen` ist
ein Alltagswort und stand im Handbuch laengst in ganz anderer Sache
(„sechs betroffene **Aufnahmen** liegen noch in der Mediathek", Abschnitt
11). Die Wache haette den Kasten `Aufnahmen` also als gedeckt gemeldet,
BEVOR er dokumentiert war. Nachgemessen: mit und ohne den neuen Absatz
meldet sie beide Male 26 gedeckte Abschnitte.

Auch ein Auszaehlen der AUSZEICHNUNG (`<strong>`, `<em>`) rettet das
nicht — die Fehlstelle steht selbst in `<strong>`. Deshalb wird hier
NICHT weiter am Vergleich geschraubt, sondern die Unsicherheit
AUSGEWIESEN: Ein-Wort-Ueberschriften, die irgendwo vorkommen, landen in
einem eigenen Topf `UNENTSCHEIDBAR` statt stillschweigend unter
„gedeckt". Ein Werkzeug, das seine blinde Stelle als Deckung ausgibt,
waere schlimmer als keins.

AUF DIE SORTE GEWACHT, NICHT AUF DEN PFAD: gesucht wird das Merkmal
`<h2>…</h2>` in den Seitenvorlagen unter `seiten/`, nicht eine Liste
bekannter Kastennamen. Ein umbenannter Kasten bleibt damit im Blick.

Aufruf:
    tools/admin-abschnitte-deckung.py            # Bericht, Rueckgabe 0
    tools/admin-abschnitte-deckung.py --streng   # Rueckgabe 1 bei Luecke
    tools/admin-abschnitte-deckung.py --sabotage # Gegenprobe (s.u.)

GEGENPROBE (`--sabotage`): haengt einen Kasten an, den es nirgends gibt.
Er MUSS als ungedeckt auftauchen — sonst misst das Werkzeug nichts.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SEITEN = WURZEL / "src/frontend-admin/src/app/seiten"
HANDBUCH = WURZEL / "dokumentation/benutzerhandbuch.html"

# Marke und Kennung GETRENNT halten und erst zur Laufzeit zusammensetzen -
# sonst greift das eigene Suchmuster auf die Attrappe im Quelltext zu und die
# Wache ist ab dem ersten Lauf dauerrot ([[gegenprobe-der-baumweiten-wache-liegt-im-baum]]).
SABOTAGE_KASTEN = "Diesen Kasten gibt es nicht"

# Ueberschriften mit Angular-Ausdruck ({{ }}, @if) tragen keinen festen Text -
# sie sind nicht vergleichbar und werden uebersprungen, EINZELN gemeldet.
H2 = re.compile(r"<h2>([^<]+)</h2>")


def _normal(s: str) -> str:
    """Vergleichsform: NFC, typografische Zeichen auf ASCII, Weissraum gestaucht.

    Das Handbuch schreibt `&nbsp;` und typografische Anfuehrungszeichen, die
    Vorlage schreibt sie direkt - ohne Angleich meldet die Wache Unterschiede,
    die auf dem Schirm keine sind.
    """
    s = unicodedata.normalize("NFC", s)
    for a, b in (("„", '"'), ("“", '"'), ("”", '"'),
                 ("’", "'"), ("‘", "'"), ("–", "-"),
                 ("—", "-"), (" ", " ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def _einwort(t: str) -> bool:
    """Ist die Ueberschrift ein einzelnes Alltagswort?

    Dann ist ein Treffer im Handbuch KEIN Beweis fuer Deckung - siehe
    „DIE GRENZE DIESES WERKZEUGS" im Kopf.
    """
    return len(_normal(t).split()) == 1


def abschnitte() -> list[tuple[str, str]]:
    """Alle festen <h2>-Kaesten der Verwaltungsseiten, als (Datei, Text)."""
    gefunden: list[tuple[str, str]] = []
    for p in sorted(SEITEN.glob("*.ts")):
        if p.name.endswith(".spec.ts"):
            continue
        for roh in H2.findall(p.read_text(encoding="utf-8")):
            text = roh.strip()
            if not text:
                continue
            if "{{" in text or "@" in text:
                print(f"  UEBERSPRUNGEN (kein fester Text): {p.name}: {text}")
                continue
            gefunden.append((p.name, text))
    return gefunden


def main() -> int:
    streng = "--streng" in sys.argv
    if not HANDBUCH.exists():
        print(f"FEHLT: {HANDBUCH}")
        return 1

    handbuch = _normal(HANDBUCH.read_text(encoding="utf-8"))
    gefunden = abschnitte()
    if "--sabotage" in sys.argv:
        gefunden.append(("(sabotage)", SABOTAGE_KASTEN))

    fehlt: list[tuple[str, str]] = []
    unsicher: list[tuple[str, str]] = []
    for d, t in gefunden:
        if _normal(t) not in handbuch:
            fehlt.append((d, t))
        elif _einwort(t):
            unsicher.append((d, t))

    print(f"\nAbschnitte der Verwaltung: {len(gefunden)} — "
          f"sicher genannt: {len(gefunden) - len(fehlt) - len(unsicher)}, "
          f"ungenannt: {len(fehlt)}, unentscheidbar: {len(unsicher)}")
    if fehlt:
        print("\nDas Handbuch nennt diese Kaesten NIRGENDS:")
        for d, t in fehlt:
            print(f"  {d}: {t}")
        print("\nHINWEIS: Ein Teil davon ist Absicht (Diagnoseseiten wie "
              "leistung.ts). Der Kopf dieser Datei sagt, warum das Werkzeug "
              "trotzdem nicht im Gatter haengt.")
    if unsicher:
        print("\nUNENTSCHEIDBAR — die Ueberschrift ist ein Alltagswort, das im "
              "Handbuch vorkommt, aber vielleicht in ganz anderer Sache "
              "(siehe Kopf: DIE GRENZE DIESES WERKZEUGS). Hier muss ein "
              "Mensch nachsehen:")
        for d, t in unsicher:
            print(f"  {d}: {t}")

    if "--sabotage" in sys.argv:
        traf = any(t == SABOTAGE_KASTEN for _, t in fehlt)
        print(f"\nGEGENPROBE: Attrappe als ungedeckt gemeldet? "
              f"{'JA - das Werkzeug misst' if traf else 'NEIN - das Werkzeug misst NICHTS'}")
        return 0 if traf else 1

    return 1 if (fehlt and streng) else 0


if __name__ == "__main__":
    raise SystemExit(main())
