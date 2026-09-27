#!/usr/bin/env python3
"""Was ein ORDNERNAME anrichten kann — gemessen, nicht gelesen.

Ein Medienordner kommt von aussen: von einem USB-Stick, aus einer Freigabe,
aus einem Download. Sein Name ist damit fremder Text, und er wandert durch
`m3u_generator.sh` und `data_clean.sh` bis in `data.json`. Dieses Werkzeug
setzt Ordner mit boesartigen Namen in einen Sandkasten unter /tmp, laesst die
ECHTEN Skripte darauf laufen (die Orte stehen seit dem 07.08.2026 in
MUPI_*-Variablen) und sieht danach nach, was aus der Bibliothek geworden ist.

DIE FRAGE IST NICHT „faellt etwas auf", SONDERN „was steht danach in
data.json". Deshalb wird nach jedem Lauf geprueft:
  * ist data.json ueberhaupt noch eine Liste (JSON, `type == array`)?
  * steht der Bestand, der vorher da war, noch drin?
  * ist der neue Eintrag da, und traegt er den Namen UNVERAENDERT?
  * ist etwas entstanden, das niemand angelegt hat (eingeschleuste Felder)?

DER BEFUND, DER DAS AUSGELOEST HAT (07.08.2026): der Ordnername wurde in den
jq-PROGRAMMTEXT gespleisst. Ein Anfuehrungszeichen darin liess jq scheitern,
`cat <<< $(…) > data.json` schrieb daraufhin EINE LEERE ZEILE — die ganze
Bibliothek war weg, auch alles, was mit dem Ordner nichts zu tun hatte. Lage 9
faehrt genau diesen Fall gegen die ALTE Fassung und belegt ihn.

    python3 tools/ordnername-angriff.py [--behalten]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
SKRIPTE_ECHT = os.path.join(WURZEL, "scripts", "mupibox")

gruen = 0
rot = 0
offen = []


def chk(name, gut, dazu=""):
    global gruen, rot
    if gut:
        gruen += 1
        print(f"  OK    {name}" + (f"  — {dazu}" if dazu else ""))
    else:
        rot += 1
        print(f"  FEHL  {name}" + (f"  — {dazu}" if dazu else ""))
        offen.append(name)


def lage(name):
    print(f"\n── {name} " + "─" * max(0, 66 - len(name)))


# ── Die boesen Namen. Jeder steht fuer einen Weg, nicht fuer eine Laune ─────
#
# Was auf einem FAT/exFAT-Stick nicht vorkommen kann (" und \), kommt auf ext4,
# auf einer NFS- oder SMB-Freigabe und in jedem Ordner, der unter Linux
# angelegt wurde, sehr wohl vor. Der Zeilenumbruch geht ueberall.
BOESE = [
    ('Die "Kleine Hexe"', "Anfuehrungszeichen — bricht den jq-Programmtext"),
    ("AC\\DC", "Rueckstrich — in JSON eine ungueltige Maskierung"),
    ("Zwei\nZeilen", "Zeilenumbruch — mitten im Zeichenkettenliteral"),
    ('X", "sortOrder": 999, "y": "', "der VOLLE Einschleusversuch: gueltiges jq, fremdes Feld"),
    # KEIN `/` in diesen Namen — ein Schraegstrich kann in einem Dateinamen
    # gar nicht vorkommen, und ein Muster, das das vergisst, misst nichts.
    ("$(touch marke-a)", "Befehlsersetzung"),
    ("`touch marke-b`", "Rueckwaertsschritt"),
    ("Semikolon; rm -rf mupi-opfer", "Semikolon"),
    ("Punkt.und[Klammer]", "Muster-Zeichen — trifft im grep den Nachbarn"),
    ("Umlaute ÄÖÜ und 'Apostroph'", "Umlaute und Apostroph — muessen UNVERAENDERT durch"),
]

BESTAND = [
    {
        "type": "library",
        "category": "audiobook",
        "artist": "Bestand",
        "title": "Alte Folge",
        "sortOrder": 7,
        "aPartOfAll": True,
        "cover": "http://box:8200/eigenes-bild.jpg",
    }
]


def kasten_bauen(namen, skripte=None):
    """Ein Sandkasten mit einem Ordner je Name. -> Woerterbuch mit den Orten."""
    w = tempfile.mkdtemp(prefix="mupi-ordnername-")
    k = {
        "wurzel": w,
        "media": os.path.join(w, "media"),
        "cover": os.path.join(w, "cover"),
        "config": os.path.join(w, "config"),
        "skripte": skripte or os.path.join(w, "skripte"),
        "sys": os.path.join(w, "sys"),
    }
    for d in (k["media"], k["cover"], k["config"], k["sys"]):
        os.makedirs(d, exist_ok=True)
    for kat in ("audiobook", "music", "other"):
        os.makedirs(os.path.join(k["media"], kat), exist_ok=True)
    if not skripte:
        os.makedirs(k["skripte"], exist_ok=True)
        for n in ("data_clean.sh", "m3u_generator.sh"):
            shutil.copy2(os.path.join(SKRIPTE_ECHT, n), os.path.join(k["skripte"], n))
        with open(os.path.join(k["skripte"], "add_index.sh"), "w") as f:
            f.write("exit 0\n")
    with open(os.path.join(k["sys"], "logo.jpg"), "wb") as f:
        f.write(b"jpeg")
    # Das Opfer fuer den Semikolon-Fall: es liegt im Arbeitsverzeichnis des
    # Laufs und muss danach noch da sein.
    with open(os.path.join(w, "mupi-opfer"), "w") as f:
        f.write("bitte stehen lassen\n")
    # DER BESTAND BRAUCHT SEINEN ORDNER. Sonst raeumt data_clean.sh ihn zu
    # Recht weg, und die Messung „ist der Bestand noch da" misst den falschen
    # Weg. Der Ordner ist absichtlich unverfaenglich benannt.
    b = os.path.join(k["media"], "audiobook", "Bestand", "Alte Folge")
    os.makedirs(b, exist_ok=True)
    with open(os.path.join(b, "01.mp3"), "wb") as f:
        f.write(b"ton")
    # Ein unverfaenglicher Ordner MUSS dabei sein: die Gegenprobe, dass der
    # Lauf ueberhaupt noch etwas anlegt.
    for name in ["Benjamin Bluemchen"] + namen:
        ordner = os.path.join(k["media"], "audiobook", "Interpret", name)
        os.makedirs(ordner, exist_ok=True)
        with open(os.path.join(ordner, "01.mp3"), "wb") as f:
            f.write(b"ton")
    with open(os.path.join(k["config"], "data.json"), "w") as f:
        json.dump(BESTAND, f, indent=2)
    return k


def lauf(k):
    umgebung = dict(os.environ)
    umgebung.update({
        "MUPI_DATA": os.path.join(k["config"], "data.json"),
        "MUPI_CONFIG_DIR": k["config"],
        "MUPI_COVER": k["cover"],
        "MUPI_MEDIA": k["media"],
        "MUPI_SKRIPTE": k["skripte"],
        "MUPI_LOGO": os.path.join(k["sys"], "logo.jpg"),
        "MUPI_DATA_LOCK": os.path.join(k["wurzel"], "lock"),
        "MUPI_BESITZER": f"{os.getuid()}:{os.getgid()}",
    })
    e = subprocess.run(
        ["bash", os.path.join(k["skripte"], "m3u_generator.sh")],
        capture_output=True, text=True, env=umgebung, timeout=180,
        cwd=k["wurzel"],
    )
    return e


def daten(k):
    """data.json lesen. -> (liste oder None, rohe Bytes)."""
    p = os.path.join(k["config"], "data.json")
    roh = open(p, "rb").read()
    try:
        d = json.loads(roh)
        return (d if isinstance(d, list) else None), roh
    except ValueError:
        return None, roh


def main():
    behalten = "--behalten" in sys.argv
    kaesten = []

    # ── Lage 1..N: jeder boese Name einzeln ─────────────────────────────────
    for name, warum in BOESE:
        lage(f"Ordner: {name!r} — {warum}")
        k = kasten_bauen([name])
        kaesten.append(k)
        lauf(k)
        d, roh = daten(k)
        chk("data.json ist noch eine Liste", d is not None,
            f"{len(roh)} Bytes: {roh[:60]!r}" if d is None else f"{len(d)} Eintraege")
        if d is None:
            continue
        chk("der Bestand von vorher steht noch drin",
            any(x.get("title") == "Alte Folge" for x in d))
        chk("… mit allem, was ein Mensch daran gesetzt hat",
            any(x.get("title") == "Alte Folge" and x.get("sortOrder") == 7
                and x.get("cover", "").endswith("eigenes-bild.jpg") for x in d))
        chk("der unverfaengliche Nachbar ist angelegt",
            any(x.get("title") == "Benjamin Bluemchen" for x in d))
        treffer = [x for x in d if x.get("title") == name]
        chk("der Ordner selbst ist angelegt — mit dem Namen UNVERAENDERT",
            len(treffer) == 1, f"{len(treffer)} Treffer")
        if treffer:
            felder = set(treffer[0]) - {"type", "category", "artist", "title",
                                        "cover", "artistcover", "index"}
            chk("… und ohne ein Feld, das niemand angelegt hat",
                not felder, ", ".join(sorted(felder)))
        # Die Marken entstuenden im Arbeitsverzeichnis des Laufs — und das
        # ist der Sandkasten (siehe `lauf`). `mupi-opfer` liegt dort und darf
        # nicht verschwinden.
        chk("kein Befehl aus dem Namen ausgefuehrt",
            not os.path.exists(os.path.join(k["wurzel"], "marke-a"))
            and not os.path.exists(os.path.join(k["wurzel"], "marke-b"))
            and os.path.exists(os.path.join(k["wurzel"], "mupi-opfer")))

    # ── Alle zusammen: ein Stick, wie er wirklich aussieht ──────────────────
    lage("Alle boesen Namen auf einmal (ein Stick, wie er wirklich aussieht)")
    k = kasten_bauen([n for n, _ in BOESE])
    kaesten.append(k)
    lauf(k)
    d, roh = daten(k)
    chk("data.json ist noch eine Liste", d is not None, f"{len(roh)} Bytes")
    if d is not None:
        chk("jeder Ordner hat genau einen Eintrag",
            all(len([x for x in d if x.get("title") == n]) == 1 for n, _ in BOESE),
            ", ".join(n for n, _ in BOESE
                      if len([x for x in d if x.get("title") == n]) != 1) or "alle")
        chk("der Bestand von vorher steht noch drin",
            any(x.get("title") == "Alte Folge" for x in d))
        # Ein zweiter Lauf darf nichts verdoppeln — die Identitaetsfrage.
        lauf(k)
        d2, _ = daten(k)
        chk("ein zweiter Lauf verdoppelt nichts",
            d2 is not None and len(d2) == len(d),
            f"{len(d)} -> {len(d2) if d2 else 'kaputt'}")

    # ── Die Gegenrechnung: die ALTE Fassung an derselben Lage ───────────────
    lage("Gegenrechnung — dieselbe Lage gegen die Fassung vor der Reparatur")
    alt = tempfile.mkdtemp(prefix="mupi-ordnername-alt-")
    e = subprocess.run(
        ["git", "-C", WURZEL, "show", "8f78c9c8:scripts/mupibox/m3u_generator.sh"],
        capture_output=True, text=True,
    )
    if e.returncode != 0:
        print("  ---   die alte Fassung liess sich nicht holen — UNGEPRUEFT")
    else:
        with open(os.path.join(alt, "m3u_generator.sh"), "w") as f:
            f.write(e.stdout)
        shutil.copy2(os.path.join(SKRIPTE_ECHT, "data_clean.sh"), os.path.join(alt, "data_clean.sh"))
        with open(os.path.join(alt, "add_index.sh"), "w") as f:
            f.write("exit 0\n")
        ka = kasten_bauen(['Die "Kleine Hexe"'], skripte=alt)
        kaesten.append(ka)
        lauf(ka)
        d, roh = daten(ka)
        chk("die alte Fassung LOESCHT die ganze Bibliothek (Befund belegt)",
            d is None or len(d) == 0,
            f"{len(roh)} Bytes uebrig: {roh[:40]!r}")
    kaesten.append({"wurzel": alt})

    if not behalten:
        for k in kaesten:
            shutil.rmtree(k["wurzel"], ignore_errors=True)
    else:
        print("\nSandkaesten behalten:")
        for k in kaesten:
            print(f"  {k['wurzel']}")

    print("\n" + "═" * 70)
    print(f"{gruen} bestanden, {rot} fehlgeschlagen")
    for o in offen:
        print(f"  offen: {o}")
    return 0 if rot == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
