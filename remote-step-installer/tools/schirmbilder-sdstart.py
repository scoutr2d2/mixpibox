#!/usr/bin/env python3
"""DIE BILDER DES SD-ASSISTENTEN FUER DIE README — ohne Karte, ohne Netz.

══ WOZU ═══════════════════════════════════════════════════════════════════
Die README zeigt den Weg von der leeren Karte bis zur laufenden Box. Der
erste Schritt ist `./sdstart` — und wer ihn noch nie gesehen hat, weiss nicht,
was ihn erwartet: sieben Seiten, alle schon ausgefuellt, und EINE Rueckfrage,
bevor geloescht wird. Genau das sollen die Bilder zeigen.

AUFGENOMMEN WIRD IM PROBEMODUS (`Fenster(probe=True)`), mit gefaelschten
Geraeten, wie im Rauchtest `tests/sdstart_smoke.py`: es wird garantiert nichts
geladen, nichts gemountet und nichts geschrieben. Die Seiten werden einzeln
gebaut und einzeln abgelichtet.

══ WIE ES ABLICHTET ═══════════════════════════════════════════════════════
Tk kann sich nicht selbst fotografieren. Aufgenommen wird deshalb mit
ImageMagick (`import`) vom X-Server — unter Xvfb, wo das Fenster allein steht
und niemandem ins Gesicht springt. Geschnitten wird auf die Geometrie, die Tk
selbst nennt; ohne den Schnitt laege um jedes Bild der leere Rest des
virtuellen Schirms.

    xvfb-run -a -s "-screen 0 1100x760x24" \\
        python3 remote-step-installer/tools/schirmbilder-sdstart.py

══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
  * Es prueft nichts. Der Rauchtest daneben prueft; dieses Werkzeug zeigt.
  * Es faellt nicht um: fehlt die Anzeige oder `import`, sagt es das und
    hoert auf — ein Werkzeug, das ohne Anzeige rot meldet, wird ignoriert.
  * Es fasst keine echte Karte an. Die gefaelschte heisst /dev/mmcblk0 und
    existiert nur im Speicher.
"""
import os
import shutil
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'controller'))
BILDER = os.path.join(os.path.dirname(REPO), 'screenshots')
for i, a in enumerate(sys.argv):
    if a == '--bilder' and i + 1 < len(sys.argv):
        BILDER = sys.argv[i + 1]

if not shutil.which('import'):
    print('  ImageMagick („import") fehlt — ohne es gibt es keine Bilder.')
    sys.exit(1)

import tkinter as tk                                            # noqa: E402

try:
    _probe = tk.Tk()
    _probe.destroy()
except Exception as e:                                          # noqa: BLE001
    print(f'  keine Anzeige ({e}) — unter xvfb-run starten.')
    sys.exit(1)

import sdprep                                                   # noqa: E402
import sdstart                                                  # noqa: E402

# Gefaelschte Geraete: eine Systemplatte (darf NIE zur Wahl stehen) und eine
# Karte. Dieselbe Attrappe wie im Rauchtest.
FAKE = {'blockdevices': [
    {'name': 'nvme0n1', 'path': '/dev/nvme0n1', 'size': '1,8T', 'model': 'System SSD',
     'tran': 'nvme', 'rm': False, 'hotplug': False, 'type': 'disk', 'mountpoints': []},
    {'name': 'mmcblk0', 'path': '/dev/mmcblk0', 'size': '29,7G', 'model': 'SD32G',
     'tran': 'mmc', 'rm': True, 'hotplug': True, 'type': 'disk', 'mountpoints': []},
]}
sdprep.list_devices = lambda *a, **k: FAKE                      # noqa: E731

os.makedirs(BILDER, exist_ok=True)
gemacht = 0


def ablichten(fenster, name, fenster_oben=None):
    """Das Fenster (oder einen Dialog darauf) abfotografieren und zuschneiden."""
    global gemacht
    w = fenster_oben or fenster
    fenster.update_idletasks()
    fenster.update()
    time.sleep(0.45)
    x, y = w.winfo_rootx(), w.winfo_rooty()
    b, h = w.winfo_width(), w.winfo_height()
    ziel = os.path.join(BILDER, f'{name}.png')
    r = subprocess.run(['import', '-window', 'root', '-crop', f'{b}x{h}+{x}+{y}',
                        '+repage', ziel], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'  ausgelassen: {name} ({r.stderr.strip()[:70]})')
        return
    gemacht += 1
    print(f'  Bild: screenshots/{name}.png')


fenster = sdstart.Fenster(probe=True)
fenster.geometry('+0+0')
fenster.deiconify()
fenster.update()

fenster._seite_willkommen()
ablichten(fenster, '20-sd-willkommen')

fenster._seite_board()
ablichten(fenster, '21-sd-board')

fenster.board = 'RPi5'
fenster._seite_wlan()
ablichten(fenster, '22-sd-wlan')

fenster._seite_name()
ablichten(fenster, '23-sd-name')

fenster._seite_karte()
fenster._karten_gesetzt([{'pfad': '/dev/mmcblk0', 'name': 'mmcblk0',
                          'modell': 'SD32G', 'groesse': '29,7G', 'wechselbar': True}])
ablichten(fenster, '24-sd-karte')

# DIE EINE RUECKFRAGE. Sie ist der Grund, warum dieses Werkzeug ueberhaupt
# Bilder macht: Wer eine Karte loescht, soll vorher gesehen haben, wie gefragt
# wird — der loeschende Knopf ist rot, beschriftet mit dem, was er tut, und
# NICHT der voreingestellte.
fenster._fragen()
fenster.update()
dialoge = [w for w in fenster.winfo_children() if isinstance(w, tk.Toplevel)]
if dialoge:
    ablichten(fenster, '25-sd-rueckfrage', dialoge[0])
    dialoge[0].destroy()
else:
    print('  ausgelassen: Rueckfrage (kein Dialog)')

# Der nachgespielte Lauf bis „Fertig".
fenster._loslegen()
for _ in range(2000):
    fenster.update()
    if not fenster.laeuft and hasattr(fenster, 'l_phase') and 'Fertig' in fenster.l_phase.cget('text'):
        break
    time.sleep(0.01)
ablichten(fenster, '26-sd-fertig')
fenster.destroy()

print(f'\n{gemacht} Bild(er) in {BILDER}.')
