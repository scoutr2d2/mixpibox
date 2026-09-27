#!/usr/bin/env python3
"""Der ganze Weg der verschluesselten Zugangsdaten — gefahren, nicht behauptet.

WARUM ES DAS GIBT
`--selbsttest` laeuft auf jedem Rechner und beweist die REGELN. Er beweist
nicht, dass die Box es kann: dort haengt alles an einem gpg, das nur als
letzter Zweig einer Alternativenkette hereingekommen ist, an einer 194-KB-
Messreihe, die sich alle zehn Minuten aendert, und an einer FAT-Partition mit
94 MB. Was nur am Arbeitsplatz gemessen wurde, ist fuer diese Box nicht
gemessen ([[e29b7-gpg-kann-doch-aead-und-gnupg-ist-nur-angeweht]]).

Dieses Werkzeug faehrt deshalb den ECHTEN Weg mit dem AUSGELIEFERTEN Skript —
nur gegen einen Wegwerf-Baum:

  1  anlegen ohne Passwort      Vorgabe: kein Geheimnis im Archiv
  2  anlegen --mit-zugangsdaten Behaelter, Passwort ueber die Umgebung
  3  roh durchsuchen            steht ein Geheimnis IM KLARTEXT im Archiv?
  4  --pruefen / --probe        haelt die woechentliche Selbstprobe?
  5  zurueckspielen OHNE PW     kommt alles andere? wird es GESAGT?
  6  zurueckspielen FALSCH      scheitert es LAUT und ohne Schaden?
  7  zurueckspielen MIT PW      ist jedes Feld an SEINER Stelle?
  8  Kosten                     Zeit und Bytes, mit und ohne Messreihe

WAS ES NICHT ANFASST: die echten Staende in /home/dietpi/.mupibox/sicherungen,
/etc/mupibox und server/config werden NUR GELESEN (und akkuverlauf.json nur,
um mit der echten Groesse zu messen — sie enthaelt keine Schluessel). Alles
Uebrige entsteht unter /tmp und wird wieder weggeraeumt.

ES WIRD KEIN ECHTER SCHLUESSEL ANGEFASST UND KEINER ANGEZEIGT. Der Wegwerf-Baum
traegt eigene, erfundene Werte mit sprechenden Marken; genau nach denen wird
gesucht. Ein Werkzeug, das zum Pruefen echte Zugangsdaten ins Journal schreibt,
waere der Schaden, den die Verschluesselung verhindern soll.

AUFRUF
    python3 zugangsdaten-am-geraet.py                    # gegen die Box
    python3 zugangsdaten-am-geraet.py --host 192.168.178.169   # ueber SSH
    python3 zugangsdaten-am-geraet.py --skript scripts/mupibox/mupibox-sicherung.py

ENDE 0, wenn jeder Punkt haelt.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

SKRIPT = "/usr/local/bin/mupibox/mupibox-sicherung.py"
PW = "eine-lange-wegwerf-losung-1234"

# Die Marken, nach denen im fertigen Archiv gesucht wird. Sie stehen NUR im
# Wegwerf-Baum; taucht eine davon im Archiv auf, ist der Behaelter undicht.
MARKEN = {
    "refreshToken": "MARKE-SPOTIFY-DAUERZUGANG",
    "clientSecret": "MARKE-SPOTIFY-GEHEIMNIS",
    "password": "MARKE-VERWALTUNG",
    "pw-eins": "MARKE-WLAN-ZUHAUSE",
    "pw-zwei": "MARKE-WLAN-FERIEN",
    "telegram": "MARKE-TELEGRAM",
}


def modul_laden(pfad: str):
    spec = importlib.util.spec_from_file_location("mupibox_sicherung", pfad)
    if spec is None or spec.loader is None:
        raise SystemExit(f"{pfad} laesst sich nicht laden")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Bilanz:
    def __init__(self) -> None:
        self.gut = 0
        self.schlecht = 0

    def chk(self, was: str, bedingung: bool, dazu: str = "") -> None:
        print(("  OK      " if bedingung else "  FEHLT   ") + was
              + (f"   [{dazu}]" if dazu else ""))
        self.gut += bool(bedingung)
        self.schlecht += (not bedingung)

    def merken(self, was: str, text: str = "") -> None:
        print(f"  ---     {was}" + (f"   [{text}]" if text else ""))


def baum_legen(verz: str, akkuverlauf: bytes | None) -> tuple[str, str]:
    """Ein Wegwerf-Baum mit erfundenen Schluesseln. -> (etc, server/config)"""
    e = os.path.join(verz, "etc-mupibox")
    s = os.path.join(verz, "server-config")
    os.makedirs(e, exist_ok=True)
    os.makedirs(s, exist_ok=True)
    konf = {
        "mupibox": {"audioDevice": "hw:0,0", "startVolume": "40",
                    "maxVolume": "80", "mediaCheckTimer": "300",
                    "host": "wegwerf"},
        # Anmeldung AUS: sonst schlaegt beim Zurueckspielen ohne Passwort zu
        # Recht die Wache gegen die ausgesperrte Box zu, und gemessen waere
        # dann jene statt des Behaelters.
        "interfacelogin": {"state": False, "password": MARKEN["password"]},
        "spotify": {"clientId": "oeffentlich",
                    "clientSecret": MARKEN["clientSecret"],
                    "refreshToken": MARKEN["refreshToken"]},
        "telegram": {"token": MARKEN["telegram"]},
    }
    with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
        json.dump(konf, f, indent=4)
    with open(os.path.join(e, "bt-adapter"), "w") as f:
        f.write("AA:BB:CC:DD:EE:FF\n")
    # DREI Netze, das MITTLERE ohne Passwort. Genau daran zeigt sich, ob die
    # Werte an ihre Stelle zurueckgehen oder nur der Reihe nach.
    with open(os.path.join(s, "wlan.json"), "w") as f:
        json.dump([{"category": "wifi", "ssid": "Zuhause", "pw": MARKEN["pw-eins"]},
                   {"category": "wifi", "ssid": "OhnePasswort"},
                   {"category": "wifi", "ssid": "Ferien", "pw": MARKEN["pw-zwei"]}],
                  f, indent=4)
    with open(os.path.join(s, "data.json"), "w") as f:
        json.dump([{"title": "Bibi", "artist": "x"} for _ in range(40)], f)
    with open(os.path.join(s, "resume.json"), "w") as f:
        json.dump({"a": 1}, f)
    if akkuverlauf:
        with open(os.path.join(s, "akkuverlauf.json"), "wb") as f:
            f.write(akkuverlauf)
    return e, s


def echte_messreihe(m) -> bytes | None:
    """Die ECHTE Messreihe der Box lesen — sie traegt keine Schluessel.

    Geschaetzte Groessen taugen hier nicht: gzip komprimiert eine Zahlenreihe
    sehr gut, und genau der komprimierte Wert entscheidet ueber die Karte.
    """
    quelle = os.path.join(m.BAEUME["server/config"], "akkuverlauf.json")
    if not os.path.isfile(quelle):
        return None
    with open(quelle, "rb") as f:
        return f.read()


def messen(m, b: Bilanz, tmp: str, akku: bytes | None) -> None:
    e, s = baum_legen(os.path.join(tmp, "baum"), akku)
    staende = os.path.join(tmp, "staende")
    os.makedirs(staende, exist_ok=True)
    m.BAEUME = {"etc/mupibox": e, "server/config": s}
    m.STAENDE = staende

    print("\n1  ANLEGEN OHNE PASSWORT — die Vorgabe")
    t0 = time.perf_counter()
    rc = m.anlegen("wegwerf-ohne", False, False, sagen=lambda *_: None)
    t_ohne = time.perf_counter() - t0
    ohne_name = m.staende_lesen()[0]
    st_ohne, _ = m.stand_oeffnen(os.path.join(staende, ohne_name))
    gr_ohne = os.path.getsize(os.path.join(staende, ohne_name))
    b.chk("ein Stand entsteht", rc == 0 and bool(ohne_name))
    b.chk("er traegt KEINEN Behaelter", not st_ohne.get("zugangsdaten"))
    b.chk("er nennt die ausgelassenen Schluessel",
          len(st_ohne["ausgelassen"]) >= 4)
    b.merken(f"Groesse {gr_ohne} B, {len(st_ohne['dateien'])} Dateien, "
             f"{t_ohne * 1000:.0f} ms")

    print("\n2  ANLEGEN MIT ZUGANGSDATEN — Passwort ueber die Umgebung")
    if not m.gpg_pfad():
        b.chk("gpg ist auf dieser Box vorhanden", False,
              "ohne gpg geht der ganze Abschnitt nicht — apt-get install gnupg")
        return
    os.environ[m.PW_UMGEBUNG] = PW
    try:
        t0 = time.perf_counter()
        rc = m.anlegen("wegwerf-mit", False, False, sagen=lambda *_: None,
                       mit_zugangsdaten=True)
        t_mit = time.perf_counter() - t0
    finally:
        os.environ.pop(m.PW_UMGEBUNG, None)
    mit_name = [n for n in m.staende_lesen() if "wegwerf-mit" in n][0]
    pfad_mit = os.path.join(staende, mit_name)
    st_mit, inh_mit = m.stand_oeffnen(pfad_mit)
    gr_mit = os.path.getsize(pfad_mit)
    zug = st_mit.get("zugangsdaten") or {}
    b.chk("ein Stand mit Behaelter entsteht", rc == 0 and bool(zug))
    b.chk("er ist ANGEHEFTET (sonst verdraengen ihn die taeglichen Laeufe)",
          ".behalten." in mit_name)
    b.chk("der Behaelter nennt die Felder", len(zug.get("felder", [])) >= 5)
    b.chk("… und ALLE Stellen, auch das zweite WLAN",
          zug.get("stellen", 0) >= 6, f"stellen={zug.get('stellen')}")
    b.merken(f"Groesse {gr_mit} B (+{gr_mit - gr_ohne} B), Behaelter "
             f"{zug.get('bytes')} B, {t_mit * 1000:.0f} ms")
    b.merken(f"Verfahren: {zug.get('verfahren')}")

    print("\n3  IST ETWAS IM KLARTEXT IM ARCHIV?")
    import gzip
    platt = gzip.decompress(open(pfad_mit, "rb").read())
    undicht = [k for k, v in MARKEN.items() if v.encode() in platt]
    b.chk("KEINE einzige Marke steht im Klartext im Archiv",
          not undicht, ", ".join(undicht) if undicht else "")
    b.chk("der Netzname bleibt lesbar (sonst weiss niemand, welches Netz fehlt)",
          b"Zuhause" in platt)
    b.chk("LIESMICH.txt sagt, dass Zugangsdaten VERSCHLUESSELT dabei sind",
          b"VERSCHLUESSELT DABEI" in platt)
    b.chk("… und dass ohne Passwort alles ANDERE trotzdem zurueckkommt",
          "ALLES ANDERE".encode() in platt or b"ANDERE zurueck" in platt)

    print("\n4  DIE WOECHENTLICHE SELBSTPROBE")
    gesagt: list[str] = []
    t0 = time.perf_counter()
    rc = m.pruefen("alle", sagen=gesagt.append)
    t_pruefen = time.perf_counter() - t0
    b.chk("`--pruefen` sagt ueber beide Staende OK", rc == 0)
    b.chk("… und nennt die verschluesselten Felder",
          any("Zugangsdaten" in g for g in gesagt))
    gesagt = []
    t0 = time.perf_counter()
    rc = m.probe(sagen=gesagt.append)
    t_probe = time.perf_counter() - t0
    text = "\n".join(gesagt)
    b.chk("`--probe` besteht", rc == 0)
    b.chk("… und hat den Behaelter angesehen (ohne ihn zu oeffnen)",
          "Zugangsdaten:" in text)
    b.chk("… und sagt, dass sie das Passwort nicht pruefen kann",
          "Passwort" in text)
    b.merken(f"pruefen {t_pruefen * 1000:.0f} ms, probe {t_probe * 1000:.0f} ms")

    print("\n5  ZURUECKSPIELEN OHNE PASSWORT — die Box hat alles vergessen")
    nackt = json.load(open(os.path.join(e, "mupiboxconfig.json")))
    nackt["spotify"].pop("refreshToken", None)
    nackt["spotify"].pop("clientSecret", None)
    nackt["interfacelogin"].pop("password", None)
    nackt["telegram"].pop("token", None)
    nackt["mupibox"]["startVolume"] = "99"
    with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
        json.dump(nackt, f, indent=4)
    with open(os.path.join(s, "wlan.json"), "w") as f:
        json.dump([{"category": "wifi", "ssid": "Zuhause"},
                   {"category": "wifi", "ssid": "OhnePasswort"},
                   {"category": "wifi", "ssid": "Ferien"}], f, indent=4)
    bericht = "\n".join(m.wiederherstellen(st_mit, inh_mit, trocken=False))
    jetzt = json.load(open(os.path.join(e, "mupiboxconfig.json")))
    b.chk("das Uebrige ist zurueck", jetzt["mupibox"]["startVolume"] == "40")
    b.chk("der Dauerzugang wird NICHT erfunden",
          "refreshToken" not in jetzt["spotify"])
    b.chk("der Bericht NENNT die verschluesselten Felder",
          "VERSCHLUESSELT" in bericht and "refreshToken" in bericht)
    b.chk("… und sagt, mit welchem Befehl man sie nachtraegt",
          "--mit-zugangsdaten" in bericht)

    print("\n6  FALSCHES PASSWORT — es muss LAUT scheitern")
    laut = False
    t0 = time.perf_counter()
    try:
        m.geheim_aus_stand(pfad_mit, st_mit, "das-ist-nicht-die-losung")
    except SystemExit:
        laut = True
    t_falsch = time.perf_counter() - t0
    b.chk("ein falsches Passwort scheitert mit einer Absage", laut)
    jetzt2 = json.load(open(os.path.join(e, "mupiboxconfig.json")))
    b.chk("… und hat NICHTS angefasst", jetzt2 == jetzt)
    roh_behaelter = m.behaelter_lesen(pfad_mit, st_mit) or b""
    verdreht = bytearray(roh_behaelter)
    verdreht[len(verdreht) // 2] ^= 0xFF
    laut = False
    try:
        m.behaelter_auspacken(bytes(verdreht), PW)
    except SystemExit:
        laut = True
    b.chk("ein verdrehtes Byte im Behaelter scheitert ebenso", laut)
    b.chk("der Behaelter ist ein AEAD-Paket",
          m.ist_aead(m.behaelter_kopf(roh_behaelter)),
          str(m.behaelter_kopf(roh_behaelter)))
    b.merken(f"falsches Passwort kostet {t_falsch * 1000:.0f} ms")

    print("\n7  ZURUECKSPIELEN MIT PASSWORT")
    t0 = time.perf_counter()
    auf = m.geheim_aus_stand(pfad_mit, st_mit, PW)
    t_auf = time.perf_counter() - t0
    bericht = "\n".join(m.wiederherstellen(st_mit, inh_mit, trocken=False,
                                           geheim=auf))
    jetzt = json.load(open(os.path.join(e, "mupiboxconfig.json")))
    netze = json.load(open(os.path.join(s, "wlan.json")))
    b.chk("der Spotify-Dauerzugang ist wieder da",
          jetzt["spotify"].get("refreshToken") == MARKEN["refreshToken"])
    b.chk("das Spotify-Geheimnis ist wieder da",
          jetzt["spotify"].get("clientSecret") == MARKEN["clientSecret"])
    b.chk("das Verwaltungspasswort ist wieder da",
          jetzt["interfacelogin"].get("password") == MARKEN["password"])
    b.chk("der Telegram-Schluessel ist wieder da",
          jetzt["telegram"].get("token") == MARKEN["telegram"])
    b.chk("JEDES WLAN-Passwort steht am RICHTIGEN Netz",
          [n.get("pw") for n in netze] == [MARKEN["pw-eins"], None,
                                           MARKEN["pw-zwei"]],
          "das mittlere Netz hatte nie eines")
    b.chk("der Bericht sagt, dass es aus dem Stand kam",
          "AUS DEM STAND" in bericht)
    b.merken(f"oeffnen kostet {t_auf * 1000:.0f} ms")

    print("\n8  WAS DIE MESSREIHE KOSTET")
    reihe = os.path.join(s, "akkuverlauf.json")
    if not os.path.isfile(reihe):
        b.merken("akkuverlauf.json war nicht zu bekommen — nicht gemessen")
        return
    b.chk("die Messreihe ist im Stand",
          "server/config/akkuverlauf.json" in inh_mit)
    s1, _, _ = m.stand_bauen("kennung-a")
    with open(reihe, "rb") as f:
        alt_reihe = f.read()
    neu_reihe = json.dumps(json.loads(alt_reihe.decode())
                           + [{"t": 9, "v": 1, "i": 0, "p": 1}]).encode()
    with open(reihe, "wb") as f:
        f.write(neu_reihe)
    s2, i2, _ = m.stand_bauen("kennung-b")
    b.chk("ein neuer Messpunkt aendert die Kennung NICHT "
          "(`--wenn-anders` unterdrueckt weiter)",
          s1["inhalt_kennung"] == s2["inhalt_kennung"])
    b.chk("… er ist aber im Stand",
          len(i2["server/config/akkuverlauf.json"]) > len(alt_reihe))
    # Und der Fall, der die Sicherung frueher haette aufhalten koennen.
    open(reihe, "wb").close()
    s3, i3, _ = m.stand_bauen("leere-reihe")
    b.chk("eine LEER erwischte Messreihe haelt den Stand NICHT auf",
          "server/config/data.json" in i3
          and "server/config/akkuverlauf.json" not in i3)
    b.chk("… und es steht im Stand, warum sie fehlt",
          any("akkuverlauf" in n["pfad"] for n in s3["nicht_dabei"]))
    with open(reihe, "wb") as f:
        f.write(alt_reihe)
    b.merken(f"Messreihe roh {len(alt_reihe)} B; Stand mit ihr {gr_mit} B")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--skript", default=SKRIPT,
                   help="welches mupibox-sicherung.py gemessen wird")
    p.add_argument("--host", help="ueber SSH auf dieser Box messen")
    a = p.parse_args(argv[1:])

    if a.host:
        # Sich selbst hinueberlegen und dort laufen lassen — gemessen wird
        # immer AUF der Box, nie von aussen.
        hier = os.path.abspath(__file__)
        drueben = "/tmp/" + os.path.basename(hier)
        subprocess.run(["scp", "-q", hier, f"{a.host}:{drueben}"], check=True)
        return subprocess.run(["ssh", a.host, "python3", drueben,
                               "--skript", a.skript]).returncode

    m = modul_laden(a.skript)
    print(f"gemessen an {os.uname().nodename}, "
          f"{time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"gegen {a.skript}")
    print(f"gpg:  {m.gpg_pfad() or 'FEHLT'}")
    akku = echte_messreihe(m)
    print(f"echte Messreihe: "
          + (f"{len(akku)} B uebernommen" if akku else "nicht vorhanden"))

    b = Bilanz()
    with tempfile.TemporaryDirectory(prefix="mupibox-zugang-") as tmp:
        try:
            messen(m, b, tmp, akku)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{b.gut} bestanden, {b.schlecht} fehlgeschlagen")
    return 1 if b.schlecht else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
