#!/usr/bin/env python3
"""E29/B6 GEGENGELESEN — nicht mit dem Werkzeug des Erbauers.

WARUM ES DAS GIBT, obwohl es `tools/zugangsdaten-am-geraet.py` schon gibt:
jenes Werkzeug stammt vom selben Vorgang wie die Aenderung. Es prueft die
Punkte, an die der Erbauer gedacht hat. Dieses hier sucht die Stellen, an die
er NICHT gedacht haben koennte, und es sucht sie dort, wo ein Geheimnis
UNBEABSICHTIGT landet:

  A  DAS PASSWORT — liegt es irgendwo?
     Nicht „steht es in argv" (das ist geprueft), sondern: waehrend eines
     echten Laufs jede Sekunde JEDEN eigenen Prozess in /proc abtasten —
     cmdline UND environ, also auch gpg und gpg-agent —, danach Journal,
     FAT-Partition, Shell-Verlaeufe, /tmp-Reste und uebrige Agenten.
     Gefahren werden BEIDE Eingabewege (Umgebung und stdin), weil sie
     verschieden lecken koennen.
  B  FALSCHES PASSWORT — scheitert es LAUT und spielt es NICHTS ein?
     Gemessen wird nicht die Meldung, sondern der BAUM: jede Datei vorher
     und nachher als sha256 + mtime.
  C  OHNE PASSWORT — kommen Bibliothek, gemerkte Stellen und Kinderzeit
     zurueck, und wird namentlich GESAGT, was fehlt?
  D  IST WIRKLICH VERSCHLUESSELT, was so heisst? `grep` ueber JEDES
     Archivmitglied roh, plus Gegenprobe auf etwas, das drin sein MUSS.
  E  EIN ARCHIV VON FRUEHER (echter Stand vom 04.08., ohne Behaelter) —
     laesst es sich weiter einspielen?
  F  DIE WOECHENTLICHE SELBSTPROBE — laeuft sie, und prueft sie noch etwas?
     Nicht „Timer ist enabled", sondern: gegen einen Wegwerf-Staendeordner
     einmal heil (muss 0) und dreimal verbogen (muss je != 0).
  G  DIE STELLE, an der ein Passwort ans falsche Netz geraten kann — der
     Weg OHNE Behaelter (`zeiger_uebernehmen`), nicht der mit.

WAS ES ANFASST: nichts Echtes. Alles entsteht unter /tmp. Die echten Staende,
/etc/mupibox und server/config werden NUR GELESEN. Es werden keine echten
Zugangsdaten angezeigt; der Wegwerf-Baum traegt erfundene Marken, und genau
nach denen wird gesucht.

AUFRUF
    python3 e29b6-adversarisch.py                     # auf der Box
    python3 e29b6-adversarisch.py --skript <pfad>     # andere Fassung pruefen
    python3 e29b6-adversarisch.py --nur A,F

ENDE 0, wenn jeder Punkt haelt.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

SKRIPT = "/usr/local/bin/mupibox/mupibox-sicherung.py"

# Marken: sie stehen NUR im Wegwerf-Baum. Taucht eine ausserhalb des
# Behaelters auf, ist etwas undicht. Das Passwort ist selbst eine Marke —
# es wird ueberall dort gesucht, wo es nicht sein darf.
PW = "Wegwerf-Losung-ZZQ7-nur-fuer-diese-Messung"
M = {
    "refresh": "MARKE-DAUERZUGANG-A1",
    "secret": "MARKE-GEHEIMNIS-A2",
    "access": "MARKE-ZUGANG-A3",
    "admin": "MARKE-VERWALTUNG-A4",
    "telegram": "MARKE-TELEGRAM-A5",
    "mqtt": "MARKE-MQTT-A6",
    "jelly": "MARKE-JELLYFIN-A7",
    "wlan1": "MARKE-WLAN-ZUHAUSE-A8",
    "wlan3": "MARKE-WLAN-FERIEN-A9",
    "cfg_secret": "MARKE-CFG-GEHEIMNIS-B1",
    "cfg_refresh": "MARKE-CFG-DAUERZUGANG-B2",
}
# Was drin sein MUSS — ohne diese Gegenprobe prueft man nur, dass die Suche
# nichts findet.
GEGENPROBE = {"ssid1": "NETZ-ZUHAUSE-SICHTBAR", "ssid3": "NETZ-FERIEN-SICHTBAR"}


class Bilanz:
    def __init__(self) -> None:
        self.gut = self.schlecht = 0
        self.offen: list[str] = []

    def chk(self, was: str, ob: bool, dazu: str = "") -> bool:
        self.gut += bool(ob)
        self.schlecht += (not ob)
        print(f"  {'ok  ' if ob else 'FEHL'}  {was}" + (f"   [{dazu}]" if dazu else ""))
        return bool(ob)

    def hinweis(self, text: str) -> None:
        self.offen.append(text)
        print(f"  ??    {text}")


def modul_laden(pfad: str):
    spec = importlib.util.spec_from_file_location("mupibox_sicherung_pruef", pfad)
    if spec is None or spec.loader is None:
        raise SystemExit(f"{pfad} laesst sich nicht laden")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── Wegwerf-Baum ───────────────────────────────────────────────────────────
def baum_bauen(wurzel: str) -> dict[str, str]:
    """Zwei Baeume mit erfundenen Zugangsdaten. -> {archivname: verzeichnis}

    wlan.json hat DREI Netze und das MITTLERE hat kein Passwort. Genau daran
    entscheidet sich, ob `/*/pw` an der richtigen Stelle landet.
    """
    etc = os.path.join(wurzel, "etc_mupibox")
    cfg = os.path.join(wurzel, "server_config")
    os.makedirs(etc, exist_ok=True)
    os.makedirs(cfg, exist_ok=True)
    schreib = lambda p, d: open(p, "w", encoding="utf-8").write(
        json.dumps(d, indent=4, ensure_ascii=False) + "\n")
    schreib(os.path.join(etc, "mupiboxconfig.json"), {
        "spotify": {"clientId": "sichtbare-kennung",
                    "clientSecret": M["secret"],
                    "accessToken": M["access"],
                    "refreshToken": M["refresh"]},
        "interfacelogin": {"username": "admin", "password": M["admin"]},
        "telegram": {"token": M["telegram"]},
        "mqtt": {"password": M["mqtt"]},
        "jellyfin": {"apikey": M["jelly"]},
        "volume": {"max": 80, "startup": 30},
        "led": {"brightness": 5},
    })
    open(os.path.join(etc, "bt-adapter"), "w").write("AA:BB:CC:DD:EE:FF\n")
    schreib(os.path.join(cfg, "config.json"),
            {"spotify": {"clientId": "sichtbare-kennung",
                         "clientSecret": M["cfg_secret"],
                         "refreshToken": M["cfg_refresh"]}})
    schreib(os.path.join(cfg, "wlan.json"), [
        {"ssid": GEGENPROBE["ssid1"], "pw": M["wlan1"]},
        {"ssid": "NETZ-OHNE-PASSWORT"},                 # die Luecke!
        {"ssid": GEGENPROBE["ssid3"], "pw": M["wlan3"]},
    ])
    schreib(os.path.join(cfg, "data.json"),
            [{"id": i, "title": f"Buch {i}"} for i in range(1, 26)])
    schreib(os.path.join(cfg, "resume.json"), {"buch-7": {"pos": 1234}})
    schreib(os.path.join(cfg, "kinderzeit.json"), {"minuten": 45, "an": True})
    schreib(os.path.join(cfg, "darstellung.json"), {"raster": 3})
    return {"etc/mupibox": etc, "server/config": cfg}


def baum_abbild(baeume: dict[str, str]) -> dict[str, tuple[str, float]]:
    ab = {}
    for wurzel in baeume.values():
        for name in sorted(os.listdir(wurzel)):
            p = os.path.join(wurzel, name)
            if os.path.isfile(p):
                ab[p] = (sha(open(p, "rb").read()), os.path.getmtime(p))
    return ab


# ── A: Die Leck-Jagd ───────────────────────────────────────────────────────
class ProcSpitzel(threading.Thread):
    """Tastet waehrend eines Laufs jeden EIGENEN Prozess ab — argv und Umgebung.

    /proc/<pid>/environ ist nur fuer den Eigentuemer lesbar; genau das reicht,
    denn gpg und gpg-agent laufen als derselbe Benutzer. Ein Passwort, das
    dort steht, ist fuer jeden Vorgang desselben Benutzers sichtbar — und bei
    `sudo` waere das root.
    """

    def __init__(self, nadel: str, eigene_pid: int) -> None:
        super().__init__(daemon=True)
        self.nadel = nadel.encode()
        self.eigene_pid = eigene_pid
        self.halt = threading.Event()
        self.funde: list[dict] = []
        self.gesehen: set[str] = set()
        self.runden = 0

    def run(self) -> None:
        while not self.halt.is_set():
            self.runden += 1
            for pid in os.listdir("/proc"):
                if not pid.isdigit():
                    continue
                try:
                    comm = open(f"/proc/{pid}/comm", "rb").read().strip().decode()
                    cmd = open(f"/proc/{pid}/cmdline", "rb").read()
                    env = open(f"/proc/{pid}/environ", "rb").read()
                except OSError:
                    continue
                wo = []
                if self.nadel in cmd:
                    wo.append("cmdline")
                if self.nadel in env:
                    wo.append("environ")
                if wo:
                    schl = f"{comm}:{','.join(wo)}"
                    if schl not in self.gesehen:
                        self.gesehen.add(schl)
                        self.funde.append({"pid": pid, "comm": comm, "wo": wo,
                                           "selbst": pid == str(self.eigene_pid)})
            time.sleep(0.002)


def lauf_mit_spitzel(fn, nadel: str) -> tuple[object, list[dict], int]:
    s = ProcSpitzel(nadel, os.getpid())
    s.start()
    try:
        erg = fn()
    finally:
        time.sleep(0.05)
        s.halt.set()
        s.join(timeout=5)
    return erg, s.funde, s.runden


def punkt_a(b: Bilanz, m, baeume, staende, ordner) -> str | None:
    """-> Pfad des Standes mit Behaelter (oder None)."""
    print("\nA  DAS PASSWORT — liegt es irgendwo?")
    seit = subprocess.run(["date", "+%Y-%m-%d %H:%M:%S"],
                          capture_output=True, text=True).stdout.strip()

    # A1  Weg ueber die UMGEBUNG
    os.environ[m.PW_UMGEBUNG] = PW
    stdin_alt = sys.stdin
    try:
        (rc, funde, runden) = (None, None, None)
        def anlegen():
            return m.main(["x", "--anlegen", "--grund", "gegenlesen-umgebung",
                           "--mit-zugangsdaten", "--behalten"])
        rc, funde, runden = lauf_mit_spitzel(anlegen, PW)
    finally:
        os.environ.pop(m.PW_UMGEBUNG, None)
        sys.stdin = stdin_alt
    b.chk("Stand mit Behaelter liess sich anlegen (Passwort ueber Umgebung)",
          rc == 0)
    print(f"        ({runden} Abtastrunden ueber /proc waehrend des Laufs)")
    fremd = [f for f in funde if not f["selbst"]]
    in_cmd = [f for f in fremd if "cmdline" in f["wo"]]
    b.chk("das Passwort stand in KEINER Befehlszeile eines Kindprozesses",
          not in_cmd, ", ".join(f["comm"] for f in in_cmd) or "-")
    in_env = [f for f in fremd if "environ" in f["wo"]]
    if in_env:
        b.chk("das Passwort stand in KEINER Umgebung eines Kindprozesses",
              False, "gefunden bei: " + ", ".join(sorted(
                  {f['comm'] for f in in_env})))
    else:
        b.chk("das Passwort stand in KEINER Umgebung eines Kindprozesses", True)

    # A2  Weg ueber STDIN — hier darf gar nichts auftauchen
    #
    # ACHTUNG, DIESE FUENF ZEILEN HABEN SCHON EINMAL EINE GANZE MESSUNG
    # WERTLOS GEMACHT: ein `os.fdopen(0, "r")` besitzt fd 0 und SCHLIESST ihn,
    # sobald das Objekt faellt. Danach liefert `os.pipe()` im geprueften
    # Skript die 0 als niedrigsten freien Zeiger — `--passphrase-fd 0` wird
    # dann von der stdin-Roehre des Kindes ueberschrieben, und JEDES
    # Entschluesseln scheitert mit „no valid OpenPGP data found". Der Punkt
    # „falsches Passwort scheitert" waere dabei GRUEN geworden, ohne je ein
    # Passwort geprueft zu haben. Deshalb `closefd=False` — und deshalb die
    # Kontrolle darunter.
    lese, schreibe = os.pipe()
    os.write(schreibe, (PW + "\n").encode())
    os.close(schreibe)
    alt_fd = os.dup(0)
    os.dup2(lese, 0)
    os.close(lese)
    sys.stdin = io.TextIOWrapper(io.FileIO(0, "r", closefd=False))
    try:
        def anlegen2():
            return m.main(["x", "--anlegen", "--grund", "gegenlesen-stdin",
                           "--mit-zugangsdaten", "--behalten"])
        rc2, funde2, runden2 = lauf_mit_spitzel(anlegen2, PW)
    finally:
        os.dup2(alt_fd, 0)
        os.close(alt_fd)
        sys.stdin = stdin_alt
    b.chk("Stand mit Behaelter liess sich anlegen (Passwort ueber stdin)",
          rc2 == 0)
    offen = []
    for fd in (0, 1, 2):
        try:
            os.fstat(fd)
            offen.append(fd)
        except OSError:
            pass
    b.chk("KONTROLLE: 0/1/2 sind nach dem stdin-Versuch noch offen "
          "(sonst misst alles Folgende Unsinn)", offen == [0, 1, 2], str(offen))
    fremd2 = [f for f in funde2 if not f["selbst"]]
    b.chk("Weg ueber stdin: das Passwort stand in KEINEM fremden Prozess",
          not fremd2, ", ".join(f"{f['comm']}/{'+'.join(f['wo'])}"
                                for f in fremd2) or "-")
    selbst2 = [f for f in funde2 if f["selbst"]]
    b.chk("Weg ueber stdin: auch im eigenen Prozess steht es nicht in der "
          "Umgebung", not any("environ" in f["wo"] for f in selbst2))

    # A3  Die Ablageorte
    staende_da = sorted(glob.glob(os.path.join(staende, "*.tar.gz")))
    b.chk("zwei Staende mit Behaelter entstanden", len(staende_da) >= 2,
          f"{len(staende_da)}")
    mit_behaelter = None
    for p in staende_da:
        roh = open(p, "rb").read()
        b.chk(f"das Passwort steht NICHT im Archiv {os.path.basename(p)[:44]}",
              PW.encode() not in roh)
        with tarfile.open(p) as t:
            if m.BEHAELTER in t.getnames():
                mit_behaelter = p
    b.chk("mindestens ein Stand traegt den Behaelter", mit_behaelter is not None)

    # Karte
    karte = os.path.join(ordner, "karte", m.KARTE_ORDNER)
    treffer_karte = []
    for w, _, dateien in os.walk(os.path.join(ordner, "karte")):
        for d in dateien:
            p = os.path.join(w, d)
            if PW.encode() in open(p, "rb").read():
                treffer_karte.append(p)
    b.chk("das Passwort steht auf KEINER Datei der (Wegwerf-)Karte",
          not treffer_karte, ", ".join(treffer_karte) or "-")

    # Journal
    j = subprocess.run(["journalctl", "--since", seit, "--no-pager"],
                       capture_output=True, text=True)
    jtext = j.stdout + j.stderr
    b.chk("das Passwort steht NICHT im Journal seit Beginn dieses Laufs",
          PW not in jtext, f"{len(jtext)} B gelesen")
    marken_im_journal = [k for k, v in M.items() if v in jtext]
    b.chk("auch keine der Wegwerf-Marken steht im Journal",
          not marken_im_journal, ", ".join(marken_im_journal) or "-")

    # Shell-Verlaeufe und die uebrigen ueblichen Verdaechtigen
    verlaeufe = [os.path.expanduser(p) for p in
                 ("~/.bash_history", "~/.zsh_history", "~/.sh_history",
                  "~/.local/share/fish/fish_history", "~/.python_history")]
    treffer_v = []
    for p in verlaeufe:
        try:
            if PW in open(p, encoding="utf-8", errors="replace").read():
                treffer_v.append(p)
        except OSError:
            pass
    b.chk("das Passwort steht in keiner Verlaufsdatei der Shell",
          not treffer_v, ", ".join(treffer_v) or "-")

    # /tmp-Reste und uebrige Agenten
    reste = glob.glob("/tmp/mupibox-gpg-*") + glob.glob("/tmp/mupibox-gpgschau-*")
    b.chk("kein Wegwerf-GNUPGHOME in /tmp liegen geblieben", not reste,
          ", ".join(reste) or "-")
    ag = subprocess.run(["pgrep", "-a", "gpg-agent"], capture_output=True,
                        text=True).stdout.strip()
    b.chk("kein gpg-agent uebrig", not ag, ag or "-")
    return mit_behaelter


# ── B: Falsches Passwort ───────────────────────────────────────────────────
def punkt_b(b: Bilanz, m, stand_pfad, ordner) -> None:
    print("\nB  FALSCHES PASSWORT — scheitert es laut, und bleibt der Baum heil?")
    ziel = os.path.join(ordner, "ziel-falsch")
    baeume = baum_bauen(ziel)
    # Der Baum bekommt ANDERE Werte, damit auffiele, wenn doch etwas
    # eingespielt wuerde.
    p = os.path.join(baeume["etc/mupibox"], "mupiboxconfig.json")
    d = json.load(open(p))
    d["spotify"]["refreshToken"] = "AUF-DER-BOX-STEHENDER-WERT"
    json.dump(d, open(p, "w"), indent=4)
    vorher = baum_abbild(baeume)

    stand, inhalte = m.stand_oeffnen(stand_pfad)
    # POSITIVE GEGENPROBE ZUERST. Ohne sie ist „das falsche Passwort
    # scheitert" wertlos: eine Fassung, in der JEDES Passwort scheitert,
    # bestuende diesen Punkt glaenzend.
    richtig = None
    try:
        richtig = m.geheim_aus_stand(stand_pfad, stand, PW)
    except SystemExit as e:
        richtig = None
        print(f"        (richtiges Passwort scheiterte: {str(e).splitlines()[0]})")
    b.chk("GEGENPROBE: das RICHTIGE Passwort oeffnet den Behaelter",
          bool(richtig), f"{sum(len(v) for v in (richtig or {}).values())} Werte")
    fehler = None
    try:
        geheim = m.geheim_aus_stand(stand_pfad, stand, "das-ist-das-falsche")
        m.wiederherstellen(stand, inhalte, trocken=False,
                           wurzel_ersatz=baeume, trotzdem=True, geheim=geheim)
    except SystemExit as e:
        fehler = str(e)
    b.chk("ein falsches Passwort bricht ab (SystemExit)", fehler is not None)
    if fehler:
        b.chk("die Meldung sagt, dass NICHTS eingespielt wurde",
              "NICHTS eingespielt" in fehler or "NICHT geoeffnet" in fehler,
              fehler.splitlines()[0][:70])
        b.chk("die Meldung nennt den Ausweg ohne Passwort",
              "--mit-zugangsdaten" in fehler)
        b.chk("die Meldung enthaelt kein Bruchstueck des Klartextes",
              not any(v in fehler for v in M.values()))
    nachher = baum_abbild(baeume)
    b.chk("KEINE einzige Datei im Zielbaum wurde angefasst (sha256 + mtime)",
          vorher == nachher,
          "geaendert: " + ", ".join(os.path.basename(k) for k in nachher
                                    if vorher.get(k) != nachher[k]) or "-")
    # Und der Fall „Behaelter verbogen, Passwort richtig"
    kaputt = os.path.join(ordner, "stand-verbogen.tar.gz")
    verbiegen(stand_pfad, kaputt, m.BEHAELTER)
    fehler2 = None
    try:
        st2, _ = m.stand_oeffnen(kaputt)
        m.geheim_aus_stand(kaputt, st2, PW)
    except SystemExit as e:
        fehler2 = str(e)
    b.chk("ein verbogener Behaelter faellt auf (Pruefsumme oder gpg)",
          fehler2 is not None, (fehler2 or "-").splitlines()[0][:70])


def verbiegen(quelle: str, ziel: str, welches: str, byte_nr: int = 30) -> None:
    """Kopiert ein Archiv und dreht in EINEM Mitglied ein Byte um."""
    with tarfile.open(quelle) as t:
        mitglieder = [(i, t.extractfile(i).read() if i.isfile() else b"")
                      for i in t.getmembers()]
    with tarfile.open(ziel, "w:gz") as t:
        for info, daten in mitglieder:
            if info.name == welches and daten:
                i = min(byte_nr, len(daten) - 1)
                daten = daten[:i] + bytes([daten[i] ^ 0xFF]) + daten[i + 1:]
                info.size = len(daten)
            t.addfile(info, io.BytesIO(daten))


# ── C: Ohne Passwort ───────────────────────────────────────────────────────
def punkt_c(b: Bilanz, m, stand_pfad, ordner) -> None:
    print("\nC  OHNE PASSWORT — kommt der Rest zurueck, und wird das Fehlende "
          "genannt?")
    ziel = os.path.join(ordner, "ziel-ohne")
    baeume = baum_bauen(ziel)
    # Alles Geheime auf der „Box" leeren: dann kann NUR der Behaelter helfen,
    # und was nicht kommt, muss namentlich gemeldet werden.
    p = os.path.join(baeume["etc/mupibox"], "mupiboxconfig.json")
    d = json.load(open(p))
    for k in ("clientSecret", "accessToken", "refreshToken"):
        d["spotify"].pop(k, None)
    d["interfacelogin"].pop("password", None)
    json.dump(d, open(p, "w"), indent=4)
    # Und die Bibliothek verstuemmeln, damit sichtbar wird, dass sie zurueckkommt
    open(os.path.join(baeume["server/config"], "data.json"), "w").write("[]\n")
    open(os.path.join(baeume["server/config"], "resume.json"), "w").write("{}\n")
    open(os.path.join(baeume["server/config"], "kinderzeit.json"), "w").write("{}\n")

    stand, inhalte = m.stand_oeffnen(stand_pfad)
    bericht = m.wiederherstellen(stand, inhalte, trocken=False,
                                 wurzel_ersatz=baeume, trotzdem=True,
                                 geheim=None)      # <- ohne Passwort
    text = "\n".join(bericht)
    lese = lambda p: json.load(open(os.path.join(baeume["server/config"], p)))
    b.chk("die Bibliothek ist zurueck (25 Eintraege)", len(lese("data.json")) == 25,
          str(len(lese("data.json"))))
    b.chk("die gemerkten Stellen sind zurueck", lese("resume.json") == {"buch-7": {"pos": 1234}})
    b.chk("die Kinderzeit ist zurueck", lese("kinderzeit.json").get("minuten") == 45)
    b.chk("die Darstellung ist zurueck", lese("darstellung.json") == {"raster": 3})
    d2 = json.load(open(p))
    b.chk("KEIN Chiffrat in der Konfiguration gelandet",
          "refreshToken" not in d2.get("spotify", {}))
    b.chk("kein Platzhalter statt des Passworts",
          "password" not in d2.get("interfacelogin", {}))
    b.chk("clientId (bewusst kein Geheimnis) ist da",
          d2.get("spotify", {}).get("clientId") == "sichtbare-kennung")
    b.chk("der Bericht sagt, dass Felder VERSCHLUESSELT liegen blieben",
          "VERSCHLUESSELT" in text and "NICHT eingespielt" in text)
    for zeiger in ("/spotify/refreshToken", "/interfacelogin/password", "/*/pw"):
        b.chk(f"der Bericht nennt {zeiger} namentlich", zeiger in text)
    b.chk("der Bericht nennt den Befehl zum Nachholen",
          "--mit-zugangsdaten" in text)
    b.chk("der Bericht enthaelt KEINEN Klartext eines Geheimnisses",
          not any(v in text for v in M.values()))
    # Und wlan.json: das Netz ohne Passwort darf keines bekommen
    w = json.load(open(os.path.join(baeume["server/config"], "wlan.json")))
    b.chk("wlan.json hat weiterhin drei Netze", len(w) == 3, str(len(w)))
    b.chk("das mittlere Netz hat KEIN erfundenes Passwort", "pw" not in w[1])


# ── C2: Mit Passwort ───────────────────────────────────────────────────────
def punkt_c2(b: Bilanz, m, stand_pfad, ordner) -> None:
    print("\nC2 MIT PASSWORT — landet jeder Wert an SEINER Stelle?")
    ziel = os.path.join(ordner, "ziel-mit")
    baeume = baum_bauen(ziel)
    p = os.path.join(baeume["etc/mupibox"], "mupiboxconfig.json")
    d = json.load(open(p))
    d["spotify"] = {"clientId": "sichtbare-kennung"}
    d["interfacelogin"] = {"username": "admin"}
    json.dump(d, open(p, "w"), indent=4)
    # Das Netz OHNE Passwort wandert an die erste Stelle: die Reihenfolge
    # unterscheidet sich damit von der im Archiv.
    open(os.path.join(baeume["server/config"], "wlan.json"), "w").write(
        json.dumps([{"ssid": "NETZ-OHNE-PASSWORT"}], indent=4))

    stand, inhalte = m.stand_oeffnen(stand_pfad)
    geheim = m.geheim_aus_stand(stand_pfad, stand, PW)
    bericht = "\n".join(m.wiederherstellen(stand, inhalte, trocken=False,
                                           wurzel_ersatz=baeume,
                                           trotzdem=True, geheim=geheim))
    d2 = json.load(open(p))
    b.chk("Spotify-Dauerzugang wieder an seiner Stelle",
          d2["spotify"].get("refreshToken") == M["refresh"])
    b.chk("Spotify-Geheimnis wieder an seiner Stelle",
          d2["spotify"].get("clientSecret") == M["secret"])
    b.chk("Verwaltungspasswort wieder an seiner Stelle",
          d2["interfacelogin"].get("password") == M["admin"])
    b.chk("Telegram wieder an seiner Stelle",
          d2.get("telegram", {}).get("token") == M["telegram"])
    b.chk("MQTT wieder an seiner Stelle",
          d2.get("mqtt", {}).get("password") == M["mqtt"])
    b.chk("Jellyfin wieder an seiner Stelle",
          d2.get("jellyfin", {}).get("apikey") == M["jelly"])
    c2 = json.load(open(os.path.join(baeume["server/config"], "config.json")))
    b.chk("config.json: eigenes Geheimnis, nicht das aus mupiboxconfig",
          c2["spotify"].get("clientSecret") == M["cfg_secret"])
    w = json.load(open(os.path.join(baeume["server/config"], "wlan.json")))
    b.chk("wlan.json: drei Netze aus dem Archiv", len(w) == 3, str(len(w)))
    if len(w) == 3:
        b.chk("Netz 1 hat SEIN Passwort", w[0].get("pw") == M["wlan1"])
        b.chk("Netz 2 (hatte nie eines) hat weiterhin keines", "pw" not in w[1])
        b.chk("Netz 3 hat SEIN Passwort", w[2].get("pw") == M["wlan3"])
    b.chk("der Bericht meldet die eingespielten Zugangsdaten",
          "AUS DEM STAND eingespielt" in bericht)
    b.chk("der Bericht zeigt dabei KEINEN Wert",
          not any(v in bericht for v in M.values()))


# ── D: Ist wirklich verschluesselt, was so heisst? ─────────────────────────
def punkt_d(b: Bilanz, m, stand_pfad, staende) -> None:
    print("\nD  DAS ARCHIV ROH DURCHSUCHT — Mitglied fuer Mitglied")
    with tarfile.open(stand_pfad) as t:
        mitglieder = {i.name: (t.extractfile(i).read() if i.isfile() else b"")
                      for i in t.getmembers()}
    print(f"        Mitglieder: {', '.join(sorted(mitglieder))}")
    behaelter = mitglieder.get(m.BEHAELTER, b"")
    b.chk("der Behaelter ist im Archiv", bool(behaelter), f"{len(behaelter)} B")
    ausser_behaelter = {k: v for k, v in mitglieder.items() if k != m.BEHAELTER}
    alles = b"".join(ausser_behaelter.values())
    for name, wert in M.items():
        wo = [k for k, v in ausser_behaelter.items() if wert.encode() in v]
        b.chk(f"Klartext «{name}» steht in KEINEM Mitglied ausser dem Behaelter",
              not wo, ", ".join(wo) or "-")
    for name, wert in GEGENPROBE.items():
        b.chk(f"GEGENPROBE: «{name}» IST im Archiv (sonst sucht die Suche ins Leere)",
              wert.encode() in alles)
    b.chk("GEGENPROBE: der Rechnername ist im Archiv",
          os.uname().nodename.encode() in alles)
    # Und der Behaelter selbst darf natuerlich keinen Klartext zeigen
    b.chk("im Behaelter selbst steht kein Klartext",
          not any(v.encode() in behaelter for v in M.values()))
    kopf = m.behaelter_kopf(behaelter)
    b.chk("der Behaelter ist ein AEAD-Paket", m.ist_aead(kopf), kopf or "-")
    # Auch die anderen (auch die OHNE Behaelter) duerfen nichts zeigen
    for p in sorted(glob.glob(os.path.join(staende, "*.tar.gz"))):
        with tarfile.open(p) as t:
            roh = b"".join(t.extractfile(i).read() for i in t.getmembers()
                           if i.isfile() and i.name != m.BEHAELTER)
        undicht = [k for k, v in M.items() if v.encode() in roh]
        b.chk(f"{os.path.basename(p)[:44]}: nichts im Klartext",
              not undicht, ", ".join(undicht) or "-")


# ── E: Ein Archiv von frueher ──────────────────────────────────────────────
def punkt_e(b: Bilanz, m, ordner) -> None:
    print("\nE  EIN ECHTER STAND VON FRUEHER (vor E29/B6, ohne Behaelter)")
    echte = sorted(glob.glob("/home/dietpi/.mupibox/sicherungen/"
                             "mupibox-sicherung-20260804-*.tar.gz"))
    if not echte:
        b.hinweis("kein echter Stand vom 04.08. da — nicht gemessen")
        return
    alt = echte[0]
    kopie = os.path.join(ordner, "alt-" + os.path.basename(alt))
    shutil.copy2(alt, kopie)                 # NUR gelesen, Arbeit auf der Kopie
    try:
        stand, inhalte = m.stand_oeffnen(kopie)
    except SystemExit as e:
        b.chk(f"{os.path.basename(alt)[:44]} laesst sich oeffnen", False, str(e))
        return
    b.chk(f"{os.path.basename(alt)[:44]} laesst sich oeffnen", True,
          f"{len(inhalte)} Dateien, Format {stand.get('format')}")
    b.chk("dieser Stand traegt KEINE Zugangsdaten (wie erwartet)",
          not (stand.get("zugangsdaten") or {}))
    ziel = os.path.join(ordner, "ziel-alt")
    baeume = baum_bauen(ziel)
    try:
        bericht = "\n".join(m.wiederherstellen(stand, inhalte, trocken=False,
                                               wurzel_ersatz=baeume,
                                               trotzdem=True, geheim=None))
        gelungen = True
    except SystemExit as e:
        bericht, gelungen = str(e), False
    b.chk("ein Stand von frueher laesst sich weiterhin einspielen", gelungen,
          bericht.splitlines()[0][:70] if not gelungen else "")
    if gelungen:
        geschrieben = sum(1 for w in baeume.values() for _ in os.listdir(w))
        b.chk("dabei sind Dateien entstanden", geschrieben > 4, str(geschrieben))
        b.chk("der Bericht redet NICHT von einem Behaelter",
              "VERSCHLUESSELT" not in bericht)
        # Die alten Geheimnisse der „Box" ueberleben
        d = json.load(open(os.path.join(baeume["etc/mupibox"],
                                        "mupiboxconfig.json")))
        b.chk("das Verwaltungspasswort der Box blieb erhalten",
              d.get("interfacelogin", {}).get("password") == M["admin"])
    # Und der andere Weg: kann die AUSGELIEFERTE Fassung mit --mit-zugangsdaten
    # an einem alten Stand? Sie muss LAUT nein sagen, nicht still nichts tun.
    rc = subprocess.run([sys.executable, m.__file__ if hasattr(m, "__file__")
                         else SKRIPT], capture_output=True)
    b.chk("(Kontrolle) das Skript laeuft ohne Argumente und zeigt Hilfe",
          rc.returncode == 2)


# ── F: Die woechentliche Selbstprobe ───────────────────────────────────────
def punkt_f(b: Bilanz, m, ordner, stand_mit_behaelter) -> None:
    print("\nF  DIE WOECHENTLICHE SELBSTPROBE — laeuft sie, prueft sie noch etwas?")
    for was in ("mupibox-sicherungsprobe.timer", "mupibox-sicherungsprobe.service"):
        r = subprocess.run(["systemctl", "show", was, "--property",
                            "LoadState,UnitFileState,ActiveState,Result,"
                            "ExecMainStatus,Persistent"],
                           capture_output=True, text=True)
        w = dict(z.split("=", 1) for z in r.stdout.strip().splitlines() if "=" in z)
        print(f"        {was}: {w}")
        b.chk(f"{was} ist geladen", w.get("LoadState") == "loaded")
    r = subprocess.run(["systemctl", "list-timers", "mupibox-sicherungsprobe.timer",
                        "--all", "--no-pager"], capture_output=True, text=True)
    print("        " + " | ".join(r.stdout.strip().splitlines()[:2]))
    b.chk("der Zeitgeber hat einen naechsten Termin",
          "mupibox-sicherungsprobe" in r.stdout)

    # Und nun das, worauf es ankommt: prueft sie noch etwas?
    ordner_p = os.path.join(ordner, "probe-staende")
    os.makedirs(ordner_p, exist_ok=True)
    heil = os.path.join(ordner_p, os.path.basename(stand_mit_behaelter))
    shutil.copy2(stand_mit_behaelter, heil)
    alt_staende, alt_baeume = m.STAENDE, m.BAEUME
    m.STAENDE = ordner_p
    try:
        still = []
        rc_heil = m.probe(sagen=still.append)
        b.chk("die Probe an einem HEILEN Stand geht durch (0)", rc_heil == 0,
              str(rc_heil))
        b.chk("sie hat den Behaelter dabei ueberhaupt angesehen",
              any("Zugangsdaten:" in z for z in still),
              [z for z in still if "Zugangsdaten" in z][:1] or "-")

        # (a) Behaelter verbogen
        os.remove(heil)
        verbogen = os.path.join(ordner_p, os.path.basename(stand_mit_behaelter))
        verbiegen(stand_mit_behaelter, verbogen, m.BEHAELTER)
        still2 = []
        rc_v = m.probe(sagen=still2.append)
        b.chk("verbogener Behaelter -> Probe faellt DURCH", rc_v != 0, str(rc_v))
        # (b) eine Nutzdatei verbogen
        os.remove(verbogen)
        v2 = os.path.join(ordner_p, os.path.basename(stand_mit_behaelter))
        verbiegen(stand_mit_behaelter, v2, "server/config/data.json")
        still3 = []
        rc_d = m.probe(sagen=still3.append)
        b.chk("verbogene Bibliothek -> Probe faellt DURCH", rc_d != 0, str(rc_d))
        # (c) gpg weg
        os.remove(v2)
        shutil.copy2(stand_mit_behaelter, heil)
        alt_which = m.shutil.which
        m.shutil.which = lambda n, *a, **k: (None if n == "gpg"
                                             else alt_which(n, *a, **k))
        try:
            still4 = []
            rc_g = m.probe(sagen=still4.append)
        finally:
            m.shutil.which = alt_which
        b.chk("gpg verschwunden -> Probe faellt DURCH (der eigentliche Ausfall)",
              rc_g != 0, str(rc_g))
        b.chk("und sie sagt, was zu tun ist",
              any("apt-get install" in z for z in still4))
    finally:
        m.STAENDE, m.BAEUME = alt_staende, alt_baeume

    # Was steht auf der ECHTEN Karte? (nur gelesen)
    pr = "/boot/firmware/mupibox-sicherung/PROBE.txt"
    if os.path.exists(pr):
        erste = open(pr, encoding="utf-8", errors="replace").readline().strip()
        alter = (time.time() - os.path.getmtime(pr)) / 3600.0
        print(f"        PROBE.txt: «{erste}», {alter:.1f} h alt")
        b.chk("das Urteil auf der Karte lautet BESTANDEN", "BESTANDEN" in erste
              and "NICHT" not in erste, erste)
    else:
        b.hinweis("keine PROBE.txt auf der Karte — nicht gemessen")


# ── G: Passwort am falschen Netz, der Weg OHNE Behaelter ───────────────────
def punkt_g(b: Bilanz, m, ordner) -> None:
    print("\nG  DER WEG OHNE BEHAELTER: haengt das WLAN-Passwort am richtigen "
          "Netz?")
    # Erst der Baustein allein …
    faelle = [
        ("Netz A ist von der Box verschwunden",
         [{"ssid": "NETZ-A"}, {"ssid": "NETZ-B"}],
         [{"ssid": "NETZ-B", "pw": "GEHOERT-ZU-B"}],
         {"NETZ-B": "GEHOERT-ZU-B"}),
        ("ein Netz ist auf der Box DAZUgekommen",
         [{"ssid": "NETZ-A"}],
         [{"ssid": "NEU"}, {"ssid": "NETZ-A", "pw": "GEHOERT-ZU-A"}],
         {"NETZ-A": "GEHOERT-ZU-A"}),
        ("die Reihenfolge hat sich gedreht",
         [{"ssid": "NETZ-A"}, {"ssid": "NETZ-B"}],
         [{"ssid": "NETZ-B", "pw": "GEHOERT-ZU-B"},
          {"ssid": "NETZ-A", "pw": "GEHOERT-ZU-A"}],
         {"NETZ-A": "GEHOERT-ZU-A", "NETZ-B": "GEHOERT-ZU-B"}),
        ("zwei Netze gleichen Namens — raten waere schlimmer",
         [{"ssid": "X"}],
         [{"ssid": "X", "pw": "eins"}, {"ssid": "X", "pw": "zwei"}],
         {}),
        ("gar kein gemeinsames Netz mehr",
         [{"ssid": "ALT"}],
         [{"ssid": "GANZ-NEU", "pw": "GEHOERT-ZU-NEU"}],
         {}),
    ]
    for was, archiv, box, erwartet in faelle:
        ziel = json.loads(json.dumps(archiv))
        m.zeiger_uebernehmen(ziel, box, "/*/pw")
        haben = {n["ssid"]: n["pw"] for n in ziel if n.get("pw")}
        b.chk(was, haben == erwartet,
              f"Archiv {[n['ssid'] for n in archiv]}, Box "
              f"{[n['ssid'] for n in box]} -> {haben or '{}'}")

    # … dann derselbe Fall durch den ECHTEN Rueckweg, so wie er von der Karte
    #   laeuft: kein Passwort, `wiederherstellen` schreibt Dateien.
    ziel_v = os.path.join(ordner, "ziel-wlan")
    baeume = baum_bauen(ziel_v)
    wlan = os.path.join(baeume["server/config"], "wlan.json")
    # Auf der „Box" gibt es heute NUR das dritte Netz.
    open(wlan, "w").write(json.dumps(
        [{"ssid": GEGENPROBE["ssid3"], "pw": "AKTUELLES-FERIEN-PASSWORT"}],
        indent=4))
    staende_v = os.path.join(ordner, "staende-wlan")
    os.makedirs(staende_v, exist_ok=True)
    alt_b, alt_s = m.BAEUME, m.STAENDE
    m.BAEUME, m.STAENDE = baum_bauen(os.path.join(ordner, "quelle-wlan")), staende_v
    try:
        m.main(["x", "--anlegen", "--grund", "wlan-drei-netze"])
    finally:
        m.BAEUME, m.STAENDE = alt_b, alt_s
    st_p = sorted(glob.glob(os.path.join(staende_v, "*.tar.gz")))[-1]
    stand, inhalte = m.stand_oeffnen(st_p)
    m.wiederherstellen(stand, inhalte, trocken=False, wurzel_ersatz=baeume,
                       trotzdem=True, geheim=None)
    w = json.load(open(wlan))
    haben = {n["ssid"]: n.get("pw") for n in w}
    print(f"        nach dem Rueckweg: {json.dumps(haben)}")
    b.chk("ECHTER RUECKWEG: das Ferien-Passwort haengt am Ferien-Netz",
          haben.get(GEGENPROBE["ssid3"]) == "AKTUELLES-FERIEN-PASSWORT")
    b.chk("ECHTER RUECKWEG: das Zuhause-Netz bekommt KEIN fremdes Passwort",
          haben.get(GEGENPROBE["ssid1"]) is None)
    b.chk("ECHTER RUECKWEG: das Netz ohne Passwort bekommt auch keines",
          haben.get("NETZ-OHNE-PASSWORT") is None)


# ── Hauptlauf ──────────────────────────────────────────────────────────────
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--skript", default=SKRIPT)
    p.add_argument("--nur", default="ABCDEFG",
                   help="Buchstaben der Punkte, z.B. --nur AF")
    a = p.parse_args()
    if not os.path.exists(a.skript):
        raise SystemExit(f"{a.skript} gibt es hier nicht")
    m = modul_laden(a.skript)
    b = Bilanz()
    print(f"E29/B6 ADVERSARISCH — {a.skript}")
    print(f"  Rechner {os.uname().nodename}, gpg "
          f"{(m.gpg_pfad() or 'FEHLT')}, Benutzer {os.geteuid()}")

    with tempfile.TemporaryDirectory(prefix="e29b6-gegen-") as ordner:
        baeume = baum_bauen(os.path.join(ordner, "baum"))
        staende = os.path.join(ordner, "staende")
        karte = os.path.join(ordner, "karte")
        os.makedirs(staende, exist_ok=True)
        os.makedirs(karte, exist_ok=True)
        m.BAEUME = baeume
        m.STAENDE = staende
        m.KARTE = karte
        m.SPERRE = os.path.join(ordner, "sperre")

        stand_pfad = None
        if "A" in a.nur:
            stand_pfad = punkt_a(b, m, baeume, staende, ordner)
        if stand_pfad is None:
            # Fuer die uebrigen Punkte reicht ein Stand ohne Leck-Jagd.
            os.environ[m.PW_UMGEBUNG] = PW
            m.main(["x", "--anlegen", "--grund", "hilfsstand",
                    "--mit-zugangsdaten", "--behalten"])
            os.environ.pop(m.PW_UMGEBUNG, None)
            for q in sorted(glob.glob(os.path.join(staende, "*.tar.gz"))):
                with tarfile.open(q) as t:
                    if m.BEHAELTER in t.getnames():
                        stand_pfad = q
        if stand_pfad is None:
            raise SystemExit("kein Stand mit Behaelter — Abbruch")

        if "B" in a.nur:
            punkt_b(b, m, stand_pfad, ordner)
        if "C" in a.nur:
            punkt_c(b, m, stand_pfad, ordner)
            punkt_c2(b, m, stand_pfad, ordner)
        if "D" in a.nur:
            punkt_d(b, m, stand_pfad, staende)
        if "E" in a.nur:
            punkt_e(b, m, ordner)
        if "F" in a.nur:
            punkt_f(b, m, ordner, stand_pfad)
        if "G" in a.nur:
            punkt_g(b, m, ordner)

    print(f"\n{b.gut} bestanden, {b.schlecht} fehlgeschlagen"
          + (f", {len(b.offen)} nicht gemessen" if b.offen else ""))
    for o in b.offen:
        print(f"  NICHT GEMESSEN: {o}")
    return 1 if b.schlecht else 0


if __name__ == "__main__":
    sys.exit(main())
