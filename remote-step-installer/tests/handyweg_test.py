#!/usr/bin/env python3
"""
Tests fuer den EINRICHTUNGSWEG OHNE LAPTOP — die Kette, nicht die Teile.

WORUM ES GEHT: Die Teile dieses Wegs (Einrichtungsbildschirm, eigenes WLAN,
Assistentenseite) waren am 02.08.2026 gebaut und einzeln getestet — und lagen
danach fuenf Tage lang NUR IM REPO. Kein Rezept kopierte sie auf eine Box,
keine Unit startete sie, und der Agent lauschte auf 127.0.0.1, wo ihn kein
Telefon je erreicht. Jeder Einzeltest war gruen; der Weg existierte trotzdem
nicht.

Deshalb pruefen die Tests hier ausdruecklich die VERDRAHTUNG:

  * bindet der Erstboot den Agenten ins LAN, wenn der Handy-Weg gewaehlt ist —
    und laesst er ihn sonst auf localhost?
  * kommen ALLE Teile auf die Karte, die der Bildschirm zum Laufen braucht?
    (er laedt seine Nachbarn ueber den eigenen Verzeichnispfad; fehlt einer,
    faellt er STILL aus)
  * traegt das Rezept dieselben Teile auf eine schon laufende Box?
  * sagt der Agent der Handy-Seite, wann die Box uebernehmen kann?

  python3 tests/handyweg_test.py
"""
import importlib.util
import os
import re
import socket
import sys
import tempfile
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "controller"))
ok = bad = 0


def pruefe(bedingung, was, hinweis=""):
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


def laden(name, pfad):
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


sdprep = laden("sdprep", os.path.join(REPO, "controller", "sdprep.py"))
agent = laden("agentmod", os.path.join(REPO, "agent", "agent.py"))

print("── 1. Der Agent muss im LAN lauschen, sonst erreicht ihn kein Handy")
laptop = sdprep.custom_script(agent_port=8099)
handy = sdprep.custom_script(agent_port=8099, handy=True)

pruefe("--host 127.0.0.1" in laptop,
       "ohne Handy-Weg bleibt der Agent auf localhost (SSH-Tunnel)")
pruefe("--host 0.0.0.0" in handy,
       "mit Handy-Weg lauscht er im LAN")
pruefe("--host 127.0.0.1" not in handy,
       "und dann NICHT mehr auf localhost — sonst haette die Zeile zwei Hosts")
# Der harte Fehlerdeckel ist die einzige Bremse, sobald der Tunnel wegfaellt.
# Faellt er weg, ist eine Million Codes im LAN in Minuten durchprobiert — bei
# einem Programm, das beliebige Befehle als root ausfuehrt.
pruefe(getattr(agent, "PAIR_MAX_FEHLER", 0) > 0,
       "der Pairing-Deckel existiert (er ist im LAN der einzige Schutz)",
       f"PAIR_MAX_FEHLER={getattr(agent, 'PAIR_MAX_FEHLER', None)}")
pruefe("mixpibox-einrichtung.service" in handy,
       "der Einrichtungsbildschirm wird eingeschaltet")
pruefe("mixpibox-einrichtung" not in laptop,
       "ohne Handy-Weg bleibt der Bildschirm aus")

print("\n── 2. Alles, was der Bildschirm braucht, kommt auf die Karte")
# Er laedt seine Nachbarn ueber HIER = eigener Verzeichnispfad. Was hier fehlt,
# faellt am Geraet mit einem dunklen Schirm auf — und mit sonst nichts.
NOETIG = ["einrichtung-schirm.py", "einrichtung-ap.py", "qr.py",
          "mupibox-boot-splash.py", "mixpi-hoert.png",
          "mixpibox-einrichtung.service"]
with tempfile.TemporaryDirectory() as d:
    geschrieben = sdprep.prepare_boot(d, password="pw", hostname="mixpibox",
                                      handy=True)
    edir = os.path.join(d, "einrichtung")
    pruefe(os.path.isdir(edir), "der Ordner einrichtung/ entsteht")
    for datei in NOETIG:
        pruefe(os.path.isfile(os.path.join(edir, datei)), f"  · {datei}")
    pruefe(os.path.isfile(os.path.join(d, "step-agent", "agent.py")),
           "der Agent wird mitgebacken (handy zieht bake_agent nach sich)")
    pruefe(os.path.isfile(os.path.join(d, "step-agent", "einrichtung.html")),
           "die Assistentenseite reist mit — sonst sieht das Handy nur eine Notiz")
    pruefe(not any("UNVOLLSTAENDIG" in w for w in geschrieben),
           "nichts wird als unvollstaendig gemeldet", str(geschrieben))
    sk = open(os.path.join(d, "Automation_Custom_Script.sh"), encoding="utf-8").read()
    pruefe("--host 0.0.0.0" in sk, "das Erstboot-Skript auf der Karte bindet ins LAN")

with tempfile.TemporaryDirectory() as d:
    sdprep.prepare_boot(d, password="pw", hostname="mixpibox")
    pruefe(not os.path.isdir(os.path.join(d, "einrichtung")),
           "ohne Handy-Weg landet nichts davon auf der Karte")

print("\n── 3. Dieselben Teile per Rezept auf eine LAUFENDE Box")
rez = open(os.path.join(REPO, "recipes", "mupibox.yaml"), encoding="utf-8").read()
for datei in ["einrichtung-schirm.py", "einrichtung-ap.py", "qr.py",
              "mupibox-boot-splash.py", "mixpi-hoert.png"]:
    pruefe(re.search(r"src:\s*\S*" + re.escape(datei), rez) is not None,
           f"  · {datei} wird ausgerollt")
pruefe("mixpibox-einrichtung.service" in rez, "  · die Unit wird ausgerollt")
# AUSGEROLLT, ABER AUSGESCHALTET — und das ist seit dem 09.08.2026 Absicht.
# Vorher stand hier `systemctl enable`, und genau das liess den QR-Schirm bei
# JEDEM normalen Boot durchkommen: er zeichnet auf /dev/fb0, die
# MuPiBox-Oberflaeche auch, und wer zuletzt malt, gewinnt. Waehrend der
# Installation kommt der Schirm von der KARTE (Vorstart); auf der fertigen
# Box hat er nichts mehr zu tun. Was danach einzustellen ist, gehoert in den
# Ersteinrichtungs-Assistenten der Box selbst.
pruefe("systemctl disable mixpibox-einrichtung.service" in rez,
       "auf der fertigen Box AUSGESCHALTET — der Bildschirm gehoert der Oberflaeche")
pruefe("systemctl enable mixpibox-einrichtung.service" not in rez,
       "und nirgends doch wieder eingeschaltet")
# hostapd/dnsmasq bringen eigene Dienste mit, die beim Installieren SOFORT
# starten. Auf einer Kinderbox waeren das ein DNS-Server auf Port 53 und ein
# Zugangspunkt, die niemand bestellt hat.
pruefe(re.search(r"apt-get install[^\n]*hostapd[^\n]*dnsmasq", rez) is not None,
       "hostapd und dnsmasq werden installiert (ohne sie kein eigenes WLAN)")
pruefe(re.search(r"systemctl (disable --now|mask) hostapd dnsmasq", rez) is not None,
       "und sofort stillgelegt — sie sind Werkzeug, kein Dienst")
# DER RUECKFALL DARF NICHT AN IHNEN HAENGEN. Auf einer frischen Karte gibt es
# sie nicht, und genau dort soll er greifen.
for datei in ["kleiner-dhcp.py", "mixpibox-einrichtung-ap.service"]:
    pruefe(re.search(r"src:\s*\S*" + re.escape(datei), rez) is not None,
           f"  · {datei} wird ausgerollt (Rueckfall ohne Zusatzpakete)")
pruefe("systemctl disable mixpibox-einrichtung.service mixpibox-einrichtung-ap.service" in rez,
       "BEIDE Units liegen bereit und sind AUS — wer sie braucht, schaltet bewusst ein")
kopf = rez[:rez.index("- id: einrichtungsschirm")] if "- id: einrichtungsschirm" in rez else rez
pruefe("hostapd" not in kopf,
       "sie stehen NICHT in der grossen Paketzeile (dort liefe dnsmasq sofort los)")

print("\n── 4. Die Uebergabe: wann darf die Box uebernehmen?")
pruefe(agent.app_laeuft(port=1, frist=0.2) is False,
       "ein toter Port heisst: noch nicht bereit")

# Ein echter Horcher auf einem freien Port — die Frage ist ja gerade, ob die
# Pruefung zwischen "Dienst da" und "Dienst kommt noch" unterscheidet.
horcher = socket.socket()
horcher.bind(("127.0.0.1", 0))
horcher.listen(1)
port = horcher.getsockname()[1]
threading.Thread(target=lambda: None, daemon=True).start()
pruefe(agent.app_laeuft(port=port, frist=1.0) is True,
       "ein antwortender Port heisst: bereit")
stand = agent.weiter_stand(port=port)
pruefe(stand["bereit"] is True, "weiter_stand meldet bereit")
pruefe(stand["port"] == port, "und nennt den Port, den die Seite aufrufen soll")
pruefe(isinstance(stand["adressen"], list),
       "die Adressen der Box kommen mit (fuers Handy im Einrichtungs-WLAN)")
horcher.close()

seite = open(os.path.join(REPO, "agent", "einrichtung.html"), encoding="utf-8").read()
pruefe("/einrichtung/weiter" in seite, "die Handy-Seite fragt danach")
pruefe('id="weiter"' in seite, "und hat die Tuer zur Box")
pruefe("daten.bereit" in seite,
       "sie zeigt sie nur bei bereit — ein Knopf ins Leere sieht aus wie ein Fehler")

# Die Route muss AUTHENTIFIZIERT sein: sie verraet die Adressen der Box.
i_auth = agent.__file__ and open(os.path.join(REPO, "agent", "agent.py"),
                                 encoding="utf-8").read()
pos_auth = i_auth.index("if not self._authed():")
pos_weiter = i_auth.index('if p == "/einrichtung/weiter":')
pruefe(pos_weiter > pos_auth,
       "die Route liegt HINTER dem Tor (sie nennt die Adressen der Box)")

print("\n── 5. Der Lauf auf dem Schirm der Box")
# Die Kette hat drei Glieder und faellt an jedem: der Controller muss die
# Nummer MITSCHICKEN (nur er kennt das Rezept), der Agent muss sie ABLEGEN,
# der Schirm muss sie LESEN. Zwei davon zu bauen nuetzt nichts.
core = laden("core", os.path.join(REPO, "controller", "core.py"))
schirm = laden("schirm", os.path.join(REPO, "tools", "einrichtung-schirm.py"))

a = core.anzeige_schritt({"id": "node", "name": "Node.js installieren"}, 5, 30)
pruefe(a == {"nummer": 5, "gesamt": 30, "titel": "Node.js installieren"},
       "der Controller baut die Anzeige aus dem Rezept-Schritt", str(a))
pruefe(core.anzeige_schritt({"id": "x"}, None, 30) is None,
       "ohne Nummer KEINE Anzeige — \"Schritt ? von ?\" sieht aus wie ein Fehler")

# Der Agent legt sie ab. Sein Pfad ist fest verdrahtet, also gegen den
# Zielordner pruefen und die Datei danach wieder wegraeumen.
pruefe(schirm.FORTSCHRITT == agent.FORTSCHRITT_DATEI,
       "Agent und Schirm meinen DIESELBE Datei",
       f"{agent.FORTSCHRITT_DATEI} vs {schirm.FORTSCHRITT}")

with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "fortschritt.json")

    def leg_ab(inhalt):
        with open(p, "w", encoding="utf-8") as f:
            f.write(inhalt)

    import json as _json
    leg_ab(_json.dumps({"nummer": 5, "gesamt": 30, "titel": "Node.js",
                        "laeuft": True, "id": "node"}))
    g = schirm.fortschritt_lesen(p)
    pruefe(g and g["nummer"] == 5 and g["gesamt"] == 30 and g["laeuft"],
           "der Schirm liest den Stand", str(g))

    # Was NICHT passt, muss verworfen werden: ein Zerrbild auf einem Schirm,
    # dem man glauben soll, ist schlimmer als gar keine Anzeige.
    for kaputt, was in [
        ("{kaputt", "unlesbare Datei"),
        ('{"nummer": 5}', "Gesamtzahl fehlt"),
        ('{"nummer": 31, "gesamt": 30}', "Nummer groesser als Gesamt"),
        ('{"nummer": 0, "gesamt": 30}', "Nummer 0"),
        ('{"nummer": "5", "gesamt": "30"}', "Zahlen als Text"),
        ('{"nummer": 5, "gesamt": 0}', "Gesamt 0 (Division durch null)"),
        ("[]", "gar kein Objekt"),
    ]:
        leg_ab(kaputt)
        pruefe(schirm.fortschritt_lesen(p) is None, f"  verworfen: {was}")

    pruefe(schirm.fortschritt_lesen(os.path.join(d, "gibtsnicht")) is None,
           "  keine Datei = kein Lauf (der Normalfall vor der Installation)")

# Der Balken darf nie unter dem Maskottchen durchlaufen und die Schrift nie
# auf der QR-Karte landen — beides ist am Geraet passiert.
pruefe(schirm.BALKEN_H > 0, "die Balkenhoehe steht an EINER Stelle")
quelle = open(os.path.join(REPO, "tools", "einrichtung-schirm.py"),
              encoding="utf-8").read()
pruefe(quelle.count("BALKEN_H") >= 3,
       "und wird von Balken UND Platzberechnung benutzt (sonst ueberlappt es)")
pruefe("ende = max(ende, time.time() + MAX_LAUFZEIT)" in quelle,
       "der Schirm bleibt an, solange ein Schritt laeuft",
       "sonst geht er mitten in der Installation aus")

# Und der Controller schickt es auch wirklich mit — beide Wege.
for datei, wo in (("stepctl.py", "CLI"), ("tui.py", "TUI")):
    t = open(os.path.join(REPO, "controller", datei), encoding="utf-8").read()
    pruefe("schritt=" in t and "anzeige_schritt" in t,
           f"der {wo}-Weg meldet den Schritt an die Box")

print("\n── 6. Die ganze Kette, an einem ECHT gefahrenen Schritt")
# Die Einzelteile oben koennen alle stimmen und die Kette trotzdem reissen.
# Deshalb hier einmal wirklich: Schritt starten -> Agent legt ab -> Schirm liest.
# Am Modul statt ueber HTTP, weil der feste Pfad unter /run root braucht — die
# Mechanik ist dieselbe, und der Umweg ueber den Server prueft nichts davon.
with tempfile.TemporaryDirectory() as d:
    agent.FORTSCHRITT_ORDNER = d
    agent.FORTSCHRITT_DATEI = os.path.join(d, "fortschritt.json")

    agent.start_run("node", "sleep 0.4",
                    schritt={"nummer": 12, "gesamt": 30, "titel": "Node.js installieren"})
    time.sleep(0.15)
    g = schirm.fortschritt_lesen(agent.FORTSCHRITT_DATEI)
    pruefe(bool(g) and g["laeuft"] and g["nummer"] == 12,
           "waehrend des Schritts sieht der Schirm ihn laufen", str(g))

    time.sleep(0.8)
    g = schirm.fortschritt_lesen(agent.FORTSCHRITT_DATEI)
    pruefe(bool(g) and not g["laeuft"] and g["exit"] == 0,
           "danach steht er auf fertig — sonst behauptet der Schirm ewig 'laeuft'", str(g))

    agent.start_run("kaputt", "exit 3",
                    schritt={"nummer": 13, "gesamt": 30, "titel": "Etwas Kaputtes"})
    time.sleep(0.6)
    g = schirm.fortschritt_lesen(agent.FORTSCHRITT_DATEI)
    pruefe(bool(g) and not g["laeuft"] and g["exit"] == 3,
           "ein GESCHEITERTER Schritt bleibt als solcher stehen", str(g))

    # Ohne `schritt` darf nichts entstehen: der Assistent fuehrt seine
    # Netz-Aktionen auch aus, und die sind keine Installationsschritte.
    os.remove(agent.FORTSCHRITT_DATEI)
    agent.start_run("aktion", "true")
    time.sleep(0.4)
    pruefe(schirm.fortschritt_lesen(agent.FORTSCHRITT_DATEI) is None,
           "ein Schritt OHNE Anzeige-Beigabe legt nichts an")

print("\n── 7. Der Lauf OHNE PC: Rezept mitgeben, Box faehrt selbst")
# Bis hierher brauchte jede Installation einen Rechner, der das Rezept haelt
# und die Box treibt. Wer nur ein Telefon hat, kam nicht los. Geprueft wird
# wieder die KETTE: packen -> auf die Karte -> auspacken -> starten -> fahren.
sys.path.insert(0, os.path.join(REPO, "controller"))
laufpaket = laden("laufpaket", os.path.join(REPO, "controller", "laufpaket.py"))
selbstlauf = laden("selbstlauf", os.path.join(REPO, "tools", "selbstlauf.py"))

# Der flache Ablagename muss EINDEUTIG sein: zwei gleichnamige Dateien aus
# verschiedenen Ordnern (config/services/librespot.service und
# tools/librespot.service) duerfen sich im Archiv nicht ueberschreiben — das
# saehe man erst am Geraet, und dann als "der Dienst hat den falschen Inhalt".
a1 = laufpaket.ablagename("config/services/x.service", "/tmp/x.service")
a2 = laufpaket.ablagename("tools/x.service", "/tmp/x.service")
pruefe(a1 != a2, "gleichnamige Dateien aus verschiedenen Ordnern kollidieren nicht")
pruefe(a1.endswith("x.service"), "  der Name bleibt trotzdem lesbar")

with tempfile.TemporaryDirectory() as d:
    tgz = os.path.join(d, "lauf.tar.gz")
    rezepte = [os.path.join(REPO, "recipes", r)
               for r in ("mupibox.yaml", "mupibox-app.yaml")]
    # DEN FINDER FRAGEN, NICHT DEN PFAD EINES RECHNERS: bis zum 23.09.2026 stand
    # hier ~/Downloads/MuPiBox fest — auf dem Rechner des Betreibers zufaellig
    # der Fork, auf jedem anderen rot. Gefunden von der gegnerischen
    # Nachpruefung desselben Tages.
    import core
    fork, woher = core.fork_wurzel()
    pruefe(woher == "Elternordner des Installers", f"der Test findet den Fork ueber den Installer ({woher})")
    n, dz, fehlend = laufpaket.paket_bauen(tgz, rezepte, REPO, fork)
    pruefe(n > 40, f"beide Rezepte sind drin ({n} Schritte)")
    pruefe(not fehlend, "alle put:-Quellen wurden gefunden", str(fehlend[:3]))

    import tarfile
    with tarfile.open(tgz) as tar:
        namen = tar.getnames()
    pruefe("rezept.json" in namen, "das Rezept liegt als JSON bei (kein PyYAML auf der Box)")
    for m in ("selbstlauf.py", "core.py", "sysinfo.py", "hardware.py", "model.py"):
        pruefe(m in namen, f"  Mitfahrer: {m}")
    pruefe(any(x.startswith("dateien/") for x in namen), "die Nutzdateien liegen bei")

    # Die Kennungen muessen ueber BEIDE Rezepte eindeutig sein — sonst gilt ein
    # Schritt als erledigt, der nie gelaufen ist.
    import json as _j, tarfile as _t
    with _t.open(tgz) as tar:
        rez = _j.load(tar.extractfile("rezept.json"))
    kennungen = [s["id"] for s in rez["steps"]]
    pruefe(len(kennungen) == len(set(kennungen)),
           "jede Schritt-Kennung kommt genau einmal vor")

print("\n── 8. Der Fahrer: anhalten, merken, weitermachen")
with tempfile.TemporaryDirectory() as d:
    os.makedirs(os.path.join(d, "dateien"))
    with open(os.path.join(d, "dateien", "p-quelle.txt"), "w") as f:
        f.write("inhalt\n")
    ziel = os.path.join(d, "gelegt.txt")
    import json as _j
    rezept = {"env": {"PROBE": "ja"}, "steps": [
        {"id": "a:eins", "name": "Eins", "run": "test \"$PROBE\" = ja"},
        {"id": "a:zwei", "name": "Datei", "run": f"test -f {ziel}",
         "put": [{"ablage": "p-quelle.txt", "dest": ziel, "mode": "644"}]},
        {"id": "a:drei", "name": "Faellt um", "run": "exit 7"},
        {"id": "a:vier", "name": "Danach", "run": "true"},
    ]}
    with open(os.path.join(d, "rezept.json"), "w") as f:
        _j.dump(rezept, f)

    selbstlauf.FORTSCHRITT_DATEI = os.path.join(d, "fortschritt.json")
    selbstlauf.PROTOKOLL = os.path.join(d, "lauf.log")
    stand = os.path.join(d, "stand.json")

    r = selbstlauf.fahren(d, stand_datei=stand)
    pruefe(r == 1, "ein gescheiterter Schritt HAELT AN (statt halb einzurichten)")
    st = _j.load(open(stand))
    pruefe(st["gescheitert"] == "a:drei", "und merkt sich, wo", str(st))
    pruefe(set(st["fertig"]) == {"a:eins", "a:zwei"},
           "die erledigten sind vermerkt", str(st["fertig"]))
    pruefe(os.path.isfile(ziel), "put: hat die Datei wirklich gelegt")
    # OHNE PREFIX WAERE SCHRITT 1 GESCHEITERT: die env: des Rezepts muessen
    # auch dann gelten, wenn die Umgebungserkennung nicht durchkommt.
    pruefe("a:eins" in st["fertig"],
           "die env:-Werte des Rezepts gelten auch ohne Umgebungserkennung")

    fort = _j.load(open(selbstlauf.FORTSCHRITT_DATEI))
    pruefe(fort["exit"] == 7 and not fort["laeuft"],
           "der Fortschritt zeigt den Fehler — dieselbe Datei, die der Schirm liest")

    # Wiederaufnahme: der Kern des Ganzen, denn das Rezept enthaelt Neustarts.
    rezept["steps"][2]["run"] = "true"
    with open(os.path.join(d, "rezept.json"), "w") as f:
        _j.dump(rezept, f)
    r2 = selbstlauf.fahren(d, stand_datei=stand)
    pruefe(r2 == 0, "nach dem Beheben laeuft er durch")
    log = open(os.path.join(d, "lauf.log"), encoding="utf-8").read()
    pruefe("2 bereits erledigt" in log,
           "und faengt NICHT von vorn an — sonst waere ein Neustart eine Endlosschleife")

    # Ohne begonnenen Lauf darf die Unit nichts tun: sonst richtete sich jede
    # frisch bespielte Karte von selbst ein, ohne dass jemand zugestimmt hat.
    quelle = open(os.path.join(REPO, "tools", "selbstlauf.py"), encoding="utf-8").read()
    pruefe("nur_wenn_angefangen" in quelle and "STAND_DATEI" in quelle,
           "die Unit haelt still, solange niemand gestartet hat")

unit = open(os.path.join(REPO, "tools", "mixpibox-selbstlauf.service"),
            encoding="utf-8").read()
pruefe("--nur-wenn-angefangen" in unit, "die Unit ruft mit dem Riegel auf")
pruefe("network-online" in unit,
       "sie wartet auf das Netz — das Rezept installiert Pakete")

# Der Startknopf im Assistenten, und die Rueckfrage davor.
pruefe("installation-starten" in agent.EINRICHT_AKTIONEN,
       "das Handy hat eine benannte Aktion zum Starten")
pruefe(agent.installation_starten()["ok"] is False,
       "ohne Paket wird sie ehrlich abgelehnt")
pruefe("fehler" in agent.installation_starten(),
       "  und nennt den Grund im Feld, das die Seite auch liest")
seite2 = open(os.path.join(REPO, "agent", "einrichtung.html"), encoding="utf-8").read()
pruefe("RUECKFRAGE" in seite2 and "installation-starten" in seite2,
       "ein Fehltipp startet die Installation nicht — es gibt eine Rueckfrage")
# NUR IM CODE SUCHEN, nicht im Fliesstext: der Kommentar daneben BEGRUENDET ja
# gerade, warum kein confirm() benutzt wird. Zweiter Test in dieser Datei, der
# an einer Begruendung angeschlagen hat.
code_zeilen = [z for z in seite2.splitlines() if not z.strip().startswith("//")]
pruefe(not [z for z in code_zeilen if re.search(r"(^|[^.\w])confirm\s*\(", z)],
       "  und zwar eine eigene: confirm() unterdruecken manche Browser ganz")


# ── Der Handy-Weg BRAUCHT das Panel — es ist keine Wahl ───────────────────
# Am Geraet: Karte ohne den Haken "Bildschirm" geschrieben, Box gestartet,
# kein QR-Code. Der Code wird in den Framebuffer gemalt, und den gibt es ohne
# eingeschaltetes DSI-Panel nicht. Wer per Handy einrichten will, muss ihn
# sehen koennen.
with tempfile.TemporaryDirectory() as d:
    sdprep.prepare_boot(d, password="pw", hostname="mixpi", handy=True)
    cfg = open(os.path.join(d, "config.txt")).read() if os.path.exists(
        os.path.join(d, "config.txt")) else ""
    pruefe("vc4-kms-dsi-7inch" in cfg,
           "handy=True schaltet das DSI-Panel ein (ohne es kein QR)")
    pruefe(not os.path.exists(os.path.join(d, "cmdline.txt")),
           "  aber NICHT die Konsole — deren Text soll niemand sehen")

with tempfile.TemporaryDirectory() as d:
    sdprep.prepare_boot(d, password="pw", hostname="mixpi")
    cfg = open(os.path.join(d, "config.txt")).read() if os.path.exists(
        os.path.join(d, "config.txt")) else ""
    pruefe("vc4-kms-dsi-7inch" not in cfg,
           "ohne Handy-Weg bleibt die config.txt unangetastet")

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
