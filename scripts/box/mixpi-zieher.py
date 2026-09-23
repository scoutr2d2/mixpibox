#!/usr/bin/env python3
"""DIE BOX HOLT SICH IHRE NEUE FASSUNG SELBST — ziehen statt schieben.

WOZU, und was hier ausdruecklich NICHT neu gebaut wird
`tools/ausliefern.py` bedient eine laufende Box vom Arbeitsrechner aus: bauen,
pruefen, hochladen, unteilbar tauschen, nachmessen. Das ist der Weg, der heute
funktioniert — aber er setzt einen Menschen mit einem Laptop im selben Netz
voraus. Dieses Werkzeug dreht die Richtung um: die BOX fragt nach, holt, prueft
und tauscht. Der Tausch selbst, der Rueckweg und die Frist sind DIESELBEN
Stuecke, die der Laptop-Weg benutzt:

    scripts/box/mupibox-tauscher.py    renameat2(RENAME_EXCHANGE), Rueckweg
                                       unter festem Namen `….zurueck`
    scripts/box/mupibox-standwache.py  die Frist, die ohne Menschen zurueckdreht
    mupibox-sicherung.py               der Stand VOR dem Tausch

Neu ist hier nur, was vorher noch niemand tat: das Angebot holen, die Herkunft
beurteilen, das Artefakt PRUEFEN und den Ablauf so bauen, dass ein Abbruch an
jeder Stelle folgenlos bleibt.

══ DIE DREI MUSS-EIGENSCHAFTEN, UND WIE SIE HIER ENTSTEHEN ══════════════════

1) PRUEFSUMME, UND WENN MOEGLICH SIGNATUR
   Jeder Kanaleintrag MUSS `sha256` tragen. Ohne Pruefsumme wird nichts
   eingespielt — kein „ist wahrscheinlich in Ordnung". Gemessen wird die
   fertige Datei, nicht der Strom beim Laden.
   Die Pruefsumme steht IM Verzeichnis. Sie schuetzt damit gegen ein kaputtes
   oder ausgetauschtes ARTEFAKT, nicht gegen ein manipuliertes VERZEICHNIS —
   wer den Feed faelscht, faelscht die Pruefsumme mit. Deshalb gibt es die
   zweite Stufe: liegt unter `/etc/mupibox/mixpi-release.pub` ein oeffentlicher
   Schluessel, so ist eine Signatur PFLICHT (`signatur` am Eintrag, base64 ueber
   das Artefakt, geprueft mit openssl). Fehlt der Schluessel, laeuft es mit
   sha256 allein und SAGT das auch. Diese Richtung ist Absicht: einen Schluessel
   nachzulegen erhoeht die Huerde, und sie laesst sich nicht still wieder
   senken, weil ein vorhandener Schluessel die Signatur erzwingt.

2) RUECKWEG OHNE NETZ
   Der Rueckweg entsteht beim Tausch selbst und liegt LOKAL: `mupibox-tauscher`
   legt zu jedem Ziel eine `….zurueck` an (Baeume durch den Tausch selbst,
   Dateien als harte Verknuepfung). Zum Zurueckdrehen braucht es danach weder
   Netz noch Verzeichnis noch das Artefakt — nur diese Box. `--zurueckdrehen`
   faehrt genau das.
   Zusaetzlich legt Schritt 5 einen Stand ueber `mupibox-sicherung.py` an, und
   zwar NACHGEWIESEN ueber `--liste --json`: der Rueckgabewert des Werkzeugs
   ist in drei Lagen 0, ohne dass etwas entstanden ist.

3) ABBRUCHFESTIGKEIT — der Abbruch ist der Normalfall, nicht der Sonderfall
   Eine Box, die Kinder ausschalten, an einer Funkstrecke, die abreisst. Der
   Ablauf ist deshalb so geschnitten, dass JEDER Punkt einen von zwei Zustaenden
   hinterlaesst: „alt, unberuehrt" oder „neu, vollstaendig". Dazwischen gibt es
   nichts, das beim naechsten Start fuer gueltig gehalten wuerde.
     * Der Download landet unter `….teil` und wird erst nach bestandener
       Pruefsumme auf den Endnamen umbenannt. Ein halbes Archiv kann nie wie
       ein ganzes aussehen — auch nicht nach einem Stromausfall.
     * Ein liegengebliebenes `….teil` wird beim naechsten Lauf FORTGESETZT
       (HTTP-Range), nicht neu geholt. Bei 14 MB ueber eine wacklige Strecke
       ist das der Unterschied zwischen „geht irgendwann durch" und „faengt
       ewig von vorn an".
     * Liegt das fertige Archiv schon da und stimmt seine Summe, wird gar nicht
       geladen. Ein zweiter Aufruf nach einem Abbruch ist damit billig.
     * Alles vor dem Tausch geschieht im Zwischenlager. Reisst es dort ab, ist
       der laufende Baum nicht angefasst worden — es gibt nichts aufzuraeumen
       ausser dem Lager selbst, und das raeumt der naechste Lauf.
     * Der Tausch ist unteilbar (renameat2). Es gibt keinen Augenblick, in dem
       `www` fehlt.
     * NACH dem Tausch und VOR dem Neustart wird die Frist gestellt. Reisst es
       ab jetzt ab — Strom weg, Box aus, Verbindung tot —, dreht die BOX nach
       Ablauf von selbst zurueck. Kein Mensch, kein Netz.

══ ABLAUF (jeder Schritt vor dem Tausch bricht ab, ohne etwas anzufassen) ════
   1 Umgebung: Verzeichnisse, Tauscher, Sicherung, Schreibrecht
   2 Lage: Herkunft lesen, Verzeichnis holen, Angebot bestimmen, URTEILEN
   3 Holen: fortsetzbar, dann sha256 (und Signatur, wenn ein Schluessel liegt)
   4 Auspacken ins Lager, Inhalt pruefen (die vier Stuecke, `node --check`)
   5 Sicherung anlegen UND ueber --liste nachweisen
   6 Tauschen (unteilbar), Rueckweg entsteht
   7 Frist stellen — VOR dem Neustart
   8 Dienste neu starten
   9 Nachmessen; in Ordnung -> entwarnen, sonst -> sofort zurueckdrehen

══ RUECKGABEWERTE — sprechend, damit ein unbeaufsichtigter Lauf auswertbar ist
   0  fertig (auch: es gab nichts zu tun)
   1  Umgebung — Verzeichnis fehlt, kein Schreibrecht, Tauscher nicht da
   2  kein Angebot, oder das Urteil verweigert (fremde Quelle, Eigenbau)
   3  Holen oder Pruefen gescheitert          — NICHTS angefasst
   4  Sicherung nicht nachweisbar             — NICHTS angefasst
   5  Tausch gescheitert                      — teilweise, Rueckweg liegt
   6  nach dem Tausch nicht in Ordnung        — es wurde zurueckgedreht
   7  Probelauf hat etwas beanstandet

══ AUFRUF ═══════════════════════════════════════════════════════════════════
    mixpi-zieher.py --lage             nur berichten, nichts holen
    mixpi-zieher.py --holen            holen und pruefen, NICHT tauschen
    mixpi-zieher.py --einspielen       der ganze Weg
    mixpi-zieher.py --zurueckdrehen    der lokale Rueckweg, ohne Netz
    mixpi-zieher.py --lage --json      fuer Skripte

Woher es sein Verzeichnis nimmt (in dieser Reihenfolge): die Umgebung
(MIXPI_FEED, MIXPI_QUELLE, MIXPI_KANAL), sonst /etc/mupibox/mixpi-update.json.
Ohne Verzeichnis urteilt es „kein Angebot" und tut nichts — das ist die
richtige Auskunft fuer eine Box, fuer die niemand etwas veroeffentlicht hat,
und ausdruecklich kein Fehler.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# ── DIE ORTE, UND WARUM SIE SICH UEBERSCHREIBEN LASSEN ───────────────────────
#
# Dieses Werkzeug tauscht als root den Anwendungsbaum einer Box. Es LAESST SICH
# NICHT auf einem Arbeitsrechner ausprobieren, weil es die Box-Pfade fest
# eingebaut hat — und ein Weg, den man nicht ueben kann, wird erst im Ernstfall
# zum ersten Mal gefahren. Genau das soll hier nicht passieren.
#
# Deshalb liest jeder Ort eine Umgebungsvariable. Sie ist AUSSCHLIESSLICH fuer
# den Sandkasten da (`tools/mixpi-zieher-probe.py` baut damit eine ganze
# Schein-Box unter /tmp und faehrt den ECHTEN Code darin — nicht eine
# Nachbildung, die auseinanderlaufen kann).
#
# Auf einer Box ist keine davon gesetzt, und dann gelten die Vorgaben. Wer sie
# dort setzt, weiss, was er tut; ein Tippfehler faellt sofort auf, weil
# Schritt 1 „das ist keine Box" meldet, statt irgendwo hineinzuschreiben.
def _ort(name: str, vorgabe: str) -> str:
    return os.environ.get(name) or vorgabe


APPDIR = _ort("MIXPI_APPDIR", "/home/dietpi/.mupibox/Sonos-Kids-Controller-master")
PLAYERDIR = _ort("MIXPI_PLAYERDIR", "/home/dietpi/.mupibox/spotifycontroller-main")
LAGER = _ort("MIXPI_LAGER", "/home/dietpi/.mupibox/.zieher")
SICHERUNG = _ort("MIXPI_SICHERUNG", "/usr/local/bin/mupibox/mupibox-sicherung.py")
STANDWACHE = _ort("MIXPI_STANDWACHE", "/opt/mupibox-tools/mupibox-standwache.py")
TAUSCHER_ORTE = tuple(t for t in (
    os.environ.get("MIXPI_TAUSCHER"),
    "/opt/mupibox-tools/tauscher.py",
    "/usr/local/bin/mupibox/mupibox-tauscher.py",
    str(Path(__file__).resolve().parent / "mupibox-tauscher.py"),
) if t)
EINSTELLUNG = _ort("MIXPI_EINSTELLUNG", "/etc/mupibox/mixpi-update.json")
SCHLUESSEL = _ort("MIXPI_SCHLUESSEL", "/etc/mupibox/mixpi-release.pub")
FRIST_S = 600
# Auf einer Box laufen die Dienste unter systemd. Im Sandkasten gibt es keinen;
# dort wird der Neustart uebersprungen, statt `systemctl` anzuluegen.
OHNE_SYSTEMD = os.environ.get("MIXPI_OHNE_SYSTEMD") == "1"

RC_OK, RC_UMGEBUNG, RC_ANGEBOT, RC_PRUEFUNG, RC_SICHERUNG, RC_TAUSCH, RC_NACHHER, RC_PROBE = range(8)

# Was aus dem Archiv wohin geht. Dieselben Namen und Ziele wie in
# tools/ausliefern.py — wer dort eines aendert, aendert es hier mit.
# `plugins` und `scripts` fehlen mit Absicht: sie kommen NICHT aus deploy.zip,
# sondern aus dem Repo, und ein Zieher, der sie mittauschte, wuerde Dateien
# anfassen, die in seinem Archiv gar nicht vorkommen.
ZIELE = [
    {"name": "server", "art": "datei", "im_paket": "server.js",
     "ziel": f"{APPDIR}/server.js", "dienst": "mupibox-server.service"},
    {"name": "laufwerk", "art": "datei", "im_paket": "plugin-laufwerk.js",
     "ziel": f"{APPDIR}/plugin-laufwerk.js", "dienst": "mupibox-server.service"},
    {"name": "player", "art": "datei", "im_paket": "spotify-control.js",
     "ziel": f"{PLAYERDIR}/spotify-control.js", "dienst": "mupibox-player.service"},
    {"name": "www", "art": "baum", "im_paket": "www",
     "ziel": f"{APPDIR}/www", "dienst": None},
    {"name": "admin", "art": "baum", "im_paket": "www-admin",
     "ziel": f"{APPDIR}/www-admin", "dienst": None},
    # Der Stempel zuletzt: er behauptet, was installiert IST. Stuende er vorn
    # und der Lauf braeche danach ab, behauptete die Box eine Fassung, die sie
    # nicht faehrt — und der naechste Lauf urteilte auf dieser Luege.
    {"name": "herkunft", "art": "datei", "im_paket": "herkunft.json",
     "ziel": f"{APPDIR}/herkunft.json", "dienst": None},
]


class Bericht:
    """Sammelt den Verlauf — und schreibt ihn NACH JEDER ZEILE weg, wenn ein
    Berichtspfad gesetzt ist.

    WARUM NACH JEDER ZEILE UND NICHT AM ENDE: Der Aufrufer ist unter Umstaenden
    die Verwaltungsoberflaeche, und dieser Weg startet `mupibox-server.service`
    neu — also genau den Prozess, der die Anfrage bedient. Ein Bericht, der erst
    am Ende entstuende, waere fuer die Oberflaeche nie sichtbar: sie verliert
    die Verbindung mitten im Lauf und kann danach nur noch NACHLESEN, was
    passiert ist. Deshalb ist die Datei der Bericht, nicht die Rueckgabe.

    GESCHRIEBEN WIRD UNTEILBAR (Nachbardatei + rename): die Oberflaeche liest
    dieselbe Datei im Sekundentakt und darf nie eine halb geschriebene sehen.
    """

    def __init__(self, still: bool = False, datei: str = ""):
        self.still = still
        self.datei = datei
        self.zeilen: list[dict] = []
        self.warnungen: list[str] = []
        self.fehler: list[str] = []
        self.laeuft = True
        self.rc: int | None = None
        self.schreiben()

    def schreiben(self) -> None:
        if not self.datei:
            return
        try:
            stand = {"laeuft": self.laeuft, "rc": self.rc, "zeilen": self.zeilen,
                     "warnungen": self.warnungen, "fehler": self.fehler,
                     "stand": time.strftime("%Y-%m-%dT%H:%M:%S")}
            neben = self.datei + ".neu"
            with open(neben, "w", encoding="utf-8") as f:
                json.dump(stand, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(neben, 0o644)   # die Oberflaeche laeuft nicht als root
            os.replace(neben, self.datei)
        except OSError:
            # Ein Bericht, der sich nicht schreiben laesst, darf den Lauf nicht
            # anhalten — das Update ist wichtiger als sein Protokoll.
            pass

    def fertig(self, rc: int) -> None:
        self.laeuft = False
        self.rc = rc
        self.schreiben()

    def sag(self, text: str) -> None:
        self.zeilen.append({"art": "info", "text": text})
        self.schreiben()
        if not self.still:
            print(text, flush=True)

    def schritt(self, nr, text: str) -> None:
        self.sag(f"  {nr}  {text}")

    def warnung(self, text: str) -> None:
        self.warnungen.append(text)
        self.zeilen.append({"art": "warnung", "text": text})
        self.schreiben()
        if not self.still:
            print(f"  WARNUNG: {text}", flush=True)

    def fehler_(self, text: str) -> None:
        self.fehler.append(text)
        self.zeilen.append({"art": "fehler", "text": text})
        self.schreiben()
        if not self.still:
            print(f"  FEHLER: {text}", flush=True)


# ── Kleinkram ────────────────────────────────────────────────────────────────

def sha256_datei(pfad: Path) -> str:
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def lauf(befehl: list[str], eingabe: str | None = None, zeitlimit: int = 120):
    return subprocess.run(befehl, input=eingabe, capture_output=True,
                          text=True, timeout=zeitlimit)


def einstellung_lesen() -> dict:
    """Umgebung schlaegt Datei. Beides darf fehlen."""
    k = {}
    try:
        k = json.loads(Path(EINSTELLUNG).read_text(encoding="utf-8"))
        if not isinstance(k, dict):
            k = {}
    except (OSError, ValueError):
        k = {}
    return {
        "feed": os.environ.get("MIXPI_FEED") or k.get("feed") or "",
        "quelle": os.environ.get("MIXPI_QUELLE") or k.get("quelle") or "",
        "kanal": os.environ.get("MIXPI_KANAL") or k.get("kanal") or "stable",
    }


# ── Das Urteil — dieselben Regeln wie src/backend-api/src/aktualisierung.ts ──
#
# BEWUSST NACHGEBAUT UND NICHT ABGEFRAGT: Der Server koennte beim Update gerade
# derjenige sein, der ersetzt wird. Ein Zieher, der sein Urteil von dem Dienst
# holt, den er anfasst, steht ohne Urteil da, sobald es darauf ankommt.
# Die Regeln sind kurz genug, dass zwei Fassungen tragbar sind; die
# Reihenfolge (Herkunft VOR Fassung) ist der Kern und in beiden gleich.

# Die Rangfolge der Vorabstufen — WORTGLEICH mit STUFEN in
# src/backend-api/src/aktualisierung.ts.
#
#   dev     „alle Aenderungen"      — laeuft mit, sobald etwas fertig ist
#   beta    „ein Stable-Kandidat"   — das, was stable werden soll
#   stable  „ist dann ja stable"
#
# Eine Fassung beginnt als `v1.2.0-dev.N`, wird als `v1.2.0-beta.N` Kandidat
# und kommt als `v1.2.0` an. Der Kern bleibt derselbe, nur die Stufe steigt.
#
# NICHT ALPHABETISCH: Semver vergleicht Vorabkennungen als Text, und da kaeme
# „beta" vor „dev" — verkehrt herum zur Bedeutung hier. Unbekanntes rangiert
# GANZ UNTEN, damit sich nie eine Box an einem Anhaengsel hochzieht, das
# niemand eingeordnet hat.
STUFEN = {"dev": 1, "beta": 2}
STUFE_UNBEKANNT = 0
STUFE_FERTIG = 3


def zerlege(v: str) -> tuple[list[int], int, int] | None:
    """(Kern, Stufe, Laufnummer) — oder None, wenn unvergleichbar.

    ACHTUNG, NAHT: `zerlegeFassung()` in src/backend-api/src/aktualisierung.ts
    muss GENAU dasselbe tun. Die Box urteilt mit dieser Fassung, die
    Verwaltungsseite mit jener; laufen sie auseinander, bietet die eine etwas
    an, das die andere ablehnt. `tools/mixpi-fassungsvergleich-deckung.py`
    faehrt beide gegen dieselbe Faelleliste.
    """
    roh = str(v or "").strip()
    if roh[:1] in ("v", "V") and roh[1:2].isdigit():
        roh = roh[1:]
    roh = roh.split(" ")[0]          # Upstreams lange Formen („4.2.0 stable")
    if not roh:
        return None
    stuecke = roh.split("-")
    kern = stuecke[0].split("+")[0]
    teile = kern.split(".")
    if not kern or not all(t.isdigit() for t in teile):
        return None
    zahlen = [int(t) for t in teile]
    if len(stuecke) == 1:
        return (zahlen, STUFE_FERTIG, 0)
    anhang = "-".join(stuecke[1:]).split("+")[0].split(".")
    try:
        lauf = int(anhang[1]) if len(anhang) > 1 else 0
    except ValueError:
        lauf = 0
    return (zahlen, STUFEN.get(anhang[0].lower(), STUFE_UNBEKANNT), lauf)


def vergleiche(a: str, b: str) -> int | None:
    x, y = zerlege(a), zerlege(b)
    if x is None or y is None:
        return None
    xk, xs, xl = x
    yk, ys, yl = y
    for i in range(max(len(xk), len(yk))):
        d = (xk[i] if i < len(xk) else 0) - (yk[i] if i < len(yk) else 0)
        if d:
            return -1 if d < 0 else 1
    # Gleicher Kern, verschiedene Stufe: die Vorabfassung ist die aeltere.
    # Ohne diesen Schritt waren beta.1 und beta.3 GLEICH und der beta-Kanal
    # damit wirkungslos (31.08.2026 gemessen).
    if xs != ys:
        return -1 if xs < ys else 1
    if xl != yl:
        return -1 if xl < yl else 1
    return 0


def gleiche_quelle(a: str, b: str) -> bool:
    def norm(s: str) -> str:
        s = str(s or "").strip().lower()
        for vorn in ("git+",):
            if s.startswith(vorn):
                s = s[len(vorn):]
        if "://" in s:
            s = s.split("://", 1)[1]
        if s.startswith("git@"):
            s = s[4:]
        s = s.replace(":", "/")
        if s.endswith(".git"):
            s = s[:-4]
        return s.rstrip("/")
    x, y = norm(a), norm(b)
    return x != "" and x == y


def neuestes_angebot(feed: dict, kanal: str) -> dict | None:
    liste = ((feed or {}).get("release") or {}).get(kanal)
    if not isinstance(liste, list):
        return None
    for e in reversed(liste):
        if not isinstance(e, dict):
            continue
        if e.get("version") and e.get("url") and zerlege(e["version"]) is not None:
            return e
    return None


def beurteile(herkunft: dict | None, installiert: str, angebot: dict | None,
              angebotsquelle: str) -> dict:
    angeboten = (angebot or {}).get("version", "")
    if not angebot:
        return {"urteil": "keinAngebot", "installiert": installiert, "angeboten": ""}
    if not herkunft or not herkunft.get("quelle"):
        return {"urteil": "herkunftUnbekannt", "installiert": installiert,
                "angeboten": angeboten,
                "grund": "Die Box hat nicht hinterlegt, woher ihre Software stammt."}
    if not gleiche_quelle(herkunft["quelle"], angebotsquelle):
        return {"urteil": "fremdeQuelle", "installiert": installiert,
                "angeboten": angeboten,
                "grund": f"Installiert ist eine Fassung aus {herkunft['quelle']}, "
                         f"angeboten wird eine aus {angebotsquelle}. Das ist kein "
                         f"Update, sondern ein Austausch."}
    eigene = int(herkunft.get("eigeneCommits") or 0)
    unsauber = int(herkunft.get("unsauber") or 0)
    if eigene > 0 or unsauber > 0:
        teile = []
        if eigene:
            teile.append(f"{eigene} eigene Commits")
        if unsauber:
            teile.append(f"{unsauber} geaenderte Datei(en)")
        return {"urteil": "eigenbau", "installiert": installiert, "angeboten": angeboten,
                "grund": f"Diese Box laeuft ein selbst gebautes Abbild "
                         f"({', '.join(teile)} gegenueber der Quelle). Ein Update von "
                         f"dort waere ein Rueckschritt."}
    v = vergleiche(angeboten, installiert)
    if v is None:
        return {"urteil": "unklar", "installiert": installiert, "angeboten": angeboten,
                "grund": "Die Fassungsnummern lassen sich nicht vergleichen."}
    return {"urteil": "neuer" if v > 0 else "aktuell",
            "installiert": installiert, "angeboten": angeboten}


# ── Schritt 1: Umgebung ──────────────────────────────────────────────────────

def tauscher_finden() -> str | None:
    for p in TAUSCHER_ORTE:
        if os.path.isfile(p):
            return p
    return None


def umgebung_pruefen(b: Bericht, nur_lesen: bool) -> str | None:
    fehlt = [d for d in (APPDIR, PLAYERDIR) if not os.path.isdir(d)]
    if fehlt:
        b.fehler_(f"Verzeichnis fehlt: {', '.join(fehlt)} — das ist keine Box.")
        return None
    t = tauscher_finden()
    if t is None:
        b.fehler_(f"Der Tauscher liegt nirgends: {', '.join(TAUSCHER_ORTE)}")
        return None
    if not nur_lesen:
        # Der Tausch braucht Schreibrecht IM Elternverzeichnis, nicht am Ziel:
        # renameat2 und rename setzen dort an.
        for d in {os.path.dirname(z["ziel"]) for z in ZIELE}:
            if not os.access(d, os.W_OK):
                b.fehler_(f"Kein Schreibrecht in {d} — als root aufrufen.")
                return None
    return t


# ── Schritt 2: Lage ──────────────────────────────────────────────────────────

def herkunft_lesen() -> dict | None:
    try:
        return json.loads(Path(APPDIR, "herkunft.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def feed_holen(b: Bericht, adresse: str) -> dict | None:
    if not adresse:
        return None
    try:
        with urllib.request.urlopen(adresse, timeout=15) as a:
            return json.loads(a.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as e:
        # Eine Box ohne Netz ist der Normalfall, kein Fehlerzustand.
        b.warnung(f"Verzeichnis nicht erreichbar ({adresse}): {e}")
        return None


# ── Schritt 3: holen, fortsetzbar, und pruefen ───────────────────────────────

def holen(b: Bericht, url: str, ziel: Path, erwartet_sha: str) -> bool:
    """Laedt nach `ziel`. Fortsetzbar, und erst nach bestandener Summe gueltig."""
    teil = ziel.with_suffix(ziel.suffix + ".teil")

    # Liegt das Fertige schon da und stimmt? Dann ist der billigste Download
    # der, der nicht stattfindet — nach einem Abbruch der Normalfall.
    if ziel.is_file():
        if sha256_datei(ziel) == erwartet_sha:
            b.sag(f"      liegt schon vollstaendig da ({ziel.name})")
            return True
        b.warnung("Ein Archiv gleichen Namens lag da, aber mit anderer Summe — "
                  "wird verworfen und neu geholt.")
        ziel.unlink()

    ab = teil.stat().st_size if teil.is_file() else 0
    if ab:
        b.sag(f"      setze bei {ab / 1e6:.1f} MB fort")

    anfrage = urllib.request.Request(url)
    if ab:
        anfrage.add_header("Range", f"bytes={ab}-")
    try:
        with urllib.request.urlopen(anfrage, timeout=60) as a:
            # 206 = der Server macht den Bereich mit. 200 = er kann es nicht,
            # dann faengt der Inhalt wieder bei 0 an und das Angefangene MUSS
            # weg — sonst klebte der neue Anfang hinter dem alten Anfang.
            if ab and getattr(a, "status", 200) != 206:
                b.sag("      der Server kann nicht fortsetzen — von vorn")
                ab = 0
            with open(teil, "ab" if ab else "wb") as f:
                while True:
                    brocken = a.read(1 << 20)
                    if not brocken:
                        break
                    f.write(brocken)
                f.flush()
                os.fsync(f.fileno())
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        b.fehler_(f"Laden abgebrochen: {e}")
        # NUR SAGEN, WAS AUCH STIMMT. Reisst schon der Verbindungsaufbau ab,
        # ist NICHTS angefangen worden, und „der naechste Lauf setzt fort"
        # waere eine Zusage auf eine Datei, die es nicht gibt. Am 31.08.2026
        # an der Box genau so passiert: das Verzeichnis kam durch einen Tunnel,
        # die Artefakt-Adresse darin zeigte woandershin, der Zwischenspeicher
        # blieb leer — und die Meldung behauptete trotzdem einen Rest.
        liegt = teil.stat().st_size if teil.is_file() else 0
        if liegt:
            b.sag(f"      {liegt / 1e6:.1f} MB liegen — der naechste Lauf setzt fort.")
        else:
            b.sag("      Es wurde nichts geladen; der naechste Lauf faengt von vorn an.")
            b.sag(f"      (Ist {url} von dieser Box aus erreichbar?)")
        return False

    ist = sha256_datei(teil)
    if ist != erwartet_sha:
        b.fehler_(f"Pruefsumme stimmt nicht.\n"
                  f"      erwartet {erwartet_sha}\n"
                  f"      bekommen {ist}")
        # Ein Rest mit falscher Summe darf NICHT liegenbleiben: der naechste
        # Lauf haenge sonst weiteren Inhalt an einen kaputten Anfang und
        # bekaeme nie eine stimmende Summe.
        teil.unlink(missing_ok=True)
        return False

    # Erst JETZT bekommt es den Endnamen. Bis hierher konnte nichts es fuer
    # gueltig halten.
    os.replace(teil, ziel)
    return True


def signatur_pruefen(b: Bericht, archiv: Path, angebot: dict) -> bool:
    """Fail-closed: liegt ein Schluessel, ist die Signatur Pflicht."""
    if not os.path.isfile(SCHLUESSEL):
        b.sag("      keine Signatur geprueft (kein Schluessel unter "
              f"{SCHLUESSEL}) — es gilt die Pruefsumme aus dem Verzeichnis")
        return True
    sig = angebot.get("signatur")
    if not sig:
        b.fehler_(f"Es liegt ein Schluessel unter {SCHLUESSEL}, aber der Eintrag "
                  f"traegt keine `signatur`. Abgelehnt.")
        return False
    if not shutil.which("openssl"):
        b.fehler_("openssl fehlt — die verlangte Signatur ist nicht pruefbar.")
        return False
    import base64
    with tempfile.NamedTemporaryFile(delete=False) as f:
        sigdatei = f.name
        try:
            f.write(base64.b64decode(sig))
        except Exception as e:  # noqa: BLE001
            b.fehler_(f"`signatur` ist kein gueltiges base64: {e}")
            os.unlink(sigdatei)
            return False
    try:
        p = lauf(["openssl", "dgst", "-sha256", "-verify", SCHLUESSEL,
                  "-signature", sigdatei, str(archiv)])
        if p.returncode != 0:
            b.fehler_(f"Signatur NICHT gueltig: {(p.stdout or p.stderr).strip()[:200]}")
            return False
    finally:
        os.unlink(sigdatei)
    b.sag("      Signatur gueltig")
    return True


# ── Schritt 4: auspacken und den Inhalt pruefen ──────────────────────────────

def auspacken(b: Bericht, archiv: Path, hinein: Path) -> bool:
    shutil.rmtree(hinein, ignore_errors=True)
    hinein.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archiv) as z:
            kaputt = z.testzip()
            if kaputt:
                b.fehler_(f"Archiv beschaedigt bei {kaputt}")
                return False
            for eintrag in z.infolist():
                # Kein Ausbruch aus dem Zielordner ueber `../` oder absolute
                # Pfade. Die Summe stimmt zwar — aber sie sagt nur, dass das
                # Archiv das erwartete IST, nicht dass sein Inhalt harmlos ist.
                p = (hinein / eintrag.filename).resolve()
                if not str(p).startswith(str(hinein.resolve())):
                    b.fehler_(f"Archiv will ausserhalb schreiben: {eintrag.filename}")
                    return False
            z.extractall(hinein)
            # extractall wirft die Rechte weg; ausfuehrbare Stuecke blieben
            # sonst ohne x-Bit liegen.
            for eintrag in z.infolist():
                modus = eintrag.external_attr >> 16
                if modus:
                    ziel = hinein / eintrag.filename
                    if ziel.exists() and not ziel.is_symlink():
                        os.chmod(ziel, modus & 0o7777)
    except (zipfile.BadZipFile, OSError) as e:
        b.fehler_(f"Auspacken gescheitert: {e}")
        return False
    return True


def inhalt_pruefen(b: Bericht, aus: Path) -> bool:
    gut = True
    for z in ZIELE:
        p = aus / z["im_paket"]
        if z["art"] == "baum":
            if not (p / "index.html").is_file():
                b.fehler_(f"{z['im_paket']}/index.html fehlt im Paket")
                gut = False
        elif not p.is_file():
            b.fehler_(f"{z['im_paket']} fehlt im Paket")
            gut = False
    if not gut:
        return False
    # `node --check` auf die Stuecke, die node startet. Ein Archiv mit
    # stimmender Summe kann trotzdem aus einem kaputten Bau stammen.
    if shutil.which("node"):
        for name in ("server.js", "plugin-laufwerk.js", "spotify-control.js"):
            p = lauf(["node", "--check", str(aus / name)], zeitlimit=60)
            if p.returncode != 0:
                b.fehler_(f"{name} ist kein gueltiges JavaScript: "
                          f"{(p.stderr or '').strip()[:200]}")
                return False
    else:
        b.warnung("node fehlt — die Stuecke wurden nicht gegengelesen.")
    return True


# ── Schritt 5: Sicherung, nachgewiesen ───────────────────────────────────────

def sicherung_anlegen(b: Bericht, grund: str) -> bool:
    if not os.path.isfile(SICHERUNG):
        b.warnung(f"Sicherungswerkzeug fehlt ({SICHERUNG}).")
        return False
    vorher = sicherung_liste()
    lauf([sys.executable, SICHERUNG, "--anlegen", "--grund", grund, "--behalten"], zeitlimit=300)
    # NICHT dem Rueckgabewert glauben: er ist in drei Lagen 0, ohne dass
    # etwas entstanden ist. Nachgewiesen wird ueber die Liste.
    nachher = sicherung_liste()
    if len(nachher) > len(vorher):
        b.sag(f"      Stand angelegt ({len(nachher)} vorhanden)")
        return True
    b.fehler_("Es ist kein neuer Stand entstanden.")
    return False


def sicherung_liste() -> list:
    try:
        p = lauf([sys.executable, SICHERUNG, "--liste", "--json"], zeitlimit=120)
        if p.returncode != 0:
            return []
        d = json.loads(p.stdout)
        return d if isinstance(d, list) else (d.get("staende") or [])
    except (OSError, ValueError, subprocess.SubprocessError):
        return []


# ── Schritte 6-9: tauschen, Frist, Neustart, nachmessen ──────────────────────

def tauscher_rufen(tauscher: str, modus: str, auftrag: dict) -> dict:
    p = lauf([sys.executable, tauscher, modus], eingabe=json.dumps(auftrag),
             zeitlimit=600)
    if p.returncode != 0:
        raise RuntimeError(f"Tauscher {modus}: {(p.stderr or p.stdout).strip()[:300]}")
    return json.loads(p.stdout)


def auftrag_bauen(aus: Path) -> list[dict]:
    ziele = []
    for z in ZIELE:
        ziele.append({
            "name": z["name"],
            "art": z["art"],
            "ziel": z["ziel"],
            # `.neu` MUSS im selben Verzeichnis liegen: renameat2 und rename
            # arbeiten nicht ueber Dateisystemgrenzen.
            "neu": z["ziel"] + ".neu",
            "zurueck": z["ziel"] + ".zurueck",
            "quelle": str(aus / z["im_paket"]),
        })
    return ziele


def eigentum_uebernehmen(b: Bericht, vorbild: Path, neu: Path) -> None:
    """Dem Neuen den Eigentuemer geben, den das Alte hatte.

    ══ WARUM DAS SEIN MUSS (31.08.2026, an Box .79 aufgelaufen) ══════════════
    Dieser Weg laeuft als ROOT (er braucht systemctl, die Frist und die
    Sicherung). Was er auspackt, gehoert damit root — und nach dem Tausch
    liegen root-eigene Baeume im Anwendungsordner, der sonst dietpi gehoert.

    Der Schaden zeigt sich erst beim NAECHSTEN Mal, und dann woanders:
    `tools/ausliefern.py` liefert vom Arbeitsrechner aus als dietpi, und
    `renameat2` auf ein VERZEICHNIS verlangt Schreibrecht IM Verzeichnis
    (es muss dessen `..` fortschreiben). Gegen einen root-eigenen `www-admin`
    scheitert das mit „Permission denied" — mitten im Tausch, mit halb
    getauschtem Baum und gestellter Frist. Gemessen: genau so passiert.

    Zwei Ausrollwege mit verschiedenen Benutzern, und der eine vergiftet still
    den anderen. Deshalb erbt das Neue das Eigentum des Alten, statt seines
    Erzeugers. Gibt es das Alte noch nicht, bleibt es wie es ist — dann gibt
    es auch niemanden, dem es wegzunehmen waere.
    """
    try:
        alt = vorbild.lstat()
    except OSError:
        return
    try:
        os.chown(neu, alt.st_uid, alt.st_gid, follow_symlinks=False)
        if neu.is_dir() and not neu.is_symlink():
            for ordner, unter, dateien in os.walk(neu):
                for name in unter + dateien:
                    try:
                        os.chown(os.path.join(ordner, name), alt.st_uid, alt.st_gid,
                                 follow_symlinks=False)
                    except OSError:
                        pass
    except OSError as e:
        # Ohne root geht das nicht — dann laeuft dieser Weg aber auch nicht als
        # root, und der Tausch scheitert gleich selbst. Melden, nicht abbrechen.
        b.warnung(f"Eigentuemer von {neu.name} nicht gesetzt: {e}")


def bereitlegen(b: Bericht, ziele: list[dict]) -> bool:
    """Das Neue neben das Ziel legen — noch tut es nichts."""
    for z in ziele:
        neu, quelle = Path(z["neu"]), Path(z["quelle"])
        # Reste eines abgerissenen Laufs. Sie sind wertlos: der Tausch hat sie
        # nie angefasst, sonst hiessen sie `.zurueck`.
        if neu.is_symlink() or neu.is_file():
            neu.unlink()
        elif neu.is_dir():
            shutil.rmtree(neu, ignore_errors=True)
        try:
            if z["art"] == "baum":
                shutil.copytree(quelle, neu, symlinks=True)
            else:
                shutil.copy2(quelle, neu)
            eigentum_uebernehmen(b, Path(z["ziel"]), neu)
            # Auf die Platte, bevor getauscht wird. Ein Tausch, dessen Inhalt
            # noch im Schreibpuffer steht, ueberlebt den Stromausfall nicht.
            os.sync()
        except OSError as e:
            b.fehler_(f"{z['name']} liess sich nicht bereitlegen: {e}")
            return False
    return True


def frist_stellen(b: Bericht, ziele: list[dict], getauscht: list[str],
                  dienste: list[str], stempel: str) -> bool:
    if not os.path.isfile(STANDWACHE):
        b.warnung(f"Die Standwache liegt nicht da ({STANDWACHE}). Es wird KEINE "
                  f"Frist gestellt — ein Abriss ab hier bliebe unbemerkt.")
        return False
    auftrag = {
        "von": f"mixpi-zieher.py auf {os.uname().nodename}",
        "stempel": stempel,
        "frist_s": FRIST_S,
        "ziele": [z for z in ziele if z["name"] in getauscht],
        "dienste": dienste,
        "dienste_vorher": {d: dienst_kennung(d) for d in dienste},
        "wirkung": [{"pfad": "/api/oberflaeche/stand", "hat": ""}],
    }
    p = lauf([sys.executable, STANDWACHE, "--stellen"], eingabe=json.dumps(auftrag), zeitlimit=60)
    if p.returncode != 0:
        b.warnung(f"Frist liess sich nicht stellen: "
                  f"{(p.stderr or p.stdout).strip()[:200]}")
        return False
    # Eine Frist, die niemand abwartet, ist schlimmer als keine — man verlaesst
    # sich darauf.
    q = lauf(["systemctl", "is-active", "mupibox-standwache.timer"], zeitlimit=30)
    if (q.stdout or "").strip() != "active":
        b.warnung("mupibox-standwache.timer laeuft NICHT — die Frist liefe nie ab.")
        return False
    b.sag("      Frist steht: laeuft sie ab, dreht die BOX von selbst zurueck.")
    return True


def dienst_kennung(dienst: str) -> list[str]:
    if OHNE_SYSTEMD:
        return [""]
    p = lauf(["systemctl", "show", "-p", "MainPID", "--value", dienst], zeitlimit=30)
    return [(p.stdout or "").strip()]


def dienste_neu_starten(b: Bericht, dienste: list[str]) -> bool:
    if OHNE_SYSTEMD:
        b.sag("      (ohne systemd — kein Neustart)")
        return True
    gut = True
    for d in dienste:
        p = lauf(["systemctl", "restart", d], zeitlimit=180)
        if p.returncode != 0:
            b.fehler_(f"{d} startete nicht: {(p.stderr or '').strip()[:200]}")
            gut = False
    return gut


def nachmessen(b: Bericht, dienste: list[str]) -> bool:
    if OHNE_SYSTEMD:
        b.sag("      (ohne systemd — Dienstzustand nicht messbar)")
        return True
    # Erst laufen lassen, dann fragen: ein Dienst, der beim Start abstuerzt,
    # steht eine Sekunde lang auf `activating`.
    time.sleep(5)
    gut = True
    for d in dienste:
        p = lauf(["systemctl", "is-active", d], zeitlimit=30)
        zustand = (p.stdout or "").strip()
        if zustand != "active":
            b.fehler_(f"{d} ist {zustand or 'nicht auffindbar'}")
            gut = False
    return gut


def zurueckdrehen(b: Bericht, tauscher: str, ziele: list[dict],
                  dienste: list[str]) -> bool:
    """Der Rueckweg. Braucht weder Netz noch Verzeichnis noch Archiv."""
    da = [z for z in ziele if os.path.lexists(z["zurueck"])]
    if not da:
        b.warnung("Es liegt keine Rueckdreh-Erzeugung dieses Weges da.")
        return False
    b.sag(f"      drehe {len(da)} Ziel(e) zurueck")
    try:
        befund = tauscher_rufen(tauscher, "zurueckdrehen", {"ziele": da})
    except (RuntimeError, ValueError, subprocess.SubprocessError) as e:
        b.fehler_(f"Zurueckdrehen gescheitert: {e}")
        return False
    gut = True
    for f in befund.get("fehler") or []:
        b.fehler_(f)
        gut = False
    # OHNE WIRKUNG IST KEIN ERFOLG, und der Tauscher meldet es getrennt von
    # `fehler`. Zeigen Ziel und Rueckweg auf denselben Inode, hat das
    # Vertauschen NICHTS getan — der Zustand entsteht, wenn ein Lauf zwischen
    # `os.link` und `os.replace` abriss. Wer das als Erfolg durchwinkt, glaubt
    # zurueckgedreht zu haben und faehrt weiter die kaputte Fassung.
    for n in befund.get("ohne_wirkung") or []:
        b.fehler_(f"{n}: Ziel und Rueckweg sind dieselbe Datei — nicht zurueckgedreht.")
        gut = False
    for n in befund.get("ohne_rueckweg") or []:
        b.warnung(f"{n}: kein Rueckweg da — uebersprungen.")
    if not gut:
        return False
    if dienste:
        dienste_neu_starten(b, dienste)
    b.sag(f"      zurueckgedreht: {', '.join(befund.get('zurueck') or []) or 'nichts'}")
    return True


# ── Der Ablauf ───────────────────────────────────────────────────────────────

def lage_bestimmen(b: Bericht, k: dict) -> tuple[dict, dict | None]:
    herkunft = herkunft_lesen()
    installiert = (herkunft or {}).get("version", "")
    feed = feed_holen(b, k["feed"]) if k["feed"] else None
    if not k["feed"]:
        b.sag("  Kein Verzeichnis eingetragen (MIXPI_FEED bzw. "
              f"{EINSTELLUNG}). Es gibt nichts zu holen.")
    angebot = neuestes_angebot(feed, k["kanal"]) if feed else None
    lage = beurteile(herkunft, installiert, angebot, k["quelle"])
    lage["kanal"] = k["kanal"]
    return lage, angebot


def einspielen(b: Bericht, k: dict, a) -> int:
    tauscher = umgebung_pruefen(b, nur_lesen=a.lage)
    if tauscher is None:
        return RC_UMGEBUNG

    b.schritt(2, "Lage")
    lage, angebot = lage_bestimmen(b, k)
    b.sag(f"      installiert {lage['installiert'] or '?'} | "
          f"angeboten {lage['angeboten'] or '—'} | Urteil: {lage['urteil']}")
    if lage.get("grund"):
        b.sag(f"      {lage['grund']}")

    if a.lage:
        return RC_OK if lage["urteil"] in ("aktuell", "neuer", "keinAngebot") else RC_ANGEBOT

    if lage["urteil"] in ("keinAngebot", "aktuell"):
        b.sag("  Nichts zu tun.")
        return RC_OK
    if lage["urteil"] in ("fremdeQuelle", "eigenbau", "herkunftUnbekannt", "unklar"):
        if not a.erzwingen:
            b.sag("  ABGELEHNT. Mit --erzwingen liesse sich das uebergehen — wer das "
                  "tut, sollte den Grund oben gelesen haben.")
            return RC_ANGEBOT
        b.warnung(f"--erzwingen: Urteil `{lage['urteil']}` wird uebergangen.")

    sha = (angebot or {}).get("sha256", "")
    if not sha:
        b.fehler_("Der Eintrag traegt keine `sha256`. Ohne Pruefsumme wird nichts "
                  "eingespielt.")
        return RC_PRUEFUNG

    lager = Path(LAGER)
    lager.mkdir(parents=True, exist_ok=True)
    archiv = lager / f"{angebot['version']}.zip"
    aus = lager / "aus"

    b.schritt(3, f"Holen ({angebot['version']})")
    if not holen(b, angebot["url"], archiv, sha):
        return RC_PRUEFUNG
    b.sag(f"      Pruefsumme stimmt ({sha[:16]}…)")
    if not signatur_pruefen(b, archiv, angebot):
        return RC_PRUEFUNG

    b.schritt(4, "Auspacken und gegenlesen")
    if not auspacken(b, archiv, aus) or not inhalt_pruefen(b, aus):
        return RC_PRUEFUNG
    b.sag("      Paket ist vollstaendig und lesbar.")

    if a.holen:
        b.sag("  --holen: hier ist Schluss. Nichts getauscht.")
        return RC_OK

    b.schritt(5, "Sicherung")
    if not sicherung_anlegen(b, f"vor-update-{angebot['version']}"):
        if not a.erzwingen:
            b.sag("  Ohne nachgewiesenen Stand wird nicht getauscht.")
            return RC_SICHERUNG
        b.warnung("--erzwingen: ohne nachgewiesene Sicherung weiter.")

    ziele = auftrag_bauen(aus)
    b.schritt(6, "Bereitlegen und tauschen")
    if not bereitlegen(b, ziele):
        return RC_PRUEFUNG   # noch nichts angefasst

    stempel = time.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        befund = tauscher_rufen(tauscher, "tauschen", {"ziele": ziele})
    except (RuntimeError, ValueError, subprocess.SubprocessError) as e:
        b.fehler_(f"Tausch gescheitert: {e}")
        return RC_TAUSCH
    getauscht = befund.get("getauscht") or []
    for f in befund.get("fehler") or []:
        b.fehler_(f)
    if not getauscht:
        b.fehler_("Nichts wurde getauscht.")
        return RC_TAUSCH
    b.sag(f"      getauscht: {', '.join(getauscht)}")

    dienste = sorted({z["dienst"] for z in ZIELE
                      if z["name"] in getauscht and z["dienst"]})

    b.schritt(7, "Frist stellen — VOR dem Neustart")
    frist = frist_stellen(b, ziele, getauscht, dienste, stempel)

    b.schritt(8, f"Dienste neu starten ({', '.join(dienste) or 'keine'})")
    gestartet = dienste_neu_starten(b, dienste)

    b.schritt(9, "Nachmessen")
    if gestartet and nachmessen(b, dienste):
        b.sag("      Dienste laufen.")
        if frist:
            lauf([sys.executable, STANDWACHE, "--entwarnen"], zeitlimit=60)
            b.sag("      Frist entwarnt.")
        b.sag(f"  FERTIG — {angebot['version']} laeuft.")
        return RC_OK

    b.fehler_("Nach dem Tausch ist etwas nicht in Ordnung — drehe zurueck.")
    zurueckdrehen(b, tauscher, ziele, dienste)
    if frist:
        lauf([sys.executable, STANDWACHE, "--entwarnen"], zeitlimit=60)
    return RC_NACHHER


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--lage", action="store_true", help="nur berichten")
    g.add_argument("--holen", action="store_true", help="holen und pruefen, nicht tauschen")
    g.add_argument("--einspielen", action="store_true", help="der ganze Weg")
    g.add_argument("--zurueckdrehen", action="store_true", help="lokaler Rueckweg")
    p.add_argument("--erzwingen", action="store_true",
                   help="Urteil und fehlende Sicherung uebergehen")
    p.add_argument("--json", action="store_true", help="Bericht als JSON")
    p.add_argument("--bericht", default="",
                   help="Verlauf fortlaufend in diese Datei schreiben. Fuer "
                        "Aufrufer, die den Lauf nicht bis zum Ende begleiten "
                        "koennen — die Verwaltung verliert die Verbindung, "
                        "weil dieser Weg ihren Server neu startet.")
    a = p.parse_args()
    if not any((a.lage, a.holen, a.einspielen, a.zurueckdrehen)):
        a.lage = True

    b = Bericht(still=a.json, datei=a.bericht)
    if not a.json:
        print("── MixPiBox: die Box holt sich ihre Fassung ──")

    k = einstellung_lesen()
    b.schritt(1, "Umgebung")

    if a.zurueckdrehen:
        tauscher = umgebung_pruefen(b, nur_lesen=False)
        rc = RC_UMGEBUNG
        if tauscher is not None:
            ziele = auftrag_bauen(Path(LAGER) / "aus")
            dienste = sorted({z["dienst"] for z in ZIELE if z["dienst"]})
            rc = RC_OK if zurueckdrehen(b, tauscher, ziele, dienste) else RC_TAUSCH
    else:
        rc = einspielen(b, k, a)

    b.fertig(rc)
    if a.json:
        json.dump({"rc": rc, "zeilen": b.zeilen, "warnungen": b.warnungen,
                   "fehler": b.fehler}, sys.stdout, ensure_ascii=False)
        print()
    return rc


if __name__ == "__main__":
    sys.exit(main())
