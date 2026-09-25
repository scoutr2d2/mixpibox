#!/usr/bin/env python3
"""MIXPIBOX-FASSUNGEN UEBER GITHUB — bauen (Runner), signieren (lokal), Kanaele (Runner).

WOZU (25.09.2026). Die Box holt sich Fassungen selbst (scripts/box/mixpi-zieher.py):
Kanal waehlen, den neuesten Eintrag nehmen, sha256 und — wenn auf der Box ein
Schluessel liegt — die Signatur pruefen, unteilbar tauschen, notfalls
zurueckdrehen. Es fehlte die Gegenseite: ein Ort, der Artefakte und Verzeichnis
ausliefert. Das ist jetzt GitHub, weil das Repo oeffentlich ist und die Box
ohne Zugangsdaten laden kann.

  Betreiber, 25.09.2026: das Artefakt wird „auf GitHub gebaut", signiert wird
  „lokal" — der private Schluessel verlaesst den Arbeitsrechner nie.

══ DER WEG, UND WER WAS TUT ════════════════════════════════════════════════

  1. bauen       Runner (.github/workflows/fassung.yml, von Hand gestartet).
                 src/deploy.sh baut das Paket GENAU wie auf dem Arbeitsrechner;
                 hier wird es auf die Fassung umgestempelt (quelle = GitHub,
                 eigeneCommits = 0) und als ENTWURF eines Releases abgelegt.
                 Ein Entwurf ist fuer keine Box sichtbar.
     befoerdern  Derselbe Workflow mit „von": nimmt das SIGNIERTE Paket einer
                 Vorstufe (v1.2.0-beta.3) und benennt es um (v1.2.0) —
                 dieselben Bytes, die als Beta draussen liefen, kein Neubau
                 vom heutigen main.
  2. signieren   Lokal. Holt den Entwurf, prueft Summe und Herkunft, signiert,
                 prueft die Signatur gegen den EINGECHECKTEN oeffentlichen
                 Schluessel, laedt die .sig hoch und veroeffentlicht.
  3. kanaele     Runner (.github/workflows/kanaele.yml, bei jedem
                 Release-Ereignis). Baut version.json aus ALLEN
                 veroeffentlichten Releases, prueft jede Signatur selbst nach
                 und legt das Verzeichnis auf GitHub Pages.

WARUM LOKAL SIGNIEREN: die sha256 steht im selben Verzeichnis wie die Adresse.
Wer das GitHub-Konto uebernimmt, faelscht beide — und haette mit einem
Schluessel als GitHub-Secret auch die Signatur. Liegt der Schluessel nur auf
dem Arbeitsrechner, lehnt jede Box ab, auf der /etc/mupibox/mixpi-release.pub
liegt (mixpi-zieher.py `signatur_pruefen`).

══ DIE KANAELE ═════════════════════════════════════════════════════════════

Der Kanal steht im NAMEN, nirgends sonst — dieselbe Namensform wie
tools/mixpi-fassung-schneiden.py (`FORM`, von dort geholt):

    v1.2.0          stable   GitHub: normales Release
    v1.2.0-beta.3   beta     GitHub: Vorabversion
    v1.2.0-dev.7    dev      GitHub: Vorabversion

DIE LISTEN SCHLIESSEN SICH EIN: beta fuehrt stable mit, dev fuehrt alles. Die
Box nimmt den LETZTEN Eintrag ihres Kanals (`neuestes_angebot`). Ohne
Einschluss saesse eine Beta-Box auf `v1.2.0-beta.3`, waehrend stable laengst
bei `v1.3.0` ist — sie bekaeme erst mit der naechsten Beta wieder etwas.
Geordnet wird mit `zerlege()` AUS DEM ZIEHER (dev < beta < fertig, nicht
alphabetisch), nicht nachgebaut: eine zweite Ordnung liefe auseinander, und
dann boete das Verzeichnis etwas an, das die Box fuer aelter haelt
([[vierzehn-kopien-und-die-abweichung-ist-der-fehler]]).

══ WAS NICHT INS VERZEICHNIS KOMMT ═════════════════════════════════════════

  * Entwuerfe (unsichtbar, und unsigniert).
  * Releases, deren Name nicht die Form hat (uebergangen, gemeldet).
  * Releases ohne `<fassung>.zip.sig`, mit falscher Signatur, mit einer Summe,
    die nicht zur `.sha256` passt, oder deren herkunft.json eine andere
    Fassung nennt (eine Box spielte sie ein und boete sie danach ewig wieder
    an). Diese werden AUSGESCHLOSSEN, und der Lauf wird am Ende rot — aber
    erst NACH dem Veroeffentlichen der uebrigen: ein falsch signiertes Release
    darf nicht die Updates aller anderen blockieren.

AUFRUF
  python3 tools/mixpi-github-fassung.py schluessel-erzeugen [--privat PFAD]
  python3 tools/mixpi-github-fassung.py signieren --fassung v1.2.0 [--veroeffentlichen]
  python3 tools/mixpi-github-fassung.py bauen --fassung v1.2.0 --aus DIR     (Runner)
  python3 tools/mixpi-github-fassung.py befoerdern --von v1.2.0-beta.3 --fassung v1.2.0 --aus DIR  (Runner)
  python3 tools/mixpi-github-fassung.py kanaele --releases R.json --aus DIR  (Runner)
  python3 tools/mixpi-github-fassung.py box-einrichten --kanal beta          (Box, root)
  python3 tools/mixpi-github-fassung.py --selbsttest

Die ganze Anleitung: dokumentation/mixpibox.md, Abschnitt 7.16.
"""

from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
OEFFENTLICH = WURZEL / "config" / "mixpi-release.pub"
PRIVAT_VORGABE = Path.home() / ".config" / "mixpibox" / "mixpi-release.key"
REPO_VORGABE = os.environ.get("GITHUB_REPOSITORY") or "scoutr2d2/mixpibox"
SERVER = os.environ.get("GITHUB_SERVER_URL") or "https://github.com"

# Auf der Box: dieselben Orte und dieselben Umgebungsnamen wie der Zieher —
# zwei Namen fuer dieselbe Datei waeren der Fehler vom 31.08.2026 noch einmal
# (Wiki: die Box war fuer den Zieher eingerichtet, die Seite sah nichts).
BOX_EINSTELLUNG = os.environ.get("MIXPI_EINSTELLUNG") or "/etc/mupibox/mixpi-update.json"
BOX_SCHLUESSEL = os.environ.get("MIXPI_SCHLUESSEL") or "/etc/mupibox/mixpi-release.pub"

KANAELE = ("stable", "beta", "dev")
# Welche Stufen eine Kanal-Liste fuehrt (Begruendung im Kopf).
EINSCHLUSS = {
    "stable": ("stable",),
    "beta": ("stable", "beta"),
    "dev": ("stable", "beta", "dev"),
}


def _modul(name: str, pfad: Path):
    spec = importlib.util.spec_from_file_location(name, pfad)
    m = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(m)
    return m


# GEHOLT, NICHT NACHGEBAUT: Namensform und Umstempeln aus dem Schnitt-Werkzeug,
# Ordnung, Quellvergleich und das Lesen eines Kanals aus dem Zieher selbst.
SCHNEIDEN = _modul("mixpi_fassung_schneiden", WURZEL / "tools" / "mixpi-fassung-schneiden.py")
ZIEHER = _modul("mixpi_zieher", WURZEL / "scripts" / "box" / "mixpi-zieher.py")
FORM = SCHNEIDEN.FORM
sha256_datei = SCHNEIDEN.sha256_datei


def _zeige(p: Path) -> str:
    """Pfad fuer Meldungen: relativ zum Baum, wenn er darin liegt."""
    try:
        return str(p.relative_to(WURZEL))
    except ValueError:
        return str(p)


def repo_adresse(repo: str) -> str:
    return f"{SERVER.rstrip('/')}/{repo}"


def feed_adresse(repo: str) -> str:
    besitzer, name = repo.split("/", 1)
    return f"https://{besitzer.lower()}.github.io/{name}/version.json"


def kanal_von(fassung: str) -> str | None:
    m = FORM.match(fassung or "")
    if not m:
        return None
    return m.group(2) or "stable"


def herkunft_im_paket(zip_pfad: Path) -> dict | None:
    try:
        with zipfile.ZipFile(zip_pfad) as z:
            return json.loads(z.read("herkunft.json").decode("utf-8"))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return None


def herkunft_passt(stempel: dict | None, fassung: str) -> str | None:
    """None, wenn die Herkunft zur Fassung passt — sonst der Grund."""
    if not stempel:
        return "kein lesbares herkunft.json im Paket"
    if stempel.get("version") != fassung:
        return (f"herkunft.json nennt `{stempel.get('version')}` statt `{fassung}` — "
                "die Box boete dieselbe Fassung danach endlos wieder an")
    if int(stempel.get("eigeneCommits") or 0) or int(stempel.get("unsauber") or 0):
        return ("herkunft.json traegt eigeneCommits/unsauber > 0 — eine Box, die das "
                "einspielt, gilt danach als `eigenbau` und nimmt kein Update mehr an")
    return None


def openssl(*argumente: str) -> subprocess.CompletedProcess:
    return subprocess.run(["openssl", *argumente], capture_output=True, text=True)


def signatur_gilt(schluessel: Path, sig: Path, datei: Path) -> bool:
    """Genau die Pruefung, die die Box faehrt (mixpi-zieher.py `signatur_pruefen`)."""
    return openssl("dgst", "-sha256", "-verify", str(schluessel),
                   "-signature", str(sig), str(datei)).returncode == 0


def github_ausgabe(**werte: str) -> None:
    ziel = os.environ.get("GITHUB_OUTPUT")
    if ziel:
        with open(ziel, "a", encoding="utf-8") as f:
            for k, v in werte.items():
                f.write(f"{k}={v}\n")


def github_zusammenfassung(text: str) -> None:
    ziel = os.environ.get("GITHUB_STEP_SUMMARY")
    if ziel:
        with open(ziel, "a", encoding="utf-8") as f:
            f.write(text + "\n")


# ══ 1. BAUEN (Runner) ═══════════════════════════════════════════════════════

def bauen(a: argparse.Namespace) -> int:
    print(f"── Fassung bauen: {a.fassung} ──")
    kanal = kanal_von(a.fassung)
    if not kanal:
        print(f"  `{a.fassung}` passt nicht auf die Namensform vX.Y.Z, vX.Y.Z-beta.N, vX.Y.Z-dev.N.")
        return 1
    # src/deploy.sh schreibt bin/nodejs/deploy.zip — eine VERFOLGTE Datei. Auf
    # dem Runner ist das egal, auf dem Arbeitsrechner waere das eingecheckte
    # Paket danach ein anderes. Dort ist der Weg tools/mixpi-fassung-schneiden.py.
    if os.environ.get("GITHUB_ACTIONS") != "true" and not a.auch_lokal:
        print("  Das laeuft auf dem Runner (.github/workflows/fassung.yml). Hier wuerde")
        print("  src/deploy.sh das eingecheckte bin/nodejs/deploy.zip ueberschreiben.")
        print("  Wer es trotzdem will: --auch-lokal.")
        return 1

    umgebung = dict(os.environ, MUPI_OHNE_RUECKFRAGE="1")
    if subprocess.run(["bash", str(WURZEL / "src" / "deploy.sh")], env=umgebung).returncode != 0:
        print("  src/deploy.sh ist gescheitert — nichts gebaut.")
        return 1

    paket = WURZEL / "bin" / "nodejs" / "deploy.zip"
    aus = Path(a.aus)
    aus.mkdir(parents=True, exist_ok=True)
    ziel = aus / f"{a.fassung}.zip"
    kopf = os.environ.get("GITHUB_SHA") or subprocess.run(
        ["git", "-C", str(WURZEL), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    felder = {
        "quelle": repo_adresse(a.repo),
        "commit": kopf,
        "zweig": os.environ.get("GITHUB_REF_NAME") or "main",
        "gebautAm": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if not SCHNEIDEN.paket_umstempeln(paket, ziel, a.fassung, felder):
        return 1
    grund = herkunft_passt(herkunft_im_paket(ziel), a.fassung)
    if grund:
        print(f"  NACHWEIS GESCHEITERT: {grund}")
        return 1

    summe = sha256_datei(ziel)
    (aus / f"{ziel.name}.sha256").write_text(f"{summe}  {ziel.name}\n", encoding="utf-8")
    print(f"  {ziel}  ({ziel.stat().st_size / 1e6:.1f} MB)")
    print(f"  sha256  {summe}")
    print(f"  Kanal   {kanal}  —  Herkunft {felder['quelle']} @ {kopf[:12]}")
    github_ausgabe(kanal=kanal, vorab="false" if kanal == "stable" else "true")
    return 0


# ══ 1b. BEFOERDERN (Runner) — dieselben Bytes, neuer Name ════════════════════
#
# beta heisst „Stable-Kandidat" (mixpi-zieher.py, STUFEN). Wer aus
# v1.2.0-beta.3 die v1.2.0 NEU BAUTE, baute vom HEUTIGEN main — und das ist
# nicht mehr, was als Beta draussen lief. Befoerdert wird deshalb das
# signierte Paket der Vorstufe: geholt, gegen den eingecheckten Schluessel
# geprueft, nur `version` umgestempelt (Quelle und Commit bleiben die der
# Vorstufe). Signiert wird danach wieder lokal — der Name ist neu, also auch
# die Bytes.

def befoerderung_pruefen(von: str, nach: str) -> str | None:
    """None, wenn `von` → `nach` eine Befoerderung ist — sonst der Grund."""
    kv, kn = kanal_von(von), kanal_von(nach)
    if not kv or not kn:
        return "beide Namen muessen die Form vX.Y.Z[-beta.N|-dev.N] haben"
    zv, zn = ZIEHER.zerlege(von), ZIEHER.zerlege(nach)
    if zv is None or zn is None:
        return "Fassungsnummern nicht vergleichbar"
    if zv[0] != zn[0]:
        return (f"befoerdert wird innerhalb EINER Nummer ({von} → {'.'.join(map(str, zv[0]))}…); "
                "eine neue Nummer ist eine neue Fassung — bauen")
    if zn <= zv:
        return f"{nach} ist nicht neuer als {von} — das waere kein Befoerdern"
    return None


def befoerdern(a: argparse.Namespace) -> int:
    print(f"── Befoerdern: {a.von} → {a.fassung} ──")
    grund = befoerderung_pruefen(a.von, a.fassung)
    if grund:
        print(f"  {grund}")
        return 1
    if not OEFFENTLICH.is_file():
        print(f"  {_zeige(OEFFENTLICH)} fehlt — ungeprueft wird nichts befoerdert.")
        return 1
    ansicht = _gh("release", "view", a.von, "--repo", a.repo, "--json", "isDraft")
    if ansicht.returncode != 0 or json.loads(ansicht.stdout or "{}").get("isDraft", True):
        print(f"  {a.von} ist kein veroeffentlichtes Release — befoerdert wird nur, was draussen war.")
        return 1
    aus = Path(a.aus)
    aus.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mixpi-befoerdern-") as tmp:
        t = Path(tmp)
        zipname = f"{a.von}.zip"
        geholt = _gh("release", "download", a.von, "--repo", a.repo, "--dir", tmp,
                     "--pattern", zipname, "--pattern", f"{zipname}.sig")
        if geholt.returncode != 0:
            print(f"  Holen gescheitert: {geholt.stderr.strip()}")
            return 1
        paket, sig = t / zipname, t / f"{zipname}.sig"
        if not sig.is_file() or not signatur_gilt(OEFFENTLICH, sig, paket):
            print(f"  {a.von}: Signatur fehlt oder gilt nicht — nicht befoerdert.")
            return 1
        grund = herkunft_passt(herkunft_im_paket(paket), a.von)
        if grund:
            print(f"  {a.von}: {grund}")
            return 1
        ziel = aus / f"{a.fassung}.zip"
        if not SCHNEIDEN.paket_umstempeln(paket, ziel, a.fassung):
            return 1
    grund = herkunft_passt(herkunft_im_paket(ziel), a.fassung)
    if grund:
        print(f"  NACHWEIS GESCHEITERT: {grund}")
        return 1
    summe = sha256_datei(ziel)
    (aus / f"{ziel.name}.sha256").write_text(f"{summe}  {ziel.name}\n", encoding="utf-8")
    stempel = herkunft_im_paket(ziel) or {}
    kanal = kanal_von(a.fassung)
    print(f"  {ziel}  sha256 {summe}")
    print(f"  Inhalt von {a.von} (Commit {str(stempel.get('commit'))[:12]}), Kanal jetzt {kanal}")
    github_ausgabe(kanal=kanal, vorab="false" if kanal == "stable" else "true")
    return 0


# ══ 2. SIGNIEREN (lokal) ════════════════════════════════════════════════════

def _gh(*argumente: str) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *argumente], capture_output=True, text=True)


def _pem(text: str) -> str:
    return "".join(z.strip() for z in text.strip().splitlines())


def signieren(a: argparse.Namespace) -> int:
    print(f"── Fassung signieren: {a.fassung} ({a.repo}) ──")
    if not kanal_von(a.fassung):
        print(f"  `{a.fassung}` passt nicht auf die Namensform.")
        return 1
    for werkzeug in ("gh", "openssl"):
        if not shutil.which(werkzeug):
            print(f"  `{werkzeug}` fehlt. gh: https://cli.github.com — danach `gh auth login`.")
            return 1
    privat = Path(a.privat).expanduser()
    if not privat.is_file():
        print(f"  Kein privater Schluessel unter {privat}. Einmalig: schluessel-erzeugen.")
        return 1
    if not OEFFENTLICH.is_file():
        print(f"  {_zeige(OEFFENTLICH)} fehlt — ohne eingecheckten oeffentlichen")
        print("  Schluessel lehnt der Kanal-Lauf auf GitHub jede Signatur ab.")
        return 1
    # PASST DER SCHLUESSEL ZUM EINGECHECKTEN? Sonst signierte man sauber — und
    # der Runner verwuerfe das Release, erst Minuten spaeter und woanders.
    abgeleitet = openssl("pkey", "-in", str(privat), "-pubout")
    if abgeleitet.returncode != 0:
        print(f"  Der private Schluessel ist nicht lesbar: {abgeleitet.stderr.strip()}")
        return 1
    if _pem(abgeleitet.stdout) != _pem(OEFFENTLICH.read_text(encoding="utf-8")):
        print(f"  Der private Schluessel gehoert NICHT zu {_zeige(OEFFENTLICH)}.")
        print("  Der Kanal-Lauf wuerde die Signatur verwerfen. Nichts hochgeladen.")
        return 1

    ansicht = _gh("release", "view", a.fassung, "--repo", a.repo, "--json", "isDraft,assets")
    if ansicht.returncode != 0:
        print(f"  Kein Release {a.fassung} auf {a.repo}: {ansicht.stderr.strip()}")
        print("  Erst bauen: Actions → „Fassung bauen“ → Run workflow.")
        return 1
    daten = json.loads(ansicht.stdout)
    namen = {x.get("name") for x in daten.get("assets", [])}
    zipname = f"{a.fassung}.zip"
    if not daten.get("isDraft") and f"{zipname}.sig" in namen:
        print("  Das Release ist schon veroeffentlicht und signiert. Nichts zu tun.")
        return 0
    if zipname not in namen:
        print(f"  Dem Release fehlt {zipname}.")
        return 1

    with tempfile.TemporaryDirectory(prefix="mixpi-signieren-") as tmp:
        t = Path(tmp)
        muster = ["--pattern", zipname]
        if f"{zipname}.sha256" in namen:
            muster += ["--pattern", f"{zipname}.sha256"]
        geholt = _gh("release", "download", a.fassung, "--repo", a.repo, "--dir", tmp, *muster)
        if geholt.returncode != 0:
            print(f"  Holen gescheitert: {geholt.stderr.strip()}")
            return 1
        paket = t / zipname
        summe = sha256_datei(paket)
        if (t / f"{zipname}.sha256").is_file():
            erwartet = (t / f"{zipname}.sha256").read_text(encoding="utf-8").split()[0]
            if erwartet != summe:
                print(f"  Summe passt nicht: Release sagt {erwartet}, geholt {summe}.")
                return 1
        grund = herkunft_passt(herkunft_im_paket(paket), a.fassung)
        if grund:
            print(f"  NICHT SIGNIERT: {grund}")
            return 1
        stempel = herkunft_im_paket(paket) or {}
        print(f"  geholt   {zipname}  sha256 {summe}")
        print(f"  Herkunft {stempel.get('quelle')} @ {str(stempel.get('commit'))[:12]}")

        sig = t / f"{zipname}.sig"
        r = openssl("dgst", "-sha256", "-sign", str(privat), "-out", str(sig), str(paket))
        if r.returncode != 0:
            print(f"  Signieren gescheitert: {r.stderr.strip()}")
            return 1
        if not signatur_gilt(OEFFENTLICH, sig, paket):
            print("  Die frische Signatur besteht die eigene Pruefung nicht. Nichts hochgeladen.")
            return 1
        print("  Signatur gegen den eingecheckten Schluessel geprueft: gilt.")
        hoch = _gh("release", "upload", a.fassung, str(sig), "--repo", a.repo, "--clobber")
        if hoch.returncode != 0:
            print(f"  Hochladen gescheitert: {hoch.stderr.strip()}")
            return 1
        print(f"  hochgeladen: {sig.name}")

    if not a.veroeffentlichen:
        print()
        print("  Der Entwurf ist signiert, aber noch unsichtbar. Veroeffentlichen:")
        print(f"    python3 tools/mixpi-github-fassung.py signieren --fassung {a.fassung} --veroeffentlichen")
        print("  (oder im Browser: Release bearbeiten → Publish release)")
        return 0
    frei = _gh("release", "edit", a.fassung, "--repo", a.repo, "--draft=false")
    if frei.returncode != 0:
        print(f"  Veroeffentlichen gescheitert: {frei.stderr.strip()}")
        return 1
    print(f"  VEROEFFENTLICHT. Der Lauf „Kanaele veroeffentlichen“ nimmt {a.fassung}")
    print(f"  ins Verzeichnis auf: {feed_adresse(a.repo)}")
    return 0


# ══ 3. KANAELE (Runner) ═════════════════════════════════════════════════════

def _laden(url: str, ziel: Path) -> None:
    anfrage = urllib.request.Request(url, headers={"User-Agent": "mixpibox-kanaele"})
    with urllib.request.urlopen(anfrage, timeout=120) as a, open(ziel, "wb") as f:
        shutil.copyfileobj(a, f)


def releases_flach(roh) -> list[dict]:
    """`gh api --paginate --slurp` liefert eine Liste von SEITEN — flach machen."""
    aus: list[dict] = []
    for x in roh if isinstance(roh, list) else []:
        if isinstance(x, list):
            aus.extend(y for y in x if isinstance(y, dict))
        elif isinstance(x, dict):
            aus.append(x)
    return aus


def release_pruefen(rel: dict, schluessel: Path, laden=_laden) -> tuple[dict | None, str | None, bool]:
    """(eintrag, grund, ist_fehler). Entwuerfe: (None, None, False)."""
    tag = str(rel.get("tag_name") or "")
    if rel.get("draft"):
        return None, None, False
    kanal = kanal_von(tag)
    if not kanal:
        return None, f"{tag}: keine MixPiBox-Fassung (Namensform) — uebergangen", False
    assets = {str(x.get("name")): x for x in rel.get("assets") or [] if isinstance(x, dict)}
    zipname = f"{tag}.zip"
    if zipname not in assets:
        return None, f"{tag}: kein {zipname} am Release", True
    if f"{zipname}.sig" not in assets:
        return None, f"{tag}: nicht signiert ({zipname}.sig fehlt) — `signieren` vergessen?", True
    if not schluessel.is_file():
        return None, f"{tag}: kein oeffentlicher Schluessel eingecheckt ({schluessel.name}) — nichts pruefbar", True
    with tempfile.TemporaryDirectory(prefix="mixpi-kanal-") as tmp:
        t = Path(tmp)
        paket, sig = t / zipname, t / f"{zipname}.sig"
        try:
            laden(assets[zipname]["browser_download_url"], paket)
            laden(assets[f"{zipname}.sig"]["browser_download_url"], sig)
            summe = sha256_datei(paket)
            if f"{zipname}.sha256" in assets:
                laden(assets[f"{zipname}.sha256"]["browser_download_url"], t / "summe")
                erwartet = (t / "summe").read_text(encoding="utf-8").split()[0]
                if erwartet != summe:
                    return None, f"{tag}: Summe {summe[:12]}… passt nicht zur .sha256 ({erwartet[:12]}…)", True
        except (OSError, KeyError, IndexError, ValueError) as e:
            return None, f"{tag}: Laden gescheitert ({e})", True
        grund = herkunft_passt(herkunft_im_paket(paket), tag)
        if grund:
            return None, f"{tag}: {grund}", True
        if not signatur_gilt(schluessel, sig, paket):
            return None, f"{tag}: Signatur gilt NICHT gegen {schluessel.name}", True
        signatur = base64.b64encode(sig.read_bytes()).decode("ascii")
    hinweis = None
    if bool(rel.get("prerelease")) != (kanal != "stable"):
        hinweis = (f"{tag}: auf GitHub als {'Vorabversion' if rel.get('prerelease') else 'Release'} "
                   f"markiert, der Name sagt `{kanal}` — es gilt der Name")
    eintrag = {
        "version": tag,
        "url": assets[zipname]["browser_download_url"],
        "sha256": summe,
        "signatur": signatur,
        "releaseinfo": str(rel.get("name") or f"MixPiBox {tag}"),
        "veroeffentlicht": rel.get("published_at") or "",
    }
    return eintrag, hinweis, False


def feed_bauen(eintraege: list[dict], repo: str, jetzt: str) -> dict:
    def ordnung(e: dict):
        return ZIEHER.zerlege(e["version"])
    gueltig = [e for e in eintraege if ordnung(e) is not None]
    return {
        "_": ("MixPiBox-Fassungsverzeichnis, erzeugt von tools/mixpi-github-fassung.py "
              f"aus den Releases von {repo}. Nicht von Hand aendern — der naechste "
              "Release-Lauf ueberschreibt es. Neuester Eintrag je Kanal am ENDE; "
              "beta fuehrt stable mit, dev fuehrt alles."),
        "produkt": "MixPiBox",
        "quelle": repo_adresse(repo),
        "erzeugt": jetzt,
        "release": {
            k: sorted((e for e in gueltig if kanal_von(e["version"]) in EINSCHLUSS[k]), key=ordnung)
            for k in KANAELE
        },
    }


def kanaele(a: argparse.Namespace, laden=_laden) -> int:
    print(f"── Kanaele bauen: {a.repo} ──")
    releases = releases_flach(json.loads(Path(a.releases).read_text(encoding="utf-8")))
    schluessel = Path(a.schluessel)
    eintraege, ausgeschlossen, uebergangen = [], [], []
    for rel in releases:
        eintrag, grund, fehler = release_pruefen(rel, schluessel, laden)
        if eintrag:
            eintraege.append(eintrag)
            print(f"  aufgenommen   {eintrag['version']}")
        if grund and fehler:
            ausgeschlossen.append(grund)
            print(f"::error::{grund}")
        elif grund:
            uebergangen.append(grund)
            print(f"  Hinweis: {grund}")
    jetzt = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    feed = feed_bauen(eintraege, a.repo, jetzt)
    aus = Path(a.aus)
    aus.mkdir(parents=True, exist_ok=True)
    (aus / "version.json").write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    zeilen = ["| Kanal | Einträge | Neueste |", "|---|---|---|"]
    for k in KANAELE:
        liste = feed["release"][k]
        zeilen.append(f"| {k} | {len(liste)} | {liste[-1]['version'] if liste else '—'} |")
        print(f"  {k:6}  {len(liste):3} Eintraege, neueste {liste[-1]['version'] if liste else '—'}")
    github_zusammenfassung("### MixPiBox-Kanäle\n\n" + "\n".join(zeilen) + "\n\n"
                           + f"Verzeichnis: {feed_adresse(a.repo)}\n"
                           + "".join(f"\n- ausgeschlossen: {g}" for g in ausgeschlossen))
    github_ausgabe(ausgeschlossen=str(len(ausgeschlossen)))
    print(f"  geschrieben: {aus / 'version.json'}  ({len(ausgeschlossen)} ausgeschlossen)")
    return 0


# ══ 4. SCHLUESSEL (lokal, einmal) ═══════════════════════════════════════════

def schluessel_erzeugen(a: argparse.Namespace) -> int:
    privat = Path(a.privat).expanduser().resolve()
    print("── Signierschluessel erzeugen ──")
    if privat.exists():
        print(f"  {privat} gibt es schon — ein Schluessel wird NIE ueberschrieben:")
        print("  jede Box, die den alten oeffentlichen kennt, lehnte danach alles ab.")
        return 1
    if privat.is_relative_to(WURZEL):
        print(f"  {privat} liegt im Baum. Der private Schluessel gehoert NICHT hierher —")
        print("  ein `git add -A` und er waere veroeffentlicht.")
        return 1
    if OEFFENTLICH.exists() and not a.ersetzen:
        print(f"  {_zeige(OEFFENTLICH)} gibt es schon. Ein neuer Schluessel heisst:")
        print("  jede eingerichtete Box braucht den neuen oeffentlichen. Nur mit --ersetzen.")
        return 1
    privat.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    alt = os.umask(0o077)
    try:
        r = openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256",
                    "-out", str(privat))
    finally:
        os.umask(alt)
    if r.returncode != 0:
        print(f"  openssl: {r.stderr.strip()}")
        return 1
    os.chmod(privat, 0o600)
    r = openssl("pkey", "-in", str(privat), "-pubout", "-out", str(OEFFENTLICH))
    if r.returncode != 0:
        print(f"  openssl: {r.stderr.strip()}")
        return 1
    print(f"  privat      {privat}  (0600 — SICHERN, offline; verloren = nie wieder signieren)")
    print(f"  oeffentlich {_zeige(OEFFENTLICH)}")
    print()
    print("  JETZT: den oeffentlichen Schluessel einchecken und veroeffentlichen")
    print("  (tools/github-veroeffentlichen.py --bauen --push). Erst dann kann der")
    print("  Kanal-Lauf auf GitHub Signaturen pruefen.")
    return 0


# ══ 5. BOX EINRICHTEN (auf der Box, root) ═══════════════════════════════════

def box_einrichten(a: argparse.Namespace) -> int:
    print("── Box auf die GitHub-Kanaele einrichten ──")
    if a.kanal not in KANAELE:
        print(f"  Kanal `{a.kanal}` gibt es nicht ({', '.join(KANAELE)}).")
        return 1
    einstellung = Path(BOX_EINSTELLUNG)
    try:
        alt = json.loads(einstellung.read_text(encoding="utf-8"))
        if not isinstance(alt, dict):
            alt = {}
    except (OSError, ValueError):
        alt = {}
    neu = dict(alt, feed=a.feed or feed_adresse(a.repo), quelle=a.quelle or repo_adresse(a.repo), kanal=a.kanal)
    try:
        einstellung.parent.mkdir(parents=True, exist_ok=True)
        # Atomar: eine halbe Einstellung hiesse „kein Verzeichnis", und die
        # Box saesse fest, ohne dass ein Fehler zu sehen waere.
        zwischen = einstellung.with_name(f".{einstellung.name}.{os.getpid()}.neu")
        zwischen.write_text(json.dumps(neu, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(zwischen, 0o644)
        os.replace(zwischen, einstellung)
    except OSError as e:
        print(f"  {einstellung} nicht schreibbar ({e}) — als root rufen.")
        return 1
    print(f"  {einstellung}: feed={neu['feed']}  kanal={neu['kanal']}")

    quelle_pub = Path(a.schluessel) if a.schluessel else OEFFENTLICH
    if quelle_pub.is_file():
        ziel = Path(BOX_SCHLUESSEL)
        zwischen = ziel.with_name(f".{ziel.name}.{os.getpid()}.neu")
        shutil.copyfile(quelle_pub, zwischen)
        os.chmod(zwischen, 0o644)
        os.replace(zwischen, ziel)
        print(f"  {ziel}: gelegt — ab jetzt ist eine Signatur PFLICHT.")
    else:
        print(f"  KEIN SCHLUESSEL ({quelle_pub}) — die Box prueft nur die sha256 aus dem")
        print("  Verzeichnis. Wer GitHub uebernimmt, uebernimmt damit die Box.")

    herkunft = ZIEHER.herkunft_lesen()
    if herkunft and not ZIEHER.gleiche_quelle(str(herkunft.get("quelle") or ""), neu["quelle"]):
        print()
        print(f"  HINWEIS: installiert ist eine Fassung aus {herkunft.get('quelle')}.")
        print("  Das erste Update von GitHub urteilt deshalb `fremdeQuelle`. Einmal bewusst:")
        print("    sudo python3 scripts/box/mixpi-zieher.py --einspielen --erzwingen")
        print("  Danach traegt die Box die GitHub-Herkunft, und es geht ohne weiter.")
    return 0


# ══ SELBSTTEST ══════════════════════════════════════════════════════════════

def selbsttest() -> int:
    fehler: list[str] = []

    def soll(bedingung: bool, was: str) -> None:
        if not bedingung:
            fehler.append(was)

    # Namensform → Kanal
    for name, kanal in (("v1.2.0", "stable"), ("v1.2.0-beta.3", "beta"), ("v1.2.0-dev.7", "dev"),
                        ("1.2.0", None), ("v1.2", None), ("v1.2.0-rc.1", None), ("4.2.4", None)):
        soll(kanal_von(name) == kanal, f"kanal_von({name!r}) = {kanal_von(name)!r}, erwartet {kanal!r}")

    # Ordnung und Einschluss — gelesen mit dem LESER DER BOX, nicht mit einem eigenen.
    namen = ["v1.1.0", "v1.1.0-dev.10", "v1.0.0", "v1.1.0-beta.1", "v1.1.0-dev.2", "v1.2.0-dev.1"]
    feed = feed_bauen([{"version": n, "url": f"u/{n}", "sha256": "0" * 64} for n in namen], "a/b", "t")
    r = feed["release"]
    soll([e["version"] for e in r["stable"]] == ["v1.0.0", "v1.1.0"], f"stable: {r['stable']}")
    soll([e["version"] for e in r["beta"]] == ["v1.0.0", "v1.1.0-beta.1", "v1.1.0"], f"beta: {r['beta']}")
    soll([e["version"] for e in r["dev"]] ==
         ["v1.0.0", "v1.1.0-dev.2", "v1.1.0-dev.10", "v1.1.0-beta.1", "v1.1.0", "v1.2.0-dev.1"],
         f"dev (dev.10 nach dev.2, beta vor fertig): {[e['version'] for e in r['dev']]}")
    for kanal, erwartet in (("stable", "v1.1.0"), ("beta", "v1.1.0"), ("dev", "v1.2.0-dev.1")):
        angebot = ZIEHER.neuestes_angebot(feed, kanal)
        soll((angebot or {}).get("version") == erwartet,
             f"Zieher liest in `{kanal}` {(angebot or {}).get('version')}, erwartet {erwartet}")
    soll(feed_adresse("scoutr2d2/mixpibox") == "https://scoutr2d2.github.io/mixpibox/version.json",
         "feed_adresse")

    # Befoerdern: nur innerhalb einer Nummer und nur nach oben.
    for von, nach, gut in (("v1.2.0-beta.3", "v1.2.0", True), ("v1.2.0-dev.7", "v1.2.0-beta.1", True),
                           ("v1.2.0-dev.7", "v1.2.0", True), ("v1.2.0", "v1.2.0-beta.4", False),
                           ("v1.2.0-beta.3", "v1.3.0", False), ("v1.2.0-beta.3", "v1.2.0-beta.3", False),
                           ("v1.2.0-beta.3", "1.2.0", False)):
        grund = befoerderung_pruefen(von, nach)
        soll((grund is None) == gut, f"befoerderung_pruefen({von} → {nach}) = {grund!r}")
    soll(len(releases_flach([[{"tag_name": "a"}], [{"tag_name": "b"}]])) == 2, "releases_flach (Seiten)")

    with tempfile.TemporaryDirectory(prefix="mixpi-selbsttest-") as tmp:
        t = Path(tmp)
        # Umstempeln: eigeneCommits wird null (AUDIT-2026-09-25 Rang 7).
        roh = t / "roh.zip"
        with zipfile.ZipFile(roh, "w") as z:
            z.writestr("herkunft.json", json.dumps({"quelle": "x", "version": "1.0.0",
                                                    "eigeneCommits": 2, "unsauber": 1}))
            z.writestr("server.js", "// leer\n")
        gestempelt = t / "v1.1.0.zip"
        _still(lambda: SCHNEIDEN.paket_umstempeln(roh, gestempelt, "v1.1.0", {"quelle": "https://github.com/a/b"}))
        h = herkunft_im_paket(gestempelt) or {}
        soll(h.get("eigeneCommits") == 0 and h.get("unsauber") == 0, f"umstempeln: {h}")
        soll(h.get("quelle") == "https://github.com/a/b" and h.get("version") == "v1.1.0", f"umstempeln Felder: {h}")
        soll(herkunft_passt(h, "v1.1.0") is None, "herkunft_passt (gut)")
        soll(herkunft_passt(h, "v1.2.0") is not None, "herkunft_passt (andere Fassung)")

        if not shutil.which("openssl"):
            print("  Hinweis: openssl fehlt — Signaturfaelle uebersprungen.")
        else:
            # Zwei Schluessel: der richtige und ein fremder.
            for n in ("gut", "fremd"):
                openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256",
                        "-out", str(t / f"{n}.key"))
                openssl("pkey", "-in", str(t / f"{n}.key"), "-pubout", "-out", str(t / f"{n}.pub"))
            for n in ("gut", "fremd"):
                openssl("dgst", "-sha256", "-sign", str(t / f"{n}.key"),
                        "-out", str(t / f"{n}.sig"), str(gestempelt))
            (t / "summe").write_text(f"{sha256_datei(gestempelt)}  v1.1.0.zip\n")
            (t / "falsch").write_text("f" * 64 + "  v1.1.0.zip\n")

            def rel(tag="v1.1.0", sig="gut.sig", summe="summe", zipdatei="v1.1.0.zip", **mehr):
                assets = [{"name": f"{tag}.zip", "browser_download_url": zipdatei}]
                if sig:
                    assets.append({"name": f"{tag}.zip.sig", "browser_download_url": sig})
                if summe:
                    assets.append({"name": f"{tag}.zip.sha256", "browser_download_url": summe})
                return dict({"tag_name": tag, "draft": False, "prerelease": False, "assets": assets}, **mehr)

            def laden(url: str, ziel: Path) -> None:
                shutil.copyfile(t / url, ziel)

            pub = t / "gut.pub"
            e, g, f = release_pruefen(rel(), pub, laden)
            soll(e is not None and g is None and not f, f"gutes Release: {g}")
            if e:
                # Die Box muss die Signatur aus dem Verzeichnis selbst pruefen koennen.
                (t / "aus-feed.sig").write_bytes(base64.b64decode(e["signatur"]))
                soll(signatur_gilt(pub, t / "aus-feed.sig", gestempelt), "signatur aus dem Verzeichnis gilt nicht")
            for name, r_, erwartet in (
                ("ohne Signatur", rel(sig=None), "nicht signiert"),
                ("fremd signiert", rel(sig="fremd.sig"), "Signatur gilt NICHT"),
                ("falsche Summe", rel(summe="falsch"), "passt nicht"),
                ("andere Fassung im Paket", rel(tag="v1.2.0", zipdatei="v1.1.0.zip"), "statt"),
            ):
                e2, g2, f2 = release_pruefen(r_, pub, laden)
                soll(e2 is None and f2 and erwartet in (g2 or ""), f"{name}: {g2!r}")
            e3, g3, f3 = release_pruefen(rel(draft=True), pub, laden)
            soll(e3 is None and g3 is None and not f3, "Entwurf muss still uebergangen werden")
            e4, g4, f4 = release_pruefen(rel(tag="4.2.4"), pub, laden)
            soll(e4 is None and not f4 and "uebergangen" in (g4 or ""), f"Fremdname: {g4!r}")
            e5, g5, f5 = release_pruefen(rel(), t / "fehlt.pub", laden)
            soll(e5 is None and f5, "ohne eingecheckten Schluessel darf nichts hinein")

    if fehler:
        print(f"SELBSTTEST ROT ({len(fehler)}):")
        for z in fehler:
            print(f"  {z}")
        return 1
    print("SELBSTTEST GRUEN.")
    return 0


def _still(f):
    alt = sys.stdout
    try:
        with open(os.devnull, "w") as sys.stdout:
            return f()
    finally:
        sys.stdout = alt


def main() -> int:
    if "--selbsttest" in sys.argv[1:]:
        return selbsttest()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo", default=REPO_VORGABE, help=f"owner/name (Vorgabe {REPO_VORGABE})")
    u = p.add_subparsers(dest="befehl", required=True)

    b = u.add_parser("bauen", help="Runner: Paket bauen und auf die Fassung stempeln")
    b.add_argument("--fassung", required=True)
    b.add_argument("--aus", required=True)
    b.add_argument("--auch-lokal", action="store_true")

    f = u.add_parser("befoerdern", help="Runner: signiertes Paket einer Vorstufe neu benennen")
    f.add_argument("--von", required=True, help="z. B. v1.2.0-beta.3")
    f.add_argument("--fassung", required=True, help="z. B. v1.2.0")
    f.add_argument("--aus", required=True)

    s = u.add_parser("signieren", help="lokal: Entwurf holen, signieren, hochladen")
    s.add_argument("--fassung", required=True)
    s.add_argument("--privat", default=str(PRIVAT_VORGABE))
    s.add_argument("--veroeffentlichen", action="store_true")

    k = u.add_parser("kanaele", help="Runner: version.json aus den Releases bauen")
    k.add_argument("--releases", required=True, help="Ausgabe von `gh api --paginate --slurp …/releases`")
    k.add_argument("--aus", required=True)
    k.add_argument("--schluessel", default=str(OEFFENTLICH))

    e = u.add_parser("schluessel-erzeugen", help="lokal, einmal: Signierschluessel anlegen")
    e.add_argument("--privat", default=str(PRIVAT_VORGABE))
    e.add_argument("--ersetzen", action="store_true")

    x = u.add_parser("box-einrichten", help="auf der Box (root): Verzeichnis und Schluessel eintragen")
    x.add_argument("--kanal", default="stable")
    x.add_argument("--feed", default="")
    x.add_argument("--quelle", default="")
    x.add_argument("--schluessel", default="")

    a = p.parse_args()
    return {
        "bauen": bauen,
        "befoerdern": befoerdern,
        "signieren": signieren,
        "kanaele": kanaele,
        "schluessel-erzeugen": schluessel_erzeugen,
        "box-einrichten": box_einrichten,
    }[a.befehl](a)


if __name__ == "__main__":
    sys.exit(main())
