#!/usr/bin/env python3
"""Nachstellung des Rezept-Schritts `zram` (recipes/mupibox.yaml) — mit
Attrappen statt Box.

DER ANLASS (29.09.2026, AUDIT-2026-09-25 Rang 3): Die Assistenten-Karte
bekommt seit diesem Tag AUTO_SETUP_SWAPFILE_LOCATION=zram aus der
gemeinsamen Tabelle controller/mixpi-kartenschluessel.txt — DietPi richtet
dann schon beim Erstlauf SEIN zram ein. Der Schritt rief danach
`dietpi-set_swapfile 0`, und dieses Werkzeug tut mehr, als sein Name sagt
(nachgelesen im DietPi-Quelltext, Swap_Disable): `swapoff -a` — also JEDE
Auslagerung, auch zram — und es loescht DietPis zram-Regel
(/etc/udev/rules.d/98-dietpi-zram-swap.rules). Die Box haette ihre
Auslagerung fuer immer verloren. Und auf der heutigen Karte mit Datei-Swap
nahm dasselbe swapoff -a das eben gestartete zram-tools-Geraet mit: der
check des Schritts war direkt danach rot, erst der Neustart heilte es.

WIE NACHGESTELLT WIRD: Der `run:`-Block wird WOERTLICH aus dem Rezept
gelesen — kein Nachbau. Nur die Pfade /proc/ und /etc/ zeigen in einen
Wegwerfordner, DIETPI_DIR (die Naht, die der Schritt selbst anbietet) auf
eine Attrappe von dietpi-set_swapfile, und apt-get, systemctl, swapoff,
free, sleep sind kleine Skripte, die /proc/swaps so aendern, wie es die
echten taeten. Was auf der Box wirklich passiert, misst das nicht — es misst,
ob der Schritt die richtigen Werkzeuge in der richtigen Lage ruft.

  python3 tests/zram_schritt_test.py       # exit 0 = alles gruen
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

_HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REZEPT = os.path.join(_HIER, "recipes", "mupibox.yaml")

ok = bad = 0


def chk(name, cond):
    global ok, bad
    print(("  \033[32mOK  \033[0m" if cond else "  \033[31mFAIL\033[0m") + "  " + name)
    ok += bool(cond)
    bad += (not cond)


def schritt_lesen():
    """run: und check: des Schritts `zram` — als Rohtext, ohne YAML-Parser
    (der Test soll auch dort laufen, wo PyYAML fehlt)."""
    text = open(REZEPT, encoding="utf-8").read()
    m = re.search(r"^  - id: zram\n(.*?)(?=^  - id: )", text, re.M | re.S)
    if not m:
        return None, None
    block = m.group(1)
    run = re.search(r"^    run: \|\n((?:      .*\n|\s*\n)+)", block, re.M)
    check = re.search(r'^    check: "(.*)"$', block, re.M)
    if not run or not check:
        return None, None
    zeilen = [z[6:] if z.startswith("      ") else z.strip() for z in run.group(1).splitlines()]
    return "\n".join(zeilen) + "\n", check.group(1)


# Die Attrappen. Jede schreibt ihren Aufruf ins Protokoll und aendert
# /proc/swaps so, wie das echte Werkzeug es taete.
ATTRAPPEN = {
    "apt-get": r'''echo "apt-get $*" >> "$T/protokoll"
case "$*" in *zram-tools*)
  printf '#ALGO=lz4\n#PERCENT=50\n' > "$T/etc/default/zramswap"
  touch "$T/zramswap-installiert" ;;
esac''',
    "systemctl": r'''echo "systemctl $*" >> "$T/protokoll"
case "$*" in *zramswap*)
  [ -f "$T/zramswap-installiert" ] || exit 5
  grep -q '^/dev/zram0' "$T/proc/swaps" || \
    echo "/dev/zram0 partition 1000000 0 100" >> "$T/proc/swaps" ;;
esac
exit 0''',
    "swapoff": r'''echo "swapoff $*" >> "$T/protokoll"
if [ "$1" = -a ]; then head -n 1 "$T/proc/swaps" > "$T/s"; else
  awk -v z="$1" 'NR==1 || $1 != z' "$T/proc/swaps" > "$T/s"; fi
mv "$T/s" "$T/proc/swaps"''',
    "free": r'''n=$(awk 'NR>1 {s+=$3} END {print int(s/1024)}' "$T/proc/swaps")
echo "Swap: $n 0 $n"''',
    "sleep": "exit 0",
}

# Wie DietPis Swap_Disable: swapoff -a, Datei weg, fstab-Zeile weg, zram-Regel weg.
DIETPI_SET_SWAPFILE = r'''echo "dietpi-set_swapfile $*" >> "$T/protokoll"
[ "$1" = 0 ] || exit 0
head -n 1 "$T/proc/swaps" > "$T/s"; mv "$T/s" "$T/proc/swaps"
grep -v '[[:blank:]]swap[[:blank:]]' "$T/etc/fstab" > "$T/f" || true; mv "$T/f" "$T/etc/fstab"
rm -f "$T/etc/udev/rules.d/98-dietpi-zram-swap.rules"'''

KOPF = "Filename Type Size Used Priority\n"


def lage(swaps, fstab="", dietpi_zram=False, zramswap_da=False):
    t = tempfile.mkdtemp(prefix="zram-schritt-")
    for d in ("proc", "etc/default", "etc/udev/rules.d", "bin", "dietpi/func"):
        os.makedirs(os.path.join(t, d))
    open(os.path.join(t, "proc/swaps"), "w").write(KOPF + "".join(z + "\n" for z in swaps))
    open(os.path.join(t, "proc/meminfo"), "w").write("MemTotal:        2000000 kB\n")
    open(os.path.join(t, "etc/fstab"), "w").write(fstab)
    if dietpi_zram:
        open(os.path.join(t, "etc/udev/rules.d/98-dietpi-zram-swap.rules"), "w").write("x\n")
    if zramswap_da:
        open(os.path.join(t, "zramswap-installiert"), "w").close()
    open(os.path.join(t, "protokoll"), "w").close()
    for name, rumpf in ATTRAPPEN.items():
        p = os.path.join(t, "bin", name)
        open(p, "w").write('#!/bin/bash\nT="' + t + '"\n' + rumpf + "\n")
        os.chmod(p, 0o755)
    p = os.path.join(t, "dietpi/func/dietpi-set_swapfile")
    open(p, "w").write('#!/bin/bash\nT="' + t + '"\n' + DIETPI_SET_SWAPFILE + "\n")
    os.chmod(p, 0o755)
    return t


def fahren(t, run, check):
    skript = run.replace("/proc/", t + "/proc/").replace("/etc/", t + "/etc/")
    umgebung = dict(os.environ, PATH=t + "/bin:" + os.environ["PATH"],
                    DIETPI_DIR=t + "/dietpi")
    r = subprocess.run(["bash", "-c", skript], env=umgebung, capture_output=True, text=True)
    pruef = check.replace("/proc/", t + "/proc/")
    c = subprocess.run(["bash", "-c", pruef], env=umgebung)
    return {
        "rc": r.returncode,
        "check": c.returncode == 0,
        "ausgabe": r.stdout + r.stderr,
        "protokoll": open(os.path.join(t, "protokoll")).read(),
        "swaps": open(os.path.join(t, "proc/swaps")).read(),
        "fstab": open(os.path.join(t, "etc/fstab")).read(),
        "regel": os.path.isfile(os.path.join(t, "etc/udev/rules.d/98-dietpi-zram-swap.rules")),
    }


run, check = schritt_lesen()
chk("der Schritt `zram` steht im Rezept und hat run: und check:", bool(run and check))
if not run:
    print(f"\n{ok} bestanden, {bad} fehlgeschlagen")
    sys.exit(1)

# ── A: Assistenten-Karte — DietPi hat SEIN zram schon beim Erstlauf angelegt ──
t = lage(["/dev/zram0 partition 1000000 0 100"], dietpi_zram=True)
e = fahren(t, run, check)
print("A  DietPis eigenes zram laeuft, keine Datei")
chk("A: Schritt endet mit 0", e["rc"] == 0)
chk("A: dietpi-set_swapfile wird NICHT gerufen (es raeumte das zram weg)",
    "dietpi-set_swapfile" not in e["protokoll"])
chk("A: DietPis zram-Regel steht danach noch da", e["regel"])
chk("A: zram laeuft danach noch", "/dev/zram0" in e["swaps"])
chk("A: kein zweites zram per zram-tools", "zram-tools" not in e["protokoll"])
chk("A: check des Schritts ist gruen", e["check"])
shutil.rmtree(t)

# ── B: heutige Karte ohne Tabelle — DietPi legte /var/swap an ─────────────────
t = lage(["/var/swap file 153600 0 -2"], fstab="/var/swap none swap sw 0 0\n")
e = fahren(t, run, check)
print("B  Datei-Swap /var/swap, kein zram")
chk("B: Schritt endet mit 0", e["rc"] == 0)
chk("B: zram-tools wird installiert", "zram-tools" in e["protokoll"])
chk("B: dietpi-set_swapfile 0 bestellt die Datei ab", "dietpi-set_swapfile 0" in e["protokoll"])
chk("B: /var/swap ist aus /proc/swaps verschwunden", "/var/swap" not in e["swaps"])
chk("B: und aus /etc/fstab", "swap" not in e["fstab"])
chk("B: zram laeuft NACH dem Schritt (swapoff -a nahm es mit, der Schritt holt es zurueck)",
    "/dev/zram0" in e["swaps"])
chk("B: check des Schritts ist gruen", e["check"])

# ── D: derselbe Schritt noch einmal auf B's Endstand — nichts mehr zu tun ─────
open(os.path.join(t, "protokoll"), "w").close()
e = fahren(t, run, check)
print("D  zweiter Lauf auf dem Endstand von B")
chk("D: kein apt-get mehr", "apt-get" not in e["protokoll"])
chk("D: kein dietpi-set_swapfile mehr", "dietpi-set_swapfile" not in e["protokoll"])
chk("D: zram laeuft weiter", "/dev/zram0" in e["swaps"] and e["check"])
shutil.rmtree(t)

# ── C: gar keine Auslagerung ──────────────────────────────────────────────────
t = lage([])
e = fahren(t, run, check)
print("C  keine Auslagerung")
chk("C: zram-tools wird installiert", "zram-tools" in e["protokoll"])
chk("C: dietpi-set_swapfile wird NICHT gerufen (nichts abzubestellen)",
    "dietpi-set_swapfile" not in e["protokoll"])
chk("C: zram laeuft danach", "/dev/zram0" in e["swaps"] and e["check"])
shutil.rmtree(t)

print(f"\n{ok} bestanden, {bad} fehlgeschlagen")
sys.exit(1 if bad else 0)
