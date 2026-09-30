#!/usr/bin/env python3
"""Die Boot-Animation AM GERAET ansehen — das letzte Bild, oder den ganzen Start.

══ WOZU ═══════════════════════════════════════════════════════════════════
tools/bootsplash-vorschau.py zeigt die Animation mit dem echten Zeichencode,
aber am Entwicklungsrechner: mit Ersatzschrift und ohne das Panel. Was die Box
beim Hochfahren wirklich zeigt, sieht man nur dort — und nur in den rund
zwanzig Sekunden, in denen niemand danebensitzt. Gebaut am 29.09.2026 fuer
den Sternenhimmel (llmwiki: boot-animation-sternenhimmel-mit-schwebendem-mixpi).

══ WIE ════════════════════════════════════════════════════════════════════
/dev/fb0 per SSH lesen (dietpi ist in der Gruppe video, kein sudo noetig) und
als PNG ablegen. Masse, Farbtiefe und Zeilenlaenge kommen aus
/sys/class/graphics/fb0 — nicht angenommen: der Pi 4 faehrt 16 bpp, der Pi 5
32 (llmwiki: mupi-splash-16bpp).

  (ohne)       EIN Bild: was jetzt in fb0 steht. AM PI 5 ist das das LETZTE
               BILD DES STARTBILDSCHIRMS — X schreibt dort nicht hinein
               (tools/box-schirm-foto.py, Kopf). Es ist also nicht der
               laufende Schirm, sondern der Abschied der Animation.
  --neustart   startet die Box NEU und schneidet mit, sobald SSH wieder
               antwortet, bis die Animation sich beendet hat. Erkannt wird der
               neue Start an einer anderen boot_id, nicht an einer Pause.

══ WAS DARAN NICHT STIMMT ═════════════════════════════════════════════════
DER ANFANG FEHLT. SSH antwortet erst, wenn das WLAN eine Adresse hat — laut
tools/grundmessung.py 4 bis 9 s nach dem Kernel. Die ersten Sekunden der
Animation sieht dieses Werkzeug nie; dafuer muesste man danebensitzen.

AM PI 4 teilen sich Panel und X dieselbe Karte (llmwiki:
mupi-weiss-beim-uebergang). Was nach dem Start von X in fb0 steht, ist dort
nicht verlaesslich das letzte Splash-Bild.

══ VORSICHT ═══════════════════════════════════════════════════════════════
--neustart startet eine Box neu, die einem Kind gehoert. Nur auf Zuruf des
Betreibers — das Werkzeug fragt nicht nach, der Schalter IST die Frage.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/bootsplash-am-geraet.py --ziel /tmp/splash
    python3 tools/bootsplash-am-geraet.py --box dietpi@192.168.178.62 --ziel /tmp/s
    python3 tools/bootsplash-am-geraet.py --neustart --ziel /tmp/s

Rueckgabe: 0 Bilder da, 1 keine Box / kein Bild, 2 Aufruf falsch oder Pillow fehlt.
"""
import argparse
import gzip
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent


def pil():
    try:
        from PIL import Image
        return Image
    except ImportError:
        print("Pillow fehlt (python3 -m pip install pillow).", file=sys.stderr)
        sys.exit(2)


class Leitung:
    """SSH zur Box — ueber EINE Master-Verbindung, damit ein Bild nicht jedes
    Mal einen neuen Schluesselaustausch kostet (im Mitschnitt zaehlt jede
    Zehntelsekunde)."""

    def __init__(self, box, ordner):
        self.box = box
        self.opts = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
                     "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=2",
                     "-o", "ControlMaster=auto", "-o", f"ControlPath={ordner}/%C",
                     "-o", "ControlPersist=30"]

    def rufen(self, befehl, zeit=20):
        return subprocess.run(["ssh", *self.opts, self.box, befehl],
                              capture_output=True, timeout=zeit)

    def text(self, befehl, zeit=20):
        r = self.rufen(befehl, zeit)
        return r.stdout.decode("utf-8", "replace").strip() if r.returncode == 0 else None

    def schliessen(self):
        subprocess.run(["ssh", *self.opts, "-O", "exit", self.box],
                       capture_output=True, timeout=10)


def box_bestimmen(angabe):
    if angabe:
        return angabe
    r = subprocess.run([sys.executable, str(WURZEL / "tools" / "box-finden.py"), "--nur-adresse"],
                       capture_output=True, text=True, timeout=120)
    adresse = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else ""
    if not adresse or " " in adresse:
        print("Keine Box gefunden — mit --box dietpi@<adresse> angeben.", file=sys.stderr)
        sys.exit(1)
    return f"dietpi@{adresse}"


# Ein Aufruf liefert alles fuer EIN Bild: Zeit seit dem Start und Zustand der
# Animation auf stderr, den gepackten Bildspeicher auf stdout.
ABZUG = ("cut -d' ' -f1 /proc/uptime >&2; "
         "systemctl is-active mupibox-boot-splash >&2; "
         "dd if=/dev/fb0 bs={groesse} count=1 status=none | gzip -1")


def masse(leitung):
    t = leitung.text("cat /sys/class/graphics/fb0/virtual_size "
                     "/sys/class/graphics/fb0/bits_per_pixel "
                     "/sys/class/graphics/fb0/stride")
    if not t:
        return None
    groesse, bpp, stride = t.split()
    b, h = (int(v) for v in groesse.split(","))
    return b, h, int(bpp), int(stride)


def abziehen(leitung, m):
    """-> (sekunden_seit_start, zustand, PIL-Bild) oder None."""
    Image = pil()
    b, h, bpp, stride = m
    try:
        r = leitung.rufen(ABZUG.format(groesse=stride * h), zeit=15)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        return None
    try:
        roh = gzip.decompress(r.stdout)
        fehler = r.stderr.decode().split()
        uptime, zustand = float(fehler[0]), fehler[1]
    except (OSError, ValueError, IndexError):
        return None
    modus = {32: "BGRX", 16: "BGR;16"}.get(bpp)
    if modus is None or len(roh) < stride * h:
        return None
    bild = Image.frombuffer("RGB", (b, h), roh, "raw", modus, stride, 1)
    return uptime, zustand, bild.copy()


def neustart_und_mitschneiden(leitung, ziel, frist):
    Image = pil()
    vorher = leitung.text("cat /proc/sys/kernel/random/boot_id")
    if not vorher:
        print("Box antwortet nicht — kein Neustart.", file=sys.stderr)
        return 1
    print(f"Neustart von {leitung.box} (boot_id {vorher[:8]}) ...")
    leitung.rufen("sudo -n systemctl reboot", zeit=10)
    leitung.schliessen()

    # Warten, bis eine ANDERE boot_id antwortet. Eine Pause allein beweist
    # nichts: ein Aufruf kann auch an einem Zeitlimit scheitern, waehrend die
    # Box noch gar nicht heruntergefahren ist.
    start, neu = time.time(), None
    while time.time() - start < 180:
        try:
            neu = leitung.text("cat /proc/sys/kernel/random/boot_id", zeit=5)
        except subprocess.TimeoutExpired:
            neu = None
        if neu and neu != vorher:
            break
        time.sleep(0.3)
    else:
        print("Nach 180 s keine neue boot_id — die Box ist nicht wieder da.", file=sys.stderr)
        return 1
    print(f"wieder da nach {time.time() - start:.1f} s (boot_id {neu[:8]}) — schneide mit")

    m = masse(leitung)
    if m is None:
        print("fb0 nicht lesbar.", file=sys.stderr)
        return 1
    bilder, ende = [], time.time() + frist
    while time.time() < ende:
        erg = abziehen(leitung, m)
        if erg is None:
            continue
        uptime, zustand, bild = erg
        name = f"t{uptime:05.1f}s-{zustand}.png"
        bild.save(ziel / name)
        bilder.append((uptime, zustand, bild))
        print(f"  {uptime:5.1f} s nach dem Start  Animation {zustand:9s}  {name}")
        # Ein Bild nach dem Ende noch mitnehmen: das ist der Abschied
        # („Fertig", alle Pillen an), der danach in fb0 stehen bleibt.
        if zustand != "active" and len(bilder) > 1:
            break
    leitung.schliessen()
    if not bilder:
        print("Kein einziges Bild — lief die Animation schon nicht mehr?", file=sys.stderr)
        return 1
    b, h = bilder[0][2].size
    spalten = min(3, len(bilder))
    zeilen = -(-len(bilder) // spalten)
    tafel = Image.new("RGB", (spalten * b // 2, zeilen * h // 2))
    for i, (_, _, bild) in enumerate(bilder):
        tafel.paste(bild.resize((b // 2, h // 2)), ((i % spalten) * b // 2, (i // spalten) * h // 2))
    tafel.save(ziel / "tafel.png")
    print(f"{len(bilder)} Bilder, Tafel: {ziel / 'tafel.png'}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__.split("══ WOZU")[0].strip())
    p.add_argument("--box", help="dietpi@<adresse>; ohne Angabe fragt tools/box-finden.py")
    p.add_argument("--ziel", required=True, help="Ordner fuer die Bilder")
    p.add_argument("--neustart", action="store_true",
                   help="Box NEU STARTEN und den Start mitschneiden")
    p.add_argument("--frist", type=float, default=60.0,
                   help="Sekunden Mitschnitt nach dem Wiederkommen (Vorgabe 60)")
    a = p.parse_args()
    pil()
    ziel = Path(a.ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="splash-ssh-") as ordner:
        leitung = Leitung(box_bestimmen(a.box), ordner)
        try:
            if a.neustart:
                return neustart_und_mitschneiden(leitung, ziel, a.frist)
            m = masse(leitung)
            erg = abziehen(leitung, m) if m else None
            if erg is None:
                print(f"Kein Bild von {leitung.box}.", file=sys.stderr)
                return 1
            uptime, zustand, bild = erg
            pfad = ziel / "fb0-jetzt.png"
            bild.save(pfad)
            print(f"{pfad}: {m[0]}x{m[1]}, {m[2]} bpp, {uptime:.0f} s nach dem Start, "
                  f"Animation {zustand}")
            return 0
        finally:
            leitung.schliessen()


if __name__ == "__main__":
    sys.exit(main())
