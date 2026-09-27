#!/usr/bin/env python3
"""Was der laufende Kiosk WIRKLICH kostet — PSS, nicht RSS, ohne etwas umzustellen.

    python3 tools/kiosk-pss-messen.py --box dietpi@192.168.178.62
    python3 tools/kiosk-pss-messen.py --box dietpi@192.168.178.62 --wdh 2 --abstand 600
    python3 tools/kiosk-pss-messen.py --box dietpi@192.168.178.62 --einzeln

══ WOZU ═══════════════════════════════════════════════════════════════════
Der Wiki-Eintrag `cog-spart-267-mb-gemessen` (20.08.2026) sagt: Chromium+Xorg
537-557 MB gegen Cog 269-285 MB, also rund 267 MB Unterschied. Das ist eine
ZUSTANDSAUSSAGE und damit haltbarkeitsbehaftet (llmwiki
`wiki-zustand-hat-haltbarkeit`). Wer sie nachmessen will, braucht DIESELBE
GROESSE — und das ist PSS.

WARUM NICHT RSS: Chromium laeuft hier als acht Prozesse plus zwei
Absturzmelder, die sich denselben Programmtext teilen. Die RSS zu addieren
zaehlt diese Seiten zehnmal; die Summe war am 19.09.2026 rund 745 MB,
waehrend `free` zur selben Zeit nur 1300 MB fuer das GANZE System meldete.
RSS ist bei einem Browser mit Prozessfamilie keine Zahl, mit der man rechnen
darf — sie ist systematisch zu hoch und der Fehler waechst mit der Zahl der
Prozesse, also genau dort, wo der Vergleich Chromium/Cog liegt (10 gegen 6).
PSS aus /proc/PID/smaps_rollup teilt geteilte Seiten durch die Zahl ihrer
Nutzer und ist die Zahl, die der alten Aussage entspricht.

WARUM ES VORHER NICHT GING: smaps_rollup der Kiosk-Prozesse gehoert `root`.
Als `dietpi` gelesen gibt es `Permission denied`; `tools/wpe-nachfolge-
pruefen.py --box` verzichtet deshalb ausdruecklich auf PSS. Auf DIESER Box
funktioniert `sudo -n` (die Auslieferung benutzt es), und ein `awk` auf eine
Datei unter /proc aendert nichts. Genau so viel sudo und keinen Schritt mehr.

══ DIE 16-KB-FALLE, HIER AUSDRUECKLICH VORGEFUEHRT ════════════════════════
Der Pi 5 hat `getconf PAGESIZE` = 16384 (llmwiki `pi5-hat-16k-seiten`).
`/proc/PID/statm` zaehlt SEITEN; wer dort 4096 fest verdrahtet, liegt um
Faktor 4 daneben, und das Ergebnis sieht plausibel aus, statt zu krachen.
`/proc/PID/smaps_rollup` und `/proc/PID/status` zaehlen dagegen kB — die
Falle greift dort NICHT. Weil das eine Behauptung ist, die man glauben
muesste, rechnet dieses Werkzeug sie vor: es liest statm mit, rechnet es
einmal mit der ECHTEN Seitengroesse und einmal mit 4096 um und stellt beide
neben die RSS aus `status`. Stimmt die erste Spalte mit `status` ueberein und
die zweite nicht, ist die Falle nachgewiesen statt zitiert.

══ ZWEIMAL MESSEN, MIT ABSTAND ════════════════════════════════════════════
Einmal hinsehen ist keine Messung (llmwiki `einmal-hinsehen-ist-keine-
messung`): der Anlauf sieht aus wie ein Zustand. `--wdh 2 --abstand 600`
misst zweimal mit zehn Minuten Abstand und schreibt BEIDE Werte hin. Die
Spanne ist Teil des Ergebnisses, nicht ein Wert mit Fehlerbalken.

══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
Es stellt NICHTS um. Kein systemctl, kein Kiosk-Neustart, kein apt, kein
Schreiben in /etc. Es misst den Kiosk, DER GERADE LAEUFT — und nur den. Die
Cog-Haelfte des Vergleichs bekommt man damit ausdruecklich NICHT: dafuer
muesste `mupibox.kioskBrowser` umgestellt und der Kiosk neu gestartet
werden, und das ist ein Eingriff an einem Geraet, das Kinder benutzen.
`tools/kiosk-benchmark.py` kann das und tut genau deshalb mehr, als ein
Lesewerkzeug tun darf. Was ein solcher Lauf kostet, steht in
AUDIT-2026-09-19-WPE.md §7.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time

# Nach `comm` zugeordnet, NICHT ueber `pgrep -f`: ein Muster auf der
# Befehlszeile faengt die eigene ssh-Zeile mit (llmwiki/AGENTS.md:
# "pgrep -f zaehlt den eigenen Aufruf mit").
FAMILIEN = {
    "Chromium": lambda c: c.startswith("chromium") or c.startswith("chrome_"),
    "Xorg": lambda c: c == "Xorg",
    "Cog/WPE": lambda c: c == "cog" or c.startswith("WPE"),
}

# Die Aussage, gegen die gemessen wird. PSS ueber alle Prozesse des jeweiligen
# Kiosks, gemessen 20.08.2026 mit tools/kiosk-benchmark.py, jeweils nach einem
# Kiosk-Neustart und anschliessender Ruhezeit.
ALT = {
    "quelle": "llmwiki cog-spart-267-mb-gemessen, 20.08.2026",
    "chromium_mb": (537, 557),
    "cog_mb": (269, 285),
    "abstand_mb": 267,
}

BOX_BEFEHL = r"""
echo "###zeit"; date "+%Y-%m-%d %H:%M:%S"
echo "###uptime"; uptime
echo "###seitengroesse"; getconf PAGESIZE
echo "###schalter"; /usr/bin/jq -r '.mupibox.kioskBrowser // "(fehlt)"' /etc/mupibox/mupiboxconfig.json 2>/dev/null
echo "###prozesse"
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  c=$(cat /proc/$p/comm 2>/dev/null) || continue
  case "$c" in chromium*|chrome_*|Xorg|cog|WPE*) ;; *) continue ;; esac
  # PSS: braucht root, deshalb sudo -n. Schlaegt es fehl, bleibt das Feld
  # leer und wird als NICHT GEMESSEN gemeldet — nicht als 0.
  pss=$(sudo -n awk '/^Pss:/{print $2}' /proc/$p/smaps_rollup 2>/dev/null)
  rss=$(awk '/^VmRSS:/{print $2}' /proc/$p/status 2>/dev/null)
  statm=$(awk '{print $2}' /proc/$p/statm 2>/dev/null)
  echo "$p|$c|${pss:-}|${rss:-}|${statm:-}"
done
echo "###free"; free -k
echo "###swapuse"; sudo -n awk '/^(Name|Size|Used)/{print}' /proc/swaps 2>/dev/null; cat /proc/swaps 2>/dev/null
"""


def _abschnitte(text: str) -> dict[str, list[str]]:
    d: dict[str, list[str]] = {}
    k = None
    for z in text.splitlines():
        if z.startswith("###"):
            k = z[3:].strip()
            d[k] = []
        elif k is not None:
            d[k].append(z)
    return d


def _ganzzahl(s: str) -> int | None:
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


def einmal(ziel: str) -> dict | None:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", ziel, BOX_BEFEHL],
        capture_output=True, text=True, timeout=240)
    if r.returncode:
        print(f"NICHT GEMESSEN: ssh {ziel} endete mit {r.returncode}: "
              f"{r.stderr.strip()[:200]}")
        return None
    a = _abschnitte(r.stdout)

    seite = _ganzzahl(" ".join(a.get("seitengroesse", [])).strip()) or 0
    prozesse = []
    for z in a.get("prozesse", []):
        t = z.split("|")
        if len(t) != 5:
            continue
        prozesse.append({
            "pid": _ganzzahl(t[0]), "comm": t[1],
            "pss_kb": _ganzzahl(t[2]), "rss_kb": _ganzzahl(t[3]),
            "statm_seiten": _ganzzahl(t[4]),
        })

    frei: dict[str, int] = {}
    for z in a.get("free", []):
        t = z.split()
        if t and t[0] == "Mem:" and len(t) >= 7:
            frei |= {"gesamt": int(t[1]), "belegt": int(t[2]), "verfuegbar": int(t[6])}
        if t and t[0] == "Swap:" and len(t) >= 4:
            frei |= {"swap_gesamt": int(t[1]), "swap_belegt": int(t[2])}

    return {
        "zeit": " ".join(a.get("zeit", ["?"])).strip(),
        "uptime": " ".join(a.get("uptime", ["?"])).strip(),
        "seitengroesse": seite,
        "schalter": " ".join(a.get("schalter", ["?"])).strip(),
        "prozesse": prozesse,
        "free": frei,
    }


def _bilanz(lauf: dict) -> dict[str, dict]:
    aus: dict[str, dict] = {}
    for name, passt in FAMILIEN.items():
        teil = [p for p in lauf["prozesse"] if passt(p["comm"])]
        if not teil:
            continue
        ohne_pss = [p for p in teil if p["pss_kb"] is None]
        aus[name] = {
            "n": len(teil),
            "pss_kb": sum(p["pss_kb"] or 0 for p in teil),
            "rss_kb": sum(p["rss_kb"] or 0 for p in teil),
            "ohne_pss": len(ohne_pss),
        }
    return aus


def _seitenfalle(lauf: dict) -> None:
    """Die 16-KB-Falle vorrechnen statt zitieren."""
    seite = lauf["seitengroesse"]
    kandidat = next((p for p in lauf["prozesse"]
                     if p["rss_kb"] and p["statm_seiten"]), None)
    print(f"  Seitengroesse der Box   : {seite} Byte "
          f"(llmwiki pi5-hat-16k-seiten)")
    if not kandidat or not seite:
        print("  16-KB-Probe             : NICHT GEMESSEN (kein statm gelesen)")
        return
    echt = kandidat["statm_seiten"] * seite // 1024
    falsch = kandidat["statm_seiten"] * 4096 // 1024
    status = kandidat["rss_kb"]
    urteil = "deckt sich" if abs(echt - status) <= max(64, status // 50) else "WEICHT AB"
    print(f"  16-KB-Probe an PID {kandidat['pid']:<6}: statm x {seite} = {echt} kB "
          f"({urteil} mit VmRSS {status} kB), statm x 4096 = {falsch} kB "
          f"-> Faktor {status / falsch:.1f} daneben")
    print("  smaps_rollup und status zaehlen kB, nicht Seiten — dort greift "
          "die Falle nicht.")


def bericht(laeufe: list[dict], einzeln: bool) -> int:
    erste = laeufe[0]
    print(f"\nKIOSK-SPEICHER, PSS — Schalter mupibox.kioskBrowser = {erste['schalter']}")
    _seitenfalle(erste)
    print(f"  {erste['uptime']}")

    print("\n  Messreihe (PSS = geteilte Seiten anteilig; RSS zaehlt sie mehrfach):")
    print(f"    {'Zeit':<20} {'Familie':<10} {'Proz.':>5} {'PSS':>9} {'RSS':>9}"
          f"   {'free belegt':>11} {'Swap':>7}")
    bilanzen = []
    for lauf in laeufe:
        b = _bilanz(lauf)
        bilanzen.append(b)
        f = lauf["free"]
        erste_zeile = True
        for name, w in b.items():
            fehlt = f"  ({w['ohne_pss']} ohne PSS!)" if w["ohne_pss"] else ""
            print(f"    {lauf['zeit'] if erste_zeile else '':<20} {name:<10} "
                  f"{w['n']:>5} {w['pss_kb']//1024:>6} MB {w['rss_kb']//1024:>6} MB"
                  f"   {f.get('belegt', 0)//1024 if erste_zeile else '':>8}"
                  f"{' MB' if erste_zeile else '':<3}"
                  f"{f.get('swap_belegt', 0)//1024 if erste_zeile else '':>5}"
                  f"{' MB' if erste_zeile else ''}{fehlt}")
            erste_zeile = False

    # WELCHE HAELFTE LAEUFT HIER UEBERHAUPT? Das darf nicht fest verdrahtet
    # sein: unter Cog gibt es keinen Chromium und keinen X-Server, und eine
    # fest auf "Chromium + Xorg" gerechnete Summe waere dann 0 MB — eine
    # Zahl, die aussieht wie ein Ergebnis und keines ist. Der Vergleich
    # richtet sich deshalb danach, was gemessen wurde.
    vorhanden = {n for b in bilanzen for n in b}
    if vorhanden & {"Chromium", "Xorg"} and "Cog/WPE" not in vorhanden:
        seite, teile, band = "Chromium + Xorg", ("Chromium", "Xorg"), ALT["chromium_mb"]
    elif "Cog/WPE" in vorhanden and not vorhanden & {"Chromium", "Xorg"}:
        seite, teile, band = "Cog/WPE", ("Cog/WPE",), ALT["cog_mb"]
    else:
        seite, teile, band = None, tuple(vorhanden), None

    if seite is None:
        print(f"\n  KEIN EINDEUTIGER KIOSK: gefunden wurden {', '.join(sorted(vorhanden))}. "
              f"Waehrend eines Wechsels oder eines Rueckfalls laufen beide "
              f"kurz nebeneinander — dann ist keine Summe mit der alten "
              f"Aussage vergleichbar. Spaeter noch einmal messen.")
        summen = []
    else:
        print(f"\n  Kiosk gesamt ({seite}, so wie 20.08.2026 gezaehlt):")
        summen = []
        for lauf, b in zip(laeufe, bilanzen):
            pss = sum(w["pss_kb"] for n, w in b.items() if n in teile)
            rss = sum(w["rss_kb"] for n, w in b.items() if n in teile)
            summen.append(pss // 1024)
            print(f"    {lauf['zeit']}   PSS {pss//1024:>4} MB   (RSS {rss//1024} MB, "
                  f"also {rss/max(pss,1):.2f}-fach zu hoch)")

    print(f"\n  GEGEN DIE ALTE AUSSAGE ({ALT['quelle']}):")
    print(f"    damals Chromium+Xorg {ALT['chromium_mb'][0]}-{ALT['chromium_mb'][1]} MB PSS, "
          f"Cog {ALT['cog_mb'][0]}-{ALT['cog_mb'][1]} MB PSS, Unterschied ~{ALT['abstand_mb']} MB")
    if summen and band:
        lo, hi = min(summen), max(summen)
        spanne = f"{lo} MB" if lo == hi else f"{lo}-{hi} MB"
        print(f"    heute  {seite} {spanne} PSS  ({len(summen)} Messung(en))")
        a, b_ = band
        if hi < a:
            print(f"    -> diese Haelfte liegt {a - hi}-{b_ - lo} MB NIEDRIGER als "
                  f"damals. Die alte Differenz ist damit eine OBERGRENZE, "
                  f"keine heutige Zahl.")
        elif lo > b_:
            print(f"    -> diese Haelfte liegt {lo - b_}-{hi - a} MB HOEHER als damals.")
        else:
            print("    -> diese Haelfte liegt im damaligen Band.")
        gegen = ALT["cog_mb"] if seite.startswith("Chromium") else ALT["chromium_mb"]
        # Erst Betrag, DANN sortieren: bei umgekehrtem Vorzeichen (die andere
        # Haelfte waere groesser) kehrte sich die Reihenfolge sonst um und die
        # Zeile laese sich „190 bis 174".
        d1, d2 = sorted(abs(x) for x in (lo - gegen[1], hi - gegen[0]))
        print(f"    -> rechnerischer Abstand zur ANDEREN Haelfte, deren damalige "
              f"Zahl dabei unterstellt wird: {d1} bis {d2} MB.")
        print(f"    ACHTUNG: die andere Haelfte ist NICHT von heute. Sie "
              f"herzustellen hiesse, den laufenden Kiosk umzustellen.")

    if einzeln:
        print("\n  Einzelprozesse des letzten Laufs (nach PSS):")
        for p in sorted(laeufe[-1]["prozesse"], key=lambda x: -(x["pss_kb"] or 0)):
            pss = f"{p['pss_kb']/1024:8.1f} MB" if p["pss_kb"] is not None else "  NICHT GEMESSEN"
            print(f"    {p['pid']:>7}  {p['comm']:<18} PSS {pss}   "
                  f"RSS {(p['rss_kb'] or 0)/1024:8.1f} MB")

    ohne = sum(w["ohne_pss"] for b in bilanzen for w in b.values())
    if ohne:
        print(f"\n  {ohne} Prozess(e) ohne PSS — `sudo -n` hat dort nicht "
              f"gegriffen. Die Summen sind damit ZU NIEDRIG, nicht ungenau.")
        return 2
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    p.add_argument("--box", required=True, metavar="ZIEL",
                   help="z. B. dietpi@192.168.178.62 — wird NUR gelesen")
    p.add_argument("--wdh", type=int, default=2,
                   help="Messungen (Vorgabe 2 — einmal hinsehen ist keine Messung)")
    p.add_argument("--abstand", type=int, default=600,
                   help="Sekunden zwischen den Messungen (Vorgabe 600)")
    p.add_argument("--einzeln", action="store_true",
                   help="zusaetzlich jeden Prozess einzeln auflisten")
    a = p.parse_args()

    laeufe = []
    for i in range(max(1, a.wdh)):
        if i:
            print(f"  … {a.abstand} s Abstand (llmwiki "
                  f"einmal-hinsehen-ist-keine-messung)", flush=True)
            time.sleep(max(0, a.abstand))
        lauf = einmal(a.box)
        if lauf is None:
            return 2
        if not lauf["prozesse"]:
            print(f"NICHT GEMESSEN: kein Kiosk-Prozess auf {a.box} gefunden.")
            return 2
        print(f"  gemessen {lauf['zeit']}  ({len(lauf['prozesse'])} Prozesse)", flush=True)
        laeufe.append(lauf)
    return bericht(laeufe, a.einzeln)


if __name__ == "__main__":
    sys.exit(main())
