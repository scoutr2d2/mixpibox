#!/usr/bin/env python3
"""Misst nach, dass die BEIDEN Systemkurven dieselben Zahlen benutzen.

WOZU: Der Betreiber wollte die Kurve am 08.08.2026 „in beiden admin bereichen".
Es gibt sie deshalb zweimal:

    NewDesign/app.js                          der Eltern-Bereich AUF der Box
      sysKurveBauen + SYS_* + sys*()          (einfaches JavaScript, kein Modul)

    src/frontend-admin/src/app/               die Verwaltung im BROWSER
      systemverlauf.ts + seiten/systemkurve.ts  (Angular, TypeScript)

EIN GEMEINSAMES MODUL GEHT NICHT: NewDesign ist ein `<script src>` ohne einen
einzigen `import` (und wird ausserdem als MixPiBox-standalone.html zu einer
Datei zusammengelegt), die Verwaltung ist ein Angular-Buendel. Sie zu vereinen
hiesse, eines von beiden umzubauen — fuer drei Kurven zu teuer.

WAS DANN? Genau das hier: eine Wache statt einer Bitte im Kommentar. Es gab
schon einmal einen Fall dieser Sorte — zwei Weiterhoeren-Schwellen, die durch
eine Bitte gleich bleiben sollten und es nicht taten. Jene Wache ist am
19.09.2026 gefallen, weil ihre zweite Stelle mit der alten Oberflaeche
verschwand; ihr NAME steht hier absichtlich nicht mehr. Bis zum selben Tag
zaehlte die Erreichbarkeits-Pruefung eine Nennung wie diese naemlich als RUF
und hielt die laengst kaputte Wache fuer gedeckt.

WAS GEPRUEFT WIRD — und warum ausgerechnet das:

    GRAD_VON / GRAD_BIS   Die Skala der Waermebahn. Laufen sie auseinander,
                          sieht dieselbe Box in der einen Verwaltung ruhig aus
                          und in der anderen heiss. Es gibt keine Fehlermeldung
                          dazu; beide Bilder sehen fuer sich genommen richtig
                          aus. DAS ist der Grund fuer dieses Werkzeug.
    GRAD_MARKE            Die Drosselschwelle. Eine falsche Marke ist eine
                          Warnung an der falschen Stelle.
    MIND_PUNKTE           Ab wann statt eines Satzes ein Bild kommt.
    MIND_SPANNE_MS        Dasselbe fuer die Dauer.
    SPANNEN               Welche Zeitraeume der Kopfknopf durchschaltet.
    BAHNEN                Reihenfolge, Feldnamen und Namen der drei Bahnen.
                          Vertauscht man zwei, steht die Waerme in einer
                          Prozentskala — und 48 °C werden zu „48 %".

WAS NICHT GEPRUEFT WIRD: die Bildmasse (L, R, H, ABSTAND). Sie stehen zwar in
beiden Fassungen gleich, aber sie sind Gestaltung und keine Aussage — eine
Verwaltung auf einem breiten Schirm darf ihre Bahnen hoeher machen, ohne dass
etwas falsch wird.

WAS ES AENDERT: nichts. Es liest zwei Dateien und sagt, was es findet.

AUFRUF
    python3 tools/systemkurve-gleich.py
    echo $?        # 0 = gleich, 1 = auseinandergelaufen
"""
import pathlib
import re
import sys

BOX = pathlib.Path('NewDesign/app.js')
VERWALTUNG = pathlib.Path('src/frontend-admin/src/app/systemverlauf.ts')

# name -> (Muster in der Box, Muster in der Verwaltung)
#
# DIE MUSTER SIND ABSICHTLICH ENG. Ein `SYS_GRAD_BIS.*?(\d+)` faende auch eine
# Erwaehnung im Kommentar, und dann prueft dieses Werkzeug einen Fliesstext.
ZAHLEN = {
    'GRAD_VON': (r'const SYS_GRAD_VON = (\d+)', r'export const GRAD_VON = (\d+)'),
    'GRAD_BIS': (r'const SYS_GRAD_BIS = (\d+)', r'export const GRAD_BIS = (\d+)'),
    'GRAD_MARKE': (r'const SYS_GRAD_MARKE = (\d+)', r'export const GRAD_MARKE = (\d+)'),
    # DIE BOX TEILT SICH DIE ZWEI SCHWELLEN MIT DER AKKUKURVE (`sysDuenn` ruft
    # AKKU_MIND_*). Das ist gewollt — beide Kurven sollen an derselben Stelle
    # aufgeben — und deshalb steht hier der Akku-Name.
    'MIND_PUNKTE': (r'const AKKU_MIND_PUNKTE = (\d+)', r'export const MIND_PUNKTE = (\d+)'),
    'MIND_SPANNE_MS': (r'const AKKU_MIND_SPANNE_MS = (\d+)', r'export const MIND_SPANNE_MS = (\d+)'),
}

SPANNEN = (r'const SYS_SPANNEN = \[([^\]]+)\]', r'export const SPANNEN = \[([^\]]+)\] as const')


def einzeln(text, muster, wo, name):
    """Genau EIN Treffer, sonst ist die Aussage wertlos."""
    treffer = re.findall(muster, text)
    if len(treffer) != 1:
        print(f'  ! {name}: {len(treffer)} Treffer in {wo}, genau 1 erwartet')
        return None
    return treffer[0]


def bahnen_box(text):
    """Die drei Bahnen aus `sysKurveBauen` — Feld und Name, in Reihenfolge."""
    stelle = re.search(r'const BAHNEN = \[(.*?)\n      \]', text, re.S)
    if not stelle:
        return None
    return re.findall(r"feld: '(\w+)', name: '([^']+)'", stelle.group(1))


def bahnen_verwaltung(text):
    stelle = re.search(r'export const BAHNEN = \[(.*?)\n\] as const', text, re.S)
    if not stelle:
        return None
    return re.findall(r"feld: '(\w+)', name: '([^']+)'", stelle.group(1))


def main():
    if not BOX.exists() or not VERWALTUNG.exists():
        print('Eine der beiden Dateien fehlt — im Wurzelverzeichnis aufrufen.')
        return 2
    box = BOX.read_text(encoding='utf-8')
    verw = VERWALTUNG.read_text(encoding='utf-8')

    schief = 0
    print('Die Systemkurve gibt es zweimal. Stimmen die Zahlen ueberein?\n')

    for name, (m_box, m_verw) in ZAHLEN.items():
        a = einzeln(box, m_box, BOX.name, name)
        b = einzeln(verw, m_verw, VERWALTUNG.name, name)
        if a is None or b is None:
            schief += 1
            continue
        gleich = a == b
        print(f'  {"ok  " if gleich else "NEIN"} {name:<16} Box {a:<10} Verwaltung {b}')
        if not gleich:
            schief += 1

    a = einzeln(box, SPANNEN[0], BOX.name, 'SPANNEN')
    b = einzeln(verw, SPANNEN[1], VERWALTUNG.name, 'SPANNEN')
    if a is None or b is None:
        schief += 1
    else:
        za = [x.strip() for x in a.split(',') if x.strip()]
        zb = [x.strip() for x in b.split(',') if x.strip()]
        gleich = za == zb
        print(f'  {"ok  " if gleich else "NEIN"} {"SPANNEN":<16} Box {za}      Verwaltung {zb}')
        if not gleich:
            schief += 1

    ba = bahnen_box(box)
    bb = bahnen_verwaltung(verw)
    if not ba or not bb:
        print(f'  ! BAHNEN: nicht gefunden (Box {ba}, Verwaltung {bb})')
        schief += 1
    else:
        gleich = ba == bb
        print(f'  {"ok  " if gleich else "NEIN"} {"BAHNEN":<16} {ba}')
        if not gleich:
            print(f'       {"":<16} {bb}   <- Verwaltung')
            # WARUM DAS SCHLIMM IST: die Reihenfolge entscheidet ueber die
            # SKALA. Steht die Waerme an der Stelle einer Prozentbahn, werden
            # aus 48 °C achtundvierzig Prozent — eine Zahl, die richtig
            # aussieht.
            schief += 1

    print()
    if schief:
        print(f'{schief} Stelle(n) laufen auseinander. Beide Fassungen zeigen dieselbe Box —')
        print('sie duerfen ihr nicht verschiedene Dinge nachsagen.')
        return 1
    print('Beide Fassungen benutzen dieselben Zahlen.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
