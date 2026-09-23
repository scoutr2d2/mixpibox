#!/usr/bin/env python3
"""Das Startbild darf nur Zeichen malen, die seine Schrift kennt.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 10.08.2026, an der laufenden Box: „hinter jedem schritt ist ein
fragezeichen hinten dran."

Die Ursache war ein einziges Zeichen. In `malen()` stand

    beschriftung = (offen + " …")

mit einem U+2026. Die Konsolenschrift ist eine PSF-Datei mit 256 Zeichen, und
die Schriftklasse ersetzt alles darueber stillschweigend:

    def zeichen(self, c):
        i = ord(c)
        if i >= self.anzahl:
            i = ord("?")

Weil der Auslassungspunkt an JEDEM Meilenstein hing, stand das Fragezeichen
auch hinter jedem. Kein Absturz, keine Meldung — nur ein Bild, das falsch
aussieht, und drei Stunden Suche an der falschen Stelle (erst der Boxname,
dann das Logo).

══ WARUM EIN TEST UND NICHT NUR DIE REPARATUR ═════════════════════════════
Weil das naechste Sonderzeichen genauso durchfaellt. Ein Gedankenstrich, ein
typografisches Anfuehrungszeichen, ein Haken — alles, was beim Schreiben
bequem ist, liegt ueber 255. Der Rueckfall auf „?" ist als Notnagel richtig;
falsch waere, sich auf ihn zu verlassen.

DIESER TEST BRAUCHT KEINE SCHRIFTDATEI. Er liest die Quelle und sucht in den
Zeichenketten, die gemalt werden koennten. Das ist groeber als ein echter
Lauf — dafuer laeuft es ueberall und faellt auf, BEVOR jemand eine Karte
schreibt.

══ UND DIE ZWEITE KOPIE ═══════════════════════════════════════════════════
Die Datei liegt zweimal: im Fork (scripts/mupibox/) und hier
(remote-step-installer/tools/). Am 10.08.2026 waren sie 114 Zeilen
auseinander, und das Rezept nahm die falsche. Deshalb prueft dieser Test
BEIDE — eine Reparatur, die nur eine Haelfte erreicht, ist keine.

AUFRUF
    python3 tests/bootsplash_zeichen_test.py
"""
import ast
import os
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
INSTALLER = HIER.parent
WURZEL = INSTALLER.parent

KOPIEN = [
    INSTALLER / 'tools' / 'mupibox-boot-splash.py',
    WURZEL / 'scripts' / 'mupibox' / 'mupibox-boot-splash.py',
]

# Die PSF-Schriften der Konsole fuehren 256 Zeichen. Alles darueber faellt auf
# „?" zurueck. 512er-Fassungen gibt es, aber worauf die Box trifft, wissen wir
# nicht — und eine Annahme, die im Zweifel das Bild verdirbt, gehoert eng.
ZEICHENVORRAT = 256

ergebnis = []


def chk(name, bedingung, hinweis=''):
    ergebnis.append((name, bool(bedingung), hinweis))


def verdaechtige(pfad):
    """Zeichenketten in der Quelle, die zu gross fuer die Schrift waeren.

    Docstrings und Kommentare zaehlen NICHT — die malt niemand. Und sehr lange
    Zeichenketten auch nicht: das sind Erklaertexte, keine Beschriftungen.
    """
    quelle = pfad.read_text(encoding='utf-8')
    baum = ast.parse(quelle)
    docs = set()
    for k in ast.walk(baum):
        if isinstance(k, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if k.body and isinstance(k.body[0], ast.Expr) \
                    and isinstance(k.body[0].value, ast.Constant) \
                    and isinstance(k.body[0].value.value, str):
                docs.add(id(k.body[0].value))
    treffer = []
    for k in ast.walk(baum):
        if not (isinstance(k, ast.Constant) and isinstance(k.value, str)):
            continue
        if id(k) in docs or len(k.value) > 60:
            continue
        zu_gross = [c for c in k.value if ord(c) >= ZEICHENVORRAT]
        if zu_gross:
            treffer.append((k.lineno, k.value, zu_gross))
    return treffer


for pfad in KOPIEN:
    kurz = f'{pfad.parent.name}/{pfad.name}'
    if not pfad.is_file():
        chk(f'{kurz} ist da', False, 'die Datei fehlt — dann prueft dieser Test nichts')
        continue
    t = verdaechtige(pfad)
    chk(f'{kurz}: nur Zeichen aus dem Vorrat', not t,
        '; '.join(f'Zeile {z}: {v!r} ({"".join(g)})' for z, v, g in t[:3]))

    quelle = pfad.read_text(encoding='utf-8')
    # ── EIN RUECKFALL MUSS DA SEIN, ABER NICHT DERSELBE ──────────────────
    #
    # Hier stand `'i = ord("?")' in quelle` — und der Test wurde sofort rot,
    # aber am falschen Ort: die INSTALLER-Kopie hat eine andere Schriftklasse
    # (sie liest die Unicode-Tabelle der PSF-Datei, siehe `for glyph in
    # range(self.anzahl)`), der Fork die einfache. Beide fangen ein unbekanntes
    # Zeichen ab, nur verschieden.
    #
    # Ein Test, der EINE Umsetzung festschreibt, verbietet die andere, ohne
    # dass jemand etwas falsch gemacht haette. Geprueft wird deshalb, DASS die
    # Grenze abgefangen wird — nicht, wie.
    chk(f'{kurz}: unbekannte Zeichen werden abgefangen',
        '>= self.anzahl' in quelle,
        'ohne Grenze liest die Schrift ueber ihr eigenes Ende hinaus')
    # Und das Bild muss dort gesucht werden, wo es liegt (am 10.08.2026 am
    # Geraet gemessen).
    chk(f'{kurz}: sucht das MixPi-Bild an den echten Orten',
        '/opt/mixpibox-einrichtung/mixpi-hoert.png' in quelle
        and '/boot/firmware/einrichtung/mixpi-hoert.png' in quelle,
        'sonst malt es den gezeichneten Kopf, und das sieht nach Absicht aus')

# ── Die zwei Kopien duerfen nicht auseinanderlaufen ────────────────────────
#
# Nicht Byte fuer Byte: sie haben unterschiedliche Kopftexte, und das ist in
# Ordnung. Aber die STELLEN, um die es hier geht, muessen gleich sein.
if all(p.is_file() for p in KOPIEN):
    a, b = (p.read_text(encoding='utf-8') for p in KOPIEN)
    for was, muster in (('die Beschriftung', 'beschriftung = (offen + " ...")'),
                        ('die Logo-Liste', '/opt/mixpibox-einrichtung/mixpi-hoert.png')):
        chk(f'beide Kopien tragen {was}', muster in a and muster in b,
            'eine Reparatur, die nur eine Haelfte erreicht, ist keine')

schlecht = 0
for name, gut, hinweis in ergebnis:
    print(f'  {"ok  " if gut else "NEIN"} {name}' + (f'   — {hinweis}' if not gut and hinweis else ''))
    schlecht += 0 if gut else 1
print(f'\n{len(ergebnis)} Pruefungen, {schlecht} Abweichung(en)')
sys.exit(1 if schlecht else 0)
