#!/usr/bin/env python3
"""Headless-Smoketest des Ein-Knopf-Installers (controller/sdstart.py).

══ WOZU — DREI FEHLER AN EINEM TAG ═════════════════════════════════════════
Am 08.08.2026 hatte `sdstart` keinen Test, und derselbe Tag brachte drei
Fehler, die alle erst der Betreiber beim Klicken fand:

  1. `sdprep.parse_index(sdprep.fetch_index())` — `fetch_index` liefert schon
     die Liste. Absturz bei JEDEM Klick auf „Karte schreiben", nicht nur im
     Probemodus.
  2. `_lauf_attrappe` war MITTEN in `_lauf` eingesetzt; der echte Ablauf
     rutschte dadurch in die Attrappe und lief nach der Simulation weiter.
  3. `grab_set()` vor `wait_visibility()` — auf dem Schreibtisch „grab failed:
     window not viewable", unter Xvfb (kein Fenstermanager) unauffaellig.

Eins und zwei haette dieser Test gefunden. Drei NICHT — dazu braeuchte es
einen Fenstermanager, und auf diesem Rechner ist keiner installiert. Das steht
hier, damit niemand den Test fuer mehr haelt, als er ist.

══ WAS ER PRUEFT ═══════════════════════════════════════════════════════════
  A. STRUKTUR, ohne etwas zu starten: Liegt der echte Ablauf in `_lauf` und
     NICHT in `_lauf_attrappe`? Ruft niemand `parse_index` auf das Ergebnis
     von `fetch_index`? Steht jedes `grab_set` hinter einem
     `wait_visibility`? Das sind die drei Fehler von oben als Frage.
  B. DER WEG, mit gefaelschten Geraeten und im Probemodus: Alle sieben Seiten
     bauen sich auf, die Rueckfrage geht auf, der Lauf endet auf „Fertig".
     Es wird garantiert nichts geschrieben und nichts geladen.

Die Systemplatte darf NIE zur Auswahl stehen — dieselbe Bedingung wie im
Schwestertest sdtui_smoke.py.

AUFRUF
    python3 tests/sdstart_smoke.py        # Ende 0 = alles gruen
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO + '/controller')

ergebnis = []


def chk(name, bedingung, hinweis=''):
    ergebnis.append((name, bool(bedingung), hinweis))


# ══ A. STRUKTUR — ohne Anzeige, ohne Netz, ohne alles ═══════════════════════
QUELLE = open(os.path.join(REPO, 'controller', 'sdstart.py'), encoding='utf-8').read()

# A1: Der echte Ablauf liegt in `_lauf`, die Attrappe daneben.
i_lauf = QUELLE.index('    def _lauf(self):')
i_att = QUELLE.index('    def _lauf_attrappe(self):')
# Welche Methode kommt zuerst? Der echte Ablauf gehoert in die, die `_lauf`
# heisst — egal in welcher Reihenfolge sie stehen.
def rumpf(anfang):
    rest = QUELLE[anfang + 10:]
    m = re.search(r'\n    (?:def |# ── )', rest)
    return rest[:m.start()] if m else rest

r_lauf, r_att = rumpf(i_lauf), rumpf(i_att)
chk('der echte Ablauf steht in _lauf', 'fetch_index' in r_lauf)
chk('die Attrappe enthaelt ihn NICHT', 'fetch_index' not in r_att,
    'sonst laeuft nach der Simulation der echte Lauf weiter (Fehler 2)')
chk('die Attrappe schreibt nicht', 'write_image' not in r_att)

# A2: `fetch_index` liefert schon die Liste — kein `parse_index` darum herum.
chk('kein parse_index um fetch_index', 'parse_index(sdprep.fetch_index()' not in QUELLE
    and 'parse_index(fetch_index(' not in QUELLE,
    'fetch_index ruft parse_index selbst (sdprep.py) — Fehler 1')

# A3: Jedes `grab_set` steht hinter einem `wait_visibility`.
for datei in ('sdstart.py', 'sdgui.py'):
    text = open(os.path.join(REPO, 'controller', datei), encoding='utf-8').read()
    stellen = [m.start() for m in re.finditer(r'\.grab_set\(\)', text)]
    gut = all(text.rfind('.wait_visibility()', 0, s) > -1 for s in stellen)
    chk(f'{datei}: grab_set erst nach wait_visibility', gut and stellen,
        'sonst „grab failed: window not viewable" auf dem Schreibtisch (Fehler 3)')

# A4: Die Vorgaben, die der Betreiber gesetzt haben wollte.
chk('Trixie ist gesetzt', "CODENAME = 'Trixie'" in QUELLE)
chk('der Bildschirm ist ab dem ersten Start an', 'debug_display=True' in QUELLE)
chk('probe zieht trocken mit sich', '(trocken or probe)' in QUELLE,
    'sonst haengt die Sicherheit an zwei Schaltern')

# ══ B. DER WEG — mit gefaelschten Geraeten ══════════════════════════════════
# Ohne Anzeige geht kein Tkinter. Fehlt sie, bleibt A stehen und B entfaellt —
# mit Ansage, nicht still.
import sdprep                                                  # noqa: E402

FAKE = {'blockdevices': [
    {'name': 'nvme0n1', 'path': '/dev/nvme0n1', 'size': '1,8T', 'model': 'System SSD',
     'tran': 'nvme', 'rm': False, 'hotplug': False, 'type': 'disk', 'mountpoints': [],
     'children': [{'name': 'p2', 'path': '/dev/nvme0n1p2', 'type': 'part',
                   'mountpoints': ['/', '/home']}]},
    {'name': 'mmcblk0', 'path': '/dev/mmcblk0', 'size': '29,7G', 'model': 'SD32G',
     'tran': 'mmc', 'rm': True, 'hotplug': True, 'type': 'disk', 'mountpoints': []}]}
sdprep.list_block_devices = lambda: FAKE
sdprep.wifi_active = lambda: 'Heimnetz'
sdprep.wifi_secret = lambda ssid: 'aus-dem-rechner' if ssid == 'Heimnetz' else ''
# NICHTS AUS DEM NETZ. Faellt eine dieser Sperren, faellt der Test auf — nicht
# der Rechner in eine Warteschleife.
sdprep.fetch_index = lambda: (_ for _ in ()).throw(AssertionError('Netzzugriff im Probemodus!'))
sdprep.download = lambda *a, **k: (_ for _ in ()).throw(AssertionError('Download im Probemodus!'))


def weg_pruefen():
    import tkinter as tk
    import sdstart

    fenster = sdstart.Fenster(probe=True)
    fenster.withdraw()                      # kein Fenster ins Gesicht
    fenster.deiconify()
    schritte = []

    def seite(name, tat):
        tat()
        fenster.update_idletasks()
        kinder = len(fenster.mitte.winfo_children())
        schritte.append((name, kinder))
        chk(f'Seite „{name}" baut sich auf', kinder > 0)

    seite('Willkommen', fenster._seite_willkommen)
    seite('Welcher Pi', fenster._seite_board)
    fenster.board = 'RPi5'
    seite('WLAN', fenster._seite_wlan)
    seite('Name und Passwort', fenster._seite_name)
    seite('Die Karte', fenster._seite_karte)

    # Die gefaelschte Karte einsetzen — der Sicherheitsfilter bleibt aktiv.
    fenster._karten_gesetzt([{'pfad': '/dev/mmcblk0', 'name': 'mmcblk0',
                              'modell': 'SD32G', 'groesse': '29,7G', 'wechselbar': True}])
    fenster.update_idletasks()
    chk('die Systemplatte steht NICHT zur Wahl',
        all('nvme' not in (k.get('pfad') or '') for k in fenster.karten))

    # Die Rueckfrage: geht sie auf, und ist der loeschende Knopf NICHT der
    # voreingestellte?
    fenster._fragen()
    fenster.update_idletasks()
    dialoge = [w for w in fenster.winfo_children() if isinstance(w, tk.Toplevel)]
    chk('die Rueckfrage geht auf', len(dialoge) == 1)
    if dialoge:
        text = ' '.join(
            str(k.itemcget(k._text, 'text'))
            for r in dialoge[0].winfo_children() for k in r.winfo_children()
            if isinstance(k, sdstart.Knopf))
        chk('sie warnt vor dem Loeschen', 'löschen' in text.lower())
        chk('und bietet Abbrechen an', 'abbrechen' in text.lower())
        dialoge[0].destroy()

    # Der nachgespielte Lauf — ohne Netz, ohne Schreiben.
    fenster._loslegen()
    for _ in range(2000):                   # hoechstens 20 s
        fenster.update()
        if not fenster.laeuft and hasattr(fenster, 'l_phase'):
            if 'Fertig' in fenster.l_phase.cget('text'):
                break
        import time
        time.sleep(0.01)
    chk('der Probelauf endet auf „Fertig"',
        hasattr(fenster, 'l_phase') and 'Fertig' in fenster.l_phase.cget('text'),
        fenster.l_phase.cget('text') if hasattr(fenster, 'l_phase') else 'keine Phase')
    fenster.destroy()


# ══ GIBT ES EINE ANZEIGE? NICHT RATEN — VERSUCHEN ═══════════════════════════
#
# Hier stand `if os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')`.
# Das ist eine Vermutung aus Umgebungsvariablen, und sie ging schief: Auf
# diesem Rechner ist WAYLAND_DISPLAY gesetzt, DISPLAY aber leer — der Test
# hielt sich fuer anzeigefaehig, Tkinter versuchte X11 und der Lauf war ROT,
# obwohl nichts kaputt war. Ein Test, der ohne Anzeige durchfaellt statt zu
# ueberspringen, wird bald ignoriert.
#
# Also wird es PROBIERT: Ein Fenster, das nicht aufgeht, heisst „keine
# Anzeige" — und das ist ein Ueberspringen, kein Fehler.
def anzeige_da():
    try:
        import tkinter as tk
        w = tk.Tk()
        w.destroy()
        return True
    except Exception:                                          # noqa: BLE001
        return False


if anzeige_da():
    try:
        weg_pruefen()
    except Exception as e:                                     # noqa: BLE001
        chk('der Weg laeuft durch', False, f'{type(e).__name__}: {e}')
else:
    print('  (keine Anzeige — Teil B uebersprungen, Teil A gilt trotzdem)')

# ══ Urteil ══════════════════════════════════════════════════════════════════
schlecht = 0
for name, gut, hinweis in ergebnis:
    print(f'  {"ok  " if gut else "NEIN"} {name}' + (f'   — {hinweis}' if not gut and hinweis else ''))
    schlecht += 0 if gut else 1
print(f'\n{len(ergebnis)} Pruefungen, {schlecht} Abweichung(en)')
sys.exit(1 if schlecht else 0)
