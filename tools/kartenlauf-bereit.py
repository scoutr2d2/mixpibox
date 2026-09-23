#!/usr/bin/env python3
"""Ist ein Lauf mit einer FRISCHEN SD-Karte startklar? — vorher messen statt mittendrin scheitern.

WOZU: Ein Kartenlauf dauert eine gute Stunde und mehrere Neustarts. Was ihn
kippt, steht fast immer schon vorher fest — und zwar an drei Stellen, die man
beim Losfahren nicht ansieht:

  1. DAS ARTEFAKT IST ALT. Der Installer rollt `bin/nodejs/deploy.zip` aus —
     eine GEBAUTE Datei (App, Backend, beide Oberflaechen). Wer sie nicht neu
     baut, spielt der frischen Karte den Stand von vorletzter Woche
     auf und sucht dann den Fehler in der Box. Die Zip ist immer da, sie sieht
     nie kaputt aus, und ihr Datum liest niemand freiwillig nach.
     (Bis zum 22.08.2026 stand hier ein ZWEITES Zip, die PHP-Verwaltung; sie
     hat das Projekt am 19.08. verlassen — siehe ZIP_SPIEGEL weiter unten.)

  2. EIN REZEPT ZIEHT EINE DATEI, DIE ES NICHT GIBT. Jeder `put:`-Schritt
     nennt eine Quelle im Fork. Fehlt sie, bricht der Lauf an genau der Stelle
     ab, an der man gerade nicht davorsitzt. Das ist reine Buchhaltung und
     laesst sich in einer Sekunde vorher pruefen.

  3. DER HANDY-WEG IST NICHT VERDRAHTET. Die Teile dafuer liegen im
     Installer-Repo (Einrichtungsschirm, eigenes WLAN, Assistentenseite) —
     aber Dateien im Repo sind nicht Dateien auf der Box, und auf der Box
     liegen ist nicht aufgerufen werden ([[kopiert-ist-nicht-aufgerufen]]).
     Geprueft wird deshalb die KETTE, nicht die Existenz.

UND ES BIETET AN, DAS BEHEBBARE GLEICH ZU TUN. Ein Werkzeug, das "dein Zip ist
zehn Tage alt" sagt und einen dann den Bau selbst heraussuchen laesst, wird beim
dritten Mal nicht mehr aufgerufen. Angeboten wird aber NUR, was es wirklich
bauen kann (das Zip) — fuer einen unverdrahteten Handy-Weg gaebe es
sonst einen Knopf, hinter dem nichts passiert. Nach dem Bau wird ERNEUT
gemessen, statt den Erfolg anzunehmen.

WAS ES NICHT TUT
  * Es aendert nichts von selbst: ohne Terminal und ohne `--bauen` bleibt es
    beim Messen.
  * Es redet nicht mit einer Box. Alles hier ist am Entwicklungsrechner
    messbar; was nur am Geraet auffaellt, gehoert nicht hierher
    ([[ausrollen-was-nur-am-geraet-auffaellt]]).
  * Es committet nichts. Der Baustand ist eine Entscheidung, keine Aufraeumung.

AUFRUF
    python3 tools/kartenlauf-bereit.py               # messen, dann fragen
    python3 tools/kartenlauf-bereit.py --bauen       # veraltete Zips gleich bauen
    python3 tools/kartenlauf-bereit.py --nur-messen  # nie bauen, nie fragen
    python3 tools/kartenlauf-bereit.py --kurz        # nur die Mängel
    python3 tools/kartenlauf-bereit.py --installer ~/Downloads/remote-step-installer

Rueckgabe: 0 = startklar · 1 = Mängel (Details stehen oben drin)
"""
import argparse
import hashlib
import importlib.util
import os
import re
import subprocess
import sys
import time
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))
FORK = os.path.dirname(HIER)
# ══ SEIT DEM 08.08.2026 LIEGT DAS WISSENSPAKET IM BAUM ══════════════════════
#
# Betreiber: „ich möchte das wiki llm und auch die werkzeuge wie das zum sd
# karte schreiben mit ins repository aufnehmen dass alles beisammen ist."
# Es steht seither unter `llmwiki/` (per `git subtree`, siehe ZUGEZOGEN.md).
#
# DER ALTE PFAD BLEIBT ALS RUECKFALL, und zwar nicht aus Bequemlichkeit: Wer
# einen Stand von vor diesem Tag ausgecheckt hat, hat kein `llmwiki/` — und
# ein Werkzeug, das dann bloss abbricht, ist schlechter als eines, das den
# alten Ort noch kennt. Gefunden wird, was zuerst dasteht.
INSTALLER_VORGABE = next(
    (k for k in (os.path.join(FORK, "remote-step-installer"),
                 os.path.expanduser("~/Downloads/remote-step-installer"))
     if os.path.isdir(k)),
    os.path.join(FORK, "remote-step-installer"),
)

GRUEN, ROT, GELB, GRAU, AUS = "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"
if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
    GRUEN = ROT = GELB = GRAU = AUS = ""

befunde = []  # (schwere, titel, text, bauweg) — 'fehler' | 'warnung' | 'ok'


def sagen(schwere, titel, text="", bauweg=None):
    """`bauweg` ist gesetzt, wenn sich dieser Befund BEHEBEN laesst: ein
    (Anzeige, Arbeitsverzeichnis, argv)-Tripel. Nur dann bietet das Werkzeug
    an, es gleich zu tun — alles andere waere ein Knopf, hinter dem nichts
    passiert."""
    befunde.append((schwere, titel, text, bauweg))


def _neueste(pfad, endungen, ausser=("node_modules", "/deploy/", "/.git/")):
    """Juengste Quelldatei unter `pfad` als (mtime, name). (0, '') wenn nichts da."""
    best = (0.0, "")
    for wurzel, verz, dateien in os.walk(pfad):
        verz[:] = [v for v in verz if v not in ("node_modules", ".git", "deploy")]
        for d in dateien:
            if not d.endswith(endungen):
                continue
            voll = os.path.join(wurzel, d)
            if any(a in voll for a in ausser):
                continue
            try:
                m = os.path.getmtime(voll)
            except OSError:
                continue
            if m > best[0]:
                best = (m, os.path.relpath(voll, FORK))
    return best


def _alter(sek):
    tage = sek / 86400.0
    if tage >= 1:
        return f"{tage:.1f} Tage"
    return f"{sek / 3600.0:.1f} Stunden"


# Was UNVERAENDERT aus dem Baum ins Zip wandert (Angular reicht NewDesign/ als
# Asset durch). Nur hier ist ein Byte-Vergleich moeglich — die uebrigen Eintraege
# sind gebuendelt, minifiziert und gehasht, dort gibt es keine Quelle zum
# Vergleichen. Ein kleiner, sicherer Ausschnitt schlaegt eine grosse Heuristik:
# stimmen DIESE nicht, ist das Zip garantiert alt.
ZIP_SPIEGEL = {
    "bin/nodejs/deploy.zip": [
        ("NewDesign/app.js", "www/neu/app.js"),
        ("NewDesign/app.css", "www/neu/app.css"),
        ("NewDesign/index.html", "www/neu/index.html"),
        ("NewDesign/maskottchen.json", "www/neu/maskottchen.json"),
    ],
    # `AdminInterface/release/www.zip` STAND HIER BIS ZUM 22.08.2026 und
    # meldete zuverlaessig "fehlt ganz" — fuer etwas, das absichtlich weg ist.
    #
    # PHP hat das Projekt am 19.08.2026 verlassen (52d21406, "E47: PHP
    # verlaesst das Projekt - und nimmt die groesste Rechteausweitung mit").
    # Das Verzeichnis `AdminInterface/` gibt es seither nicht mehr, `mupi.php`
    # und `admin.php` erst recht nicht. Der Eintrag blieb stehen.
    #
    # WAS DAS ANRICHTET: `kartenlauf-bereit.py` sagte danach IMMER "NICHT
    # startklar", egal wie sauber der Baum war — und `--bauen` brach mit
    # "Verzeichnis fehlt" ab, NACHDEM deploy.zip schon gebaut war. Ein
    # Pruefer, der bei gesundem Zustand Alarm schlaegt, wird abgeschaltet;
    # dann sieht man auch den echten Befund nicht mehr, der daneben steht.
    # (Aufgefallen am 22.08. beim Nachziehen des Klangwerks.)
}


def _inhalt_abweichend(zip_pfad, artefakt):
    """Welche 1:1 durchgereichten Dateien liegen im Zip anders als im Baum?
    Leere Liste = kein Unterschied gefunden (oder nichts Vergleichbares)."""
    paare = ZIP_SPIEGEL.get(artefakt) or []
    if not paare:
        return []
    anders = []
    try:
        with zipfile.ZipFile(zip_pfad) as z:
            namen = set(z.namelist())
            for quelle, drin in paare:
                qp = os.path.join(FORK, quelle)
                if not os.path.isfile(qp):
                    continue
                if drin not in namen:
                    anders.append(f"{quelle} → fehlt im Zip als {drin}")
                    continue
                with open(qp, "rb") as f:
                    hier = hashlib.sha256(f.read()).hexdigest()
                dort = hashlib.sha256(z.read(drin)).hexdigest()
                if hier != dort:
                    anders.append(f"{quelle} ≠ {drin}")
    except (OSError, zipfile.BadZipFile) as e:
        return [f"Zip nicht lesbar: {e}"]
    return anders


# ── 1) Sind die gebauten Artefakte juenger als ihre Quellen? ────────────────
def pruefe_artefakte():
    # Der Bauweg ist ein Tripel (Anzeige, Verzeichnis, argv) — als LISTE, nicht
    # als Zeichenkette durch eine Shell: was hier steht, wird auf Wunsch
    # ausgefuehrt, und dann hat eine Shell dazwischen nichts zu suchen.
    # MUPI_OHNE_RUECKFRAGE haelt deploy.sh davon ab, auf Enter zu warten —
    # genau daran ist der Bau vom 08.08. haengengeblieben.
    BAU_APP = ("cd src && ./deploy.sh", os.path.join(FORK, "src"), ["./deploy.sh"])
    # ES GIBT NUR NOCH EIN ARTEFAKT. Hier stand bis zum 22.08.2026 ein zweites
    # Paar fuer `AdminInterface/release/www.zip` — die ALTE PHP-Verwaltung.
    # Die hat das Projekt am 19.08.2026 verlassen (52d21406, "E47: PHP
    # verlaesst das Projekt"), samt ihrem Verzeichnis und ihrem Bauskript.
    #
    # STEHEN GEBLIEBEN WAR DIE PRUEFUNG, und sie meldete seither bei JEDEM
    # Lauf "fehlt ganz" — fuer etwas, das absichtlich weg ist. Damit stand
    # unter jeder Ausgabe "NICHT startklar", egal wie sauber der Baum war,
    # und `--bauen` brach mit "Verzeichnis fehlt" ab, NACHDEM deploy.zip
    # bereits gebaut war. Ein Pruefer, der bei gesundem Zustand Alarm
    # schlaegt, wird abgeschaltet — und dann sieht niemand mehr den echten
    # Befund daneben.
    #
    # Die NEUE Verwaltung (Angular, src/frontend-admin) steckt als www-admin/
    # IM deploy.zip und wird ueber BAU_APP mitgebaut; sie braucht hier keinen
    # eigenen Eintrag.
    paare = [
        ("bin/nodejs/deploy.zip", ["src/frontend-box", "src/backend-api", "NewDesign"],
         (".ts", ".js", ".html", ".css", ".scss", ".json"), BAU_APP),
    ]
    for artefakt, quellen, endungen, bauweg in paare:
        bauen = bauweg[0]
        ap = os.path.join(FORK, artefakt)
        if not os.path.isfile(ap):
            sagen("fehler", f"{artefakt} fehlt ganz",
                  f"Ohne die Datei bricht der Rezept-Schritt ab.", bauweg)
            continue
        amt = os.path.getmtime(ap)

        # ZUERST DER INHALT, denn die Uhrzeit luegt in BEIDE Richtungen: der
        # Angular-Bau fasst Asset-Quellen an, ohne sie zu aendern (NewDesign/
        # index.html stand danach 4 Minuten NACH dem fertigen Zip, war aber
        # byteweise dieselbe Datei) — und umgekehrt sagt eine junge Zip nichts
        # darueber, ob der Inhalt wirklich der der Quelle ist.
        # Wo eine Quelle UNVERAENDERT im Zip landet, ist der Vergleich exakt.
        abweichend = _inhalt_abweichend(ap, artefakt)
        if abweichend:
            zeilen = "\n".join(f"     {n}" for n in abweichend[:6])
            mehr = f"\n     … und {len(abweichend) - 6} weitere" if len(abweichend) > 6 else ""
            sagen("fehler", f"{artefakt} enthält NICHT den Stand des Quellbaums",
                  f"Diese Dateien liegen im Zip anders als im Baum — die frische Karte\n"
                  f"     bekäme also einen anderen Stand:\n{zeilen}{mehr}", bauweg)
            continue

        juengste = (0.0, "")
        for q in quellen:
            qp = os.path.join(FORK, q)
            if os.path.isdir(qp):
                k = _neueste(qp, endungen)
                if k[0] > juengste[0]:
                    juengste = k
        # Nur noch eine WARNUNG: nach dem Inhaltsvergleich ist eine juengere
        # Quelle ein Hinweis, kein Beweis. Sie kann vom Bau selbst stammen.
        if juengste[0] > amt:
            sagen("warnung", f"{artefakt} ist älter als eine Quelldatei",
                  f"Artefakt: {time.strftime('%d.%m. %H:%M', time.localtime(amt))} · "
                  f"jüngere Quelle: {time.strftime('%d.%m. %H:%M', time.localtime(juengste[0]))} "
                  f"({juengste[1]})\n     Der Inhaltsvergleich fand keinen Unterschied — das ist "
                  f"typisch für\n     Dateien, die der Bau nur ANFASST. Im Zweifel neu bauen.",
                  bauweg)
        else:
            sagen("ok", f"{artefakt} ist aktuell",
                  f"gebaut {time.strftime('%d.%m. %H:%M', time.localtime(amt))}")


# ── 2) Zieht ein Rezept eine Quelle, die es nicht gibt? ─────────────────────
def pruefe_rezept_quellen(installer):
    rezepte = []
    rv = os.path.join(installer, "recipes")
    if not os.path.isdir(rv):
        sagen("fehler", "Installer-Repo nicht gefunden",
              f"gesucht in {installer} — mit --installer den Pfad angeben")
        return
    for d in sorted(os.listdir(rv)):
        if d.endswith(".yaml"):
            rezepte.append(os.path.join(rv, d))

    fehlend, geprueft = [], 0
    for rez in rezepte:
        text = open(rez, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"^\s*-\s*src:\s*(\S+)\s*$", text, re.M):
            roh = m.group(1)
            geprueft += 1
            # ${MUPI_REPO:-$HOME/Downloads/mixpibox} und $HOME aufloesen
            pfad = re.sub(r"\$\{MUPI_REPO:-[^}]*\}", FORK, roh)
            pfad = pfad.replace("${MUPI_REPO}", FORK).replace("$MUPI_REPO", FORK)
            pfad = os.path.expandvars(pfad.replace("$HOME", os.path.expanduser("~")))
            if "$" in pfad:            # noch Variablen drin -> nicht entscheidbar
                continue
            if not os.path.isabs(pfad):
                pfad = os.path.join(installer, pfad)
            if not os.path.exists(pfad):
                fehlend.append((os.path.basename(rez), roh))

    if fehlend:
        zeilen = "\n".join(f"     {r}: {s}" for r, s in fehlend)
        sagen("fehler", f"{len(fehlend)} Rezept-Quelle(n) existieren nicht",
              f"Der Lauf bricht an dieser Stelle ab:\n{zeilen}")
    else:
        sagen("ok", f"alle {geprueft} Rezept-Quellen vorhanden")


# ── 3) Ist der Handy-Weg wirklich verdrahtet? ───────────────────────────────
def pruefe_handyweg(installer):
    def lies(*teile):
        p = os.path.join(installer, *teile)
        try:
            return open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            return ""

    rezepte = ""
    rv = os.path.join(installer, "recipes")
    if os.path.isdir(rv):
        for d in os.listdir(rv):
            if d.endswith(".yaml"):
                rezepte += lies("recipes", d)

    erstboot = lies("controller", "sdprep.py")

    # 3a) Erreicht das Handy den Agenten ueberhaupt? (LAN-Bindung)
    #
    # DAS ERZEUGTE SKRIPT FRAGEN, NICHT DEN QUELLTEXT LESEN. Seit die Bindung
    # von einem Schalter abhaengt, steht in der Zeile ein PLATZHALTER — ein
    # Textvergleich faende dort weder 0.0.0.0 noch 127.0.0.1 und urteilte
    # falsch. Also die Funktion aufrufen und das Ergebnis ansehen; das ist
    # ohnehin genau das, was spaeter auf der Karte landet.
    bindet_lan = laptop_bleibt_zu = None
    try:
        spec = importlib.util.spec_from_file_location(
            "sdprep_probe", os.path.join(installer, "controller", "sdprep.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        bindet_lan = "--host 0.0.0.0" in m.custom_script(handy=True)
        laptop_bleibt_zu = "--host 127.0.0.1" in m.custom_script()
    except Exception as e:                                   # noqa: BLE001
        sagen("warnung", "Erstboot-Skript nicht auswertbar", str(e)[:200])

    if bindet_lan is False:
        sagen("fehler", "Der Agent lauscht nur auf 127.0.0.1 — das Handy kommt nicht ran",
              "Auch mit dem Handy-Weg setzt das Erstboot-Skript --host 127.0.0.1. Das ist\n"
              "     für den SSH-Tunnel richtig, sperrt aber das Handy aus.")
    elif bindet_lan:
        sagen("ok", "Agent bindet im Erstboot ans LAN (nur mit Handy-Weg)")
    if laptop_bleibt_zu is False:
        sagen("fehler", "Ohne Handy-Weg lauscht der Agent trotzdem im LAN",
              "Der Laptop-Weg soll auf localhost bleiben — der SSH-Tunnel IST dort der\n"
              "     Schutz. Eine offene Wurzel im WLAN, die niemand bestellt hat.")

    # 3b) Kommt der Einrichtungsschirm (QR auf dem Box-Display) auf die Box?
    if "einrichtung-schirm" not in rezepte:
        sagen("fehler", "Der Einrichtungsschirm wird auf keine Box ausgerollt",
              "tools/einrichtung-schirm.py + tools/qr.py liegen im Repo, aber KEIN Rezept\n"
              "     kopiert sie und keine systemd-Unit startet sie. Ohne ihn zeigt die Box\n"
              "     beim ersten Start nicht, wohin das Handy soll. [[kopiert-ist-nicht-aufgerufen]]")
    else:
        sagen("ok", "Einrichtungsschirm wird ausgerollt")

    # 3c) Der Rückfall ohne Kabel — und ob ihn überhaupt jemand auslöst.
    #
    # Er hing lange an hostapd/dnsmasq, die es auf einer frischen Karte nicht
    # gibt und ohne Netz nicht zu holen sind. Seit `wpa_supplicant mode=2` und
    # `kleiner-dhcp.py` braucht er kein Paket mehr — dafür braucht er den
    # Wächter, der ihn startet. Ohne den liegt alles bereit und passiert nie.
    ap = lies("tools", "einrichtung-ap.py")
    dhcp_da = os.path.isfile(os.path.join(installer, "tools", "kleiner-dhcp.py"))
    kette = {
        "AP ohne hostapd": "wpa_ap_conf" in ap,
        "DHCP/DNS ohne dnsmasq": dhcp_da,
        "Wächter, der auslöst": "wenn_kein_netz" in ap,
        "Wächter wird ausgerollt": "mixpibox-einrichtung-ap.service" in rezepte,
        "Wächter wird eingeschaltet": "mixpibox-einrichtung-ap.service" in rezepte + erstboot,
    }
    fehlt_ap = [k for k, v in kette.items() if not v]
    if fehlt_ap:
        sagen("warnung", "Der Rückfall ohne Kabel greift nicht",
              "Es fehlt: " + ", ".join(fehlt_ap) + "\n"
              "     Solange das so ist, gilt: beim ersten Start Kabel oder ein WLAN auf\n"
              "     der Karte — sonst ist die Box nicht erreichbar.")
    else:
        sagen("ok", "Rückfall ohne Kabel: eigenes WLAN ohne Zusatzpakete, Wächter löst aus")

    # 3d) Endet der Assistent im Nichts, oder übergibt er an die Box?
    #
    # Dass er nur Netz kann, ist KEIN Mangel — jedes weitere Formular wäre eine
    # weitere Tür in einen Dienst, der als root läuft. Profil, Farbe, Spotify,
    # Jellyfin und die ersten Inhalte kann die Box in ihrem Eltern-Bereich
    # längst. Der Mangel wäre, das nicht zu SAGEN: dann steht jemand mit dem
    # Handy da, liest „Fertig." und weiß nicht, dass es weitergeht.
    ag = lies("agent", "agent.py")
    seite = lies("agent", "einrichtung.html")
    m = re.search(r"EINRICHT_AKTIONEN\s*=\s*\{", ag)
    anzahl = 0
    if m:
        blk = ag[m.end():]
        ende = blk.find("\n}\n")
        anzahl = len(re.findall(r'^    "([a-z0-9-]+)":\s*\{',
                                blk[:ende if ende > 0 else len(blk)], re.M))
    hat_uebergabe = "/einrichtung/weiter" in ag and "/einrichtung/weiter" in seite
    if not hat_uebergabe:
        sagen("fehler", "Der Assistent endet im Nichts — keine Übergabe an die Box",
              f"Er kann {anzahl} Netz-Aktionen und sagt danach nur „Fertig.\". Profil,\n"
              "     Akzentfarbe, Spotify, Jellyfin und die ersten Inhalte kann die Box im\n"
              "     Eltern-Bereich längst — es fehlt nur die Tür dorthin.")
    else:
        sagen("ok", f"Assistent: {anzahl} Netz-Aktionen, dann Übergabe an den Eltern-Bereich")

    # 3e) Sieht man am Gerät, wie weit die Installation ist?
    #
    # Die Kette hat drei Glieder und reißt an jedem: der Controller muss die
    # Nummer mitschicken (nur er kennt das Rezept), der Agent muss sie ablegen,
    # der Schirm muss sie lesen. Zwei davon zu haben nützt nichts — deshalb
    # werden hier alle drei geprüft und nicht bloß eines.
    schirm = lies("tools", "einrichtung-schirm.py")
    core = lies("controller", "core.py")
    glieder = {
        "Controller meldet": "anzeige_schritt" in core,
        "CLI reicht durch": "schritt=" in lies("controller", "stepctl.py"),
        "TUI reicht durch": "schritt=" in lies("controller", "tui.py"),
        "Agent legt ab": "fortschritt_schreiben" in ag,
        "Schirm liest": "fortschritt_lesen" in schirm,
    }
    fehlt = [k for k, v in glieder.items() if not v]
    if fehlt:
        sagen("fehler", "Der Installationsfortschritt kommt nicht auf den Schirm",
              "Die Kette reißt bei: " + ", ".join(fehlt) + "\n"
              "     Die 10–20-min-Installation ist am Gerät dann unsichtbar — wer davor\n"
              "     sitzt, kann „arbeitet\" nicht von „hängt\" unterscheiden.")
    else:
        sagen("ok", "Installationsfortschritt läuft bis auf den Schirm (5 Glieder)")

    # 3f) Kann die Box den Lauf ganz allein fahren — ohne diesen Rechner?
    #
    # Das Rezept liegt sonst beim Controller, also auf einem Laptop. Für den
    # Weg ohne PC muss es MIT auf die Karte, und jemand auf der Box muss es
    # abarbeiten können. Auch hier reißt die Kette an jedem Glied.
    paket = lies("controller", "laufpaket.py")
    fahrer = lies("tools", "selbstlauf.py")
    ohne_pc = {
        "Paket wird geschnürt": "paket_bauen" in paket,
        "SD-Vorbereitung gibt es mit": "lauf_paket" in erstboot,
        "Erstboot packt aus": "lauf.tar.gz" in erstboot,
        "Fahrer auf der Box": "def fahren" in fahrer,
        "überlebt Neustarts": "STAND_DATEI" in fahrer and "nur_wenn_angefangen" in fahrer,
        "Startknopf im Assistenten": "installation-starten" in ag,
        "Rückfrage vor dem Start": "RUECKFRAGE" in seite,
    }
    fehlt_pc = [k for k, v in ohne_pc.items() if not v]
    if fehlt_pc:
        sagen("warnung", "Der Lauf ohne PC greift nicht",
              "Es fehlt: " + ", ".join(fehlt_pc) + "\n"
              "     Der Lauf braucht dann weiter einen Rechner, der ihn treibt.")
    else:
        sagen("ok", "Lauf ohne PC: Rezept reist mit, Box fährt selbst, Handy startet")


# ── 4) Geht der Baustand sauber in die Artefakte? ───────────────────────────
def pruefe_baumzustand():
    try:
        aus = subprocess.run(["git", "-C", FORK, "status", "--porcelain"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return
    geaendert = [z for z in aus.splitlines() if z and not z.startswith("??")]
    if geaendert:
        namen = "\n".join(f"     {z}" for z in geaendert[:8])
        mehr = f"\n     … und {len(geaendert) - 8} weitere" if len(geaendert) > 8 else ""
        sagen("warnung", f"{len(geaendert)} geänderte, nicht eingecheckte Datei(en)",
              f"deploy.sh stempelt das in herkunft.json als \"unsauber\" ein — die Box meldet\n"
              f"     dann einen Stand, den kein Commit belegt.\n{namen}{mehr}")
    else:
        sagen("ok", "Arbeitsbaum sauber (herkunft.json wird eindeutig)")


# ── 5) Laesst sich der Bau ueberhaupt unbeaufsichtigt fahren? ───────────────
def pruefe_baubarkeit():
    ds = os.path.join(FORK, "src", "deploy.sh")
    if os.path.isfile(ds):
        text = open(ds, encoding="utf-8", errors="replace").read()
        if re.search(r"^\s*read\s+-p", text, re.M):
            sagen("warnung", "src/deploy.sh hält mit `read -p` an",
                  "Der Bau lässt sich nicht unbeaufsichtigt fahren (und nicht aus einem\n"
                  "     Rezept heraus). Für einen Kartenlauf davorsitzen — oder die Zeile\n"
                  "     hinter einen Schalter legen.")


def alles_pruefen(installer):
    """Alle Pruefungen von vorn. Leert die Befunde — damit nach einem Bau
    ERNEUT gemessen werden kann, statt das alte Urteil weiterzutragen."""
    befunde.clear()
    pruefe_artefakte()
    pruefe_rezept_quellen(installer)
    pruefe_handyweg(installer)
    pruefe_baumzustand()
    pruefe_baubarkeit()


def ausgeben(kurz=False):
    """-> (fehler, warnungen). Gibt die Befunde aus."""
    fehler = warnungen = 0
    for schwere, titel, text, _ in befunde:
        if schwere == "ok":
            if not kurz:
                print(f"  {GRUEN}✓{AUS} {titel}" + (f" {GRAU}· {text}{AUS}" if text else ""))
            continue
        if schwere == "fehler":
            fehler += 1
            print(f"  {ROT}✗ {titel}{AUS}")
        else:
            warnungen += 1
            print(f"  {GELB}! {titel}{AUS}")
        if text:
            print(f"    {GRAU}{text}{AUS}")
    return fehler, warnungen


def offene_bauwege():
    """Welche Mängel liessen sich JETZT beheben? Ohne Doppelte und in der
    Reihenfolge, in der sie aufgefallen sind."""
    wege, gesehen = [], set()
    for schwere, titel, _, bauweg in befunde:
        if schwere in ("fehler", "warnung") and bauweg and bauweg[0] not in gesehen:
            gesehen.add(bauweg[0])
            wege.append((titel, bauweg))
    return wege


def bauen_lassen(wege):
    """Die Bauwege der Reihe nach fahren. -> True, wenn alle durchliefen.

    OHNE SHELL: die Befehle stehen als argv-Liste im Bauweg. Und mit
    MUPI_OHNE_RUECKFRAGE, weil deploy.sh sonst auf Enter wartet — genau daran
    ist der Bau am 08.08. haengengeblieben, und ein Werkzeug, das anbietet zu
    bauen, darf nicht selbst in dieselbe Falle laufen.
    """
    umgebung = dict(os.environ, MUPI_OHNE_RUECKFRAGE="1")
    alles_gut = True
    for titel, (anzeige, ordner, argv) in wege:
        print(f"\n  {GRAU}▶ {anzeige}{AUS}   ({titel})")
        if not os.path.isdir(ordner):
            print(f"  {ROT}✗ Verzeichnis fehlt: {ordner}{AUS}")
            alles_gut = False
            continue
        try:
            # Die Ausgabe laeuft MIT — ein Bau dauert Minuten, und eine stumme
            # Minute sieht aus wie ein Haenger.
            r = subprocess.run(argv, cwd=ordner, env=umgebung, timeout=1800)
        except (OSError, subprocess.SubprocessError) as e:
            print(f"  {ROT}✗ {anzeige}: {e}{AUS}")
            alles_gut = False
            continue
        if r.returncode != 0:
            print(f"  {ROT}✗ {anzeige} endete mit {r.returncode}{AUS}")
            alles_gut = False
        else:
            print(f"  {GRUEN}✓ {anzeige}{AUS}")
    return alles_gut


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--installer", default=INSTALLER_VORGABE,
                    help="Pfad zum remote-step-installer")
    ap.add_argument("--kurz", action="store_true", help="nur Mängel zeigen")
    ap.add_argument("--bauen", action="store_true",
                    help="veraltete Artefakte gleich neu bauen (ohne Rückfrage)")
    ap.add_argument("--nur-messen", action="store_true",
                    help="nie bauen und nie fragen (für Skripte und Haken)")
    a = ap.parse_args()
    installer = os.path.expanduser(a.installer)

    alles_pruefen(installer)

    print(f"\n  {GRAU}Fork: {FORK}{AUS}")
    print(f"  {GRAU}Installer: {installer}{AUS}\n")
    fehler, warnungen = ausgeben(a.kurz)

    # ── Anbieten, es gleich richtigzustellen ────────────────────────────────
    # NUR WAS SICH WIRKLICH BAUEN LAESST. Ein Angebot fuer einen Mangel, den
    # das Werkzeug nicht beheben kann (fehlende Rezept-Quelle, unverdrahteter
    # Handy-Weg), waere ein Knopf, hinter dem nichts passiert.
    wege = offene_bauwege()
    if wege and not a.nur_messen:
        machen = a.bauen
        if not machen and sys.stdin.isatty() and sys.stdout.isatty():
            print(f"\n  {GELB}Das lässt sich jetzt beheben:{AUS}")
            for titel, (anzeige, _, _) in wege:
                print(f"    · {anzeige}   {GRAU}({titel}){AUS}")
            try:
                antwort = input("\n  Jetzt bauen? Dauert einige Minuten. [j/N] ")
            except (EOFError, KeyboardInterrupt):
                print()
                antwort = ""
            machen = antwort.strip().lower() in ("j", "ja", "y", "yes")
        if machen:
            if not bauen_lassen(wege):
                print(f"\n  {ROT}Der Bau ist nicht durchgelaufen — Ausgabe oben.{AUS}\n")
                return 1
            # ERNEUT MESSEN statt Erfolg annehmen: ein Bau, der mit 0 endet,
            # hat noch lange nicht das Richtige ins Zip gelegt.
            print(f"\n  {GRAU}── noch einmal gemessen ──{AUS}\n")
            alles_pruefen(installer)
            fehler, warnungen = ausgeben(a.kurz)
        elif not a.nur_messen and not a.bauen:
            print(f"\n  {GRAU}Mit --bauen läuft das ohne Rückfrage.{AUS}")

    print()
    if fehler:
        print(f"  {ROT}NICHT startklar{AUS} — {fehler} Fehler, {warnungen} Warnung(en)\n")
        return 1
    if warnungen:
        print(f"  {GELB}Startklar mit Einschränkungen{AUS} — {warnungen} Warnung(en)\n")
        return 0
    print(f"  {GRUEN}Startklar.{AUS}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
