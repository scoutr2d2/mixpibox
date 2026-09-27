#!/usr/bin/env python3
"""DER AUSSCHALTER, ADVERSARISCH GEGENGELESEN — die Faelle, die noch fehlten.

    python3 tools/ausschalter-gegenlesen.py
    python3 tools/ausschalter-gegenlesen.py --nur ton-reihenfolge
    python3 tools/ausschalter-gegenlesen.py --laut

══ WOZU NOCH EIN WERKZEUG ═══════════════════════════════════════════════════

`tools/ausschalter-sandkasten.py` (39 Aussagen) und
`tools/ausschalter-fehlausloesung.py` (69 Aussagen) sind gruen. Beide sind von
derselben Hand gebaut worden wie die Datei, die sie pruefen — und ein Pruefer
misst am ehesten das, woran sein Erbauer schon gedacht hat.

Dieses Werkzeug leiht sich deren Sandkasten (denselben Vorspann, denselben
nachgestellten Waechter, dieselbe unveraenderte `off_trigger.sh`) und stellt
NUR Fragen, die dort NICHT gestellt werden. Die Linse ist dieselbe wie dort:

    faehrt sie herunter, wenn sie nicht soll — oder nicht, wenn sie doch soll?

Was hier neu gefragt wird, und warum:

  ton-reihenfolge  Der Bestaetigungston steht in `off_trigger.sh` an ZWEITER
                   Stelle: davor sitzt das Zuruecksetzen der Lautstaerke, und
                   zwar in zwei Aufrufen mit je 3 s Frist (`mupi-lautstaerke.sh`
                   und, wenn das fehlschlaegt, `pactl`). Der Ton ist aber die
                   einzige Rueckmeldung, die der Mensch am Knopf bekommt — und
                   wer keine bekommt, HAELT LAENGER. Bei 6 s nimmt der MuPiHAT
                   den Strom hart weg. Also: wie lange dauert es bis zum Ton,
                   wenn davor etwas haengt?

  trommeln-schnell Die vorhandene Gruppe `takt` misst 100/100 ms bis
                   200/200 ms. Der Probentakt liegt bei 40 bis 90 ms; die
                   gefaehrliche Gegend ist also DARUNTER, nicht darueber.
                   Hier wird von 10/10 bis 90/30 ms getrommelt.

  nachzuegler      Waehrend der Halteschleife liest niemand die Roehre. Meldungen
                   des Waechters stauen sich darin. Faengt die naechste Frist
                   dann bei einem ALTEN „FLANKE" an, ist sie kuerzer als
                   eingestellt. Getippt und danach gehalten.

  wiederholung     Nach einem abgebrochenen Versuch muss der naechste noch
                   gehen. Ein Waechter, der nach dem ersten Fehlversuch taub
                   ist, faellt in keinem der obigen Faelle auf.

  langsames-jq     `press_delay_lesen` laeuft OHNE Frist zwischen der Flanke und
                   der Halteschleife. Was tut das Skript, wenn `jq` laenger
                   braucht als die ganze eingestellte Haltedauer?

  ohne-awk         Bruchzahlen werden mit `awk` aufgerundet. Fehlt `awk`, ist
                   `wert` leer — und eine leere Zahl vergleicht bash nicht.
                   Faehrt die Box dann noch herunter, wenn man haelt?
"""

from __future__ import annotations

import argparse
import importlib.util
import statistics
import sys
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Den Sandkasten als Modul holen — sein Dateiname hat einen Bindestrich, ein
# schlichtes `import` geht damit nicht.
_spec = importlib.util.spec_from_file_location(
    "ausschalter_sandkasten", WURZEL / "tools" / "ausschalter-sandkasten.py"
)
sk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sk)

SKRIPT = sk.SKRIPT


# ════ WERKZEUG ═══════════════════════════════════════════════════════════════


class Bericht:
    def __init__(self, laut=False):
        self.zeilen = []
        self.laut = laut

    def sagen(self, gut, name, text):
        self.zeilen.append((gut, name, text))
        print(("  OK   " if gut else "  ROT  ") + name + " — " + text, flush=True)

    def merkwuerdig(self, name, text):
        """Kein Urteil, nur eine Zahl, die jemand sehen soll."""
        self.zeilen.append((True, name, text))
        print("  ...  " + name + " — " + text, flush=True)

    @property
    def rot(self):
        return [z for z in self.zeilen if not z[0]]


class Lauf(sk.Lauf):
    """Wie der Lauf des Sandkastens, nur mit zwei zusaetzlichen Griffen.

    `vorspann_extra` wird HINTEN an den Vorspann gehaengt, ueberschreibt also
    Funktionen des Sandkastens fuer genau diesen einen Lauf — dasselbe
    Verfahren, mit dem der Sandkasten selbst seinen haengenden Dienst baut.

    `konf` ersetzt die Konfiguration ganz. Der Sandkasten schreibt sie mit
    `json.dumps`; hier wird dieser eine Aufruf umgebogen, statt seine `Lauf`
    aufzumachen. Das ist haesslich und es ist ehrlich: so bleibt die gepruefte
    Maschinerie ein einziges Mal im Baum, statt zweimal leicht verschieden.
    """

    def __init__(self, quelle, press_delay, *, vorspann_extra="", konf=None, **kw):
        alt_vorspann = sk.VORSPANN
        alt_dumps = sk.json.dumps
        if vorspann_extra:
            sk.VORSPANN = alt_vorspann + "\n" + vorspann_extra + "\n"
        if konf is not None:
            def dumps(obj, *a, **k):
                if isinstance(obj, dict) and "timeout" in obj:
                    return alt_dumps(konf, *a, **k)
                return alt_dumps(obj, *a, **k)
            sk.json.dumps = dumps
        try:
            super().__init__(quelle, press_delay, **kw)
        finally:
            sk.VORSPANN = alt_vorspann
            sk.json.dumps = alt_dumps

    def warte_bis(self, art, frist):
        ende = time.time() + frist
        while time.time() < ende:
            if self.zaehle(art):
                return True
            time.sleep(0.02)
        return False


def abschluss(lauf, b):
    lauf.ende()
    if b.laut:
        print(lauf.protokoll.read_text())
    lauf.aufraeumen()


# ════ 1. DER TON STEHT HINTER ZWEI FRISTEN ═══════════════════════════════════


def fall_ton_reihenfolge(b: Bericht):
    """Wie lange dauert es bis zum Bestaetigungston, wenn davor etwas haengt?

    In `off_trigger.sh` steht die Reihenfolge so:

        mit_frist 3 mupi-lautstaerke.sh set …  ||  mit_frist 3 pactl …
        mit_frist 5 aplay …
        mit_frist 3 sudo service mupi_startstop stop
        mit_frist 3 sudo service mupi_powerled stop
        sudo poweroff

    Haengt `mupi-lautstaerke.sh`, schneidet die Frist es nach 3 s ab — und weil
    ein abgeschnittener Aufruf ungleich 0 zurueckgibt, laeuft danach der
    Rueckfall `pactl` in seine EIGENEN 3 s. Der Ton kommt dann fruehestens nach
    6 Sekunden. Genau 6 Sekunden ist die Zahl, bei der die Platine den Strom
    hart wegnimmt: wer die ganze Zeit keinen Ton hoert und weiter haelt, ist
    dann dort angekommen.
    """
    haengt = (
        '/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; '
        'command sleep 30; return 0; }\n'
        '/usr/bin/pactl() { merken PACTL "$*"; command sleep 30; return 0; }\n'
    )
    lauf = Lauf(SKRIPT, "2", vorspann_extra=haengt)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "ton-reihenfolge", "der Waechter kam nicht hoch")
        t0 = lauf.druecken()
        lauf.warte_bis("POWEROFF", 30)
        lauf.loslassen()
        t_ton = lauf.erste_zeit("TON")
        t_aus = lauf.erste_zeit("POWEROFF")
        if t_aus is None:
            return b.sagen(False, "ton-reihenfolge", "gar kein poweroff in 30 s")
        if t_ton is None:
            return b.sagen(False, "ton-reihenfolge", "gar kein Ton")
        bis_ton = t_ton - t0
        bis_aus = t_aus - t0
        b.sagen(
            bis_ton <= 4.0, "ton-reihenfolge/ton",
            f"Lautstaerke haengt -> Ton nach {bis_ton:.1f} s "
            f"(Frist 2 s + hoechstens 1,5 s; erwartet hoechstens 4,0, denn bei "
            f"6 s nimmt die Platine den Strom)",
        )
        b.sagen(
            bis_aus <= 12.0, "ton-reihenfolge/aus",
            f"Lautstaerke haengt -> poweroff nach {bis_aus:.1f} s (erwartet hoechstens 12)",
        )
    finally:
        abschluss(lauf, b)


def fall_lautstaerke_rueckfall(b: Bericht):
    """Der Rueckfall auf `pactl` — laeuft er noch, und laeuft er nicht zu viel?

    Seit dem 08.08.2026 haengt er nicht mehr an `||`, sondern an einer Frage
    nach dem Rueckgabewert. Das kann in ZWEI Richtungen schiefgehen, und beide
    gehoeren gemessen:

      * er laeuft NICHT MEHR, wenn er soll — dann steht die Box beim naechsten
        Einschalten auf der Lautstaerke von gestern Abend;
      * er laeuft AUCH DANN, wenn der erste Aufruf abgeschnitten wurde — dann
        ist der Ton wieder hinter zwei Fristen, und genau das war der Fehler.
    """
    fehlt = ('/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; '
             'return 127; }\n')
    lauf = Lauf(SKRIPT, "2", vorspann_extra=fehlt)
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "rueckfall/fehlt", "der Waechter kam nicht hoch")
        else:
            lauf.druecken()
            lauf.warte_bis("POWEROFF", 8)
            lauf.loslassen()
            n = lauf.zaehle("PACTL")
            b.sagen(n == 1, "rueckfall/fehlt",
                    f"mupi-lautstaerke.sh gibt es nicht -> pactl {n}x gerufen "
                    f"(erwartet 1)")
    finally:
        abschluss(lauf, b)

    haengt = ('/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; '
              'command sleep 30; return 0; }\n')
    lauf = Lauf(SKRIPT, "2", vorspann_extra=haengt)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "rueckfall/haengt", "der Waechter kam nicht hoch")
        lauf.druecken()
        lauf.warte_bis("POWEROFF", 15)
        lauf.loslassen()
        n = lauf.zaehle("PACTL")
        b.sagen(n == 0, "rueckfall/haengt",
                f"mupi-lautstaerke.sh haengt (Tonserver wedged) -> pactl {n}x "
                f"gerufen (erwartet 0: derselbe Server, dieselbe Wand)")
    finally:
        abschluss(lauf, b)


def fall_alles_haengt(b: Bericht):
    """ALLE VIER Aufrufe vor dem poweroff haengen. Kommt es trotzdem?

    Der Sandkasten misst diesen Fall mit zwei haengenden Diensten (8,1 s).
    Hier haengen auch die Lautstaerke, ihr Rueckfall und der Ton — die Fristen
    addieren sich, denn sie laufen NACHEINANDER: 3 + 3 + 5 + 3 + 3.
    """
    haengt = (
        '/usr/local/bin/mupibox/mupi-lautstaerke.sh() { merken LAUTSTAERKE "$*"; '
        'command sleep 30; return 0; }\n'
        '/usr/bin/pactl() { merken PACTL "$*"; command sleep 30; return 0; }\n'
        '/usr/bin/aplay() { merken TON "$*"; command sleep 30; return 0; }\n'
        'service() { merken DIENST "$*"; command sleep 30; return 0; }\n'
    )
    lauf = Lauf(SKRIPT, "2", vorspann_extra=haengt)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "alles-haengt", "der Waechter kam nicht hoch")
        t0 = lauf.druecken()
        da = lauf.warte_bis("POWEROFF", 40)
        lauf.loslassen()
        if not da:
            return b.sagen(False, "alles-haengt", "kein poweroff in 40 s")
        bis_aus = lauf.erste_zeit("POWEROFF") - t0
        b.sagen(
            bis_aus <= 20.0, "alles-haengt",
            f"alle vier Aufrufe haengen je 30 s -> poweroff nach {bis_aus:.1f} s "
            f"(ohne Riegel nie; erwartet hoechstens 20)",
        )
        b.merkwuerdig(
            "alles-haengt/summe",
            f"{bis_aus:.1f} s zwischen Druck und Abschaltung — die Fristen "
            f"laufen nacheinander (3+3+5+3+3)",
        )
    finally:
        abschluss(lauf, b)


# ════ 2. SCHNELLES TROMMELN ══════════════════════════════════════════════════


def fall_trommeln_schnell(b: Bericht):
    """Unter dem Probentakt trommeln — dort, wo die Resonanz wehtut.

    Der Probentakt ist 40 bis 90 ms. Die vorhandene Gruppe `takt` misst von
    100/100 ms aufwaerts, also OBERHALB. Hier wird darunter getrommelt: bei
    10/10 ms sind die Proben so weit auseinander, dass jede irgendwo im Muster
    landet — und wenn die Zufallsauswahl schlecht ist, eben immer auf einem
    „drauf".
    """
    muster = [
        (10, 10), (15, 15), (20, 20), (25, 25), (30, 30),
        (40, 40), (45, 45), (50, 50), (60, 60),
        (30, 10), (60, 20), (70, 30), (90, 30), (45, 15),
    ]
    for an, aus in muster:
        laeufe = 3
        aus_zaehler = 0
        for _ in range(laeufe):
            lauf = Lauf(SKRIPT, "2")
            try:
                if not lauf.warte_auf("WACHT"):
                    b.sagen(False, f"trommeln/{an}-{aus}", "der Waechter kam nicht hoch")
                    break
                # 4 Sekunden trommeln — doppelt so lang wie die Frist
                zyklen = int(4.0 / ((an + aus) / 1000.0))
                lauf.tippen(zyklen, an / 1000.0, aus / 1000.0)
                time.sleep(0.7)
                aus_zaehler += lauf.zaehle("POWEROFF")
            finally:
                abschluss(lauf, b)
        b.sagen(
            aus_zaehler == 0, f"trommeln/{an}-{aus}",
            f"{an} ms drauf / {aus} ms los, 4 s lang, {laeufe} Laeufe -> "
            f"{aus_zaehler}x poweroff (erwartet 0)",
        )


# ════ 3. NACHZUEGLER IN DER ROEHRE ═══════════════════════════════════════════


def fall_nachzuegler(b: Bericht):
    """Erst tippen, dann halten — faengt die Frist beim RICHTIGEN Druck an?

    Waehrend der Halteschleife liest niemand aus der Roehre. Was der Waechter
    in dieser Zeit meldet, bleibt darin liegen. Die naechste Runde holt sich
    dann die AELTESTE Meldung — und wenn das ein „FLANKE" von vor einer halben
    Sekunde ist, laeuft die Frist ab diesem alten Zeitpunkt. Dann reicht ein
    Halten von weniger als der eingestellten Dauer.

    GEMESSEN WIRD DIE HAELFTE, DIE WEHTUT: getippt und danach 1,7 s gehalten
    bei einer Frist von 2 s. Faehrt sie herunter, war die Frist zu kurz.
    """
    for tipper, name in ((3, "drei-tipper"), (8, "acht-tipper")):
        n_aus = 0
        for _ in range(3):
            lauf = Lauf(SKRIPT, "2")
            try:
                if not lauf.warte_auf("WACHT"):
                    b.sagen(False, f"nachzuegler/{name}", "der Waechter kam nicht hoch")
                    break
                lauf.tippen(tipper, 0.05, 0.05)
                lauf.halten(1.7)
                time.sleep(0.8)
                n_aus += lauf.zaehle("POWEROFF")
            finally:
                abschluss(lauf, b)
        b.sagen(
            n_aus == 0, f"nachzuegler/{name}",
            f"{tipper}x kurz getippt, dann 1,7 s gehalten bei Frist 2 s -> "
            f"{n_aus}x poweroff (erwartet 0)",
        )


# ════ 4. NACH EINEM FEHLVERSUCH ══════════════════════════════════════════════


def fall_wiederholung(b: Bericht):
    """Erst zu kurz, dann richtig — der zweite Versuch muss noch gehen."""
    lauf = Lauf(SKRIPT, "2")
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "wiederholung", "der Waechter kam nicht hoch")
        for _ in range(4):
            lauf.halten(0.8)
            time.sleep(0.4)
        zwischen = lauf.zaehle("POWEROFF")
        b.sagen(zwischen == 0, "wiederholung/kurz",
                f"vier zu kurze Versuche -> {zwischen}x poweroff (erwartet 0)")
        t0 = lauf.druecken()
        da = lauf.warte_bis("POWEROFF", 6)
        lauf.loslassen()
        if not da:
            return b.sagen(False, "wiederholung/lang",
                           "nach vier Fehlversuchen faehrt sie GAR NICHT MEHR herunter")
        t = lauf.erste_zeit("POWEROFF") - t0
        b.sagen(1.85 <= t <= 3.0, "wiederholung/lang",
                f"der fuenfte Versuch haelt durch -> poweroff nach {t:.2f} s "
                f"(erwartet rund 2)")
    finally:
        abschluss(lauf, b)


# ════ 5. LANGSAMES jq ════════════════════════════════════════════════════════


def fall_langsames_jq(b: Bericht):
    """`press_delay_lesen` hat keine Frist. Was, wenn `jq` laenger braucht als sie?

    Der Ablauf im Skript: Flanke -> Uhr stellen -> `press_delay_lesen` (zwei
    `jq`-Aufrufe) -> Halteschleife. Der Zeitpunkt der Flanke ist die Grundlage
    der Frist, das ist richtig. Braucht `jq` aber LAENGER als die ganze
    Haltedauer, ist die Frist bei der ersten Probe schon abgelaufen — die
    Halteschleife laeuft NULL Durchlaeufe, und es entscheidet allein die
    Nachprobe hinter der Schleife.

    ZWEI RICHTUNGEN, BEIDE GEMESSEN:
      * angetippt und laengst losgelassen  -> darf NICHT abschalten
      * durchgehend gehalten               -> MUSS abschalten
    """
    langsam = '/usr/bin/jq() { command sleep 3; command /usr/bin/jq "$@"; }\n'

    lauf = Lauf(SKRIPT, "2", vorspann_extra=langsam)
    try:
        if not lauf.warte_auf("WACHT", frist=30):
            b.sagen(False, "langsames-jq/tipp", "der Waechter kam nicht hoch")
        else:
            lauf.halten(0.3)
            time.sleep(9)
            n = lauf.zaehle("POWEROFF")
            b.sagen(n == 0, "langsames-jq/tipp",
                    f"jq braucht 3 s, 0,3 s angetippt -> {n}x poweroff (erwartet 0)")
    finally:
        abschluss(lauf, b)

    lauf = Lauf(SKRIPT, "2", vorspann_extra=langsam)
    try:
        if not lauf.warte_auf("WACHT", frist=30):
            return b.sagen(False, "langsames-jq/halten", "der Waechter kam nicht hoch")
        t0 = lauf.druecken()
        da = lauf.warte_bis("POWEROFF", 20)
        lauf.loslassen()
        if not da:
            return b.sagen(False, "langsames-jq/halten",
                           "durchgehend gehalten und trotzdem kein poweroff")
        t = lauf.erste_zeit("POWEROFF") - t0
        b.sagen(True, "langsames-jq/halten",
                f"jq braucht 3 s, durchgehend gehalten -> poweroff nach {t:.2f} s")
    finally:
        abschluss(lauf, b)


# ════ 6. OHNE awk ════════════════════════════════════════════════════════════


def fall_ohne_awk(b: Bericht):
    """Bruchzahl in der Konfiguration UND kein `awk`.

    `press_delay_lesen` rundet Bruchzahlen mit `awk` auf. Fehlt `awk`, bleibt
    `wert` LEER. Danach vergleicht bash eine leere Zeichenkette mit Zahlen —
    das schlaegt fehl, beide Riegel greifen nicht, und `PRESS_DELAY` wird leer.
    Was daraus wird, wird hier gemessen statt vermutet, und zwar in BEIDEN
    Richtungen.
    """
    ohne = '/usr/bin/awk() { return 127; }\n'

    lauf = Lauf(SKRIPT, "2.5", vorspann_extra=ohne)
    try:
        if not lauf.warte_auf("WACHT"):
            b.sagen(False, "ohne-awk/tipp", "der Waechter kam nicht hoch")
        else:
            lauf.halten(0.3)
            time.sleep(3)
            n = lauf.zaehle("POWEROFF")
            b.sagen(n == 0, "ohne-awk/tipp",
                    f"pressDelay 2.5 ohne awk, 0,3 s angetippt -> {n}x poweroff (erwartet 0)")
    finally:
        abschluss(lauf, b)

    lauf = Lauf(SKRIPT, "2.5", vorspann_extra=ohne)
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "ohne-awk/halten", "der Waechter kam nicht hoch")
        t0 = lauf.druecken()
        da = lauf.warte_bis("POWEROFF", 12)
        lauf.loslassen()
        if not da:
            return b.sagen(False, "ohne-awk/halten",
                           "pressDelay 2.5 ohne awk: durchgehend gehalten und "
                           "TROTZDEM kein poweroff - der Knopf ist tot")
        t = lauf.erste_zeit("POWEROFF") - t0
        b.sagen(t <= 6.0, "ohne-awk/halten",
                f"pressDelay 2.5 ohne awk, durchgehend gehalten -> poweroff nach "
                f"{t:.2f} s (bei 6 s nimmt die Platine den Strom)")
    finally:
        abschluss(lauf, b)


# ════ 7. GENAU AUF DER FRIST ═════════════════════════════════════════════════


def fall_auf_der_frist(b: Bericht):
    """Loslassen dicht an der Frist — beide Seiten, mehrfach.

    Der vorhandene Sandkasten misst 1,92 s bei Frist 2 s. Hier wird die Kante
    von beiden Seiten und mehrfach abgetastet, weil der Probentakt zufaellig
    ist: EIN Lauf sagt hier nichts.
    """
    for ms, erwartet in ((1900, 0), (1980, 0), (2050, None), (2200, 1), (2500, 1)):
        n = 0
        laeufe = 4
        for _ in range(laeufe):
            lauf = Lauf(SKRIPT, "2")
            try:
                if not lauf.warte_auf("WACHT"):
                    b.sagen(False, f"kante/{ms}", "der Waechter kam nicht hoch")
                    break
                lauf.halten(ms / 1000.0)
                time.sleep(0.8)
                n += lauf.zaehle("POWEROFF")
            finally:
                abschluss(lauf, b)
        if erwartet is None:
            b.merkwuerdig(f"kante/{ms}",
                          f"{ms} ms gehalten bei Frist 2000 ms -> {n} von {laeufe} "
                          f"Laeufen schalteten ab (Graubereich, kein Urteil)")
        elif erwartet == 0:
            b.sagen(n == 0, f"kante/{ms}",
                    f"{ms} ms gehalten bei Frist 2000 ms -> {n}x poweroff (erwartet 0)")
        else:
            b.sagen(n == laeufe, f"kante/{ms}",
                    f"{ms} ms gehalten bei Frist 2000 ms -> {n} von {laeufe} "
                    f"Laeufen schalteten ab (erwartet {laeufe})")


# ════ 8. DIE ZUSTANDSDATEI VERSCHWINDET ══════════════════════════════════════


def fall_zustand_weg(b: Bericht):
    """Mitten im Halten verschwindet die Zustandsdatei.

    Das ist der Fall „der Waechter lebt, sagt aber nichts mehr". `off_trigger.sh`
    behandelt ihn ausdruecklich (`cannot read … - treating the button as
    released`) — hier wird gemessen, dass es auch wirklich so herauskommt und
    nicht etwa in einer Endlosschleife endet.
    """
    lauf = Lauf(SKRIPT, "5")
    try:
        if not lauf.warte_auf("WACHT"):
            return b.sagen(False, "zustand-weg", "der Waechter kam nicht hoch")
        lauf.druecken()
        time.sleep(0.5)
        (lauf.verz / "zustand").unlink(missing_ok=True)
        time.sleep(6)
        n = lauf.zaehle("POWEROFF")
        lauf.loslassen()
        b.sagen(n == 0, "zustand-weg",
                f"Zustandsdatei mitten im Halten geloescht -> {n}x poweroff (erwartet 0)")
        lebt = lauf.p.poll() is None
        b.sagen(lebt, "zustand-weg/laeuft-weiter",
                "das Skript laeuft danach weiter" if lebt else
                "das Skript ist gestorben - der Knopf ist bis zum Neustart weg")
    finally:
        abschluss(lauf, b)


# ════ 9. STREUUNG DER GEMESSENEN FRIST ═══════════════════════════════════════


def fall_streuung(b: Bericht):
    """Zehnmal dieselbe Messung: wie weit streut die Frist wirklich?

    Eine EINZELNE Messung von „2,08 s bei eingestellten 2 s" sagt nichts
    darueber, wie es beim naechsten Mal aussieht. Der Probentakt ist zufaellig,
    und bei eingestellten 5 s ist der Abstand zu den 6 s der Platine das, was
    zaehlt. Also: der SCHLECHTESTE Lauf von zehn, nicht der erste.
    """
    for eingestellt, erwartet in (("2", 2.0), ("5", 5.0)):
        zeiten = []
        for _ in range(8):
            lauf = Lauf(SKRIPT, eingestellt)
            try:
                if not lauf.warte_auf("WACHT"):
                    continue
                t0 = lauf.druecken()
                if lauf.warte_bis("POWEROFF", erwartet + 4):
                    zeiten.append(lauf.erste_zeit("POWEROFF") - t0)
                lauf.loslassen()
            finally:
                abschluss(lauf, b)
        if len(zeiten) < 6:
            b.sagen(False, f"streuung/{eingestellt}",
                    f"nur {len(zeiten)} von 8 Laeufen schalteten ueberhaupt ab")
            continue
        schlechtester = max(zeiten)
        b.sagen(
            schlechtester < 6.0 and min(zeiten) >= erwartet - 0.15,
            f"streuung/{eingestellt}",
            f"eingestellt {eingestellt} s, 8 Laeufe: {min(zeiten):.2f}–"
            f"{schlechtester:.2f} s (Mittel {statistics.mean(zeiten):.2f}) — "
            f"der schlechteste muss unter 6 s bleiben",
        )


# ════ DAS PROGRAMM ═══════════════════════════════════════════════════════════

GRUPPEN = {
    "ton-reihenfolge": fall_ton_reihenfolge,
    "rueckfall": fall_lautstaerke_rueckfall,
    "alles-haengt": fall_alles_haengt,
    "trommeln-schnell": fall_trommeln_schnell,
    "nachzuegler": fall_nachzuegler,
    "wiederholung": fall_wiederholung,
    "langsames-jq": fall_langsames_jq,
    "ohne-awk": fall_ohne_awk,
    "kante": fall_auf_der_frist,
    "zustand-weg": fall_zustand_weg,
    "streuung": fall_streuung,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nur", action="append", choices=sorted(GRUPPEN))
    ap.add_argument("--laut", action="store_true")
    a = ap.parse_args()

    if not SKRIPT.is_file():
        print(f"FEHLT: {SKRIPT}", file=sys.stderr)
        return 2

    b = Bericht(laut=a.laut)
    for name in (a.nur or sorted(GRUPPEN)):
        print(f"\n── {name} " + "─" * max(0, 60 - len(name)))
        GRUPPEN[name](b)

    print("\n" + "═" * 72)
    if b.rot:
        print(f"ROT — {len(b.rot)} von {len(b.zeilen)} Aussagen:")
        for _, name, text in b.rot:
            print(f"  {name}: {text}")
        return 1
    print(f"GRUEN — {len(b.zeilen)} Aussagen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
