#!/usr/bin/env python3
"""Nachmessen: Was kostet der VORSCHLAG „alles mit size==0 nach `blockiert`"?

WOZU DIESES WERKZEUG
Belegt ist (tests/leerer_schacht_probe.py): der LEERE Schacht des
Mehrfachlesers meldet sich als eigenes Blockgeraet mit 0 Byte und landet im
Angebot — daher „2 Wechseldatentraeger gefunden".  Vorgeschlagen wurde, die
Groesse mit `lsblk -b` als ZAHL zu holen und alles mit size==0 nach
`blockiert` zu legen (Grund: „leerer Schacht — keine Karte drin"), spaeter
zusaetzlich gleiche HCTL zusammenzufassen.

Diese Probe behauptet nichts, sie MISST, was der Vorschlag ausserdem trifft:

  1  GEWINN      derselbe aufgezeichnete Fund, einmal ohne und einmal mit
                 Filter — bleibt wirklich genau EIN Geraet uebrig?
  2  FEHLALARM   eine ECHTE Karte, die 0 B meldet (Karte in den schon
                 steckenden Leser geschoben; ohne Neubewertung bleibt
                 /sys/block/sdX/size auf 0).  Was steht dann am Schirm?
                 Gemessen an der laufenden Oberflaeche, nicht gelesen.
  3  ANZEIGE     `lsblk -b` liefert `size` als ZAHL. `groesse` wird
                 unveraendert auf den Schirm gelegt (sdstart.py:512/794,
                 sdgui.py:251/286) und mit `:>8s` formatiert
                 (geraete.py:433). Was passiert damit?
  4  TESTS       die aufgezeichneten Vorlagen (tests/geraete_test.py,
                 tests/leerer_schacht_probe.py) enthalten Groessen als TEXT.
                 Bleiben sie gruen, waehrend der echte Weg schon anders ist?
  5  ANDERE      Windows und macOS: greift der Vorschlag dort ueberhaupt?
  6  HCTL        der zweite Teil des Vorschlags: welchen Schluessel haben
                 Geraete OHNE SCSI-Adresse (mmc, nvme)?

Es wird nichts geschrieben und nichts geladen: reine Auswerter auf
aufgezeichneten Daten, die Oberflaeche im Trockenmodus mit Pfaden, die es
nicht gibt.

AUFRUF
    xvfb-run -a python3 tools/leerer-schacht-filter-probe.py
Ende 0 = der Vorschlag ist ohne Nebenwirkung. Ende 1 = er trifft etwas.
"""
import importlib.util
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTRL = os.path.join(REPO, "remote-step-installer", "controller")
sys.path.insert(0, CTRL)

spec = importlib.util.spec_from_file_location("geraete", os.path.join(CTRL, "geraete.py"))
geraete = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geraete)

treffer = []          # was der Vorschlag ausser dem leeren Schacht trifft


def merken(text):
    treffer.append(text)
    print(f"    !! {text}")


# ── Der Vorschlag als Patch ────────────────────────────────────────────────
def mit_filter(lsblk):
    """`linux_auswerten` + „size==0 -> blockiert" — so, wie vorgeschlagen."""
    ok, blockiert = geraete.linux_auswerten(lsblk)
    behalten = []
    for k in ok:
        if _null(k["groesse"]):
            k = dict(k, grund="leerer Schacht — keine Karte drin")
            blockiert.append(k)
        else:
            behalten.append(k)
    return behalten, blockiert


def _null(groesse):
    """0 erkennen — egal ob `lsblk -b` (Zahl) oder ohne (Text wie '0B')."""
    if isinstance(groesse, (int, float)):
        return groesse == 0
    return str(groesse).strip() in ("0", "0B", "0K", "0 B")


# ── Aufgezeichnet am 10.08.2026, SABRENT-Mehrfachleser, zwei Schaechte ─────
FUND_TEXT = json.loads(r"""
{"blockdevices":[
  {"name":"sda","path":"/dev/sda","size":"238,3G","model":"MassStorageClass ",
   "tran":"usb","rm":true,"hotplug":true,"type":"disk","mountpoints":[null],
   "children":[{"name":"sda1","size":"128M","type":"part","mountpoints":[null]},
               {"name":"sda2","size":"238,2G","type":"part","mountpoints":[null]}]},
  {"name":"sdb","path":"/dev/sdb","size":"0B","model":"MassStorageClass ",
   "tran":"usb","rm":true,"hotplug":true,"type":"disk","mountpoints":[null]},
  {"name":"nvme0n1","path":"/dev/nvme0n1","size":"1,8T","model":"WD_BLACK",
   "tran":"nvme","rm":false,"hotplug":false,"type":"disk","mountpoints":[null],
   "children":[{"name":"nvme0n1p2","mountpoints":["/"]}]}
]}
""")

# DERSELBE Fund, wie ihn `lsblk -b` liefern wuerde: `size` als ZAHL.
# (Nachgemessen mit `lsblk -b -J` auf diesem Rechner: aus "1,8T" wird
#  2000398934016, aus "15G" wird 16127098880 — die Spalte kippt fuer ALLE
#  Geraete auf Bytes, nicht nur fuer das eine, das man messen wollte.)
FUND_BYTES = json.loads(r"""
{"blockdevices":[
  {"name":"sda","path":"/dev/sda","size":255864700928,"model":"MassStorageClass ",
   "tran":"usb","rm":true,"hotplug":true,"type":"disk","mountpoints":[null],
   "children":[{"name":"sda1","size":134217728,"type":"part","mountpoints":[null]},
               {"name":"sda2","size":255728484352,"type":"part","mountpoints":[null]}]},
  {"name":"sdb","path":"/dev/sdb","size":0,"model":"MassStorageClass ",
   "tran":"usb","rm":true,"hotplug":true,"type":"disk","mountpoints":[null]},
  {"name":"nvme0n1","path":"/dev/nvme0n1","size":2000398934016,"model":"WD_BLACK",
   "tran":"nvme","rm":false,"hotplug":false,"type":"disk","mountpoints":[null],
   "children":[{"name":"nvme0n1p2","mountpoints":["/"]}]}
]}
""")

# Die Karte steckt WIRKLICH, meldet aber 0 — der Leser steckte zuerst, die
# Karte kam danach; ohne Neubewertung bleibt die Groesse auf 0. EIN Geraet.
KARTE_NOCH_NULL = json.loads(r"""
{"blockdevices":[
  {"name":"sdb","path":"/dev/sdb","size":0,"model":"MassStorageClass ",
   "tran":"usb","rm":true,"hotplug":true,"type":"disk","mountpoints":[null]},
  {"name":"nvme0n1","path":"/dev/nvme0n1","size":2000398934016,"model":"WD_BLACK",
   "tran":"nvme","rm":false,"hotplug":false,"type":"disk","mountpoints":[null],
   "children":[{"name":"nvme0n1p2","mountpoints":["/"]}]}
]}
""")


def zeile(k):
    return f"{k['pfad']:14s} {str(k['groesse']):>14s}  {k.get('grund', '')}"


print("═══ 1  GEWINN: der aufgezeichnete Fund, ohne und mit Filter ═══")
ohne_ok, ohne_bl = geraete.linux_auswerten(FUND_BYTES)
mit_ok, mit_bl = mit_filter(FUND_BYTES)
print("  heute angeboten :", [k["pfad"] for k in ohne_ok])
print("  mit Filter      :", [k["pfad"] for k in mit_ok])
print("  mit Filter raus :", [f"{b['pfad']} ({b.get('grund')})" for b in mit_bl
                              if b["pfad"] == "/dev/sdb"])
if len(mit_ok) != 1:
    merken(f"der Filter laesst {len(mit_ok)} Geraete uebrig, nicht 1")
else:
    print("  ==> genau EIN Geraet uebrig. Der Ein-Knopf-Weg traegt hier wieder.")

print()
print("═══ 2  FEHLALARM: die Karte steckt und meldet trotzdem 0 B ═══")
print("  Lage: Leser steckte zuerst, Karte kam danach. EIN Blockgeraet, size=0.")
n_ok, n_bl = geraete.linux_auswerten(KARTE_NOCH_NULL)
p_ok, p_bl = mit_filter(KARTE_NOCH_NULL)
print("  heute angeboten :", [k["pfad"] for k in n_ok], "-> der Knopf ist scharf")
print("  mit Filter      :", [k["pfad"] for k in p_ok] or "NICHTS")
if not p_ok and n_ok:
    merken("die ECHTE Karte verschwindet aus dem Angebot")

# Und was sieht der Betreiber dann? An der Oberflaeche ablesen, nicht raten.
if os.environ.get("DISPLAY"):
    import sdstart
    f = sdstart.Fenster(board="RPi5", trocken=True, board_gesetzt=True)
    try:
        f.update()
        f.seite = 3
        f._seite_karte() if hasattr(f, "_seite_karte") else None
        f.update()
        f._karten_gesetzt(p_ok)          # genau das, was der Filter uebrig laesst
        f.update()
        gross, klein = f.l_karte.cget("text"), f.l_wo.cget("text")
        print(f"  Schirm gross    : {gross!r}")
        print(f"  Schirm klein    : {klein!r}")
        print(f"  Ziel des Knopfes: {f.karte['pfad'] if f.karte else None}")
        if "Keine SD-Karte" in gross:
            merken("der Schirm sagt »Keine SD-Karte gefunden« — obwohl sie steckt")
        # Steht der Grund irgendwo? sdstart nimmt nur gefunden[0].
        alle = []

        def sammeln(w):
            alle.append(w)
            for c in w.winfo_children():
                sammeln(c)
        sammeln(f)
        texte = []
        for w in alle:
            try:
                t = w.cget("text")
            except Exception:                        # noqa: BLE001
                t = ""
            if t:
                texte.append(str(t))
        if not any("Schacht" in t for t in texte):
            merken("der Grund »leerer Schacht« steht NIRGENDS am Schirm "
                   "(sdstart nimmt nur karten_finden()[0], `blockiert` wird verworfen)")
        klick = [t for t in texte if "zurück" in t.lower() or "wählen" in t.lower()]
        print(f"  Rueckweg/Auswahl am Schirm: {klick or 'keiner'}")
    finally:
        try:
            f.destroy()
        except Exception:                            # noqa: BLE001
            pass
else:
    print("  (ohne DISPLAY uebersprungen — mit `xvfb-run -a` aufrufen)")

print()
print("═══ 3  ANZEIGE: was `lsblk -b` mit der Groesse am Schirm macht ═══")
k = ohne_ok[0]
print(f"  geraete.py:79  groesse = {k['groesse']!r}   (Typ {type(k['groesse']).__name__})")
print(f"  sdstart.py:512 zeigt   : 'SD-Karte · {k['groesse']}'")
try:
    s = f"  geraete.py:433 formatiert: {k['pfad']:20s} {k['groesse']:>8s}"
    print(s)
except Exception as e:                               # noqa: BLE001
    merken(f"geraete.py:433 `{{k['groesse']:>8s}}` bricht ab: {type(e).__name__}: {e}")
alt = geraete.linux_auswerten(FUND_TEXT)[0][0]
print(f"  zum Vergleich heute    : 'SD-Karte · {alt['groesse']}'")
if isinstance(k["groesse"], int):
    merken("die Groesse steht als nackte Byte-Zahl am Schirm statt '238,3G'")

print()
print("═══ 4  TESTS: bleiben die aufgezeichneten Vorlagen gruen? ═══")
# Die reinen Auswerter sehen den Befehl NIE — `-b` steht in karten_finden().
# Also laufen die Vorlagen mit TEXT weiter, waehrend echt Zahlen kommen.
t_ok, _ = mit_filter(FUND_TEXT)
print("  Vorlage mit TEXT ('0B') durch den Filter:", [x["pfad"] for x in t_ok])
if len(t_ok) == 1:
    print("  (dieser Filter erkennt beide Formen — ein Filter, der nur `== 0`")
    print("   vergleicht, wuerde an der TEXT-Vorlage gruen bleiben und am")
    print("   echten Weg nichts filtern; genau anders herum ebenso.)")
nur_zahl = [x for x in geraete.linux_auswerten(FUND_TEXT)[0] if x["groesse"] != 0]
if len(nur_zahl) == 2:
    merken("ein `size == 0`-Vergleich laesst die TEXT-Vorlagen unveraendert gruen "
           "(tests/geraete_test.py, tests/leerer_schacht_probe.py) — der Test "
           "beweist dann nichts ueber den echten Weg")

print()
print("═══ 5  ANDERE SYSTEME: greift der Vorschlag dort? ═══")
WIN = [{"Number": 0, "FriendlyName": "Samsung SSD", "Size": 1000204886016,
        "BusType": 17, "IsBoot": True, "IsSystem": True},
       {"Number": 1, "FriendlyName": "Generic MassStorageClass", "Size": 31914983424,
        "BusType": 7, "IsBoot": False, "IsSystem": False},
       {"Number": 2, "FriendlyName": "Generic MassStorageClass", "Size": 0,
        "BusType": 7, "IsBoot": False, "IsSystem": False}]
w_ok, _ = geraete.windows_auswerten(WIN)
print("  Windows, zweiter Schacht (Size 0):", [f"{x['pfad']} {x['groesse']}" for x in w_ok])
if any(x["groesse"] == "0B" for x in w_ok):
    merken("Windows bietet den leeren Schacht WEITER an — `lsblk -b` fasst "
           "windows_auswerten nicht an (Hausregel: es muss auch unter Windows laufen)")
MAC = {"_systemdisk": "disk0", "AllDisksAndPartitions": [
    {"DeviceIdentifier": "disk0", "Size": 994662584320, "Internal": True,
     "Partitions": [{"MountPoint": "/"}]},
    {"DeviceIdentifier": "disk4", "Size": 31914983424, "Internal": False,
     "RemovableMedia": True, "MediaName": "SDXC Card", "Partitions": []},
    {"DeviceIdentifier": "disk5", "Size": 0, "Internal": False,
     "RemovableMedia": True, "MediaName": "SD Card Reader", "Partitions": []}]}
m_ok, _ = geraete.mac_auswerten(MAC)
print("  macOS, zweiter Schacht (Size 0) :", [f"{x['pfad']} {x['groesse']}" for x in m_ok])
if any(x["groesse"] == "0B" for x in m_ok):
    merken("macOS bietet den leeren Schacht ebenfalls weiter an")

print()
print("═══ 6  HCTL: welchen Schluessel haben Geraete ohne SCSI-Adresse? ═══")
import subprocess
r = subprocess.run(["lsblk", "-J", "-o", "NAME,HCTL,TRAN,TYPE"],
                   capture_output=True, text=True)
try:
    daten = json.loads(r.stdout)
except ValueError:
    daten = {"blockdevices": []}
ohne = []
for d in daten.get("blockdevices", []):
    if d.get("type") != "disk":
        continue
    print(f"  {d['name']:10s} hctl={d.get('hctl')!r:12s} tran={d.get('tran')!r}")
    if not d.get("hctl"):
        ohne.append(d["name"])
if len(ohne) > 1:
    merken(f"{len(ohne)} Geraete haben KEINE HCTL ({', '.join(ohne)}) — ein "
           "Gruppieren nach HCTL wirft sie alle in EINE Gruppe. "
           "Der eingebaute Kartenleser (tran=mmc) ist genau so einer und ist "
           "in tests/geraete_test.py ausdruecklich als waehlbar belegt")
elif ohne:
    print(f"  (nur eines ohne HCTL: {ohne[0]} — mit einem zweiten mmc/nvme-Geraet "
          "traefen sie sich im selben leeren Schluessel)")

print()
print("═══ GEGENPROBE: ohne den Patch aendert sich nichts ═══")
g_ok, _ = geraete.linux_auswerten(KARTE_NOCH_NULL)
print("  ungepatcht, Karte mit 0 B:", [x["pfad"] for x in g_ok])
if not g_ok:
    merken("Gegenprobe fehlgeschlagen: schon ohne Patch ist nichts da — "
           "dann misst diese Probe nicht den Patch")

print()
if treffer:
    print(f"ERGEBNIS: der Vorschlag trifft {len(treffer)} weitere Stelle(n):")
    for t in treffer:
        print("  -", t)
    sys.exit(1)
print("ERGEBNIS: keine Nebenwirkung gefunden.")
sys.exit(0)
