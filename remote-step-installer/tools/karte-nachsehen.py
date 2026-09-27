#!/usr/bin/env python3
"""Was steht wirklich auf dieser Karte — und was ist beim letzten Start passiert?

WOZU: Wenn eine Box beim ersten Start scheitert, gibt es zwei ganz
verschiedene Fragen, und man verwechselt sie leicht:

    1. Ist ueberhaupt drauf, was drauf sein soll?
    2. Wenn ja — wie weit ist sie gekommen?

Die erste beantwortet die BOOT-Partition (die kann jeder Rechner lesen, sie
ist FAT). Die zweite die ROOT-Partition, auf der die Protokolle liegen.
Beides ohne Box, ohne Tastatur, ohne Netz — man braucht nur die Karte.

AUFRUF
    python3 tools/karte-nachsehen.py                 # Karte selbst finden
    python3 tools/karte-nachsehen.py /run/media/…    # oder Pfad angeben
"""
import os
import re
import subprocess
import sys

# Was auf einer fertig vorbereiteten Karte liegen MUSS, und wofuer es steht.
ERWARTET = [
    ("dietpi.txt", "DietPis Grundeinstellungen"),
    ("Automation_Custom_Script.sh", "Agent nach der Erstinstallation"),
    ("einrichtung/vorstart", "Start OHNE NETZ (kommt auf die Root-Partition)"),
    ("step-agent/agent.py", "der Agent selbst"),
    ("einrichtung", "Schirm, eigenes WLAN, Python-Pakete"),
]


def boot_finden():
    """Eine eingehaengte DietPi-Boot-Partition suchen."""
    try:
        r = subprocess.run(["findmnt", "-rn", "-o", "TARGET,FSTYPE"],
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    for zeile in (r.stdout or "").splitlines():
        teile = zeile.split()
        if len(teile) >= 2 and teile[1] in ("vfat", "msdos") and \
                os.path.isfile(os.path.join(teile[0], "dietpi.txt")):
            return teile[0]
    return None


def zeigen(pfad):
    print(f"Boot-Partition: {pfad}\n")
    fehlt = []
    for name, wofuer in ERWARTET:
        p = os.path.join(pfad, name)
        da = os.path.exists(p)
        groesse = ""
        if da and os.path.isfile(p):
            groesse = f"  ({os.path.getsize(p) // 1024} kB)"
        elif da and os.path.isdir(p):
            groesse = f"  ({len(os.listdir(p))} Dateien)"
        print(f"  {'✓' if da else '✗'} {name:34s}{groesse}")
        print(f"      {wofuer}")
        if not da:
            fehlt.append(name)

    e = os.path.join(pfad, "einrichtung")
    if os.path.isdir(e):
        debs = [d for d in os.listdir(e) if d.endswith(".deb")]
        print(f"\n  Python-Pakete auf der Karte: {len(debs)}")
        for d in sorted(debs):
            print(f"    · {d}")
        if not debs:
            print("    KEINE — ohne sie gibt es keinen Start ohne Netz.")
        if os.path.isfile(os.path.join(e, "lauf.tar.gz")):
            mb = os.path.getsize(os.path.join(e, "lauf.tar.gz")) / 1e6
            print(f"  Installationspaket: {mb:.0f} MB (Lauf ohne PC)")

    # Was der letzte Start hinterlassen hat — die Diagnose schreibt hierher.
    for spur, was in [("wifi-diagnose.txt", "WLAN-Selbstdiagnose der Box")]:
        p = os.path.join(pfad, spur)
        if os.path.isfile(p):
            print(f"\n  {spur} liegt vor ({os.path.getsize(p) // 1024} kB) — {was}")

    print()
    if "einrichtung/vorstart" in fehlt:
        print("DIESE KARTE KANN NICHT OHNE NETZ STARTEN.")
        print("  Der Vorstart fehlt — sie wurde vor dem 08.08.2026 geschrieben")
        print("  oder ohne den Haken »Einrichtung per Handy«.")
        print("  Neu schreiben: ./sdgui  (oder ./sdtui), beide Haken setzen.")
        return 1
    print("Hinweis: ob der Vorstart-DIENST wirklich eingeschaltet ist, steht")
    print("  auf der ROOT-Partition (/etc/systemd/system/multi-user.target.")
    print("  wants/mixpibox-vorstart.service) — hier ist nur zu sehen, dass")
    print("  die Dateien dafuer bereitliegen.")
    if not fehlt:
        print("Vollstaendig. Diese Karte bringt alles mit, auch fuer den Start ohne Netz.")
        return 0
    print(f"UNVOLLSTAENDIG: {', '.join(fehlt)}")
    return 1


def root_pruefen(bootpfad):
    """Die ROOT-Partition ansehen — dort entscheidet sich alles.

    WARUM DAS NOETIG IST: Auf der Boot-Partition liegt nur die Bereitschaft
    (Dateien im Ordner `vorstart/`). Ob der Dienst wirklich EINGESCHALTET ist,
    steht auf der Root-Partition — und das ist der Unterschied zwischen einer
    Karte, die ohne Netz startet, und einer, die es nicht tut.
    """
    # Von /run/media/…/bootfs auf das Geraet und dann auf Partition 2.
    try:
        r = subprocess.run(["findmnt", "-n", "-o", "SOURCE", "--target", bootpfad],
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return
    quelle = (r.stdout or "").strip()
    if not quelle:
        return
    root_teil = re.sub(r"(p?)1$", r"\g<1>2", quelle)
    if root_teil == quelle or not os.path.exists(root_teil):
        return

    print(f"\nRoot-Partition: {root_teil}")
    r2 = subprocess.run(["findmnt", "-n", "-o", "TARGET", root_teil],
                        capture_output=True, text=True)
    mp = (r2.stdout or "").strip().splitlines()
    if not mp or not os.path.isdir(mp[0]):
        print("  nicht eingehaengt — so ist der Vorstart nicht pruefbar.")
        print(f"  Einhaengen:  udisksctl mount -b {root_teil}")
        print("  (danach dieses Werkzeug noch einmal aufrufen)")
        return
    wurzel = mp[0]

    unit = os.path.join(wurzel, "etc/systemd/system/mixpibox-vorstart.service")
    an = os.path.join(wurzel,
                      "etc/systemd/system/multi-user.target.wants/"
                      "mixpibox-vorstart.service")
    skript = os.path.join(wurzel, "opt/mixpibox-einrichtung/vorstart.sh")
    print(f"  {'✓' if os.path.isfile(unit) else '✗'} Unit liegt da")
    print(f"  {'✓' if os.path.islink(an) or os.path.isfile(an) else '✗'} "
          f"Dienst EINGESCHALTET (Symlink in multi-user.target.wants)")
    print(f"  {'✓' if os.path.isfile(skript) else '✗'} vorstart.sh")
    if os.path.isdir(os.path.dirname(skript)):
        debs = [d for d in os.listdir(os.path.dirname(skript)) if d.endswith(".deb")]
        print(f"  {'✓' if debs else '✗'} Python-Pakete daneben ({len(debs)})")

    # Und was der letzte Start hinterlassen hat.
    log = os.path.join(wurzel, "var/log/mixpibox-vorstart.log")
    if os.path.isfile(log):
        print(f"\n  Der Vorstart IST GELAUFEN. Letzte Zeilen aus {log}:")
        with open(log, encoding="utf-8", errors="replace") as f:
            for z in f.read().splitlines()[-12:]:
                print(f"    {z}")
    else:
        print("\n  Kein Vorstart-Protokoll — der Dienst ist NIE GELAUFEN.")
        if os.path.isfile(an):
            print("    (er ist eingeschaltet; dann kam die Box gar nicht so weit,")
            print("     oder die Karte war noch nicht in der Box)")

    dp = os.path.join(wurzel, "var/lib/dietpi/logs/dietpi-firstrun-setup.log")
    if os.path.isfile(dp):
        print(f"\n  DietPis eigenes Protokoll, letzte Zeilen:")
        with open(dp, encoding="utf-8", errors="replace") as f:
            for z in f.read().splitlines()[-15:]:
                print(f"    {z}")


def main():
    pfad = sys.argv[1] if len(sys.argv) > 1 else boot_finden()
    if not pfad:
        print("Keine eingehaengte DietPi-Karte gefunden.")
        print("  Karte einstecken (der Schreibtisch haengt sie meist selbst ein),")
        print("  sonst den Pfad angeben: python3 tools/karte-nachsehen.py /pfad")
        return 2
    if not os.path.isdir(pfad):
        print(f"Kein Verzeichnis: {pfad}")
        return 2
    e = zeigen(pfad)
    root_pruefen(pfad)
    return e


if __name__ == "__main__":
    sys.exit(main())
