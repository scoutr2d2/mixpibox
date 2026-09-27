#!/usr/bin/env python3
"""Was steht als UEBERSCHRIFT im Loeschdialog des Ein-Knopf-Installers?

WARUM ES DIESES WERKZEUG GIBT: Der Kopfkommentar von `sdstart.py` (Zeile 42/43)
verspricht, die Rueckfrage nenne „Geraet, Modell und Groesse AUSGESCHRIEBEN,
damit man erkennt, ob es die gemeinte Karte ist". Ob das Versprechen am echten
Geraet eingeloest wird, haengt allein daran, WAS `karten_finden()` als 'modell'
liefert — und das ist bei Mehrfach-Kartenlesern oft nur der USB-Klassenname.

Dieses Werkzeug ruft NICHTS Schreibendes auf. Es liest die Kartenliste und
rechnet exakt die beiden Textformeln nach, die die Oberflaeche benutzt:
  sdstart.py:792  Ueberschrift im Loeschdialog  -> f"{k.get('modell') or 'SD-Karte'}"
  sdstart.py:512  Zeile auf der Kartenseite     -> f"{modell or 'SD-Karte'} · {groesse or '?'}"

Aufruf:  python3 tools/loeschdialog-ueberschrift-probe.py
"""
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, '..', 'remote-step-installer'))

from controller import geraete  # noqa: E402


def ueberschrift(k):
    """Genau die Formel aus sdstart.py Zeile 792."""
    return f"{k.get('modell') or 'SD-Karte'}"


def kartenzeile(k):
    """Genau die Formel aus sdstart.py Zeile 512."""
    return f"{k.get('modell') or 'SD-Karte'} · {k.get('groesse') or '?'}"


def main():
    gefunden = geraete.karten_finden()
    liste = gefunden[0] if isinstance(gefunden, tuple) else gefunden
    if not liste:
        print('Keine Wechseldatentraeger gefunden — nichts nachzurechnen.')
        return 0
    print(f'{len(liste)} Eintraege von karten_finden():\n')
    for k in liste:
        print(f"  pfad={k.get('pfad')}  groesse={k.get('groesse')}  "
              f"modell={k.get('modell')!r}")
        print(f"    Loeschdialog-Ueberschrift : {ueberschrift(k)!r}")
        print(f"    Kartenseite              : {kartenzeile(k)!r}")
        print()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
