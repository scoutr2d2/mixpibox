#!/usr/bin/env python3
"""Chromium gegen Cog — beide Kiosk-Browser unter denselben Bedingungen messen.

    python3 tools/kiosk-benchmark.py --box 192.168.178.57
    python3 tools/kiosk-benchmark.py --box 192.168.178.57 --nur cog
    python3 tools/kiosk-benchmark.py --box 192.168.178.57 --ruhe 300

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 20.08.2026: „sparen wir jetzt speicher jetzt bin ich mir unsicher
ich wuerde gerne mal einen benchmark laufen lassen neu vs alt in bootzeit,
speicher, auch geschwindikeit reation."

Die Unsicherheit ist berechtigt. Die Zahlen, die bis dahin im Raum standen
(511 MB gegen 331 MB), waren MOMENTAUFNAHMEN kurz nach dem Start — und
gerade Chromium waechst mit der Laufzeit. Eine Messung, die nur einmal
hinsieht, sagt ueber den Alltag der Box wenig.

══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
  ZEIT BIS ZUM BILD   Vom Kiosk-Neustart bis die Seite sich meldet. Nicht die
                      Bootzeit der Box: die enthaelt Kernel, Netz und Dienste
                      und waere fuer beide Browser gleich — sie wuerde den
                      Unterschied VERDECKEN. Mit --reboot laesst sich die
                      volle Bootzeit zusaetzlich messen.
  SPEICHER            PSS, MEHRFACH ueber die Ruhezeit. Der erste Wert ist
                      der Anlauf, der letzte der Alltag. Beide werden
                      genannt, denn die Differenz ist die eigentliche
                      Auskunft.
  CPU IM LEERLAUF     Aus /proc/stat ueber dieselbe Spanne. Ein Browser, der
                      im Leerlauf rechnet, kostet Akku und macht die Box
                      langsamer, ohne dass es im Speicher auffaellt.
  BILDRATE            requestAnimationFrame-Zaehler in der Seite.
  EINGABE-REAKTION    Zeit von einem Zeiger-Ereignis bis zum naechsten Bild.
                      Das ist die Zahl, die „fuehlt sich traege an" am
                      naechsten kommt.

══ WARUM EINE SONDE IN DER SEITE ══════════════════════════════════════════
Cog spricht kein CDP. Alles, was nur Chromium beantworten kann, waere hier
wertlos — es gaebe eine Spalte mit Zahlen und eine mit Strichen. Die Sonde
laeuft IN der Seite, misst in beiden Browsern dasselbe und meldet per fetch
an einen kleinen Mithoerer auf der Box; dessen Zugriffsprotokoll ist die
Messreihe.

══ OFFEN: BILDRATE UND REAKTIONSZEIT (Stand 20.08.2026) ═══════════════════
Die Meldung BEIM LADEN kommt zuverlaessig an — die Zeit bis zum Bild ist
damit gemessen. Die TAKT-Meldungen alle 5 s kommen nicht an, und zwar nach
drei behobenen Fehlern immer noch:
    1. Der Mithoerer schrieb gepuffert; beim Beenden ging alles verloren (-u).
    2. `pkill -f 'http.server 8124'` traf die eigene Befehlszeile — die Shell
       erschoss sich, bevor sie den Mithoerer startete (jetzt `fuser -k`).
    3. `messePunkt()` lief vor `melde()`; ein Wurf dort verschluckte den Takt.
Ein direkter Gegenversuch mit einer MINIMALEN Sonde (nur fetch + rAF-Zaehler)
lief einwandfrei und meldete unter Cog 249 Bilder in 4 s, also rund 62/s.
Die Bildrate ist also messbar; diese Sonde erreicht sie nur nicht. Der
Unterschied liegt im `melde()` dieser Datei und ist noch nicht gefunden.
BIS DAHIN STEHT DORT „nicht gemessen" UND KEINE ZAHL. Ein Strich, den man
erklaeren kann, ist besser als ein Wert, den man nicht belegen kann.

══ WAS ES NICHT MISST — und das ist wichtig ═══════════════════════════════
NICHT die Reaktion auf einen echten Finger. Zwischen Fingerkuppe und
Zeiger-Ereignis liegen Touchcontroller, I2C und die Touch-Bruecke; die sind
in beiden Faellen dieselben, aber sie sind nicht Null. Gemessen wird, was
der BROWSER daraus macht.
NICHT die Bildqualitaet, nicht das Verhalten der Bedienelemente. Dass unter
WebKit Regler anders reagieren, steht im Wiki und faellt in keiner
Speicherzahl auf.

Der Lauf stellt am Ende ZURUECK, was er vorgefunden hat — auch wenn er
abgebrochen wird.
"""

import argparse
import json
import re
import shlex
import subprocess
import sys
import time

SONDE = r"""
/* MESS-SONDE (kiosk-benchmark.py, nur waehrend der Messung eingehaengt). */
;(() => {
  const start = Date.now()
  let bilder = 0
  let reaktionen = []
  const takt = () => { bilder++; requestAnimationFrame(takt) }
  requestAnimationFrame(takt)

  // EINGABE-REAKTION: die Seite loest selbst ein Zeiger-Ereignis aus und
  // misst, wie lange es bis zum naechsten Bild dauert. Ein echter Finger ist
  // damit nicht nachgestellt - der Weg vom Touchcontroller bis hierher fehlt.
  // Gemessen wird, was der BROWSER aus einem Ereignis macht.
  const messePunkt = () => {
    const ziel = document.body
    const t0 = performance.now()
    ziel.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 99, isPrimary: true,
      clientX: 5, clientY: 5,
    }))
    requestAnimationFrame(() => {
      reaktionen.push(Math.round((performance.now() - t0) * 100) / 100)
      if (reaktionen.length > 20) reaktionen.shift()
    })
  }

  const melde = (art) => {
    const n = performance.getEntriesByType('navigation')[0] || {}
    const felder = {
      art,
      seit: Date.now() - start,
      bilder,
      ladezeit: Math.round(n.duration || 0),
      domBereit: Math.round(n.domContentLoadedEventEnd || 0),
      reaktionen: reaktionen.join(','),
      breite: window.innerWidth,
      hoehe: window.innerHeight,
      motor: navigator.userAgent.includes('Chrome') ? 'blink' : 'webkit',
    }
    const q = Object.entries(felder).map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&')
    fetch('http://127.0.0.1:8124/mess?' + q, { mode: 'no-cors' }).catch(() => {})
  }

  melde('geladen')
  // ERST MELDEN, DANN MESSEN - und die Messung eingepackt.
  // GEMESSEN am 20.08.2026: hier stand `messePunkt(); melde('takt')`. Wirft
  // der erste Aufruf (PointerEvent baut nicht jede Maschine gleich), wird der
  // zweite NIE erreicht. Ergebnis: die Meldung beim Laden kam an - die Zeit
  // bis zum Bild wurde also sauber gemessen -, aber kein einziger Takt.
  // Bildrate und Reaktionszeit standen zwei Laeufe lang als "nicht gemessen"
  // da, und es sah aus, als koenne die Sonde nichts. Sie konnte alles; sie
  // kam nur nie bis dorthin. Derselbe Fehlertyp wie beim Schieberegler am
  // selben Tag: ein Wurf mitten in einer Kette hinterlaesst keine Spur.
  setInterval(() => {
    melde('takt')
    bilder = 0
    try { messePunkt() } catch (e) { /* diese Maschine kann es nicht - der Rest misst weiter */ }
  }, 5000)
})()
"""


def opt():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="192.168.178.57", help="Adresse der Box")
    p.add_argument("--nutzer", default="dietpi")
    p.add_argument("--ruhe", type=int, default=180, help="Sekunden Ruhezeit je Browser (Vorgabe 180)")
    p.add_argument("--nur", choices=["chromium", "cog"], help="nur einen Browser messen")
    p.add_argument("--reboot", action="store_true", help="zusaetzlich die volle Bootzeit messen (dauert)")
    p.add_argument("--trotzdem", action="store_true",
                   help="auch messen, wenn Ton laeuft (verfaelscht CPU und Speicher)")
    return p.parse_args()


class Box:
    def __init__(self, ziel: str):
        self.ziel = ziel

    def __call__(self, befehl: str, frist: int = 60) -> str:
        fertig = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", self.ziel, befehl],
            capture_output=True, text=True, timeout=frist,
        )
        return fertig.stdout.strip()


def sonde_einhaengen(box: Box, an: bool) -> None:
    """Die Sonde in die ausgelieferte Seite haengen — und wieder heraus.

    UEBER EINE SICHERUNG UND NICHT PER TEXTERSATZ ZURUECK: Wer die Zeile mit
    sed wieder herausschneidet, hat beim dritten Lauf eine index.html, die
    sich von der ausgelieferten unterscheidet, ohne dass es jemand sieht.
    """
    w = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/neu"
    if an:
        box(f"cp -n {w}/index.html {w}/index.html.vor-bench")
        box(f"cat > {w}/mess-sonde.js <<'ENDE'\n{SONDE}\nENDE")
        box(
            f"python3 - <<'PY'\n"
            f"p='{w}/index.html'\n"
            f"t=open(p).read()\n"
            f"if 'mess-sonde.js' not in t:\n"
            f"    open(p,'w').write(t.replace('</body>', '<script src=\"mess-sonde.js\"></script>\\n</body>'))\n"
            f"PY"
        )
        # `-u` IST NICHT ZIERAT (gemessen 20.08.2026): ohne den Schalter
        # schreibt python3 sein Zugriffsprotokoll GEPUFFERT, sobald stderr in
        # eine Datei geht. Beim Aufraeumen killt dieses Werkzeug den Server —
        # und mit ihm den Puffer. Ergebnis des ersten Laufs: die Datei war am
        # Ende LEER, Bildrate und Reaktionszeit standen als „—" da, waehrend
        # die Speicherzahlen (die aus ps kommen) tadellos waren. Eine Messung,
        # die zur Haelfte fehlt, sieht aus wie eine, die nichts gefunden hat.
        # ══ DEN PORT FREIMACHEN, NICHT „ALLES MIT DIESEM NAMEN" ═════════════
        # Hier stand `pkill -f 'http.server 8124'`. Das Muster steht in der
        # eigenen Befehlszeile — die Shell erschoss sich selbst, BEVOR sie den
        # Mithoerer startete. Danach lauschte niemand, keine Meldung kam an,
        # und das Werkzeug lieferte zwei Laeufe lang „nicht gemessen".
        # llmwiki `pkill-toetet-die-eigene-shell` beschreibt genau das; hier
        # ist es einmal mehr passiert, weil der Name im Muster steckte.
        # `fuser -k <port>/tcp` trifft nur, wer den Port wirklich haelt.
        box("fuser -k 8124/tcp 2>/dev/null; "
            "setsid python3 -u -m http.server 8124 --bind 127.0.0.1 --directory /tmp "
            "</dev/null >/tmp/mess-http.log 2>&1 & sleep 2")
        # ══ DIE EIGENE MESSKETTE PRUEFEN, BEVOR GEMESSEN WIRD ═══════════════
        # (E57, 20.08.2026 — drei Laeufe gekostet.) Der Mithoerer startete
        # nicht, und das Werkzeug merkte es nicht: `pgrep -cf 'http.server
        # 8124'` fand einen Treffer und meldete „laeuft" — den eigenen
        # ssh-Befehl, in dessen Zeile die Zeichenkette steht. Dieselbe Falle
        # wie bei pkill (llmwiki pkill-toetet-die-eigene-shell).
        # Geprueft wird deshalb, was zaehlt: ob jemand ANTWORTET. Und es wird
        # LAUT gescheitert — eine Messung, deren halbe Reihe fehlt, sieht aus
        # wie eine, die nichts gefunden hat.
        antwort = box(
            "curl -s -o /dev/null -w '%{http_code}' --max-time 4 "
            "'http://127.0.0.1:8124/probe' 2>/dev/null; true"
        )
        if not antwort.strip().isdigit() or antwort.strip() == "000":
            raise SystemExit(
                "Der Mithoerer auf 127.0.0.1:8124 nimmt nichts an "
                f"(curl meldet {antwort.strip() or 'nichts'}).\n"
                "Ohne ihn gaebe es keine Bildrate und keine Reaktionszeit — "
                "und das Werkzeug wuesste es nicht. Abgebrochen, statt die "
                "halbe Messung als Ergebnis auszugeben."
            )
    else:
        box(f"[ -f {w}/index.html.vor-bench ] && mv {w}/index.html.vor-bench {w}/index.html")
        box(f"rm -f {w}/mess-sonde.js")
        box("fuser -k 8124/tcp 2>/dev/null; true")


def prozesse(box: Box, browser: str) -> tuple[int, int]:
    """(Speicher in MB als PSS, Anzahl Prozesse) — inklusive X-Server."""
    muster = "cog|WPE" if browser == "cog" else "chromium|Xorg"
    roh = box(
        "T=0; N=0; "
        f"for p in $(pgrep -f '{muster}'); do "
        "v=$(sudo -n awk '/^Pss:/{print $2}' /proc/$p/smaps_rollup 2>/dev/null); "
        "T=$((T+${v:-0})); N=$((N+1)); done; echo \"$((T/1024)) $N\""
    )
    try:
        a, b = roh.split()
        return int(a), int(b)
    except ValueError:
        return 0, 0


def cpu_stand(box: Box) -> tuple[int, int]:
    """(Arbeit, Gesamt) aus /proc/stat — die Differenz zweier Staende zaehlt."""
    roh = box("awk '/^cpu /{s=0; for(i=2;i<=NF;i++) s+=$i; print s, $5}' /proc/stat")
    try:
        gesamt, leerlauf = roh.split()
        return int(gesamt) - int(leerlauf), int(gesamt)
    except ValueError:
        return 0, 0


def messreihe(box: Box) -> list[dict]:
    """Was die Sonde gemeldet hat, aus dem Zugriffsprotokoll des Mithoerers."""
    roh = box("grep -oE 'mess\\?[^ ]*' /tmp/mess-http.log 2>/dev/null | tail -40")
    aus = []
    for zeile in roh.splitlines():
        d = {}
        for paar in zeile[5:].split("&"):
            if "=" not in paar:
                continue
            k, _, v = paar.partition("=")
            d[k] = re.sub(r"%(..)", lambda m: chr(int(m.group(1), 16)), v)
        if d:
            aus.append(d)
    return aus


def messen(box: Box, browser: str, ruhe: int) -> dict:
    print(f"\n══ {browser.upper()} ══")
    box(f"sudo -n /usr/bin/jq '.mupibox.kioskBrowser = \"{browser}\"' /etc/mupibox/mupiboxconfig.json "
        "> /tmp/kb.json && sudo -n mv /tmp/kb.json /etc/mupibox/mupiboxconfig.json")
    # AUCH CHROMIUM (E68/C2): hier wird der Browser GEWECHSELT, also muss
    # der vorherige weg — sonst ueberlebt ein laufender Chromium den
    # Wechsel und die Messung misst zwei Browser.
    box("sudo -n pkill -9 -x 'chromium[a-z-]*' 2>/dev/null; "
        "sudo -n pkill -9 -x cog 2>/dev/null; sudo -n pkill -9 -f WPEWebProcess 2>/dev/null; "
        "sudo -n pkill -x xinit 2>/dev/null; true")
    box("truncate -s 0 /tmp/mess-http.log 2>/dev/null; true")
    time.sleep(3)

    cpu_vor = cpu_stand(box)
    t0 = time.time()
    box("sudo -n systemctl restart getty@tty1")

    # ZEIT BIS ZUM BILD: gewartet wird auf die MELDUNG DER SEITE, nicht auf
    # den Prozess. Ein laufender Prozess ohne Bild ist genau der Zustand, der
    # im Versuch eine halbe Stunde gekostet hat.
    bis_bild = None
    while time.time() - t0 < 90:
        # ALS ZAHL PRUEFEN UND NICHT ALS TEXT (E57, 20.08.2026).
        # Hier stand `grep -c ... || echo 0` und ein Vergleich gegen "0". Bei
        # einer LEEREN Datei gibt grep aber "0" aus UND liefert Exit 1 —
        # `|| echo 0` haengte ein zweites "0" an, und "0\n0" ist nun einmal
        # ungleich "0". Die Bedingung galt damit im ERSTEN Schleifendurchlauf
        # als erfuellt, und gemessen wurde die Dauer eines SSH-Aufrufs.
        # Herausgekommen sind 0,4 bis 0,7 s — Zahlen, die plausibel aussahen
        # und nichts bedeuteten. Eine falsche Zahl ist schlimmer als keine.
        roh = box("grep -c 'art=geladen' /tmp/mess-http.log 2>/dev/null; true")
        erste = roh.splitlines()[0].strip() if roh.splitlines() else "0"
        if erste.isdigit() and int(erste) > 0:
            bis_bild = round(time.time() - t0, 1)
            break
        time.sleep(1)
    print(f"  Zeit bis zum Bild: {bis_bild if bis_bild else 'NICHT gekommen (>90 s)'} s")

    speicher = []
    for i, wann in enumerate((30, ruhe // 2, ruhe)):
        while time.time() - t0 < wann:
            time.sleep(2)
        mb, n = prozesse(box, browser)
        speicher.append((wann, mb, n))
        print(f"  nach {wann:4d} s: {mb:4d} MB PSS über {n} Prozesse")

    cpu_nach = cpu_stand(box)
    d_arbeit = cpu_nach[0] - cpu_vor[0]
    d_gesamt = cpu_nach[1] - cpu_vor[1]
    cpu = round(100 * d_arbeit / d_gesamt, 1) if d_gesamt else 0.0
    print(f"  CPU über die Spanne: {cpu} %")

    reihe = messreihe(box)
    letzte = reihe[-1] if reihe else {}
    takte = [r for r in reihe if r.get("art") == "takt"]
    bilder = [int(r["bilder"]) for r in takte if r.get("bilder", "").isdigit()]
    bildrate = round(sum(bilder) / len(bilder) / 5, 1) if bilder else None
    reakt = []
    for r in takte:
        reakt += [float(x) for x in r.get("reaktionen", "").split(",") if x]
    print(f"  Bildrate im Leerlauf: {bildrate if bildrate is not None else '—'} /s")
    if reakt:
        reakt.sort()
        print(f"  Eingabe→Bild: Median {reakt[len(reakt) // 2]:.1f} ms, "
              f"schlechtester {reakt[-1]:.1f} ms ({len(reakt)} Messungen)")
    print(f"  Ladezeit der Seite: {letzte.get('ladezeit', '—')} ms, Motor: {letzte.get('motor', '—')}")

    return {
        "browser": browser,
        "bisBild": bis_bild,
        "speicher": speicher,
        "cpuProzent": cpu,
        "bildrate": bildrate,
        "reaktionMedian": round(reakt[len(reakt) // 2], 1) if reakt else None,
        "reaktionSchlechtester": round(reakt[-1], 1) if reakt else None,
        "ladezeit": letzte.get("ladezeit"),
        "motor": letzte.get("motor"),
    }


def main() -> int:
    a = opt()
    box = Box(f"{a.nutzer}@{a.box}")
    vorher = box("/usr/bin/jq -r '.mupibox.kioskBrowser // \"chromium\"' /etc/mupibox/mupiboxconfig.json")

    # SPIELT WIRKLICH ETWAS? ZWEI FEHLVERSUCHE STEHEN HINTER DIESER ZEILE,
    # beide am 20.08.2026:
    #   1. `/api/spotify/laeuft` -> `.aktiv` meldete `true`, waehrend NICHTS
    #      lief. mpv haengt als Dauerprozess mit `--idle=yes` herum.
    #   2. Die Zahl der sink-inputs zaehlen: es waren DREI, alle still. Ein
    #      Programm haelt seinen Strom offen, auch wenn es schweigt.
    # Was zaehlt, ist `Corked`: ein pausierter Strom ist kein spielender. Nur
    # ein Eingang mit `Corked: no` macht wirklich Ton.
    aktiv = box(
        "pactl list sink-inputs 2>/dev/null | grep -c 'Corked: no' || echo 0"
    ) or "0"
    if aktiv.isdigit() and int(aktiv) > 0 and not a.trotzdem:
        print(f"Es läuft gerade Ton auf der Box ({aktiv} spielende(r) Strom/Ströme) —")
        print("die Messung würde das unterbrechen. Anhalten, oder mit --trotzdem erzwingen.")
        return 2

    print(f"Box {a.box}, Ruhezeit je Browser {a.ruhe} s, Ausgangsstand: {vorher}")
    welche = [a.nur] if a.nur else ["chromium", "cog"]
    ergebnisse = []
    try:
        sonde_einhaengen(box, True)
        for b in welche:
            ergebnisse.append(messen(box, b, a.ruhe))
    finally:
        sonde_einhaengen(box, False)
        box(f"sudo -n /usr/bin/jq '.mupibox.kioskBrowser = \"{vorher}\"' /etc/mupibox/mupiboxconfig.json "
            "> /tmp/kb.json && sudo -n mv /tmp/kb.json /etc/mupibox/mupiboxconfig.json")
        # AUCH CHROMIUM (E68/C2) — siehe oben.
        box("sudo -n pkill -9 -x 'chromium[a-z-]*' 2>/dev/null; "
            "sudo -n pkill -9 -x cog 2>/dev/null; sudo -n pkill -x xinit 2>/dev/null; "
            "sudo -n systemctl restart getty@tty1; true")
        print(f"\nZurückgestellt auf: {vorher} (Kiosk neu gestartet)")

    if len(ergebnisse) == 2:
        c, g = ergebnisse[0], ergebnisse[1]
        print("\n══ GEGENÜBERSTELLUNG ══")
        print(f"{'':22} {'Chromium':>12} {'Cog':>12}   Unterschied")
        def zeile(name, wc, wg, einheit="", umgekehrt=False):
            if wc is None or wg is None:
                # NICHT GEMESSEN IST NICHT GLEICH — der Strich sagt, dass
                # dieser Zeuge fehlt, und nicht, dass es keinen Unterschied
                # gibt. Beim ersten Lauf standen hier vier Striche, weil ein
                # Puffer die halbe Messreihe verschluckt hatte.
                print(f"  {name:20} {'—':>12} {'—':>12}   nicht gemessen")
                return
            # GERUNDET, WEIL 0.6 - 0.4 IN GLEITKOMMA -0.19999999999999996 ist
            # und eine Tabelle mit siebzehn Nachkommastellen niemandem hilft.
            d = round(wg - wc, 2)
            wie = "besser" if (d < 0) != umgekehrt else "schlechter"
            print(f"  {name:20} {wc:>10}{einheit} {wg:>10}{einheit}   {d:+}{einheit} ({wie} für Cog)")
        zeile("Zeit bis zum Bild", c["bisBild"], g["bisBild"], " s")
        zeile("Speicher (Anlauf)", c["speicher"][0][1], g["speicher"][0][1], " MB")
        zeile("Speicher (Alltag)", c["speicher"][-1][1], g["speicher"][-1][1], " MB")
        zeile("CPU über die Spanne", c["cpuProzent"], g["cpuProzent"], " %")
        zeile("Bildrate", c["bildrate"], g["bildrate"], " /s", umgekehrt=True)
        zeile("Eingabe→Bild (Median)", c["reaktionMedian"], g["reaktionMedian"], " ms")
        wc = c["speicher"][-1][1] - c["speicher"][0][1]
        wg = g["speicher"][-1][1] - g["speicher"][0][1]
        print(f"\n  WACHSTUM über die Ruhezeit: Chromium {wc:+} MB, Cog {wg:+} MB")
        print("  (Ein Browser, der im Leerlauf wächst, kostet im Alltag mehr als die Startzahl sagt.)")

    print("\nNICHT gemessen: die Reaktion auf einen echten Finger (Touchcontroller,")
    print("I2C und Brücke liegen davor) und das Verhalten der Bedienelemente.")
    print(json.dumps(ergebnisse, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
