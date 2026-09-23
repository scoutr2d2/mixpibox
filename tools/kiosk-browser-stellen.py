#!/usr/bin/env python3
"""WO ueberall wird nach dem Kiosk-Browser gesucht — und kennt jede Stelle beide Namen?

    python3 tools/kiosk-browser-stellen.py
    python3 tools/kiosk-browser-stellen.py --nur-befunde

══ WOZU ═══════════════════════════════════════════════════════════════════

Seit E56 ist der Kiosk-Browser WAEHLBAR (`mupibox.kioskBrowser`: chromium oder
cog). Der Schalter ist eine Stelle — die VERBRAUCHER sind viele, und sie
stehen ueber den ganzen Baum verteilt: Startskripte, LED-Steuerung,
Diagnosewerkzeuge, Messwerkzeuge.

E68 (20.08.2026) fand drei davon, weil der Knopf endlos blinkte. Beim Beheben
fiel eine VIERTE auf — durch Zufall, bei einer Gegenprobe, deren Ergebnis
nicht passte. Dieser Zufall ist der Grund fuer dieses Werkzeug: „ob es die
letzten waren, weiss niemand" ist keine Antwort, die man stehen lassen kann.

Es fand danach vier WEITERE, die weder E68 noch der Kritiker-Lauf genannt
hatten — darunter zwei, die noch den alten Namen `chromium-browser` fuehren,
der auf dieser Box seit dem 07.08.2026 falsch ist.

══ WARUM ES NICHT EINFACH EINE GEMEINSAME FUNKTION GIBT ═══════════════════

Der naheliegende Vorschlag ist `kiosk-laeuft.sh`, von allen aufgerufen. Genau
das lehnt dieses Projekt an anderer Stelle mit Begruendung ab — der Kommentar
ueber `schirm_zustand` in mupi_start_led.sh:

    „eine gemeinsame Datei muesste vom Update zuverlaessig mitkommen, und
     faellt sie aus, starten BEIDE Dienste nicht mehr. Auf einer Box, die
     niemand wieder einschalten kann, ist eine doppelte Funktion das kleinere
     Uebel — dass die beiden Fassungen gleich bleiben, prueft
     tools/schirm-sandkasten.py."

Dieses Werkzeug ist das Gegenstueck dazu: die Doppelung bleibt, das
AUSEINANDERLAUFEN wird gemessen. Und zwar ueber den GANZEN Baum, nicht ueber
eine Liste bekannter Stellen — sonst findet es nur, was ohnehin schon jemand
wusste.

══ WAS ES NICHT ENTSCHEIDET ═══════════════════════════════════════════════

Nicht jede Fundstelle MUSS beide Namen kennen. Ein Skript, das gezielt
Chromium-Reste aufraeumt, darf `chromium` allein nennen. Deshalb meldet dieses
Werkzeug, es verbietet nicht — und eine Stelle, die bewusst nur einen Namen
fuehrt, traegt die Marke `# kiosk-browser: nur chromium, weil …` in der Zeile
darueber und faellt dann nicht mehr auf.
"""
import argparse
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
AUSGENOMMEN = ('node_modules', '/.git/', '.angular/cache', '/dist/', '/deploy/', '/www/browser/')
ENDUNGEN = ('*.sh', '*.py', '*.mjs', '*.js', '*.ts')

# Ein Prozessblick: pgrep, pkill, pidof, ps.
BLICK = re.compile(r'\b(pgrep|pkill|pidof|ps\s+-e[fo])\b')
# Ein Browsername als Wort — nicht als Teil von cogl oder recognition.
CHROMIUM = re.compile(r'\bchromium[a-z-]*\b')
COG = re.compile(r'(?<![a-z])cog(?![a-z])')
MARKE = re.compile(r'kiosk-browser:\s*nur\b')


def kommentarzeile(zeile, endung):
    k = zeile.strip()
    if endung in ('.sh', '.py') and k.startswith('#'):
        return True
    if endung in ('.mjs', '.js', '.ts') and (k.startswith('//') or k.startswith('*') or k.startswith('/*')):
        return True
    return False


def in_docstring(zeilen, nr):
    """Grob: liegt Zeile nr innerhalb eines dreifach gequoteten Blocks?

    Eine Erklaerzeile in einem Python-Docstring beginnt NICHT mit `#` und
    saehe sonst aus wie Code. Genau daran hat der erste Entwurf dieses
    Werkzeugs fuenf Treffer im eigenen Kommentar von led_control.py gemeldet.
    """
    offen = False
    for i in range(nr - 1):
        offen ^= (zeilen[i].count('"""') + zeilen[i].count("'''")) % 2 == 1
    return offen


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--nur-befunde', action='store_true', help='nur Stellen, die einen Namen vermissen')
    a = p.parse_args()

    dateien = []
    for muster in ENDUNGEN:
        dateien += list(WURZEL.rglob(muster))

    befunde, gesamt = [], 0
    print('Stellen, die nach dem Kiosk-Browser suchen')
    print('Baum: %s\n' % WURZEL)

    for pfad in sorted(set(dateien)):
        s = str(pfad)
        if any(x in s for x in AUSGENOMMEN):
            continue
        try:
            zeilen = pfad.read_text(errors='replace').splitlines()
        except OSError:
            continue
        for nr, z in enumerate(zeilen, 1):
            if not (BLICK.search(z) and (CHROMIUM.search(z) or COG.search(z))):
                continue
            if kommentarzeile(z, pfad.suffix) or (pfad.suffix == '.py' and in_docstring(zeilen, nr)):
                continue
            gesamt += 1
            # EIN BEFEHL KANN UEBER MEHRERE ZEILEN GEHEN. `pkill -x chromium…`
            # in der einen, `pkill -x cog` in der naechsten — zeilenweise sieht
            # das aus wie „einer fehlt", und der Befund waere ein Fehlalarm.
            # Deshalb zaehlt ein kleines Fenster um die Zeile herum. Es ist
            # bewusst KLEIN: ein Name zehn Zeilen weiter gehoert nicht mehr zu
            # demselben Gedanken, und ein zu grosses Fenster verschweigt genau
            # die Luecken, die dieses Werkzeug finden soll.
            fenster = '\n'.join(zeilen[max(0, nr - 3) : nr + 2])
            beide = bool(CHROMIUM.search(fenster)) and bool(COG.search(fenster))
            gemarkt = nr >= 2 and bool(MARKE.search(zeilen[nr - 2]))
            rel = pfad.relative_to(WURZEL)
            if beide or gemarkt:
                if not a.nur_befunde:
                    print('  ok       %-40s %5d  %s' % (rel, nr, z.strip()[:60]))
            else:
                fehlt = 'cog' if CHROMIUM.search(z) else 'chromium'
                befunde.append((rel, nr, fehlt, z.strip()))
                print('  BEFUND   %-40s %5d  %s fehlt' % (rel, nr, fehlt))
                print('           %s' % z.strip()[:96])

    print()
    print('%d Stelle(n) gesehen, %d Befund(e).' % (gesamt, len(befunde)))
    if befunde:
        print()
        print('Jede davon ist entweder ein Fehler auf einer Box, die den anderen')
        print('Browser faehrt — oder Absicht. Ist es Absicht, gehoert eine Zeile')
        print('darueber:  # kiosk-browser: nur chromium, weil …')
        print('Dann faellt sie hier nicht mehr auf, und der Grund steht da, wo')
        print('der Naechste ihn sucht.')
    return 1 if befunde else 0


if __name__ == '__main__':
    sys.exit(main())
