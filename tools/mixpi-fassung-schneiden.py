#!/usr/bin/env python3
"""EINE MIXPIBOX-FASSUNG SCHNEIDEN — Artefakt, Pruefsumme, Kanaleintrag, Marke.

WOZU. `scripts/box/mixpi-zieher.py` holt sich Fassungen aus `version.json`.
Die Kanaele sind leer, und solange sie es sind, ist der Zieher ein Weg ohne
Ziel. Dieses Werkzeug fuellt sie — und zwar so, dass jeder Eintrag die
Zusagen einhaelt, auf die der Zieher sich verlaesst.

WAS ES NICHT ENTSCHEIDET, und warum das Absicht ist
WO das Artefakt liegt, ist eine Frage der Umgebung und keine des Werkzeugs:
Gitea-Anhang, ein Verzeichnis am Webserver, ein NAS-Pfad. Deshalb nimmt es die
Basisadresse als Angabe (`--unter`) und legt die Datei in eine Ablage
(`--ablage`). Es laedt NICHTS hoch — Hochladen ist der eine Schritt, der von
aussen sichtbar wird, und der gehoert einem Menschen. Am Ende steht genau da,
was noch zu tun ist.

DIE ZUSAGEN, die es fuer den Zieher einloest
  * REPRODUZIERBAR. Ein Schnitt aus einem schmutzigen Baum ist keiner: die
    Fassung waere aus einem Zustand gebaut, den es nirgends mehr gibt. Ohne
    sauberen Baum bricht es ab.
  * DAS PAKET PASST ZUM QUELLTEXT. `tools/mixpi-paketfrische-pruefen.py` wird
    GERUFEN, nicht nachgebaut. Ist es rot, wird nicht geschnitten — sonst
    veroeffentlichte man eine Fassung, deren Nummer neu und deren Inhalt alt
    ist. Genau das war der Fall vom 31.08.2026.
  * PRUEFSUMME. `sha256` steht am Eintrag, gemessen an der Datei, die in der
    Ablage landet — nicht an der im Baum, denn kopiert wird danach.
  * EIGENE NAMENSFORM. `vX.Y.Z`, `vX.Y.Z-beta.N`, `vX.Y.Z-dev.N`. Das fuehrende
    `v` trennt MixPiBox-Fassungen von den nackten Upstream-Marken (4.2.4), die
    im selben Repo liegen. Ein Name ohne `v` wird abgelehnt.
  * KEINE MARKE ZWEIMAL. Gibt es die Marke schon, ist Schluss — eine Fassung,
    die auf zwei Staende zeigt, ist schlimmer als keine.

WAS ES BEWUSST NICHT TUT
  * Es signiert nicht. Der Zieher verlangt eine Signatur nur, wenn auf der Box
    ein Schluessel liegt; wer den Weg gehen will, legt `signatur` von Hand nach
    (base64 aus `openssl dgst -sha256 -sign`). Ein Werkzeug, das den privaten
    Schluessel anfasst, gehoert nicht in einen Baum, in dem 900 andere liegen.
  * Es schiebt nicht (`git push`) und laedt nicht hoch. Beides ist nach aussen
    sichtbar und bleibt eine Entscheidung.

Aufruf aus dem Wurzelverzeichnis:
    python3 tools/mixpi-fassung-schneiden.py --fassung v1.1.0 \\
        --unter http://git.local:3000/achim/box/releases/download
    python3 tools/mixpi-fassung-schneiden.py --fassung v1.1.0-beta.1 --kanal beta
    python3 tools/mixpi-fassung-schneiden.py --fassung v1.1.0 --probe   # nur zeigen
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "bin" / "nodejs" / "deploy.zip"
VERSIONSDATEI = WURZEL / "version.json"
FRISCHE = WURZEL / "tools" / "mixpi-paketfrische-pruefen.py"

# vX.Y.Z, dazu -beta.N / -dev.N. Bewusst eng: was hier durchkommt, muss der
# Zieher vergleichen koennen (`zerlege()` in mixpi-zieher.py schneidet am `-`).
FORM = re.compile(r"^v\d+\.\d+\.\d+(-(beta|dev)\.\d+)?$")


def git(*args: str) -> tuple[int, str]:
    e = subprocess.run(["git", "-C", str(WURZEL), *args],
                       capture_output=True, text=True, timeout=60)
    return e.returncode, e.stdout.strip()


def sha256_datei(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def paket_umstempeln(quelle: Path, ziel: Path, fassung: str) -> bool:
    """Das Paket nach `ziel` schreiben und dabei `herkunft.json` die
    veroeffentlichte Fassung geben. Alles andere bleibt Byte fuer Byte.

    Umgeschrieben statt ergaenzt: die Box liest GENAU diese Datei, um zu sagen,
    was sie faehrt (`herkunftLesen()` in server.ts). Ein zweites Feld daneben
    haetten zwei Wahrheiten ergeben, und der Vergleich haette weiter die falsche
    genommen.
    """
    try:
        with zipfile.ZipFile(quelle) as alt:
            if "herkunft.json" not in alt.namelist():
                print("  Das Paket traegt kein herkunft.json — nichts zu stempeln.")
                return False
            stempel = json.loads(alt.read("herkunft.json").decode("utf-8"))
            stempel["version"] = fassung
            neu_inhalt = (json.dumps(stempel, indent=2) + "\n").encode("utf-8")
            with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as neu:
                for eintrag in alt.infolist():
                    if eintrag.filename == "herkunft.json":
                        kopf = zipfile.ZipInfo("herkunft.json", eintrag.date_time)
                        kopf.compress_type = zipfile.ZIP_DEFLATED
                        kopf.external_attr = eintrag.external_attr
                        neu.writestr(kopf, neu_inhalt)
                    else:
                        # Rechte und Zeitstempel unveraendert uebernehmen — ein
                        # Paket, dessen Dateien sich nach dem Auspacken anders
                        # verhalten, faellt erst an der Box auf.
                        neu.writestr(eintrag, alt.read(eintrag.filename))
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        print(f"  Umstempeln gescheitert: {e}")
        return False
    print(f"  herkunft.json im Paket traegt jetzt version={fassung}")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fassung", required=True, help="vX.Y.Z bzw. vX.Y.Z-beta.N")
    p.add_argument("--kanal", default="stable", choices=("stable", "beta", "dev"))
    p.add_argument("--unter", default="",
                   help="Basisadresse, unter der das Artefakt spaeter liegt")
    p.add_argument("--ablage", default=str(WURZEL / "dev" / "fassungen"),
                   help="wohin die Datei gelegt wird (nicht im Index)")
    p.add_argument("--info", default="", help="releaseinfo fuer den Eintrag")
    p.add_argument("--probe", action="store_true", help="nur zeigen, nichts aendern")
    a = p.parse_args()

    print(f"── Fassung schneiden: {a.fassung} ({a.kanal}) ──")

    if not FORM.match(a.fassung):
        print(f"  `{a.fassung}` passt nicht auf die Namensform.")
        print("  Erlaubt: vX.Y.Z, vX.Y.Z-beta.N, vX.Y.Z-dev.N — mit fuehrendem `v`,")
        print("  damit sich eigene Fassungen von den Upstream-Marken (4.2.4) trennen.")
        return 1

    # ── Der Baum muss sauber sein ────────────────────────────────────────────
    rc, schmutz = git("status", "--porcelain")
    verfolgt = [z for z in schmutz.splitlines() if z and not z.startswith("??")]
    if verfolgt:
        print(f"  {len(verfolgt)} geaenderte, nicht eingecheckte Datei(en):")
        for z in verfolgt[:8]:
            print(f"    {z}")
        print("  Eine Fassung aus einem schmutzigen Baum liesse sich nie wieder")
        print("  herstellen. Erst einchecken.")
        return 1

    rc, kopf = git("rev-parse", "HEAD")
    if rc != 0:
        print("  HEAD nicht aufloesbar.")
        return 1

    # ── Gibt es die Marke schon? ─────────────────────────────────────────────
    rc, _ = git("rev-parse", "-q", "--verify", f"refs/tags/{a.fassung}")
    if rc == 0:
        print(f"  Die Marke {a.fassung} gibt es schon. Eine Fassung, die auf zwei")
        print("  Staende zeigt, ist schlimmer als keine.")
        return 1

    # ── Passt das Paket zum Quelltext? Gerufen, nicht nachgebaut. ────────────
    print("  Paketfrische (gerufen, nicht nachgebaut) …")
    e = subprocess.run([sys.executable, str(FRISCHE)], capture_output=True, text=True)
    if e.returncode != 0:
        for z in e.stdout.splitlines()[-12:]:
            print(f"    {z}")
        print("  Das eingecheckte Paket ist nicht der Stand dieses Baums.")
        print("  Erst bauen:  bash src/deploy.sh")
        return 1
    print("    das Paket ist der Stand dieses Baums.")

    if not PAKET.is_file():
        print(f"  {PAKET} fehlt.")
        return 1

    # ── Der Eintrag ──────────────────────────────────────────────────────────
    ablage = Path(a.ablage)
    dateiname = f"mixpibox-{a.fassung}.zip"
    ziel = ablage / dateiname
    summe = sha256_datei(PAKET)
    adresse = f"{a.unter.rstrip('/')}/{a.fassung}/{dateiname}" if a.unter else ""

    eintrag = {
        "version": a.fassung,
        "url": adresse,
        "sha256": summe,
        "releaseinfo": a.info or f"MixPiBox {a.fassung}",
        "commit": kopf,
    }

    print()
    print(f"  Artefakt   {dateiname}  ({PAKET.stat().st_size / 1e6:.1f} MB)")
    print(f"  sha256     {summe}")
    print(f"  Commit     {kopf[:12]}")
    print(f"  Adresse    {adresse or '— (ohne --unter bleibt sie leer)'}")

    if not adresse:
        print()
        print("  OHNE ADRESSE IST DER EINTRAG WERTLOS: der Zieher braucht `url`, um")
        print("  das Artefakt zu holen, und ueberspringt Eintraege ohne sie.")
        print("  Mit --unter <basis> setzen.")
        if not a.probe:
            return 1

    if a.probe:
        print()
        print("  --probe: nichts geaendert.")
        print("  Der Eintrag saehe so aus:")
        print("    " + json.dumps(eintrag, ensure_ascii=False, indent=2).replace("\n", "\n    "))
        return 0

    # ── Schreiben ────────────────────────────────────────────────────────────
    #
    # ══ DIE FASSUNG MUSS INS PAKET, SONST SETZT SICH DAS UPDATE NIE ══════════
    # Am 31.08.2026 an Box .79 gemessen: nach einem vollstaendig geglueckten
    # Lauf meldete die Aktualisierungsseite weiter „installiert 1.0.0,
    # angeboten v1.1.0". Der Grund liegt in src/deploy.sh: `herkunft.json`
    # bekommt seine `version` aus `package.json` — und die steht seit jeher auf
    # 1.0.0 und hat mit der VEROEFFENTLICHTEN Fassung nichts zu tun.
    #
    # Die Folge waere kein Schoenheitsfehler: `beurteile()` vergleicht genau
    # diese beiden Zahlen. Auf einer Box ohne Eigenbau bliebe das Urteil ewig
    # „neuer", die Seite boete dasselbe Update endlos wieder an, und wer darauf
    # drueckt, spielt jedes Mal dieselbe Fassung ein.
    #
    # Deshalb wird das Paket beim Schneiden umgestempelt: `herkunft.json`
    # bekommt die Fassung, unter der es veroeffentlicht wird. Erst damit kann
    # eine Box sagen „ich fahre v1.1.0" statt „ich fahre irgendein 1.0.0".
    ablage.mkdir(parents=True, exist_ok=True)
    if not paket_umstempeln(PAKET, ziel, a.fassung):
        return 1
    # Die Summe gilt fuer die Datei, die der Zieher wirklich holt — also fuer
    # die UMGESTEMPELTE. Die oben gegen PAKET gemessene ist damit hinfaellig.
    summe = sha256_datei(ziel)
    eintrag["sha256"] = summe
    print(f"\n  gelegt: {ziel}")
    print(f"  sha256 nach dem Umstempeln: {summe}")

    verzeichnis = json.loads(VERSIONSDATEI.read_text(encoding="utf-8"))
    verzeichnis.setdefault("release", {}).setdefault(a.kanal, []).append(eintrag)
    # `version` oben ist die Fassung, die DIESER Baum traegt — sie zieht mit,
    # sonst benennt scripts/make-boot-sd.sh die naechste Karte nach der alten.
    verzeichnis["version"] = a.fassung
    VERSIONSDATEI.write_text(
        json.dumps(verzeichnis, ensure_ascii=False, indent="\t") + "\n",
        encoding="utf-8")
    print(f"  eingetragen in version.json unter `{a.kanal}`")

    rc, _ = git("tag", "-a", a.fassung, "-m", f"MixPiBox {a.fassung}")
    if rc != 0:
        print("  WARNUNG: die Marke liess sich nicht setzen.")
    else:
        print(f"  Marke {a.fassung} gesetzt (lokal).")

    print()
    print("  ES FEHLT NOCH — beides bewusst von Hand, weil es nach aussen wirkt:")
    print(f"    1. {ziel.name} nach {adresse} hochladen")
    print(f"    2. version.json einchecken, dann: git push && git push origin {a.fassung}")
    print("  Danach findet der Zieher die Fassung:")
    print("       mixpi-zieher.py --lage")
    return 0


if __name__ == "__main__":
    sys.exit(main())
