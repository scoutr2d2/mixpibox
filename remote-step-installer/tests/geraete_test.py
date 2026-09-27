#!/usr/bin/env python3
"""
Tests fuer die Geraete-Erkennung auf Linux, macOS und Windows.

WAS HIER AUF DEM SPIEL STEHT: Ein falsch eingestuftes Geraet loescht die
Platte, auf der jemand gerade arbeitet. Das ist der einzige Fehler in diesem
ganzen Projekt, der nicht zu reparieren ist — eine kaputte Installation baut
man neu, verlorene Daten nicht.

Deshalb wird hier nicht geprueft, ob die Erkennung "funktioniert", sondern ob
sie die SYSTEMPLATTE unter allen Umstaenden aussortiert — auch dann, wenn sie
sich wie ein Wechseldatentraeger meldet. Die Eingaben sind aufgezeichnete
Ausgaben der drei Systeme; so laeuft der Test ueberall, auch auf dem falschen.

  python3 tests/geraete_test.py
"""
import importlib.util
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok = bad = 0


def pruefe(bedingung, was, hinweis=""):
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


spec = importlib.util.spec_from_file_location(
    "geraete", os.path.join(REPO, "controller", "geraete.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

print("── 1. Linux: die Systemplatte darf NIE angeboten werden")
LINUX = {"blockdevices": [
    {"name": "nvme0n1", "path": "/dev/nvme0n1", "size": "1T", "type": "disk",
     "rm": False, "hotplug": False, "tran": "nvme",
     "children": [{"name": "nvme0n1p2", "mountpoints": ["/"]}]},
    {"name": "sdb", "path": "/dev/sdb", "size": "29,7G", "type": "disk",
     "rm": True, "hotplug": True, "tran": "usb", "model": "SD Card Reader",
     "mountpoints": [None]},
    {"name": "sda", "path": "/dev/sda", "size": "4T", "type": "disk",
     "rm": False, "hotplug": False, "tran": "sata", "model": "Archiv",
     "mountpoints": [None]},
    {"name": "mmcblk0", "path": "/dev/mmcblk0", "size": "15G", "type": "disk",
     "rm": False, "hotplug": True, "tran": "mmc", "model": "SD16G"},
]}
frei, blockiert = g.linux_auswerten(LINUX)
pfade = [x["pfad"] for x in frei]
gesperrt = {x["pfad"]: x["grund"] for x in blockiert}
pruefe("/dev/nvme0n1" not in pfade, "die Systemplatte ist NICHT waehlbar")
pruefe(gesperrt.get("/dev/nvme0n1") == "System liegt darauf",
       "  und der Grund steht dabei", str(gesperrt))
pruefe("/dev/sdb" in pfade, "der USB-Kartenleser ist waehlbar")
pruefe("/dev/mmcblk0" in pfade, "der eingebaute Kartenleser auch (tran=mmc)")
pruefe("/dev/sda" not in pfade, "die interne Datenplatte NICHT (kein Wechselmedium)")
pruefe(gesperrt.get("/dev/sda") == "kein Wechseldatentraeger",
       "  auch hier mit Grund")

# Der gefaehrlichste Fall ueberhaupt: eine Platte, die WECHSELBAR aussieht und
# trotzdem das System traegt (externe SSD, von der gebootet wurde). Das
# Wechsel-Merkmal darf den Systemschutz NIE ueberstimmen.
TUECKISCH = {"blockdevices": [
    {"name": "sdc", "path": "/dev/sdc", "size": "500G", "type": "disk",
     "rm": True, "hotplug": True, "tran": "usb", "model": "Externe SSD",
     "children": [{"name": "sdc1", "mountpoints": ["/boot/firmware"]},
                  {"name": "sdc2", "mountpoints": ["/home"]}]},
]}
frei2, blockiert2 = g.linux_auswerten(TUECKISCH)
pruefe(not frei2, "eine WECHSELBARE Platte mit dem System darauf bleibt gesperrt",
       "Wechsel-Merkmal darf den Systemschutz nicht ueberstimmen")
pruefe(blockiert2 and blockiert2[0]["grund"] == "System liegt darauf",
       "  und nennt den richtigen Grund")

print("\n── 2. macOS: intern ist nicht gleich Systemplatte")
MAC = {
    "_systemdisk": "disk0",
    "AllDisksAndPartitions": [
        {"DeviceIdentifier": "disk0", "Size": 994662584320, "Internal": True,
         "MediaName": "APPLE SSD",
         "Partitions": [{"MountPoint": "/"}]},
        {"DeviceIdentifier": "disk4", "Size": 31914983424, "Internal": False,
         "RemovableMedia": True, "MediaName": "SDXC Card", "Partitions": []},
        {"DeviceIdentifier": "disk2", "Size": 2000398934016, "Internal": True,
         "MediaName": "Time Machine", "Partitions": []},
    ]}
frei, blockiert = g.mac_auswerten(MAC)
pfade = [x["pfad"] for x in frei]
gesperrt = {x["pfad"]: x["grund"] for x in blockiert}
pruefe("/dev/disk0" not in pfade, "die Startplatte ist NICHT waehlbar")
pruefe("/dev/disk4" in pfade, "die SD-Karte im Leser ist waehlbar")
pruefe("/dev/disk2" not in pfade, "die interne Zweitplatte NICHT")
pruefe(gesperrt.get("/dev/disk2") == "interner Datentraeger", "  mit Grund")

print("\n── 3. Windows: IsBoot/IsSystem schlagen alles")
WIN = [
    {"Number": 0, "FriendlyName": "Samsung SSD 980", "Size": 1000204886016,
     "BusType": 17, "IsBoot": True, "IsSystem": True},
    {"Number": 1, "FriendlyName": "Generic MassStorageClass", "Size": 31914983424,
     "BusType": 7, "IsBoot": False, "IsSystem": False},
    {"Number": 2, "FriendlyName": "Seagate Backup", "Size": 4000787030016,
     "BusType": 7, "IsBoot": False, "IsSystem": False},
]
frei, blockiert = g.windows_auswerten(WIN)
pfade = [x["pfad"] for x in frei]
pruefe(r"\\.\PhysicalDrive0" not in pfade, "die Startplatte ist NICHT waehlbar")
pruefe(r"\\.\PhysicalDrive1" in pfade, "der USB-Kartenleser ist waehlbar")
pruefe(blockiert and blockiert[0]["grund"] == "System liegt darauf",
       "  und der Grund steht dabei")

# PowerShell liefert bei EINER Platte kein Array, sondern ein einzelnes
# Objekt. Wer das nicht abfaengt, bekommt eine Ausnahme statt einer Liste —
# und zwar genau auf dem Rechner, der nur eine Platte hat.
frei3, blockiert3 = g.windows_auswerten(WIN[0])
pruefe(not frei3 and len(blockiert3) == 1,
       "ein EINZELNES Objekt (nur eine Platte) wird auch verstanden")

print("\n── 4. Leeres und Kaputtes stuerzt nicht ab")
for eingabe, name in [(None, "None"), ({}, "leeres dict"),
                      ({"blockdevices": []}, "keine Geraete")]:
    a, b = g.linux_auswerten(eingabe)
    pruefe(a == [] and b == [], f"  Linux: {name}")
for eingabe, name in [(None, "None"), ({}, "leer")]:
    a, b = g.mac_auswerten(eingabe)
    pruefe(a == [] and b == [], f"  macOS: {name}")
for eingabe, name in [(None, "None"), ([], "leere Liste")]:
    a, b = g.windows_auswerten(eingabe)
    pruefe(a == [] and b == [], f"  Windows: {name}")

print("\n── 5. Der Schreibbefehl")
befehl = g.schreib_befehl("/pfad/mit leerzeichen/DietPi.img.xz", "/dev/sdb")
pruefe(isinstance(befehl, list), "kommt als Liste, nicht als Zeichenkette")
if not g.ist_windows():
    text = " ".join(befehl)
    pruefe("'/pfad/mit leerzeichen/DietPi.img.xz'" in text,
           "Leerzeichen im Pfad werden zitiert (sonst zwei Argumente)")
    pruefe("conv=fsync" in text,
           "conv=fsync — sonst steht die Karte beim Abziehen halb leer da")
    pruefe("of='/dev/sdb'" in text, "das Ziel steht drin")

print("\n── 6. Der Hinweis auf die noetigen Rechte passt zum System")
h = g.rechte_hinweis()
pruefe(bool(h) and len(h) > 20, "es gibt einen Hinweis")
if g.ist_windows():
    pruefe("Administrator" in h, "Windows: nennt den Administrator")
elif g.ist_mac():
    pruefe("Passwort" in h, "macOS: nennt die Passwortabfrage")
else:
    pruefe("pkexec" in h or "sudo" in h, "Linux: nennt pkexec/sudo")

print("\n── 7. Den Mountpunkt aus der udisksctl-Meldung lesen")
# HIER IST ES AM GERAET GESCHEITERT: "Boot-Partition nicht gefunden", obwohl
# sie eingehaengt war. Der Schreibtisch mountet die frische Partition von
# selbst, sobald sie auftaucht — udisksctl meldet das dann als FEHLER
# ("AlreadyMounted"), und der Pfad steht darin in BACKTICKS. Wer stumpf hinter
# "at" schneidet, bekommt `/run/media/…` samt Zeichen zurueck und schreibt
# danach ins Leere.
import tempfile
with tempfile.TemporaryDirectory() as echt:
    faelle = [
        (f"Mounted /dev/sdb1 at {echt}.", echt, "Normalfall, mit Punkt am Ende"),
        (f"Mounted /dev/mmcblk0p1 at {echt}", echt, "Normalfall ohne Punkt"),
        (f"Error mounting /dev/sdb1: GDBus.Error:org.freedesktop.UDisks2."
         f"Error.AlreadyMounted: Device /dev/sdb1 is already mounted at "
         f"`{echt}`.", echt, "schon eingehaengt — Fehler, aber Erfolg"),
        ("Error mounting /dev/sdb1: GDBus.Error:...Failed: keine Ahnung",
         None, "echter Fehlschlag"),
        ("", None, "leere Ausgabe"),
        ("Mounted /dev/sdb1 at /gibt/es/nicht/99.", None,
         "genannter Pfad existiert nicht"),
    ]
    for text, erwartet, was in faelle:
        pruefe(g._pfad_aus_meldung(text) == erwartet, f"  {was}",
               f"bekam: {g._pfad_aus_meldung(text)!r}")


print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
