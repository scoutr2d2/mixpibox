#!/usr/bin/env python3
"""Gegenprobe zur Behauptung „SYSTEM_MOUNTS ist eine Positivliste aus 7 Pfaden".

DIE BEHAUPTUNG
`geraete.linux_auswerten` (controller/geraete.py:84) sperrt einen Datentraeger
nur dann, wenn EINER seiner Einhaengepunkte woertlich in der 7er-Liste
SYSTEM_MOUNTS steht. Jede andere eingehaengte Datenpartition — /mnt/backup,
/media/…, /srv, /var/lib/… — faellt in den `else`-Zweig und gilt als freie
Karte. Steckt sonst nichts, waehlt sdstart.py `_karten_gesetzt` sie
automatisch, und der rote Dialog nennt sie als „die Karte".

WAS DIESES WERKZEUG MISST — UND WARUM AN DER OBERFLAECHE
Die reine Einordnung zu lesen reicht nicht: die Behauptung lebt von der FOLGE.
Deshalb geht jede Lage denselben Weg wie im Betrieb — Auswerter, dann
`_karten_gesetzt`, dann der Knopfzustand, dann der Text des roten Dialogs.
Erst wenn dort der Pfad der fremden Platte steht UND kein Wort ueber ihren
Einhaengepunkt, ist die Folge belegt.

GEGENPROBE (sonst misst man Gruen und glaubt es): Lage A wird ein zweites Mal
gefahren, nachdem „/mnt/backup" in SYSTEM_MOUNTS eingetragen wurde. Kippt sie
dann nicht auf „ausgeschlossen", misst dieses Werkzeug nicht, was es behauptet.

ES SCHREIBT NICHTS. Alle lsblk-Ausgaben sind erfunden, das Fenster laeuft im
Probemodus (setzt `trocken` mit), und der rote Knopf wird nie geklickt — nur
sein Text gelesen.

AUFRUF
    xvfb-run -a python3 tools/karten-fremdmount-probe.py
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

SYSTEMPLATTE = {
    "name": "nvme0n1", "path": "/dev/nvme0n1", "size": "1,8T", "model": "SSD",
    "tran": "nvme", "rm": False, "hotplug": False, "type": "disk", "mountpoints": [None],
    "children": [
        {"name": "nvme0n1p1", "path": "/dev/nvme0n1p1", "size": "1G", "type": "part",
         "mountpoints": ["/boot/efi"]},
        {"name": "nvme0n1p2", "path": "/dev/nvme0n1p2", "size": "1,8T", "type": "part",
         "mountpoints": ["/"]}],
}


def platte(name, groesse, modell, tran, rm, hotplug, mount):
    """Ein Datentraeger mit genau EINER Partition auf `mount`."""
    return {
        "name": name, "path": f"/dev/{name}", "size": groesse, "model": modell,
        "tran": tran, "rm": rm, "hotplug": hotplug, "type": "disk", "mountpoints": [None],
        "children": [{"name": f"{name}1", "path": f"/dev/{name}1", "size": groesse,
                      "type": "part", "mountpoints": [mount]}],
    }


# Jede Lage: (Name, lsblk, Pfad der fremden Platte, erwartet-die-Behauptung-Gefahr)
LAGEN = [
    ("USB-Sicherungsplatte auf /mnt/backup",
     platte("sdc", "4T", "Seagate Backup", "usb", False, True, "/mnt/backup"), "/dev/sdc", True),
    ("USB-Stick, vom Schreibtisch eingehaengt auf /media/achim/DATEN",
     platte("sdd", "64G", "Kingston DataTraveler", "usb", True, True,
            "/media/achim/DATEN"), "/dev/sdd", True),
    ("USB-Platte traegt /var/lib/docker",
     platte("sde", "2T", "WD Elements", "usb", False, True, "/var/lib/docker"),
     "/dev/sde", True),
    ("USB-Platte traegt /srv",
     platte("sdf", "8T", "Toshiba Canvio", "usb", False, True, "/srv"), "/dev/sdf", True),
    # Die Behauptung sagt „jede andere eingehaengte Datenpartition". Diese Lage
    # prueft, ob das auch fuer eine INTERNE Platte gilt — dort greift naemlich
    # noch das zweite Merkmal (wechselbar/Bus), nicht die Mount-Liste.
    ("INTERNE SATA-Platte auf /mnt/daten",
     platte("sdg", "4T", "WD Blue", "sata", False, False, "/mnt/daten"), "/dev/sdg", False),
]

fehler = []
hinweise = []


def sagen(z):
    print(z)


def texte(widget, sammler=None):
    """Alle sichtbaren Beschriftungen eines Fensters einsammeln.

    Gesucht wird nach der OPTION `text`, nicht nach der Klasse: der Hausknopf
    ist ein Canvas und traegt seinen Text als Canvas-Element — wer nach Labels
    sucht, uebersieht genau die Bauart dieses Programms.
    """
    sammler = [] if sammler is None else sammler
    try:
        t = widget.cget('text')
        if t:
            sammler.append(str(t))
    except tk.TclError:
        pass
    if isinstance(widget, sdstart.Knopf):
        try:
            sammler.append(str(widget.itemcget(widget._text, 'text')))
        except (tk.TclError, AttributeError):
            pass
    for kind in widget.winfo_children():
        texte(kind, sammler)
    return sammler


def lage_fahren(fenster, name, geraet, pfad):
    """Eine Lage durch den GANZEN Weg schicken. -> (ok-Liste, gewaehlt, Dialogtext)"""
    lsblk = {"blockdevices": [SYSTEMPLATTE, geraet]}
    ok, blockiert = geraete.linux_auswerten(lsblk)
    sagen(f'\n=== {name}')
    for k in ok:
        sagen(f"   ANGEBOTEN   {k['pfad']:10s} {k['groesse']:>6s}  bus={k['bus'] or '-':5s} "
              f"{k['modell']}")
    for b in blockiert:
        sagen(f"   gesperrt    {b['pfad']:10s} {b['groesse']:>6s}  ({b['grund']})")

    angeboten = any(k['pfad'] == pfad for k in ok)
    if not angeboten:
        return ok, None, ''

    # Denselben Weg wie der Sucher-Thread: Liste rein, Seite neu.
    fenster.karte = None
    fenster._seite_karte()
    fenster._karten_gesetzt(list(ok))
    fenster.update()
    gewaehlt = (fenster.karte or {}).get('pfad')
    sagen(f'   -> automatisch gewaehlt: {gewaehlt}   Knopf klickbar: {fenster.knopf.an}')
    sagen(f'   -> Text oben:  {fenster.l_karte.cget("text")!r}')
    sagen(f'   -> Text unten: {fenster.l_wo.cget("text")!r}')

    # Der rote Dialog — gebaut, gelesen, zerstoert. Nie geklickt.
    #
    # DAS FENSTER MUSS DAFUER AUFGEZOGEN SEIN. `_fragen` haelt in
    # `wait_visibility()` an, bis der Dialog sichtbar ist; ein Toplevel mit
    # `transient(parent)` wird aber nie sichtbar, solange der Parent
    # zurueckgezogen ist — das haengt dann ewig statt zu scheitern.
    dialogtext = ''
    if gewaehlt == pfad:
        fenster.deiconify()
        fenster.update()
        fenster._fragen()
        fenster.update()
        toplevels = [w for w in fenster.winfo_children() if isinstance(w, tk.Toplevel)]
        if toplevels:
            f = toplevels[-1]
            dialogtext = ' | '.join(texte(f))
            sagen(f'   -> roter Dialog: {dialogtext}')
            f.grab_release()
            f.destroy()
            fenster.update()
        fenster.withdraw()
    return ok, gewaehlt, dialogtext


def main():
    fenster = sdstart.Fenster(board='RPi5', trocken=True, probe=True)
    fenster.withdraw()

    for name, geraet, pfad, gefahr in LAGEN:
        ok, gewaehlt, dialog = lage_fahren(fenster, name, geraet, pfad)
        angeboten = any(k['pfad'] == pfad for k in ok)
        if gefahr:
            if not angeboten:
                fehler.append(f'{name}: {pfad} wird NICHT angeboten — die Behauptung '
                              f'stimmt fuer diese Lage nicht.')
                continue
            if gewaehlt != pfad:
                fehler.append(f'{name}: {pfad} ist angeboten, wird aber nicht '
                              f'automatisch gewaehlt (gewaehlt: {gewaehlt}).')
                continue
            if not fenster.knopf.an:
                fehler.append(f'{name}: der Schreiben-Knopf bleibt zu — die Folge '
                              f'tritt nicht ein.')
                continue
            # Warnt IRGENDETWAS, dass die Platte eingehaengt und in Benutzung ist?
            mount = geraet['children'][0]['mountpoints'][0]
            if mount in dialog or 'eingehäng' in dialog or 'in Benutzung' in dialog:
                fehler.append(f'{name}: der Dialog nennt den Einhaengepunkt — '
                              f'es gibt also doch eine Warnung.')
        else:
            if angeboten:
                fehler.append(f'{name}: wird angeboten, obwohl hier das zweite '
                              f'Merkmal (kein Wechseldatentraeger) greifen sollte.')
            else:
                grund = [b['grund'] for b in geraete.linux_auswerten(
                    {"blockdevices": [SYSTEMPLATTE, geraet]})[1] if b['pfad'] == pfad]
                hinweise.append(f'{name}: gesperrt, aber NICHT wegen der Mount-Liste — '
                                f'Grund: {grund[0] if grund else "?"}. Die Behauptung '
                                f'gilt also nur fuer wechselbare/USB-Traeger.')

    # ══ GEGENPROBE: den Riegel EINBAUEN und dieselbe Lage nochmal fahren ════
    # Ohne das misst dieses Werkzeug nur, dass etwas durchkommt — nicht, dass
    # es an DIESER Liste liegt.
    alt = geraete.SYSTEM_MOUNTS
    geraete.SYSTEM_MOUNTS = alt + ("/mnt/backup",)
    ok_g, _ = geraete.linux_auswerten(
        {"blockdevices": [SYSTEMPLATTE, LAGEN[0][1]]})
    geraete.SYSTEM_MOUNTS = alt
    sagen('')
    sagen(f'GEGENPROBE mit „/mnt/backup" in der Liste: '
          f'{[k["pfad"] for k in ok_g] or "nichts angeboten"}')
    if any(k['pfad'] == '/dev/sdc' for k in ok_g):
        fehler.append('GEGENPROBE: die Platte kommt AUCH mit /mnt/backup in der Liste '
                      'durch — dann liegt es nicht an SYSTEM_MOUNTS.')

    fenster.destroy()

    sagen('')
    for h in hinweise:
        sagen('EINSCHRAENKUNG: ' + h)
    if fehler:
        for f in fehler:
            sagen('WIDERSPRUCH: ' + f)
        return 1
    sagen('Die Behauptung hat sich am ganzen Weg bestaetigt.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
