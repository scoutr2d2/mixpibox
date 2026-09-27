#!/usr/bin/env python3
"""
Headless-Smoketest des SD-Assistenten (controller/tui_sd.py) mit Textual run_test().

Faehrt den ganzen Assistenten durch — Board -> Variante -> Karte -> Einstellungen ->
Bestaetigung — mit der ECHTEN (live geholten) Bildliste, aber GEFAELSCHTEN Geraeten
und im TROCKENLAUF: es wird garantiert nichts geschrieben. Wichtigster Punkt: die
Systemplatte darf NIE zur Auswahl stehen.

  pip install textual pyyaml
  python3 tests/sdtui_smoke.py        # 17 Checks, exit 0 = alles gruen
"""
import asyncio, os, sys
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO+"/controller")
import tui_sd, sdprep
from textual.widgets import ListView, RichLog, Input

# Geräte fälschen (keine echte Karte im Rechner) — der Sicherheitsfilter bleibt aktiv
FAKE = {"blockdevices":[
 {"name":"nvme0n1","path":"/dev/nvme0n1","size":"1,8T","model":"System SSD","tran":"nvme",
  "rm":False,"hotplug":False,"type":"disk","mountpoints":[],
  "children":[{"name":"p2","path":"/dev/nvme0n1p2","type":"part","mountpoints":["/","/home"]}]},
 {"name":"mmcblk0","path":"/dev/mmcblk0","size":"29,7G","model":"SD32G","tran":"mmc",
  "rm":True,"hotplug":True,"type":"disk","mountpoints":[]}]}
sdprep.list_block_devices = lambda: FAKE
# WLANs faelschen: der Test soll nicht davon abhaengen, was gerade funkt.
sdprep.wifi_secret = lambda ssid: "aus-dem-rechner" if ssid == "Heimnetz" else ""
sdprep.wifi_active = lambda: "Heimnetz"
sdprep.wifi_networks = lambda: [
    {"ssid": "Heimnetz", "signal": 81, "security": "WPA2", "gespeichert": True},
    {"ssid": "Nachbar",  "signal": 33, "security": "WPA2", "gespeichert": False}]

def log(scr): return "\n".join(str(getattr(s,'text',s)) for s in scr.query_one(RichLog).lines)

async def main():
    app = tui_sd.SdApp(write=False)   # ohne --write: Schreiben nur nach Abtippen
    res = []
    def chk(n, c): res.append((n, c))
    async with app.run_test(size=(120, 36)) as p:
        # Der Assistent ist seit dem Umbau ein SCHIEBBARER Screen (damit die
        # Haupt-TUI ihn als Schritt 0 einblenden kann), sein Zustand liegt also
        # auf dem Screen, nicht auf der App.
        await p.pause(0.2)
        scr = app.screen
        for _ in range(60):                      # auf die Live-Bildliste warten
            await p.pause(0.25)
            if scr.entries: break
        chk("Bildliste live geladen", len(scr.entries) > 100)
        chk("Schritt 1 = Board", scr.stage == 0)
        chk("RPi5 wird angeboten", any("RPi5" in i[0] for i in scr._items))
        i = next(k for k,it in enumerate(scr._items) if it[1]=="RPi5")
        scr.query_one(ListView).index = i
        await p.press("enter"); await p.pause(0.4)
        chk("Schritt 2 = Variante", scr.stage == 1)
        chk("Trixie steht oben (Standard)", "Trixie" in scr._items[0][0])
        await p.press("enter"); await p.pause(0.5)
        chk("Image gewählt = RPi5 Trixie", scr.image and scr.image["file"]=="DietPi_RPi5-ARMv8-Trixie.img.xz")
        chk("Schritt 3 = Karte", scr.stage == 2)
        chk("nur die SD-Karte angeboten", [i[1].get("path") for i in scr._items]==["/dev/mmcblk0"])
        chk("Systemplatte als gesperrt protokolliert", "/dev/nvme0n1" in log(scr) and "System" in log(scr))
        await p.press("enter"); await p.pause(0.4)
        chk("Schritt 4 = Einstellungen", scr.stage == 3)
        # Die WLAN-Liste kommt aus einem Arbeiter -> kurz warten.
        for _ in range(20):
            await p.pause(0.2)
            if len(getattr(scr, "_items", [])) > 1: break
        chk("WLANs werden angeboten", any("Heimnetz" in i[0] for i in scr._items))
        chk("das AKTIVE Netz ist eigens markiert",
            any(i[0].startswith("»") and "Heimnetz" in i[0]
                and "online" in i[0] for i in scr._items))
        chk("LAN bleibt waehlbar", scr._items[0][1] == "")
        k = next(x for x,it in enumerate(scr._items) if it[1] == "Heimnetz")
        scr.query_one(ListView).index = k
        scr.query_one(ListView).focus()
        await p.press("enter"); await p.pause(0.3)
        chk("Auswahl fuellt die SSID", scr.query_one("#f_ssid", Input).value == "Heimnetz")
        chk("und holt das gespeicherte Passwort gleich mit",
            scr.query_one("#f_wifikey", Input).value == "aus-dem-rechner")
        chk("beim AKTIVEN Netz gilt der Schluessel als bewiesen",
            "GERADE online" in log(scr))
        chk("Passwort steht NICHT im Protokoll", "aus-dem-rechner" not in log(scr))
        chk("bleibt in Schritt 4 (kein Weiterspringen)", scr.stage == 3)

        scr.query_one("#f_host", Input).value = "mupibox5"
        scr.query_one("#f_pass", Input).value = "geheim"
        scr.query_one("#f_ssid", Input).value = "MeinWLAN"
        scr.query_one("#f_wifikey", Input).value = "wpa-key"
        scr.query_one("#f_host", Input).focus()
        await p.press("enter"); await p.pause(0.4)
        chk("Schritt 5 = Bestätigen", scr.stage == 4)
        chk("Einstellungen übernommen", scr.cfg["hostname"]=="mupibox5" and scr.cfg["ssid"]=="MeinWLAN")
        t = log(scr)
        chk("Zusammenfassung nennt das Ziel", "/dev/mmcblk0" in t)
        chk("Schreib-Freigabe angekündigt", "Geraetename" in t)
        chk("sagt: nur der Agent wird installiert", "nur der Agent" in t)
        chk("Abbrechen ist wählbar", any(i[1] is False for i in scr._items))

        before = app.theme
        await p.press("t"); await p.pause(0.2)
        chk("Theme wechselbar", app.theme != before)

        # Schreib-Freigabe: "JA" darf ohne --write NICHT sofort losschreiben,
        # sondern muss ein ZWEITES Mal fragen — mit "Abbrechen" vorn, damit ein
        # versehentliches Enter abbricht statt zu loeschen.
        j = next(k for k,it in enumerate(scr._items) if it[1] is True)
        scr.query_one(ListView).index = j
        await p.press("enter"); await p.pause(0.4)
        chk("JA schreibt nicht sofort", scr.allow_write is False and scr.busy is False)
        chk("es wird ein zweites Mal gefragt",
            any(it[1] == "SCHREIBEN" for it in scr._items))
        chk("Abbrechen steht VORNE", scr._items[0][1] is False)
        chk("Warnung nennt das Ziel", "/dev/mmcblk0" in log(scr))
        # Abbrechen fuehrt zurueck zur Kartenauswahl, ohne etwas zu tun
        scr.query_one(ListView).index = 0
        await p.press("enter"); await p.pause(0.4)
        chk("Abbrechen schreibt nicht", scr.allow_write is False and scr.busy is False)
        chk("und fuehrt zurueck zur Karte", scr.stage == 2)

        # Fortschritt steht FEST und scrollt nicht: eine eigene Fläche, die an
        # Ort und Stelle überschrieben wird. Arbeit dafür stilllegen — hier wird
        # nichts geschrieben und nichts geladen.
        scr._work = lambda: None
        scr._start_work()
        await p.pause(0.4)
        from textual.widgets import Static as _St
        werk = scr.query_one("#work", _St)
        chk("Fortschrittsfläche erscheint", werk.display is True)
        zeilen_vorher = len(scr.query_one(RichLog).lines)
        scr.zeige_arbeit("Auf die Karte schreiben", 500, 1000)
        txt = str(werk.render())
        chk("Balken zeigt den Anteil", "50.0 %" in txt or "50,0 %" in txt)
        chk("Phase steht dabei", "Auf die Karte schreiben" in txt)
        chk("Balken ist gefüllt und leer", "█" in txt and "░" in txt)
        scr.zeige_arbeit(None, 900, None)
        chk("wird an Ort und Stelle überschrieben", "90.0 %" in str(werk.render()))
        # Der Arbeitsfaden MERKT nur; gezeichnet wird im Takt. Sonst löst jeder
        # Download-Block ein Neuzeichnen aus und das Bild läuft über sich selbst.
        scr.setze_arbeit("Andere Phase", 250, 1000)
        chk("Melden zeichnet NICHT sofort", "90.0 %" in str(werk.render()))
        scr._tick()
        chk("der Takt zeichnet es dann", "25.0 %" in str(werk.render()))
        chk("und scrollt das Protokoll NICHT voll",
            len(scr.query_one(RichLog).lines) == zeilen_vorher)
        scr._arbeit_fertig()
        chk("am Ende ein ruhiger Endzustand", "—" in str(werk.render()) or "fertig" in str(werk.render()))

        # Notausfahrt: waehrend der Arbeit warnt das erste q nur, das zweite
        # schliesst trotzdem — sonst sperrt eine haengende Arbeit den Assistenten
        # dauerhaft zu.
        scr.busy = True
        scr.action_close()
        chk("erstes q warnt nur", scr.busy is True and "nochmal" in log(scr))
        chk("Warnung nennt die Folge", "unvollstaendig" in log(scr))
        scr.action_close()
        chk("zweites q kommt trotzdem raus", "abgebrochen" in log(scr))
        scr.busy = False

    # ── Die Haken muessen SICHTBAR sein, nicht nur vorhanden ───────────────
    # Sie standen alle im Baum und waren trotzdem nicht zu finden: `height:
    # auto` liess den Block ueber den Schirm hinauswachsen, und was unten
    # herausfiel, war ohne Balken und ohne Hinweis einfach weg. Auf 80x24 —
    # der Vorgabe — betraf das "Einrichtung per Handy" und "Lauf ohne PC".
    for groesse, mindestens in (((120, 40), 4), ((100, 30), 4), ((80, 24), 3)):
        app2 = tui_sd.SdApp(write=False)
        async with app2.run_test(size=groesse) as p2:
            scr2 = app2.screen
            scr2.form("Einstellungen")
            await p2.pause()
            block = scr2.query_one("#form")
            sicht = []
            for wid in ("f_debug", "f_diag", "f_handy", "f_lauf"):
                r = scr2.query_one("#" + wid).region
                if r.height > 0 and r.y + r.height <= groesse[1]:
                    sicht.append(wid)
            chk(f"{groesse[0]}x{groesse[1]}: mind. {mindestens} Haken sichtbar ({len(sicht)})",
                len(sicht) >= mindestens)
            chk(f"{groesse[0]}x{groesse[1]}: »Einrichtung per Handy« ist zu sehen",
                "f_handy" in sicht)
            # LESBAR, nicht nur an der richtigen Stelle. `height: 1` liess
            # Textual den Rahmen behalten und die BESCHRIFTUNG wegschneiden —
            # auf dem Schirm standen leere Kaestchen, und die Position stimmte
            # dabei tadellos. Deshalb wird hier das gerenderte Bild gelesen.
            bild = "\n".join("".join(seg.text for seg in strip)
                             for strip in scr2._compositor.render_strips())
            for wid, wort in (("f_handy", "Einrichtung per Handy"),
                              ("f_lauf", "Lauf ohne PC")):
                if wid in sicht:
                    chk(f"{groesse[0]}x{groesse[1]}: »{wort}« steht wirklich da",
                        wort in bild)
            if len(sicht) < 4:
                chk(f"{groesse[0]}x{groesse[1]}: der Rest ist ueber den Balken erreichbar",
                    block.max_scroll_y > 0)

    print("\n--- SD-TUI ---")
    bad = 0
    for n,c in res:
        print(("  \033[32mOK  \033[0m" if c else "  \033[31mFAIL\033[0m")+"  "+n); bad += (not c)
    print(f"\n{len(res)-bad}/{len(res)} bestanden")
    return bad
sys.exit(1 if asyncio.run(main()) else 0)
