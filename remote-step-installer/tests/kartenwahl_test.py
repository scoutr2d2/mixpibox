#!/usr/bin/env python3
"""Zwei Wechseldatentraeger, eine Karte — Erkennung und Auswahl.

══ WOZU ════════════════════════════════════════════════════════════════════
Betreiber, 10.08.2026: „ich wollte die sd karte beschreiben aber jetzt meldet
er 2 wechseldatenträger ich soll abziehen das finde ich nicht gut gelöst es
sind 2 partitionen glaube ich erkennt er."

Es waren keine Partitionen. AM GERAET GEMESSEN (sein Rechner, derselbe Tag):

    /dev/sda  238,3G  usb  SABRENT MassStorageClass   sda1 (128M vfat) + sda2 (ext4)
    /dev/sdb      0B  usb  SABRENT MassStorageClass   keine Kinder
    sysfs: …/2-1:1.0/host0/target0:0:0/0:0:0:0  gegen  …/0:0:0:1
    Kernel: „sd 0:0:0:1: [sdb] Media removed, stopped polling"

EIN Kartenleser mit ZWEI Schaechten, und der zweite ist leer. Der Assistent
bot beide an und verlangte, alle bis auf einen abzuziehen — was nicht geht,
beide haengen am selben Stecker.

Diese Datei haelt die Messung als Vorlage fest und prueft daran die Regeln,
die daraus geworden sind.

══ WAS ER PRUEFT ═══════════════════════════════════════════════════════════
  A. ERKENNUNG (pure Auswertung, kein Geraet noetig): Der leere Schacht faellt
     raus — aber NUR bei gemessener Null, nie bei unbekannter Groesse. Dazu
     Windows und macOS, weil eine Reparatur, die nur Linux anfasst, die
     anderen zwei still falsch laesst.
  B. AUSWAHL (reine Zustandslogik): Bei mehreren wird nichts geraten; eine
     getroffene Wahl haelt ueber die Takte; wechselt das Medium unter
     demselben Namen, faellt sie.
  C. DAS EINGEFRORENE ZIEL (mit Anzeige): Was die rote Rueckfrage NENNT, ist
     das, was geschrieben wird — auch wenn sich `self.karte` danach aendert.

AUFRUF
    python3 tests/kartenwahl_test.py        # Ende 0 = alles gruen
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO + '/controller')

import geraete                                                    # noqa: E402

ergebnis = []


def chk(name, bedingung, hinweis=''):
    ergebnis.append((name, bool(bedingung), hinweis))


# ══ A. ERKENNUNG ════════════════════════════════════════════════════════════
print('A  Erkennung')

# Die ECHTE Messung vom Rechner des Betreibers, `lsblk -J -b`. Nichts daran ist
# erfunden — die Zahlen stehen so in der Ausgabe.
SABRENT = {"blockdevices": [
    {"name": "sda", "path": "/dev/sda", "size": 255869321216, "model": "MassStorageClass",
     "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None],
     "hctl": "0:0:0:0", "serial": "000000002958",
     "children": [
         {"name": "sda1", "path": "/dev/sda1", "size": 134217728, "type": "part",
          "mountpoints": [None]},
         {"name": "sda2", "path": "/dev/sda2", "size": 255734054912, "type": "part",
          "mountpoints": [None]}]},
    {"name": "sdb", "path": "/dev/sdb", "size": 0, "model": "MassStorageClass",
     "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None],
     "hctl": "0:0:0:1", "serial": "000000002958"},
    {"name": "zram0", "path": "/dev/zram0", "size": 16127098880, "model": None,
     "tran": None, "rm": False, "hotplug": False, "type": "disk", "mountpoints": ["[SWAP]"]},
    {"name": "nvme0n1", "path": "/dev/nvme0n1", "size": 2000398934016,
     "model": "Samsung SSD 970 EVO Plus 2TB", "tran": "nvme", "rm": False,
     "hotplug": False, "type": "disk", "mountpoints": [None], "hctl": None,
     "serial": "S6P1NS0T319038A",
     "children": [
         {"name": "nvme0n1p1", "path": "/dev/nvme0n1p1", "size": 314572800, "type": "part",
          "mountpoints": ["/boot/efi"]},
         {"name": "nvme0n1p2", "path": "/dev/nvme0n1p2", "size": 2000084361216,
          "type": "part", "mountpoints": ["/home", "/"]}]}]}

ok, blockiert = geraete.linux_auswerten(SABRENT)
chk('genau EINE Karte wird angeboten', len(ok) == 1,
    f'angeboten: {[k["pfad"] for k in ok]}')
chk('  und zwar die mit der Karte drin', ok and ok[0]['pfad'] == '/dev/sda')
gruende = {b['pfad']: b['grund'] for b in blockiert}
chk('der leere Schacht ist ausgeschlossen', '/dev/sdb' in gruende)
chk('  mit einem Grund, der kein Vorwurf ist',
    'kein Medium' in gruende.get('/dev/sdb', ''), gruende.get('/dev/sdb', ''))
chk('die Systemplatte bleibt hart gesperrt',
    'System liegt darauf' in gruende.get('/dev/nvme0n1', ''))
chk('Partitionen tauchen nirgends auf',
    not any('sda1' in k['pfad'] or 'sda2' in k['pfad'] for k in ok + blockiert),
    'die Vermutung des Betreibers — sie waren nie das Problem')
chk('die Groesse steht auch als ZAHL bereit',
    ok and ok[0]['bytes'] == 255869321216)
chk('beide Schaechte sind als EIN Leser erkennbar (HCTL-Wurzel)',
    {b['hctl'].rsplit(':', 1)[0] for b in blockiert if b.get('hctl')} & {'0:0:0'} != set())

# ── DIE WICHTIGSTE GEGENREGEL: unbekannt ist nicht null ────────────────────
OHNE_GROESSE = {"blockdevices": [
    {"name": "sdc", "path": "/dev/sdc", "size": None, "model": "SD Card",
     "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None]}]}
ok2, block2 = geraete.linux_auswerten(OHNE_GROESSE)
chk('unbekannte Groesse wird NICHT gesperrt', len(ok2) == 1,
    'sonst verschwindet eine echte Karte, deren Groesse das System nicht meldet')
chk('  und sie traegt bytes=None statt einer erfundenen 0',
    ok2 and ok2[0]['bytes'] is None)

TEXTGROESSE = {"blockdevices": [
    {"name": "sdc", "path": "/dev/sdc", "size": "29,7G", "model": "SD Card",
     "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None]}]}
ok3, _ = geraete.linux_auswerten(TEXTGROESSE)
chk('eine alte lsblk-Fassung (Text statt Zahl) sperrt nichts', len(ok3) == 1)
chk('  und der Anzeigetext bleibt erhalten', ok3 and ok3[0]['groesse'] == '29,7G')

# ── Ein eingehaengter Traeger wird angeboten, aber genannt ─────────────────
EINGEHAENGT = {"blockdevices": [
    {"name": "sdc", "path": "/dev/sdc", "size": 64000000000, "model": "Fotos",
     "tran": "usb", "rm": True, "hotplug": True, "type": "disk", "mountpoints": [None],
     "children": [{"name": "sdc1", "path": "/dev/sdc1", "size": 64000000000,
                   "type": "part", "mountpoints": ["/run/media/achim/Fotos"]}]}]}
ok4, _ = geraete.linux_auswerten(EINGEHAENGT)
chk('ein eingehaengter Traeger bleibt waehlbar', len(ok4) == 1)
chk('  aber das Einhaengen steht im Datensatz',
    ok4 and ok4[0]['eingehaengt'] == ['/run/media/achim/Fotos'],
    'sonst sieht eine Platte in Benutzung aus wie eine leere Karte')

# ── Windows: hier stand eine 8, und die heisst RAID ────────────────────────
print('   Windows')
WIN = [
    {"Number": 0, "FriendlyName": "Samsung SSD", "Size": 1000000000000, "BusType": 17,
     "IsBoot": True, "IsSystem": True},
    {"Number": 1, "FriendlyName": "Kartenleser", "Size": 32000000000, "BusType": 12},
    {"Number": 2, "FriendlyName": "MMC", "Size": 32000000000, "BusType": 13},
    {"Number": 3, "FriendlyName": "USB Stick", "Size": 8000000000, "BusType": 7},
    {"Number": 4, "FriendlyName": "RAID-Verbund", "Size": 8000000000000, "BusType": 8},
    {"Number": 5, "FriendlyName": "Leerer Schacht", "Size": 0, "BusType": 7},
    {"Number": 6, "FriendlyName": "Ohne Groessenangabe", "Size": None, "BusType": 7},
]
wok, wblock = geraete.windows_auswerten(WIN)
wnamen = {k['modell'] for k in wok}
wgruende = {b['modell']: b['grund'] for b in wblock}
chk('Windows: der eingebaute SD-Leser (BusType 12) wird angeboten',
    'Kartenleser' in wnamen,
    'BusType 12 ist SD — er galt als „kein Wechseldatentraeger" und fehlte ganz')
chk('Windows: MMC (13) ebenfalls', 'MMC' in wnamen)
chk('Windows: USB (7) weiterhin', 'USB Stick' in wnamen)
chk('Windows: ein RAID-Verbund (8) wird NICHT angeboten',
    'RAID-Verbund' in wgruende,
    'BusType 8 ist RAID, nicht SD/MMC — er stand zum Beschreiben bereit')
chk('Windows: die Systemplatte bleibt gesperrt',
    'System liegt darauf' in wgruende.get('Samsung SSD', ''))
chk('Windows: leerer Schacht (Size 0) faellt raus',
    'kein Medium' in wgruende.get('Leerer Schacht', ''))
chk('Windows: FEHLENDE Groessenangabe faellt NICHT raus',
    'Ohne Groessenangabe' in wnamen,
    'Select-Object legt Size immer an — fehlt der Wert, kommt null, nicht 0')

# ── macOS: nur die Groessenregel, mehr ist dort unbelegt ───────────────────
MAC = {"_systemdisk": "disk0", "AllDisksAndPartitions": [
    {"DeviceIdentifier": "disk0", "Size": 500000000000, "Internal": True},
    {"DeviceIdentifier": "disk4", "Size": 0, "Internal": False, "RemovableMedia": True},
    {"DeviceIdentifier": "disk5", "Size": 32000000000, "Internal": False,
     "RemovableMedia": True, "MediaName": "SD Card"}]}
mok, mblock = geraete.mac_auswerten(MAC)
mgruende = {b['name']: b['grund'] for b in mblock}
chk('macOS: leerer Schacht faellt raus', 'kein Medium' in mgruende.get('disk4', ''))
chk('macOS: die Karte bleibt', [k['name'] for k in mok] == ['disk5'])

# ── „ich kann nicht nachsehen" ist nicht „nichts da" ───────────────────────
leer, blind = geraete._blind('lsblk', 'nicht gefunden')
chk('Blindheit liefert einen GRUND statt zweier leerer Listen',
    leer == [] and len(blind) == 1 and 'nicht nachsehen' in blind[0]['grund'])
chk('  und die Zahl der Rueckgabewerte bleibt zwei',
    len(geraete._blind('x', 'y')) == 2,
    'ein dritter Wert wuerde sdgui.py:246 stillschweigend zerlegen')


# ══ B. AUSWAHL ══════════════════════════════════════════════════════════════
print('B  Auswahl')
import sdstart                                                    # noqa: E402

A = {'pfad': '/dev/sda', 'modell': 'MassStorageClass', 'groesse': '238G',
     'bytes': 255869321216, 'seriennummer': '000000002958', 'bus': 'usb',
     'eingehaengt': [], 'hctl': '0:0:0:0'}
B = {'pfad': '/dev/sdc', 'modell': 'SanDisk Ultra', 'groesse': '32G',
     'bytes': 32000000000, 'seriennummer': 'AAA111', 'bus': 'usb',
     'eingehaengt': [], 'hctl': '1:0:0:0'}
B_ANDERE = dict(B, seriennummer='BBB222', modell='Kingston')

chk('dieselbe Karte gilt als dieselbe', not sdstart._anderes_medium(B, dict(B)))
chk('anderes Medium im selben Schacht wird erkannt',
    sdstart._anderes_medium(B, B_ANDERE))
chk('ohne Seriennummer entscheiden Modell und Groesse',
    sdstart._anderes_medium({'modell': 'X', 'bytes': 1}, {'modell': 'X', 'bytes': 2}))
chk('ganz ohne Angaben gilt es als GLEICH',
    not sdstart._anderes_medium({}, {}),
    'sonst faellt die Wahl auf kargen Systemen bei jedem Takt weg')

# Ein Namensgeber, der nichts erfindet.
chk('„MassStorageClass" ist kein Name',
    sdstart.Fenster._karte_name(A) == 'Unbenannter Wechseldatenträger')
chk('ein echter Name bleibt stehen',
    sdstart.Fenster._karte_name(B) == 'SanDisk Ultra')
chk('„SD-Karte" nur, wo der Bus es hergibt',
    sdstart.Fenster._karte_name({'modell': '', 'bus': 'mmc'}) == 'SD-Karte')
chk('  und sonst gerade NICHT',
    sdstart.Fenster._karte_name({'modell': '', 'bus': 'usb'})
    == 'Unbenannter Wechseldatenträger',
    'eine namenlose Festplatte hiess in der Loeschfrage „SD-Karte"')


# ══ C. DER WEG MIT ANZEIGE ══════════════════════════════════════════════════
def anzeige_da():
    try:
        import tkinter as tk
        w = tk.Tk()
        w.destroy()
        return True
    except Exception:                                             # noqa: BLE001
        return False


def weg_pruefen():
    import tkinter as tk
    f = sdstart.Fenster(probe=True)
    f.withdraw()
    f.deiconify()
    f.board = 'RPi5'
    f._seite_karte()
    f.update_idletasks()

    # ── Zwei Traeger: nichts wird geraten ──────────────────────────────────
    f._karten_gesetzt([A, B], [])
    f.update_idletasks()
    chk('bei zwei Traegern ist nichts vorgewaehlt', f.karte is None)
    chk('  der Schreibknopf ist zu', not f.knopf.an)
    chk('  und es steht KEIN „abziehen" mehr da',
        'abziehen' not in f.l_wo.cget('text').lower()
        and 'zieh alle ab' not in f.l_wo.cget('text').lower(),
        f.l_wo.cget('text'))
    # ── ERZEUGT IST NICHT ANGEZEIGT ────────────────────────────────────────
    #
    # Hier stand nur `len(knoepfe) == 2` ueber `winfo_children()`. Die
    # GEGENPROBE (das `kn.pack(...)` auskommentieren) blieb GRUEN: ein Widget
    # ohne Geometrieverwalter bleibt trotzdem Kind seines Rahmens — es ist nur
    # unsichtbar. Ein Test, der einen unsichtbaren Knopf fuer einen Knopf
    # haelt, prueft die Sackgasse nicht, um die es geht.
    knoepfe = [w for w in f.wahlkorb.winfo_children() if isinstance(w, sdstart.Knopf)]
    gepackt = [w for w in knoepfe if w.winfo_manager()]
    chk('  es gibt je Traeger einen Knopf', len(knoepfe) == 2,
        f'{len(knoepfe)} Knopf/Knoepfe — ohne sie ist die Seite eine Sackgasse')
    chk('  und sie haengen wirklich im Fenster', len(gepackt) == 2,
        f'{len(gepackt)} von {len(knoepfe)} sind gepackt — erzeugt ist nicht angezeigt')

    # ── Auswaehlen ─────────────────────────────────────────────────────────
    f._karte_waehlen('/dev/sdc')
    f.update_idletasks()
    chk('ein Klick waehlt', f.karte and f.karte['pfad'] == '/dev/sdc')
    chk('  und macht den Schreibknopf scharf', f.knopf.an)

    # ── Die Wahl haelt ueber den Takt ──────────────────────────────────────
    f._karten_gesetzt([dict(A), dict(B)], [])
    f.update_idletasks()
    chk('die Wahl ueberlebt den naechsten Suchtakt',
        f.karte and f.karte['pfad'] == '/dev/sdc',
        'frueher verglich der Takt ganze Woerterbuecher und verlor sie')

    # ── Anderes Medium im selben Schacht ───────────────────────────────────
    f._karten_gesetzt([dict(A), dict(B_ANDERE)], [])
    f.update_idletasks()
    chk('wechselt das Medium unter demselben Namen, faellt die Wahl',
        f.karte is None)

    # ── Was NICHT angeboten wird, steht da ─────────────────────────────────
    f._karten_gesetzt([dict(B)], [
        {'pfad': '/dev/sdb', 'grund': 'kein Medium erkannt (0 Byte)'},
        {'pfad': '/dev/nvme0n1', 'grund': 'System liegt darauf'}])
    f.update_idletasks()
    text = f.l_ausser.cget('text')
    chk('der leere Schacht wird mit Grund genannt', '/dev/sdb' in text, text)
    chk('  die Systemplatte aber nicht (reines Rauschen)', 'nvme' not in text, text)

    # ══ DAS EINGEFRORENE ZIEL ══════════════════════════════════════════════
    #
    # DER KERN DES DATENVERLUST-FEHLERS: Die Rueckfrage nannte Karte B, und
    # `_lauf` las `self.karte` NOCH EINMAL — zwei Sekunden spaeter, wenn dort
    # laengst A stehen konnte.
    gefangen = {}
    echt = f._loslegen
    f._loslegen = lambda ziel=None: gefangen.update(ziel=ziel)
    f._karten_gesetzt([dict(B)], [])
    f.update_idletasks()
    f._fragen()
    f.update_idletasks()
    chk('waehrend der Rueckfrage steht die Bremse auf an', f.warten is True,
        'sonst wandert das Ziel unter dem offenen Fenster weg')
    # ── UND SIE MUSS AUCH GREIFEN ──────────────────────────────────────────
    #
    # Das Fahnchen allein sagt nichts. Die GEGENPROBE (in `_karten_suchen` die
    # Bedingung `and not self.warten` entfernen) blieb gruen, weil der Test nur
    # die Fahne las und den Sucher nie aufrief. Also wird er aufgerufen.
    gesucht = []
    echter_sucher = f._karten_thread
    f._karten_thread = lambda: gesucht.append(1)
    f._karten_suchen()
    f.update()
    chk('  und der Sucher laeuft dann wirklich nicht', not gesucht,
        f'{len(gesucht)} Suchlauf/Suchlaeufe trotz offener Rueckfrage')
    f._karten_thread = echter_sucher
    dialoge = [w for w in f.winfo_children() if isinstance(w, tk.Toplevel)]
    if dialoge:
        # Jetzt das Ziel unter dem offenen Fenster austauschen — genau der Fall.
        f.karte = dict(A)
        f.karte_pfad = A['pfad']
        loeschen = [k for r in dialoge[0].winfo_children()
                    for k in r.winfo_children() if isinstance(k, sdstart.Knopf)
                    and 'löschen' in str(k.itemcget(k._text, 'text')).lower()]
        chk('der loeschende Knopf ist da', len(loeschen) == 1)
        if loeschen:
            loeschen[0].tat()
            chk('geschrieben wird, was die Rueckfrage NANNTE',
                gefangen.get('ziel', {}).get('pfad') == '/dev/sdc',
                f"bekommen: {gefangen.get('ziel', {}).get('pfad')} — "
                f"self.karte stand zu dem Zeitpunkt auf /dev/sda")
    f._loslegen = echt

    # ── Abbrechen gibt die Suche wieder frei ───────────────────────────────
    f.warten = True
    f._karten_gesetzt([dict(B)], [])
    f._fragen()
    f.update_idletasks()
    dialoge = [w for w in f.winfo_children() if isinstance(w, tk.Toplevel)]
    if dialoge:
        ab = [k for r in dialoge[0].winfo_children()
              for k in r.winfo_children() if isinstance(k, sdstart.Knopf)
              and 'abbrechen' in str(k.itemcget(k._text, 'text')).lower()]
        if ab:
            ab[0].tat()
            f.update_idletasks()
            chk('nach dem Abbrechen sucht er wieder', f.warten is False,
                'sonst steht der Assistent fuer immer still')
    f.destroy()


if anzeige_da():
    try:
        weg_pruefen()
    except Exception as e:                                        # noqa: BLE001
        import traceback
        chk('der Weg laeuft durch', False,
            f'{type(e).__name__}: {e}\n{traceback.format_exc()[-600:]}')
else:
    print('  (keine Anzeige — Teil C uebersprungen, A und B gelten trotzdem)')

# ══ Urteil ══════════════════════════════════════════════════════════════════
schlecht = 0
for name, gut, hinweis in ergebnis:
    print(f'  {"ok  " if gut else "NEIN"} {name}' + (f'   — {hinweis}' if not gut and hinweis else ''))
    schlecht += 0 if gut else 1
print(f'\n{len(ergebnis)} Pruefungen, {schlecht} Abweichung(en)')
sys.exit(1 if schlecht else 0)
