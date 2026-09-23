#!/usr/bin/env python3
"""E8/T2 ORDNEN: die zu kleinen Beruehrziele in drei Gruppen, mit Kosten.

WOZU
    tools/beruehrziele-neu.mjs liefert die ZAHLEN (llmwiki
    [[beruehrziele-neue-oberflaeche-gemessen]]): 95 von 163 erreichbaren Zielen
    liegen unter 9 mm.  Das ist eine LISTE.  Zum PLAN fehlen zwei Dinge, und
    dieses Werkzeug fuegt sie hinzu:

      1. WER TRIFFT DAS ZIEL — ein Kind im Alltag, ein Erwachsener in der
         Verwaltung, oder niemand (dekorativ, verdeckt, abgeschaltet).
      2. WAS KOSTET ES, es auf 9 mm zu bringen — gemessen mit
         tools/e8-kosten-messen.mjs, nicht geschaetzt.

    Die 95 Zeilen sind nur 39 verschiedene BEDIENELEMENTE; der Mini-Player
    steht auf sechs Schirmen und wird sechsmal gezaehlt.  Nach Bedienelementen
    zu ordnen statt nach Zeilen ist der erste Schritt, der aus der Liste einen
    Plan macht.

DIE EINE ZAHL, DIE ALLES ORDNET
    9 mm = 64,3 px bei 0,14 mm/px.  64 px sind 8,96 mm.
    ZWEI DRITTEL DER BEFUNDE SIND 64-px-KNOEPFE, denen 0,3 px fehlen — eine
    Rundung, kein Bedienproblem.  Wer sie nicht von den echten Faellen trennt
    (1,4 mm bis 6,3 mm), plant fuer 95 Ziele, wo zwoelf gemeint sind.

AUFRUF
    node tools/beruehrziele-neu.mjs --alle > /tmp/e8.txt
    python3 tools/e8-ordnen.py /tmp/e8.txt

WAS ES NICHT TUT
    Es aendert nichts und entscheidet nichts.  Wo eine Wahl ansteht, die dem
    Betreiber gehoert, steht sie am Ende unter OFFENE FRAGEN.
"""

import math
import re
import sys
from collections import defaultdict

MM_JE_PIXEL = 0.14
MARKE_MM = 9.0

# ── DIE EINTEILUNG ─────────────────────────────────────────────────────────
#
# Schluessel ist der Anfang des gemessenen Bezeichners (Tag + id + Klassen),
# damit „button.tor-taste.tor-loeschen" von „button.tor-taste" mitgefasst wird.
#
# GRUPPE 1  trifft ein KIND im Alltag (Kinderoberflaeche, haeufig)
# GRUPPE 2  trifft einen ERWACHSENEN (Verwaltung, selten)
# GRUPPE 3  ist gar kein echtes Ziel (dekorativ, verdeckt, abgeschaltet)
#
# Die Begruendung steht DANEBEN und nicht in einem Bericht: Wer die Einteilung
# spaeter anzweifelt, sieht hier, worauf sie sich stuetzt, und aendert eine
# Zeile statt einer Meinung.
EINTEILUNG = [
    # ── Gruppe 1 — das Kind ────────────────────────────────────────────────
    ("button.tipp-spiel", 1, "Der Play-Knopf auf jeder Kachel. Der haeufigste Griff der ganzen Oberflaeche."),
    ("button#mp-spiel", 1, "Anhalten/weiter im Mini-Player — steht auf JEDEM Schirm."),
    ("button#mp-vor", 1, "Naechster Titel im Mini-Player."),
    ("button#mp-zurueck", 1, "Vorheriger Titel im Mini-Player."),
    ("button#mp-laut", 1, "Lautstaerke aufmachen — Kinder stellen selbst lauter und leiser."),
    ("button.mp-bild", 1, "Grossen Player oeffnen (das Cover im Mini-Player)."),
    ("button.mp-text", 1, "Grossen Player oeffnen (der Titeltext daneben) — dasselbe Ziel."),
    ("button#zurueck", 1, "Der Rueckweg. Auf sieben Schirmen, auch auf allen Kinderschirmen."),
    ("input#mp-laut-regler", 1, "Der Lautstaerkeregler selbst."),
    ("input#gr-schieber", 1, "Die Stelle im Titel im grossen Player."),
    ("button#ag-lauter", 1, "Lauter im Cover-Vollbild."),
    ("button#ag-leiser", 1, "Leiser im Cover-Vollbild."),
    ("button.kat", 1, "Die Kategorien links (Alles/Musik/Hoerbuch/Radio)."),
    # ── Gruppe 2 — der Erwachsene ──────────────────────────────────────────
    # HIER STAND ("button#licht-knopf", 2, "Hell/dunkel in der Kopfleiste —
    # selten, und kein Weg fuehrt darueber."). Der Mond ist am 07.08.2026
    # entfallen (Betreiber: „was wir auch rausnehmen könen ist hell dunkel aus
    # dem band oben"). Hell/dunkel steht jetzt als ZEILE im Admin-Menue unter
    # Darstellung -> Farbe und Form und faellt damit unter .zeile-tat weiter
    # unten — dort ist es ohnehin schon gezaehlt.
    ("button#bt-knopf", 2, "Bluetooth-Anzeige in der Kopfleiste; Verwaltung."),
    # HIER STAND ("button#einst-knopf", 2, "Einstellungen; der lange Druck
    # darauf fuehrt in den Eltern-Bereich."). Das Zahnrad ist am 06.08.2026
    # ersatzlos entfallen; der Weg ins Admin-Menue ist der Schriftzug unten
    # links, gehalten. Er steht als eigenes Ziel darunter.
    ("button#wappen", 2, "Der Schriftzug unten links — 1200 ms gehalten fuehrt er ins Admin-Menue."),
    ("button.tor-taste", 2, "Die Tasten des PIN-Tors — nur Erwachsene tippen hier."),
    ("button.fach-knopf", 2, "Die Faecher des Eltern-Bereichs (WLAN, Bluetooth, Anzeige, System)."),
    ("button#fach-tat", 2, "„Suchen\" im Eltern-Bereich."),
    ("button.zeile-tat", 2, "„Verbinden\" in einer Geraetezeile des Eltern-Bereichs."),
]

# ── GRUPPE 3, und warum sie NICHT nach dem Bezeichner geht ─────────────────
#
# Ein `.leute-kachel` ist auf der Startseite ein vollwertiges 12,9-mm-Ziel und
# unter dem offenen Laut-Fenster ein 1,4-mm-Streifen.  DERSELBE Bezeichner,
# zwei verschiedene Dinge.  Die Einteilung haengt hier also am SCHIRM und an
# der getasteten Groesse, nicht am Namen — deshalb eine eigene Regel.
def gruppe_drei(sel: str, schirme: set, getastet: set) -> str | None:
    # AN DER GETASTETEN GROESSE, NICHT AM SCHIRM. Der erste Anlauf fragte
    # `schirme <= {"laut"}` und fiel durch: dieselbe Kachel steht auch im
    # Schirm „raster" im Bericht — dort aber nur angeschnitten. Die getastete
    # Groesse trennt die beiden Faelle zuverlaessig, der Schirmname nicht.
    if sel.startswith("button.leute-kachel") and any(
        g.endswith("x10") for g in getastet
    ):
        return ("Nur der Reststreifen, den das offene Laut-Fenster ueberlaesst "
                "(92x10 statt 92x127). Kein Ziel, sondern ein Fehlgriff-Risiko: "
                "wer den Regler verfehlt, navigiert weg statt zu schliessen.")
    return None


def einteilen(sel: str, schirme: set, getastet: set):
    d = gruppe_drei(sel, schirme, getastet)
    if d:
        return 3, d
    for anfang, gr, warum in EINTEILUNG:
        if sel.startswith(anfang):
            return gr, warum
    return None, None


# ── WAS ES KOSTET ──────────────────────────────────────────────────────────
#
# Gemessen mit tools/e8-kosten-messen.mjs am 05.08.2026 gegen die Vorschau,
# 800x480.  Die Zahlen sind Bildpunkte aus dem Browser, keine CSS-Angaben.
KOSTEN = {
    "button#mp-spiel": "Mini-Player: 6 Kinder in 688 px, 70 px Luft, Luecken 10 px. 64→66 px kostet 10 px von 20 px echtem Spielraum (50 px sind die Luecken). PASST OHNE UMBAU.",
    "button#mp-vor": "wie #mp-spiel — dieselbe Reihe, dieselbe Rechnung.",
    "button#mp-zurueck": "wie #mp-spiel — dieselbe Reihe.",
    "button#mp-laut": "wie #mp-spiel — dieselbe Reihe.",
    "button.mp-bild": "wie #mp-spiel; .mp-text daneben ist dehnbar und gibt nach.",
    "button.mp-text": "298x64, die Hoehe fehlt (1 px). Waechst mit der Reihe mit.",
    "button#zurueck": "64x64 frei ueber allem (position: absolute, left: var(--zurueck-links, 96px)). Kein Nachbar in derselben Reihe. ABER: im Eltern-Bereich steht .fach-knopf „WLAN\" 1 px daneben — dort kostet Wachsen eine Beruehrung.",
    "button.kat": "72x64 in einer Spalte mit 98 px senkrechter Luft, Luecken 6 px. 64→66 px kostet 8 px von 98. PASST.",
    "button#ag-lauter": "84x480-Leiste, 268 px senkrechte Luft, Luecken 16/116 px. PASST muehelos.",
    "button#ag-leiser": "wie #ag-lauter.",
    "button.tipp-spiel": "44x44, absolut in der Kachelecke (right/bottom 6px). Auf 65 px braeuchte er 21 px mehr — auf einer 96 px breiten Titelkachel waeren das 68 % ihrer Breite. Er verdeckte dann das Bild, die Folgennummer (.stueck-nr, mittig) und stiesse an die Dienst-Plakette unten links (.kachel-marken). DAS IST KEIN GROESSENSCHRAUBEN, sondern ein Umbau der Kachel.",
    "input#mp-laut-regler": "Griff 34 px auf 14-px-Bahn, 582 px lang. Auf 65 px muesste das Fenster von 58 auf ~90 px wachsen; es liegt UEBER der Interpreten-Reihe und deckte sie dann ganz zu (heute bleiben 10 px). Das beruehrt die offene Frage des Betreibers unten.",
    "input#gr-schieber": "540x44, unsichtbar ueber dem 12-px-Balken. Ueber ihm #gr-unter, unter ihm .gross-tasten. Auf 65 px muesste einer von beiden weichen.",
    # Die Rechnung stand frueher bei #licht-knopf ("Kopfleiste: 5 Kinder,
    # 307 px waagerechte Luft") und wird hier weitergefuehrt, weil der Mond
    # weg ist: In der Kopfleiste stehen seit dem 07.08.2026 nur noch DREI
    # Kinder (kopf-unter, kopf-status, bt-knopf), die waagerechte Luft ist
    # entsprechend groesser. Der eine verbliebene Knopf passt erst recht.
    "button#bt-knopf": "Kopfleiste: 3 Kinder, reichlich waagerechte Luft. PASST muehelos.",
    "button#wappen": "Steht in der Kategorienleiste unten links, 73x54 gemessen. Er ist seit dem 06.08.2026 ein Knopf; vorher war es ein <div> und damit gar kein Beruehrziel. Ueber ihm die letzte Kategorie.",
    "button.tor-taste": "84x64, Luecke 9 px zur Nachbartaste. 64→66 px kostet 2 px Luecke je Reihe — bliebe 7 px (0,98 mm) und damit UNTER den 2 mm Mindestabstand.",
    "button.fach-knopf": "168x64 in der Fachspalte; die Hoehe fehlt (1 px). ABER der Abstand zu #zurueck betraegt 1 px — hier ist der ABSTAND das Problem, nicht die Groesse.",
    "button#fach-tat": "118x64; 1 px fehlt.",
    "button.zeile-tat": "108x64; 1 px fehlt.",
    "button.leute-kachel": "Nicht vergroessern — die Kachel IST 92x127 (12,88 mm). Zu entscheiden ist, ob das Laut-Fenster Tipps dahinter abfaengt.",
}

def kosten_zu(sel: str) -> str:
    """Kosten ueber den ANFANG des Bezeichners suchen, nicht ueber Gleichheit.

    Der Bericht nennt „button#mp-zurueck.mp-knopf", die Tabelle
    „button#mp-zurueck" — ein exakter Vergleich fand deshalb nichts und
    schrieb „NICHT GEMESSEN" unter Zahlen, die gemessen daneben lagen.
    Der laengste passende Anfang gewinnt, damit `.tor-loeschen` eine eigene
    Zeile bekommen KANN, ohne dass sie noetig ist.
    """
    treffer = [(a, t) for a, t in KOSTEN.items() if sel.startswith(a)]
    return max(treffer, key=lambda x: len(x[0]))[1] if treffer else "— NICHT GEMESSEN —"


ZEILE = re.compile(
    r"\s+(✗|schn)\s+([\d.]+) mm\s+Rechteck (\S+)\s+getastet (\S+)\s+(\S+)\s+„(.*)\"\s*$"
)
SCHIRM = re.compile(r"── (\S+) ")


def main() -> int:
    quelle = sys.argv[1] if len(sys.argv) > 1 else None
    text = open(quelle, encoding="utf-8") if quelle else sys.stdin

    schirm = None
    ziele = defaultdict(lambda: {"mm": set(), "schirme": set(), "rect": set(),
                                 "getastet": set(), "zeilen": 0, "angeschnitten": 0})
    for ln in text:
        m = SCHIRM.match(ln)
        if m:
            schirm = m.group(1)
            continue
        m = ZEILE.match(ln.rstrip())
        if not m:
            continue
        art, mm, rect, gt, sel, lab = m.groups()
        e = ziele[sel]
        e["mm"].add(float(mm))
        e["schirme"].add(schirm)
        e["rect"].add(rect)
        e["getastet"].add(gt)
        if art == "schn":
            e["angeschnitten"] += 1
        else:
            e["zeilen"] += 1

    echte = {s: v for s, v in ziele.items() if v["zeilen"]}
    print(f"E8/T2 — {sum(v['zeilen'] for v in echte.values())} Befunde unter "
          f"{MARKE_MM:.0f} mm, verteilt auf {len(echte)} verschiedene Bedienelemente")
    print(f"Marke: {MARKE_MM:.0f} mm = {MARKE_MM / MM_JE_PIXEL:.1f} px "
          f"({MM_JE_PIXEL} mm/px). 64 px = 8,96 mm — diesen Zielen fehlt EIN Pixel.\n")

    nach_gruppe = defaultdict(list)
    unbekannt = []
    for sel, v in echte.items():
        gr, warum = einteilen(sel, v["schirme"], v["getastet"])
        if gr is None:
            unbekannt.append(sel)
            continue
        nach_gruppe[gr].append((sel, v, warum))

    titel = {
        1: "GRUPPE 1 — TRIFFT EIN KIND IM ALLTAG",
        2: "GRUPPE 2 — TRIFFT EINEN ERWACHSENEN (Verwaltung, selten)",
        3: "GRUPPE 3 — KEIN ECHTES ZIEL (dekorativ, verdeckt, abgeschaltet)",
    }
    for gr in (1, 2, 3):
        eintraege = sorted(nach_gruppe[gr], key=lambda x: min(x[1]["mm"]))
        anzahl = sum(v["zeilen"] for _, v, _ in eintraege)
        print(f"\n{'═' * 74}\n{titel[gr]}")
        print(f"{len(eintraege)} Bedienelemente, {anzahl} der gezaehlten Befunde\n")
        for sel, v, warum in eintraege:
            klein = min(v["mm"])
            # WAS FEHLT, WIRD AM ENTWURF GEMESSEN, NICHT AM ANGESCHNITTENEN.
            # Aus der schmalsten GETASTETEN Seite zu rechnen ergab fuer
            # .tipp-spiel „es fehlen 39 px" — das ist die halb abgeschnittene
            # Randkachel, nicht der Knopf. Der Entwurf (44x44) sagt 21 px, und
            # das ist die Zahl, gegen die jemand baut.
            entwurf = min(int(x) for r in v["rect"] for x in r.split("x"))
            # AUFRUNDEN, NICHT RUNDEN. 9 mm sind 64,29 px; `round` machte
            # daraus 64 und meldete fuer die 64-px-Knoepfe „es fehlen 0 px" —
            # also ausgerechnet fuer die Gruppe, um die es geht, eine Null.
            # Wer die Marke ERREICHEN will, braucht 65 px.
            fehlt = max(0, math.ceil(MARKE_MM / MM_JE_PIXEL) - entwurf)
            spanne = f"{klein:.2f}" if len(v["mm"]) == 1 else f"{klein:.2f}–{max(v['mm']):.2f}"
            print(f"  {spanne:>12} mm  {sel}")
            print(f"                 {v['zeilen']}x gezaehlt, auf: {', '.join(sorted(v['schirme']))}")
            print(f"                 Rechteck {'/'.join(sorted(v['rect']))}, "
                  f"getastet {'/'.join(sorted(v['getastet']))}")
            print(f"                 laut Entwurf {entwurf} px — es fehlen {fehlt} px auf die Marke")
            print(f"                 WER: {warum}")
            if gr == 1:
                print(f"                 KOSTEN: {kosten_zu(sel)}")
            print()

    # NUR ANGESCHNITTEN — gehoert dazu, aber nicht in die Wertung.
    schn = {s: v for s, v in ziele.items() if v["angeschnitten"] and not v["zeilen"]}
    if schn:
        print(f"\n{'═' * 74}\nNUR ANGESCHNITTEN — Rollposition, nicht Gestaltung")
        print("Diese Ziele sind gross genug; sie standen beim Messen halb aus dem Bild.")
        print("Sie zaehlen NICHT zu den Befunden und sind mit Rollen voll erreichbar.\n")
        for sel, v in sorted(schn.items(), key=lambda kv: min(kv[1]["mm"])):
            print(f"  {min(v['mm']):>8.2f} mm  {sel}  ({', '.join(sorted(v['schirme']))}, "
                  f"getastet {'/'.join(sorted(v['getastet']))})")

    if unbekannt:
        # LAUT SCHEITERN. Ein neues Bedienelement, das hier stillschweigend
        # durchfiele, waere ein Ziel ohne Einteilung — und der Bericht saehe
        # trotzdem vollstaendig aus.
        print(f"\n{'═' * 74}\nNICHT EINGETEILT — {len(unbekannt)} Bedienelemente kennt die Tabelle nicht:")
        for s in sorted(unbekannt):
            print(f"  {s}")
        print("Wer sie einteilt, traegt sie oben in EINTEILUNG ein.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
