#!/usr/bin/env python3
"""Gegenprobe zur Behauptung „auf der Kartenseite gibt es keine Auswahl".

WOZU
Der Betreiber steckte EINEN Mehrfach-Kartenleser (SABRENT, zwei Schaechte,
zwei LUNs -> /dev/sda und /dev/sdb) und bekam „2 Wechseldatentraeger gefunden
· Zieh alle ab ausser der einen".  Die Behauptung dazu lautet: die Seite hat
kein einziges Auswahl-Widget, `self.karte` bleibt None, der Knopf bleibt zu.

Dieses Werkzeug misst das AN DER LAUFENDEN OBERFLAECHE statt es zu lesen:
es baut das Fenster im Probemodus (schreibt garantiert nichts), schiebt
gefaelschte Kartenlisten durch denselben Weg wie der Sucher-Thread
(`_karten_gesetzt`) und zaehlt danach, was auf der Seite klickbar ist.

Zusaetzlich stellt es die Faelle nach, die ein Auswahl-Umbau treffen wuerde:
  * eine echte Karte, die direkt nach dem Stecken noch 0 B meldet und
    Sekunden spaeter ihre echte Groesse — bleibt eine einmal gewaehlte Karte
    gewaehlt, wenn sich EIN Feld aendert?
  * derselbe Leser unter Windows und macOS: liefern die reinen Auswerter dort
    ueberhaupt mehrere Traeger, oder ist das ein reines Linux-Bild?

AUFRUF
    python3 tools/kartenwahl-gegenprobe.py          # braucht eine Anzeige
    xvfb-run -a python3 tools/kartenwahl-gegenprobe.py
Ende 0 = die Behauptung hat sich bestaetigt, Ende 1 = sie ist widerlegt.
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTRL = os.path.join(REPO, 'remote-step-installer', 'controller')
sys.path.insert(0, CTRL)

import tkinter as tk                                          # noqa: E402
import geraete                                                # noqa: E402
import sdstart                                                # noqa: E402

# Der Mehrfachleser des Betreibers, so wie lsblk ihn am 10.08.2026 meldete.
LESER = {
    "blockdevices": [
        {"name": "sda", "path": "/dev/sda", "size": "238,3G", "model": "MassStorageClass",
         "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None],
         "children": [
             {"name": "sda1", "path": "/dev/sda1", "size": "128M", "type": "part",
              "mountpoints": [None]},
             {"name": "sda2", "path": "/dev/sda2", "size": "238,2G", "type": "part",
              "mountpoints": [None]}]},
        {"name": "sdb", "path": "/dev/sdb", "size": "0B", "model": "MassStorageClass",
         "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None]},
        {"name": "zram0", "path": "/dev/zram0", "size": "15G", "model": None,
         "tran": None, "rm": False, "hotplug": False, "type": "disk", "mountpoints": [None]},
        {"name": "nvme0n1", "path": "/dev/nvme0n1", "size": "1,8T", "model": "SSD",
         "tran": "nvme", "rm": False, "hotplug": False, "type": "disk",
         "mountpoints": [None],
         "children": [{"name": "nvme0n1p2", "path": "/dev/nvme0n1p2", "size": "1,8T",
                       "type": "part", "mountpoints": ["/"]}]},
    ]
}

fehler = []


def sagen(zeile):
    print(zeile)


def klickbares(widget, treffer=None):
    """Alles einsammeln, was auf einen Klick oder eine Auswahl reagiert.

    Ein Knopf im Hausstil ist ein Canvas mit <Button-1>; deshalb wird nach der
    BINDUNG gesucht und nicht nach der Klasse — sonst uebersieht die Messung
    genau die Bauart, die dieses Programm benutzt.
    """
    treffer = [] if treffer is None else treffer
    binds = widget.bind()
    if any(b in ('<Button-1>', '<ButtonPress-1>', '<Key-space>') for b in binds):
        text = ''
        if isinstance(widget, sdstart.Knopf):
            # Der Hausknopf ist ein Canvas; sein Text ist ein Canvas-Element,
            # kein Widget-Attribut — sonst misst man die Elementnummer.
            text = widget.itemcget(widget._text, 'text')
        treffer.append((widget.winfo_class(), text or repr(widget)[:40]))
    if widget.winfo_class() in ('TCombobox', 'Listbox', 'TRadiobutton', 'Radiobutton',
                                'Treeview', 'Menubutton', 'TMenubutton'):
        treffer.append((widget.winfo_class(), '<Auswahl-Widget>'))
    for kind in widget.winfo_children():
        klickbares(kind, treffer)
    return treffer


def main():
    # ── 0. Die reinen Auswerter: was sieht der Sucher ueberhaupt? ───────────
    ok, blockiert = geraete.linux_auswerten(LESER)
    sagen(f'linux_auswerten: {len(ok)} beschreibbar, {len(blockiert)} ausgeschlossen')
    for k in ok:
        sagen(f"   + {k['pfad']:12s} {k['groesse']:>8s}  {k['modell']}")
    for b in blockiert:
        sagen(f"   - {b['pfad']:12s} {b['groesse']:>8s}  {b['grund']}")
    if len(ok) != 2:
        fehler.append('Der Auswerter liefert NICHT zwei Traeger — Messgrundlage weg.')

    # Meldet der leere Schacht wirklich 0 B und kommt trotzdem durch?
    leer = [k for k in ok if k['groesse'] in ('0B', '0', '0 B')]
    sagen(f'   leerer Schacht kommt als beschreibbar durch: {bool(leer)}')

    # ── 1. Die Seite bauen, ohne irgendetwas zu schreiben ───────────────────
    fenster = sdstart.Fenster(board='RPi5', trocken=True, probe=True)
    fenster.withdraw()          # nichts aufziehen: kein grab_set noetig
    fenster._seite_karte()
    fenster.update()

    # ── 2. ZWEI Karten hineingeben — genau der Fall des Betreibers ──────────
    fenster._karten_gesetzt(list(ok))
    fenster.update()
    dinge = klickbares(fenster.mitte)
    auswahl = [d for d in dinge if d[1] == '<Auswahl-Widget>']
    sagen('')
    sagen(f'ZWEI KARTEN · klickbare Dinge auf der Seite: {[d[1] for d in dinge]}')
    sagen(f'ZWEI KARTEN · Auswahl-Widgets: {auswahl or "keine"}')
    sagen(f'ZWEI KARTEN · gewaehlte Karte: {fenster.karte}')
    sagen(f'ZWEI KARTEN · Knopf klickbar: {fenster.knopf.an}')
    sagen(f'ZWEI KARTEN · Text oben:  {fenster.l_karte.cget("text")!r}')
    sagen(f'ZWEI KARTEN · Text unten: {fenster.l_wo.cget("text")!r}')
    if fenster.karte is not None or fenster.knopf.an or auswahl:
        fehler.append('Es GIBT einen Weg zur Auswahl — die Behauptung ist widerlegt.')

    # Gibt es auf dieser Seite ueberhaupt einen Rueckweg?
    zurueck = [d for d in dinge if 'Zurück' in str(d[1]) or 'Zurueck' in str(d[1])]
    sagen(f'ZWEI KARTEN · Rueckweg-Knopf auf der Seite: {zurueck or "keiner"}')

    # ── 3. Der Fall, den ein Auswahl-Umbau treffen wuerde ───────────────────
    # Eine echte Karte meldet direkt nach dem Stecken oft 0 B und Sekunden
    # spaeter ihre Groesse. Was passiert mit einer BEREITS GEWAEHLTEN Karte,
    # wenn sich ein einziges Feld aendert?
    eine = dict(ok[1])                       # der Schacht, der gerade 0B meldet
    fenster._karten_gesetzt([ok[0], eine])
    fenster.karte = eine                     # so, als haette ein Klick gewaehlt
    fenster._karte_zeigen()
    fenster.update()
    sagen('')
    sagen(f'NACH WAHL       · Knopf klickbar: {fenster.knopf.an}')
    # Wuerde eine Wahl ueberhaupt SICHTBAR? `_karten_gesetzt` schreibt bei
    # mehr als einer Karte den Zaehltext ueber die Anzeige — nach dem Setzen.
    fenster.karte = eine
    fenster._karten_gesetzt([ok[0], eine])
    fenster.update()
    sagen(f'NACH WAHL       · Text oben bleibt: {fenster.l_karte.cget("text")!r}')
    sagen(f'NACH WAHL       · Text unten bleibt: {fenster.l_wo.cget("text")!r}')

    fenster.karte = eine
    gewachsen = dict(eine, groesse='32G', modell='SanDisk Ultra')
    fenster._karten_gesetzt([ok[0], gewachsen])
    fenster.update()
    sagen(f'0B -> 32G       · gewaehlte Karte danach: {fenster.karte}')
    sagen(f'0B -> 32G       · Knopf klickbar: {fenster.knopf.an}')
    if fenster.karte is None:
        sagen('   ==> Die Wahl faellt weg, sobald sich EIN Feld aendert:')
        sagen('       `self.karte not in self.karten` vergleicht ganze dicts.')

    # ── 3b. ERST EINER, DANN ZWEI — ohne jede Handanlegung ──────────────────
    # Die Behauptung sagt, bei mehreren Traegern sei die Seite eine
    # geschlossene Tuer. Das gilt nur, wenn man MIT mehreren ankommt. Steckt
    # zuerst eine Karte (Zeile 762 setzt sie) und kommt danach ein zweiter
    # Traeger dazu, greift Zeile 765 NICHT — die alte Wahl steht noch in der
    # Liste. Hier wird genau diese Reihenfolge gefahren, ohne `self.karte`
    # von aussen anzufassen.
    fenster.karte = None
    fenster._karten_gesetzt([dict(ok[0])])          # Runde 1: nur eine Karte
    fenster.update()
    sagen('')
    sagen(f'EINER           · gewaehlte Karte: {(fenster.karte or {}).get("pfad")}')
    zweiter = {'pfad': '/dev/sdc', 'name': 'sdc', 'groesse': '32G',
               'modell': 'Generic Flash Disk', 'wechselbar': True, 'bus': 'usb'}
    fenster._karten_gesetzt([dict(ok[0]), zweiter])  # Runde 2: einer kommt dazu
    fenster.update()
    ziel = (fenster.karte or {}).get('pfad')
    sagen(f'DANN ZWEI       · gewaehlte Karte: {ziel}')
    sagen(f'DANN ZWEI       · Knopf klickbar: {fenster.knopf.an}')
    sagen(f'DANN ZWEI       · Text oben: {fenster.l_karte.cget("text")!r}')
    if fenster.knopf.an and ziel:
        fehler.append(
            'Bei ZWEI Traegern ist der Schreiben-Knopf klickbar und zielt auf '
            f'{ziel} — waehrend darueber „{fenster.l_karte.cget("text")}" steht. '
            'Die Seite ist dann KEINE geschlossene Tuer, sondern eine offene '
            'mit falschem Schild.')

    # ── 4. Windows und macOS: kommt derselbe Leser dort auch doppelt? ───────
    win_ok, win_aus = geraete.windows_auswerten([
        {"Number": 0, "FriendlyName": "NVMe SSD", "Size": 2000398934016, "BusType": 17,
         "IsBoot": True, "IsSystem": True},
        {"Number": 1, "FriendlyName": "MassStorageClass", "Size": 255852544000,
         "BusType": 7, "IsBoot": False, "IsSystem": False},
        {"Number": 2, "FriendlyName": "MassStorageClass", "Size": 0,
         "BusType": 7, "IsBoot": False, "IsSystem": False},
    ])
    sagen('')
    sagen(f'windows_auswerten: {len(win_ok)} beschreibbar '
          f'-> {[(k["pfad"], k["groesse"]) for k in win_ok]}')
    mac_ok, mac_aus = geraete.mac_auswerten({
        "_systemdisk": "disk0",
        "AllDisksAndPartitions": [
            {"DeviceIdentifier": "disk0", "Size": 2000398934016, "Internal": True,
             "Partitions": [{"MountPoint": "/"}]},
            {"DeviceIdentifier": "disk2", "Size": 255852544000, "Internal": False,
             "MediaName": "MassStorageClass"},
            {"DeviceIdentifier": "disk3", "Size": 0, "Internal": False,
             "MediaName": "MassStorageClass"},
        ]})
    sagen(f'mac_auswerten:     {len(mac_ok)} beschreibbar '
          f'-> {[(k["pfad"], k["groesse"]) for k in mac_ok]}')
    if len(win_ok) > 1 or len(mac_ok) > 1:
        sagen('   ==> Auch dort landet man in derselben Seite. Ein Umbau muss')
        sagen('       also fuer alle drei Systeme gelten, nicht nur fuer Linux.')

    fenster.destroy()

    sagen('')
    if fehler:
        for f in fehler:
            sagen('WIDERSPRUCH: ' + f)
        return 1
    sagen('Die Behauptung hat sich an der laufenden Oberflaeche bestaetigt.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
