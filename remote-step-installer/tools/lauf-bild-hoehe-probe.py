#!/usr/bin/env python3
"""Was kostet ein breiteres Flash-Bild die Laufseite an Hoehe?

WOZU: Die Behauptung lautet, `'lauf'` gehoere in der Tabelle BILDER von 230 auf
390 gesetzt, damit das Querformatbild mit rund 200 px Hoehe „auf einer Hoehe mit
den uebrigen Seiten" liegt. Gemessen wurde dabei nur die LAUFSEITE bei der
Vorgabegroesse 760x820.

Die Laufseite ist aber nicht ihr eigener Endzustand. `_fertig(True)` nimmt das
Protokollfeld weg und haengt STATTDESSEN das Bild „Karte in den Pi" (230x220)
UND den Schliessen-Knopf an DIESELBE Seite — das Laufbild bleibt stehen. Diese
Seite ist die hoechste des ganzen Programms, und sie ist die einzige, auf der
ein Knopf steht, den man noch braucht.

Gemessen wird deshalb der ANSPRUCH des Fensters (`winfo_reqheight`) in beiden
Zustaenden und gegen beide Grenzen: die Vorgabe 820 und das Minimum aus
`minsize(700, 700)` — auf das jeder Benutzer das Fenster ziehen darf.

Es wird nichts nachgebaut: die Bilder entstehen mit `bauen()` aus
tools/sdstart-bilder.py, die Seiten mit `_loslegen`/`_fertig` aus
controller/sdstart.py.

AUFRUF
    xvfb-run -a python3 remote-step-installer/tools/lauf-bild-hoehe-probe.py
    xvfb-run -a python3 remote-step-installer/tools/lauf-bild-hoehe-probe.py 190 230 300 390
"""
import importlib.util
import os
import shutil
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.dirname(HIER)
STEUER = os.path.join(INSTALLER, 'controller')
sys.path.insert(0, STEUER)

VORGABE_HOEHE = 820          # aus self.geometry('760x820')
MIN_HOEHE = 700              # aus self.minsize(700, 700)


def bilder_modul():
    """tools/sdstart-bilder.py laden — der Bindestrich verbietet `import`."""
    weg = os.path.join(HIER, 'sdstart-bilder.py')
    spec = importlib.util.spec_from_file_location('sdstart_bilder', weg)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def lauf_bauen(mod, breite, ziel):
    """NUR 'lauf' bauen, mit der gewuenschten Kante — echtes `bauen()`."""
    alt = mod.BILDER
    mod.BILDER = {'lauf': (alt['lauf'][0], breite)}
    try:
        mod.bauen(ziel)
    finally:
        mod.BILDER = alt
    from PIL import Image
    return Image.open(os.path.join(ziel, 'sdstart-lauf.png')).size


def seite_messen(sd, tk, dateien):
    """Anspruch des Fensters auf der Laufseite und im Endzustand.

    Der Arbeitsfaden wird fuer die Messung stillgelegt: gemessen wird das
    LAYOUT, nicht der Ablauf. Ohne diesen Riegel liefe die Attrappe waehrend
    des Messens weiter und schriebe ins Protokollfeld.
    """
    import threading

    class OhneFaden:
        def __init__(self, *a, **kw):
            pass

        def start(self):
            pass

    sd.DATEIEN = dateien
    echt = threading.Thread
    threading.Thread = OhneFaden
    try:
        f = sd.Fenster(board='RPi5', trocken=True, probe=True, board_gesetzt=True)
        f.update_idletasks()
        f._loslegen(ziel={'weg': '/dev/null', 'modell': 'Probe', 'groesse': 1})
        f.update_idletasks()
        lauf = f.winfo_reqheight()
        bild = f.mitte.winfo_children()[0].winfo_reqheight()
        prot = f.protokoll.winfo_reqheight()
        f._fertig(True)
        f.update_idletasks()
        ende = f.winfo_reqheight()
        knopfh = f.mitte.winfo_children()[-1].winfo_reqheight()
        f.destroy()
        return lauf, ende, bild, prot, knopfh
    finally:
        threading.Thread = echt


def knopf_am_schirm(sd, dateien, breit, hoch, schuss=None):
    """Wo endet der Schliessen-Knopf in einem WIRKLICH aufgezogenen Fenster?

    `winfo_reqheight` sagt, was die Seite BRAUCHT. Diese Messung sagt, was
    davon zu SEHEN ist: Tk rollt nicht und rueckt nichts nach — was unter die
    Fensterkante rutscht, ist fort, ohne Fehler und ohne Rollbalken.
    """
    import threading

    class OhneFaden:
        def __init__(self, *a, **kw):
            pass

        def start(self):
            pass

    sd.DATEIEN = dateien
    echt = threading.Thread
    threading.Thread = OhneFaden
    try:
        f = sd.Fenster(board='RPi5', trocken=True, probe=True, board_gesetzt=True)
        f.geometry(f'{breit}x{hoch}')
        f.update()
        f._loslegen(ziel={'weg': '/dev/null', 'modell': 'Probe', 'groesse': 1})
        f._fertig(True)
        f.update()
        knopf = f.mitte.winfo_children()[-1]
        oben = knopf.winfo_rooty() - f.winfo_rooty()
        # ZWEI HOEHEN, und der Unterschied IST der Befund: `reqheight` ist die
        # bestellte Knopfhoehe, `winfo_height` das, was `pack` ihm am Ende
        # wirklich gegeben hat. Ist das Zweite kleiner, wurde der Knopf
        # gestaucht — der Text sitzt bei reqheight/2 und faellt dann heraus.
        soll = knopf.winfo_reqheight()
        ist = knopf.winfo_height()
        unten = oben + soll
        echt_hoch = f.winfo_height()
        if schuss:
            try:
                f.update()
                f.grab_release()
                os.system(f'import -window root {schuss} 2>/dev/null'
                          f' || xwd -root -silent | convert xwd:- {schuss}')
            except Exception:
                pass
        f.destroy()
        return oben, unten, echt_hoch, soll, ist
    finally:
        threading.Thread = echt


def main():
    if sys.argv[1:2] == ['--am-schirm']:
        import sdstart as sd
        ausgeliefert = sd.DATEIEN
        mod = bilder_modul()
        for kante in [int(a) for a in sys.argv[2:]] or [230, 390]:
            arbeit = tempfile.mkdtemp(prefix=f'schirm-{kante}-')
            try:
                b, h = lauf_bauen(mod, kante, __import__('pathlib').Path(arbeit))
                for datei in os.listdir(ausgeliefert):
                    z = os.path.join(arbeit, datei)
                    if not os.path.exists(z):
                        shutil.copy2(os.path.join(ausgeliefert, datei), z)
                for hoch in (820, 780, 740, 700):
                    oben, unten, echt, soll, ist = knopf_am_schirm(sd, arbeit, 760, hoch)
                    urteil = ('ganz da' if ist >= soll else
                              f'GESTAUCHT auf {ist}/{soll} px'
                              f' — Beschriftung sitzt bei y {oben + soll // 2},'
                              f' sichtbar nur bis {oben + ist}')
                    print(f'Kante {kante:>3} ({b}x{h})  Fenster 760x{hoch}'
                          f'  Knopf ab y {oben}, braucht bis {unten}'
                          f' (Fenster {echt})  {urteil}')
            finally:
                shutil.rmtree(arbeit, ignore_errors=True)
        return 0
    kanten = [int(a) for a in sys.argv[1:]] or [230, 390]
    if not os.environ.get('DISPLAY'):
        print('Kein DISPLAY — bitte mit `xvfb-run -a` starten.')
        return 2
    import tkinter as tk
    import sdstart as sd

    mod = bilder_modul()
    # sd.DATEIEN wird beim Messen umgebogen — der Auslieferungsordner muss
    # VORHER festgehalten werden, sonst zeigt er beim zweiten Durchgang auf
    # das schon geloeschte Arbeitsverzeichnis des ersten.
    ausgeliefert = sd.DATEIEN
    print(f'Quelle: {mod.BILDER["lauf"][0]}')
    print(f'{"Kante":>6} {"Bild":>10} {"Laufseite":>10} {"Endseite":>9} '
          f'{"Protokoll":>10} | {"in 820?":>8} {"in 700?":>8}')
    print('-' * 74)
    schlecht = 0
    for kante in kanten:
        arbeit = tempfile.mkdtemp(prefix=f'lauf-{kante}-')
        try:
            b, h = lauf_bauen(mod, kante, __import__('pathlib').Path(arbeit))
            # Alle uebrigen Bilder aus der Auslieferung dazu — gemessen wird
            # die ECHTE Seite, samt Kopfbild und „Karte in den Pi".
            for datei in os.listdir(ausgeliefert):
                z = os.path.join(arbeit, datei)
                if not os.path.exists(z):
                    shutil.copy2(os.path.join(ausgeliefert, datei), z)
            lauf, ende, bildh, prot, knopfh = seite_messen(sd, tk, arbeit)
        finally:
            shutil.rmtree(arbeit, ignore_errors=True)
        passt820 = 'ja' if ende <= VORGABE_HOEHE else f'NEIN +{ende - VORGABE_HOEHE}'
        passt700 = 'ja' if ende <= MIN_HOEHE else f'NEIN +{ende - MIN_HOEHE}'
        if ende > MIN_HOEHE:
            schlecht += 1
        print(f'{kante:>6} {b}x{h:<6} {lauf:>10} {ende:>9} {prot:>10} | '
              f'{passt820:>8} {passt700:>8}')
    print(f'\nEndseite = Laufbild + Phase + Balken + „Karte in den Pi" (230x220)'
          f' + Schliessen-Knopf ({knopfh} px).')
    print('Der Knopf steht ganz unten: was ueber die Fensterhoehe hinausragt,'
          ' ist WEG — Tk rollt nicht.')
    return 1 if schlecht else 0


if __name__ == '__main__':
    sys.exit(main())
