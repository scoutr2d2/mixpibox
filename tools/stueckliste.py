#!/usr/bin/env python3
"""Stueckliste der Box: was eine funktionierende Installation WIRKLICH hat.

WOZU: Die Rezepte legen keine einzige Paketfassung fest — `apt-get install -y
mplayer` holt, was an dem Tag da ist. Damit ist die Installation ein Rolling
Release, und der Zeitpunkt entscheidet, was eine Box bekommt. Zwei Boxen im
Abstand von Monaten sind nicht dieselbe Box.

Das ist so gewollt (Sicherheitsupdates), aber es kostet jedes Mal eine ganze
Sitzung, wenn es schiefgeht: Das Wissenspaket ist im Kern ein Katalog dieser
Faelle — mupi-nodesource-trixie, mupi-max98357a-trixie-silent,
mupi-rpi-eeprom-trixie, librespot-versionen-2026. Jedes Mal hatte sich draussen
etwas bewegt, und jedes Mal begann die Suche bei null, weil niemand wusste, was
die funktionierende Box vorher hatte.

Dieses Werkzeug schreibt es auf. Nicht um es einzufrieren, sondern um die Frage
"was hat sich seither bewegt?" in einer Zeile zu beantworten.

DIE PAKETLISTE WIRD NICHT GEPFLEGT, SONDERN GELESEN: Sie kommt aus den
`apt-get install`-Zeilen der Rezepte selbst. Eine abgeschriebene Liste waere
in dem Moment falsch, in dem jemand ein Paket ergaenzt — und niemand haette es
gemerkt. Dasselbe Prinzip wie beim Auslesen der wirksamen ExecStart-Zeile in
librespot-warten-messen.sh: die Quelle fragen, nicht das Gedaechtnis.

WAS ES NICHT TUT
  * Es AENDERT NICHTS — weder an der Box noch an den Rezepten. Nur lesen.
  * Es pinnt nichts. Die Stueckliste ist ein Protokoll, keine Vorgabe. Der
    Rezeptschritt 'stueckliste' MELDET Abweichungen und laesst sie durch.
  * Es prueft nicht, ob eine Fassung gut ist. Es sagt nur, welche da war.

AUFRUF
    tools/stueckliste.py <box>                zeigen
    tools/stueckliste.py <box> --schreiben    nach dateien/stueckliste.txt
    tools/stueckliste.py <box> --vergleichen  Box gegen die abgelegte Liste
    tools/stueckliste.py --pakete             nur: welche Pakete die Rezepte anfassen

Der Installer liegt seit dem 08.08.2026 IM BAUM (`remote-step-installer/`).
Der Ort kommt aus $RSI_REPO, sonst aus dem Baum, sonst aus dem alten
Nachbarordner ~/Downloads/remote-step-installer (Rueckfall fuer aeltere Staende).
"""

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

# Flags und Zuweisungen, die in einer apt-Zeile stehen, aber keine Pakete sind.
KEIN_PAKET = re.compile(
    r"^(-|\$|\{|\}|\||&|;|\)|\(|DEBIAN_FRONTEND=|apt-get|apt|install|sudo|then|fi|do|done|echo)"
)
# Aus diesen Rezeptfeldern werden Shell-Zeilen gelesen.
RUN_FELDER = ("run", "check")


def installer_repo() -> Path:
    for kandidat in (
        os.environ.get("RSI_REPO"),
        Path(__file__).resolve().parent.parent / "remote-step-installer",
        Path.home() / "Downloads" / "remote-step-installer",
        Path(__file__).resolve().parent.parent.parent / "remote-step-installer",
    ):
        if kandidat and Path(kandidat).is_dir():
            return Path(kandidat)
    sys.exit("Installer-Repo nicht gefunden — $RSI_REPO setzen.")


def shell_zeilen(knoten):
    """Alle Shell-Texte aus einem Rezeptbaum einsammeln (auch aus workarounds)."""
    if isinstance(knoten, dict):
        for schluessel, wert in knoten.items():
            if schluessel in RUN_FELDER and isinstance(wert, str):
                yield wert
            else:
                yield from shell_zeilen(wert)
    elif isinstance(knoten, list):
        for eintrag in knoten:
            yield from shell_zeilen(eintrag)


def pakete_aus_rezepten(repo: Path) -> list[str]:
    """Die Paketnamen aus allen `apt-get install`-Aufrufen der Rezepte."""
    import yaml

    gefunden: set[str] = set()
    for rezept in sorted((repo / "recipes").glob("*.yaml")):
        with open(rezept, encoding="utf-8") as datei:
            baum = yaml.safe_load(datei)
        for text in shell_zeilen(baum):
            # Fortsetzungszeilen (`\` am Ende) zusammenziehen, sonst reisst der
            # Aufruf mitten in der Paketliste ab und die Haelfte fehlt.
            text = text.replace("\\\n", " ")
            for zeile in text.splitlines():
                # An JEDER Fundstelle zerlegen, nicht per finditer suchen: in
                # `apt-get install A || apt-get install B` verschluckt ein
                # gieriges `.*` den zweiten Aufruf, und der Rueckfall (hier
                # libasound2) fehlte lautlos in der Stueckliste.
                for teil in re.split(r"apt(?:-get)?\s+install\s+", zeile)[1:]:
                    # Am ersten Shell-Trenner abschneiden — dahinter stehen
                    # keine Paketnamen mehr, sondern der naechste Befehl.
                    rest = re.split(r"[;|&]|\|\|", teil)[0]
                    for wort in rest.split():
                        if KEIN_PAKET.match(wort):
                            continue
                        gefunden.add(wort)
    return sorted(gefunden)


def auf_box(box: str, befehl: str) -> str:
    ergebnis = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{box}", befehl],
        capture_output=True,
        text=True,
        timeout=120,
    )
    return ergebnis.stdout


def stueckliste_holen(box: str, pakete: list[str]) -> list[tuple[str, str, str]]:
    """Liefert (bereich, name, fassung) — sortiert und vergleichbar."""
    zeilen: list[tuple[str, str, str]] = []

    system = auf_box(
        box,
        "cat /proc/device-tree/model 2>/dev/null | tr -d '\\0'; echo; "
        ". /etc/os-release && echo \"$PRETTY_NAME\"; "
        "uname -r; "
        # .version ist eine Shell-Datei mit Zuweisungen — einlesen, nicht
        # zusammenkleben, sonst steht dort G_DIETPI_VERSION_CORE=10.G_… drin.
        "( . /boot/dietpi/.version 2>/dev/null && "
        'echo "$G_DIETPI_VERSION_CORE.$G_DIETPI_VERSION_SUB.$G_DIETPI_VERSION_RC" ) || echo -',
    ).splitlines()
    for name, wert in zip(("modell", "os", "kern", "dietpi"), system):
        zeilen.append(("system", name, wert.strip() or "-"))

    # dpkg-query in EINEM Aufruf: 25 einzelne ssh-Runden dauern eine Minute.
    roh = auf_box(
        box,
        "dpkg-query -W -f='${Package}\\t${Version}\\n' " + " ".join(pakete) + " 2>/dev/null",
    )
    vorhanden = {}
    for zeile in roh.splitlines():
        if "\t" in zeile:
            name, fassung = zeile.split("\t", 1)
            # dpkg kennt auch Pakete, die NICHT installiert sind (Rueckfaelle
            # wie libasound2, auf Trixie von libasound2t64 abgeloest). Die
            # kommen mit LEERER Fassung zurueck — eine leere Spalte saehe im
            # Vergleich aus wie ein Lesefehler.
            vorhanden[name] = fassung.strip() or "nicht installiert"
    for paket in pakete:
        # NICHT weglassen, wenn es fehlt: "war nie da" und "ist verschwunden"
        # sind zwei verschiedene Befunde, und nur einer davon ist harmlos.
        zeilen.append(("apt", paket, vorhanden.get(paket, "nicht installiert")))

    sonstige = auf_box(
        box,
        "node --version 2>/dev/null || echo -; "
        "/usr/bin/librespot --version 2>/dev/null | head -1 || echo -; "
        "chromium --version 2>/dev/null | head -1 || echo -",
    ).splitlines()
    for name, wert in zip(("nodejs", "librespot", "chromium"), sonstige):
        zeilen.append(("sonstige", name, wert.strip() or "-"))

    return zeilen


def schreiben(zeilen, ziel: Path, box: str) -> None:
    kopf = [
        "# Stueckliste der MuPiBox — was eine FUNKTIONIERENDE Box wirklich hatte.",
        "#",
        "# KEINE VORGABE, SONDERN EIN PROTOKOLL. Die Rezepte pinnen bewusst nichts;",
        "# der Schritt 'stueckliste' vergleicht eine neue Installation hiergegen und",
        "# MELDET Abweichungen, ohne sie zu verhindern. Wenn eine frische Box stumm",
        "# oder schwarz ist, steht die Antwort auf 'was hat sich bewegt?' in seiner",
        "# Ausgabe statt am Ende einer Suchsitzung.",
        "#",
        f"# Erzeugt am {date.today().isoformat()} von {box} mit tools/stueckliste.py",
        "# Neu erzeugen, sobald eine Box nachweislich rundlaeuft — NICHT von einer,",
        "# die gerade repariert wird.",
        "#",
        "# Format: bereich <TAB> name <TAB> fassung",
        "",
    ]
    ziel.write_text(
        "\n".join(kopf + [f"{b}\t{n}\t{f}" for b, n, f in zeilen]) + "\n", encoding="utf-8"
    )


def lesen(quelle: Path) -> dict[tuple[str, str], str]:
    abgelegt = {}
    for zeile in quelle.read_text(encoding="utf-8").splitlines():
        if zeile.startswith("#") or not zeile.strip():
            continue
        teile = zeile.split("\t")
        if len(teile) == 3:
            abgelegt[(teile[0], teile[1])] = teile[2]
    return abgelegt


def main() -> int:
    argumente = [a for a in sys.argv[1:] if not a.startswith("--")]
    schalter = {a for a in sys.argv[1:] if a.startswith("--")}
    repo = installer_repo()
    ziel = repo / "dateien" / "stueckliste.txt"

    pakete = pakete_aus_rezepten(repo)
    if "--pakete" in schalter:
        print(f"{len(pakete)} Pakete, aus {repo / 'recipes'} gelesen:")
        for paket in pakete:
            print("   ", paket)
        return 0

    if not argumente:
        print(__doc__.split("AUFRUF")[1].strip(), file=sys.stderr)
        return 2
    box = argumente[0]

    print(f"── {len(pakete)} Pakete aus den Rezepten, Box {box} wird gelesen …")
    zeilen = stueckliste_holen(box, pakete)

    if "--vergleichen" in schalter:
        if not ziel.exists():
            print(f"Keine abgelegte Stueckliste unter {ziel} — erst --schreiben.")
            return 1
        abgelegt = lesen(ziel)
        abweichungen = 0
        for bereich, name, jetzt in zeilen:
            frueher = abgelegt.get((bereich, name))
            if frueher is None:
                print(f"  NEU      {name}: {jetzt}")
                abweichungen += 1
            elif frueher != jetzt:
                print(f"  ANDERS   {name}: {frueher}  ->  {jetzt}")
                abweichungen += 1
        jetzt_bekannt = {(b, n) for b, n, _ in zeilen}
        for (bereich, name), frueher in abgelegt.items():
            if (bereich, name) not in jetzt_bekannt:
                print(f"  ENTFALLEN {name}: war {frueher}")
                abweichungen += 1
        print(f"── {abweichungen} Abweichung(en) gegenueber {ziel.name}")
        return 0

    if "--schreiben" in schalter:
        schreiben(zeilen, ziel, box)
        print(f"── geschrieben nach {ziel} ({len(zeilen)} Eintraege)")
        return 0

    breite = max(len(n) for _, n, _ in zeilen)
    for bereich, name, fassung in zeilen:
        print(f"    {bereich:9} {name:{breite}}  {fassung}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
