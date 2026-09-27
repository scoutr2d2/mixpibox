#!/usr/bin/env python3
"""PASST DER WEG OHNE PC AUF DIE BOOT-PARTITION? — nachrechnen statt hoffen.

Die Boot-Partition eines DietPi-Abbilds ist FAT und klein (auf der Karte des
Betreibers gemessen: 128 MB). `prepare_boot(..., handy=True, lauf_paket=True)`
legt dorthin: einrichtung/ (Skripte + Bild), Python-.deb, einrichtung/vorstart/
(dieselben Skripte NOCHMAL plus die .deb NOCHMAL) und lauf.tar.gz.

ZWEI BETRIEBSARTEN, und die zweite ist die, die zaehlt:

    python3 tools/bootplatz-messen.py [--fork ~/Downloads/MuPiBox]
        Rechnen. Baut das Laufpaket wirklich (Wegwerf-Ordner), summiert den
        Rest aus der Groessentabelle. Kein Netz noetig, kein Abbild noetig.

    python3 tools/bootplatz-messen.py --echt ~/.cache/remote-step-installer/DietPi_…img.xz
        GEGENPROBE. Schneidet die Boot-Partition aus dem echten Abbild, laesst
        `prepare_boot(handy=True, lauf_paket=True)` wirklich laufen (laedt dabei
        die .deb aus dem Debian-Pool) und schiebt das Ergebnis per `mcopy` in
        die FAT. Rechnen kann sich irren; mcopy nicht.

Es fasst in KEINER Betriebsart eine Karte an und braucht kein root.
"""
import argparse
import re
import os
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HIER)
sys.path.insert(0, os.path.join(REPO, "controller"))

# Gemessene Groessen der sieben .deb aus pythonpaket.pakete_bestimmen()
# (trixie/arm64, Stand 08/2026). Nur Schaetzung, wenn nichts lokal liegt.
DEB_SCHAETZUNG = {
    "libpython3.13-minimal": 830_000,
    "python3.13-minimal": 2_100_000,
    "python3-minimal": 27_000,
    "libexpat1": 105_000,
    "libpython3.13-stdlib": 1_950_000,
    "media-types": 27_000,
    "netbase": 13_000,
}

# Was prepare_boot() bei handy=True nach boot/einrichtung/ kopiert (sdprep.py:1121)
EINRICHTUNG_TEILE = [
    ("tools", "einrichtung-schirm.py"),
    ("tools", "phase-vorab.sh"),
    ("tools", "einrichtung-ap.py"),
    ("tools", "kleiner-dhcp.py"),
    ("tools", "qr.py"),
    ("tools", "mupibox-boot-splash.py"),
    ("tools", "mixpibox-einrichtung.service"),
    ("tools", "mixpibox-einrichtung-ap.service"),
    ("tools", "mixpibox-selbstlauf.service"),
    ("dateien", "mixpi-hoert.png"),
]

# Was vorstart_dateien_sammeln() nach boot/einrichtung/vorstart/ legt (sdprep.py:2205)
VORSTART_TEILE = [
    ("tools", "einrichtung-schirm.py"),
    ("tools", "phase-vorab.sh"),
    ("tools", "einrichtung-ap.py"),
    ("tools", "kleiner-dhcp.py"),
    ("tools", "qr.py"),
    ("tools", "mupibox-boot-splash.py"),
    ("tools", "mixpibox-vorstart.service"),
    ("dateien", "mixpi-hoert.png"),
    ("agent", "agent.py"),
    ("agent", "einrichtung.html"),
]


def mb(n):
    return f"{n / 1e6:8.2f} MB"


def ordner_gross(pfad):
    s = 0
    for w, _, dateien in os.walk(pfad):
        for d in dateien:
            p = os.path.join(w, d)
            if os.path.isfile(p) and not os.path.islink(p):
                s += os.path.getsize(p)
    return s


def teile_summe(teile):
    s, fehlt = 0, []
    for ordner, datei in teile:
        q = os.path.join(REPO, ordner, datei)
        if os.path.isfile(q):
            s += os.path.getsize(q)
        else:
            fehlt.append(f"{ordner}/{datei}")
    return s, fehlt


def quellen_roh(rezepte, fork):
    """Was die Rezepte an Dateien mitgeben wollen — UNGEPACKT. -> (summe, liste)."""
    import core
    import laufpaket
    gesammelt = {}

    def sammeln(pfad, ablage):
        gesammelt[ablage] = pfad

    _, fehlend = laufpaket.rezept_wandeln(rezepte, REPO, fork, sammeln)
    posten = []
    for ablage, pfad in gesammelt.items():
        g = ordner_gross(pfad) if os.path.isdir(pfad) else os.path.getsize(pfad)
        posten.append((g, pfad))
    posten.sort(reverse=True)
    return sum(p[0] for p in posten), posten, fehlend


def gegenprobe(img_xz, fork):
    """Die einzige Antwort, die zaehlt: reinschieben und nachsehen.

    Rechnen kann sich irren (Cluster-Verschnitt, Verzeichniseintraege). Also
    wird die Boot-Partition aus dem echten Abbild geschnitten, `prepare_boot`
    mit dem Handy-Weg wirklich gelaufen und alles per `mcopy` hineinkopiert.
    Ohne root, ohne Karte — mtools redet direkt mit der FAT-Datei.
    """
    import shutil
    import subprocess
    sys.path.insert(0, os.path.join(REPO, "controller"))
    import sdprep

    arbeit = tempfile.mkdtemp(prefix="bootplatz-")
    img = os.path.join(arbeit, "roh.img")
    fat = os.path.join(arbeit, "boot.fat")
    print(f"Arbeitsordner: {arbeit}")
    print("Abbild auspacken (nur der Anfang reicht — Boot ist Partition 1) …")
    with open(img, "wb") as f:
        p1 = subprocess.Popen(["xz", "-dc", os.path.expanduser(img_xz)],
                              stdout=subprocess.PIPE)
        rest = 200_000_000
        while rest > 0:
            b = p1.stdout.read(min(1 << 20, rest))
            if not b:
                break
            f.write(b)
            rest -= len(b)
        p1.kill()
    r = subprocess.run(["fdisk", "-l", "-o", "Start,Sectors,Type", img],
                       capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-3:] and "\n".join(r.stdout.strip().splitlines()[-3:]))
    subprocess.run(["dd", f"if={img}", f"of={fat}", "bs=512", "skip=2048",
                    "count=262144", "status=none"], check=True)

    def frei():
        m = subprocess.run(["mdir", "-i", fat, "-s", "::"],
                           capture_output=True, text=True)
        for z in reversed((m.stdout or "").splitlines()):
            if "bytes free" in z:
                return int(re.sub(r"[^0-9]", "", z))
        return -1

    vorher = frei()
    print(f"Abbild bringt mit: {mb(134_217_728 - vorher)} belegt, {mb(vorher)} frei")

    ziel = os.path.join(arbeit, "boot")
    os.makedirs(ziel)
    print("\nprepare_boot(handy=True, lauf_paket=True) …")
    for z in sdprep.prepare_boot(ziel, password="pw", hostname="mixpi",
                                 wifi={"ssid": "X", "key": "Y"},
                                 ssh_pubkey="", handy=True, lauf_paket=True,
                                 fork=fork,
                                 bildname=os.path.basename(img_xz)):
        print(f"   {z}")
    geschrieben = ordner_gross(ziel)
    print(f"\nprepare_boot hat geschrieben: {mb(geschrieben)}")

    print("Hineinschieben (mcopy) …")
    fehler = []
    for eintrag in sorted(os.listdir(ziel)):
        q = os.path.join(ziel, eintrag)
        cmd = ["mcopy", "-i", fat, "-o", "-s" if os.path.isdir(q) else "-b", q, "::"]
        rr = subprocess.run(cmd, capture_output=True, text=True)
        if rr.returncode != 0:
            fehler.append(f"{eintrag}: {(rr.stderr or '').strip()[:200]}")
    nachher = frei()
    print(f"\nfrei vorher : {mb(vorher)}")
    print(f"frei nachher: {mb(nachher)}")
    print(f"verbraucht  : {mb(vorher - nachher)}  (Nutzdaten {mb(geschrieben)}, "
          f"Verschnitt {mb(vorher - nachher - geschrieben)})")
    if fehler:
        print("\nPASST NICHT — mcopy meldete:")
        for f2 in fehler:
            print("   " + f2)
    else:
        print(f"\nES PASST. Nach dem Kopieren sind noch {mb(nachher)} frei.")
    shutil.rmtree(arbeit, ignore_errors=True)
    return 1 if fehler else 0


def main():
    import core
    ap = argparse.ArgumentParser()
    ap.add_argument("--fork", default=None,
                    help="wo der Fork liegt (Vorgabe: der Finder core.fork_wurzel)")
    ap.add_argument("--kein-bau", action="store_true",
                    help="das tar.gz nicht wirklich bauen (nur roh summieren)")
    ap.add_argument("--echt", metavar="IMG.XZ",
                    help="GEGENPROBE: prepare_boot(handy, lauf_paket) wirklich "
                         "laufen lassen und das Ergebnis mit mcopy in die FAT "
                         "des echten Abbilds schieben. Fasst KEINE Karte an.")
    a = ap.parse_args()
    if a.echt:
        return gegenprobe(a.echt, os.path.expanduser(a.fork) if a.fork else core.fork_wurzel()[0])
    # DEN FINDER FRAGEN: bis zum 23.09.2026 stand hier ~/Downloads/MuPiBox als
    # Vorgabe — auf einem fremden Rechner mass das Werkzeug dann ein Paket aus
    # 0 gefundenen Quellen und sagte dreimal „passt". Gefunden von der
    # gegnerischen Nachpruefung desselben Tages.
    fork = os.path.expanduser(a.fork) if a.fork else core.fork_wurzel()[0]
    print(f"Fork: {fork}" + ("" if a.fork else f"  ({core.fork_wurzel()[1]})"))

    rezepte = [os.path.join(REPO, "recipes", r)
               for r in ("mupibox.yaml", "mupibox-app.yaml")]
    rezepte = [r for r in rezepte if os.path.isfile(r)]
    print(f"Rezepte: {', '.join(os.path.basename(r) for r in rezepte)}")
    print(f"Fork:    {fork}")

    roh, posten, fehlend = quellen_roh(rezepte, fork)
    if fehlend:
        print(f"  ABBRUCH: {len(fehlend)} Rezept-Quelle(n) nicht gefunden — das Paket, das hier "
              f"gemessen wuerde, gibt es so nicht. Erste: {fehlend[:3]}")
        return 1
    print(f"\nRezept-Quellen ungepackt: {mb(roh)}  ({len(posten)} Posten, "
          f"{len(fehlend)} nicht gefunden)")
    for g, p in posten[:12]:
        print(f"   {mb(g)}  {p}")

    tgz = 0
    if not a.kein_bau:
        import laufpaket
        with tempfile.TemporaryDirectory() as td:
            ziel = os.path.join(td, "lauf.tar.gz")
            n, dz, f2 = laufpaket.paket_bauen(ziel, rezepte, REPO, fork,
                                              melden=lambda s: print(s))
            tgz = os.path.getsize(ziel)
        print(f"lauf.tar.gz gepackt:      {mb(tgz)}   ({n} Schritte, {dz} Dateien)")

    e_sum, e_fehlt = teile_summe(EINRICHTUNG_TEILE)
    v_sum, v_fehlt = teile_summe(VORSTART_TEILE)
    deb = sum(DEB_SCHAETZUNG.values())
    agent = 0
    for d in ("agent.py", "einrichtung.html"):
        q = os.path.join(REPO, "agent", d)
        if os.path.isfile(q):
            agent += os.path.getsize(q)

    print("\n── Was auf die BOOT-Partition kommt (handy=True, lauf_paket=True) ──")
    print(f"  step-agent/            {mb(agent)}")
    print(f"  einrichtung/ (Teile)   {mb(e_sum)}" + (f"   FEHLT: {e_fehlt}" if e_fehlt else ""))
    print(f"  einrichtung/*.deb      {mb(deb)}   (7 Pakete, geschaetzt)")
    print(f"  einrichtung/vorstart/  {mb(v_sum)}" + (f"   FEHLT: {v_fehlt}" if v_fehlt else ""))
    print(f"  vorstart/*.deb ZWEITE KOPIE {mb(deb)}   (sdprep.py:1174)")
    print(f"  einrichtung/lauf.tar.gz{mb(tgz)}")
    summe = agent + e_sum + deb + v_sum + deb + tgz
    print(f"  ─────────────────────────────────")
    print(f"  SUMME                  {mb(summe)}")
    for platz in (128e6, 256e6, 512e6):
        rest = platz - summe
        wort = "passt" if rest > 0 else "PASST NICHT"
        print(f"  auf {platz/1e6:.0f} MB Boot: {wort} (Rest {rest/1e6:+.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
