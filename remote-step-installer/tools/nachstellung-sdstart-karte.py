#!/usr/bin/env python3
"""Stellt nach, WAS sdstart.py wirklich auf die Boot-Partition schreibt.

Ruft sdprep.prepare_boot mit exakt den Argumenten aus sdstart.py:1366-1372
auf (password, hostname, wifi, ssh_pubkey, debug_display=True, bildname) —
also OHNE bake_agent, OHNE handy, OHNE lauf_paket, OHNE diagnose — und listet,
was danach im Zielordner liegt.

Zum Vergleich laeuft derselbe Aufruf ein zweites Mal mit handy=True und
lauf_paket=True (der Weg, den sdgui.py/tui_sd.py anbieten).

    python3 tools/nachstellung-sdstart-karte.py [zielordner] [--vorlage ORDNER]

`--vorlage` legt vor jedem Lauf die Dateien einer ECHTEN DietPi-Boot-Partition
ins Ziel (dietpi.txt, cmdline.txt, config.txt). Ohne sie laeuft die
Nachstellung auf einem leeren Ordner — dann fehlt cmdline.txt, weil
prepare_boot sie nur AENDERT und nie anlegt (sdprep.py:1224).

So kommt man ohne root an die Vorlage (Boot-Partition = erste Partition):

    xz -dc ~/.rsi/images/DietPi_RPi5-ARMv8-Trixie.img.xz | head -c 400000000 > kopf.img
    fdisk -l kopf.img                       # Startsektor der FAT32-Partition
    mcopy -i kopf.img@@1048576 ::/dietpi.txt ::/cmdline.txt ::/config.txt vorlage/

Schreibt nur in den Zielordner. Ruehrt keine Karte an.
"""
import os
import shutil
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
sys.path.insert(0, os.path.join(WURZEL, "controller"))
import sdprep  # noqa: E402

PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITEST nachstellung@test"


def lauf(ziel, vorlage=None, **extra):
    os.makedirs(ziel, exist_ok=True)
    if vorlage:
        for d in sorted(os.listdir(vorlage)):
            q = os.path.join(vorlage, d)
            if os.path.isfile(q):
                shutil.copy2(q, os.path.join(ziel, d))
        print(f"  Vorlage eingelegt aus {vorlage}")
    gemeldet = sdprep.prepare_boot(
        ziel,
        password="pw",
        hostname="mixpi",
        wifi={"ssid": "Netz", "key": "geheim123"},
        ssh_pubkey=PUBKEY,
        debug_display=True,
        bildname="DietPi_RPi5-ARMv8-Trixie.img.xz",
        **extra,
    )
    print("  gemeldet:")
    for z in gemeldet:
        print(f"    - {z}")
    print("  liegt danach im Ordner:")
    for wurzel, _dirs, dateien in os.walk(ziel):
        rel = os.path.relpath(wurzel, ziel)
        for d in sorted(dateien):
            p = os.path.join(wurzel, d)
            name = d if rel == "." else os.path.join(rel, d)
            print(f"    {name:<44} {os.path.getsize(p):>10} B")


def main():
    argv = sys.argv[1:]
    vorlage = None
    if "--vorlage" in argv:
        i = argv.index("--vorlage")
        vorlage = argv[i + 1]
        del argv[i:i + 2]
    basis = argv[0] if argv else tempfile.mkdtemp(prefix="nachstellung-")
    print(f"Zielbasis: {basis}\n")
    print("== A) genau wie sdstart.py:1366 (Ein-Knopf-Assistent) ==")
    lauf(os.path.join(basis, "a-sdstart"), vorlage=vorlage)
    print()
    print("== B) zum Vergleich: handy=True, lauf_paket=True (sdgui/tui_sd) ==")
    lauf(os.path.join(basis, "b-handy-lauf"), vorlage=vorlage,
         handy=True, lauf_paket=True)


if __name__ == "__main__":
    main()
