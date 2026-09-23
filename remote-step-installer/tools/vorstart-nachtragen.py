#!/usr/bin/env python3
"""Den Vorstart-Dienst auf einer SCHON geschriebenen Karte nachtragen.

WOZU: Das Bestuecken der Root-Partition braucht Rechte. Wird die Passwort-
abfrage weggeklickt oder erscheint sie gar nicht, ist die Karte fertig — nur
der Dienst fehlt, und die Box startet dann nicht ohne Netz. Die Karte deswegen
20 Minuten neu zu beschreiben waere Unfug: es fehlen 13 Dateien und ein
Symlink.

WAS ES TUT
  1. die eingehaengte DietPi-Karte finden (Boot- und Root-Partition)
  2. den Inhalt von `einrichtung/vorstart` nach /opt/mixpibox-einrichtung legen
  3. die Unit setzen und einschalten (Symlink in multi-user.target.wants)

AUFRUF
    sudo python3 tools/vorstart-nachtragen.py
"""
import os
import re
import shutil
import subprocess
import sys


def finden():
    """(boot, root) der eingehaengten DietPi-Karte — oder (None, None)."""
    try:
        r = subprocess.run(["findmnt", "-rn", "-o", "TARGET,SOURCE,FSTYPE"],
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None, None
    boot = boot_quelle = None
    for zeile in (r.stdout or "").splitlines():
        t = zeile.split()
        if len(t) >= 3 and t[2] in ("vfat", "msdos") and \
                os.path.isfile(os.path.join(t[0], "dietpi.txt")):
            boot, boot_quelle = t[0], t[1]
            break
    if not boot:
        return None, None
    root_quelle = re.sub(r"(p?)1$", r"\g<1>2", boot_quelle)
    for zeile in (r.stdout or "").splitlines():
        t = zeile.split()
        if len(t) >= 2 and t[1] == root_quelle:
            return boot, t[0]
    return boot, None


def auffrischen(quelle):
    """Den Code auf der Karte auf den STAND DIESES REPOS heben.

    WARUM NICHT NUR KOPIEREN: Frueher reichte dieses Werkzeug weiter, was
    ohnehin schon auf der Karte lag — bei einer Behebung im Repo half es
    also genau nichts, und die Karte musste 20 Minuten lang neu geschrieben
    werden. Seit dem 09.08.2026 (Vorstart gab bei schwachem WLAN auf und
    liess die Box auf der Login-Maske stehen) ist das der Regelfall: der
    Code aendert sich, die Pakete und Bilder auf der Karte nicht.

    Angefasst wird deshalb nur, was aus dem Repo kommt — .deb-Pakete, der
    Controller-Schluessel und die Bilder bleiben unberuehrt.
    """
    hier = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.join(hier, "controller"))
    try:
        import sdprep
    except ImportError as e:
        print(f"  (nicht aufgefrischt: {e})")
        return 0

    neu = 0
    ziel = os.path.join(quelle, "vorstart.sh")
    text = sdprep.vorstart_skript()
    alt = ""
    if os.path.isfile(ziel):
        with open(ziel, encoding="utf-8", errors="replace") as f:
            alt = f.read()
    if text != alt:
        with open(ziel, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(ziel, 0o755)
        neu += 1
        print("  vorstart.sh neu erzeugt")

    for datei in sorted(os.listdir(quelle)):
        if datei == "vorstart.sh" or datei.endswith((".deb", ".png", ".pub")):
            continue
        for ordner in ("tools", "agent"):
            q = os.path.join(hier, ordner, datei)
            if not os.path.isfile(q):
                continue
            z = os.path.join(quelle, datei)
            with open(q, "rb") as a, open(z, "rb") as b:
                if a.read() == b.read():
                    break
            shutil.copy2(q, z)
            neu += 1
            print(f"  {datei} aufgefrischt (aus {ordner}/)")
            break
    if not neu:
        print("  Karte war schon auf dem aktuellen Stand")
    return neu


def main():
    if os.geteuid() != 0:
        print("Als root starten:  sudo python3 tools/vorstart-nachtragen.py",
              file=sys.stderr)
        return 2
    boot, root = finden()
    if not boot:
        print("Keine eingehaengte DietPi-Karte gefunden.")
        return 2
    if not root:
        print(f"Boot gefunden ({boot}), aber die Root-Partition ist nicht "
              f"eingehaengt.\n  udisksctl mount -b /dev/sdX2   (dann noch einmal)")
        return 2
    quelle = os.path.join(boot, "einrichtung", "vorstart")
    if not os.path.isdir(quelle):
        print(f"Auf dieser Karte liegt kein vorstart/ ({quelle}).")
        print("  Sie wurde ohne den Haken »Einrichtung per Handy« geschrieben")
        print("  oder mit einer aelteren Fassung. Dann hilft nur neu schreiben.")
        return 1

    # ERST AUFFRISCHEN, DANN VERTEILEN — sonst traegt man die alte Fassung
    # bloss an einen zweiten Ort.
    auffrischen(quelle)

    ziel = os.path.join(root, "opt/mixpibox-einrichtung")
    os.makedirs(ziel, exist_ok=True)
    anzahl = 0
    for d in os.listdir(quelle):
        shutil.copy2(os.path.join(quelle, d), os.path.join(ziel, d))
        anzahl += 1
    for d in os.listdir(ziel):
        p = os.path.join(ziel, d)
        os.chown(p, 0, 0)
        if d.endswith((".py", ".sh")):
            os.chmod(p, 0o755)
    os.chown(ziel, 0, 0)
    print(f"  {anzahl} Dateien nach /opt/mixpibox-einrichtung")

    unit_q = os.path.join(ziel, "mixpibox-vorstart.service")
    if not os.path.isfile(unit_q):
        print("  FEHLT: mixpibox-vorstart.service — Karte neu schreiben.")
        return 1
    unit_z = os.path.join(root, "etc/systemd/system/mixpibox-vorstart.service")
    shutil.copy2(unit_q, unit_z)
    os.chown(unit_z, 0, 0)
    os.chmod(unit_z, 0o644)

    # DAS EINSCHALTEN IST DER SYMLINK. `systemctl enable` geht auf einer
    # fremden Wurzel nicht — genau das aber tut es.
    wants = os.path.join(root, "etc/systemd/system/multi-user.target.wants")
    os.makedirs(wants, exist_ok=True)
    link = os.path.join(wants, "mixpibox-vorstart.service")
    if os.path.islink(link) or os.path.exists(link):
        os.remove(link)
    os.symlink("../mixpibox-vorstart.service", link)
    print("  Unit gesetzt und EINGESCHALTET")

    subprocess.run(["sync"])
    print("\nFertig. Karte aushaengen, in die Box, Strom dran.")
    print("  Ohne Netz macht die Box jetzt ihr eigenes WLAN auf und zeigt")
    print("  einen QR-Code auf ihrem Bildschirm.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
