#!/usr/bin/env python3
"""MENUE-SCHALTER-DECKUNG — was am Geraet stellbar ist, muss die Verwaltung auch koennen.

WARUM ES DAS GIBT (20.09.2026): Der Auftrag zum Ansagen der Uhrzeit lautete
woertlich „ich moechte einen schalter in BEIDEN menues haben". Das ist keine
Laune, sondern die Bauart des Hauses: Die Box-Oberflaeche hat ihren
Eltern-Bereich (NewDesign/app.js, `ANZEIGE_SCHALTER`), und die Verwaltung im
Netz hat die Seite „Darstellung" (src/frontend-admin/.../seiten/darstellung.ts)
— beide schreiben in dieselbe `darstellung.json`. Ein Schalter, den es nur an
einem der beiden Orte gibt, ist deshalb kein halbes Feature, sondern eine
Einstellung, die je nach Standpunkt zu existieren scheint oder nicht.

WAS GEMESSEN WURDE, BEVOR DIESE WACHE GESCHRIEBEN WURDE (20.09.2026): von 33
Schaltern des Box-Menues fehlten FUENF in der Verwaltung — `lautGlas`,
`torGlas`, `kissenMicro`, `kinderzeitPassung` und `verschmelzen`. Sie stehen
unten in `NUR_AM_GERAET`, mit Datum, damit diese Wache heute gruen sein kann,
OHNE die Luecke zu verschweigen: eine Wache, die vom ersten Tag an rot ist, liest nach
einer Woche niemand mehr [llmwiki dauerrote-wache-ist-keine]. Wer einen davon
in die Verwaltung nachtraegt, streicht ihn hier — und wer einen NEUEN Schalter
nur an einem Ort baut, wird rot.

DIE ANDERE RICHTUNG WIRD ABSICHTLICH NICHT GEPRUEFT. Die Verwaltung darf mehr
koennen als die Box: Sie hat Farbregler, Randbreiten und Feinwerte, die auf
eine Karte mit fuenf Zeilen nicht passen (der Grund steht in app.js bei
`wischZeilen`). Eine Wache in beide Richtungen waere die Behauptung, beide
Orte muessten gleich sein — dann meldete sie bei jedem Feinwert der Verwaltung
rot und stuende genau dem im Weg, was dort richtig ist.

AUF DIE SORTE GEWACHT UND NICHT AUF EINE LISTE VON NAMEN: Gelesen wird der
Block `ANZEIGE_SCHALTER` aus app.js und daraus JEDES `id:`. Eine Liste
bekannter Schalter im Skript waere derselbe Fehler eine Ebene hoeher — sie
verschwaende mit dem Schalter, den sie bewachen soll.

GESUCHT WIRD DIE SCHREIBNAHT `setz({ <feld>` UND NICHT DER NAME IRGENDWO.
Das ist der Unterschied zwischen dieser Wache und einer, die gruen meldet, was
sie nicht geprueft hat: Jedes Feld steht in darstellung.ts DREIMAL — in
`interface Darstellung`, in `STANDARD` und (vielleicht) an einem Knopf. Die
erste Fassung dieser Wache suchte bloss den Namen und war deshalb schon gruen,
sobald das Feld im Interface stand — bei `verschmelzen` genau so passiert: Feld
und Vorgabe sind da, ein Knopf war es nie. Was ZAEHLT, ist die Stelle, die den
Wert wirklich schreibt [llmwiki gegenprobe-bleibt-gruen-ist-der-fund].

ZWEI SORTEN SCHALTER, ZWEI FRAGEN. Die meisten Zeilen stellen ein Feld der
obersten Ebene (`weiter:`), und dann muss die Verwaltung genau dieses Feld
schreiben. Die Groessenregler (`felder:`) schreiben in ein UNTEROBJEKT — ihre
`id` (`coverGroesse`) steht in keiner JSON-Datei, gestellt wird `skalen`. Fuer
sie wird deshalb das Zielobjekt geprueft und nicht die id; sonst verlangte die
Wache einen Schluessel, den es nirgends gibt.

    python3 tools/menue-schalter-deckung.py            Tabelle
    python3 tools/menue-schalter-deckung.py --pruefen  Wache (rot bei Luecke)

WAS ES AENDERT: nichts. Es liest zwei Dateien.
"""

from __future__ import annotations

import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
NEU = WURZEL / 'NewDesign/app.js'
ADMIN = WURZEL / 'src/frontend-admin/src/app/seiten/darstellung.ts'

# ── HEUTE BEKANNTE EINSEITIGE (gemessen 20.09.2026) ──────────────────────
#
# Kein Freibrief, sondern eine datierte Bestandsaufnahme: Diese fuenf waren am
# Tag dieser Wache nur am Geraet stellbar. Wer einen in die Verwaltung
# nachtraegt, nimmt ihn hier heraus — steht er dann doppelt, meldet der
# `--pruefen`-Lauf es als unnoetige Ausnahme, damit die Liste nicht mit
# erledigten Zeilen zuwaechst.
NUR_AM_GERAET = {
    'lautGlas': 'Lautstaerke-Anzeige aus Glas — nie in die Verwaltung uebernommen.',
    'torGlas': 'Das Tor des Eltern-Bereichs aus Glas — dito.',
    'kissenMicro': 'Mini-Player nur als Bild — dito.',
    'kinderzeitPassung': 'Kennzeichnen, was noch in die Hoerzeit passt — dito.',
    # DER LEHRREICHE FALL: `verschmelzen` STEHT in darstellung.ts — als Feld im
    # Interface und mit einer Vorgabe in STANDARD. Nur stellen kann es dort
    # niemand. Wer nach dem Namen sucht, haelt es fuer erledigt; wer nach der
    # Schreibnaht sucht, sieht die Luecke.
    'verschmelzen': 'Doppelte Alben zusammenfassen — Feld und Vorgabe da, Knopf fehlt.',
}


def schalter() -> list[tuple[str, str | None]]:
    """Jeder Schalter des Box-Menues als (id, Zielobjekt oder None).

    Zielobjekt ist der Name des Unterobjekts, in das eine `felder:`-Zeile
    schreibt (`skalen`) — bei den gewoehnlichen Schaltern None.
    """
    text = NEU.read_text(encoding='utf-8')
    anfang = text.index('const ANZEIGE_SCHALTER')
    # Bis zur schliessenden Klammer des Arrays auf derselben Einrueckung. Der
    # Block ist zweifach eingerueckt (er steht in der IIFE), ein `\n]` gibt es
    # also nicht — dieselbe Falle wie beim Klammerzaehler des Regel-Auszugs.
    ende = text.index('\n  ]', anfang)
    block = text[anfang:ende]
    raus: list[tuple[str, str | None]] = []
    # Je Eintrag: die id und, falls vorhanden, das erste Feld der `felder:`-
    # Rueckgabe. Die Eintraege sind durch `\n    {` getrennt.
    for stueck in re.split(r'\n    \{', block):
        m = re.search(r"^\s+id: '([A-Za-z0-9]+)',", stueck, re.M)
        if not m:
            continue
        f = re.search(r'felder: \([^)]*\) => \(\{\s*([A-Za-z0-9]+):', stueck)
        raus.append((m.group(1), f.group(1) if f else None))
    return raus


def main() -> int:
    pruefen = '--pruefen' in sys.argv
    adm = ADMIN.read_text(encoding='utf-8')
    liste = schalter()
    if not liste:
        print('KEIN EINZIGER SCHALTER GEFUNDEN — der Block ANZEIGE_SCHALTER wurde umbenannt oder verschoben.')
        return 1

    fehlen: list[str] = []
    unnoetig: list[str] = []
    for sid, ziel in liste:
        gesucht = ziel or sid
        # `setz({ feld` ist die EINE Stelle, an der die Verwaltung einen Wert
        # schreibt (`setz` in darstellung.ts). Ein Vorkommen des Namens im
        # Interface oder in STANDARD reicht ausdruecklich nicht.
        da = re.search(r'setz\(\{\s*' + re.escape(gesucht) + r'\b', adm) is not None
        vermerkt = sid in NUR_AM_GERAET
        if da and vermerkt:
            unnoetig.append(sid)
        if not da and not vermerkt:
            fehlen.append(sid)
        if not pruefen:
            zeichen = 'ok  ' if da else ('vermerkt' if vermerkt else 'FEHLT')
            zusatz = f'  (ueber {ziel})' if ziel else ''
            print(f'{zeichen:9s}{sid}{zusatz}')

    if fehlen:
        print(f'\n{len(fehlen)} Schalter nur im Box-Menue und nicht in der Verwaltung:')
        for s in fehlen:
            print(f'  {s}')
        print('Entweder eine Zeile in darstellung.ts nachtragen oder — mit Grund — in NUR_AM_GERAET aufnehmen.')
        return 1
    if unnoetig:
        print(f'\n{len(unnoetig)} Ausnahme(n) in NUR_AM_GERAET sind erledigt und gehoeren heraus:')
        for s in unnoetig:
            print(f'  {s}')
        return 1
    print(
        f'\n{len(liste)} Schalter des Box-Menues, alle in der Verwaltung stellbar '
        f'({len(NUR_AM_GERAET)} datierte Ausnahmen).'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
