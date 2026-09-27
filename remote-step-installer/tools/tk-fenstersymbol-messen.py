#!/usr/bin/env python3
"""Was ein Fenstersymbol in Tkinter WIRKLICH tut — gemessen, nicht geglaubt.

══ WOZU ═══════════════════════════════════════════════════════════════════
`controller/sdstart.py` setzt seit dem 10.08.2026 in `_symbol_setzen` ein
Fenstersymbol. Was daran wirkt und was nur dasteht, sagt keine Zeile Code —
das sind die Fragen, an denen Tkinter-Oberflaechen ueblicherweise scheitern:

  * `iconphoto(True, …)` oder `iconphoto(False, …)`?
  * Muss die PhotoImage-Referenz gehalten werden — dieselbe Falle wie in
    `bild_setzen`?
  * Erbt ein `tk.Toplevel` (die rote Rueckfrage in `_fragen`) das Symbol?
  * Was wirft es, wenn die Datei fehlt oder kaputt ist?
  * Frisst `PhotoImage` eine .ico? Frisst `iconbitmap` sie unter X11?

JEDE PROBE LAEUFT IN EINEM EIGENEN PROZESS. `wm iconphoto -default` ist
Zustand am Display, kein Zustand am Fenster — zwei Proben in einem Prozess
wuerden einander beantworten.

GEMESSEN WIRD AM X-SERVER, nicht an einem Rueckgabewert: `wm iconphoto`
schreibt unter X11 die Eigenschaft `_NET_WM_ICON` auf das Wrapper-Fenster.
Steht sie dort, ist das Symbol gesetzt; sagt Tk nur „" zurueck, ist das
keine Auskunft. Gelesen wird mit `xprop -name <Titel>` — warum nicht ueber
die Fenster-Kennung, steht bei `icon_property`.

XVFB REICHT HIER — anders als bei `grab_set` (siehe `_fragen`): Die
Eigenschaft setzt der Client auf sein eigenes Fenster, dafuer braucht es
keinen Fenstermanager. Was ein Fenstermanager daraus MALT, sagt diese
Messung ausdruecklich nicht.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    xvfb-run -a python3 remote-step-installer/tools/tk-fenstersymbol-messen.py
    python3 remote-step-installer/tools/tk-fenstersymbol-messen.py   # auf dem
                                                    # echten Schreibtisch
    … --probe iconphoto-wahr-toplevel      # nur eine, mit voller Ausgabe
    … --liste                              # welche es gibt
"""
import os
import pathlib
import subprocess
import sys

HIER = pathlib.Path(__file__).resolve().parent
INSTALLER = HIER.parent
WURZEL = INSTALLER.parent

PNG48 = WURZEL / 'NewDesign' / 'bilder' / 'favicon-48.png'
PNG32 = WURZEL / 'NewDesign' / 'bilder' / 'favicon-32.png'
PNG16 = WURZEL / 'NewDesign' / 'bilder' / 'favicon-16.png'
ICO = WURZEL / 'NewDesign' / 'bilder' / 'favicon.ico'
SVG = WURZEL / 'NewDesign' / 'bilder' / 'favicon.svg'


# ── Das Ablesen am X-Server ────────────────────────────────────────────────
#
# ══ NICHT `wm frame`, UND DAS WAR DER ERSTE MESSFEHLER ═════════════════════
# Die erste Fassung las `xprop -id <wm frame>`. Das gab RUECKGABE 0 UND EINE
# LEERE AUSGABE — also „keine Eigenschaft", und damit stand unter JEDER Probe
# „NEIN". Das Symbol war die ganze Zeit gesetzt.
#
# Der Grund: Tk legt unter X11 um jedes Toplevel ein WRAPPER-Fenster. `winfo
# id` (und hier auch `wm frame`) nennen das INNERE Fenster — die Eigenschaft
# schreibt Tk auf das aeussere. Gemessen: winfo id 0x200003, Eigenschaft auf
# 0x200004.
#
# Gesucht wird deshalb ueber den TITEL (`xprop -name`): WM_NAME traegt nur das
# Wrapper-Fenster. Jedes Fenster in einer Probe braucht dafuer einen eigenen
# Titel.
#
# Und das ROHFORMAT statt der Vorgabe: `xprop` malt `_NET_WM_ICON` sonst als
# ASCII-Bild („Icon (48 x 48):" und Bloecke) — huebsch, aber nicht zu rechnen.
# `-f _NET_WM_ICON 32c` gibt die Zahlen.
def icon_property(titel):
    """(anzahl, [(breite, hoehe), …], hat_transparenz) — oder None."""
    # `-len` UND ZWAR GROSSZUEGIG — der zweite Messfehler. Ohne das schneidet
    # `xprop` die Eigenschaft nach seiner Vorgabelaenge ab. Bei 48x48 (9 kB)
    # faellt das nicht auf, bei 256x256 (256 kB) schon: die Probe meldete
    # „0 Symbole", und das haette ausgesehen wie „Tk nimmt grosse Bilder nicht".
    lauf = subprocess.run(['xprop', '-name', titel, '-len', '4000000',
                           '-f', '_NET_WM_ICON', '32c', ' $0+\n', '_NET_WM_ICON'],
                          capture_output=True, text=True)
    text = lauf.stdout.strip()
    if lauf.returncode or 'not found' in text or '_NET_WM_ICON' not in text:
        return None
    zahlen = [int(z) for z in text.split(')', 1)[-1].replace(',', ' ').split()
              if z.lstrip('-').isdigit()]
    groessen, alpha = [], False
    i = 0
    while i + 1 < len(zahlen):
        b, h = zahlen[i], zahlen[i + 1]
        if b <= 0 or h <= 0 or i + 2 + b * h > len(zahlen):
            break
        groessen.append((b, h))
        for p in zahlen[i + 2:i + 2 + b * h]:
            if (p >> 24) & 0xFF not in (0, 255):
                alpha = True
                break
        i += 2 + b * h
    return len(groessen), groessen, alpha


def hochziehen(titel='MESSPUNKT-WURZEL'):
    """Ein Wurzelfenster, das der X-Server auch wirklich kennt."""
    import tkinter as tk
    w = tk.Tk()
    w.title(titel)
    w.geometry('200x120')
    w.update()
    return tk, w


# ── Die Proben ─────────────────────────────────────────────────────────────
PROBEN = {}


def probe(name, frage):
    def nimm(f):
        PROBEN[name] = (frage, f)
        return f
    return nimm


@probe('png-lesen', 'Liest tk.PhotoImage die favicon-PNGs?')
def _p1(sag):
    tk, w = hochziehen()
    for p in (PNG16, PNG32, PNG48):
        b = tk.PhotoImage(file=str(p))
        sag(f'{p.name}: {b.width()}x{b.height()} gelesen')
    return 'PNG geht'


@probe('ico-in-photoimage', 'Frisst tk.PhotoImage eine .ico?')
def _p2(sag):
    tk, w = hochziehen()
    try:
        tk.PhotoImage(file=str(ICO))
        return 'FRISST SIE (unerwartet)'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return 'NEIN — .ico ist kein PhotoImage-Format'


@probe('svg-in-photoimage', 'Frisst tk.PhotoImage ein .svg?')
def _p3(sag):
    tk, w = hochziehen()
    try:
        tk.PhotoImage(file=str(SVG))
        return 'FRISST ES'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return 'NEIN'


@probe('datei-fehlt', 'Was wirft eine fehlende Datei?')
def _p4(sag):
    tk, w = hochziehen()
    try:
        tk.PhotoImage(file='/gibt/es/nicht/mixpi.png')
        return 'kein Fehler (unerwartet)'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return f'{type(e).__name__}'


@probe('datei-kaputt', 'Was wirft eine abgeschnittene PNG?')
def _p5(sag):
    import tempfile
    tk, w = hochziehen()
    roh = PNG48.read_bytes()
    with tempfile.NamedTemporaryFile('wb', suffix='.png', delete=False) as f:
        f.write(roh[:len(roh) // 3])
        weg = f.name
    try:
        tk.PhotoImage(file=weg)
        return 'kein Fehler (unerwartet)'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return f'{type(e).__name__}'
    finally:
        os.unlink(weg)


@probe('iconphoto-falsch-wurzel', 'iconphoto(False) — steht es am Wurzelfenster?')
def _p6(sag):
    tk, w = hochziehen()
    b = tk.PhotoImage(file=str(PNG48))
    w.iconphoto(False, b)
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'Wurzel: {e}')
    return 'ja' if e else 'NEIN'


@probe('iconphoto-falsch-toplevel', 'iconphoto(False) — erbt ein spaeteres Toplevel?')
def _p7(sag):
    tk, w = hochziehen()
    b = tk.PhotoImage(file=str(PNG48))
    w.iconphoto(False, b)
    t = tk.Toplevel(w)
    t.title('MESSPUNKT-OBEN')
    t.transient(w)                       # genau wie `_fragen`
    t.geometry('160x100')
    t.update()
    sag(f'Wurzel:   {icon_property("MESSPUNKT-WURZEL")}')
    e = icon_property('MESSPUNKT-OBEN')
    sag(f'Toplevel: {e}')
    return 'erbt' if e else 'ERBT NICHT'


@probe('iconphoto-wahr-toplevel', 'iconphoto(True) — erbt ein spaeteres Toplevel?')
def _p8(sag):
    tk, w = hochziehen()
    b = tk.PhotoImage(file=str(PNG48))
    w.iconphoto(True, b)
    t = tk.Toplevel(w)
    t.title('MESSPUNKT-OBEN')
    t.transient(w)
    t.geometry('160x100')
    t.update()
    sag(f'Wurzel:   {icon_property("MESSPUNKT-WURZEL")}')
    e = icon_property('MESSPUNKT-OBEN')
    sag(f'Toplevel: {e}')
    return 'erbt' if e else 'ERBT NICHT'


@probe('iconphoto-wahr-toplevel-vorher',
       'iconphoto(True) — bekommt ein SCHON OFFENES Toplevel es nachtraeglich?')
def _p9(sag):
    tk, w = hochziehen()
    t = tk.Toplevel(w)
    t.title('MESSPUNKT-OBEN')
    t.geometry('160x100')
    t.update()
    b = tk.PhotoImage(file=str(PNG48))
    w.iconphoto(True, b)
    w.update()
    t.update()
    sag(f'Wurzel:   {icon_property("MESSPUNKT-WURZEL")}')
    e = icon_property('MESSPUNKT-OBEN')
    sag(f'Toplevel (vorher offen): {e}')
    return 'bekommt es' if e else 'BEKOMMT ES NICHT'


@probe('referenz-weg', 'Ueberlebt das Symbol, wenn die PhotoImage-Referenz faellt?')
def _p10(sag):
    import gc
    tk, w = hochziehen()
    b = tk.PhotoImage(file=str(PNG48))
    name = str(b)
    w.iconphoto(True, b)
    del b
    gc.collect()
    w.update()
    fort = name not in w.tk.call('image', 'names')
    sag(f'Tk-Bild {name} geloescht: {fort}')
    a = icon_property('MESSPUNKT-WURZEL')
    sag(f'Wurzel danach: {a}')
    # DIE HAERTERE FRAGE: ein Toplevel, das ERST NACH dem Einsammeln entsteht.
    t = tk.Toplevel(w)
    t.title('MESSPUNKT-OBEN')
    t.geometry('160x100')
    t.update()
    e = icon_property('MESSPUNKT-OBEN')
    sag(f'Toplevel NACH dem Einsammeln: {e}')
    return 'ueberlebt' if (a and e) else 'UEBERLEBT NICHT'


@probe('referenz-weg-anonym', 'Und wenn die PhotoImage nie einen Namen bekommt?')
def _p11(sag):
    import gc
    tk, w = hochziehen()
    # Genau die Zeile, die man aus Bequemlichkeit schreibt:
    w.iconphoto(True, tk.PhotoImage(file=str(PNG48)))
    gc.collect()
    w.update()
    a = icon_property('MESSPUNKT-WURZEL')
    sag(f'Wurzel: {a}')
    t = tk.Toplevel(w)
    t.title('MESSPUNKT-OBEN')
    t.geometry('160x100')
    t.update()
    e = icon_property('MESSPUNKT-OBEN')
    sag(f'Toplevel danach: {e}')
    return 'ueberlebt' if (a and e) else 'UEBERLEBT NICHT'


@probe('mehrere-groessen', 'Was kommt an, wenn man 48, 32 und 16 uebergibt?')
def _p12(sag):
    tk, w = hochziehen()
    b48 = tk.PhotoImage(file=str(PNG48))
    b32 = tk.PhotoImage(file=str(PNG32))
    b16 = tk.PhotoImage(file=str(PNG16))
    w.iconphoto(True, b48, b32, b16)
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'im Feld: {e}')
    return f'{e[0]} Symbole: {e[1]}' if e else 'NEIN'


@probe('alpha', 'Kommt die Transparenz mit?')
def _p13(sag):
    tk, w = hochziehen()
    b = tk.PhotoImage(file=str(PNG48))
    w.iconphoto(True, b)
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'{e}')
    return 'Alpha kommt mit' if e and e[2] else 'kein Alpha im Feld'


@probe('iconbitmap-ico', 'Nimmt iconbitmap unter X11 eine .ico?')
def _p14(sag):
    tk, w = hochziehen()
    try:
        w.iconbitmap(str(ICO))
        w.update()
        return 'nimmt sie'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return 'NEIN'


@probe('iconbitmap-default-ico', 'Und iconbitmap(default=…) unter X11?')
def _p15(sag):
    tk, w = hochziehen()
    try:
        w.iconbitmap(default=str(ICO))
        w.update()
        return 'nimmt es'
    except Exception as e:
        sag(f'{type(e).__name__}: {e}')
        return 'NEIN'


@probe('iconphoto-vor-widgets', 'Geht iconphoto direkt nach super().__init__()?')
def _p16(sag):
    import tkinter as tk
    w = tk.Tk()
    b = tk.PhotoImage(file=str(PNG48))       # noch kein geometry, kein Widget
    w.iconphoto(True, b)
    w.title('MESSPUNKT-WURZEL')
    w.geometry('760x820')
    w.minsize(700, 700)
    tk.Label(w, text='spaeter gebaut').pack()
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'nach dem ganzen Aufbau: {e}')
    return 'ja' if e else 'NEIN'


@probe('grosses-bild', 'Was macht ein 256er-Bild als Symbol?')
def _p17(sag):
    tk, w = hochziehen()
    gross = INSTALLER / 'dateien' / 'mixpi-hoert.png'
    b = tk.PhotoImage(file=str(gross))
    sag(f'{gross.name}: {b.width()}x{b.height()}')
    w.iconphoto(True, b)
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'im Feld: {e}')
    return f'{e[1]}' if e else 'NEIN'


@probe('fassung', 'Welche Tcl/Tk-Fassung misst hier?')
def _p18(sag):
    tk, w = hochziehen()
    sag(f"Python   {sys.version.split()[0]}")
    sag(f"Tcl      {w.tk.call('info', 'patchlevel')}")
    sag(f"Tk       {w.tk.call('set', 'tk_patchLevel')}")
    sag(f"windowingsystem {w.tk.call('tk', 'windowingsystem')}")
    return w.tk.call('set', 'tk_patchLevel')


@probe('ausgeliefertes-symbol', 'Was traegt sdstart.py heute wirklich?')
def _p19(sag):
    tk, w = hochziehen()
    png = INSTALLER / 'dateien' / 'sdstart-symbol.png'
    if not png.is_file():
        return 'sdstart-symbol.png fehlt — das Fenster behaelt die Tk-Feder'
    b = tk.PhotoImage(file=str(png))
    sag(f'{png.name}: {b.width()}x{b.height()}')
    w.iconphoto(True, b)
    w.update()
    e = icon_property('MESSPUNKT-WURZEL')
    sag(f'im Feld: {e}')
    # DIE .ico DAZU — nur zum Ansehen, unter X11 ist sie ohne Wirkung.
    import struct
    ico = INSTALLER / 'dateien' / 'sdstart-symbol.ico'
    if ico.is_file():
        d = ico.read_bytes()
        cnt = struct.unpack('<H', d[4:6])[0]
        arten = []
        for i in range(cnt):
            br, ho, _c, _r, _pl, _bpp, _sz, off = struct.unpack('<BBBBHHII', d[6 + 16 * i:22 + 16 * i])
            arten.append(f"{br or 256}:{'PNG' if d[off:off + 4] == b'\x89PNG' else 'DIB'}")
        sag(f'{ico.name}: {len(d)} B, {cnt} Eintraege — {" ".join(arten)}')
    return f'{e[1]}' if e else 'NEIN'


def eine(name):
    frage, f = PROBEN[name]
    zeilen = []
    try:
        ergebnis = f(zeilen.append)
    except Exception as e:                                   # noqa: BLE001
        import traceback
        zeilen.append(traceback.format_exc().strip().splitlines()[-1])
        ergebnis = f'ABSTURZ: {type(e).__name__}'
    print(f'FRAGE  {frage}')
    for z in zeilen:
        print(f'  ·    {z}')
    print(f'ERGEBNIS {ergebnis}')
    return 0


def alle():
    schlecht = 0
    for name in PROBEN:
        print('─' * 74)
        print(f'{name}')
        lauf = subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve()),
                               '--probe', name],
                              capture_output=True, text=True, timeout=120)
        print(lauf.stdout.rstrip() or lauf.stderr.rstrip())
        if lauf.returncode:
            schlecht += 1
    print('─' * 74)
    return schlecht


if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--liste' in argv:
        for n, (frage, _) in PROBEN.items():
            print(f'  {n:32} {frage}')
        sys.exit(0)
    if '--probe' in argv:
        sys.exit(eine(argv[argv.index('--probe') + 1]))
    sys.exit(alle())
