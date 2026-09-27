"""Das Rezept fuer einen Lauf OHNE LAPTOP schnueren — alles, was die Box braucht.

WOZU: Normalerweise liegt das Rezept beim Controller, und der treibt die Box
Schritt fuer Schritt. Wer nur ein Telefon hat, kommt so nicht los. Also nimmt
die Box beides mit: die Schrittliste UND alle Dateien, die dabei aufgespielt
werden. Danach faehrt sie sich selbst (`tools/selbstlauf.py`), und das Handy
startet nur.

DREI ENTSCHEIDUNGEN, DIE MAN SPAETER SONST NICHT MEHR VERSTEHT:

  1. JSON STATT YAML. Auf einem frischen DietPi gibt es kein PyYAML, und es
     dort nachzuinstallieren hiesse: Netz, bevor die Installation laeuft, die
     das Netz einrichten soll. Der Laptop HAT PyYAML — also wird hier gewandelt.

  2. EIN TAR.GZ, KEIN ORDNER. Die Boot-Partition ist FAT32 und kennt keine
     Unix-Rechte. Ein `scripts/`-Verzeichnis kaeme dort ohne sein +x an, und
     die Fehlersuche begaenne bei "Permission denied" in Schritt 19. Ein
     Archiv haelt die Rechte, ist kleiner und wird beim Erstboot ausgepackt.

  3. DIE QUELLEN WERDEN UMGESCHRIEBEN. Im Rezept stehen Pfade auf dem Laptop
     (`${MUPI_REPO:-$HOME/Downloads/mixpibox}/bin/nodejs/deploy.zip`). Auf der
     Box gibt es die nicht. Jede Quelle bekommt deshalb einen flachen Namen im
     Archiv, und das JSON nennt nur noch DIESEN — die Box sucht nichts und holt
     nichts.

WAS ES NICHT TUT
  * Es prueft die Schritte nicht auf Sinn. Was im Rezept steht, wird
    mitgegeben; ob es laeuft, zeigt der Lauf.
  * Es nimmt keine Geheimnisse mit. Was an Zugaengen fehlt, traegt spaeter der
    Eltern-Bereich ein.
"""
import hashlib
import json
import os
import re
import tarfile
import tempfile

# Die Module, die der Selbstfahrer fuer Umgebungserkennung und `when:` braucht.
# Alle reine Standardbibliothek — core.py faengt fehlendes PyYAML selbst ab.
MITFAHRER = [
    ("controller", "core.py"),
    ("controller", "model.py"),
    ("controller", "sysinfo.py"),
    ("controller", "hardware.py"),
    ("tools", "selbstlauf.py"),
]


def quelle_aufloesen(roh, repo, fork):
    """Einen `src:`-Eintrag zu einem echten Pfad machen. -> Pfad oder None."""
    pfad = re.sub(r"\$\{MUPI_REPO:-[^}]*\}", fork, roh)
    pfad = pfad.replace("${MUPI_REPO}", fork).replace("$MUPI_REPO", fork)
    pfad = os.path.expandvars(pfad.replace("$HOME", os.path.expanduser("~")))
    if "$" in pfad:
        return None                     # noch Variablen drin -> nicht entscheidbar
    if not os.path.isabs(pfad):
        pfad = os.path.join(repo, pfad)
    return pfad if os.path.exists(pfad) else None


def ablagename(roh, pfad):
    """Ein flacher, eindeutiger Name im Archiv.

    Der Basisname allein reicht NICHT: `config/services/librespot.service` und
    `tools/librespot.service` waeren dieselbe Ablage, und die zweite ueber-
    schriebe die erste — ein Fehler, den man erst am Geraet saehe, und dann als
    "der Dienst hat den falschen Inhalt". Ein kurzer Streuwert des ganzen Pfads
    davor macht das unmoeglich.
    """
    kurz = hashlib.sha1(roh.encode()).hexdigest()[:8]
    return f"{kurz}-{os.path.basename(pfad.rstrip('/'))}"


def rezept_wandeln(rezepte, repo, fork, sammeln):
    """YAML-Rezepte -> ein JSON-Rezept fuer die Box.

    `sammeln(quelle, ablage)` wird fuer jede mitzugebende Datei gerufen.
    Rueckgabe: (rezept_dict, fehlende_quellen).
    """
    import yaml

    schritte, env, fehlend = [], {}, []
    for rp in rezepte:
        with open(rp, encoding="utf-8") as f:
            d = yaml.safe_load(f) or {}
        # Die `env:` beider Rezepte zusammenlegen; das spaetere gewinnt, wie
        # beim Controller auch.
        env.update(d.get("env") or {})
        for s in d.get("steps") or []:
            neu = {k: v for k, v in s.items() if k != "put"}
            # Die Kennung muss ueber BEIDE Rezepte eindeutig sein — der Stand
            # merkt sich Kennungen, und zwei gleiche hiessen: der zweite
            # Schritt gilt als erledigt, ohne je gelaufen zu sein.
            neu["id"] = f"{os.path.splitext(os.path.basename(rp))[0]}:{s.get('id')}"
            puts = []
            for p in s.get("put") or []:
                pfad = quelle_aufloesen(p["src"], repo, fork)
                if not pfad:
                    fehlend.append(p["src"])
                    continue
                ablage = ablagename(p["src"], pfad)
                sammeln(pfad, ablage)
                eintrag = {"ablage": ablage, "dest": p["dest"],
                           "mode": p.get("mode")}
                # DER URSPRUENGLICHE NAME MUSS MIT: Ein Verzeichnis kommt als
                # .tgz an, und die Rezeptschritte entpacken es und greifen auf
                # den Namen ZU ("mupi-x/scripts/chromium-autostart.sh"). Die
                # Ablage heisst aber kollisionssicher "fdd2f0f0-scripts" — wer
                # danach packt, liefert ein Archiv mit falscher Wurzel. Am
                # Geraet, Schritt 37 von 53:
                #     install: cannot stat 'mupi-x/scripts/chromium-autostart.sh'
                if os.path.isdir(pfad):
                    eintrag["wurzel"] = os.path.basename(pfad.rstrip("/"))
                puts.append(eintrag)
            if puts:
                neu["put"] = puts
            schritte.append(neu)
    return {"env": env, "steps": schritte}, fehlend


def paket_bauen(ziel_tgz, rezepte, repo, fork, melden=None):
    """Das Archiv schreiben. -> (anzahl_schritte, anzahl_dateien, fehlend)."""
    sag = melden or (lambda s: None)
    gesammelt = {}

    def sammeln(pfad, ablage):
        gesammelt[ablage] = pfad

    rezept, fehlend = rezept_wandeln(rezepte, repo, fork, sammeln)

    os.makedirs(os.path.dirname(ziel_tgz) or ".", exist_ok=True)
    with tarfile.open(ziel_tgz, "w:gz") as tar:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                         encoding="utf-8") as f:
            json.dump(rezept, f)
            tmp = f.name
        try:
            tar.add(tmp, arcname="rezept.json")
        finally:
            os.unlink(tmp)

        for ordner, datei in MITFAHRER:
            q = os.path.join(repo, ordner, datei)
            if os.path.isfile(q):
                tar.add(q, arcname=datei)
            else:
                sag(f"  fehlt (Mitfahrer): {ordner}/{datei}")

        for ablage, pfad in sorted(gesammelt.items()):
            tar.add(pfad, arcname=os.path.join("dateien", ablage))

    sag(f"  {len(rezept['steps'])} Schritte, {len(gesammelt)} Dateien/Ordner")
    if fehlend:
        sag(f"  NICHT gefunden: {len(fehlend)} Quelle(n) — {', '.join(fehlend[:3])}")
    return len(rezept["steps"]), len(gesammelt), fehlend
