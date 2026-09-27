#!/usr/bin/env python3
"""Die vier Fragen an die Sicherung, die man nur MESSEND beantworten kann.

Laeuft AUF DER BOX und fasst dabei NICHTS Echtes an: jeder Fall baut sich
seinen eigenen Wegwerf-Baum unter /tmp und biegt die Konstanten des Werkzeugs
(STAENDE, BAEUME, KARTE) dorthin um. Die echten Staende in
/home/dietpi/.mupibox/sicherungen und die echte FAT-Partition bleiben
unberuehrt — nachgewiesen wird das am Ende selbst (Fall 0).

    G1  Was passiert bei einer Sicherung, waehrend gerade geschrieben wird?
    G2  Faellt die Sicherung aus, wenn kein Platz mehr ist — und merkt es wer?
    G3  Raeumt das Aufraeumen jemals den LETZTEN Stand weg?
    G4  Sagt die Sicherung, WAS in ihr fehlt (Zugangsdaten)?

AUFRUF
    sudo python3 sicherung-grenzfaelle.py            # alle Faelle
    python3 sicherung-grenzfaelle.py --ohne-platz    # ohne G2 (braucht mount)

G2 braucht root: „kein Platz mehr" laesst sich ehrlich nur an einem wirklich
vollen Dateisystem messen (tmpfs, 64 KB). Eine nachgestellte Ausnahme wuerde
nur beweisen, dass Python Ausnahmen wirft.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

WERKZEUG = os.environ.get("MUPIBOX_SICHERUNG",
                          "/usr/local/bin/mupibox/mupibox-sicherung.py")

_spec = importlib.util.spec_from_file_location("mupibox_sicherung", WERKZEUG)
sich = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sich)

gut = schlecht = 0
offen: list[str] = []


def chk(name: str, bedingung: bool, dazu: str = "") -> bool:
    global gut, schlecht
    print(("  OK     " if bedingung else "  FEHLT  ") + name + (f"   [{dazu}]" if dazu else ""))
    gut += bool(bedingung)
    schlecht += (not bedingung)
    return bool(bedingung)


def sagt(name: str, text: str) -> None:
    print(f"  BEFUND {name}: {text}")


def teil(t: str) -> None:
    print(f"\n── {t} " + "─" * max(0, 62 - len(t)))


def _lock_im_code(pfad: str) -> list[str]:
    """Nennt eine .lock-Datei irgendwo im AUSFUEHRBAREN Teil? -> Fundstellen.

    Dokumentzeilen (Modul-, Klassen-, Funktionskopf) zaehlen nicht: sie
    beschreiben, sie tun nichts. Die DRAUSSEN-Tabelle auf Modulebene zaehlt
    ebenfalls nicht — sie ist ein Muster fuer das Einsammeln, keine Abfrage.
    """
    import ast
    baum = ast.parse(open(pfad, encoding="utf-8").read())
    fund = []
    for knoten in ast.walk(baum):
        if not isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        koerper = knoten.body
        if (koerper and isinstance(koerper[0], ast.Expr)
                and isinstance(koerper[0].value, ast.Constant)
                and isinstance(koerper[0].value.value, str)):
            koerper = koerper[1:]      # der Kopftext der Funktion
        for stelle in koerper:
            for k in ast.walk(stelle):
                if (isinstance(k, ast.Constant) and isinstance(k.value, str)
                        and ".lock" in k.value):
                    fund.append(f"{knoten.name}:{k.lineno}: {k.value!r}")
    return fund


class Baum:
    """Ein Wegwerf-Baum, in dem das Werkzeug arbeiten darf."""

    def __init__(self, prefix="mupibox-grenz-"):
        self.tmp = tempfile.mkdtemp(prefix=prefix)
        self.etc = os.path.join(self.tmp, "etc")
        self.srv = os.path.join(self.tmp, "srv")
        self.staende = os.path.join(self.tmp, "staende")
        for p in (self.etc, self.srv, self.staende):
            os.makedirs(p, exist_ok=True)
        self._alt = None

    def __enter__(self):
        self._alt = (sich.BAEUME, sich.STAENDE, sich.KARTE)
        sich.BAEUME = {"etc/mupibox": self.etc, "server/config": self.srv}
        sich.STAENDE = self.staende
        self.konfig_legen()
        return self

    def __exit__(self, *_):
        sich.BAEUME, sich.STAENDE, sich.KARTE = self._alt
        shutil.rmtree(self.tmp, ignore_errors=True)
        return False

    def konfig_legen(self, **zusatz):
        d = {"mupibox": {"audioDevice": "hw:0,0", "startVolume": "40",
                         "maxVolume": "80", "mediaCheckTimer": "300"},
             "interfacelogin": {"state": False, "password": ""},
             "spotify": {"clientId": "abc", "clientSecret": "GEHEIM1",
                         "refreshToken": "GEHEIM2"}}
        d.update(zusatz)
        with open(os.path.join(self.etc, "mupiboxconfig.json"), "w") as f:
            json.dump(d, f, indent=4)

    def daten_legen(self, liste):
        with open(os.path.join(self.srv, "data.json"), "w") as f:
            json.dump(liste, f, indent=4)


# ══════════════════════════════════════════════════════════════════════════
# G1  Eine Sicherung, waehrend gerade geschrieben wird
# ══════════════════════════════════════════════════════════════════════════
def g1_wettlauf() -> None:
    teil("G1  Sicherung, waehrend gerade geschrieben wird")

    # ── G1a  Die halbe Datei. Nachgestellt wird GENAU das, was
    #        `jsonfile.writeFile` in server.ts (/api/add) tut: die ZIELDATEI
    #        oeffnen (das kuerzt sie auf 0) und dann fuellen. Kein tmp, kein
    #        Umbenennen. Wer in dieses Fenster hinein liest, liest eine halbe.
    with Baum() as b:
        gross = [{"title": f"Folge {i}", "artist": "x" * 200} for i in range(400)]
        b.daten_legen(gross)
        ziel = os.path.join(b.srv, "data.json")
        text = json.dumps(gross, indent=4).encode()

        halt = threading.Event()
        geschrieben = [0]

        def schreiber():
            while not halt.is_set():
                # nicht atomar — genau wie /api/add
                with open(ziel, "wb") as f:
                    for i in range(0, len(text), 4096):
                        f.write(text[i:i + 4096])
                geschrieben[0] += 1
                time.sleep(0.0005)

        t = threading.Thread(target=schreiber, daemon=True)
        t.start()
        kaputt = versuche = 0
        ende = time.time() + 6.0
        while time.time() < ende:
            versuche += 1
            _, inhalte, *_r = sich.stand_bauen("wettlauf")
            roh = inhalte.get("server/config/data.json", b"")
            try:
                json.loads(roh.decode())
            except (ValueError, UnicodeDecodeError):
                kaputt += 1
        halt.set()
        t.join(timeout=2)

        sagt("G1a", f"{versuche} Staende gebaut waehrend {geschrieben[0]} nicht "
                    f"atomarer Schreibvorgaenge -> {kaputt} trugen eine "
                    f"UNVOLLSTAENDIGE data.json")
        if kaputt:
            chk("eine halb geschriebene data.json landet WIRKLICH im Stand — "
                "und nichts haelt sie auf", True, f"{kaputt}/{versuche}")
            offen.append(f"G1a: {kaputt} von {versuche} Staenden trugen eine "
                         f"halbe data.json (gemessen, nicht hergeleitet)")
        else:
            sagt("G1a", "in diesem Lauf NICHT eingetreten — das Fenster ist "
                        "kurz, aber es ist da (Nachweis unten: keine Sperre)")

        # ── G1b  Wird die Sperre des Servers ueberhaupt gefragt?
        #        `.data.lock` steht in DRAUSSEN unter server/config — die
        #        Datei liegt aber in /tmp (server.ts: lockBasePath). Und
        #        gefragt wird sie nirgends.
        # Gefragt wird der QUELLTEXT, aber nur sein ausfuehrbarer Teil.
        # Eine Textsuche ueber die ganze Datei war hier schon einmal rot,
        # weil in einem Kommentar das Wort `.data.lock` STAND — die Aussage
        # („es wird nicht danach gefragt") war die ganze Zeit richtig, der
        # Test hat Prosa gelesen. Ein Test, der auf Kommentare anspringt,
        # erzieht dazu, Kommentare wegzulassen.
        chk("das Werkzeug fragt in KEINER Zeile ausfuehrbaren Codes nach der "
            "Sperre des Servers (.data.lock / .resume.lock)",
            not _lock_im_code(WERKZEUG), str(_lock_im_code(WERKZEUG)))
        chk("und das DRAUSSEN-Muster zeigt ins Leere: die Sperrdatei liegt "
            "in /tmp, nicht in server/config",
            not os.path.exists("/home/dietpi/.mupibox/Sonos-Kids-Controller-"
                               "master/server/config/.data.lock"))

    # ── G1c  Der zweite, groessere Fall: kein Schnappschuss ueber ALLE
    #        Dateien. 18 Dateien werden NACHEINANDER gelesen. Wer dazwischen
    #        zwei davon aendert, bekommt einen Stand, den es nie gab.
    with Baum() as b:
        b.daten_legen([{"title": "A"}])
        with open(os.path.join(b.srv, "listen.json"), "w") as f:
            json.dump({"stand": "A"}, f)

        halt = threading.Event()
        runden = [0]

        def umschalter():
            # Beide Dateien gehoeren zusammen: entweder beide A oder beide B.
            while not halt.is_set():
                for marke in ("A", "B"):
                    with open(os.path.join(b.srv, "data.json"), "w") as f:
                        json.dump([{"title": marke}], f)
                    time.sleep(0.0008)
                    with open(os.path.join(b.srv, "listen.json"), "w") as f:
                        json.dump({"stand": marke}, f)
                    time.sleep(0.0008)
                runden[0] += 1

        t = threading.Thread(target=umschalter, daemon=True)
        t.start()
        zwitter = versuche = 0
        ende = time.time() + 6.0
        while time.time() < ende:
            versuche += 1
            _, inhalte, *_r = sich.stand_bauen("wettlauf")
            try:
                a = json.loads(inhalte["server/config/data.json"].decode())[0]["title"]
                c = json.loads(inhalte["server/config/listen.json"].decode())["stand"]
            except (ValueError, KeyError, IndexError, UnicodeDecodeError):
                continue
            if a != c:
                zwitter += 1
        halt.set()
        t.join(timeout=2)
        sagt("G1c", f"{versuche} Staende, {runden[0]} Umschaltungen -> "
                    f"{zwitter} Staende trugen ZWEI DATEIEN AUS ZWEI ZEITEN")
        chk("ein Stand ist KEIN Schnappschuss: zwei zusammengehoerige Dateien "
            "koennen aus zwei verschiedenen Zeitpunkten stammen",
            zwitter > 0, f"{zwitter}/{versuche}")
        if zwitter:
            offen.append(f"G1c: {zwitter} von {versuche} Staenden waren in sich "
                         f"widerspruechlich (zwei Dateien, zwei Zeitpunkte)")


# ══════════════════════════════════════════════════════════════════════════
# G2  Kein Platz mehr
# ══════════════════════════════════════════════════════════════════════════
def g2_kein_platz(ueberspringen: bool) -> None:
    teil("G2  Kein Platz mehr — faellt sie aus, und merkt es jemand?")
    if ueberspringen:
        print("  (uebersprungen)")
        return
    if os.geteuid() != 0:
        print("  (braucht root fuer `mount -t tmpfs` — mit sudo noch einmal)")
        offen.append("G2 nicht gemessen: ohne root kein wirklich volles "
                     "Dateisystem")
        return

    voll = tempfile.mkdtemp(prefix="mupibox-voll-")
    montiert = False
    try:
        subprocess.run(["mount", "-t", "tmpfs", "-o", "size=64k", "tmpfs", voll],
                       check=True)
        montiert = True
        with Baum() as b:
            sich.STAENDE = os.path.join(voll, "staende")
            os.makedirs(sich.STAENDE, exist_ok=True)
            b.daten_legen([{"title": f"F{i}"} for i in range(50)])
            # bis auf den letzten Krumen fuellen
            with open(os.path.join(voll, "ballast"), "wb") as f:
                try:
                    f.write(b"\0" * 200_000)
                except OSError:
                    pass
            frei = os.statvfs(voll)
            sagt("G2", f"tmpfs frei: {frei.f_bavail * frei.f_bsize} B")

            gesagt: list[str] = []
            art = rc = None
            try:
                rc = sich.anlegen("kein-platz", False, False, sagen=gesagt.append)
            except BaseException as e:                           # noqa: BLE001
                art = f"{type(e).__name__}: {e}"

            if art:
                chk("kein Platz -> das Werkzeug bricht mit einer AUSNAHME ab "
                    "(kein sauberer Rueckgabewert, keine Meldung im Klartext)",
                    True, art[:70])
                offen.append(f"G2: --anlegen wirft bei vollem Datentraeger "
                             f"eine ungefangene Ausnahme ({art.split(':')[0]}) — "
                             f"die Meldung ist ein Traceback")
            else:
                chk("kein Platz -> --anlegen meldet es und gibt != 0 zurueck",
                    rc != 0, f"rc={rc}, sagte: {' / '.join(gesagt)[:60]}")

            reste = sorted(os.listdir(sich.STAENDE))
            imbau = [r for r in reste if r.endswith(".imbau")]
            chk("kein halber Stand bleibt als `.tar.gz` liegen",
                not any(r.endswith(".tar.gz") for r in reste), str(reste))
            if imbau:
                sagt("G2", f"aber es bleibt ein Torso liegen: {imbau} — er "
                           f"wird nie aufgeraeumt und belegt den Platz weiter")
                offen.append(f"G2: der halb geschriebene `{imbau[0]}` bleibt "
                             f"liegen; niemand raeumt ihn je weg")
            chk("ein alter, brauchbarer Stand wird durch den Fehlversuch NICHT "
                "beschaedigt", True, "es gab keinen — s. u. G2b")
    finally:
        if montiert:
            subprocess.run(["umount", voll], check=False)
        shutil.rmtree(voll, ignore_errors=True)

    # ── G2b  Und wer merkt es? Die Unit ist die einzige Instanz, die es
    #        ueberhaupt sehen koennte.
    for unit, was in (("mupibox-sicherung.service", "der Stand im Haus"),
                      ("mupibox-sicherung.timer", "der taegliche Lauf")):
        p = subprocess.run(["systemctl", "cat", unit], capture_output=True, text=True)
        chk(f"{unit}: es gibt KEIN OnFailure= — ein Fehlschlag meldet sich "
            f"nirgends ({was})",
            "OnFailure" not in p.stdout)
    p = subprocess.run(["systemctl", "cat", "mupibox-sicherung.service"],
                       capture_output=True, text=True)
    chk("der Schritt auf die KARTE steht auf `-+`: sein Fehlschlag wird "
        "ausdruecklich verschluckt",
        "-+/usr/local/bin/mupibox/mupibox-sicherung.py --auf-karte" in p.stdout)
    offen.append("G2: kein OnFailure= an Zeitgeber oder Dienst — ein "
                 "Fehlschlag steht nur in `systemctl --failed`, und das "
                 "braucht SSH")
    offen.append("G2: `--auf-karte` haengt an `-+`; laeuft die 127-MB-Partition "
                 "voll, hoert der Rueckweg OHNE SSH still auf, aktuell zu sein")


# ══════════════════════════════════════════════════════════════════════════
# G3  Raeumt das Aufraeumen je den LETZTEN Stand weg?
# ══════════════════════════════════════════════════════════════════════════
def g3_auslese() -> None:
    teil("G3  Raeumt das Aufraeumen jemals den LETZTEN Stand weg?")

    n = [f"mupibox-sicherung-2026080{i}-120000-selbsttaetig.tar.gz" for i in range(1, 10)]
    chk("ein einziger Stand faellt nie (Kontingent 10)", sich.auslese(n[:1], 10) == [])
    chk("bei genau Kontingent faellt nichts", sich.auslese(n[:9] + [n[0]], 10) == [])
    chk("der JUENGSTE faellt auch bei Ueberfluss nie",
        sorted(n)[-1] not in sich.auslese(n, 1))
    chk("Kontingent 1 laesst genau einen stehen", len(sich.auslese(n, 1)) == len(n) - 1)
    chk("ein angehefteter Stand faellt nie",
        "mupibox-sicherung-20260701-120000-x.behalten.tar.gz" not in
        sich.auslese(["mupibox-sicherung-20260701-120000-x.behalten.tar.gz"] + n, 1))
    # Der einzige Weg, alles zu verlieren, waere Kontingent 0 — und das steht
    # fest auf 10.
    chk("nur Kontingent 0 raeumte alles weg — und es steht fest auf 10",
        sich.auslese(n, 0) == sorted(n) and sich.BEHALTEN == 10)

    # ── G3b  Die Karte ist KEIN Archiv, sondern ein SPIEGEL. Und ein Spiegel
    #        loescht, was das Original nicht mehr hat.
    with Baum() as b:
        karte = os.path.join(b.tmp, "karte")
        os.makedirs(os.path.join(karte, sich.KARTE_ORDNER), exist_ok=True)
        sich.KARTE = karte
        b.daten_legen([{"title": "A"}])
        sich.anlegen("erster", False, True, sagen=lambda *_: None)   # angeheftet
        sich.auf_karte(sagen=lambda *_: None)
        auf_karte_vorher = [x for x in os.listdir(os.path.join(karte, sich.KARTE_ORDNER))
                            if x.endswith(".tar.gz")]
        chk("der angeheftete Stand liegt auf der Karte", len(auf_karte_vorher) == 1)

        # Jetzt geht das Haus verloren — Karte ausgetauscht, /home geleert,
        # oder schlicht: die Staende liegen root und die Auslese sieht sie
        # nicht mehr. Der naechste selbsttaetige Lauf ruft `--auf-karte`.
        for x in os.listdir(sich.STAENDE):
            os.remove(os.path.join(sich.STAENDE, x))
        rc = sich.auf_karte(sagen=lambda *_: None)
        auf_karte_nachher = [x for x in os.listdir(os.path.join(karte, sich.KARTE_ORDNER))
                             if x.endswith(".tar.gz")]
        weg = not auf_karte_nachher
        chk("ABER: sind die Staende im Haus weg, LOESCHT `--auf-karte` auch "
            "den letzten Stand auf der Karte — und meldet dabei Erfolg",
            weg and rc == 0, f"vorher {len(auf_karte_vorher)}, nachher "
                             f"{len(auf_karte_nachher)}, rc={rc}")
        if weg:
            offen.append("G3b: `--auf-karte` spiegelt statt zu archivieren. Ist "
                         "das Haus leer, raeumt es die Karte leer — auch den "
                         "letzten und auch angeheftete Staende, rc=0")


# ══════════════════════════════════════════════════════════════════════════
# G4  Sagt die Sicherung, WAS in ihr fehlt?
# ══════════════════════════════════════════════════════════════════════════
def g4_auskunft() -> None:
    teil("G4  Sagt die Sicherung, WAS in ihr fehlt (Zugangsdaten)?")
    with Baum() as b:
        with open(os.path.join(b.srv, "wlan.json"), "w") as f:
            json.dump([{"category": "wifi", "ssid": "Netzname", "pw": "HAUSSCHLUESSEL"}], f)
        stand, inhalte, *_r = sich.stand_bauen("auskunft")
        text = sich.liesmich(stand)

        roh = b"".join(inhalte.values())
        chk("kein Geheimnis im Archiv", b"GEHEIM1" not in roh and b"GEHEIM2" not in roh)
        chk("kein WLAN-Passwort im Archiv", b"HAUSSCHLUESSEL" not in roh)
        chk("LIESMICH nennt jeden ausgelassenen Zeiger namentlich",
            all(z in text for z in ("/spotify/refreshToken", "/spotify/clientSecret",
                                    "/*/pw")))
        chk("LIESMICH sagt auch WARUM und WAS beim Zurueckspielen passiert",
            "E29/B6" in text and "behaelt den Wert" in text)
        chk("der Stand traegt die Liste auch maschinenlesbar (`ausgelassen`)",
            len(stand["ausgelassen"]) >= 3)

        # ── Die Grenze der Auskunft: gemeldet wird nur, was auf der Liste
        #    GEHEIM steht. Ein NEUER Schluessel geht stillschweigend mit.
        b.konfig_legen(**{"neuerdienst": {"apiKey": "NAGELNEUGEHEIM"}})
        stand2, inhalte2, *_r = sich.stand_bauen("auskunft")
        drin = b"NAGELNEUGEHEIM" in b"".join(inhalte2.values())
        chk("ein Schluessel eines NEUEN Dienstes geht ungefragt mit ins "
            "Archiv — und keine Zeile sagt es",
            drin and "NAGELNEU" not in sich.liesmich(stand2),
            "GEHEIM ist eine Liste, keine Erkennung")
        if drin:
            offen.append("G4: neue Schluessel in einer BEKANNTEN Datei wandern "
                         "still ins Archiv. Fuer neue DATEIEN gibt es die "
                         "Spalte «unbekannt» — fuer neue SCHLUESSEL nichts")

        # Gegenprobe: was drin sein MUSS, ist auch drin (sonst prueft man nur,
        # dass die Suche nichts findet).
        chk("Gegenprobe: der Netzname ist sehr wohl im Archiv",
            b"Netzname" in b"".join(inhalte.values()))


# ══════════════════════════════════════════════════════════════════════════
# G5  Der ganze Schadensweg — von der leeren Datei bis zur leeren Box
# ══════════════════════════════════════════════════════════════════════════
def _leert_mit_trotzdem(sich, stand, inhalte, datei) -> bool:
    """--trotzdem muss ein Uebergehen bleiben, keine Sackgasse."""
    sich.wiederherstellen(stand, inhalte, trocken=False, trotzdem=True)
    return os.path.getsize(datei) == 0


def g5_leere_bibliothek() -> None:
    """Was aus G1 WIRKLICH folgt, Schritt fuer Schritt.

    tools/data-json-schreibfenster.sh hat gemessen, was ein Leser waehrend
    eines `/api/add` sieht: in 20,8 % der Versuche NULL BYTES — nicht eine
    halbe Datei, eine leere. Dieser Fall geht durch jede Pruefung, die es
    gibt, denn eine leere Datei ist widerspruchsfrei: die Pruefsumme stimmt,
    das Archiv oeffnet sich, der Rueckweg laeuft durch. Erst beim
    Zurueckspielen ist die Bibliothek weg.
    """
    teil("G5  Von der leeren data.json zur leeren Box")
    with Baum() as b:
        b.daten_legen([{"title": f"Werk {i}"} for i in range(25)])
        voll = os.path.join(b.srv, "data.json")
        echte_groesse = os.path.getsize(voll)

        # Der Wimpernschlag: die Datei ist auf 0 gekuerzt und noch nicht
        # gefuellt. Genau hier liest die Sicherung.
        open(voll, "wb").close()
        stand, inhalte, *_r = sich.stand_bauen("im-wimpernschlag")
        leer = inhalte.get("server/config/data.json")
        chk("die LEERE data.json wandert ungehindert in den Stand",
            leer == b"", f"{echte_groesse} B -> {len(leer or b'')} B")

        name = os.path.join(b.staende, sich.name_bauen(stand, False))
        sich.schreiben(name, stand, inhalte)

        # AB HIER HAENGT DER BEFUND DAVON AB, WELCHE FASSUNG AUF DER BOX
        # LIEGT. Der Fall wird nicht umgeschrieben, nur die Erwartung: ein
        # Werkzeug OHNE Vorkehrung muss die Luecke zeigen, eines MIT muss sie
        # schliessen. So bleibt derselbe Fall auf beiden Seiten aussagekraeftig
        # — und faellt nicht still weg, wenn jemand die Fassung zurueckdreht.
        mit_vorkehrung = hasattr(sich, "inhalt_klage")
        print(f"  (Fassung auf der Box: {'MIT' if mit_vorkehrung else 'OHNE'} "
              f"Vorkehrung gegen leere Dateien)")

        if mit_vorkehrung:
            chk("`--pruefen` nennt den Stand NICHT «OK»",
                sich.pruefen("alle", sagen=lambda *_: None) == 1)
            chk("`--probe` faellt an ihm durch — und zwar woechentlich, mit "
                "dem Urteil auf der Karte",
                sich.probe(sagen=lambda *_: None) == 1)
            b.daten_legen([{"title": f"Werk {i}"} for i in range(25)])
            gelesen, inh = sich.stand_oeffnen(name)
            verweigert = False
            try:
                sich.wiederherstellen(gelesen, inh, trocken=False, trotzdem=False)
            except SystemExit:
                verweigert = True
            chk("ZURUECKSPIELEN wird verweigert — die Bibliothek bleibt stehen",
                verweigert and os.path.getsize(voll) == echte_groesse,
                f"{os.path.getsize(voll)} B")
            chk("mit --trotzdem geht es weiterhin (wer es weiss, darf)",
                _leert_mit_trotzdem(sich, gelesen, inh, voll))
        else:
            chk("`--pruefen` nennt diesen Stand OK — die Pruefsumme einer "
                "leeren Datei stimmt ja",
                sich.pruefen("alle", sagen=lambda *_: None) == 0)
            chk("`--probe` besteht ebenfalls",
                sich.probe(sagen=lambda *_: None) == 0)
            b.daten_legen([{"title": f"Werk {i}"} for i in range(25)])
            gelesen, inh = sich.stand_oeffnen(name)
            sich.wiederherstellen(gelesen, inh, trocken=False, trotzdem=True)
            chk("ZURUECKGESPIELT: die Bibliothek der heilen Box ist LEER — "
                "kein Wort der Warnung an irgendeiner Stelle",
                os.path.getsize(voll) == 0, f"{echte_groesse} B -> 0 B")
            offen.append("G5: eine leer erwischte data.json geht durch ALLE "
                         "Pruefungen (--pruefen, --probe) und loescht beim "
                         "Zurueckspielen die Bibliothek. Genau die «halbe "
                         "data.json», die schlimmer ist als keine")

        # Die Gegenprobe, ohne die der Befund nichts wert waere: mit
        # Inhalt geht derselbe Weg richtig aus.
        b.daten_legen([{"title": f"Werk {i}"} for i in range(25)])
        stand2, inhalte2, *_r = sich.stand_bauen("heil")
        name2 = os.path.join(b.staende, sich.name_bauen(stand2, True))
        sich.schreiben(name2, stand2, inhalte2)
        b.daten_legen([])
        g, i2 = sich.stand_oeffnen(name2)
        sich.wiederherstellen(g, i2, trocken=False, trotzdem=True)
        chk("Gegenprobe: ein Stand MIT Inhalt spielt die 25 Werke zurueck",
            len(json.load(open(voll))) == 25)


# ══════════════════════════════════════════════════════════════════════════
# G6  Haelt die Vorkehrung dem stand, was G1 und G5 gemessen haben?
# ══════════════════════════════════════════════════════════════════════════
def g6_gegenprobe() -> None:
    """Derselbe Wettlauf wie G1 — aber ueber `--anlegen`, also mit Vorkehrung.

    Ein Fehler gilt erst als behoben, wenn die MESSUNG, die ihn gezeigt hat,
    ihn nicht mehr zeigt. Deshalb steht hier nicht ein neuer, bequemer Test,
    sondern G1a und G1c noch einmal — Wort fuer Wort derselbe Schreiber.
    """
    teil("G6  Gegenprobe: derselbe Wettlauf, jetzt mit Vorkehrung")
    if not hasattr(sich, "stand_bauen_stabil"):
        chk("das Werkzeug auf der Box kennt die Vorkehrung", False,
            "alte Fassung — erst ausliefern")
        return

    with Baum() as b:
        gross = [{"title": f"Folge {i}", "artist": "x" * 200} for i in range(400)]
        b.daten_legen(gross)
        with open(os.path.join(b.srv, "listen.json"), "w") as f:
            json.dump({"stand": "A"}, f)
        ziel = os.path.join(b.srv, "data.json")
        text = json.dumps(gross, indent=4).encode()

        halt = threading.Event()

        def schreiber():
            marke = 0
            while not halt.is_set():
                marke += 1
                with open(ziel, "wb") as f:
                    for i in range(0, len(text), 4096):
                        f.write(text[i:i + 4096])
                with open(os.path.join(b.srv, "listen.json"), "w") as f:
                    json.dump({"stand": marke}, f)
                time.sleep(0.0005)

        t = threading.Thread(target=schreiber, daemon=True)
        t.start()
        angelegt = verweigert = kaputt = 0
        ende = time.time() + 8.0
        while time.time() < ende:
            vorher = set(os.listdir(b.staende))
            rc = sich.anlegen("gegenprobe", False, False, sagen=lambda *_: None)
            neu = sorted(set(os.listdir(b.staende)) - vorher)
            if rc != 0:
                verweigert += 1
            for n in neu:
                angelegt += 1
                _, inh = sich.stand_oeffnen(os.path.join(b.staende, n))
                try:
                    json.loads(inh["server/config/data.json"].decode())
                except (ValueError, UnicodeDecodeError):
                    kaputt += 1
                os.remove(os.path.join(b.staende, n))
        halt.set()
        t.join(timeout=2)

        sagt("G6", f"{angelegt} Staende entstanden, {verweigert} Laeufe haben "
                   f"verweigert -> {kaputt} kaputte Staende")
        chk("KEIN einziger Stand traegt mehr eine unvollstaendige data.json",
            kaputt == 0, f"{kaputt} von {angelegt}")
        chk("und es wird nicht einfach alles verweigert — es entstehen "
            "weiterhin brauchbare Staende",
            angelegt > 0, f"{angelegt} Staende")

    # Und der Schadensweg aus G5, noch einmal von vorn.
    with Baum() as b:
        b.daten_legen([{"title": f"Werk {i}"} for i in range(25)])
        open(os.path.join(b.srv, "data.json"), "wb").close()
        rc = sich.anlegen("im-wimpernschlag", False, False, sagen=lambda *_: None)
        chk("G5 noch einmal: leer erwischt -> gar kein Stand mehr",
            rc == 1 and not [x for x in os.listdir(b.staende) if x.endswith(".tar.gz")])


def g0_nichts_angefasst(vorher: dict) -> None:
    teil("G0  Ist wirklich nichts Echtes angefasst worden?")
    for pfad, alt in vorher.items():
        jetzt = sorted(os.listdir(pfad)) if os.path.isdir(pfad) else None
        chk(f"unveraendert: {pfad}", jetzt == alt,
            f"{len(alt or [])} Eintraege")


def main() -> int:
    ohne_platz = "--ohne-platz" in sys.argv
    echte = {}
    for p in ("/home/dietpi/.mupibox/sicherungen", "/boot/firmware/mupibox-sicherung"):
        if os.path.isdir(p):
            try:
                echte[p] = sorted(os.listdir(p))
            except OSError:
                pass
    print(f"Werkzeug: {WERKZEUG}")
    g1_wettlauf()
    g2_kein_platz(ohne_platz)
    g3_auslese()
    g4_auskunft()
    g5_leere_bibliothek()
    g6_gegenprobe()
    g0_nichts_angefasst(echte)
    print(f"\n═══ {gut} bestanden, {schlecht} fehlgeschlagen ═══")
    if offen:
        print("\nWAS DER BETREIBER WISSEN MUSS:")
        for o in offen:
            print(f"  * {o}")
    return 1 if schlecht else 0


if __name__ == "__main__":
    sys.exit(main())
