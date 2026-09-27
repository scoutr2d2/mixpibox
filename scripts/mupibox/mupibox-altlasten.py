#!/usr/bin/env python3
"""Beiseite gelegte Dateien finden, einordnen und wegraeumen (BACKLOG E29/B5).

DAS BILD, UM DAS ES GEHT — gemessen am 04.08.2026 auf 192.168.178.169:

    beiseite gelegt   99      57 Dateien, 40 Ordner, 2 Verweise
    zusammen          163,1 MB
    aeltestes         2026-07-26   juengstes  2026-08-04

Der BACKLOG spricht von 89 Dateien und 80,2 MB. Diese Zahl liess sich nicht
nachbauen — das Zaehlverfahren dazu ist nirgends festgehalten; wahrscheinlich
fehlten die vier .tgz-Archive (28,2 MB) und die Ordner-Sicherungen. Sie steht
hier deshalb als NICHT NACHGEMESSEN. Die 99 sind belegt.

DIE EIGENTLICHE AUSSAGE STECKT IM VERHAELTNIS, nicht in der Zahl:

    nachbaubar (Bau-Ergebnis)   82 Stueck   163,0 MB   99,9 %
    Box-Zustand                 14 Stueck     0,1 MB    0,1 %

99,9 % dieser 163 MB sind aus dem Quelltext neu zu bauen. Was wirklich
unersetzlich ist, sind 0,1 MB. Genau deshalb darf hier NICHT nach Groesse
aufgeraeumt werden, sondern nach Herkunft.

DIE DREI SPALTEN, und warum es drei sind und nicht zwei:
  nachbaubar   server.js.*, www*/, www-admin*/, *.tgz — Bau-Ergebnis. Weder
               in git noch sonstwo noetig: `npm run build` erzeugt es wieder.
               Ein Stand vom 27.07. ist zudem wertlos, denn der Quelltext
               dazu liegt im Repo.
  boxzustand   mupiboxconfig.json.*, server/config/*.vor-*, data-vor-aufraeumen-*
               Nicht nachbaubar und nirgends sonst vorhanden. Faellt NIE,
               ohne vorher geerntet zu sein (--ernten in mupibox-sicherung.py).
  unklar       alles Uebrige. Bleibt liegen und wird AUFGESCHRIEBEN. Der
               konkrete Anlass: mupi-lautstaerke.sh.vor-20260801-1822 — dort
               weicht die LAUFENDE Datei vom Repo ab, und welche Seite vorn
               liegt, weiss dieses Werkzeug nicht. Raten waere hier teurer
               als liegen lassen.

AUFRUF
    mupibox-altlasten.py                      # nur ansehen
    mupibox-altlasten.py --json
    mupibox-altlasten.py --wegraeumen         # nachbaubares faellt (nach Sicherung)
    mupibox-altlasten.py --wegraeumen --auch-zustand
    mupibox-altlasten.py --host 192.168.178.169   # von aussen, ueber ssh
    mupibox-altlasten.py --selbsttest
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict

BOX = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
SICHERUNG = "/usr/local/bin/mupibox/mupibox-sicherung.py"

WURZELN = [BOX, "/etc/mupibox", "/usr/local/bin/mupibox", "/opt/mupibox-tools",
           "/var/www", "/etc/systemd/system", "/boot/firmware", "/boot"]

# Verzeichnisse, die beim Suchen gar nicht erst betreten werden.
AUSSEN_VOR = ["node_modules", "coverspeicher", "cache", "chromium_cache",
              ".git", "sicherungen"]

# Muster -> Sippe. Reihenfolge zaehlt: erste Uebereinstimmung gewinnt.
MUSTER = [
    ("datiert-vor", re.compile(r"\.vor-\d{8}-\d{4}$")),
    ("datiert-vor", re.compile(r"\.vor-[\w-]+-\d{8}T\d{6}$")),
    ("datiert-bak", re.compile(r"\.bak-\d{8}-\d{6}$")),
    ("tgz", re.compile(r"\.vor-[\d-]+\.tgz$")),
    ("aufraeumen", re.compile(r"-vor-aufraeumen-[\dT-]+\.json$")),
    ("benannt-vor", re.compile(r"\.vor-[a-zA-Z0-9-]+$")),
    ("benannt-vor", re.compile(r"\.vorher$")),
    ("bak", re.compile(r"\.bak$")),
    ("alt", re.compile(r"\.alt\d*$")),
    ("alt", re.compile(r"\.alt[A-Z]$")),
    ("mein-bau", re.compile(r"\.mein-bau[-\w]*$")),
    ("orig-old-save", re.compile(r"\.(orig|old|save|dpkg-old|ucf-old)$")),
]

# Was der Bau wieder herstellt. Der STAMM ist der Name ohne den Zusatz, der
# die Datei zur Altlast gemacht hat.
NACHBAUBAR_STAMM = {
    "server.js", "spotify-control.js", "www", "www-admin", "app.js",
    "main.js", "polyfills.js", "runtime.js", "styles.css", "dist", "deploy",
}
NACHBAUBAR_ENDUNG = (".js", ".js.map", ".css", ".css.map", ".tgz")


def sippe(name: str) -> str | None:
    for kennung, muster in MUSTER:
        if muster.search(name):
            return kennung
    return None


def stamm(name: str) -> str:
    """Der Name, wie er hiess, bevor er beiseite gelegt wurde."""
    for _, muster in MUSTER:
        neu = muster.sub("", name)
        if neu != name:
            return neu
    return name


def einordnen(pfad: str, name: str) -> tuple[str, str]:
    """-> (spalte, begruendung). Rein, damit sie ohne Box pruefbar ist.

    Diese Funktion entscheidet, was geloescht werden darf. Sie ist der Grund,
    warum es einen Selbsttest gibt: ein Fehler hier ist nicht rueckgaengig zu
    machen, und zwar bei genau den Dateien, die nicht nachbaubar sind.
    """
    st = stamm(name)
    verz = pfad.rsplit("/", 1)[0]

    # DER ORT ZUERST, und zwar mit Absicht. Eine Endungsregel («*.js ist
    # Bau-Ergebnis») ist eine Vermutung ueber den Inhalt; der Ort ist eine
    # Tatsache. Wo beide widersprechen, gewinnt die Tatsache — sonst raeumte
    # ein `monitor.js.bak` in server/config als vermeintliches Bau-Ergebnis ab.
    if verz.endswith("/server/config"):
        return "boxzustand", "Stand aus server/config — nicht nachbaubar"
    if verz == "/etc/mupibox" and st == "mupiboxconfig.json":
        return "boxzustand", "Fassung der Box-Konfiguration — nicht nachbaubar"

    if name.endswith(".tgz") or st.endswith(".tgz"):
        return "nachbaubar", "Bau-Archiv — `npm run build` erzeugt es wieder"
    if st in NACHBAUBAR_STAMM:
        return "nachbaubar", f"Bau-Ergebnis ({st}) — aus dem Quelltext nachbaubar"
    if st.endswith(NACHBAUBAR_ENDUNG):
        return "nachbaubar", f"Bau-Ergebnis ({st}) — aus dem Quelltext nachbaubar"
    return "unklar", ("weder eindeutig Bau-Ergebnis noch Box-Zustand — bleibt "
                      "liegen, bis jemand hinsieht")


# ── Einsammeln (lokal, auf der Box) ────────────────────────────────────────
def sammeln() -> list[dict]:
    treffer, verz = [], []
    for wurzel in WURZELN:
        if not os.path.isdir(wurzel):
            continue
        for hier, ordner, dateien in os.walk(wurzel):
            ordner[:] = [o for o in ordner if o not in AUSSEN_VOR]
            for name in list(ordner) + dateien:
                voll = os.path.join(hier, name)
                k = sippe(name)
                if not k:
                    continue
                ist_ordner = name in ordner
                if os.path.islink(voll):
                    typ = "l"
                elif ist_ordner:
                    typ = "d"
                    verz.append(voll)
                else:
                    typ = "f"
                spalte, warum = einordnen(voll, name)
                try:
                    wann = os.lstat(voll).st_mtime
                except OSError:
                    wann = 0.0
                treffer.append({"pfad": voll, "typ": typ, "sippe": k,
                                "spalte": spalte, "warum": warum,
                                "stamm": stamm(name), "mtime": wann,
                                "bytes": _groesse(voll, typ)})
    # Was UNTER einer Ordner-Sicherung liegt, nicht doppelt zaehlen.
    treffer = [t for t in treffer
               if not any(t["pfad"].startswith(v + "/") for v in verz)]
    return sorted(treffer, key=lambda t: t["pfad"])


def _groesse(pfad: str, typ: str) -> int:
    try:
        if typ == "d":
            summe = 0
            for hier, _, dateien in os.walk(pfad):
                for d in dateien:
                    try:
                        summe += os.path.getsize(os.path.join(hier, d))
                    except OSError:
                        pass
            return summe
        if typ == "l":
            return 0
        return os.path.getsize(pfad)
    except OSError:
        return 0


def mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


# ── Der juengste bleibt ────────────────────────────────────────────────────
def juengste_behalten(treffer: list[dict], je_stamm: int) -> tuple[list, list]:
    """-> (faellt, bleibt). Rein, damit sie ohne Box pruefbar ist.

    WARUM ES DIESE REGEL GIBT: `www.alt` und `www-admin.alt` sind nicht bloss
    Muell — sie SIND der Rueckweg aus [[ausliefern-regeln]] („Der Tausch ist
    damit ein einzelner Schritt, und `www.alt` ist gleich der Rueckweg").
    Ein Aufraeumen, das sie mitnimmt, entfernt genau in dem Moment den
    Rueckweg, in dem er am wahrscheinlichsten gebraucht wird: kurz nach einer
    Auslieferung.

    Also faellt je Stamm (www, www-admin, server.js, spotify-control.js) der
    JUENGSTE nicht. Das kostet ein paar MB und rettet den Fall, der weh tut.
    Wer wirklich alles will: --je-stamm 0.
    """
    nach_stamm: dict[str, list[dict]] = defaultdict(list)
    for t in treffer:
        nach_stamm[t.get("stamm", t["pfad"])].append(t)
    faellt, bleibt = [], []
    for _, ts in nach_stamm.items():
        ts = sorted(ts, key=lambda t: t.get("mtime", 0), reverse=True)
        bleibt.extend(ts[:je_stamm])
        faellt.extend(ts[je_stamm:])
    return (sorted(faellt, key=lambda t: t["pfad"]),
            sorted(bleibt, key=lambda t: t["pfad"]))


# ── Wegraeumen ─────────────────────────────────────────────────────────────
def wegraeumen(treffer: list[dict], auch_zustand: bool, wirklich: bool,
               je_stamm: int = 1, sagen=print) -> int:
    """OHNE SICHERUNG WIRD NICHT WEGGERAEUMT. Die Reihenfolge ist der Punkt.

    Erst der Stand der Box (falls das Aufraeumen etwas trifft, das noch
    gebraucht wird), dann die Ernte der nicht nachbaubaren Altlasten, und
    ERST DANN faellt etwas. Wer die Reihenfolge dreht, hat ein Aufraeumen mit
    einer Sicherung, die den aufgeraeumten Zustand enthaelt — also keine.
    """
    zustand = [t for t in treffer if t["spalte"] == "boxzustand" and t["typ"] == "f"]
    nachbaubar, rueckweg = juengste_behalten(
        [t for t in treffer if t["spalte"] == "nachbaubar"], je_stamm)
    unklar = [t for t in treffer if t["spalte"] == "unklar"]

    if not os.path.exists(SICHERUNG):
        sagen(f"{SICHERUNG} fehlt — ohne die eine Stelle, die sichert, wird "
              "hier nichts weggeraeumt.")
        return 1

    # TROCKEN LEGT KEINE ARCHIVE AN. Klingt nach einer Kleinigkeit, ist aber
    # dieselbe Krankheit: Stand und Ernte sind angeheftet, fallen also der
    # Auslese nie zum Opfer — jeder Probelauf haette dauerhaft zwei Archive
    # hinterlassen. Ein Aufraeumwerkzeug, das beim Ueben Muell erzeugt, ist
    # genau das, wogegen E29 angetreten ist.
    if not wirklich:
        sagen("1. Stand der Box sichern            (trocken: wird nur gesagt)")
        sagen(f"2. {len(zustand)} nicht nachbaubare Altlast(en) ernten "
              "(trocken: wird nur gesagt)")
    else:
        sagen("1. Stand der Box sichern")
        r = subprocess.run([SICHERUNG, "--anlegen", "--grund", "vor-altlasten",
                            "--behalten"], capture_output=True, text=True)
        sagen("   " + (r.stdout or r.stderr).strip().replace("\n", "\n   "))
        if r.returncode != 0:
            sagen("   Sicherung schlug fehl — ABBRUCH, es faellt nichts.")
            return 1

        if zustand:
            sagen(f"2. {len(zustand)} nicht nachbaubare Altlast(en) ernten")
            r = subprocess.run([SICHERUNG, "--ernten"] + [t["pfad"] for t in zustand],
                               capture_output=True, text=True)
            sagen("   " + (r.stdout or r.stderr).strip().replace("\n", "\n   "))
            if r.returncode != 0:
                sagen("   Ernte schlug fehl — ABBRUCH, es faellt nichts.")
                return 1
        else:
            sagen("2. nichts zu ernten")

    faellt = list(nachbaubar) + (list(zustand) if auch_zustand else [])
    sagen(f"3. {len(faellt)} Altlast(en), {mb(sum(t['bytes'] for t in faellt))}")
    weg = 0
    for t in faellt:
        sagen(f"   {'entfernt ' if wirklich else 'faellt   '} {t['pfad']}")
        if wirklich:
            try:
                if t["typ"] == "d":
                    shutil.rmtree(t["pfad"])
                else:
                    os.remove(t["pfad"])
                weg += 1
            except OSError as e:
                sagen(f"   ! ging nicht: {e}")
    if rueckweg:
        sagen(f"\n{len(rueckweg)} Stueck bleiben als RUECKWEG der letzten "
              f"Auslieferung liegen ({mb(sum(t['bytes'] for t in rueckweg))}, "
              "je Stamm das juengste — [[ausliefern-regeln]]):")
        for t in rueckweg:
            sagen(f"   bleibt  {t['pfad']}")
    if not auch_zustand and zustand:
        sagen(f"\n{len(zustand)} Box-Zustands-Altlast(en) bleiben LIEGEN "
              f"({mb(sum(t['bytes'] for t in zustand))}) — geerntet sind sie, "
              "aber ihr Wegfall ist eine Entscheidung des Betreibers "
              "(--auch-zustand).")
        for t in zustand:
            sagen(f"   bleibt  {t['pfad']}")
    if unklar:
        sagen(f"\n{len(unklar)} nicht eingeordnete Altlast(en) bleiben liegen:")
        for t in unklar:
            sagen(f"   bleibt  {t['pfad']}  ({t['warum']})")
    if not wirklich:
        sagen("\nTROCKEN — nichts entfernt. Mit --wirklich noch einmal.")
    else:
        os.sync()
        sagen(f"\n{weg} entfernt.")
    return 0


# ── Selbsttest ─────────────────────────────────────────────────────────────
def selbsttest() -> int:
    ok = bad = 0

    def chk(name, bedingung):
        nonlocal ok, bad
        print(("  OK    " if bedingung else "  FEHLT ") + name)
        ok += bool(bedingung)
        bad += (not bedingung)

    # ── Erkennen: die Sippen, die auf der Box wirklich vorkommen.
    for name, erwartet in [
        ("server.js.vor-20260726-1939", "datiert-vor"),
        ("www.vor-20260804-1830", "datiert-vor"),
        ("mupiboxconfig.json.bak-20260726-223629", "datiert-bak"),
        ("data.json.vor-titelputz-20260804T222712", "datiert-vor"),
        ("bt-reconnect.py.vor-adapterwahl", "benannt-vor"),
        ("data-vor-aufraeumen-2026-08-03T15-58-17.json", "aufraeumen"),
        ("data.json.bak", "bak"),
        ("server.js.alt", "alt"),
        ("www.mein-bau-1", "mein-bau"),
        ("www.vor-2026-08-01.tgz", "tgz"),
    ]:
        chk(f"«{name}» -> {erwartet}", sippe(name) == erwartet)

    # ── Und was KEINE Altlast ist. Der teuerste Fehler waere hier ein
    #    falsch-positiver: eine LAUFENDE Datei als Altlast einzuordnen.
    for name in ["server.js", "data.json", "mupiboxconfig.json", "www",
                 "resume.json", "mupi-lautstaerke.sh", "vorlesen.json",
                 "akkuverlauf.json", "gespielt.gast.json"]:
        chk(f"«{name}» ist KEINE Altlast", sippe(name) is None)

    # Grenzfaelle, an denen ein zu gieriges Muster eine echte Datei frisst.
    chk("«vorlesen.json» wird nicht wegen «vor» erwischt", sippe("vorlesen.json") is None)
    chk("«vorher.json» wird nicht erwischt", sippe("vorher.json") is None)
    chk("«.vorher» dagegen schon", sippe("konfig.vorher") == "benannt-vor")
    chk("«altersfreigabe.json» wird nicht wegen «alt» erwischt",
        sippe("altersfreigabe.json") is None)

    # ── Der Stamm — er entscheidet ueber die Spalte.
    chk("Stamm von server.js.vor-20260726-1939",
        stamm("server.js.vor-20260726-1939") == "server.js")
    chk("Stamm von www.vor-20260804-1830", stamm("www.vor-20260804-1830") == "www")
    chk("Stamm von mupiboxconfig.json.bak-20260726-223629",
        stamm("mupiboxconfig.json.bak-20260726-223629") == "mupiboxconfig.json")

    # ── Die Einordnung. HIER haengt das Loeschen dran.
    def sp(p):
        return einordnen(p, p.rsplit("/", 1)[-1])[0]

    chk("server.js-Sicherung ist nachbaubar",
        sp(BOX + "/server.js.vor-20260726-1939") == "nachbaubar")
    chk("www-Ordner ist nachbaubar", sp(BOX + "/www.vor-20260804-1830") == "nachbaubar")
    chk("www-admin ist nachbaubar", sp(BOX + "/www-admin.alt") == "nachbaubar")
    chk("ein .tgz ist nachbaubar", sp(BOX + "/www.vor-2026-08-01.tgz") == "nachbaubar")
    chk("spotify-control.js ist nachbaubar",
        sp(BOX + "/spotify-control.js.vor-mpv") == "nachbaubar")

    chk("mupiboxconfig-Fassung ist BOXZUSTAND, nicht nachbaubar",
        sp("/etc/mupibox/mupiboxconfig.json.bak-20260726-223629") == "boxzustand")
    chk("data.json-Fassung ist BOXZUSTAND",
        sp(BOX + "/server/config/data.json.bak") == "boxzustand")
    chk("data-vor-aufraeumen ist BOXZUSTAND",
        sp(BOX + "/server/config/data-vor-aufraeumen-2026-08-03T15-58-17.json")
        == "boxzustand")
    chk("resume-Fassung ist BOXZUSTAND",
        sp(BOX + "/server/config/resume.json.vor-messung-20260806") == "boxzustand")

    chk("ein ausgeliefertes Skript ist UNKLAR und bleibt liegen",
        sp("/usr/local/bin/mupibox/mupi-lautstaerke.sh.vor-20260801-1822") == "unklar")
    chk("ein Werkzeug in /opt ist UNKLAR",
        sp("/opt/mupibox-tools/bt-reconnect.py.vor-adapterwahl") == "unklar")
    chk("eine systemd-Beigabe ist UNKLAR",
        sp("/etc/systemd/system/getty@tty1.service.d/dietpi-autologin.conf.vor-kiosknutzer")
        == "unklar")

    # Die Verwechslung, die richtig teuer waere: eine Konfigurationsfassung,
    # die zufaellig .js im Namen traegt, darf NICHT als nachbaubar gelten.
    chk("server/config gewinnt gegen jede Endungs-Regel",
        sp(BOX + "/server/config/monitor.js.bak") == "boxzustand")

    # ── Der juengste bleibt: der Rueckweg der letzten Auslieferung.
    def t(pfad, wann):
        return {"pfad": pfad, "stamm": stamm(pfad.rsplit("/", 1)[-1]),
                "mtime": wann, "bytes": 0}

    menge = [t("/b/www.vor-1", 100), t("/b/www.vor-2", 300),
             t("/b/www.vor-3", 200), t("/b/server.js.alt", 50),
             t("/b/server.js.vor-x", 70)]
    faellt, bleibt = juengste_behalten(menge, 1)
    chk("je Stamm bleibt genau der JUENGSTE liegen",
        {b["pfad"] for b in bleibt} == {"/b/www.vor-2", "/b/server.js.vor-x"})
    chk("alles Aeltere faellt", len(faellt) == 3)
    chk("--je-stamm 0 laesst nichts liegen",
        juengste_behalten(menge, 0)[1] == [])
    chk("--je-stamm 2 laesst je Stamm zwei liegen",
        len(juengste_behalten(menge, 2)[1]) == 4)
    chk("ein einziger Stand faellt NIE (er waere der Rueckweg)",
        juengste_behalten([t("/b/www.alt", 1)], 1)[0] == [])

    print(f"\nAltlasten: {ok} bestanden, {bad} fehlgeschlagen")
    return 1 if bad else 0


def ueber_ssh(host: str, argv: list[str]) -> int:
    """Dasselbe Werkzeug, nur auf der Box ausgefuehrt."""
    ziel = host if "@" in host else f"dietpi@{host}"
    rest = [a for i, a in enumerate(argv[1:])
            if a != "--host" and (i == 0 or argv[i] != "--host")]
    subprocess.run(["scp", "-q", os.path.abspath(__file__),
                    f"{ziel}:/tmp/mupibox-altlasten.py"], check=True)
    return subprocess.run(["ssh", ziel, "python3 /tmp/mupibox-altlasten.py "
                           + " ".join(rest)]).returncode


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", action="store_true")
    p.add_argument("--wegraeumen", action="store_true")
    p.add_argument("--wirklich", action="store_true",
                   help="ohne dies wird nur gesagt, was faellt")
    p.add_argument("--auch-zustand", action="store_true",
                   help="auch die nicht nachbaubaren Altlasten entfernen "
                        "(nur nach erfolgreicher Ernte)")
    p.add_argument("--je-stamm", type=int, default=1, metavar="N",
                   help="je Stamm (www, server.js, …) die N juengsten liegen "
                        "lassen — sie sind der Rueckweg der letzten "
                        "Auslieferung (Vorgabe 1, 0 = alles faellt)")
    p.add_argument("--host", help="auf einer anderen Box ausfuehren (ueber ssh)")
    p.add_argument("--selbsttest", action="store_true")
    a = p.parse_args(argv[1:])

    if a.selbsttest:
        return selbsttest()
    if a.host:
        return ueber_ssh(a.host, argv)

    treffer = sammeln()
    if a.json:
        print(json.dumps(treffer, indent=2, ensure_ascii=False))
        return 0
    if a.wegraeumen:
        return wegraeumen(treffer, a.auch_zustand, a.wirklich, a.je_stamm)

    nach_spalte = defaultdict(list)
    nach_sippe = defaultdict(list)
    nach_ort = defaultdict(list)
    for t in treffer:
        nach_spalte[t["spalte"]].append(t)
        nach_sippe[t["sippe"]].append(t)
        nach_ort[t["pfad"].rsplit("/", 1)[0]].append(t)

    print(f"beiseite gelegt   {len(treffer)}")
    print(f"zusammen          {mb(sum(t['bytes'] for t in treffer))}")
    print("\nnach Spalte  (nur «nachbaubar» darf ohne Rueckfrage fallen)")
    for k in ("nachbaubar", "boxzustand", "unklar"):
        ts = nach_spalte.get(k, [])
        print(f"  {k:<12} {len(ts):>3}  {mb(sum(t['bytes'] for t in ts)):>10}")
    print("\nnach Sippe")
    for k, ts in sorted(nach_sippe.items(), key=lambda kv: -len(kv[1])):
        print(f"  {k:<16} {len(ts):>3}  {mb(sum(t['bytes'] for t in ts)):>10}")
    print("\nnach Ort")
    for ort, ts in sorted(nach_ort.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(ts):>3}  {mb(sum(t['bytes'] for t in ts)):>10}  {ort}")
    print("\nWas NICHT ohne Rueckfrage faellt")
    for t in treffer:
        if t["spalte"] != "nachbaubar":
            print(f"  {t['spalte']:<11} {t['pfad']}\n              {t['warum']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
