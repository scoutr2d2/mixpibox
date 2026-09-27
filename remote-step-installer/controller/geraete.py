"""Wechseldatentraeger finden, beschreiben, mounten — auf Linux, macOS, Windows.

WOZU DIESE DATEI: Alles andere am SD-Assistenten ist laengst plattformfrei —
die Bildliste ist HTTP, `prepare_boot` schreibt nur Dateien. Genau DREI Dinge
sind es nicht, und sie stehen deshalb hier beisammen statt verstreut:

    Karten finden      lsblk        diskutil        Get-Disk (PowerShell)
    Karte beschreiben  dd           dd              raw write auf \\\\.\\PhysicalDriveN
    Boot mounten       udisksctl    diskutil mount  automatisch (Laufwerksbuchstabe)

DIE SICHERHEITSREGEL GILT UEBERALL GLEICH und wird deshalb NICHT je System neu
erfunden: angeboten wird nur, was wechselbar ist; alles, worauf das laufende
System liegt, ist HART ausgeschlossen und wird mit Grund angezeigt. Ein
falsches Geraet zerstoert die Platte, auf der man gerade arbeitet — das ist
kein Fall fuer drei verschiedene Auslegungen.

WAS ES NICHT TUT
  * Es fragt nicht nach Rechten. Wer ohne die noetigen Rechte schreibt, bekommt
    einen klaren Fehler statt eines halb beschriebenen Datentraegers.
  * Es raet nicht. Findet es die Aufteilung nicht, sagt es das.

GEPRUEFT: die reine Auswertung (aus aufgezeichneter Ausgabe) auf allen drei
Systemen — `tests/geraete_test.py`. Das ECHTE Schreiben ist nur auf Linux
belegt; fuer macOS und Windows steht der Weg, aber niemand hat ihn gefahren.
Das steht auch in der Oberflaeche, statt es zu verschweigen.
"""
import json
import os
import platform
import re
import subprocess
import time

SYSTEM = platform.system()          # 'Linux' | 'Darwin' | 'Windows'


def ist_linux():
    return SYSTEM == "Linux"


def ist_mac():
    return SYSTEM == "Darwin"


def ist_windows():
    return SYSTEM == "Windows"


def _lauf(argv, frist=30):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=frist)
    except (OSError, subprocess.SubprocessError) as e:
        return subprocess.CompletedProcess(argv, 1, "", str(e))


# ── Auswertung: pure Funktionen, damit sie ohne die Systeme pruefbar sind ───
SYSTEM_MOUNTS = ("/", "/home", "/boot", "/boot/efi", "/boot/firmware", "/var", "[SWAP]")


# ══ EIN LEERER SCHACHT IST KEINE KARTE ══════════════════════════════════════
#
# GEMESSEN AM 10.08.2026 am Rechner des Betreibers, weil er meldete: „ich wollte
# die sd karte beschreiben aber jetzt meldet er 2 wechseldatenträger ich soll
# abziehen das finde ich nicht gut gelöst".
#
#   /dev/sda  238,3G  usb  SABRENT MassStorageClass   (die Karte, sda1+sda2)
#   /dev/sdb      0B  usb  SABRENT MassStorageClass   (keine Kinder)
#
# und in sysfs:
#   sda: …/usb2/2-1/2-1:1.0/host0/target0:0:0/0:0:0:0/block/sda
#   sdb: …/usb2/2-1/2-1:1.0/host0/target0:0:0/0:0:0:1/block/sdb
#
# ES SIND KEINE ZWEI PARTITIONEN (die wirft `type != "disk"` schon weg) und
# auch keine zwei Geraete: es ist EIN Kartenleser mit ZWEI SCHAECHTEN. Linux
# gibt jedem Schacht einen eigenen Namen, auch dem leeren. Der Kernel sagt es
# woertlich: „sd 0:0:0:1: [sdb] Media removed, stopped polling".
#
# Der Assistent bot beide an und verlangte dann, alle bis auf einen abzuziehen
# — was NICHT GEHT: beide haengen an demselben Stecker. Wer der Anweisung folgt,
# zieht die Karte mit ab. Das ist eine Sackgasse (BACKLOG #61).
#
# ── WARUM DIE GROESSE NICHT AUS `groesse` KOMMEN DARF ───────────────────────
# `groesse` war unter Linux der ANZEIGETEXT von lsblk und ist auch noch
# sprachabhaengig: „238,3G" mit Komma, „0B". Auf so einem Feld zu entscheiden
# heisst, auf die Spracheinstellung zu wetten. Deshalb fuehrt jeder Datensatz
# jetzt zusaetzlich `bytes` als ZAHL, und die Anzeige wird daraus gerechnet.
#
# ── UND WARUM `None` NICHT `0` IST ──────────────────────────────────────────
# Das ist der Kern und der Grund fuer die eigene Funktion. Eine gerade
# gesteckte Karte kann fuer einen Augenblick 0 melden, bevor der Kern sie
# gelesen hat, und ein System, das die Groesse gar nicht liefert, meldet
# nichts. WER BEIDES ZUSAMMENWIRFT, SPERRT ECHTE KARTEN AUS — und der Mensch
# sieht „Steck die Karte ein", waehrend sie steckt. Das waere dieselbe
# Sackgasse noch einmal, nur andersherum.
#
#   None  = „ich weiss es nicht"  -> NIE sperren
#   0     = „gemessen, es ist 0"  -> Schacht ohne Medium
def _bytes(wert):
    """-> int | None. None heisst ausdruecklich „unbekannt", nicht „null"."""
    if wert is None or wert == "":
        return None
    if isinstance(wert, bool):          # True/False sind in Python auch Zahlen
        return None
    try:
        return int(str(wert).strip())
    except (TypeError, ValueError):
        # Aeltere lsblk-Fassungen liefern auch mit `-b` Text („238,3G"). Das
        # ist kein Fehler, nur keine Zahl — also unbekannt statt geraten.
        return None


def _mountpoints(dev):
    mps = list(dev.get("mountpoints") or [])
    if dev.get("mountpoint"):
        mps.append(dev["mountpoint"])
    for ch in dev.get("children") or []:
        mps += _mountpoints(ch)
    return [m for m in mps if m]


def linux_auswerten(lsblk):
    """`lsblk -J -b` -> (beschreibbar, ausgeschlossen). Pure.

    DIE REIHENFOLGE DER ZWEIGE IST DIE SICHERHEIT. „System liegt darauf" steht
    zuerst und darf von keiner neuen Regel ueberholt werden — sonst bekaeme die
    Systemplatte irgendwann einen beruhigenderen Grund als den richtigen.
    """
    ok, blockiert = [], []
    for d in (lsblk or {}).get("blockdevices", []):
        if d.get("type") != "disk":
            continue
        mps = _mountpoints(d)
        gross = _bytes(d.get("size"))
        info = {
            "pfad": d.get("path") or f"/dev/{d.get('name', '')}",
            "name": d.get("name", ""),
            # `bytes` ist zum RECHNEN, `groesse` zum ANZEIGEN. Liefert das
            # System keine Zahl, bleibt der urspruengliche Text stehen —
            # anzeigen kann man ihn, entscheiden darf man auf ihm nicht.
            "bytes": gross,
            "groesse": _lesbar(gross) if gross is not None else (d.get("size") or "?"),
            "modell": (d.get("model") or "").strip(),
            "wechselbar": bool(d.get("rm")) or bool(d.get("hotplug")),
            "bus": (d.get("tran") or "").lower(),
            # DIE EINHAENGEPUNKTE WURDEN BISHER WEGGEWORFEN, sobald sie nicht
            # in SYSTEM_MOUNTS standen. Damit stand nirgends, dass ein
            # angebotener Traeger gerade IN BENUTZUNG ist — /mnt/backup oder
            # /run/media/achim/Fotos sahen aus wie eine leere Karte.
            "eingehaengt": [m for m in mps if m not in ("[SWAP]",)],
            # WOZU HCTL: nur, um den WAHREN Satz sagen zu koennen, wenn zwei
            # Eintraege zu einem Leser gehoeren (0:0:0:0 gegen 0:0:0:1). Es
            # loest NIE eine Sperre aus — dafuer ist es auf genau einem Geraet
            # gemessen, und das ist zu duenn fuer eine Entscheidung.
            "hctl": (d.get("hctl") or ""),
            "seriennummer": (d.get("serial") or "").strip(),
        }
        if any(m in SYSTEM_MOUNTS for m in mps):
            info["grund"] = "System liegt darauf"
            blockiert.append(info)
        elif not (info["wechselbar"] or info["bus"] in ("usb", "mmc", "sd")):
            info["grund"] = "kein Wechseldatentraeger"
            blockiert.append(info)
        elif gross == 0:
            # SIEHE `_bytes` OBEN: nur die GEMESSENE Null sperrt. `None` ist
            # „unbekannt" und geht durch — eine Karte, deren Groesse das System
            # nicht meldet, darf nicht als leerer Schacht verschwinden.
            info["grund"] = ("kein Medium erkannt (0 Byte) — steckt eine Karte "
                             "drin, ist diese Zeile in ein paar Sekunden weg")
            blockiert.append(info)
        else:
            ok.append(info)
    return ok, blockiert


def mac_auswerten(plist_dicts):
    """`diskutil list -plist` (schon zu Python geparst) -> (ok, blockiert). Pure.

    Auf macOS heisst die Frage anders als auf Linux: entscheidend ist, ob der
    Datentraeger INTERN ist. Die interne SSD ist immer intern, eine SD-Karte im
    eingebauten Leser meldet sich als `internal: True` — DESHALB reicht das
    Merkmal allein nicht, und es kommt die Groesse dazu: die Systemplatte ist
    die, auf der das Startvolume liegt.
    """
    ok, blockiert = [], []
    system_disk = (plist_dicts or {}).get("_systemdisk", "")
    for d in (plist_dicts or {}).get("AllDisksAndPartitions", []):
        kennung = d.get("DeviceIdentifier", "")
        if not kennung:
            continue
        gross = _bytes(d.get("Size"))
        info = {
            "pfad": f"/dev/{kennung}",
            "name": kennung,
            "bytes": gross,
            "groesse": _lesbar(gross) if gross is not None else "?",
            "modell": (d.get("MediaName") or d.get("VolumeName") or "").strip(),
            "wechselbar": not d.get("Internal", True),
            "bus": "intern" if d.get("Internal", True) else "extern",
            "eingehaengt": [p.get("MountPoint") for p in d.get("Partitions", []) or []
                            if p.get("MountPoint")],
            "hctl": "",
            "seriennummer": "",
        }
        if kennung == system_disk or any(
                p.get("MountPoint") == "/" for p in d.get("Partitions", []) or []):
            info["grund"] = "System liegt darauf"
            blockiert.append(info)
        elif d.get("Internal", True) and not d.get("RemovableMedia", False):
            info["grund"] = "interner Datentraeger"
            blockiert.append(info)
        elif gross == 0:
            info["grund"] = ("kein Medium erkannt (0 Byte) — steckt eine Karte "
                             "drin, ist diese Zeile in ein paar Sekunden weg")
            blockiert.append(info)
        else:
            ok.append(info)
    return ok, blockiert


# ══ MACOS IST HIER UNBELEGT, UND DAS GEHOERT GESAGT ═════════════════════════
#
# Der Dateikopf sagt fuers SCHREIBEN ehrlich, dass niemand es auf einem Mac
# gefahren hat. Fuer die ERKENNUNG stand dort „geprueft" — das stimmt nur fuer
# die Auswertung einer AUFGEZEICHNETEN Ausgabe, und die Aufzeichnung in
# tests/geraete_test.py mischt Schluessel aus `diskutil info` in eine Struktur
# von `diskutil list`. Ob `diskutil list -plist` die Felder `Internal` und
# `RemovableMedia` ueberhaupt fuehrt, ist damit NICHT belegt. Fehlen sie,
# greifen oben die Vorgaben (`True` bzw. `False`) und JEDER Traeger wird
# „interner Datentraeger" — am Mac faende der Assistent dann nie eine Karte.
#
# Deshalb ist hier ausser der Groessen-Regel nichts verschaerft worden: an
# unbelegtem Verhalten zu drehen macht es nicht richtiger, nur anders falsch.
# Was es braucht, ist eine echte Ausgabe von `diskutil list -plist` UND
# `diskutil info -plist /dev/diskN` mit gesteckter Karte.


# ══ DIE BUSTYPEN VON Get-Disk — HIER STAND EINE 8, UND DIE WAR FALSCH ═══════
#
# Der Kommentar sagte „`BusType` 7 (USB) und 8 (SD/MMC)". In der Aufzaehlung
# MSFT_Disk.BusType steht aber:
#
#     7 = USB      8 = RAID     12 = SD      13 = MMC
#
# Der Fehler ging in BEIDE Richtungen, und beide sind schlimm:
#   * Ein RAID-VERBUND galt als Wechseldatentraeger und wurde zum Beschreiben
#     ANGEBOTEN. Auf einem Rechner mit RAID stand die Datenplatte in der Liste.
#   * Der EINGEBAUTE SD-LESER (12/13) — der haeufigste Windows-Fall ueberhaupt,
#     jedes Notebook mit Kartenschlitz — wurde mit „kein Wechseldatentraeger"
#     abgewiesen. Unter Windows fand der Assistent die Karte also nie, ausser
#     sie steckte in einem USB-Leser.
#
# NICHT AM GERAET GEPRUEFT: hier steht kein Windows. Die Zahlen stammen aus der
# dokumentierten Aufzaehlung, nicht aus einer Messung — das gehoert dazugesagt.
WIN_BUS_WECHSELBAR = (7, 12, 13)


def windows_auswerten(disks):
    """PowerShell `Get-Disk | ConvertTo-Json` -> (ok, blockiert). Pure.

    `IsBoot`/`IsSystem` sind die verlaesslichen Merkmale; welche Bustypen
    ueberhaupt in Frage kommen, steht oben bei WIN_BUS_WECHSELBAR. Bei EINER
    Platte liefert PowerShell KEINE Liste, sondern ein einzelnes Objekt — das
    hat schon manchen Auswerter zerlegt, deshalb wird es hier abgefangen.
    """
    if isinstance(disks, dict):
        disks = [disks]
    ok, blockiert = [], []
    for d in disks or []:
        nummer = d.get("Number")
        if nummer is None:
            continue
        bus = d.get("BusType")
        # `d.get("Size", 0)` STAND HIER UND WAERE JETZT GEFAEHRLICH: ein
        # FEHLENDES Feld waere zur gemessenen Null geworden, und die neue Regel
        # weiter unten haette eine gute Karte weggeworfen. Fehlt es, ist es
        # unbekannt — genau die Unterscheidung, die `_bytes` traegt.
        gross = _bytes(d.get("Size"))
        info = {
            "pfad": f"\\\\.\\PhysicalDrive{nummer}",
            "name": f"Datentraeger {nummer}",
            "bytes": gross,
            "groesse": _lesbar(gross) if gross is not None else "?",
            "modell": (d.get("FriendlyName") or "").strip(),
            "wechselbar": (bus in WIN_BUS_WECHSELBAR
                           or str(bus).upper() in ("USB", "SD", "MMC")),
            "bus": str(bus),
            "eingehaengt": [],
            "hctl": "",
            "seriennummer": (d.get("SerialNumber") or "").strip(),
        }
        if d.get("IsBoot") or d.get("IsSystem"):
            info["grund"] = "System liegt darauf"
            blockiert.append(info)
        elif not info["wechselbar"]:
            info["grund"] = "kein Wechseldatentraeger"
            blockiert.append(info)
        elif gross == 0:
            info["grund"] = ("kein Medium erkannt (0 Byte) — steckt eine Karte "
                             "drin, ist diese Zeile in ein paar Sekunden weg")
            blockiert.append(info)
        else:
            ok.append(info)
    return ok, blockiert


def _lesbar(bytes_):
    try:
        b = float(bytes_)
    except (TypeError, ValueError):
        return "?"
    for e in ("B", "K", "M", "G", "T"):
        if b < 1024:
            return f"{b:.0f}{e}"
        b /= 1024
    return f"{b:.0f}P"


# ── I/O: je System der eigene Weg ──────────────────────────────────────────
# ══ „ICH KANN NICHT NACHSEHEN" IST NICHT „ES IST NICHTS DA" ═════════════════
#
# Bisher gab jeder Fehlerzweig hier `[], []` zurueck, und die Oberflaeche
# machte daraus „Keine SD-Karte gefunden. Steck die Karte ein". Wer das liest,
# steckt die Karte um, zieht sie ab, probiert einen anderen Schlitz — und die
# ganze Zeit war das Problem, dass `lsblk` gar nicht erst lief. Ein Werkzeug,
# das seine eigene Blindheit als Befund ueber die Welt ausgibt, schickt Leute
# in die Irre.
#
# Die ZAHL der Rueckgabewerte bleibt bei zwei. Ein dritter wuerde sdgui.py:246
# (`self.meldungen.put(("karten", geraete.karten_finden()))`) und lage_zeigen()
# stillschweigend zerlegen.
def _blind(womit, warum):
    return [], [{"pfad": "—", "name": "", "bytes": None, "groesse": "?",
                 "modell": "", "wechselbar": False, "bus": "", "eingehaengt": [],
                 "hctl": "", "seriennummer": "",
                 "grund": f"ich kann nicht nachsehen: {womit} {warum}"}]


# Zwei Spaltenlisten, und zwar in dieser Reihenfolge. HCTL und SERIAL braucht
# nur die ANZEIGE (der Satz „beide gehoeren zu einem Leser"); kennt eine
# aeltere lsblk-Fassung eine davon nicht, endet der Aufruf mit rc != 0 und die
# Erkennung waere komplett blind — fuer eine Randbemerkung ein zu hoher Preis.
# Deshalb faellt sie auf das Noetige zurueck, statt aufzugeben.
# Gemessen mit util-linux 2.42.2 am 10.08.2026: die reiche Liste laeuft (rc 0),
# `-b` liefert `size` als JSON-Zahl.
LSBLK_SPALTEN = (
    "NAME,PATH,SIZE,MODEL,TRAN,RM,HOTPLUG,TYPE,MOUNTPOINTS,HCTL,SERIAL",
    "NAME,PATH,SIZE,MODEL,TRAN,RM,HOTPLUG,TYPE,MOUNTPOINTS",
)


def karten_finden():
    """-> (beschreibbar, ausgeschlossen).

    Die zweite Liste ist nicht nur Zierat: sie traegt zu jedem NICHT
    angebotenen Traeger den GRUND. Ohne sie sucht jemand seine Karte in der
    Auswahl, findet sie nicht und haelt das Programm fuer kaputt — dabei war
    der Ausschluss genau richtig.
    """
    if ist_linux():
        r = None
        for spalten in LSBLK_SPALTEN:
            r = _lauf(["lsblk", "-J", "-b", "-o", spalten])
            if r.returncode == 0:
                break
        if r is None or r.returncode != 0:
            return _blind("lsblk", (r.stderr or r.stdout or "").strip()[:120]
                          if r is not None else "liess sich nicht starten")
        try:
            return linux_auswerten(json.loads(r.stdout))
        except ValueError as e:
            return _blind("lsblk", f"antwortete unlesbar ({e})")
    if ist_mac():
        r = _lauf(["diskutil", "list", "-plist"])
        if r.returncode != 0:
            return _blind("diskutil", (r.stderr or r.stdout or "").strip()[:120])
        try:
            import plistlib
            daten = plistlib.loads(r.stdout.encode())
        except Exception as e:                               # noqa: BLE001
            return _blind("diskutil", f"antwortete unlesbar ({e})")
        # Welche Platte traegt das System? diskutil nennt sie beim Startvolume.
        s = _lauf(["diskutil", "info", "-plist", "/"])
        try:
            import plistlib as pl
            daten["_systemdisk"] = pl.loads(s.stdout.encode()).get("ParentWholeDisk", "")
        except Exception:                                    # noqa: BLE001
            daten["_systemdisk"] = ""
        return mac_auswerten(daten)
    if ist_windows():
        r = _lauf(["powershell", "-NoProfile", "-Command",
                   "Get-Disk | Select-Object Number,FriendlyName,Size,BusType,"
                   "SerialNumber,IsBoot,IsSystem | ConvertTo-Json"])
        if r.returncode != 0:
            return _blind("Get-Disk", (r.stderr or r.stdout or "").strip()[:120])
        try:
            return windows_auswerten(json.loads(r.stdout or "[]"))
        except ValueError as e:
            return _blind("Get-Disk", f"antwortete unlesbar ({e})")
    return _blind("dieses System", f"({SYSTEM}) kennt der Assistent nicht")


def schreib_befehl(img_xz, geraet):
    """Der Befehl, der die Karte beschreibt — als Liste, ohne Shell.

    ER WIRD AUCH ANGEZEIGT, bevor er laeuft. Wer gleich einen Datentraeger
    ueberschreibt, darf sehen, womit.
    """
    if ist_windows():
        # Windows hat kein dd. Der rohe Schreibweg steht in `windows_schreiben`;
        # hier gibt es nur die Beschreibung fuer die Anzeige.
        return ["<eingebaut>", "raw write", img_xz, "->", geraet]
    return ["sh", "-c",
            f"xz -dc {_zitat(img_xz)} | dd of={_zitat(geraet)} bs=4M "
            f"conv=fsync status=progress"]


def _zitat(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


# ══ WINDOWS SCHREIBT NUR IN GANZEN SEKTOREN ═════════════════════════════════
#
# Ein Handle auf \\.\PhysicalDriveN nimmt nur Schreibvorgaenge an, deren
# LAENGE UND VERSATZ Vielfache der Sektorgroesse sind. Ein krummer WriteFile
# endet mit ERROR_INVALID_PARAMETER (in Python: OSError [Errno 22]).
#
# UND DIE LAENGEN SIND IMMER KRUMM. Was ein LZMA-Entpacker je Happen ausgibt,
# haengt am Inhalt, nicht an der Blockgroesse. Nachgerechnet am 10.08.2026 mit
# einem 40-MiB-Abbild und genau der Schleife von unten:
#     block 4 MiB -> 8 Schreibvorgaenge, sektorgerecht 0 von 8
#     block 1 MiB -> 31 Schreibvorgaenge, sektorgerecht 0 von 31
# Der ERSTE ist schon krumm; es waere also beim ersten Byte gescheitert.
#
# Deshalb sammelt die Schleife und schreibt nur volle Sektoren. 4096 deckt
# 512er-Medien mit ab (jedes Vielfache von 4096 ist eines von 512), spart aber
# die Abfrage der echten Sektorgroesse — die ginge nur mit einem
# Windows-Aufruf, den hier niemand nachmessen kann.
SEKTOR = 4096


def windows_schreiben(img_xz, geraet, melden=None, block=4 * 1024 * 1024):
    """Roh auf \\\\.\\PhysicalDriveN schreiben und dabei entpacken.

    OHNE FREMDWERKZEUG: Windows bringt weder dd noch xz mit, und einen
    Installer, der erst zwei Programme nachinstallieren laesst, benutzt
    niemand. Python kann beides — `lzma` ist Standardbibliothek.

    BRAUCHT ADMINRECHTE. Ohne sie schlaegt schon das Oeffnen fehl, und zwar
    bevor ein Byte geschrieben ist — das ist die richtige Reihenfolge.
    """
    import lzma
    sag = melden or (lambda s: None)
    gesamt = os.path.getsize(img_xz)
    gelesen = 0
    with open(geraet, "rb+", buffering=0) as ziel, open(img_xz, "rb") as roh:
        entpacker = lzma.LZMADecompressor()
        puffer = bytearray()
        while True:
            stueck = roh.read(block)
            if not stueck:
                break
            gelesen += len(stueck)
            puffer += entpacker.decompress(stueck)
            # NUR GANZE SEKTOREN, DER REST WARTET.
            ganz = len(puffer) // SEKTOR * SEKTOR
            if ganz:
                ziel.write(bytes(puffer[:ganz]))
                del puffer[:ganz]
            sag(f"{gelesen * 100 // max(gesamt, 1)}%")
        if puffer:
            # DER LETZTE BLOCK WIRD MIT NULLEN AUFGEFUELLT. Das ist kein
            # Schoenheitsfehler am Abbild: Ein DietPi-Abbild endet auf einer
            # Partitionsgrenze, und was dahinter steht, gehoert keinem
            # Dateisystem. Ohne das Auffuellen liesse sich der Rest gar nicht
            # schreiben — und die letzten Bytes des Abbilds fehlten.
            puffer += bytes(SEKTOR - len(puffer) % SEKTOR)
            ziel.write(bytes(puffer))
        ziel.flush()
        os.fsync(ziel.fileno())
    return True


def _pfad_aus_meldung(text):
    """Den Mountpunkt aus einer udisksctl-Zeile ziehen. Pure.

    ZWEI FORMEN, und die zweite hat gefehlt:
        Mounted /dev/sdb1 at /run/media/achim/bootfs.
        Error … AlreadyMounted: Device /dev/sdb1 is already mounted at `/run/…`.
    Die zweite ist ein FEHLER und trotzdem ein Erfolg — die Partition ist ja
    eingehaengt, nur eben schon vorher, weil der Schreibtisch das automatisch
    tut. Der erste Entwurf nahm den Text stumpf hinter "at" und bekam einen
    Pfad MIT BACKTICKS zurueck; danach schlug jedes Schreiben darauf fehl.
    """
    if not text:
        return None
    m = re.search(r"\bat\s+`([^`]+)`", text)          # AlreadyMounted-Form
    if not m:
        m = re.search(r"\bat\s+(/\S+?)\.?\s*$", text, re.M)   # Normalform
    if not m:
        return None
    pfad = m.group(1).strip().strip("`'\"").rstrip(".")
    return pfad if os.path.isdir(pfad) else None


def _warte_auf_partition(teil, sekunden=15, sag=None):
    """Nach dem Schreiben kennt der Kernel oft noch die ALTE Aufteilung.

    `partprobe` stupst ihn an; danach dauert es trotzdem einen Moment, bis
    udev das Geraet angelegt hat. Ohne dieses Warten meldet der Assistent
    "Boot-Partition nicht gefunden", obwohl sie eine Sekunde spaeter da ist.
    """
    for i in range(sekunden):
        if os.path.exists(teil):
            return True
        if i == 2:
            _lauf(["partprobe", teil.rstrip("0123456789p")], frist=20)
            if sag:
                sag("  Partitionstabelle neu einlesen …")
        time.sleep(1)
    return os.path.exists(teil)


def boot_mounten(geraet, melden=None):
    """Die Boot-Partition (FAT, meist die erste) einhaengen -> Pfad oder None."""
    sag = melden or (lambda s: None)
    if ist_linux():
        teil = geraet + ("p1" if re.search(r"\d$", geraet) else "1")
        if not _warte_auf_partition(teil, sag=sag):
            sag(f"  {teil} taucht nicht auf — Karte kurz abziehen und neu einstecken.")
            return None
        # SCHON EINGEHAENGT? Dann ist nichts zu tun. Der Schreibtisch macht das
        # von selbst, sobald die frische Partition auftaucht — und dann ist der
        # udisksctl-Aufruf gleich ein "Fehler", obwohl alles in Ordnung ist.
        r0 = _lauf(["findmnt", "-n", "-o", "TARGET", teil])
        schon = (r0.stdout or "").strip().splitlines()
        if schon and os.path.isdir(schon[0]):
            sag(f"  war schon eingehaengt: {schon[0]}")
            return schon[0]

        r = _lauf(["udisksctl", "mount", "-b", teil], frist=60)
        pfad = _pfad_aus_meldung(r.stdout) or _pfad_aus_meldung(r.stderr)
        if pfad:
            return pfad
        sag("  " + (r.stderr or r.stdout or "ohne Meldung").strip()[:200])
        return None
    if ist_mac():
        teil = geraet + "s1"
        r = _lauf(["diskutil", "mount", teil], frist=60)
        m = re.search(r"on (.+?)$", (r.stdout or "").strip())
        if m:
            # diskutil nennt den NAMEN, der Pfad ist /Volumes/<Name>
            pfad = os.path.join("/Volumes", m.group(1).strip())
            return pfad if os.path.isdir(pfad) else None
        sag((r.stderr or r.stdout or "").strip()[:200])
        return None
    if ist_windows():
        # Windows haengt FAT-Partitionen von selbst ein. Gesucht wird das
        # Laufwerk, auf dem DietPis Kennzeichen liegt — der Buchstabe wechselt.
        import string
        for b in string.ascii_uppercase:
            p = f"{b}:\\"
            if os.path.isfile(os.path.join(p, "dietpi.txt")) or \
               os.path.isfile(os.path.join(p, "config.txt")):
                return p
        sag("Keine Boot-Partition gefunden — Karte kurz abziehen und neu einstecken.")
        return None
    return None


def boot_aushaengen(pfad, melden=None):
    """Sauber trennen, damit alles wirklich auf der Karte steht."""
    if not pfad:
        return
    if ist_linux():
        _lauf(["udisksctl", "unmount", "-p",
               os.path.basename(pfad)]) if False else _lauf(["sync"])
        _lauf(["udisksctl", "unmount", "-b", _linux_partition_zu(pfad)], frist=60)
    elif ist_mac():
        _lauf(["diskutil", "unmount", pfad], frist=60)
    else:
        # Windows: nur die Puffer leeren; ausgeworfen wird von Hand.
        pass


def _linux_partition_zu(mountpfad):
    """Vom Mountpunkt zurueck auf das Geraet — ohne Raten, ueber findmnt."""
    r = _lauf(["findmnt", "-n", "-o", "SOURCE", "--target", mountpfad])
    return (r.stdout or "").strip() or mountpfad


def rechte_hinweis():
    """Was der Benutzer braucht, um schreiben zu duerfen — je System anders."""
    if ist_windows():
        return ("Der Installer muss ALS ADMINISTRATOR laufen. "
                "Rechtsklick auf die Verknuepfung → »Als Administrator ausfuehren«.")
    if ist_mac():
        return ("Zum Schreiben fragt macOS nach deinem Passwort "
                "(die Karte wird als Rohgeraet beschrieben).")
    return ("Zum Schreiben werden Rechte gebraucht — je nach System fragt "
            "pkexec oder sudo danach.")


# ── Selbstauskunft: was sieht dieses System gerade? ────────────────────────
def lage_zeigen():
    """Aufruf: `python3 controller/geraete.py`

    WOZU: Wenn der Assistent "Boot-Partition nicht gefunden" sagt, sind zwei
    ganz verschiedene Dinge moeglich — die Karte steckt nicht (dann ist die
    Meldung nur eine Folge), oder sie steckt und das Einhaengen klemmt. Ohne
    diese Auskunft raet man zwischen beiden, und zwar meist falsch herum.
    """
    print(f"System: {SYSTEM}")
    ok, blockiert = karten_finden()
    print(f"\nVerwendbare Karten: {len(ok)}")
    for k in ok:
        print(f"  + {k['pfad']:20s} {k['groesse']:>8s}  {k['modell'] or '(ohne Namen)'}")
    print(f"\nAusgeschlossen: {len(blockiert)}")
    for b in blockiert:
        print(f"  - {b['pfad']:20s} {b['groesse']:>8s}  {b['grund']}")
    if not ok:
        print("\nKEINE KARTE GEFUNDEN. Das ist der haeufigste Fall, und er hat")
        print("meist eine einfache Ursache:")
        print("  * Karte steckt nicht (oder nicht ganz) im Leser")
        print("  * der Leser selbst haengt nicht am Rechner")
        print("  * ein USB-Leser braucht manchmal einen anderen Anschluss")
        print("Danach: im Assistenten »Neu suchen«.")
    if ist_linux():
        for prog in ("lsblk", "udisksctl", "findmnt", "partprobe"):
            import shutil as _s
            if not _s.which(prog):
                print(f"\nFEHLT: {prog} — ohne es geht das Einhaengen nicht.")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys as _sys
    _sys.exit(lage_zeigen())
