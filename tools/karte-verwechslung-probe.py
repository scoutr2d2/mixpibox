#!/usr/bin/env python3
"""Gegenprobe zur Behauptung „drei Zeilen reichen nicht, um die Karte zu erkennen".

DIE BEHAUPTUNG
`sdstart.py` zeigt vor dem unwiderruflichen Loeschen genau DREI Angaben —
Modell (792), Groesse (794), Geraetepfad (795); die Kartenzeile (512-513)
dieselben drei. Mehr steht im Datensatz nicht: `geraete.linux_auswerten`
(76-83) baut pfad/name/groesse/modell/wechselbar/bus, und `lsblk` wird
(181-182) ohne FSTYPE, LABEL, SERIAL, VENDOR aufgerufen. Wer eine externe
USB-Platte angesteckt hat, deren Gehaeuse — wie viele — keinen eigenen
Modellnamen meldet, bekommt genau denselben Text zu sehen wie bei einer
MixPi-Karte.

WAS DIESES WERKZEUG MISST — UND WARUM AN DER OBERFLAECHE
Die Feldliste zu lesen reicht nicht: die Behauptung lebt von der FOLGE. Also
geht jede Lage denselben Weg wie im Betrieb — Auswerter, `_karten_gesetzt`,
Knopfzustand, dann der WOERTLICHE Text des roten Dialogs. Zwei Lagen mit
gleicher Groesse und gleichem Modell, aber voellig verschiedenem Inhalt
(Fotoplatte NTFS gegen Box-Karte vfat+ext4) muessen dann Zeichen fuer Zeichen
denselben Dialog ergeben. Erst DANN ist belegt, dass der Mensch nicht
entscheiden kann, sondern raet.

DREI GEGENPROBEN, sonst misst man Gleichheit und glaubt sie:
  1. Eine dritte Lage mit ANDERER Groesse muss einen ANDEREN Dialogtext geben —
     sonst vergleicht dieses Werkzeug gar nicht, was es zu vergleichen behauptet.
  2. Der Dialog wird auf Woerter abgesucht, die den Unterschied nennen WUERDEN
     (ntfs, ext4, vfat, Label, eingehaengt, Fotos). Taucht eines auf, ist die
     Behauptung widerlegt.
  3. `lsblk` wird auf DIESEM Rechner mit den fehlenden Spalten aufgerufen —
     ist das nicht zu haben, ist der Vorwurf „waere in einer Zeile da" hinfaellig.

ES SCHREIBT NICHTS. Alle lsblk-Ausgaben fuer die Lagen sind erfunden, das
Fenster laeuft im Probe- und Trockenmodus, der rote Knopf wird nie geklickt —
nur sein Fenster gelesen und wieder zerstoert.

AUFRUF
    xvfb-run -a python3 tools/karte-verwechslung-probe.py
Ende 0 = die Behauptung hat sich bestaetigt, Ende 1 = sie ist widerlegt.
"""
import json
import os
import subprocess
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
        {"name": "nvme0n1p1", "path": "/dev/nvme0n1p1", "size": "300M", "type": "part",
         "mountpoints": ["/boot/efi"]},
        {"name": "nvme0n1p2", "path": "/dev/nvme0n1p2", "size": "1,8T", "type": "part",
         "mountpoints": ["/"]}],
}


def traeger(name, groesse, modell, kinder):
    """Ein USB-Wechseldatentraeger, wie ihn lsblk meldet."""
    return {"name": name, "path": f"/dev/{name}", "size": groesse, "model": modell,
            "tran": "usb", "rm": True, "hotplug": True, "type": "disk",
            "mountpoints": [None], "children": kinder}


def teil(name, groesse, fstype, label, mount):
    return {"name": name, "path": f"/dev/{name}", "size": groesse, "type": "part",
            "fstype": fstype, "label": label, "mountpoints": [mount]}


# ── Die drei Lagen ──────────────────────────────────────────────────────────
# A und B tragen ABSICHTLICH dieselbe Groesse und denselben Modellnamen: genau
# das ist der Fall, den der Betreiber am 10.08.2026 vor sich hatte („model=
# 'MassStorageClass'"). C weicht ab und dient nur als Messprobe.
FOTOPLATTE = traeger("sda", "238,3G", "MassStorageClass",
                     [teil("sda1", "238,3G", "ntfs", "Fotos", "/run/media/achim/Fotos")])
BOXKARTE = traeger("sda", "238,3G", "MassStorageClass",
                   [teil("sda1", "128M", "vfat", "bootfs", None),
                    teil("sda2", "238,2G", "ext4", "rootfs", None)])
KLEINE_KARTE = traeger("sda", "29,7G", "MassStorageClass",
                       [teil("sda1", "128M", "vfat", "bootfs", None),
                        teil("sda2", "29,6G", "ext4", "rootfs", None)])

LAGEN = [("A  externe Fotoplatte (NTFS, eingehaengt)", FOTOPLATTE),
         ("B  MixPi-Karte gleicher Groesse (vfat+ext4)", BOXKARTE),
         ("C  MixPi-Karte anderer Groesse — nur Messprobe", KLEINE_KARTE)]

# Woerter, die den Unterschied NENNEN wuerden. Steht eines im Dialog, gibt es
# doch eine Entscheidungshilfe und die Behauptung ist widerlegt.
VERRAETER = ("ntfs", "ext4", "vfat", "label", "bootfs", "rootfs", "fotos",
             "eingehäng", "eingehaeng", "partition", "serie", "seriennummer",
             "sabrent", "in benutzung")

fehler = []


def texte(widget, sammler=None):
    """Alle sichtbaren Beschriftungen eines Fensters einsammeln.

    Gesucht wird nach der OPTION `text` und zusaetzlich im Canvas-Knopf: der
    Hausknopf ist ein Canvas und traegt seinen Text als Canvas-Element — wer
    nur nach Labels sucht, uebersieht genau die Bauart dieses Programms.
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


def lage_fahren(fenster, name, geraet):
    """Eine Lage durch den GANZEN Weg schicken. -> (gewaehlt, Seitentext, Dialogtext)"""
    ok, blockiert = geraete.linux_auswerten({"blockdevices": [SYSTEMPLATTE, geraet]})
    print(f'\n=== {name}')
    for k in ok:
        print(f"   ANGEBOTEN   {k['pfad']:10s} {k['groesse']:>8s}  bus={k['bus']:4s}  {k['modell']}")
    for b in blockiert:
        print(f"   gesperrt    {b['pfad']:10s} {b['groesse']:>8s}  ({b['grund']})")

    fenster.karte = None
    fenster._seite_karte()
    fenster._karten_gesetzt(list(ok))
    fenster.update()
    gewaehlt = (fenster.karte or {}).get('pfad')
    seite = f'{fenster.l_karte.cget("text")} || {fenster.l_wo.cget("text")}'
    print(f'   -> automatisch gewaehlt: {gewaehlt}   Knopf klickbar: {fenster.knopf.an}')
    print(f'   -> Kartenzeile: {seite!r}')

    # Der rote Dialog — gebaut, gelesen, zerstoert. Nie geklickt.
    #
    # DAS FENSTER MUSS DAFUER AUFGEZOGEN SEIN: `_fragen` haelt in
    # `wait_visibility()` an, und ein `transient`-Toplevel wird nie sichtbar,
    # solange der Parent zurueckgezogen ist — das haengt dann ewig.
    dialog = ''
    if gewaehlt:
        fenster.deiconify()
        fenster.update()
        fenster._fragen()
        fenster.update()
        tops = [w for w in fenster.winfo_children() if isinstance(w, tk.Toplevel)]
        if tops:
            f = tops[-1]
            dialog = ' | '.join(texte(f))
            print(f'   -> roter Dialog: {dialog}')
            f.grab_release()
            f.destroy()
            fenster.update()
        fenster.withdraw()
    return gewaehlt, seite, dialog


def spalten_nachfragen():
    """GEGENPROBE 3: Waere das Fehlende ueberhaupt zu haben — hier, jetzt?"""
    fehlt = "FSTYPE,LABEL,SERIAL,VENDOR,PARTLABEL"
    r = subprocess.run(["lsblk", "-J", "-o", "NAME,PATH,SIZE,MODEL,TRAN,RM,HOTPLUG,"
                        "TYPE,MOUNTPOINTS," + fehlt],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        return False, (r.stderr or '').strip()
    try:
        json.loads(r.stdout)
    except ValueError as e:
        return False, str(e)
    return True, fehlt


def main():
    fenster = sdstart.Fenster(board='RPi5', trocken=True, probe=True)
    fenster.withdraw()

    ergebnis = {}
    for name, geraet in LAGEN:
        gewaehlt, seite, dialog = lage_fahren(fenster, name, geraet)
        ergebnis[name[0]] = (gewaehlt, seite, dialog)
        if not gewaehlt:
            fehler.append(f'{name}: nichts automatisch gewaehlt — die Folge tritt nicht ein.')
        if not fenster.knopf.an and gewaehlt:
            fehler.append(f'{name}: der Schreiben-Knopf bleibt zu — die Folge tritt nicht ein.')

    print('\n' + '═' * 70)

    # ── Der eigentliche Vergleich ───────────────────────────────────────────
    a_wahl, a_seite, a_dialog = ergebnis['A']
    b_wahl, b_seite, b_dialog = ergebnis['B']
    c_wahl, c_seite, c_dialog = ergebnis['C']

    if a_dialog and a_dialog == b_dialog:
        print('BESTAETIGT: Fotoplatte und Box-Karte ergeben ZEICHEN FUER ZEICHEN')
        print(f'   denselben roten Dialog:\n   »{a_dialog}«')
    else:
        fehler.append('Die Dialoge von A und B unterscheiden sich — es gibt also '
                      f'doch eine Entscheidungshilfe.\n   A: {a_dialog}\n   B: {b_dialog}')
    if a_seite != b_seite:
        fehler.append('Die Kartenzeilen von A und B unterscheiden sich — '
                      f'A: {a_seite!r}  B: {b_seite!r}')

    # GEGENPROBE 1: erkennt dieses Werkzeug ueberhaupt einen Unterschied?
    if c_dialog == a_dialog:
        fehler.append('MESSFEHLER: auch die abweichende Lage C ergibt denselben Text — '
                      'dieses Werkzeug vergleicht nicht, was es zu vergleichen behauptet.')
    else:
        print('\nGegenprobe 1 (Messprobe): Lage C mit anderer Groesse ergibt einen')
        print(f'   anderen Text — der Vergleich misst also wirklich.\n   »{c_dialog}«')

    # GEGENPROBE 2: nennt der Dialog irgendwo den Unterschied?
    verraten = [w for w in VERRAETER if w in a_dialog.lower() or w in a_seite.lower()]
    if verraten:
        fehler.append(f'Der Dialog nennt doch ein Unterscheidungsmerkmal: {verraten}')
    else:
        print('\nGegenprobe 2: kein Wort ueber Dateisystem, Label, Einhaengepunkt,')
        print('   Partitionen oder Seriennummer — weder in der Zeile noch im Dialog.')

    # GEGENPROBE 3: waere das Fehlende zu haben?
    da, was = spalten_nachfragen()
    if da:
        print(f'\nGegenprobe 3: `lsblk -o …,{was}` laeuft auf DIESEM Rechner und liefert')
        print('   gueltiges JSON — die fehlenden Angaben kosten eine geaenderte Zeile.')
    else:
        fehler.append(f'Die fehlenden Spalten sind hier gar nicht zu haben: {was} — '
                      'der Vorwurf „waere in einer Zeile da" traegt nicht.')

    print('\n' + '═' * 70)
    if fehler:
        print('WIDERLEGT — oder mindestens angeschlagen:')
        for f in fehler:
            print(f'  * {f}')
        return 1
    print('BEHAUPTUNG HAELT: derselbe Text vor zwei voellig verschiedenen Inhalten.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
