#!/usr/bin/env python3
"""Die Standwache durchspielen — jeder Fall, ohne dass eine Box in der Naehe ist.

══ WOZU ════════════════════════════════════════════════════════════════════
`scripts/box/mupibox-standwache.py` ist ein Automat, der von selbst am
Betriebsstand dreht. Der Satz „ich habe es gebaut, es sieht richtig aus" ist
dafuer zu wenig — bei einem Totmannschalter faellt jeder Fehler genau dann auf,
wenn ohnehin schon etwas kaputt ist.

Dieses Werkzeug setzt eine NACHGESTELLTE WELT ein (die Naht `Welt` in der
Standwache) und spielt damit die Faelle durch, die man an einer echten Box
nicht herbeifuehren kann, ohne sie kaputtzumachen:

    Neustartschleife · abgerissene Auslieferung · Uhr springt vorwaerts ·
    Uhr springt rueckwaerts · systemd antwortet nicht · Box startet mitten in
    der Frist neu · Erholung nach zwei schlechten Blicken · Tauscher fehlt

Es wird dabei NICHTS geschrieben, NICHTS neu gestartet und NICHTS getauscht:
die nachgestellte Welt haelt ihre Dateien im Speicher und schreibt jede
Handlung nur in eine Liste.

══ DER LETZTE TEIL IST ECHT ════════════════════════════════════════════════
Teil B ruft den WIRKLICHEN `mupibox-tauscher.py` auf — auf Wegwerfdateien in
einem Wegwerfordner. Das ist der Unterschied zwischen „die Entscheidung stimmt"
und „der Rueckweg funktioniert". Die Entscheidungslogik liesse sich beliebig
gruen testen, waehrend der Aufruf daneben ins Leere ginge.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/standwache-nachgestellt.py        # Ende 0 = alles gruen
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
WACHE_PFAD = WURZEL / "scripts" / "box" / "mupibox-standwache.py"
TAUSCHER_PFAD = WURZEL / "scripts" / "box" / "mupibox-tauscher.py"

# ── DER RIEGEL, BEVOR IRGENDETWAS GELADEN WIRD ──────────────────────────────
#
# HAUSREGEL: Was am Geraet dreht, braucht eine benannte Naht UND einen
# Umgebungsriegel. Die Naht ist `NachgestellteWelt` weiter unten. Der Riegel
# ist diese Zeile — und sie steht VOR dem Laden, nicht daneben:
# Wuerde ein Fehler in diesem Test doch einmal die ECHTE `Welt` bauen, koennte
# sie trotzdem weder `systemctl restart` noch den Tauscher ausfuehren.
os.environ["MUPIBOX_STANDWACHE_NIE_HANDELN"] = "1"

_spec = importlib.util.spec_from_file_location("standwache", WACHE_PFAD)
w = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(w)

ergebnis: list[tuple[str, bool, str]] = []


def chk(name: str, bedingung, hinweis: str = "") -> None:
    ergebnis.append((name, bool(bedingung), hinweis))


# ══ DIE NACHGESTELLTE WELT ══════════════════════════════════════════════════
class NachgestellteWelt(w.Welt):
    """Alles im Speicher. Uhr, Laufzeit und systemd sind von aussen stellbar."""

    def __init__(self, uhr=1000.0, laufzeit=3600.0, boot="boot-A"):
        super().__init__(reden=self.merken)
        self.uhr = uhr
        self._laufzeit = laufzeit
        self.boot = boot
        self.dateien: dict[str, object] = {}
        self.dienste: dict[str, dict] = {}
        self.antworten: dict[str, tuple[int, str]] = {}
        self.getan: list[tuple] = []
        self.gesagt: list[str] = []
        self.verlauf: list[dict] = []

    # -- Protokoll statt Ausgabe --
    def merken(self, *teile) -> None:
        self.gesagt.append(" ".join(str(t) for t in teile))

    # -- Uhren --
    def jetzt(self):
        return self.uhr

    def laufzeit(self):
        return self._laufzeit

    def boot_id(self):
        return self.boot

    def warte(self, s):
        # Der Abstand zwischen den zwei Dienstblicken. Hier kostet er nichts —
        # aber er RUECKT DIE UHR VOR, damit ein Dienst, der sich zwischen den
        # Blicken bewegen soll, das auch kann.
        self.uhr += s
        for d, z in self.dienste.items():
            if z.get("schleife"):
                z["kennung"] = [str(int(z["kennung"][0]) + 1), str(int(z["kennung"][1]) + 7)]

    # -- Messen --
    def dienst_zustand(self, dienst):
        z = self.dienste.get(dienst)
        if z is None or not z.get("messbar", True):
            return {"messbar": False, "roh": "nachgestellt: nicht messbar"}
        return {"messbar": True, "aktiv": z["aktiv"], "kennung": list(z["kennung"]),
                "roh": f"ActiveState={'active' if z['aktiv'] else 'failed'} "
                       f"NRestarts={z['kennung'][0]}"}

    def http(self, pfad):
        return self.antworten.get(pfad, (0, ""))

    # -- Dateien (im Speicher) --
    def lies(self, pfad):
        wert = self.dateien.get(pfad)
        return json.loads(json.dumps(wert)) if wert is not None else None

    def schreib(self, pfad, inhalt):
        self.dateien[pfad] = json.loads(json.dumps(inhalt))

    def entferne(self, pfad):
        self.dateien.pop(pfad, None)

    def da(self, pfad):
        return pfad in self.dateien

    def anhaengen(self, pfad, satz):
        self.verlauf.append(satz)

    # -- Handeln: NUR aufschreiben --
    def zurueckdrehen(self, ziele, tauscher):
        self.getan.append(("zurueckdrehen", [z["name"] for z in ziele], tauscher))
        return {"zurueck": [z["name"] for z in ziele], "fehler": [],
                "ohne_rueckweg": [], "ohne_wirkung": []}

    def dienste_neustarten(self, dienste):
        self.getan.append(("neustart", list(dienste)))
        return True, "nachgestellt"


def welt_mit_frist(**anders) -> NachgestellteWelt:
    """Eine Box mit einer frisch gestellten Frist: Server getauscht, Dienst
    laeuft, aber noch mit der Kennung von VOR dem Tausch."""
    welt = NachgestellteWelt(**anders)
    welt.dienste["mupibox-server.service"] = {"aktiv": True, "kennung": ["0", "100"]}
    welt.antworten["/api/oberflaeche/stand"] = (200, '{"stand":"main-NEU.js"}')
    welt.antworten["/"] = (200, "<script src=main-NEU.js>")
    welt.dateien[w.TAUSCHER_MIT] = {"tut": "so"}
    w.stellen(welt, {
        "von": "test", "stempel": "T1", "frist_s": 600,
        "ziele": [{"name": "server", "art": "datei", "ziel": "/x/server.js",
                   "zurueck": "/x/server.js.zurueck"}],
        "dienste": ["mupibox-server.service"],
        "dienste_vorher": {"mupibox-server.service": ["0", "100"]},
        "wirkung": [{"pfad": "/", "hat": "main-NEU.js"},
                    {"pfad": "/api/oberflaeche/stand", "hat": ""}],
    })
    return welt


def neustart_vollzogen(welt: NachgestellteWelt) -> None:
    """Der Dienst wurde neu gestartet und laeuft — die Kennung hat sich bewegt."""
    welt.dienste["mupibox-server.service"]["kennung"] = ["0", "999"]


# ══ A. DIE ENTSCHEIDUNG — jeder Fall einzeln ════════════════════════════════
print("A  Die Entscheidung")

# A1 Ohne Frist geschieht nichts.
leer = NachgestellteWelt()
chk("ohne Frist: rc 0 und nichts getan", w.nachsehen(leer) == 0 and not leer.getan)

# A2 Waehrend des Hochfahrens wird nicht geurteilt — auch nicht bei totem Dienst.
boot = welt_mit_frist(laufzeit=30.0)
boot.dienste["mupibox-server.service"]["aktiv"] = False
boot.uhr += 100000            # Frist laengst um
w.nachsehen(boot)
chk("waehrend des Hochfahrens wird nicht gedreht", not boot.getan,
    "sonst faellt jede Box beim Start ihrer eigenen Wache zum Opfer")
chk("  und die Frist bleibt stehen", w.SCHWEBEND in boot.dateien)

# A3 Alles heil UND neu gestartet → entwarnen, Frist weg.
gut = welt_mit_frist()
neustart_vollzogen(gut)
rc = w.nachsehen(gut)
chk("heil und neu gestartet: entwarnt", rc == 0 and not gut.getan)
chk("  die Frist ist verbraucht", w.SCHWEBEND not in gut.dateien)
chk("  der mitgestellte Tauscher ist mit weggeraeumt", w.TAUSCHER_MIT not in gut.dateien)
chk("  und im Verlauf steht 'entwarnt'",
    gut.verlauf and gut.verlauf[-1]["wie"] == "entwarnt")

# A4 DER GEMEINE FALL: heil, aber der Neustart steht noch aus.
#    So sieht es 20 s nach dem Tausch aus, bevor `ausliefern.py` neu startet —
#    und genau hier waere ein vorschneller Freispruch toedlich.
frueh = welt_mit_frist()
w.nachsehen(frueh)
chk("heil, aber Neustart steht aus: NICHT entwarnt", w.SCHWEBEND in frueh.dateien,
    "der alte Prozess mit dem alten Code darf keinen Freispruch begruenden")
chk("  und auch nicht gedreht", not frueh.getan)

# A5 Derselbe Zustand nach Ablauf der Frist → zurueckdrehen.
#    (Das ist der abgerissene Lauf: getauscht, nie neu gestartet.)
abriss = welt_mit_frist()
rcs = []
for _ in range(4):
    abriss.uhr += 700
    rcs.append(w.nachsehen(abriss))
chk("abgerissene Auslieferung: wird zurueckgedreht", 3 in rcs,
    f"rcs={rcs}, getan={abriss.getan}")
chk("  der Tauscher wurde gerufen",
    any(t[0] == "zurueckdrehen" for t in abriss.getan))
chk("  und die Dienste neu gestartet",
    any(t[0] == "neustart" for t in abriss.getan))

# A6 Nicht nach EINER schlechten Messung.
einmal = welt_mit_frist()
neustart_vollzogen(einmal)
einmal.dienste["mupibox-server.service"]["aktiv"] = False
einmal.uhr += 5000            # Frist um, aber erst ein Blick
rc = w.nachsehen(einmal)
chk("Frist um, aber erst eine schlechte Messung: noch nicht drehen",
    rc == 0 and not einmal.getan)

# A7 Neustartschleife: meldet zwischendurch `active` — zaehlt trotzdem nicht.
schleife = welt_mit_frist()
neustart_vollzogen(schleife)
schleife.dienste["mupibox-server.service"]["schleife"] = True
rcs = []
for _ in range(5):
    schleife.uhr += 200
    rcs.append(w.nachsehen(schleife))
chk("Neustartschleife wird erkannt und gedreht", 3 in rcs, f"rcs={rcs}")
chk("  obwohl der Dienst durchgehend 'active' meldete",
    schleife.dienste["mupibox-server.service"]["aktiv"] is True)

# A8 Nicht messbar: NIE drehen, egal wie lange.
blind = welt_mit_frist()
blind.dienste["mupibox-server.service"]["messbar"] = False
for _ in range(30):
    blind.uhr += 700
    w.nachsehen(blind)
chk("nicht messbar: es wird NIE gedreht", not blind.getan,
    "sonst dreht ein Netzhaenger den Betriebsstand zurueck")
chk("  die Frist schwebt weiter", w.SCHWEBEND in blind.dateien)
chk("  und die unmessbaren Blicke sind gezaehlt",
    blind.dateien[w.SCHWEBEND]["unmessbar"] == 30)

# A9 Uhr springt RUECKWAERTS (NTP nach dem Start, Frist rechnerisch nie um).
#    Der Laufzaehler muss trotzdem ausloesen.
rueck = welt_mit_frist()
neustart_vollzogen(rueck)
rueck.dienste["mupibox-server.service"]["aktiv"] = False
rueck.dateien[w.SCHWEBEND]["frist_bis"] = 10 ** 12   # in ferner Zukunft
rcs = []
for _ in range(20):
    rcs.append(w.nachsehen(rueck))
chk("Uhr rueckwaerts: der Laufzaehler loest aus", 3 in rcs, f"rcs={rcs}")
chk("  und zwar wegen des Laufzaehlers, nicht der Uhr",
    any("Laufzaehler" in z for z in rueck.gesagt))

# A10 Uhr springt VORWAERTS: die drei Messungen bleiben trotzdem noetig.
vor = welt_mit_frist()
neustart_vollzogen(vor)
vor.dienste["mupibox-server.service"]["aktiv"] = False
vor.uhr += 10 ** 6
rc1 = w.nachsehen(vor)
rc2 = w.nachsehen(vor)
rc3 = w.nachsehen(vor)
chk("Uhr vorwaerts: nicht beim ersten Blick", rc1 == 0 and rc2 == 0)
chk("  aber beim dritten", rc3 == 3, f"rc3={rc3}")

# A11 Erholung: zwei schlechte Blicke, dann wieder gut → Zaehler faellt zurueck.
erholt = welt_mit_frist()
neustart_vollzogen(erholt)
erholt.dienste["mupibox-server.service"]["aktiv"] = False
erholt.uhr += 5000
w.nachsehen(erholt)
w.nachsehen(erholt)
chk("zwei schlechte Blicke sind gezaehlt",
    erholt.dateien[w.SCHWEBEND]["unbewiesen"] == 2)
erholt.dienste["mupibox-server.service"]["aktiv"] = True
rc = w.nachsehen(erholt)
chk("wieder gut: entwarnt statt gedreht", rc == 0 and not erholt.getan)
chk("  die Frist ist verbraucht", w.SCHWEBEND not in erholt.dateien)

# A12 Keine Schaukel: eine verbrauchte Frist wird nicht wiederbelebt.
schaukel = welt_mit_frist()
neustart_vollzogen(schaukel)
schaukel.dienste["mupibox-server.service"]["aktiv"] = False
for _ in range(6):
    schaukel.uhr += 700
    w.nachsehen(schaukel)
gedreht = sum(1 for t in schaukel.getan if t[0] == "zurueckdrehen")
chk("hoechstens EIN Rueckdrehen je Frist", gedreht == 1, f"{gedreht}-mal gedreht")

# A13 Die Wirkung zaehlt, nicht HTTP 200.
alt = welt_mit_frist()
neustart_vollzogen(alt)
alt.antworten["/"] = (200, "<script src=main-ALT.js>")   # antwortet, aber falsch
alt.uhr += 5000
for _ in range(3):
    rc = w.nachsehen(alt)
chk("HTTP 200 mit ALTEM Buendel gilt als nicht in Ordnung", rc == 3, f"rc={rc}")
chk("  und die Meldung nennt den fehlenden Namen",
    any("main-NEU.js" in z and "NICHT" in z for z in alt.gesagt))

stumm = welt_mit_frist()
neustart_vollzogen(stumm)
stumm.antworten["/"] = (0, "")                            # gar keine Antwort
stumm.uhr += 5000
for _ in range(3):
    rc = w.nachsehen(stumm)
chk("keine Antwort gilt als nicht in Ordnung (nicht als 'unmessbar')", rc == 3)

# A14 Box startet mitten in der Frist neu: die Kennungen zaehlen von vorn, und
#     „der Neustart steht aus" darf dann nicht mehr bremsen.
gebootet = welt_mit_frist()
gebootet.boot = "boot-B"
gebootet._laufzeit = 300.0
rc = w.nachsehen(gebootet)
chk("nach einem Neustart der Box: entwarnt statt ewig zu warten",
    rc == 0 and w.SCHWEBEND not in gebootet.dateien,
    "nach dem Booten laeuft der Dienst zwangslaeufig mit dem neuen Stand")

# A15 Fehlt der Tauscher, wird die Frist NICHT verbraucht.
ohne = welt_mit_frist()
neustart_vollzogen(ohne)
ohne.dienste["mupibox-server.service"]["aktiv"] = False
del ohne.dateien[w.TAUSCHER_MIT]
rcs = []
for _ in range(5):
    ohne.uhr += 700
    rcs.append(w.nachsehen(ohne))
chk("ohne Tauscher: rc 4 und die Frist bleibt stehen",
    4 in rcs and w.SCHWEBEND in ohne.dateien, f"rcs={rcs}")
chk("  es wurde nichts gedreht", not ohne.getan)

# A16 --probe fasst nichts an, nicht einmal den Zaehler.
probe = welt_mit_frist()
vorher = json.dumps(probe.dateien[w.SCHWEBEND], sort_keys=True)
w.nachsehen(probe, trocken=True)
chk("--probe laesst auch die Zaehler in Ruhe",
    json.dumps(probe.dateien[w.SCHWEBEND], sort_keys=True) == vorher)

# A17 --jetzt-zurueck dreht auch eine gesunde Box zurueck (der Mensch hat
#     entschieden) — und misst trotzdem, damit der Befund im Verlauf steht.
hand = welt_mit_frist()
neustart_vollzogen(hand)
rc = w.nachsehen(hand, erzwingen=True)
chk("--jetzt-zurueck dreht auch bei gutem Befund", rc == 3 and hand.getan,
    f"rc={rc}, getan={hand.getan}")
chk("  und der gute Befund steht im Verlauf",
    hand.verlauf and any("in Ordnung" in z for z in hand.verlauf[-1].get("befund", [])))

# A18 Die Frist wird in ihre Grenzen gezwungen.
grenz = NachgestellteWelt()
f = w.stellen(grenz, {"ziele": [{"name": "x"}], "frist_s": 5})
chk("zu kurze Frist wird angehoben", f["frist_s"] == w.FRIST_MIN)
f = w.stellen(grenz, {"ziele": [{"name": "x"}], "frist_s": 99999})
chk("zu lange Frist wird gekappt", f["frist_s"] == w.FRIST_MAX)

# A19 Ohne Dienst und ohne Wirkung (Ziel `herkunft`) gibt es nichts, was
#     kaputtgehen kann — es wird sofort entwarnt statt ewig gewartet.
stumpf = NachgestellteWelt()
stumpf.dateien[w.TAUSCHER_MIT] = {}
w.stellen(stumpf, {"ziele": [{"name": "herkunft"}], "dienste": [], "wirkung": []})
rc = w.nachsehen(stumpf)
chk("Ziel ohne Dienst und ohne Wirkung: sofort entwarnt",
    rc == 0 and w.SCHWEBEND not in stumpf.dateien)


# ══ B. DER RUECKWEG — mit dem ECHTEN Tauscher auf Wegwerfdateien ════════════
print("B  Der Rueckweg (echter Tauscher, Wegwerfordner)")


def echter_rueckweg() -> None:
    with tempfile.TemporaryDirectory() as t:
        ort = pathlib.Path(t)
        # Eine Datei wie `server.js` und ein Baum wie `www` — beide Arten.
        (ort / "server.js").write_text("NEU-und-kaputt\n")
        (ort / "server.js.zurueck").write_text("ALT-und-heil\n")
        (ort / "www").mkdir()
        (ort / "www" / "index.html").write_text("neu\n")
        (ort / "www.zurueck").mkdir()
        (ort / "www.zurueck" / "index.html").write_text("alt\n")

        ziele = [
            {"name": "server", "art": "datei", "ziel": str(ort / "server.js"),
             "zurueck": str(ort / "server.js.zurueck")},
            {"name": "www", "art": "baum", "ziel": str(ort / "www"),
             "zurueck": str(ort / "www.zurueck")},
        ]
        # Genau der Aufruf, den die Standwache macht — die ECHTE Welt, nur mit
        # gelockertem Riegel, weil hier nichts Betriebliches beruehrt wird.
        umg = dict(os.environ)
        umg.pop("MUPIBOX_STANDWACHE_NIE_HANDELN", None)
        p = subprocess.run(
            [sys.executable, str(TAUSCHER_PFAD), "zurueckdrehen"],
            input=json.dumps({"ziele": ziele}), capture_output=True, text=True,
            timeout=120, env=umg)
        chk("der echte Tauscher laeuft durch", p.returncode == 0,
            (p.stderr or p.stdout)[:300])
        if p.returncode != 0:
            return
        befund = json.loads(p.stdout)
        chk("  er meldet beide Ziele zurueckgedreht",
            sorted(befund["zurueck"]) == ["server", "www"], str(befund))
        chk("  die Datei traegt wieder den ALTEN Inhalt",
            (ort / "server.js").read_text() == "ALT-und-heil\n")
        chk("  der Baum auch",
            (ort / "www" / "index.html").read_text() == "alt\n")
        chk("  und der Rueckweg haelt jetzt den neuen Stand (fuehrt in BEIDE "
            "Richtungen)",
            (ort / "server.js.zurueck").read_text() == "NEU-und-kaputt\n"
            and (ort / "www.zurueck" / "index.html").read_text() == "neu\n")


def riegel_haelt() -> None:
    """Der Umgebungsriegel: die ECHTE Welt darf mit gesetzter Variable weder
    den Tauscher rufen noch einen Dienst neu starten."""
    echt = w.Welt(reden=lambda *_: None)
    befund = echt.zurueckdrehen([{"name": "x"}], "/bin/false")
    chk("Riegel: zurueckdrehen tut nichts", befund["fehler"] == ["gesperrt"],
        str(befund))
    ok, meldung = echt.dienste_neustarten(["irgendein.service"])
    chk("Riegel: Neustart tut nichts", not ok and meldung == "gesperrt")
    # Ohne Dienste ist auch ohne Riegel nichts zu tun — das darf nicht als
    # Fehler durchgehen.
    ok2, _ = echt.dienste_neustarten([])
    chk("Riegel: leere Dienstliste bleibt in Ordnung", ok2)


def wache_ist_ausfuehrbar() -> None:
    """Ohne Frist muss `--nachsehen` auch als eigenes Programm sauber enden."""
    p = subprocess.run([sys.executable, str(WACHE_PFAD), "--stand"],
                       capture_output=True, text=True, timeout=60)
    chk("--stand laeuft als Programm und liefert JSON",
        p.returncode == 0 and json.loads(p.stdout).get("schwebt") in (True, False),
        (p.stderr or p.stdout)[:200])


echter_rueckweg()
riegel_haelt()
wache_ist_ausfuehrbar()


# ══ C. IST SIE AUCH ANGESCHLOSSEN? ══════════════════════════════════════════
#
# GENAU DIESE FRAGE HAT AM 09.08.2026 GEFEHLT: der Windows-Zweig des
# Karteninstallers war gebaut, geprueft und richtig — und `sdstart.py` rief ihn
# nie auf. Eine Naht kann tadellos sein und trotzdem im Leeren haengen.
# Deshalb wird hier nicht die Wache geprueft, sondern ihre ANSCHLUESSE.
print("C  Die Anschluesse (Quelltext, ohne etwas zu starten)")

AUSLIEFERN = (WURZEL / "tools" / "ausliefern.py").read_text(encoding="utf-8")
AUTOSETUP = (WURZEL / "autosetup" / "autosetup.sh").read_text(encoding="utf-8")
UNIT = (WURZEL / "config" / "services" / "mupibox-standwache.service").read_text(encoding="utf-8")
TIMER = (WURZEL / "config" / "services" / "mupibox-standwache.timer").read_text(encoding="utf-8")

# ── NICHT MIT `in` SUCHEN. GEGENGEPROBT, UND ES WAR ZU WENIG. ───────────────
#
# Hier stand `chk(..., "wache_stellen(b, box," in AUSLIEFERN)`. Beim
# Gegenprobieren (den Aufruf auskommentieren und schauen, ob der Test rot wird)
# blieb er GRUEN: die auskommentierte Zeile enthaelt die Zeichenkette ja
# weiterhin. Ein Anschlusstest, der einen abgeklemmten Anschluss nicht bemerkt,
# ist genau die Sorte Gruen, die nichts wert ist.
#
# Also ueber den SYNTAXBAUM: Python sagt selbst, wo ein Aufruf steht und in
# welcher Zeile. Ein Kommentar kommt dort nicht vor.
import ast                                                        # noqa: E402

BAUM = ast.parse(AUSLIEFERN)


def aufrufzeilen(name: str) -> list[int]:
    return sorted(k.lineno for k in ast.walk(BAUM)
                  if isinstance(k, ast.Call) and isinstance(k.func, ast.Name)
                  and k.func.id == name)


def zeile_mit(text: str, ab: int = 0) -> int:
    """1-basierte Zeilennummer der ersten Zeile, die `text` enthaelt und KEIN
    Kommentar ist."""
    for nr, z in enumerate(AUSLIEFERN.splitlines()[ab:], start=ab + 1):
        if text in z and not z.lstrip().startswith("#"):
            return nr
    return -1


z_stellen = aufrufzeilen("wache_stellen")
z_entwarnen = aufrufzeilen("wache_entwarnen")
chk("ausliefern.py ruft wache_stellen wirklich auf", len(z_stellen) == 1,
    f"gefunden in Zeilen {z_stellen}")
chk("ausliefern.py ruft wache_entwarnen zweimal auf (heil + von Hand)",
    len(z_entwarnen) == 2, f"gefunden in Zeilen {z_entwarnen}")

# DIE REIHENFOLGE IST DIE HALBE SACHE. Wird erst neu gestartet und dann die
# Frist gestellt, sind die gemerkten Dienstkennungen schon die NEUEN — und die
# Wache koennte nie mehr unterscheiden, ob der Neustart stattgefunden hat.
z_restart = zeile_mit('systemctl restart " + " ".join(dienste), zeitlimit=180')
chk("die Frist wird VOR dem Neustart gestellt",
    z_stellen and z_restart > 0 and z_stellen[0] < z_restart,
    f"stellen={z_stellen}, Neustart={z_restart}")

# UND DER RUECKWEG VON HAND MUSS SIE ABRAEUMEN. Sonst dreht die Wache spaeter
# ein zweites Mal — und weil der Rueckweg in beide Richtungen fuehrt, laege
# danach wieder der Stand da, den man weggedreht hat.
#
# DER ANKER IST HIER SCHON EINMAL DANEBENGEGANGEN: `b.schritt("—",
# "Zurueckdrehen` steht ZWEIMAL in der Datei — einmal in `skripte_zurueckdrehen`
# und einmal im Zweig, um den es geht. Deshalb jetzt die eindeutige
# Zeichenkette als Anfang und der naechste `b.schritt(` als Ende.
z_hand = zeile_mit("Zurueckdrehen: die eine Rueckdreh-Erzeugung wieder einsetzen")
z_hand_ende = zeile_mit("b.schritt(", z_hand)
chk("--zurueckdrehen raeumt die Frist ab",
    any(z_hand < z < z_hand_ende for z in z_entwarnen),
    f"Zweig {z_hand}–{z_hand_ende}, entwarnt in {z_entwarnen}")
chk("  und der gepruefte Abschnitt ist wirklich nur dieser Zweig",
    0 < z_hand_ende - z_hand < 80,
    "ein zu weiter Abschnitt macht die Pruefung darueber wertlos")


def sh_zeile(text: str) -> bool:
    """Steht der Befehl in autosetup.sh WIRKLICH da — oder nur im Kommentar?
    Dieselbe Falle wie oben, nur ohne Syntaxbaum: die Shell hat keinen, also
    wird die Zeile selbst angesehen."""
    return any(text in z and not z.lstrip().startswith("#")
               for z in AUTOSETUP.splitlines())


chk("die Unit ruft den Pfad auf, an den autosetup legt",
    "/opt/mupibox-tools/mupibox-standwache.py --nachsehen" in UNIT)
chk("autosetup legt scripts/box/* nach /opt/mupibox-tools",
    sh_zeile("mv ${MUPI_SRC}/scripts/box/* /opt/mupibox-tools/"))
chk("autosetup legt beide Units an",
    sh_zeile("config/services/mupibox-standwache.service")
    and sh_zeile("config/services/mupibox-standwache.timer"))
chk("autosetup schaltet den Zeitgeber ein",
    sh_zeile("systemctl enable mupibox-standwache.timer"),
    "eine Frist, die niemand abwartet, ist schlimmer als keine")
chk("autosetup legt /var/lib/mupibox/stand an",
    sh_zeile("install -d -m 755 -o root -g root /var/lib/mupibox/stand"))

# Der Takt des Zeitgebers und die Rechnung fuer `laeufe_max` gehoeren zusammen:
# `frist_s // 60 + 5` setzt einen Blick JE MINUTE voraus.
chk("der Zeitgeber fragt im Minutentakt", "OnUnitActiveSec=60s" in TIMER,
    "laeufe_max = frist_s // 60 + 5 rechnet mit genau diesem Takt")
chk("und faengt erst nach der Startkarenz an",
    "OnBootSec=150s" in TIMER and w.START_KARENZ == 120)

chk("die Wache ist ausfuehrbar", os.access(WACHE_PFAD, os.X_OK),
    "sonst scheitert ExecStart mit 203/EXEC")


# ══ D. DIE ECHTEN DATEIWEGE ═════════════════════════════════════════════════
#
# Teil A haelt alles im Speicher; Teil B prueft den Tauscher. Was dazwischen
# noch ungeprueft waere, ist das Schreiben und Lesen der Frist SELBST — und die
# steht ganz am Anfang der Rettungskette. Also einmal mit der ECHTEN `Welt`,
# auf Wegwerfdateien. (Der Riegel oben bleibt gesetzt; er sperrt nur das
# Drehen, nicht das Schreiben.)
print("D  Die echten Dateiwege")


def echte_dateien() -> None:
    with tempfile.TemporaryDirectory() as t:
        echt = w.Welt(reden=lambda *_: None)
        p = os.path.join(t, "tief", "schwebend.json")
        chk("vorher ist nichts da", not echt.da(p) and echt.lies(p) is None)
        echt.schreib(p, {"a": 1, "text": "Umlaute: ä ö ü"})
        chk("schreiben legt auch das Verzeichnis an", echt.da(p))
        chk("  und liest sich unveraendert zurueck",
            echt.lies(p) == {"a": 1, "text": "Umlaute: ä ö ü"})
        chk("  ohne Zwischendatei zurueckzulassen",
            not os.path.exists(p + ".neu"))
        v = os.path.join(t, "verlauf.jsonl")
        echt.anhaengen(v, {"wie": "eins"})
        echt.anhaengen(v, {"wie": "zwei"})
        chk("der Verlauf haengt an statt zu ueberschreiben",
            [json.loads(z)["wie"] for z in open(v)] == ["eins", "zwei"])
        echt.entferne(p)
        chk("entfernen raeumt weg", not echt.da(p))
        echt.entferne(p)          # zweimal darf nicht wehtun
        chk("  und zweimal entfernen wirft nicht", True)
        kaputt = os.path.join(t, "kaputt.json")
        open(kaputt, "w").write("{das ist kein JSON")
        chk("eine unlesbare Frist gilt als KEINE Frist (kein Absturz)",
            echt.lies(kaputt) is None,
            "eine halb geschriebene Datei darf die Wache nicht umbringen")


echte_dateien()

# ══ Urteil ══════════════════════════════════════════════════════════════════
schlecht = 0
for name, gut, hinweis in ergebnis:
    print(f"  {'ok  ' if gut else 'NEIN'} {name}"
          + (f"   — {hinweis}" if not gut and hinweis else ""))
    schlecht += 0 if gut else 1
print(f"\n{len(ergebnis)} Pruefungen, {schlecht} Abweichung(en)")
sys.exit(1 if schlecht else 0)
