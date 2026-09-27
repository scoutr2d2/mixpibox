#!/usr/bin/env python3
"""
JEDES `var(--x)` MUSS EIN `--x:` HABEN — sonst malt die Zeile nichts.

══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════

Dreimal derselbe Fehler an diesem Baum, und zweimal davon an EINEM TAG:

  * `.wappen-ring` griff nach `var(--akzent)`. Die Farbe heisst `--accent`.
    Der Ring hatte die richtige Groesse, `--wappen-fuell` wuchs sauber von 0
    auf 1, UND ES WAR NICHTS ZU SEHEN. (06.08.2026, beim Bauen der Probe
    gefunden — nicht vermutet.)
  * `.eltern-titel` griff nach derselben erfundenen Farbe. Die Ueberschrift
    des Admin-Menues erbte die Tintenfarbe und sah aus wie die Fussnote, vor
    der der Kommentar direkt darueber ausdruecklich warnt. Sie stand so
    laenger eingecheckt da. (07.08.2026)

DIE FEHLERKLASSE IST HEIMTUECKISCH, und zwar aus einem bestimmten Grund:

    CSS WIRFT EINE UNGUELTIGE ERKLAERUNG STILL WEG.

Kein Fehler in der Konsole, keine rote Zeile, kein Absturz. Die Regel steht
im Stilblatt, sie sieht richtig aus, sie wird gelesen — und sie tut nichts.
Ein `grep` nach der Klasse findet sie, ein Blick auf die Datei findet sie,
nur das AUGE findet sie nicht, weil das Element ja irgendeine Farbe hat.

WESHALB DAS NICHT DIE AUFGABE DER MESSWERKZEUGE IST: Die pruefen, was auf dem
Schirm steht, und sie pruefen es dort, wo jemand hingesehen hat.
`wappen-halten-probe.mjs` liest seit dem Ringfehler die WIRKLICH BERECHNETE
Farbe — aber nur die des Rings. Fuer jede der ueber tausend anderen
Erklaerungen in app.css braeuchte es je ein Werkzeug. Diese Datei liest
stattdessen das Stilblatt selbst und braucht dafuer keinen Browser.

══ WAS ES NICHT KANN ══════════════════════════════════════════════════════

Eigenschaften, die von JavaScript gesetzt werden, stehen nicht im Stilblatt.
`--wappen-fuell` ist so eine (NewDesign/app.js, `elternEinstieg`).

BIS ZUM 24.08.2026 STAND SIE IN EINER HANDGEPFLEGTEN LISTE, und daneben der
Satz „WER EINE NEUE SOLCHE EINFUEHRT, TRAEGT SIE HIER EIN — sonst wird dieses
Werkzeug rot und jemand schaltet es ab". Genau das war eingetreten:
`anwenden()` setzt seit dem Bildwahl-Umbau `--fp-bild` ueber
`document.body.style.setProperty`, niemand trug es nach, und die Wache mahnte
`NewDesign/app.css:7736` als tote Zeile an — eine Zeile, die malt. Rot auf
einen Fehlalarm ist schlimmer als gar keine Wache; abgeschaltet hatte sie
niemand, weil sie in KEINER Probe laeuft (siehe `tools/wachen-ohne-probe.py`).

Die Liste wird deshalb GELESEN statt gepflegt: jede
`…style.setProperty('--x', …)` in den Oberflaechen-JS gilt als Erklaerung, mit
Datei und Zeile. Findet das Lesen GAR KEINE, meldet die Wache eine Warnung und
faellt auf die Handliste zurueck — eine Wache, die eine umbenannte Datei
ueberlebt, ist keine (llmwiki: `gegenprobe-statt-gruen-glauben`). Wer eine
Eigenschaft NICHT ueber `setProperty` setzt, traegt sie weiterhin von Hand in
`VON_JS_HAND` ein.

══ WAS ES AENDERT ═════════════════════════════════════════════════════════
Nichts. Es liest NewDesign/app.css und zaehlt.

══ AUFRUF ═════════════════════════════════════════════════════════════════
  python3 tools/stilnamen-pruefen.py
  python3 tools/stilnamen-pruefen.py --datei NewDesign/app.css
ENDE 0, wenn jede benutzte Eigenschaft auch erklaert ist.
"""

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# EIGENSCHAFTEN, DIE JAVASCRIPT SETZT, OHNE `setProperty` zu rufen — nur die
# gehoeren noch von Hand hierher. Alles mit `setProperty` liest `von_js_lesen`
# selbst; die Handpflege war die Ursache des Fehlalarms vom 24.08.2026.
VON_JS_HAND: dict[str, str] = {}

# Die JS-Dateien der Oberflaechen, in denen `setProperty` stehen darf. NICHT
# `src/deploy/**`: das ist der gebaute Abzug derselben Datei, er wuerde jede
# Fundstelle doppelt melden und beim ersten Bau ohne Nachziehen luegen.
JS_QUELLEN = ("NewDesign/app.js",)

# OHNE `style.` DAVOR. Die erste Fassung verlangte es und fand 5 von 21 —
# `anwenden()` haelt `const s = document.body.style` und ruft `s.setProperty`.
# Der Name mit `--` davor genuegt als Beleg, dass eine CSS-Eigenschaft gemeint
# ist; ein Objekt, das keine Stilerklaerung ist und `--x` setzt, gibt es nicht.
SETZT = re.compile(r"\.\s*setProperty\(\s*['\"](--[A-Za-z0-9_-]+)['\"]")


def von_js_lesen() -> tuple[dict[str, str], list[str]]:
    """Was JavaScript zur Laufzeit erklaert — mit Datei und Zeile.

    Zweiter Rueckgabewert sind Warnungen. Eine leere Ausbeute ist KEIN gruen:
    sie heisst, dass die Datei umbenannt wurde oder die Schreibweise sich
    geaendert hat, und dann muss die Handliste greifen und der Leser es sehen.
    """
    gefunden: dict[str, str] = {}
    warnungen: list[str] = []
    for rel in JS_QUELLEN:
        p = WURZEL / rel
        if not p.is_file():
            warnungen.append(f"WARNUNG: {rel} gibt es nicht — umbenannt?")
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for treffer in SETZT.finditer(text):
            zeile = text.count("\n", 0, treffer.start()) + 1
            gefunden.setdefault(treffer.group(1), f"{rel}:{zeile}")
    if not gefunden:
        warnungen.append(
            "WARNUNG: keine einzige `style.setProperty('--…')`-Stelle gefunden — "
            "es gilt nur noch VON_JS_HAND."
        )
    return gefunden, warnungen

# Kommentare raus, sonst zaehlt jede Erklaerung IM Fliesstext mit — und genau
# in einem Kommentar steht bei beiden Fehlern oben der falsche Name.
KOMMENTAR = re.compile(r"/\*.*?\*/", re.S)
ERKLAERT = re.compile(r"(--[A-Za-z0-9_-]+)\s*:")

# `var(--x)` OHNE Ersatzwert. MIT Ersatzwert (`var(--x, 12px)`) ist die
# Erklaerung GUELTIG, auch wenn es `--x` nicht gibt — der Ersatzwert greift,
# und das ist eine voellig uebliche Schreibweise. Nur die Form ohne Komma
# faellt still weg, und nur die ist ein Fehler. Diese Unterscheidung ist der
# Unterschied zwischen einem Pruefer und einem Laermgeber: ohne sie meldete
# dieses Werkzeug an diesem Baum 14 Treffer, von denen 13 richtig waren.
BENUTZT = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])")


def ohne_kommentare(roh):
    """Kommentare leeren, ABER DIE ZEILENZAHL BEHALTEN.

    Ein `sub(' ')` klebt die Zeilen um jeden mehrzeiligen Kommentar zusammen,
    und danach zeigt JEDE gemeldete Zeilennummer auf eine falsche Stelle —
    an diesem Baum, wo die Kommentare laenger sind als der Stil, um mehrere
    hundert Zeilen. Ein Pruefer, der die richtige Datei nennt und die falsche
    Zeile, schickt den Leser ins Leere und verliert sein Vertrauen beim
    ersten Nachsehen. Deshalb bleibt je Zeilenumbruch einer stehen.
    """
    return KOMMENTAR.sub(lambda m: "\n" * m.group(0).count("\n"), roh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datei", default="NewDesign/app.css")
    a = ap.parse_args()

    p = WURZEL / a.datei
    roh = p.read_text(encoding="utf-8", errors="replace")
    ohne = ohne_kommentare(roh)

    von_js, warnungen = von_js_lesen()
    von_js = {**VON_JS_HAND, **von_js}
    erklaert = set(ERKLAERT.findall(ohne)) | set(von_js)
    fehlt, mit_ersatz = {}, set()
    for zeilennr, zeile in enumerate(ohne.splitlines(), 1):
        for name, folgt in BENUTZT.findall(zeile):
            if name in erklaert:
                continue
            if folgt == ",":
                mit_ersatz.add(name)
            else:
                fehlt.setdefault(name, []).append(zeilennr)

    benutzt = {n for n, _ in BENUTZT.findall(ohne)}
    print(f"DATEI: {a.datei}")
    print(f"    erklaert: {len(erklaert) - len(von_js)}   von JS gesetzt: {len(von_js)}   benutzt: {len(benutzt)}")
    for w in warnungen:
        print(f"    {w}")
    if mit_ersatz:
        print(f"    unbekannt, aber MIT Ersatzwert (in Ordnung): {len(mit_ersatz)}")
    print()

    if not fehlt:
        print("ok    jede benutzte Eigenschaft ist auch erklaert")
        return 0

    print("NEIN  benutzt, aber nirgends erklaert — diese Zeilen malen NICHTS:\n")
    for name, zeilen in sorted(fehlt.items()):
        stellen = ", ".join(f"Z. {z}" for z in zeilen)
        print(f"      var({name})   {stellen}")
        # Der haeufigste Fall ist ein deutsches Wort fuer eine englische
        # Eigenschaft. Wer den Nachbarn nennt, spart das Suchen.
        nah = [e for e in sorted(erklaert) if e[2:4].lower() == name[2:4].lower()]
        if nah:
            print(f"          gibt es: {', '.join(nah[:6])}")
    print(f"\n{len(fehlt)} Eigenschaft(en) ohne Erklaerung")
    return 1


if __name__ == "__main__":
    sys.exit(main())
