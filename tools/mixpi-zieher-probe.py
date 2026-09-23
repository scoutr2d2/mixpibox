#!/usr/bin/env python3
"""FAEHRT DER ZIEHER WIRKLICH, UND UEBERLEBT ER DEN ABBRUCH? — im Sandkasten.

WOZU. `scripts/box/mixpi-zieher.py` tauscht als root den Anwendungsbaum einer
Box. Ein Weg, den man nicht ueben kann, wird erst im Ernstfall zum ersten Mal
gefahren — und der Ernstfall ist hier eine Box, die ein Kind mitten im Update
ausschaltet. Diese Probe baut deshalb eine ganze SCHEIN-BOX unter /tmp
(Anwendungsordner, Abspielordner, Verzeichnis, Archiv) und faehrt den ECHTEN
Zieher darin, ueber die Umgebungsvariablen, die er dafuer vorsieht. Nicht eine
Nachbildung seiner Logik — die liefe auseinander.

NIE AN DER BOX. Alles liegt unter einem `mkdtemp`, und der Zieher bekommt
ausschliesslich Pfade dorthin. Wuerde eine der Variablen nicht greifen, zeigte
er auf `/home/dietpi/...`, faende dort nichts und meldete „das ist keine Box" —
der Fehlschlag waere sichtbar, nicht still.

WAS SIE DURCHSPIELT
  1 Der gluecklichste Fall: Angebot da, Summe stimmt, Tausch, Rueckweg liegt.
  2 Falsche Pruefsumme -> es wird NICHTS getauscht und nichts angefasst.
  3 Fehlende Pruefsumme im Eintrag -> Ablehnung, ohne zu laden.
  4 Fremde Quelle -> Ablehnung (das ist der Fork-Schutz aus aktualisierung.ts).
  5 ABBRUCH MITTEN IM LADEN: ein halbes Archiv liegt als `….teil`. Der
    naechste Lauf darf es nicht fuer voll halten, muss fortsetzen und am Ende
    dasselbe Ergebnis liefern wie ein ungestoerter Lauf.
  6 Abbruch NACH dem Bereitlegen: ein `….neu` liegt herum. Der naechste Lauf
    muss es wegraeumen statt es zu tauschen.
  7 Der lokale Rueckweg: nach dem Tausch ohne Netz und ohne Verzeichnis
    zurueck — und die Dateien muessen hinterher wieder die ALTEN sein.

WAS SIE NICHT ABDECKT — Untergrenze, damit niemand sie fuer mehr haelt
  * DIE FRIST. `mupibox-standwache.py` braucht systemd und einen Zeitgeber;
    im Sandkasten gibt es beides nicht. Der Zieher meldet dort „keine Frist
    gestellt" und laeuft weiter. Dass die Wache nach Ablauf wirklich
    zurueckdreht, misst `tools/standwache-nachgestellt.py` — nicht diese Probe.
  * DEN NEUSTART UND DAS NACHMESSEN. Ohne systemd gibt es keinen Dienst, der
    hochkommen oder abstuerzen koennte; Schritt 8 und 9 werden uebersprungen.
    Damit ist der Zweig „nach dem Tausch kaputt -> von selbst zurueckdrehen"
    hier NICHT gefahren, obwohl er im Zieher steht. Er braucht eine echte Box.
  * DIE SIGNATUR. Geprueft wird der Weg ohne Schluessel (sha256 allein). Dass
    ein vorhandener Schluessel eine fehlende Signatur ABLEHNT, steht so im
    Zieher, ist hier aber nicht nachgemessen.
  * ECHTE ABBRUECHE. Die Abrisse werden GESTELLT (halbe Datei, Rest-`.neu`),
    nicht ausgeloest. Ein wirklich abgeschossener Prozess kann Zustaende
    hinterlassen, an die hier niemand gedacht hat.
  * DEN EIGENTUEMER. Auf der Box laeuft der Zieher als root und muss dem
    Getauschten das Eigentum des ALTEN geben (sonst kann `ausliefern.py` als
    dietpi den Baum spaeter nicht mehr umbenennen — am 31.08.2026 genau so
    aufgelaufen). Hier laeuft alles unter EINEM Benutzer, der Test waere also
    trivial gruen und bewiese nichts. Gemessen wird das nur am Geraet.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/mixpi-zieher-probe.py
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ZIEHER = WURZEL / "scripts" / "box" / "mixpi-zieher.py"
TAUSCHER = WURZEL / "scripts" / "box" / "mupibox-tauscher.py"

ALT, NEU = "ALTER STAND", "NEUER STAND"


class Probe:
    def __init__(self):
        self.gut = 0
        self.schlecht: list[str] = []

    def pruefe(self, name: str, bedingung: bool, hinweis: str = "") -> None:
        if bedingung:
            self.gut += 1
            print(f"  ok    {name}")
        else:
            self.schlecht.append(name)
            print(f"  NEIN  {name}")
            if hinweis:
                print(f"        {hinweis}")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def paket_bauen(ziel: Path, inhalt: str) -> Path:
    """Ein Archiv in der Form von deploy.zip — dieselben Stuecke, winzig."""
    with zipfile.ZipFile(ziel, "w") as z:
        z.writestr("server.js", f"// {inhalt}\nconsole.log('server');\n")
        z.writestr("plugin-laufwerk.js", f"// {inhalt}\nconsole.log('laufwerk');\n")
        z.writestr("spotify-control.js", f"// {inhalt}\nconsole.log('player');\n")
        z.writestr("herkunft.json", json.dumps({
            "quelle": "http://git.local:3000/achim/box.git",
            "commit": "0" * 40, "zweig": "main", "version": "v1.1.0",
            "eigeneCommits": 0, "unsauber": 0, "gebautAm": "2026-08-31T00:00:00Z",
        }))
        z.writestr("www/index.html", f"<!-- {inhalt} -->")
        z.writestr("www-admin/index.html", f"<!-- {inhalt} -->")
    return ziel


def box_bauen(wurzel: Path, eigene: int = 0) -> tuple[Path, Path]:
    app = wurzel / "app"
    player = wurzel / "player"
    (app / "www").mkdir(parents=True)
    (app / "www-admin").mkdir(parents=True)
    player.mkdir(parents=True)
    (app / "server.js").write_text(f"// {ALT}\n")
    (app / "plugin-laufwerk.js").write_text(f"// {ALT}\n")
    (player / "spotify-control.js").write_text(f"// {ALT}\n")
    (app / "www" / "index.html").write_text(f"<!-- {ALT} -->")
    (app / "www-admin" / "index.html").write_text(f"<!-- {ALT} -->")
    (app / "herkunft.json").write_text(json.dumps({
        "quelle": "http://git.local:3000/achim/box.git",
        "commit": "1" * 40, "zweig": "main", "version": "v1.0.0",
        "eigeneCommits": eigene, "unsauber": 0,
        "gebautAm": "2026-08-30T00:00:00Z",
    }))
    return app, player


def feed_schreiben(pfad: Path, archiv: Path, sha: str | None,
                   version: str = "v1.1.0") -> Path:
    eintrag = {"version": version, "url": archiv.as_uri(),
               "releaseinfo": "Probe"}
    if sha is not None:
        eintrag["sha256"] = sha
    pfad.write_text(json.dumps({
        "produkt": "MixPiBox", "version": version,
        "quelle": "http://git.local:3000/achim/box.git",
        "release": {"stable": [eintrag], "beta": [], "dev": []},
    }))
    return pfad


# Eine Sicherung, die sich wie die echte VERHAELT, ohne eine zu sein: sie legt
# einen Stand an und weist ihn ueber `--liste --json` nach. Der Zieher glaubt
# dem Rueckgabewert ausdruecklich NICHT (er ist in drei Lagen 0, ohne dass
# etwas entstand) und zaehlt die Liste — genau dieser Weg wird hier gefahren.
# Ohne sie verweigerte der Zieher den Tausch, und die Probe pruefte nie, was
# nach dem Tausch passiert.
SCHEIN_SICHERUNG = '''#!/usr/bin/env python3
import json, sys, os
buch = os.environ["PROBE_SICHERUNGSBUCH"]
staende = json.load(open(buch)) if os.path.exists(buch) else []
if "--anlegen" in sys.argv:
    staende.append({"grund": sys.argv[sys.argv.index("--grund") + 1]})
    json.dump(staende, open(buch, "w"))
elif "--liste" in sys.argv:
    json.dump(staende, sys.stdout)
'''


def zieher(app: Path, player: Path, lager: Path, feed: Path,
           quelle: str = "http://git.local:3000/achim/box.git",
           *args: str) -> subprocess.CompletedProcess:
    lager.mkdir(parents=True, exist_ok=True)
    sicherung = lager / "schein-sicherung.py"
    sicherung.write_text(SCHEIN_SICHERUNG)
    umgebung = dict(os.environ)
    umgebung.update({
        "MIXPI_APPDIR": str(app), "MIXPI_PLAYERDIR": str(player),
        "MIXPI_LAGER": str(lager), "MIXPI_TAUSCHER": str(TAUSCHER),
        "MIXPI_FEED": feed.as_uri(), "MIXPI_QUELLE": quelle,
        "MIXPI_KANAL": "stable", "MIXPI_OHNE_SYSTEMD": "1",
        "MIXPI_SICHERUNG": str(sicherung),
        "PROBE_SICHERUNGSBUCH": str(lager / "staende.json"),
        # Auf Orte zeigen, die es nicht gibt — sonst griffe die Probe nach der
        # echten Standwache dieses Rechners.
        "MIXPI_STANDWACHE": str(lager / "gibt-es-nicht"),
        "MIXPI_EINSTELLUNG": str(lager / "keine-einstellung.json"),
        "MIXPI_SCHLUESSEL": str(lager / "kein-schluessel.pub"),
    })
    return subprocess.run([sys.executable, str(ZIEHER), *args],
                          capture_output=True, text=True, env=umgebung, timeout=300)


def lies(p: Path) -> str:
    """Fehlende Datei ist ein Befund, kein Absturz der Probe."""
    try:
        return p.read_text()
    except OSError:
        return ""


def stand(app: Path, player: Path) -> str:
    return (lies(app / "server.js") + lies(player / "spotify-control.js")
            + lies(app / "www" / "index.html"))


def main() -> int:
    p = Probe()
    if not ZIEHER.is_file() or not TAUSCHER.is_file():
        print(f"FEHLT: {ZIEHER} oder {TAUSCHER}")
        return 1

    print("── Der Zieher im Sandkasten ──")

    # ── 1: der glueckliche Fall ──────────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, sha256(archiv))
        e = zieher(app, player, w / "lager", feed, "http://git.local:3000/achim/box.git",
                   "--einspielen")
        p.pruefe("1 glueckliche Fahrt endet mit 0", e.returncode == 0,
                 e.stdout[-700:] + e.stderr[-300:])
        p.pruefe("1 der neue Stand liegt am Ziel", NEU in stand(app, player),
                 stand(app, player)[:120])
        p.pruefe("1 der Rueckweg liegt lokal",
                 (app / "server.js.zurueck").exists()
                 and (app / "www.zurueck").is_dir())
        p.pruefe("1 der Rueckweg haelt den ALTEN Stand",
                 ALT in lies(app / "server.js.zurueck"))
        p.pruefe("1 kein `.neu` bleibt liegen",
                 not (app / "server.js.neu").exists()
                 and not (app / "www.neu").exists())

        # ── 7: der lokale Rueckweg, ohne Netz und ohne Verzeichnis ───────────
        feed.unlink()          # kein Verzeichnis mehr
        archiv.unlink()        # kein Archiv mehr
        e = zieher(app, player, w / "lager", w / "weg.json",
                   "http://git.local:3000/achim/box.git", "--zurueckdrehen")
        p.pruefe("7 Zurueckdrehen endet mit 0", e.returncode == 0,
                 e.stdout[-700:] + e.stderr[-300:])
        p.pruefe("7 der ALTE Stand ist wieder da", ALT in stand(app, player),
                 stand(app, player)[:120])

    # ── 2: falsche Pruefsumme ────────────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, "f" * 64)
        vorher = stand(app, player)
        e = zieher(app, player, w / "lager", feed,
                   "http://git.local:3000/achim/box.git", "--einspielen")
        p.pruefe("2 falsche Summe wird abgelehnt", e.returncode == 3,
                 f"rc={e.returncode}\n{e.stdout[-500:]}")
        p.pruefe("2 nichts wurde angefasst", stand(app, player) == vorher)
        p.pruefe("2 kein Rest mit falscher Summe bleibt liegen",
                 not list((w / "lager").glob("*.teil")))

    # ── 3: gar keine Pruefsumme ──────────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, None)
        vorher = stand(app, player)
        e = zieher(app, player, w / "lager", feed,
                   "http://git.local:3000/achim/box.git", "--einspielen")
        p.pruefe("3 Eintrag ohne sha256 wird abgelehnt", e.returncode == 3,
                 f"rc={e.returncode}\n{e.stdout[-400:]}")
        p.pruefe("3 nichts wurde angefasst", stand(app, player) == vorher)

    # ── 4: fremde Quelle ─────────────────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, sha256(archiv))
        vorher = stand(app, player)
        e = zieher(app, player, w / "lager", feed,
                   "https://github.com/splitti/MuPiBox.git", "--einspielen")
        p.pruefe("4 fremde Quelle wird abgelehnt", e.returncode == 2,
                 f"rc={e.returncode}\n{e.stdout[-400:]}")
        p.pruefe("4 nichts wurde angefasst", stand(app, player) == vorher)
        p.pruefe("4 der Grund nennt den Austausch", "Austausch" in e.stdout)

    # ── 5: Abbruch mitten im Laden ───────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, sha256(archiv))
        lager = w / "lager"
        lager.mkdir()
        # Der Abriss: die Haelfte liegt da, unter dem Namen, den der Zieher
        # benutzt. Genau so sieht eine Box aus, die mitten im Laden ausging.
        ganz = archiv.read_bytes()
        (lager / "v1.1.0.zip.teil").write_bytes(ganz[: len(ganz) // 2])
        e = zieher(app, player, lager, feed,
                   "http://git.local:3000/achim/box.git", "--einspielen")
        p.pruefe("5 nach dem Abriss laeuft es durch", e.returncode == 0,
                 f"rc={e.returncode}\n{e.stdout[-700:]}")
        p.pruefe("5 der neue Stand liegt am Ziel", NEU in stand(app, player))
        p.pruefe("5 das Halbe wurde nicht fuer voll genommen",
                 not (lager / "v1.1.0.zip.teil").exists())

    # ── 6: liegengebliebenes `.neu` ──────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="mixpi-probe-") as t:
        w = Path(t)
        app, player = box_bauen(w)
        archiv = paket_bauen(w / "v1.1.0.zip", NEU)
        feed = feed_schreiben(w / "version.json", archiv, sha256(archiv))
        # Muell aus einem Lauf, der nach dem Bereitlegen abriss.
        (app / "server.js.neu").write_text("// MUELL AUS EINEM ABGERISSENEN LAUF\n")
        (app / "www.neu").mkdir()
        (app / "www.neu" / "index.html").write_text("<!-- MUELL -->")
        e = zieher(app, player, w / "lager", feed,
                   "http://git.local:3000/achim/box.git", "--einspielen")
        p.pruefe("6 der Rest stoert den naechsten Lauf nicht", e.returncode == 0,
                 f"rc={e.returncode}\n{e.stdout[-700:]}")
        p.pruefe("6 der MUELL wurde nicht getauscht",
                 "MUELL" not in stand(app, player), stand(app, player)[:150])
        p.pruefe("6 der neue Stand liegt am Ziel", NEU in stand(app, player))

    print()
    print(f"  {p.gut} bestanden, {len(p.schlecht)} nicht.")
    if p.schlecht:
        print("NICHT IN ORDNUNG: " + ", ".join(p.schlecht))
        return 1
    print("IN ORDNUNG.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
