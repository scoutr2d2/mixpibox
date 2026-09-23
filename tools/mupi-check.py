#!/usr/bin/env python3
"""Prueft die MuPiBox von unten nach oben — die GANZE Kette, nicht Einzelteile.

WOZU: die Fehlersuche an dieser Box kostet jedes Mal dieselbe halbe Stunde,
weil die Kette lang ist und jedes Glied woanders liegt: Netz, Dienste,
Spotify, Tonserver, Bluetooth, Kiosk, Auslieferung. Erst der VERGLEICH sagt
etwas — jeder Einzelschritt unter 40 ms, das Ganze 6 Sekunden" fuehrte auf
eine Anmelde-Shell, die aus einem Dienst heraus nicht beendet.

Hier steht das gesammelte Wissen aus den Fehlern, die wir wirklich hatten:

  * Chromium ohne Verbindung zum Tonserver -> Spotify meldet Wiedergabe,
    es kommt aber kein Ton. Jellyfin laeuft trotzdem, weil es ueber mpv
    geht und nicht ueber den Browser. Das kostete am meisten Zeit.
  * /player liefert JSON an einen Browser -> weisser Pretty Print"-Schirm.
    Dreimal aufgetreten, bevor die Ursache klar war.
  * hciX-Nummern wandern; nur `Bus:` sagt, welche Hardware gemeint ist.
  * Der eingebaute Funkbaustein teilt WLAN und Bluetooth: rund 50
    Funkfehler je Minute und hoerbares Stottern, mit USB-Dongle null.
  * Kopplungen gehoeren zum ADAPTER — nach einem Wechsel ist die Liste
    leer, obwohl nichts kaputt ist.
  * Die Konsolenschrift des Startbilds kennt kein …" und macht ?" daraus.

AUFRUF
    mupi-check                # alles, lesbar
    mupi-check --json         # dasselbe als JSON
    mupi-check ton bluetooth  # nur einzelne Bereiche

Rueckgabewert: 0 wenn nichts FEHLER ist, sonst die Anzahl der Fehler.
"""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASIS = os.environ.get("MUPI_BASIS", "http://127.0.0.1:8200")
TONBENUTZER = os.environ.get("MUPI_TONBENUTZER", "dietpi")
TONLAUFZEIT = os.environ.get("MUPI_TONLAUFZEIT", "/run/user/1000")

OK, WARN, FEHLER, INFO = "OK", "WARN", "FEHLER", "INFO"
_ergebnisse = []


def melde(bereich, was, stand, wert="", bedeutung=""):
    """Ein Befund. `bedeutung` erscheint nur, wenn es nicht OK ist — bei
    einem gesunden System will niemand zwanzig Erklaerungen lesen."""
    _ergebnisse.append(
        {"bereich": bereich, "was": was, "stand": stand, "wert": str(wert), "bedeutung": bedeutung}
    )


def lauf(befehl, frist=8):
    """Ein Kommando, ohne Anmelde-Shell.

    NIE `su -` benutzen: das startet eine Anmelde-Shell, die ohne Terminal
    nicht beendet und in jede Zeitsperre laeuft. `runuser` tut es nicht.
    """
    try:
        p = subprocess.run(befehl, capture_output=True, text=True, timeout=frist)
        return p.stdout + p.stderr
    except Exception as e:
        return f"__FEHLER__ {e}"


def alsBenutzer(befehl, frist=8):
    """Etwas als der Ton-Benutzer ausfuehren (PipeWire gehoert ihm)."""
    if os.geteuid() == 0 and shutil.which("runuser"):
        return lauf(
            ["runuser", "-u", TONBENUTZER, "--", "env", f"XDG_RUNTIME_DIR={TONLAUFZEIT}"] + befehl,
            frist,
        )
    env = dict(os.environ, XDG_RUNTIME_DIR=TONLAUFZEIT)
    try:
        p = subprocess.run(befehl, capture_output=True, text=True, timeout=frist, env=env)
        return p.stdout + p.stderr
    except Exception as e:
        return f"__FEHLER__ {e}"


def hole(pfad, frist=20, kopf=None):
    """Eine HTTP-Abfrage MIT Zeitmessung — die Dauer ist oft die Aussage."""
    url = pfad if pfad.startswith("http") else BASIS + pfad
    anfrage = urllib.request.Request(url, headers=kopf or {})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(anfrage, timeout=frist) as a:
            roh = a.read()
            return a.status, roh, (time.monotonic() - t0) * 1000, a.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), (time.monotonic() - t0) * 1000, e.headers.get("Content-Type", "")
    except Exception as e:
        return 0, str(e).encode(), (time.monotonic() - t0) * 1000, ""


def jsonAus(roh):
    try:
        return json.loads(roh)
    except Exception:
        return None


# ── Bereiche ──────────────────────────────────────────────────────────────


def _execStartSkript(unit, endung=".js"):
    """Den Skriptpfad einer Unit herausfinden — die Nachfolgerin von
    `pm2 describe`.

    `systemctl show -p ExecStart --value` liefert je nach Fassung entweder
    die nackte Befehlszeile oder (seit laengerem der Regelfall) eine
    geklammerte Struktur `{ path=... ; argv[]=BEFEHL ARGUMENTE ; ... }`.
    Robust heisst hier: BEIDE Formen abfangen und aus den Wortstuecken das
    herausgreifen, das auf `endung` endet — nicht raten, welche Fassung
    gerade laeuft.
    """
    roh = lauf(["systemctl", "show", "-p", "ExecStart", "--value", unit], 10)
    stuecke = re.findall(r"argv\[\]=([^;]+)", roh) or [roh]
    for stueck in stuecke:
        for wort in stueck.split():
            wort = wort.strip()
            if wort.endswith(endung):
                return wort
    return ""


def pruefeDienste():
    """Laufen die Dienste der Box — unter systemd, nicht mehr unter pm2.

    pm2 ist seit der Umstellung auf keiner heutigen Box mehr installiert
    (README.md: „pm2 wird nirgends mehr installiert oder aufgerufen", seit
    14.08.2026 auf allen Wegen) — ein `pm2 jlist` liefe hier gegen ein
    fehlendes Programm und diese Pruefung haette der Box nichts mehr zu
    sagen, sondern nur noch WARN „nicht lesbar", egal wie gesund die Box ist.

    DIE ZWEI, DIE DIE BOX UNBEDIENBAR MACHEN (so nennt sie TRAGWEITE in
    dienste.ts): mupibox-server.service (server.js, Port 8200 — Verwaltung,
    API, Kiosk) und mupibox-player.service (spotify-control.js, Port 5005 —
    der Abspieldienst). autosetup.sh schaltet beide am Ende unbedingt per
    `systemctl enable --now` ein; jede laufende Box faehrt sie so.
    librespot.service (das Spotify-Connect-Geraet) ebenso — auf .169 wie im
    Autosetup gleichermassen eingeschaltet (dienste.ts-Belege).

    mupi_mqtt.service ist ANDERS: die Unit traegt eine ExecCondition und
    bleibt auf einer Box OHNE eingerichtetes MQTT ABSICHTLICH „inactive"
    (config/services/mupi_mqtt.service — „Laeuft heisst bei diesem Dienst
    nicht funktioniert"). Das ist dort ausdruecklich KEIN Fehler; erst
    „failed" ist einer.
    """
    KERN = (
        ("mupibox-server.service", "Server (server.js, Port 8200)"),
        ("mupibox-player.service", "Player (spotify-control.js, Port 5005)"),
        ("librespot.service", "librespot (Spotify-Connect-Geraet)"),
    )
    for unit, bezeichnung in KERN:
        stand = lauf(["systemctl", "is-active", unit], 8).strip()
        neustarts = lauf(["systemctl", "show", "-p", "NRestarts", "--value", unit], 8).strip()
        melde(
            "Dienste",
            bezeichnung,
            OK if stand == "active" else FEHLER,
            f"{stand or 'unbekannt'}, {neustarts or '?'}x neu gestartet",
            ""
            if stand == "active"
            else f"Ohne {unit} antwortet die Box nicht vollstaendig. "
            f"journalctl -u {unit[:-len('.service')]} ansehen.",
        )

    # mupi_mqtt: eingeschaltet-aber-untaetig ist der SOLL-Zustand ohne
    # eingerichtetes MQTT (ExecCondition greift, die Unit bleibt "inactive"
    # mit Result=exec-condition). Erst "failed" ist ein echter Befund.
    mqttStand = lauf(["systemctl", "is-active", "mupi_mqtt.service"], 8).strip()
    mqttFehlgeschlagen = "failed" in lauf(["systemctl", "is-failed", "mupi_mqtt.service"], 8)
    melde(
        "Dienste",
        "MQTT (mupi_mqtt.service)",
        FEHLER if mqttFehlgeschlagen else (OK if mqttStand == "active" else INFO),
        mqttStand or "unbekannt",
        "Fehlgeschlagen statt bloss abgeschaltet — journalctl -u mupi_mqtt ansehen."
        if mqttFehlgeschlagen
        else ""
        if mqttStand == "active"
        else "Inaktiv ist hier normal, wenn MQTT nicht eingerichtet ist (ExecCondition in der Unit).",
    )


def pruefeNetz():
    st, roh, ms, _ = hole("/api/netzwerk")
    d = jsonAus(roh) or {}
    aktiv = [i for i in d.get("schnittstellen", []) if i.get("aktiv")]
    melde(
        "Netz",
        "Schnittstellen",
        OK if aktiv else FEHLER,
        ", ".join(i.get("name", "?") for i in aktiv) or "keine aktiv",
        "" if aktiv else "Keine aktive Schnittstelle — die Box haengt an nichts.",
    )
    kabel = [i for i in aktiv if i.get("funk") is False]
    if kabel:
        melde("Netz", "Weg", INFO, "LAN", "")
    elif aktiv:
        w = d.get("wlan") or {}
        melde("Netz", "Weg", INFO, f"WLAN {w.get('ssid','?')} @ {w.get('frequenzMhz','?')} MHz, {w.get('signal','?')} dBm", "")
    internet = d.get("internet")
    melde(
        "Netz",
        "Internet",
        OK if internet else (FEHLER if internet is False else WARN),
        internet,
        "" if internet else "Verbunden heisst nicht online. Ohne Internet laedt kein Spotify.",
    )


def pruefeSchnittstellen():
    """Die Endpunkte MIT Dauer. Langsam ist hier ein eigener Befund:
    /api/bluetooth brauchte einmal 6,1 s, obwohl jeder Einzelschritt darin
    unter 40 ms lag — die Zeit steckte in einer Anmelde-Shell."""
    for pfad, grenze in (
        ("/api/data", 500),
        ("/api/netzwerk", 3000),
        ("/api/bluetooth", 2500),
        ("/api/bt-adapter", 1500),
        ("/api/wlan-adapter", 1500),
    ):
        st, roh, ms, _ = hole(pfad)
        stand = FEHLER if st != 200 else (WARN if ms > grenze else OK)
        melde(
            "Schnittstellen",
            pfad,
            stand,
            f"{st} in {ms:.0f} ms",
            ""
            if stand == OK
            else (
                "Antwortet nicht."
                if st != 200
                else f"Ueber {grenze} ms. Vergleiche die Einzelschritte: ist deren Summe viel kleiner, wartet der Dienst auf etwas."
            ),
        )


def pruefeMedien():
    st, roh, ms, _ = hole("/api/data")
    d = jsonAus(roh) or []
    melde("Medien", "Eintraege", OK if d else FEHLER, len(d), "" if d else "Keine Medien konfiguriert oder data.json unlesbar.")
    kat = {}
    for x in d:
        kat.setdefault(x.get("category", "?"), set()).add(x.get("artist"))
    for k, v in sorted(kat.items()):
        melde("Medien", f"Kategorie {k}", INFO, f"{len(v)} Interpreten", "")


def pruefeSpotify():
    st, roh, ms, _ = hole("/api/data")
    eintraege = [x for x in (jsonAus(roh) or []) if x.get("type") == "spotify"]
    if not eintraege:
        melde("Spotify", "Eintraege", INFO, "keine", "")
        return
    melde("Spotify", "Eintraege", INFO, len(eintraege), "")
    # JEDEN konfigurierten Eintrag wirklich aufloesen — nicht nur einen.
    # Die Listen laden nicht" betraf beim letzten Mal genau zwei von sieben.
    schlecht = 0
    for x in eintraege:
        art, kennung = None, None
        for feld, weg in (("playlistid", "playlist"), ("showid", "show"), ("id", "album")):
            if x.get(feld):
                art, kennung = weg, x[feld]
                break
        if not kennung:
            melde("Spotify", x.get("title", "?")[:34], WARN, "keine Kennung", "Eintrag ohne id/playlistid/showid — er kann nie laden.")
            schlecht += 1
            continue
        st, roh, ms, _ = hole(f"/api/spotify/{art}/{kennung}", frist=25)
        d = jsonAus(roh)
        gut = st == 200 and d not in (None, [], {})
        melde(
            "Spotify",
            x.get("title", "?")[:34],
            OK if gut else FEHLER,
            f"{art} {st} in {ms:.0f} ms",
            "" if gut else "Diese Liste laedt nicht. Zugangsdaten, Kennung oder Spotify-Grenze pruefen.",
        )
        if not gut:
            schlecht += 1
    if schlecht == 0:
        melde("Spotify", "Titelbild", *_bildProbe(eintraege))


def _bildProbe(eintraege):
    """Ein echtes Titelbild holen — die CDN ist ein eigener Weg nach draussen."""
    for x in eintraege:
        if not x.get("playlistid"):
            continue
        st, roh, ms, _ = hole(f"/api/spotify/playlist/{x['playlistid']}", frist=20)
        d = jsonAus(roh) or {}
        bilder = (d.get("playlist") or {}).get("images") or []
        if not bilder:
            continue
        st2, _, ms2, _ = hole(bilder[0].get("url", ""), frist=15)
        gut = st2 == 200
        return (OK if gut else FEHLER, f"{st2} in {ms2:.0f} ms", "" if gut else "Die Bild-CDN ist nicht erreichbar — Kacheln bleiben leer.")
    return (INFO, "keine Bilder", "")


def pruefeMusikdienste():
    """Sind Spotify und Jellyfin erreichbar — und ueberhaupt eingerichtet?

    Nur "eingerichtet, aber nicht erreichbar" ist eine Stoerung. Ein nicht
    eingerichteter Dienst ist Absicht und darf nicht als Fehler erscheinen.
    """
    st, roh, ms, _ = hole("/api/musikdienste", frist=20)
    d = jsonAus(roh) or {}
    if st != 200:
        melde("Musikdienste", "Abfrage", FEHLER, f"HTTP {st}", "Die Box kann ihre Dienste nicht pruefen.")
        return
    for name in ("spotify", "jellyfin"):
        l = d.get(name) or {}
        if not l.get("eingerichtet"):
            melde("Musikdienste", name, INFO, "nicht eingerichtet", "")
            continue
        melde(
            "Musikdienste",
            name,
            OK if l.get("erreichbar") else FEHLER,
            "erreichbar" if l.get("erreichbar") else "NICHT erreichbar",
            "" if l.get("erreichbar") else f"{name} ist eingerichtet, antwortet aber nicht. Netz, Adresse oder Zugangsdaten pruefen.",
        )


def pruefeSpotifyTief():
    """Die Spotify-Kette Glied fuer Glied — bis auf das eine, das fehlt.

    Reihenfolge nach Aussagekraft. Faellt ein frueheres Glied aus, sind die
    spaeteren bedeutungslos:

      Zugangsdaten -> Erneuerung -> Konto (Premium) -> librespot -> Geraet

    Ein abgelaufener Zugangs-Token ist NORMAL (eine Stunde). Entscheidend ist,
    ob die ERNEUERUNG geht. Das WEB-SDK kommt in der Kette nicht mehr vor -
    es ist in Rente (Spotify verweigert seinen Tonabruf, storage-resolve 403
    bei jeder Origin-Kopfzeile); Ton macht das native librespot.

    Es wird NIE ein Token ausgegeben, nur ob einer da ist und ob er wirkt.
    """
    import urllib.parse

    try:
        with open("/etc/mupibox/mupiboxconfig.json", encoding="utf8") as f:
            sp = (json.load(f) or {}).get("spotify") or {}
    except Exception as e:
        melde("Spotify-Kette", "Konfiguration", FEHLER, str(e)[:60], "mupiboxconfig.json nicht lesbar.")
        return

    felder = {
        "clientId": bool(sp.get("clientId")),
        "refreshToken": bool(sp.get("refreshToken")),
        "accessToken": bool(sp.get("accessToken")),
        "deviceId": bool(sp.get("deviceId")),
    }
    melde(
        "Spotify-Kette",
        "Zugangsdaten",
        OK if felder["clientId"] and felder["refreshToken"] else FEHLER,
        ", ".join(f"{k}={'ja' if v else 'NEIN'}" for k, v in felder.items()),
        ""
        if felder["clientId"] and felder["refreshToken"]
        else "Ohne clientId und refreshToken kann sich nichts anmelden. Am Geraet neu einrichten.",
    )
    if not (felder["clientId"] and felder["refreshToken"]):
        return
    # deviceId stammt aus der SDK-Zeit und ist seit der SDK-Rente bedeutungslos
    # - das Geraet ist librespot, und dessen Kennung wird live aufgeloest.

    neuerToken = None
    try:
        daten = urllib.parse.urlencode(
            {"grant_type": "refresh_token", "refresh_token": sp["refreshToken"], "client_id": sp["clientId"]}
        ).encode()
        anfrage = urllib.request.Request(
            "https://accounts.spotify.com/api/token",
            data=daten,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(anfrage, timeout=15) as a:
            neuerToken = (json.load(a) or {}).get("access_token")
        melde("Spotify-Kette", "Erneuerung", OK if neuerToken else FEHLER, "neuer Token" if neuerToken else "kein Token",
              "" if neuerToken else "Spotify gibt keinen neuen Token. Neu anmelden.")
    except urllib.error.HTTPError as e:
        melde("Spotify-Kette", "Erneuerung", FEHLER, f"HTTP {e.code}",
              "Der refreshToken gilt nicht mehr (zurueckgezogen oder Konto geaendert). Am Geraet neu anmelden.")
        return
    except Exception as e:
        melde("Spotify-Kette", "Erneuerung", WARN, str(e)[:50], "Spotify war nicht erreichbar — Netz pruefen.")
        return

    if neuerToken:
        try:
            q = urllib.request.Request("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {neuerToken}"})
            with urllib.request.urlopen(q, timeout=15) as a:
                me = json.load(a) or {}
            produkt = me.get("product")
            melde(
                "Spotify-Kette",
                "Konto",
                OK if produkt == "premium" else FEHLER,
                f"{me.get('display_name')} / {produkt}",
                "" if produkt == "premium" else "Das Web-SDK spielt NUR mit Premium. Ohne Premium bleibt die Box stumm.",
            )
        except Exception as e:
            melde("Spotify-Kette", "Konto", WARN, str(e)[:50], "")

    # DAS ENTSCHEIDENDE GLIED — seit der SDK-Rente (2026-07-27) heisst es
    # LIBRESPOT. Das Web-SDK ist tot: Spotify weist seinen Tonabruf ab
    # (storage-resolve 403 bei jeder Origin-Kopfzeile, sogar sdk.scdn.co).
    # Ton macht das native librespot (Spotify Connect) als Geraet "MuPiBox".
    dienst = lauf(["systemctl", "is-active", "librespot"], 8).strip()
    melde(
        "Spotify-Kette", "librespot-Dienst",
        OK if dienst == "active" else FEHLER, dienst or "unbekannt",
        "" if dienst == "active"
        else "Ohne librespot gibt es KEIN Spotify-Tongeraet mehr (das Web-SDK ist tot, "
             "s.o.). systemctl start librespot.",
    )

    # Die Version zuerst: ein zu altes librespot erklaert Fehler, die sonst
    # stundenlang bei Token und Konto gesucht werden (genau so passiert).
    roh = lauf(["/usr/bin/librespot", "--version"], 8)
    fassung = ""
    for stueck in roh.split():
        if stueck[:1].isdigit() and "." in stueck:
            fassung = stueck
            break
    altfassung = fassung and fassung < "0.8"
    melde(
        "Spotify-Kette", "librespot-Fassung",
        FEHLER if altfassung else (OK if fassung else INFO),
        fassung or "unbekannt",
        "ZU ALT - das spielt nicht. Bis 0.7.x fragt librespot den ueberholten "
        "Metadaten-Endpunkt ab, der keine Tondatei mehr mitliefert; jeder Titel meldet "
        "dann 'not available'. Im A/B-Test belegt: gleiche Anmeldung, 0.6.0-dev stumm, "
        "0.8.0 spielt. Selber bauen, es gibt keine fertigen Binaerdateien - Anleitung "
        "im Wiki librespot-versionen-2026."
        if altfassung else "",
    )

    anmeldung = os.path.exists("/home/dietpi/.cache/spotify/credentials.json")
    melde(
        "Spotify-Kette", "librespot-Anmeldung",
        OK if anmeldung else WARN,
        "credentials.json da" if anmeldung else "noch keine",
        "" if anmeldung
        else "Normalfall: librespot meldet sich beim ersten Start mit dem Token aus "
             "mupiboxconfig.json an und legt credentials.json dabei an. Bleibt sie aus, "
             "fehlt der Token - oder die Box in der Spotify-App einmal als Geraet waehlen.",
    )

    if neuerToken:
        try:
            q = urllib.request.Request(
                "https://api.spotify.com/v1/me/player/devices", headers={"Authorization": f"Bearer {neuerToken}"}
            )
            with urllib.request.urlopen(q, timeout=15) as a:
                geraete = (json.load(a) or {}).get("devices") or []
            eigen = [g for g in geraete if "mupi" in str(g.get("name", "")).lower()]
            melde(
                "Spotify-Kette",
                "Geraet bei Spotify",
                OK if eigen else (WARN if anmeldung else INFO),
                ", ".join(str(g.get("name")) for g in eigen) or f"{len(geraete)} fremde",
                "" if eigen
                else ("librespot laeuft, ist aber nicht in Spotifys Geraeteliste - Dienstprotokoll ansehen "
                      "(journalctl -u librespot)." if anmeldung
                      else "Erwartet: ohne Anmeldung (s.o.) meldet sich librespot noch nicht als Geraet."),
            )
            # "not available" im Protokoll: das heisst NICHT gesperrt, sondern
            # die Metadaten kamen ohne Tondatei (Quelltext player.rs,
            # find_available_alternative: nur bei leerem `files`). Haeufigste
            # Ursache: zu altes librespot - bis 0.7.x fragt es den ALTEN
            # Metadaten-Endpunkt ab, 0.8.0 den erweiterten.
            if eigen:
                proto = lauf(["journalctl", "-u", "librespot", "-n", "80", "--no-pager"], 10)
                schlecht = proto.count("no alternatives found")
                if schlecht >= 3:
                    melde("Spotify-Kette", "Titel abspielbar", FEHLER,
                          f"{schlecht}x ohne Tondatei",
                          "Die Metadaten kommen OHNE Tondatei zurueck (keine Sperre!). "
                          "Fast immer: librespot zu alt - 0.8.0+ verwenden, das den "
                          "erweiterten Metadaten-Endpunkt nutzt. Siehe Wiki "
                          "librespot-versionen-2026.")
        except Exception as e:
            melde("Spotify-Kette", "Geraet bei Spotify", WARN, str(e)[:50], "")

    alt = sp.get("accessToken") or ""
    if alt:
        gilt = False
        try:
            q = urllib.request.Request("https://api.spotify.com/v1/me", headers={"Authorization": f"Bearer {alt}"})
            urllib.request.urlopen(q, timeout=12)
            gilt = True
        except Exception:
            gilt = False
        melde(
            "Spotify-Kette",
            "Token DER BOX",
            OK if gilt else WARN,
            "gueltig" if gilt else "abgelaufen",
            ""
            if gilt
            else "Der Abspieldienst erneuert sich seinen Token inzwischen selbst aus dem "
            "refreshToken - ein abgelaufener gespeicherter accessToken ist darum nur noch "
            "Schoenheit, kein Ausfall.",
        )


def pruefeKioskKonsole():
    """Was der Kiosk-Browser SELBST meldet.

    Ohne diese Quelle raet man. Sie ist nur da, wenn im Autostart
    `--enable-logging=stderr` gesetzt und die Ausgabe umgelenkt wurde (siehe
    Wiki: kiosk-konsole-mitlesen). Fehlt sie, ist das kein Fehler, sondern ein
    Hinweis, was zu tun ist.
    """
    pfad = "/var/log/mupi-kiosk.log"
    if not os.path.isfile(pfad):
        melde(
            "Kiosk-Konsole",
            "Protokoll",
            INFO,
            "nicht eingerichtet",
            "Ohne Browser-Protokoll bleibt die letzte Meile blind. Einrichten: siehe Wiki kiosk-konsole-mitlesen.",
        )
        return
    try:
        with open(pfad, encoding="utf8", errors="replace") as f:
            zeilen = f.readlines()[-4000:]
    except Exception as e:
        melde("Kiosk-Konsole", "Protokoll", WARN, str(e)[:50], "")
        return

    # Das Web-SDK ist ABGESCHAFFT (Spotify verweigert seinen Tonabruf). Seine
    # Abwesenheit ist also der SOLL-Zustand - taucht es wieder auf, hat jemand
    # shouldUsePlayer() zurueckgebaut und holt sich den stillen Fehler zurueck.
    sdk = [z for z in zeilen if "Spotify SDK" in z]
    bereit = [z for z in sdk if "Ready with Device ID" in z]
    fehler = [z for z in sdk if "playback error" in z.lower()]
    melde(
        "Kiosk-Konsole",
        "Web-SDK (soll AUS sein)",
        WARN if bereit else OK,
        "meldet sich an!" if bereit else "aus, wie vorgesehen",
        "Das SDK ist wieder aktiv. Es kann NICHT abspielen (Spotify beantwortet seinen "
        "Tonabruf mit 403) - jemand hat shouldUsePlayer() zurueckgebaut. Ton macht "
        "librespot, siehe spotifykette."
        if bereit else "",
    )
    if fehler:
        melde(
            "Kiosk-Konsole", "Wiedergabefehler", WARN, f"{len(fehler)}x",
            "Altlast im Protokoll oder das SDK laeuft wieder (s.o.). Der aktuelle Tonweg "
            "ist librespot - dessen Fehler stehen in journalctl -u librespot.",
        )
    # Widevine-Fassung: bei einem viel neueren Chromium ist ein altes CDM ein
    # ernstzunehmender Verdacht.
    import glob as _g

    stände = []
    for m in _g.glob("/home/*/.config/chromium/WidevineCdm/*/manifest.json") + _g.glob(
        "/opt/WidevineCdm/**/manifest.json", recursive=True
    ):
        try:
            with open(m, encoding="utf8") as f:
                stände.append(str((json.load(f) or {}).get("version")))
        except Exception:
            pass
    browser = ""
    try:
        browser = lauf(["chromium", "--version"], 10).strip().split()[1]
    except Exception:
        browser = "?"
    melde(
        "Kiosk-Konsole",
        "Widevine / Browser",
        INFO,
        f"CDM {', '.join(sorted(set(stände))) or 'keins'} | Chromium {browser}",
        "",
    )


def pruefeBrowserTon():
    """Kann der Kiosk-Browser UEBERHAUPT Ton erzeugen?

    Die entscheidende Trennung, wenn Spotify nicht spielt: liegt es am
    Browser-Ton oder an der Medienkette des SDK? Ein kurzer Testton ueber die
    Web-Audio-Schnittstelle beantwortet das in Sekunden — er braucht weder
    Spotify noch DRM. Erscheint dabei eine Tonquelle namens Chromium, ist der
    Weg vom Browser zum Lautsprecher in Ordnung, und ein Playback error des
    SDK hat eine ANDERE Ursache (Widevine/Codecs).

    Braucht den Fehlersuch-Port (siehe Wiki: kiosk-konsole-mitlesen).
    """
    import base64 as _b64
    import socket as _sock
    import time as _t

    try:
        z = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5))
    except Exception:
        melde("Browser-Ton", "Fehlersuch-Port", INFO, "nicht offen",
              "Ohne Port kein Testton. Einrichten: siehe Wiki kiosk-konsole-mitlesen.")
        return
    seite = next((x for x in z if x.get("type") == "page"), None)
    if not seite:
        melde("Browser-Ton", "Seite", FEHLER, "keine offen", "Der Kiosk zeigt nichts an.")
        return
    try:
        ws = seite["webSocketDebuggerUrl"]
        host, rest = ws.split("://")[1].split("/", 1)
        h, p = host.split(":")
        s = _sock.create_connection((h, int(p)), timeout=8)
        k = _b64.b64encode(os.urandom(16)).decode()
        s.send(
            (
                f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {k}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        s.recv(4096)
        code = (
            "(()=>{const c=new (window.AudioContext||window.webkitAudioContext)();"
            "const o=c.createOscillator();const g=c.createGain();g.gain.value=0.02;"
            "o.connect(g);g.connect(c.destination);o.start();"
            "setTimeout(()=>{o.stop();c.close();},4000);return c.state;})()"
        )
        n = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": code, "returnByValue": True}}).encode()
        kopf = bytearray([0x81, 0x80 | 126]) + len(n).to_bytes(2, "big") if len(n) > 125 else bytearray([0x81, 0x80 | len(n)])
        s.send(bytes(kopf) + b"\x00\x00\x00\x00" + n)
        _t.sleep(2)
        quellen = alsBenutzer(["pactl", "list", "sink-inputs"], 10)
        s.close()
        chrom = quellen.lower().count("chromium")
        melde(
            "Browser-Ton",
            "Testton",
            OK if chrom else FEHLER,
            "Chromium erzeugt Ton" if chrom else "keine Tonquelle",
            ""
            if chrom
            else "Der Browser bringt gar keinen Ton heraus. Dann liegt es NICHT an Spotify — "
            "erst diesen Weg richten (Tonserver, Standardsenke, Berechtigungen).",
        )
    except Exception as e:
        melde("Browser-Ton", "Testton", WARN, str(e)[:60], "")


def pruefeSpotifyRechte():
    """Warum Spotify-Listen im Browser leer bleiben - und serverseitig nicht.

    DIE URSACHE, gemessen und nicht vermutet: Spotify beantwortet Aufrufe der
    Web-API, die eine Origin-Kopfzeile tragen - also JEDEN Aufruf aus einem
    Browser - mit 403 und LEEREM Koerper. Ausgenommen sind allein die
    Wiedergabe-Endpunkte (/me/player*).

    Diese Pruefung misst deshalb JEDEN Pfad ZWEIMAL: einmal wie ein Server
    (ohne Origin) und einmal wie ein Browser (mit Origin). Erst der Vergleich
    zeigt es; eine Messung allein aus dem Browser sieht ueberall 403 und fuehrt
    zu dem Fehlschluss, die App sei gesperrt (dieser Fehlschluss hat hier
    einen Abend gekostet).

    ERKENNUNGSZEICHEN: der 403 hat einen LEEREN Koerper. Eine fehlende
    Berechtigung meldet Spotify als JSON mit Text.

    WAS DAS ERKLAERT: /spotify meldet "Playlists laden fehlgeschlagen",
    Titellisten bleiben leer, die Oberflaeche zeigt trotzdem Listen (die
    kommen aus dem Zwischenspeicher der Box), und das Web-SDK meldet sich
    sauber an, weil die Wiedergabe-Endpunkte als einzige noch antworten.

    ABHILFE ist gebaut: die Oberflaeche fragt ueber /api/spotify/web/... der
    Box, wo der Aufruf ohne Origin laeuft. Meldet diese Pruefung "mit Origin
    gesperrt" UND die Oberflaeche zeigt trotzdem Listen, ist alles richtig.
    """
    import urllib.parse

    try:
        with open("/etc/mupibox/mupiboxconfig.json", encoding="utf8") as f:
            sp = (json.load(f) or {}).get("spotify") or {}
        daten = urllib.parse.urlencode(
            {"grant_type": "refresh_token", "refresh_token": sp["refreshToken"], "client_id": sp["clientId"]}
        ).encode()
        anfrage = urllib.request.Request(
            "https://accounts.spotify.com/api/token", data=daten,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(anfrage, timeout=15) as a:
            tok = (json.load(a) or {}).get("access_token")
    except Exception as e:
        melde("Spotify-Rechte", "Token", WARN, str(e)[:50], "Ohne Token laesst sich nichts pruefen.")
        return

    def rufe(pfad, alsBrowser):
        kopf = {"Authorization": f"Bearer {tok}"}
        if alsBrowser:
            # Die Herkunft selbst ist egal - entscheidend ist, DASS eine da ist.
            kopf["Origin"] = "http://localhost:8200"
        try:
            urllib.request.urlopen(urllib.request.Request("https://api.spotify.com/v1" + pfad, headers=kopf), timeout=12)
            return 200
        except urllib.error.HTTPError as e:
            return e.code
        except Exception:
            return 0

    proben = [
        ("/me/player/devices", "Wiedergabe-Steuerung"),
        ("/me", "eigenes Konto"),
        ("/me/playlists?limit=1", "eigene Playlists"),
        ("/search?q=a&type=track&limit=1", "Suche"),
    ]
    serverOk, browserWeg, echtGesperrt = [], [], []
    for pfad, name in proben:
        ohne, mit = rufe(pfad, False), rufe(pfad, True)
        if ohne == 200:
            serverOk.append(name)
            if mit == 403:
                browserWeg.append(name)
        elif ohne == 403:
            echtGesperrt.append(name)

    melde(
        "Spotify-Rechte", "serverseitig (ohne Origin)",
        OK if not echtGesperrt else FEHLER,
        ", ".join(serverOk) or "nichts",
        "" if not echtGesperrt
        else f"Auch OHNE Origin gesperrt: {', '.join(echtGesperrt)}. DAS waere ein echtes "
             "Rechteproblem der Client-ID - anders als der Browser-Fall darunter.",
    )
    melde(
        "Spotify-Rechte", "aus dem Browser (mit Origin)",
        INFO if browserWeg else OK,
        f"gesperrt: {', '.join(browserWeg)}" if browserWeg else "alles erlaubt",
        "Erwartet und kein Fehler: Spotify beantwortet Web-API-Aufrufe aus Browsern nicht mehr. "
        "Die Oberflaeche fragt deshalb ueber /api/spotify/web/... der Box. Bleiben Listen trotzdem "
        "leer, liegt es an dieser Durchreiche - nicht an Token, Konto oder Berechtigungen."
        if browserWeg else "",
    )


def pruefeKinderzeit():
    """Kinderzeit: gilt sie, und ist sie NICHT im Weg?

    Zwei Fragen, und die zweite ist die wichtigere. Eine Zeitgrenze, die
    faelschlich sperrt, sieht fuer die Familie aus wie eine kaputte Box.
    """
    st, roh, ms, _ = hole("/api/kinderzeit/stand", frist=12)
    d = jsonAus(roh) or {}
    if st != 200:
        melde("Kinderzeit", "Schnittstelle", INFO, f"HTTP {st}",
              "Diese Fassung kennt die Kinderzeit noch nicht.")
        return
    aktiv = bool(d.get("aktiv"))
    melde("Kinderzeit", "eingeschaltet", INFO, "ja" if aktiv else "nein",
          "" if aktiv else "Die Box spielt ohne Zeitgrenze - so ist sie ausgeliefert.")
    if not aktiv:
        return
    erlaubt = d.get("erlaubt") is not False
    texte = {
        "frei": "darf gerade hoeren",
        "tagGesperrt": "heute gesperrt",
        "zuFrueh": f"noch zu frueh (ab {d.get('fensterAb') or '?'})",
        "zuSpaet": f"Feierabend (war bis {d.get('fensterBis') or '?'})",
        "aufgebraucht": "Zeit fuer heute aufgebraucht",
    }
    melde("Kinderzeit", "Stand jetzt", OK if erlaubt else INFO,
          texte.get(str(d.get("grund")), str(d.get("grund"))),
          "" if erlaubt else "KEIN Fehler - die Box haelt sich an die eingestellte Regel. "
          "Wer trotzdem hoeren will: in der Verwaltung unter Kinderzeit Minuten schenken.")
    rest = d.get("restMin")
    melde("Kinderzeit", "heute", INFO,
          f"{d.get('verbrauchtMin', 0)} min gehoert"
          + (f", {rest} min uebrig" if isinstance(rest, int) else ", unbegrenzt")
          + (f" (+{d['bonusMin']} geschenkt)" if d.get("bonusMin") else ""),
          "")
    # Der gefaehrlichste Fehler waere eine Grenze, die das ANHALTEN blockiert.
    stStop, _, _, _ = hole("/player/current/stop", frist=10)
    melde("Kinderzeit", "Anhalten geht trotzdem", OK if stStop == 200 else FEHLER,
          f"HTTP {stStop}",
          "" if stStop == 200 else "SCHWER: die Kinderzeit blockiert das Anhalten. Die Box laesst "
          "sich dann nicht mehr stoppen - schlimmer als gar keine Grenze.")


def pruefeAuslieferungPfade():
    """Laeuft wirklich die Datei, die zuletzt ausgeliefert wurde?

    DIE FALLE: server.js und spotify-control.js liegen in VERSCHIEDENEN
    Ordnern, und mupibox-player.service startet spotify-control.js aus
    spotifycontroller-main (config/services/mupibox-player.service:
    ExecStart=/usr/bin/node .../spotifycontroller-main/spotify-control.js).
    Wer es neben server.js legt, aendert eine Datei, die niemand ausfuehrt -
    die Box verhaelt sich unveraendert und man sucht im Code (genau so
    passiert, 2026-07-28).

    Bis zur Umstellung auf systemd stand dieser Pfad in `pm2 describe
    spotify-control` (siehe README.md: \u201epm2 wird nirgends mehr installiert
    oder aufgerufen"). Heute liefert ihn `systemctl show -p ExecStart` der
    Unit mupibox-player.service \u2014 pm2 gibt es auf keiner heutigen Box mehr.
    """
    import hashlib

    pfad = _execStartSkript("mupibox-player.service")
    melde(
        "Auslieferung", "spotify-control laeuft aus",
        OK if pfad else WARN,
        pfad.replace("/home/dietpi/.mupibox/", "") or "unbekannt",
        "" if pfad else "ExecStart nicht lesbar (Unit fehlt oder systemctl kennt sie nicht) - Pfad nicht pruefbar.",
    )

    # Liegt daneben eine ABWEICHENDE Kopie? Dann hat jemand falsch ausgeliefert.
    neben = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/spotify-control.js"
    if pfad and os.path.exists(neben) and os.path.abspath(neben) != os.path.abspath(pfad):
        def summe(p):
            try:
                with open(p, "rb") as f:
                    return hashlib.sha256(f.read()).hexdigest()[:12]
            except Exception:
                return ""
        a, b = summe(pfad), summe(neben)
        melde(
            "Auslieferung", "zweite Kopie daneben",
            OK if a == b else FEHLER,
            "gleich" if a == b else "WEICHT AB",
            "" if a == b
            else "Neben server.js liegt eine ANDERE Fassung von spotify-control.js als die "
            "laufende. Fast sicher wurde dorthin ausgeliefert - die Aenderung wirkt nicht. "
            f"Nach {pfad} kopieren und systemctl restart mupibox-player.",
        )


def _umschaltAufbau(bereich):
    """Gemeinsamer Aufbau fuer alle Umschalt-Pruefungen.

    Sucht die Tonsenke, baut die Messfunktion und leitet je ein Jellyfin- und
    ein Spotify-Ziel aus der ECHTEN Bibliothek her. Gibt None zurueck, wenn
    etwas davon fehlt - dann hat schon eine Meldung stattgefunden.

    HERAUSGEZOGEN, weil es inzwischen drei Pruefungen gibt (der normale
    Wechsel, eine Folge mit zweimal DEMSELBEN Dienst, und ein schneller
    Belastungstest). Dreimal derselbe Aufbau waere dreimal derselbe Fehler.
    """

    import array

    # ZWEI UNABHAENGIGE TONMASCHINEN: librespot (Spotify, eigener Prozess) und
    # mpv (Jellyfin/lokal). Beim Wechsel muss die alte still werden - sonst
    # klingen beide uebereinander.
    #
    # DIE FALLE, die hier zweimal in die Irre fuehrte: eine offene Tonquelle
    # beweist NICHTS. librespot haelt seine Quelle IMMER offen, auch pausiert,
    # und pactl zeigt sie sogar als "nicht stillgelegt" (Corked: no). Gemessen
    # wird deshalb der PEGEL am Mithoerausgang - was das Kind hoert.

    # ALS TONBENUTZER: als root gehoert uns die Laufzeit der Sitzung nicht
    # ("XDG_RUNTIME_DIR is not owned by us"), und die Fehlermeldung landete
    # sonst als angeblicher Senkenname im naechsten Befehl.
    # pactl schreibt eine Warnung ueber eine fehlende Keksdatei mit ins
    # Ergebnis - der Senkenname ist die LETZTE Zeile, die wie einer aussieht.
    roh = alsBenutzer(["pactl", "get-default-sink"], 10)
    senke = ""
    for z in roh.splitlines():
        z = z.strip()
        if z and " " not in z and "." in z:
            senke = z
    if not senke:
        melde(bereich, "Standardsenke", WARN, "keine", "Ohne Tonsenke ist nichts messbar.")
        return None

    def pegel(dauer=3):
        """Spitzenpegel 0..1 - oder None, wenn nichts aufzunehmen war.

        MINDESTENS DREI SEKUNDEN, und das ist keine Vorsicht, sondern
        gemessen (2026-07-28): `parec` puffert 64 KB, bevor es die erste
        Zeile schreibt. Bei einem Fenster von 1 s oder 2 s kommen NULL Byte
        heraus - die Messung meldet dann "still", egal was laeuft. Genau so
        meldete der Belastungstest zehnmal "kein Ton", waehrend am
        Lautsprecher alle zehn zu hoeren waren.
        """
        dauer = max(3, dauer)
        befehl = (f"timeout {dauer}s parec --device={senke}.monitor "
                  f"--format=s16le --rate=22050 --channels=1 --raw > /tmp/mupi-mithoer.raw 2>/dev/null")
        if os.geteuid() == 0 and shutil.which("runuser"):
            vor = ["runuser", "-u", TONBENUTZER, "--", "env", f"XDG_RUNTIME_DIR={TONLAUFZEIT}", "bash", "-c", befehl]
        else:
            vor = ["bash", "-c", f"XDG_RUNTIME_DIR={TONLAUFZEIT} " + befehl]
        subprocess.run(vor, timeout=dauer + 8, check=False)
        try:
            d = open("/tmp/mupi-mithoer.raw", "rb").read()
        except Exception:
            return None
        if len(d) < 2000:
            return None  # Senke schlief - das ist Stille
        w = array.array("h")
        w.frombytes(d[: len(d) // 2 * 2])
        return max(abs(x) for x in w) / 32768.0

    def ruf(pfad):
        try:
            urllib.request.urlopen(f"http://localhost:8200{pfad}", timeout=15).read()
            return True
        except Exception:
            return False

    # Ein Jellyfin-Album und dessen ersten Titel selbst herleiten.
    try:
        with urllib.request.urlopen("http://localhost:8200/api/data", timeout=15) as a:
            medien = json.load(a)
        alb = next(m for m in medien if str(m.get("type", "")).startswith("jellyfin"))
        server = re.match(r"(https?://[^/]+)", alb["cover"]).group(1)
        sch = urllib.parse.parse_qs(urllib.parse.urlparse(alb["cover"]).query)["api_key"][0]
        with urllib.request.urlopen(
            f"{server}/Items?ParentId={alb['id']}&IncludeItemTypes=Audio&Recursive=true&api_key={sch}",
            timeout=15,
        ) as a:
            titel = json.load(a)["Items"][0]
        # Spotify-Eintraege sind haeufig PLAYLISTS (playlistid), nicht Alben -
        # eine reine id-Suche findet in einer echten Bibliothek nichts.
        #
        # MEHRERE nehmen, nicht nur einen: derselbe Titel zweimal ist nicht der
        # echte Fall. Im Alltag springt ein Kind zu einem ANDEREN Song, und
        # genau dort kann sich ein Dienst anders verhalten - der Sprung
        # innerhalb desselben Stuecks sagt darueber nichts.
        spots = [m for m in medien
                 if m.get("type") == "spotify"
                 and (m.get("id") or m.get("playlistid") or m.get("showid") or m.get("audiobookid"))][:4]
        spot = spots[0] if spots else None
    except Exception as e:
        melde(bereich, "Testmedien", WARN, str(e)[:50],
              "Braucht je ein Jellyfin-Album und ein Spotify-Album in der Bibliothek.")
        return None
    if not spot:
        melde(bereich, "Testmedien", WARN, "kein Spotify-Album", "")
        return None

    q = lambda s: urllib.parse.quote(str(s), safe="")
    jf = (f"/player/current/jellyfin/{q(server)}%2FAudio%2F{titel['Id']}%2Fstream"
          f"%3Fstatic%3Dtrue%26api_key%3D{sch}/{q(titel['Name'])}:title:artist:{q(alb.get('artist',''))}")
    def spotZiel(m, nr=0):
        if m.get("id"):
            return f"/player/current/spotify/now/spotify:album:{q(m['id'])}:1:{nr}"
        if m.get("playlistid"):
            return f"/player/current/spotify/now/spotify:playlist:{q(m['playlistid'])}:1:{nr}"
        if m.get("showid"):
            return f"/player/current/spotify/now/spotify:episode:{q(m['showid'])}:1:{nr}"
        return f"/player/current/spotify/now/spotify:show:{q(m['audiobookid'])}:1:{nr}"

    # Verschiedene Ziele: erst die anderen Alben/Listen der Bibliothek, und
    # falls es nur eines gibt, wenigstens verschiedene TITEL daraus (der
    # letzte Teil des Pfades ist die Titelnummer).
    spListe = [spotZiel(m) for m in spots]
    if len(spListe) < 4:
        spListe += [spotZiel(spot, n) for n in range(1, 5 - len(spListe))]
    sp = spListe[0]

    # Jellyfin: mehrere Titel desselben Albums - das reicht, um nicht immer
    # denselben zu spielen, und braucht keine zweite Bibliotheksabfrage.
    jfListe = [jf]
    try:
        with urllib.request.urlopen(
            f"{server}/Items?ParentId={alb['id']}&IncludeItemTypes=Audio&Recursive=true&api_key={sch}",
            timeout=15,
        ) as a:
            weitere = json.load(a)["Items"][1:4]
        for t in weitere:
            jfListe.append(
                f"/player/current/jellyfin/{q(server)}%2FAudio%2F{t['Id']}%2Fstream"
                f"%3Fstatic%3Dtrue%26api_key%3D{sch}/{q(t['Name'])}:title:artist:{q(alb.get('artist',''))}"
            )
    except Exception:
        pass  # dann eben nur der eine

    def anlauf(pfad, grenze=12):
        """Wie lange dauert es vom Befehl bis zum ersten Ton?

        EINE durchgehende Aufnahme statt vieler kurzer Proben. Kurze Proben
        sind hier unbrauchbar (siehe `pegel`: unter 3 s liefert parec gar
        nichts), und mehrere hintereinander haetten ohnehin nur eine
        Aufloesung von mehreren Sekunden. So wird EINMAL mitgeschnitten und
        darin gesucht, ab welcher Stelle es laut wird - das ist auf
        Millisekunden genau.
        """
        roh = "/tmp/mupi-anlauf.raw"
        befehl = (f"timeout {grenze}s parec --device={senke}.monitor "
                  f"--format=s16le --rate=22050 --channels=1 --raw > {roh} 2>/dev/null")
        if os.geteuid() == 0 and shutil.which("runuser"):
            vor = ["runuser", "-u", TONBENUTZER, "--", "env",
                   f"XDG_RUNTIME_DIR={TONLAUFZEIT}", "bash", "-c", befehl]
        else:
            vor = ["bash", "-c", f"XDG_RUNTIME_DIR={TONLAUFZEIT} " + befehl]
        mit = subprocess.Popen(vor)
        time.sleep(0.4)          # der Mitschnitt soll VOR dem Befehl laufen
        beginn = time.monotonic()
        ruf(pfad)
        try:
            mit.wait(timeout=grenze + 8)
        except Exception:
            mit.kill()
        versatz = time.monotonic() - beginn - 0.4   # was vor dem Befehl lief

        try:
            d = open(roh, "rb").read()
        except Exception:
            return None
        if len(d) < 2000:
            return None
        w = array.array("h")
        w.frombytes(d[: len(d) // 2 * 2])
        # Erste Stelle ueber der Schwelle - in Bloecken, damit ein einzelner
        # Ausreisser nicht als Beginn zaehlt.
        block = 22050 // 20                     # 50 ms
        for i in range(0, len(w) - block, block):
            if max(abs(x) for x in w[i:i + block]) / 32768.0 > 0.005:
                return max(0.0, i / 22050.0 - 0.4)
        return None

    return {"pegel": pegel, "ruf": ruf, "jf": jf, "sp": sp, "senke": senke,
            "jfListe": jfListe, "spListe": spListe, "anlauf": anlauf}


def _umschaltLauf(bereich, folge, warten, messen, aufbau=None, hart=True):
    """Eine Folge von Wechseln abspielen und je den PEGEL messen.

    @param folge   Liste von ("Jellyfin"|"Spotify", …) - der NAME entscheidet,
                   welches Ziel gerufen wird.
    @param warten  Sekunden nach dem Start, bevor gemessen wird.
    @param messen  Sekunden Messdauer.
    @param hart    False = ein stummer Schritt ist eine WARNUNG statt eines
                   Fehlers. Fuer den Belastungstest: bei zwei Sekunden Pause
                   kann ein Dienst schlicht zu langsam sein, das ist ein
                   Hinweis und kein Beweis.
    """
    a = aufbau or _umschaltAufbau(bereich)
    if not a:
        return None
    pegel, ruf = a["pegel"], a["ruf"]
    listen = {"Jellyfin": a["jfListe"], "Spotify": a["spListe"]}
    zaehler = {"Jellyfin": 0, "Spotify": 0}

    def naechstes(name):
        """Jedes Mal ein ANDERES Ziel - derselbe Titel zweimal ist nicht der
        echte Fall (im Alltag springt ein Kind zu einem anderen Song)."""
        L = listen[name]
        z = L[zaehler[name] % len(L)]
        zaehler[name] += 1
        return z

    ruf("/player/current/stop")
    time.sleep(2)
    ruhe = pegel(messen)
    still = ruhe is None or ruhe < 0.005
    melde(bereich, "Ruhe vor dem Test", OK if still else WARN,
          "still" if still else f"Pegel {ruhe:.3f}",
          "" if still else "Es lief noch etwas - das Ergebnis ist unsicher.")

    stumm = []
    for i, name in enumerate(folge, 1):
        # KEIN stop zwischen gleichen Diensten: genau das ist der Fall, den
        # diese Folge pruefen soll - ein neuer Titel, waehrend derselbe Dienst
        # schon spielt. Ein stop davor wuerde die Frage wegdefinieren.
        gleich = i > 1 and folge[i - 2] == name
        if not gleich:
            ruf("/player/current/stop")
            time.sleep(1)
        ruf(naechstes(name))
        time.sleep(warten)
        p = pegel(messen)
        klingt = p is not None and p > 0.005
        if not klingt:
            stumm.append(f"{i}. {name}")
        melde(bereich, f"{i}. {name}" + (" (derselbe Dienst)" if gleich else ""),
              OK if klingt else (FEHLER if hart else WARN),
              f"Pegel {p:.3f}" if p is not None else "STILL",
              "" if klingt else "Nach dem Umschalten kommt KEIN Ton. Der vorige Dienst hat "
              "vermutlich nicht losgelassen oder der neue startet nicht.")

    ruf("/player/current/stop")
    time.sleep(3)
    ende = pegel(messen)
    aus = ende is None or ende < 0.005
    melde(bereich, "Stopp am Ende", OK if aus else FEHLER,
          "still" if aus else f"Pegel {ende:.3f}",
          "" if aus else "Nach /stop klingt es weiter - ein Dienst laesst nicht los.")

    melde(bereich, "Gesamturteil", OK if not stumm else (FEHLER if hart else WARN),
          f"{len(folge)} Wechsel ohne Aussetzer" if not stumm else f"stumm: {', '.join(stumm)}",
          "" if not stumm else ("Siehe Wiki dienste-umschalten." if hart else
          "Bei zwei Sekunden Pause kann ein Start auch schlicht zu langsam sein - "
          "erst mit `mupi-check umschalten` in Ruhe nachpruefen."))
    return a


def pruefeUmschalten():
    """Der normale Wechsel: Jellyfin <-> Spotify, in Ruhe.

    SPIELT KURZ AB (je ~10 s). Gehoert nicht in den Rundumlauf, sondern wird
    gezielt gerufen: mupi-check umschalten
    """
    _umschaltLauf("Umschalten", ["Jellyfin", "Spotify", "Jellyfin", "Spotify"], 9, 3)


def pruefeUmschaltFolge():
    """Zweimal DERSELBE Dienst hintereinander, dann quer.

    WOFUER: der normale Test wechselt immer die Tonmaschine. Ein neuer
    Spotify-Titel, WAEHREND Spotify schon spielt, ist ein anderer Fall - da
    wird nicht umgeschaltet, sondern innerhalb desselben Dienstes gesprungen.
    Genau dort kann ein Dienst haengenbleiben, ohne dass der Wechseltest es
    je sieht.

        mupi-check umschaltfolge
    """
    _umschaltLauf("Umschaltfolge", ["Spotify", "Spotify", "Jellyfin", "Spotify"], 9, 3)


def pruefeUmschaltStress():
    """Wie schnell kommt nach einem Wechsel Ton? Zehnmal hintereinander.

    WOFUER: ein Kind tippt schneller, als ein Dienst startet. Der ruhige Test
    wartet neun Sekunden und sieht das nie.

    WARUM GEMESSEN UND NICHT GEURTEILT WIRD: die erste Fassung wartete stur
    zwei Sekunden und meldete dann "still". Ergebnis: zehn von zehn stumm -
    was nicht hiess, dass das Umschalten kaputt ist, sondern dass zwei
    Sekunden fuer JEDEN Start zu kurz sind. Ein Test, der nur "ja/nein" sagen
    kann, sagt bei zu knapper Frist immer nein. Jetzt wird gewartet, BIS Ton
    kommt (hoechstens 12 s), und die DAUER ist das Ergebnis. Daraus laesst
    sich etwas ablesen; aus zehnmal "still" nicht.

        mupi-check umschaltstress
    """
    bereich = "Umschaltstress"
    a = _umschaltAufbau(bereich)
    if not a:
        return
    pegel, ruf = a["pegel"], a["ruf"]
    listen = {"Jellyfin": a["jfListe"], "Spotify": a["spListe"]}
    zaehler = {"Jellyfin": 0, "Spotify": 0}

    def naechstes(name):
        L = listen[name]
        z = L[zaehler[name] % len(L)]
        zaehler[name] += 1
        return z

    GRENZE = 12.0
    folge = ["Spotify", "Jellyfin", "Spotify", "Spotify", "Jellyfin",
             "Jellyfin", "Spotify", "Jellyfin", "Spotify", "Jellyfin"]

    ruf("/player/current/stop")
    time.sleep(2)

    zeiten, aufgeben = [], []
    for i, name in enumerate(folge, 1):
        gleich = i > 1 and folge[i - 2] == name
        if not gleich:
            ruf("/player/current/stop")
        # KEIN Warten hier - das ist ja der Belastungsfall.
        dauer = a["anlauf"](naechstes(name), GRENZE)
        marke = " (derselbe Dienst)" if gleich else ""
        if dauer is None:
            aufgeben.append(f"{i}. {name}")
            melde(bereich, f"{i}. {name}{marke}", WARN, f"kein Ton in {GRENZE:.0f} s",
                  "Bei sofortigem Weiterschalten kam nichts. Mit `mupi-check umschalten` "
                  "in Ruhe nachpruefen - bleibt es dort still, ist es ein echter Fehler.")
        elif gleich:
            # Beim Sprung INNERHALB desselben Dienstes wird vorher nicht
            # angehalten - der vorige Titel laeuft noch. "0,0 s" hiesse hier
            # also nicht "sofort gestartet", sondern "gar nicht abgerissen".
            # Genau das ist die Aussage, die man hier will.
            melde(bereich, f"{i}. {name}{marke}", OK,
                  "ohne Unterbrechung" if dauer < 0.3 else f"Luecke von {dauer:.1f} s")
            if dauer >= 0.3:
                zeiten.append(dauer)
        else:
            zeiten.append(dauer)
            melde(bereich, f"{i}. {name}{marke}", OK, f"Ton nach {dauer:.1f} s")

    ruf("/player/current/stop")
    time.sleep(3)
    ende = pegel(2)
    aus = ende is None or ende < 0.005
    melde(bereich, "Stopp am Ende", OK if aus else FEHLER,
          "still" if aus else f"Pegel {ende:.3f}",
          "" if aus else "Nach /stop klingt es weiter - ein Dienst laesst nicht los.")

    if zeiten:
        schnitt, schlimmst = sum(zeiten) / len(zeiten), max(zeiten)
        melde(bereich, "Anlaufzeit", OK if schlimmst < 8 else WARN,
              f"im Schnitt {schnitt:.1f} s, laengstens {schlimmst:.1f} s",
              "" if schlimmst < 8 else "Ueber acht Sekunden wirkt die Box auf ein Kind kaputt.")
    # NICHT len(zeiten) zaehlen: die Sprünge innerhalb desselben Dienstes
    # liefern keine Anlaufzeit (sie reissen ja nicht ab) und haetten das
    # Ergebnis als "8 von 10" erscheinen lassen - so, als waeren zwei
    # gescheitert.
    melde(bereich, "Gesamturteil", OK if not aufgeben else WARN,
          f"{len(folge) - len(aufgeben)} von {len(folge)} Wechseln mit Ton"
          if not aufgeben else f"ohne Ton: {', '.join(aufgeben)}",
          "" if not aufgeben else "Siehe oben - erst in Ruhe nachpruefen.")



def pruefeQuellenmix():
    """Startet eine Quelle die andere, ohne die erste zu beenden?

    WOFUER: am 2026-07-28 hoerte der Nutzer beide Dienste GLEICHZEITIG - "ohje
    wir mixen". Nachgestellt und bestaetigt: laeuft Spotify und wird danach ein
    Jellyfin-Titel gestartet, ohne vorher zu stoppen, bleiben BEIDE Stroeme
    offen (librespot und mpv zugleich an der Tonsenke). Die Box schaltet dann
    nicht um, sie mischt.

    Der Umschalttest sieht das NICHT: er misst nur, ob nach einem Wechsel Ton
    kommt - und Ton kommt ja, sogar doppelt. Deshalb diese eigene Pruefung, die
    nicht den Pegel zaehlt, sondern die STROEME.

    SPIELT KURZ AB (~12 s):  mupi-check quellenmix
    """
    bereich = "Quellenmix"
    a = _umschaltAufbau(bereich)
    if not a:
        return

    def stroeme():
        roh = alsBenutzer(["pactl", "list", "sink-inputs"], 8) or ""
        return [z.split("=", 1)[1].strip().strip('"')
                for z in roh.splitlines() if "application.name" in z]

    hole("/player/current/stop", 10)
    time.sleep(2)
    a["ruf"]("Spotify")
    time.sleep(7)
    vorher = stroeme()
    if not vorher:
        melde(bereich, "Aufbau", WARN, "keine Tonquelle nach dem Start",
              "Spotify lief nicht an - der Mix laesst sich so nicht pruefen")
        hole("/player/current/stop", 10)
        return

    # Jetzt die ANDERE Quelle starten, OHNE vorher zu stoppen.
    a["ruf"]("Jellyfin")
    nachher = []
    bis = time.monotonic() + 12
    while time.monotonic() < bis:
        nachher = stroeme()
        if len(nachher) > 1:
            break
        time.sleep(1)
    hole("/player/current/stop", 10)

    # WICHTIG: nur urteilen, wenn die zweite Quelle wirklich angelaufen ist.
    # Der erste Entwurf meldete "ok", weil NUR librespot zu sehen war - dabei
    # hiess das, dass Jellyfin gar nicht startete und weiter Spotify lief. Eine
    # falsche Entwarnung ist schlimmer als ein Fehlalarm: sie behauptet, ein
    # bekannter Fehler sei weg.
    if len(nachher) < 2 and not any("mpv" in q for q in nachher):
        melde(bereich, "Umschalten statt mischen", WARN,
              " + ".join(nachher) or "still",
              "Die zweite Quelle lief nicht an - damit ist NICHT geprueft, ob "
              "die Box mischt. Kein Freispruch.")
        return

    if len(nachher) > 1:
        melde(bereich, "Umschalten statt mischen", FEHLER,
              " + ".join(sorted(set(nachher))),
              "Beim Start der zweiten Quelle laeuft die erste weiter - man hoert "
              "beide zugleich. Die neue Quelle muss die alte beenden.")
    else:
        melde(bereich, "Umschalten statt mischen", OK,
              nachher[0] if nachher else "still")


def pruefeTonverzug():
    """Wie lange dauert es JE DIENST, bis man wirklich etwas hoert - und bis es still ist?

    WOFUER: der Messmodus zeigte am Geraet eine gewaltige Streuung - Ton nach
    1,6 bis 3,9 s beim Start, Stille nach 0,2 bis 2,6 s beim Stopp. Die
    Vermutung des Nutzers: das kommt von den verschiedenen Diensten. Spotify
    laeuft ueber librespot und die Cloud, Jellyfin lokal ueber mpv - dass die
    unterschiedlich lange brauchen, waere naheliegend, aber niemand hatte es
    gemessen.

    Diese Pruefung misst es: je Dienst mehrere Runden Start UND Stopp, in EINER
    durchgehenden Aufnahme je Runde (kurze Proben taugen nicht - parec puffert
    64 KB, siehe `pegel`). Verglichen werden die MEDIANE; ein einzelner Lauf
    beweist bei dieser Streuung gar nichts.

    SPIELT MEHRFACH KURZ AB (~90 s):  mupi-check tonverzug
    """
    import array  # wie in _umschaltAufbau: lokal, damit der Rundumlauf ihn nicht braucht

    bereich = "Tonverzug"
    a = _umschaltAufbau(bereich)
    if not a:
        return

    RUNDEN = 3
    RATE, BREITE = 22050, 2            # s16le mono -> 44100 Bytes je Sekunde
    SCHWELLE = 0.005

    def aufnehmen(sekunden, tuwas):
        """Durchgehend mitschneiden und dabei etwas tun; gibt die Pegelfolge zurueck."""
        roh = "/tmp/mupi-tonverzug.raw"
        befehl = (f"timeout {sekunden}s parec --device={a['senke']}.monitor "
                  f"--format=s16le --rate={RATE} --channels=1 --raw > {roh} 2>/dev/null")
        vor = (["runuser", "-u", TONBENUTZER, "--", "env", f"XDG_RUNTIME_DIR={TONLAUFZEIT}",
                "bash", "-c", befehl]
               if os.geteuid() == 0 and shutil.which("runuser") else ["bash", "-c", befehl])
        proz = subprocess.Popen(vor, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.2)                # parec braucht einen Moment, bis es liest
        beginn = time.monotonic()
        marken = tuwas(beginn)
        proz.wait()
        try:
            d = open(roh, "rb").read()
        except Exception:
            return None, marken
        w = array.array("h")
        w.frombytes(d[: len(d) // 2 * 2])
        block = RATE // 50             # 20-ms-Bloecke
        pegel = []
        for i in range(0, len(w) - block, block):
            pegel.append((i / RATE, max(abs(x) for x in w[i:i + block]) / 32768.0))
        return pegel, marken

    def ersterTon(pegel, ab):
        for t, p in pegel:
            if t >= ab and p > SCHWELLE:
                return t
        return None

    def ersteStille(pegel, ab, halten=0.4):
        seit = None
        for t, p in pegel:
            if t < ab:
                continue
            if p > SCHWELLE:
                seit = None
                continue
            if seit is None:
                seit = t
            elif t - seit >= halten:
                return seit            # der BEGINN der Stille, nicht ihre Bestaetigung
        return None

    ergebnis = {}
    for dienst in ("Jellyfin", "Spotify"):
        starts, stopps = [], []
        for _ in range(RUNDEN):
            def ablauf(beginn, dienst=dienst):
                tStart = time.monotonic() - beginn
                a["ruf"](dienst)
                time.sleep(9)
                tStop = time.monotonic() - beginn
                hole("/player/current/stop", 10)
                time.sleep(4)
                return tStart, tStop

            pegel, (tStart, tStop) = aufnehmen(16, ablauf)
            if not pegel:
                continue
            ton = ersterTon(pegel, tStart)
            still = ersteStille(pegel, tStop)
            if ton is not None:
                starts.append(round((ton - tStart) * 1000))
            if still is not None:
                stopps.append(round((still - tStop) * 1000))
            time.sleep(2)
        ergebnis[dienst] = (starts, stopps)

    def mitte(w):
        return sorted(w)[len(w) // 2] if w else None

    for dienst, (starts, stopps) in ergebnis.items():
        if not starts and not stopps:
            melde(bereich, dienst, WARN, "keine Messung",
                  "Der Dienst lief nicht an - Verzug nicht messbar")
            continue
        melde(bereich, f"{dienst}: bis Ton", OK if starts else WARN,
              f"{mitte(starts)} ms" if starts else "nicht gemessen",
              "" if starts else "Es kam kein Ton")
        melde(bereich, f"{dienst}: bis Stille", OK if stopps else WARN,
              f"{mitte(stopps)} ms" if stopps else "nicht gemessen",
              "" if stopps else "Es wurde nicht still")

    # DER EIGENTLICHE VERGLEICH - dafuer ist die Pruefung da.
    jf, sp = mitte(ergebnis.get("Jellyfin", ([], []))[0]), mitte(ergebnis.get("Spotify", ([], []))[0])
    if jf is not None and sp is not None:
        unterschied = abs(sp - jf)
        melde(bereich, "Unterschied der Dienste", INFO if unterschied < 500 else WARN,
              f"Spotify {sp} ms / Jellyfin {jf} ms",
              "" if unterschied < 500 else
              "Die Dienste brauchen unterschiedlich lange - das erklaert die Streuung "
              "der Messungen aus dem Messmodus.")


def pruefeFortschritt():
    """Springt die Fortschrittsleiste? Fuer JEDEN Dienst gemessen.

    WAS DIE OBERFLAECHE SIEHT: die Box fragt alle zwei Sekunden `/state` beim
    Wiedergabedienst ab (media.service.ts) und zeichnet daraus den Balken.
    Wer diesen Endpunkt mitschreibt, sieht also GENAU das, was das Kind sieht -
    ohne die Oberflaeche anfassen zu muessen.

    DER BEFUND, der diese Pruefung ausgeloest hat (2026-07-28, gemessen):
    nach dem Start eines Titels meldete `/state` noch rund FUENF SEKUNDEN den
    Stand des VORIGEN Stuecks (Position 105 s) und sprang dann auf die
    Wirklichkeit (1,7 s) - ein Ruecksprung von 103 Sekunden. Der Balken stand
    also erst weit hinten und schnellte dann an den Anfang.

    GEPRUEFT WIRD DREIERLEI, je Dienst:
      * Ruecksprung nach dem Start (der Fall oben)
      * gleichmaessiger Lauf waehrend der Wiedergabe
      * Stillstand, obwohl gespielt wird

    Spielt kurz ab. Gezielt aufrufen: mupi-check fortschritt
    """
    a = _umschaltAufbau("Fortschritt")
    if not a:
        return
    ruf = a["ruf"]

    def stand(dienst):
        """Der Stand, den die OBERFLAECHE sieht - je Dienst ein anderer Weg.

        Spotify liest `/state` (librespot ueber die Web-Schnittstelle),
        Jellyfin und lokale Dateien lesen `/local` (mpv). Wer nur `/state`
        abfragt, bekommt bei Jellyfin ein leeres Gehaeuse und haelt das
        faelschlich fuer "keine Meldungen" - genau so lief der erste Versuch.
        """
        weg = "/state" if dienst == "Spotify" else "/local"
        try:
            with urllib.request.urlopen("http://localhost:5005" + weg, timeout=4) as r:
                d = json.load(r)
        except Exception:
            return None
        if dienst == "Spotify":
            pos = d.get("progress_ms")
            if pos is None:
                return None
            return {"pos": int(pos),
                    "titel": ((d.get("item") or {}).get("name") or "")[:30],
                    "spielt": d.get("is_playing", True)}
        # mpv meldet die verstrichene Zeit in SEKUNDEN (progressTime).
        roh = d.get("progressTime")
        if roh in (None, ""):
            return None
        try:
            pos = int(float(roh) * 1000)
        except (TypeError, ValueError):
            return None
        return {"pos": pos,
                "titel": (d.get("currentTrackname") or d.get("album") or "")[:30],
                "spielt": bool(d.get("playing")) and not d.get("pause")}

    for dienst, ziel in (("Spotify", a["sp"]), ("Jellyfin", a["jf"])):
        ruf("/player/current/stop")
        time.sleep(2)
        beginn = time.monotonic()
        ruf(ziel)

        proben, vorher = [], None
        while time.monotonic() - beginn < 22:
            st = stand(dienst)
            if st:
                t = time.monotonic() - beginn
                proben.append((t, st["pos"], st["titel"], st["spielt"]))
            time.sleep(0.5)

        if len(proben) < 8:
            melde("Fortschritt", dienst, WARN, "zu wenige Meldungen",
                  "Der Wiedergabedienst antwortete kaum - ohne Meldungen ist nichts messbar.")
            continue

        rueck, steht, sprung = [], 0, []
        for i in range(1, len(proben)):
            (t0, p0, n0, _), (t1, p1, n1, spielt) = proben[i - 1], proben[i]
            if n0 != n1:
                continue                      # Titelwechsel: ein Sprung ist richtig
            dp, dw = p1 - p0, (t1 - t0) * 1000
            if dp < -300:
                rueck.append((t1, -dp / 1000.0))
            elif spielt and dp < dw * 0.3:
                steht += 1
            elif dp - dw > 1500:
                sprung.append((t1, (dp - dw) / 1000.0))

        if rueck:
            t, w = max(rueck, key=lambda x: x[1])
            melde("Fortschritt", f"{dienst}: Ruecksprung", FEHLER,
                  f"{w:.1f} s zurueck nach {t:.1f} s",
                  "Die Leiste zeigt nach dem Start den Stand des VORIGEN Stuecks und "
                  "schnellt dann an den Anfang. Ursache: /state liefert eine Weile den "
                  "zwischengespeicherten alten Stand.")
        else:
            melde("Fortschritt", f"{dienst}: Ruecksprung", OK, "keiner")

        if sprung:
            t, w = max(sprung, key=lambda x: x[1])
            melde("Fortschritt", f"{dienst}: Vorsprung", WARN, f"{w:.1f} s nach {t:.1f} s",
                  "Die Leiste springt vorwaerts - meist derselbe Zwischenspeicher.")
        # Stillstand ist nur ein Befund, wenn er nicht bloss der Anlauf war.
        if steht > 3:
            melde("Fortschritt", f"{dienst}: Stillstand", WARN, f"{steht} Meldungen ohne Fortschritt",
                  "Die Leiste bleibt stehen, obwohl gespielt wird.")
        else:
            melde("Fortschritt", f"{dienst}: Lauf", OK, f"{len(proben)} Meldungen, gleichmaessig")

    ruf("/player/current/stop")




def pruefeKioskAktuell():
    """Zeigt der Bildschirm ueberhaupt, was ausgeliefert wurde?

    DER FALL, der diese Pruefung ausgeloest hat (2026-07-28): einen ganzen Tag
    lang wurden Oberflaechen-Aenderungen ausgeliefert und mit "HTTP 200"
    fuer erfolgreich gehalten. Der Kiosk-Browser lief aber seit 09:23 durch und
    hatte seine Seite VOR allen Aenderungen geladen. Am Bildschirm war also den
    ganzen Tag der alte Stand zu sehen - und ein gemeldeter Fehler ("das kleine
    Coverbild fehlt") war laengst behoben, nur eben nicht sichtbar.

    "Die Datei liegt richtig" und "der Bildschirm zeigt sie" sind zwei
    verschiedene Aussagen. Diese Pruefung stellt die zweite.

    WARUM NUR EINE WARNUNG: ein Kiosk, der laenger laeuft als die letzte
    Auslieferung, ist normal, solange nichts Neues ausgeliefert wurde. Erst die
    KOMBINATION ist der Befund.
    """
    import datetime

    www = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"
    try:
        neuste = max(os.path.getmtime(os.path.join(www, f)) for f in os.listdir(www)
                     if f.endswith((".js", ".html", ".css")))
    except Exception as e:
        melde("Kiosk", "Ausgelieferter Stand", INFO, "nicht lesbar", str(e)[:60])
        return

    # BEIDE Browsernamen (E68/C2): seit E56 ist der Kiosk waehlbar. Mit
    # `chromium` allein meldete diese Diagnose auf einer Cog-Box
    # "Browser laeuft nicht" — eine Diagnose, die luegt, ist schlimmer als
    # keine. Geprueft mit tools/kiosk-browser-stellen.py.
    pids = lauf(["pgrep", "-f", "(^|/)(chromium[a-z-]*|cog)( |$)"]).split()
    if not pids:
        melde("Kiosk", "Browser", WARN, "laeuft nicht",
              "Ohne Kiosk zeigt der Bildschirm nichts. Startet normalerweise von selbst.")
        return

    # Der Elternprozess ist der aelteste - der haelt die Seite.
    aeltester = None
    for pid in pids:
        roh = lauf(["ps", "-o", "etimes=", "-p", pid]).strip()
        try:
            sek = int(roh)
        except ValueError:
            continue
        if aeltester is None or sek > aeltester:
            aeltester = sek
    if aeltester is None:
        melde("Kiosk", "Browser", INFO, "Laufzeit nicht lesbar")
        return

    gestartet = time.time() - aeltester
    stand = datetime.datetime.fromtimestamp(neuste).strftime("%H:%M")
    seit = "%dh%02dm" % (aeltester // 3600, (aeltester % 3600) // 60)

    # WAS HIER MESSBAR IST - und was nicht. Diese Pruefung kennt nur die
    # Laufzeit des BROWSERPROZESSES. Damit laesst sich "aktuell" BEWEISEN
    # (startete er nach der Auslieferung, kann er nur den neuen Stand haben),
    # "veraltet" aber NICHT: ein F5 laedt die Seite neu, ohne den Prozess
    # anzufassen, und von aussen ist das nicht zu sehen.
    #
    # Die erste Fassung behauptete trotzdem "nein - Seite ist aelter" und
    # meldete das auch noch, nachdem der Nutzer neu geladen hatte. Eine
    # Pruefung, die mehr behauptet als sie weiss, verliert genau dort ihren
    # Wert, wo man sich auf sie verlassen wollte.
    if gestartet >= neuste:
        melde("Kiosk", "Zeigt den ausgelieferten Stand", OK,
              "ja (Browser seit %s, juenger als die Auslieferung %s Uhr)" % (seit, stand))
    else:
        melde("Kiosk", "Zeigt den ausgelieferten Stand", INFO,
              "nicht beweisbar",
              "Der Browser laeuft seit %s, die letzte Auslieferung war %s Uhr. Ob "
              "seither neu geladen wurde, ist von aussen nicht erkennbar (ein F5 "
              "startet den Prozess nicht neu). Im Zweifel am Geraet F5 druecken - "
              "sonst zeigt der Bildschirm den alten Stand, waehrend die Dateien "
              "laengst richtig liegen." % (seit, stand))



def pruefeTitelangaben():
    """Stimmen Titelnummer, Titelname und Gesamtzahl?

    WOFUER: die Box zeigt "Titel 3 von 12". Beide Zahlen kommen aus dem
    Wiedergabedienst - und ob sie stimmen, sieht man ihnen nicht an. Hier wird
    gegen die WAHRHEIT geprueft: bei Jellyfin die Titelliste des Albums vom
    Server, bei Spotify die Angaben am Stueck selbst.

    GEMESSEN AM GERAET (2026-07-28), Album "HAMM" mit 12 Titeln, gestartet
    genau so, wie die Oberflaeche es tut (ersten Titel spielen, Rest anhaengen):
        Titelnummer  gemeldet 2   wahr 1
        Gesamtzahl   gemeldet 0   wahr 12
        Titelname    richtig
    Ursache der falschen Nummer: `currentTracknr` wird bei JEDEM
    metadata-Ereignis um eins erhoeht (spotify-control.ts) - gezaehlt werden
    also Ereignisse, nicht Titel, und mpv meldet fuer eine Datei mehrere.

    Spielt kurz ab. Gezielt aufrufen: mupi-check titelangaben
    """
    a = _umschaltAufbau("Titelangaben")
    if not a:
        return
    ruf = a["ruf"]

    # ── Jellyfin: die Wahrheit kommt vom Jellyfin-Server ──────────────────
    try:
        medien = json.load(urllib.request.urlopen("http://localhost:8200/api/data", timeout=15))
        alb = next(m for m in medien if str(m.get("type", "")).startswith("jellyfin"))
        server = re.match(r"(https?://[^/]+)", alb["cover"]).group(1)
        sch = urllib.parse.parse_qs(urllib.parse.urlparse(alb["cover"]).query)["api_key"][0]
        titel = json.load(urllib.request.urlopen(
            f"{server}/Items?ParentId={alb['id']}&IncludeItemTypes=Audio&Recursive=true&api_key={sch}",
            timeout=15))["Items"]
    except Exception as e:
        melde("Titelangaben", "Jellyfin-Album", INFO, "keins gefunden", str(e)[:60])
        return
    if not titel:
        melde("Titelangaben", "Jellyfin-Album", INFO, "ohne Titel")
        return

    q = lambda x: urllib.parse.quote(str(x), safe="")
    art = alb.get("artist", "")
    ruf("/player/current/stop")
    time.sleep(2)
    # GENAU wie die Oberflaeche: ersten Titel spielen, den Rest anhaengen.
    t0 = titel[0]
    ruf(f"/player/current/jellyfin/{q(server)}%2FAudio%2F{t0['Id']}%2Fstream"
        f"%3Fstatic%3Dtrue%26api_key%3D{sch}/{q(t0['Name'])}:title:artist:{q(art)}")
    time.sleep(7)
    for t in titel[1:]:
        ruf(f"/player/current/jfqueue/{q(t['Id'])}/{q(t['Name'])}:title:artist:{q(art)}")
    time.sleep(6)

    try:
        with urllib.request.urlopen("http://localhost:5005/local", timeout=6) as r:
            lo = json.load(r)
    except Exception as e:
        melde("Titelangaben", "Wiedergabedienst", WARN, "keine Antwort", str(e)[:60])
        ruf("/player/current/stop")
        return

    name = str(lo.get("currentTrackname") or "")
    melde("Titelangaben", "Titelname", OK if name == t0["Name"] else FEHLER,
          name[:40] or "(leer)",
          "" if name == t0["Name"] else f"Erwartet war {t0['Name'][:40]!r}.")

    nr = lo.get("currentTracknr")
    melde("Titelangaben", "Titelnummer", OK if str(nr) == "1" else FEHLER,
          f"{nr!r} statt 1" if str(nr) != "1" else "1",
          "" if str(nr) == "1" else
          "Die Nummer zaehlt metadata-EREIGNISSE statt Titel (spotify-control.ts: "
          "currentTracknr wird bei jedem Ereignis um eins erhoeht, und mpv meldet "
          "fuer eine Datei mehrere). Richtige Quelle waere mpvs playlist-pos.")

    gesamt = lo.get("totalTracks")
    passt = str(gesamt) == str(len(titel))
    melde("Titelangaben", "Gesamtzahl", OK if passt else FEHLER,
          f"{gesamt!r} statt {len(titel)}" if not passt else str(gesamt),
          "" if passt else
          "Wird auf dem Jellyfin-Weg nie gesetzt. Die Anzeige zeigt damit "
          "'Titel n von -'. Richtige Quelle waere mpvs playlist-count.")

    ruf("/player/current/stop")


def pruefeTonweg():
    """Kommt der Ton ueberhaupt bis zum Lautsprecher — und ueber welchen Funk?

    ZWEI ECHTE FAELLE, die genau hier haengenblieben (2026-07-28):

    1. STUNDENLANGE SUCHE NACH EINEM AUSGESCHALTETEN LAUTSPRECHER. Es kam kein
       Ton. PipeWire lieferte nachweislich lueckenlos, bluetoothctl meldete
       "Connected: yes", die A2DP-Uebertragung stand auf "active" und es
       flossen 48 kB/s ueber den Funk. Der Lautsprecher war schlicht AUS - das
       stand nur im Systemprotokoll ("nicht erreichbar (aus?)"). Deshalb wird
       hier der Zustand der UEBERTRAGUNG geprueft, nicht die Verbindung: die
       kann noch eine Weile "verbunden" melden, wenn niemand mehr zuhoert.
       Das ist eine WARNUNG, kein Fehler - abends ist der Lautsprecher aus, und
       eine Pruefung, die dann rot wird, verliert ihren Wert.

    2. AUSSETZER DURCH DEN FALSCHEN FUNKADAPTER. Der Ton lief ueber einen
       billigen CSR-Klon mit 310 Byte je Paket, waehrend ein ASUS USB-BT500 mit
       1021 Byte ungenutzt daneben steckte - dreimal so viele Pakete fuer
       dieselbe Musik. Es knackte hoerbar; nach dem Wechsel war es sauber
       (gemessen UND gehoert). Sichtbar war das nirgends, man musste es auf der
       Kommandozeile suchen. Jetzt faellt es hier auf.
    """
    ziel = ""
    for z in alsBenutzer(["pactl", "get-default-sink"]).splitlines():
        if z and not z.startswith("Failed"):
            ziel = z.strip()
    if not ziel:
        melde("Tonweg", "Ausgang", FEHLER, "keiner",
              "PipeWire meldet keinen Standardausgang - ohne den bleibt die Box stumm.")
        return
    melde("Tonweg", "Ausgang", OK, ziel)

    if not ziel.startswith("bluez_output"):
        return

    # Der Lautsprecher: nicht die Verbindung fragen, sondern die Uebertragung.
    # `lauf` nimmt eine LISTE (kein Shell) - eine Zeichenkette scheitert still
    # und liefert "__FEHLER__". Genau daran meldete diese Pruefung zuerst
    # "keine Uebertragung", obwohl der Lautsprecher lief.
    baum = lauf(["busctl", "tree", "org.bluez"], frist=10)
    pfad = ""
    for z in baum.splitlines():
        # busctl zeichnet einen Baum mit Linienzeichen davor - uns interessiert
        # nur der Pfad ab dem Schraegstrich.
        schnitt = z.find("/org/bluez")
        if schnitt < 0:
            continue
        t = z[schnitt:].strip()
        if "/fd" in t and "dev_" in t:
            pfad = t
            break
    if not pfad:
        melde("Tonweg", "Lautsprecher", WARN, "keine Uebertragung",
              "Der Lautsprecher ist aus oder ausser Reichweite. Am Geraet einschalten; "
              "die Box verbindet sich von selbst wieder (mupibox-bt-reconnect).")
    else:
        zustand = lauf(
            ["dbus-send", "--system", "--print-reply", "--dest=org.bluez", pfad,
             "org.freedesktop.DBus.Properties.GetAll", "string:org.bluez.MediaTransport1"],
            frist=10,
        )
        if '"active"' in zustand:
            melde("Tonweg", "Lautsprecher", OK, "Uebertragung aktiv")
        else:
            melde("Tonweg", "Lautsprecher", WARN, "Uebertragung nicht aktiv",
                  "Verbunden, aber es wird nichts uebertragen - meist ist der Lautsprecher "
                  "auf eine andere Quelle geschaltet oder gerade eingeschlafen.")

    # Welcher Funkadapter traegt den Ton, und steckt ein besserer daneben?
    roh = lauf(["hciconfig", "-a"], frist=10)
    adapter, jetzt = [], None
    for z in roh.splitlines():
        k = re.match(r"^(hci\d+):.*Bus:\s*(\S+)", z)
        if k:
            jetzt = {"name": k.group(1), "bus": k.group(2), "mtu": 0, "an": False}
            adapter.append(jetzt)
            continue
        if not jetzt:
            continue
        m = re.search(r"ACL MTU:\s*(\d+):", z)
        if m:
            jetzt["mtu"] = int(m.group(1))
        if re.search(r"\bUP\b", z):
            jetzt["an"] = True

    traeger = None
    for a in adapter:
        if "ACL" in lauf(["hcitool", "-i", a["name"], "con"], frist=6):
            traeger = a
    if not traeger:
        return

    melde("Tonweg", "Funkadapter", OK, "%s, %d Byte je Paket" % (traeger["name"], traeger["mtu"]))
    besser = [a for a in adapter
              if a["an"] and a is not traeger and a["mtu"] >= traeger["mtu"] * 2]
    if besser:
        b = besser[0]
        # NICHT die hci-Nummer als Rat ausgeben: die WANDERT beim Neustart (nach
        # einem Neustart am 2026-07-28 war aus hci2 hci1 geworden). Ein Rat, der
        # nach dem naechsten Booten auf den falschen Stecker zeigt, ist
        # schlimmer als keiner. Deshalb der Weg ueber die Verwaltung - die
        # merkt sich die ADRESSE und ueberlebt einen Neustart nachweislich.
        kennung = ""
        for z in lauf(["hciconfig", b["name"]]).splitlines():
            m = re.search(r"BD Address:\s*([0-9A-F:]{17})", z, re.I)
            if m:
                kennung = m.group(1)
        melde("Tonweg", "Besserer Adapter", WARN,
              "%s koennte %d statt %d Byte" % (kennung or b["name"], b["mtu"], traeger["mtu"]),
              "Kleine Pakete bedeuten mehr Funkverkehr fuer dieselbe Musik und sind die "
              "haeufigste Ursache fuer Aussetzer. Umstellen in der Verwaltung unter "
              "Bluetooth (merkt sich die Adresse, ueberlebt einen Neustart). "
              "Die hci-Nummern wandern beim Booten - deshalb steht hier die Adresse.")


def pruefeAnmeldung():
    """Die Spotify-Anmeldung — und die Falle, die zweimal in die Irre fuehrte.

    Die Anmeldung liegt im BROWSER und haengt an der HERKUNFT (Origin). Der
    Kiosk laeuft auf http://localhost:8200 und hat sie dort; wer die Box ueber
    ihre IP aufruft, hat sie NICHT — dann bleibt die Titelliste beim Flip auf
    Lade Titel…" stehen, obwohl der Dienst die Titel liefert. Das ist kein
    Fehler der Box, sondern ein Messfehler des Pruefenden.

    Von hier aus ist der Browser-Speicher nicht lesbar. Pruefbar ist, was
    serverseitig davon abhaengt — und das genuegt zur Unterscheidung.
    """
    st, roh, ms, _ = hole("/api/spotify/config", frist=15)
    d = jsonAus(roh) or {}
    # SEIT BACKLOG E15/S4 nennt der Weg nur noch `deviceName` und
    # `eingerichtet`. Vorher gab er `clientId` und `refreshToken` an jeden im
    # Netz heraus — genau das ist behoben. Die ALTEN Felder werden weiter
    # erkannt, damit dieses Werkzeug auch gegen eine Bestandsbox etwas sagt,
    # die den Umbau noch nicht hat.
    eingerichtet = bool(d.get("eingerichtet") or d.get("clientId") or d.get("client_id") or d.get("spotify"))
    melde(
        "Anmeldung",
        "Spotify-Konfiguration",
        OK if (st == 200 and eingerichtet) else FEHLER,
        "hinterlegt" if eingerichtet else f"HTTP {st}",
        ""
        if (st == 200 and eingerichtet)
        else "Ohne Konfiguration kann sich die Box gar nicht anmelden.",
    )
    st2, roh2, ms2, _ = hole("/player/state", frist=15)
    ger = (jsonAus(roh2) or {}).get("device") or {}
    angemeldet = bool(ger.get("name"))
    melde(
        "Anmeldung",
        "Wiedergabegeraet",
        OK if angemeldet else INFO,
        ger.get("name") or "keins aktiv",
        ""
        if angemeldet
        else "KEIN Fehler: /player/state zeigt nur die LAUFENDE Wiedergabe. Spielt gerade "
        "nichts, steht hier nichts. Ob das Geraet der Box angemeldet ist, sagt allein die "
        "Zeile Geraet bei Spotify unter spotifykette.",
    )
    melde(
        "Anmeldung",
        "Herkunft beachten",
        INFO,
        "Kiosk: http://localhost:8200",
        "Die Anmeldung gilt JE HERKUNFT. Ueber die IP geoeffnet fehlt sie — dann sieht "
        "eine gesunde Box krank aus. Zum Nachstellen immer localhost am Geraet nehmen.",
    )


def pruefeSpieler():
    st, roh, ms, _ = hole("/player/state", frist=15)
    d = jsonAus(roh) or {}
    ger = d.get("device") or {}
    melde(
        "Spieler",
        "Spotify-Geraet",
        OK if ger.get("name") else WARN,
        f"{ger.get('name','?')}, aktiv={ger.get('is_active')}",
        "" if ger.get("name") else "Gerade keine Wiedergabe. Ob librespot angemeldet ist, "
        "steht unter spotifykette.",
    )
    if d.get("is_playing"):
        melde("Spieler", "Wiedergabe", INFO, (d.get("item") or {}).get("name", "?"), "")
    return bool(d.get("is_playing"))


def pruefeTon(spotifySpielt=False):
    senken = alsBenutzer(["pactl", "list", "sinks", "short"])
    zeilen = [z for z in senken.split("\n") if z.strip()]
    bt = [z for z in zeilen if "bluez_output" in z]
    melde("Ton", "Senken", OK if zeilen else FEHLER, len(zeilen), "" if zeilen else "Kein Tonserver erreichbar.")
    if bt:
        melde("Ton", "Bluetooth-Senke", OK, bt[0].split("\t")[1], "")
    stand = alsBenutzer(["pactl", "info"])
    ziel = ""
    for z in stand.split("\n"):
        if "efault Sink" in z or "tandard-Ziel" in z:
            ziel = z.split(":", 1)[-1].strip()
    melde(
        "Ton",
        "Standardsenke",
        OK if ziel else WARN,
        ziel or "unbekannt",
        "" if "bluez" in ziel or ziel else "Faellt sie auf den eingebauten Ausgang zurueck, bleibt der Lautsprecher stumm.",
    )
    quellen = [z for z in alsBenutzer(["pactl", "list", "sink-inputs", "short"]).split("\n") if z.strip()]
    melde("Ton", "Tonquellen", INFO, len(quellen), "")

    # DIE Pruefung, die beim letzten Mal am laengsten gefehlt hat.
    kunden = alsBenutzer(["pactl", "list", "clients"])
    chrom = kunden.lower().count("chromium")
    if spotifySpielt:
        melde(
            "Ton",
            "Chromium am Tonserver",
            OK if chrom else FEHLER,
            chrom,
            ""
            if chrom
            else "Spotify meldet Wiedergabe, aber der Browser hat KEINE Tonverbindung. "
            "Genau dann: Jellyfin spielt (es nutzt mpv), Spotify bleibt stumm. "
            "Hilft nur ein Neustart des Kiosk-Browsers — also der Box.",
        )
    else:
        melde("Ton", "Chromium am Tonserver", INFO, chrom, "")


def pruefeBluetooth():
    roh = lauf(["hciconfig"])
    adapter = []
    jetzt = None
    for z in roh.split("\n"):
        k = re.match(r"^(hci\d+):.*Bus:\s*(\S+)", z)
        if k:
            jetzt = {"hci": k.group(1), "bus": k.group(2), "oben": False}
            adapter.append(jetzt)
        elif jetzt and re.search(r"\bUP\b", z):
            jetzt["oben"] = True
    melde(
        "Bluetooth",
        "Adapter",
        OK if adapter else WARN,
        ", ".join(f"{a['hci']}({a['bus']}{'/an' if a['oben'] else '/aus'})" for a in adapter) or "keiner",
        "" if adapter else "Kein Adapter — kein Bluetooth-Ton.",
    )
    # Die NUMMER sagt nichts: sie wandert beim Neuaufzaehlen. Nur der Bus.
    aktiv = [a for a in adapter if a["oben"]]
    ueberUsb = any(a["bus"].upper() == "USB" for a in aktiv)
    if aktiv:
        melde(
            "Bluetooth",
            "aktiver Weg",
            OK if ueberUsb else WARN,
            "USB-Dongle" if ueberUsb else "eingebaut (UART)",
            ""
            if ueberUsb
            else "Der eingebaute Baustein teilt sich das Funkmodul mit dem WLAN. "
            "Gemessen: rund 50 Funkfehler je Minute und hoerbares Stottern; mit USB-Dongle null.",
        )
    st, rohj, ms, _ = hole("/api/bluetooth", frist=25)
    d = jsonAus(rohj) or {}
    verbunden = [g for g in d.get("geraete", []) if g.get("verbunden")]
    melde(
        "Bluetooth",
        "verbunden",
        OK if verbunden else WARN,
        ", ".join(f"{g.get('name')} [{g.get('codec') or 'Codec unbekannt'}]" for g in verbunden) or "nichts",
        "" if verbunden else "Kein Geraet verbunden. Kopplungen gehoeren zum ADAPTER — nach einem Wechsel ist die Liste leer.",
    )
    # Funkfehler je Minute: der harte Beleg fuer Stottern.
    prot = lauf(["journalctl", "--since", "-3 min", "--no-pager"], 20)
    n = prot.count("Unexpected start frame")
    melde(
        "Bluetooth",
        "Funkfehler",
        OK if n < 10 else FEHLER,
        f"{n} in 3 min",
        "" if n < 10 else "Das ist der Koexistenz-Fehler: WLAN und Bluetooth auf einem Baustein. Auf den USB-Dongle umstellen.",
    )


def pruefeKiosk():
    # BEIDE Browsernamen (E68/C2) — siehe oben.
    laeuft = lauf(["pgrep", "-c", "-f", "(^|/)(chromium[a-z-]*|cog)( |$)"]).strip()
    zahl = int(laeuft) if laeuft.isdigit() else 0
    melde("Kiosk", "Chromium", OK if zahl else FEHLER, f"{zahl} Prozesse", "" if zahl else "Der Kiosk laeuft nicht — der Schirm bleibt leer.")
    # DIE Falle: /player ist Route UND Proxy. Ein Browser darf dort kein
    # JSON bekommen, sonst steht der weisse Pretty Print"-Schirm da.
    for pfad in ("/", "/player", "/medialist", "/bluetooth"):
        st, roh, ms, typ = hole(pfad, kopf={"Accept": "text/html,application/xhtml+xml", "Sec-Fetch-Mode": "navigate"})
        html = "text/html" in typ
        melde(
            "Kiosk",
            f"Seitenaufruf {pfad}",
            OK if (st == 200 and html) else FEHLER,
            f"{st} {typ.split(';')[0]}",
            "" if html else "Ein Browser bekommt hier KEIN HTML. Genau so entsteht der weisse JSON-Schirm.",
        )
    # Und die Gegenprobe: die Schnittstelle muss weiterhin JSON liefern.
    st, roh, ms, typ = hole("/player/state")
    melde(
        "Kiosk",
        "Schnittstelle /player/state",
        OK if "json" in typ else FEHLER,
        typ.split(";")[0] or "?",
        "" if "json" in typ else "Der Weg zum Abspieldienst ist unterbrochen.",
    )


def pruefeAuslieferung():
    basis = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
    for name, pfad in (("Oberflaeche", f"{basis}/www"), ("Verwaltung", f"{basis}/www-admin")):
        try:
            ziel = os.readlink(pfad) if os.path.islink(pfad) else "(kein Verweis)"
            da = os.path.isfile(os.path.join(pfad, "index.html"))
            melde(
                "Auslieferung",
                name,
                OK if da else FEHLER,
                ziel,
                "" if da else "index.html fehlt — die Seite kann nicht laden.",
            )
        except OSError as e:
            melde("Auslieferung", name, FEHLER, str(e), "Pfad nicht lesbar.")




def pruefeStandPasst():
    """Passen Oberflaeche und Backend zusammen — und tragen die Eintraege noch?

    GEBAUT nach dem 2026-07-29: die Flip-Liste blieb leer, und die Suche
    dauerte eine Stunde, weil DREI Ursachen uebereinanderlagen und keine
    bestehende Pruefung sie sah:

      1. Oberflaeche und server.js stammten aus VERSCHIEDENEN Staenden —
         die Oberflaeche rief /api/spotify/web/..., das Backend kannte den
         Weg nicht. Der Auffang-Handler antwortete mit der HTML-Seite bzw.
         404, alle Dienste waren "gruen".
      2. Eine Spotify-Playlist war BEIM ANBIETER geloescht (404 von
         api.spotify.com selbst) — sieht in der Netzwerkkonsole genauso aus.
      3. librespots Tonstrom stand gemerkt auf 20 % (PipeWire
         stream-restore) — "keine Verbindung" war in Wahrheit "fast stumm".

    Diese Pruefung trennt die drei in Sekunden:
      * Sie liest die /api-Wege aus den AUSGELIEFERTEN Oberflaechen-Buendeln
        (www/*.js) und fragt jeden beim Backend an. Antwortet ein /api-Weg
        mit text/html, existiert er dort NICHT — das ist die Signatur
        "Staende passen nicht zusammen".
      * Sie holt fuer jeden Spotify-Eintrag der Mediathek EINEN Titel ueber
        die Durchreiche (/api/spotify/web/...): 404 dort heisst "beim
        Anbieter geloescht", nicht "Box kaputt".
    """
    import glob as _glob

    www = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"

    # ── 1. Welche /api-Wege ruft die AUSGELIEFERTE Oberflaeche? ──────────
    wege = set()
    for f in _glob.glob(www + "/*.js"):
        try:
            text = open(f, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        # Nur literale Wege; Vorlagen-Teile (`${...}`) enden am Backtick.
        # Das Zeichen VOR /api/ darf kein Wort-/Punktzeichen sein: sonst
        # greift das Muster mitten in FREMDE Adressen wie
        # accounts.spotify.com/api/token — genau so entstand ein Fehlalarm
        # "Staende passen nicht", der keiner war.
        for m in re.finditer(r"(?<![a-zA-Z0-9.])/api/[a-zA-Z0-9_/-]{2,60}", text):
            wege.add(m.group(0))
    # Nur LESEND anfragen: alles, was nach Aktion riecht, wird nicht
    # angefasst — eine Pruefung darf die Box nicht bedienen.
    tabu = re.compile(r"neuladen|reboot|shutdown|stop|play|pause|save|delete|loesch|write|set|toggle|vorlesen|daempfen|resume|update", re.I)
    kandidaten = sorted(w for w in wege if not tabu.search(w))
    if not kandidaten:
        melde("standpasst", "Oberflaechen-Buendel", WARN, "keine /api-Wege gefunden",
              "www/*.js nicht lesbar oder Aufbau geaendert — Pruefung laeuft ins Leere.")
        return
    melde("standpasst", "Wege in der Oberflaeche", INFO, f"{len(kandidaten)} lesend von {len(wege)}")

    fremd = []
    for w in kandidaten:
        code, roh, dauer, typ = hole(w, frist=10)
        # DIE Signatur: ein /api-Weg, der die HTML-Seite zurueckbekommt,
        # existiert im Backend nicht — der SPA-Auffang hat geantwortet.
        if "text/html" in (typ or "") or roh[:9] == b"<!DOCTYPE":
            fremd.append(w)
    if fremd:
        melde("standpasst", "Staende passen NICHT", FEHLER,
              f"{len(fremd)} Weg(e) unbekannt: " + ", ".join(fremd[:4]),
              "Die Oberflaeche ruft Wege, die dieses server.js nicht kennt - "
              "Frontend und Backend stammen aus verschiedenen Staenden. "
              "IMMER BEIDE zusammen ausliefern (ein deploy.zip = ein Stand).")
    else:
        melde("standpasst", "Staende passen", OK, f"{len(kandidaten)} Wege bekannt")

    # ── 2. Traegt jeder Spotify-Eintrag noch? (Anbieter-Seite) ───────────
    try:
        roh = open("/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json",
                   encoding="utf-8").read()
        daten = json.loads(roh)
        eintraege = daten if isinstance(daten, list) else daten.get("data", [])
    except Exception as e:
        melde("standpasst", "Mediathek", WARN, f"nicht lesbar: {e}")
        return
    for e in eintraege:
        if not str(e.get("type", "")).startswith("spotify"):
            continue
        name = (e.get("title") or e.get("artist") or "?")[:34]
        pid, aid = e.get("playlistid"), e.get("id")
        if pid:
            weg = f"/api/spotify/web/playlists/{pid}/tracks?limit=1&offset=0"
        elif aid:
            weg = f"/api/spotify/web/albums/{aid}/tracks?limit=1&offset=0"
        else:
            continue  # meldet schon der Bereich "spotify"
        code, roh2, dauer, typ = hole(weg, frist=15)
        if code == 200:
            melde("standpasst", name, OK, f"{'playlist' if pid else 'album'} traegt in {dauer:.0f} ms")
        elif code == 404 and b"Resource not found" in roh2:
            melde("standpasst", name, FEHLER, "BEIM ANBIETER geloescht (404 von Spotify)",
                  "Die Kennung existiert bei Spotify nicht mehr. Eintrag in der "
                  "Verwaltung neu verknuepfen oder entfernen - die Box kann daran nichts heilen.")
        elif "text/html" in (typ or ""):
            melde("standpasst", name, FEHLER, "Durchreiche fehlt (HTML statt JSON)",
                  "Siehe oben: Staende passen nicht zusammen.")
        else:
            melde("standpasst", name, WARN, f"HTTP {code}",
                  "Weder ok noch die bekannten Faelle - Netz/Token pruefen (spotifykette).")




def pruefeAkku():
    """Was sagt der MuPiHAT ueber Strom und Akku?

    GEBAUT am 2026-07-29, als die Box zum ersten Mal am Akku lief: die
    Werte waren NICHT da. `mupi_hat.service` stand auf failed, weil
    `mupihat_bq25792.py` das Modul `smbus2` importiert und das auf keiner
    Box installiert war - der Ladebaustein BQ25792 antwortete auf I2C 0x6b
    einwandfrei, nur las ihn niemand aus. Ohne diese Pruefung faellt so
    etwas erst auf, wenn die Box unterwegs ausgeht.

    Die Zahlen im Klartext:
      Vbat  Akkuspannung in mV. 2S Li-Ion: ~8400 voll, ~7400 halb, ~6000 leer.
      Ibat  Akkustrom in mA. NEGATIV = die Box zieht (entlaedt),
            POSITIV = der Akku wird geladen.
      Vbus  Eingangsspannung in mV (USB-C). ~5000 = Netzteil dran, 0 = Akku.
      SOC   Ladestand, wie der Baustein ihn schaetzt.
    """
    hat = "/tmp/mupihat.json"

    # Ist ueberhaupt ein HAT da? Ohne Ladebaustein ist alles Weitere
    # gegenstandslos - eine stationaere Box ohne Akku ist kein Fehler.
    # LISTENFORM, keine Shell: `lauf` reicht die Liste direkt an das
    # Programm weiter. Ein Shell-Einzeiler als STRING scheitert mit
    # "No such file or directory" - und weil die Fehlermeldung den ganzen
    # Befehl enthaelt, war ein `"da" in ergebnis` daran WAHR (das `echo da`
    # stand ja drin). Die Pruefung meldete "Chip antwortet", ohne je einen
    # Chip gesehen zu haben. Deshalb hier auf die Ausgabezeile pruefen.
    chip = lauf(["i2cdetect", "-y", "1"])
    if "__FEHLER__" in chip:
        melde("akku", "Ladebaustein BQ25792", WARN, "i2cdetect nicht ausfuehrbar",
              "Paket i2c-tools fehlt oder I2C ist nicht freigeschaltet.")
        return
    zeile = [z for z in chip.splitlines() if z.startswith("60:")]
    if not (zeile and " 6b " in zeile[0]):
        melde("akku", "Ladebaustein BQ25792", INFO, "nicht auf I2C 0x6b",
              "Keine Akku-Platine erkannt - bei einer Box am Netzteil in Ordnung.")
        return
    melde("akku", "Ladebaustein BQ25792", OK, "antwortet auf I2C 0x6b")

    # Der Leser-Dienst. Genau hier stand der Fehler, den diese Pruefung sucht.
    stand = lauf(["systemctl", "is-active", "mupi_hat"]).strip()
    if stand != "active":
        fehlt = "JA" if "__FEHLER__" in lauf(["python3", "-c", "import smbus2"]) or "ModuleNotFound" in lauf(["python3", "-c", "import smbus2"]) else "nein"
        melde("akku", "Dienst mupi_hat", FEHLER, stand,
              "Ohne ihn gibt es keine Akkuwerte, obwohl die Platine da ist. "
              + ("Modul smbus2 FEHLT -> 'apt-get install -y python3-smbus2'. "
                 if fehlt == "JA" else "")
              + "Danach: systemctl reset-failed mupi_hat && systemctl restart mupi_hat")
    else:
        melde("akku", "Dienst mupi_hat", OK, "active")

    stand2 = lauf(["systemctl", "is-active", "mupi_hat_control"]).strip()
    melde("akku", "Dienst mupi_hat_control", OK if stand2 == "active" else WARN, stand2,
          "" if stand2 == "active" else
          "Er warnt und faehrt bei leerem Akku herunter. Bekannter Fehler der "
          "mitgelieferten Unit: ExecStop nutzt $(cat ...), das kann systemd "
          "nicht - Rezeptschritt 'mupihat-stopp-reparieren'.")

    # ZUERST die API fragen, nicht die Rohdatei: nur dort steht der FEINE
    # Ladestand (die Box interpoliert ihn aus der Entladekurve, akkustand.ts).
    # Die Datei ist der Rueckfall, wenn der Server nicht laeuft.
    d = None
    code, roh, _, _ = hole("/api/mupihat", frist=6)
    if code == 200:
        try:
            d = json.loads(roh)
        except Exception:
            d = None
    try:
        if not (isinstance(d, dict) and "Vbat" in d):
            with open(hat, encoding="utf-8") as f:
                d = json.load(f)
        if not isinstance(d, dict) or "Vbat" not in d:
            raise ValueError("leer")
    except Exception:
        melde("akku", "Messwerte", FEHLER, f"{hat} leer oder unlesbar",
              "Der Leser-Dienst schreibt nichts - siehe Dienst mupi_hat oben.")
        return

    vbat, ibat, vbus = int(d.get("Vbat", 0)), int(d.get("Ibat", 0)), int(d.get("Vbus", 0))
    # Der FEINE Wert kommt von der Box (/api/mupihat, akkustand.ts): der
    # Treiber selbst kennt nur fuenf Stufen.
    fein = d.get("Bat_SOC_fein")
    stand = f"{fein} % (fein)" if isinstance(fein, (int, float)) else f"{d.get('Bat_SOC','?')} (grobe Stufe)"
    melde("akku", "Ladestand", INFO, f"{stand}  bei {vbat/1000:.2f} V")
    # Das Eingangslimit sagt, OB ein PD-Vertrag zustande kam: 500 mA ist der
    # Rueckfallwert fuer einen einfachen USB-Anschluss. Die Hardware der
    # Platine ist laut Datenblatt (S. 15) auf 2,2 A begrenzt - "in order to
    # operate the HAT safely without additional heat sink". Mehr einzustellen
    # ist ausdruecklich "without guarantee".
    limit = d.get("Input_Current_Limit")
    if isinstance(limit, (int, float)):
        melde("akku", "Eingangsstrom-Limit",
              WARN if limit <= 500 else OK if limit <= 2200 else WARN,
              f"{int(limit)} mA",
              "Nur 500 mA: es kam kein USB-PD-Vertrag zustande, die Quelle gilt als "
              "einfacher USB-Anschluss. Der Pi 5 allein zieht mehr."
              if limit <= 500 else
              "" if limit <= 2200 else
              "Ueber der Hardware-Grenze von 2,2 A, die das Datenblatt fuer den "
              "Betrieb OHNE Kuehlkoerper nennt.")

    melde("akku", "Akkuprofil", OK if d.get("Bat_Type") not in (None, "", "Default") else WARN,
          d.get("Bat_Type", "?"),
          "" if d.get("Bat_Type") not in (None, "", "Default") else
          "Kein passendes Profil eingestellt - der Treiber nimmt seine eingebauten "
          "Schwellen. Der Name in mupiboxconfig.json muss einem Eintrag aus "
          "battery_types entsprechen (am Geraet stand 'USB-C mode' gegen "
          "'USB-C mode (no battery)' - ein stiller Fehlschlag).")
    melde("akku", "Zustand", OK if d.get("Bat_Stat") == "OK" else WARN,
          f"{d.get('Bat_Stat','?')} - {d.get('Charger_Status','?')} - {d.get('Temp','?')} Grad")

    # Am Netz oder am Akku? Vbus schwankt beim Abziehen noch ein paar
    # Sekunden nach (am Geraet gesehen: 5045 -> 640 -> 37 -> 0), deshalb ist
    # der Akkustrom das ehrlichere Merkmal.
    if ibat < -20:
        watt = abs(ibat) * vbat / 1_000_000
        melde("akku", "Betrieb", INFO, f"AKKU - Box zieht {abs(ibat)} mA = {watt:.1f} W")
        # Restlaufzeit nur GROB und nur als Hinweis: die Kapazitaet der
        # verbauten Zellen kennt die Box nicht, und der Ladestand des
        # Bausteins ist eine Schaetzung. Lieber eine ehrliche Spanne als
        # eine erfundene Genauigkeit.
        # Die Kapazitaet steht nirgends als Zahl in der Konfiguration - wohl
        # aber im NAMEN des Akkuprofils ("ENERpower 2S2P 10.000mAh"). Den zu
        # lesen ist ein Behelf, aber ein ehrlicher: gelingt er nicht, wird die
        # Spanne gezeigt statt einer erfundenen Zahl.
        soc = fein if isinstance(fein, (int, float)) else None
        if soc is None:
            try:
                soc = int(str(d.get("Bat_SOC", "")).rstrip("%"))
            except ValueError:
                soc = None
        mAh = None
        m = re.search(r"([\d.,]+)\s*mah", str(d.get("Bat_Type", "")), re.I)
        if m:
            try:
                mAh = int(float(m.group(1).replace(".", "").replace(",", ".")))
            except ValueError:
                mAh = None
        if soc is not None and mAh:
            melde("akku", f"Restzeit ({mAh} mAh laut Profil)", INFO,
                  f"~{mAh * soc / 100 / abs(ibat):.1f} h",
                  "")
        elif soc is not None:
            for mah, wie in ((2500, "2500 mAh"), (3500, "3500 mAh")):
                melde("akku", f"Restzeit bei {wie}", INFO,
                      f"~{mah * soc / 100 / abs(ibat):.1f} h", "")
    elif ibat > 20:
        melde("akku", "Betrieb", INFO, f"LAEDT mit {ibat} mA (Eingang {vbus/1000:.2f} V)")
    else:
        melde("akku", "Betrieb", INFO,
              f"Netz, Akku voll oder Ruhe (Ibat {ibat} mA, Vbus {vbus/1000:.2f} V)")

    # ── Netzteil: wird es anerkannt, oder taktet der Eingang? ───────────
    #
    # AM GERAET GESEHEN (2026-07-29): USB steckte, die Versorgungs-LED
    # BLINKTE, geladen wurde trotzdem nicht. Der Grund steht in den
    # Statusregistern des BQ25792, nicht in der JSON-Datei: das Netzteil war
    # als "nicht anerkannt" eingestuft, die D+/D--Erkennung lief endlos neu,
    # und VBUS brach im Takt von 5,0 V auf 1,4 V zusammen. Das Blinken IST
    # dieser Takt.
    #
    # EINMAL LESEN GENUEGT NICHT: der Zustand WECHSELT zwischen "nicht
    # anerkannt" (0x8) und "kein Eingang" (0x0). Wer einmal liest, erwischt
    # mal das eine, mal das andere - und haelt es fuer den Dauerzustand.
    QUELLEN = {
        0x0: "kein Eingang",
        0x1: "USB-Anschluss (SDP, 500 mA)",
        0x2: "USB-Ladeanschluss (CDP, 1,5 A)",
        0x3: "Ladegeraet (DCP, 3,25 A)",
        0x5: "unbekanntes Netzteil (3 A)",
        0x6: "Netzteil ohne Norm",
        0x7: "gibt selbst Strom ab (OTG)",
        0x8: "NICHT ANERKANNT",
        0xB: "Box laeuft direkt am Eingang",
    }
    zustaende, spannungen = [], []
    for _ in range(8):
        reg = lauf(["i2cget", "-y", "1", "0x6b", "0x1c"]).strip()
        if reg.startswith("0x"):
            try:
                zustaende.append((int(reg, 16) >> 1) & 0x0F)
            except ValueError:
                pass
        try:
            with open(hat, encoding="utf-8") as f:
                spannungen.append(int(json.load(f).get("Vbus", 0)))
        except Exception:
            pass
        time.sleep(1.5)

    verschieden = sorted(set(zustaende))
    # "Steckt ein Netzteil?" darf NICHT an einer hohen Spannung haengen:
    # genau waehrend des Einbruchs liegt VBUS bei 1,4 V, und dann schwieg
    # die Pruefung ueber den Fehler, den sie finden soll. Es genuegt, dass
    # IRGENDWANN in der Messreihe Spannung anlag oder der Laderegler eine
    # Quelle gesehen hat.
    hatStrom = bool(spannungen and max(spannungen) > 2500) or any(z != 0 for z in zustaende)
    if len(verschieden) > 1 and hatStrom:
        melde("akku", "Netzteil wird verworfen", FEHLER,
              " / ".join(QUELLEN.get(z, hex(z)) for z in verschieden),
              "Der Laderegler erkennt die Quelle, verwirft sie und faengt von vorn "
              "an - IMMER WIEDER. Genau dieser Takt ist das Blinken, und geladen "
              "wird dabei nie. Das Datenblatt (Ver. 2.4, S. 21) verlangt "
              "ausdruecklich ein USB-PD-3.0-Netzteil mit 20 W; die LED CAP_MIS "
              "blinkt laut Tabelle S. 12 bei 'Capability Mismatch USB PD', PLUG "
              "kurz bei jedem Steckereignis. Ein Eingangslimit von 500 mA heisst: "
              "es kam GAR KEIN PD-Vertrag zustande, die Quelle gilt als einfacher "
              "USB-Anschluss. Abhilfe: 20-W-USB-C-PD-Netzteil und ein kurzes, "
              "stromfestes Kabel.")
    elif verschieden and hatStrom:
        z = verschieden[0]
        melde("akku", "Netzteil", WARN if z in (0x0, 0x1, 0x8) else OK,
              QUELLEN.get(z, hex(z)),
              "" if z not in (0x0, 0x1, 0x8) else
              "Der Laderegler haelt die Quelle fuer zu schwach. Ein USB-C-PD-Netzteil "
              "und ein kurzes, stromfestes Kabel beheben das.")

    # Ein GESUNDER Eingang haelt seine Spannung auf rund 200 mV genau. Eine
    # feste Schwelle bei 3000 mV war zu nachsichtig: am Geraet schwankte es
    # 3576..4945 mV - fast anderthalb Volt - und die Pruefung meldete
    # "stabil". Ein Einbruch von mehr als einem halben Volt ist keiner mehr.
    if spannungen and hatStrom:
        if min(spannungen) < max(spannungen) - 500:
            melde("akku", "Eingang bricht ein", FEHLER,
                  f"VBUS {min(spannungen)}..{max(spannungen)} mV",
                  "Der Eingang bricht zusammen und kommt wieder - dasselbe Bild wie oben.")
        else:
            melde("akku", "Eingang stabil", OK, f"VBUS {min(spannungen)}..{max(spannungen)} mV")

    # Die Box reicht die Werte an die Oberflaeche durch (Akkusymbol).
    code, roh, dauer, _ = hole("/api/mupihat", frist=6)
    melde("akku", "Weg zur Oberflaeche", OK if code == 200 else WARN,
          f"/api/mupihat HTTP {code} in {dauer:.0f} ms",
          "" if code == 200 else "Ohne ihn zeigt die Box kein Akkusymbol.")


def pruefeKnopflicht():
    """Leuchtet der Einschaltknopf das, was eingestellt ist - und schaltet die
    Taste noch ab?

    GEBAUT am 2026-08-06, nachdem in dieser Kette DREI Fehler nebeneinander
    lagen, von denen keiner sichtbar war:

      1. led_control.py verglich `led_dim_mode` gegen eine ZEICHENKETTE,
         geschrieben wurde eine ZAHL. `0 == "0"` ist in Python falsch - das
         Dimmen beim Bildschirm-Aus hat es nie gegeben, die Schleife lief
         jede Sekunde und tat nichts.
      2. mupi_start_led.sh las die Konfiguration jede Sekunde und WARF SIE
         WEG; nur `led_dim_mode` kam in die Datei. Eine geaenderte Helligkeit
         wirkte erst nach einem Neustart.
      3. Und dieselbe Datei schrieb `led_dim_mode` VERKEHRT HERUM: Bildschirm
         an = dimmen. Die WLED-Zeilen direkt daneben machen es richtig.

    DIE HALTEDAUER dazu: mupi.php bot 0,25-Schritte an. off_trigger.sh zaehlt
    damit `for ((i=0; i<2.25; i++))` - bash bricht das ab, BEVOR einmal
    geprueft wird, ob die Taste noch gedrueckt ist, und `button_held` steht da
    schon auf true. Die Box faehrt beim Antippen herunter und meldet dazu
    "Button held for 2.25 seconds".

    Und ueber allem die Hardware: laut MuPiHAT-Datenblatt schaltet derselbe
    Taster (J1) ab 6 Sekunden HART ab. Eine laengere Haltedauer kommt nie zum
    Zug - der HAT nimmt vorher den Strom weg, mitten im Schreiben.
    """
    bereich = "Knopflicht"
    stand_datei = "/tmp/.power_led"

    konf = {}
    try:
        with open("/etc/mupibox/mupiboxconfig.json", encoding="utf-8") as f:
            konf = json.load(f)
    except Exception as e:
        melde(bereich, "Konfiguration lesbar", FEHLER, str(e),
              "Ohne sie ist hier nichts zu pruefen.")
        return

    shim = konf.get("shim") or {}
    zeit = konf.get("timeout") or {}

    # Fehlender Schluessel heisst AN - so werten es auch mupi_start_led.sh
    # (led_an) und led_control.py (ist_an). Ein dunkler Knopf nach dem Update
    # saehe sonst nach einem Defekt aus.
    roh_an = shim.get("ledEnabled", True)
    soll_an = roh_an if isinstance(roh_an, bool) else str(roh_an).strip().lower() not in ("0", "false", "off", "no", "")
    melde(bereich, "Licht eingestellt auf",
          INFO if "ledEnabled" in shim else WARN,
          ("an" if soll_an else "aus") + ("" if "ledEnabled" in shim else " (Schluessel fehlt)"),
          "update/conf_update.sh legt shim.ledEnabled an; bis dahin gilt AN.")

    def ganz(x, ersatz):
        try:
            return int(str(x).strip())
        except (TypeError, ValueError):
            return ersatz

    hell = ganz(shim.get("ledBrightnessMax", 100), 100)
    dunkel = ganz(shim.get("ledBrightnessMin", 10), 10)
    melde(bereich, "Helligkeit hell/gedimmt",
          WARN if dunkel > hell else OK, f"{hell}% / {dunkel}%",
          "Gedimmt heller als normal heisst: der Knopf wird heller, sobald der Bildschirm ausgeht.")

    # ── Die Haltedauer ────────────────────────────────────────────────────
    roh_dauer = str(zeit.get("pressDelay", ""))
    if "." in roh_dauer:
        melde(bereich, "Haltedauer der Taste", FEHLER, roh_dauer + " s",
              "Bruchzahl aus dem alten PHP-Schieber: die Zaehlschleife in "
              "off_trigger.sh bricht ab und die Box faehrt beim ANTIPPEN "
              "herunter. Ganze Sekunde eintragen (Verwaltung -> Die Box selbst).")
    elif ganz(roh_dauer, -1) < 0:
        melde(bereich, "Haltedauer der Taste", WARN, roh_dauer or "fehlt",
              "off_trigger.sh nimmt dann seinen Ersatzwert von 3 Sekunden.")
    elif ganz(roh_dauer, 0) > 5:
        melde(bereich, "Haltedauer der Taste", FEHLER, roh_dauer + " s",
              "Der MuPiHAT schaltet ab 6 s hart ab - dieses Herunterfahren "
              "kommt nie zum Zug. Hoechstens 5 s.")
    else:
        melde(bereich, "Haltedauer der Taste", OK, roh_dauer + " s")

    # ── Der Dienst und die Datei dazwischen ───────────────────────────────
    lauft = "active" in lauf(["systemctl", "is-active", "mupi_powerled.service"], 6)
    melde(bereich, "mupi_powerled.service", OK if lauft else WARN,
          "laeuft" if lauft else "laeuft nicht",
          "Ohne ihn steht kein PWM am Knopf - das Licht bleibt, wie es beim Start war.")

    if not os.path.exists(stand_datei):
        melde(bereich, stand_datei, WARN if not lauft else FEHLER, "fehlt",
              "mupi_start_led.sh schreibt sie; ohne sie weiss led_control.py nichts.")
        return

    try:
        with open(stand_datei, encoding="utf-8") as f:
            stand = json.load(f)
    except Exception as e:
        melde(bereich, stand_datei, FEHLER, str(e), "Datei unlesbar oder halb geschrieben.")
        return

    # DER SCHLUESSEL, an dem alles haengt: fehlt `led_enabled` in der Datei,
    # laeuft noch die Fassung vor 4.3.1 - der Schalter in der Verwaltung
    # bleibt dann folgenlos, ohne dass irgendetwas meckert.
    if "led_enabled" not in stand:
        melde(bereich, "Stand kennt den Schalter", FEHLER, "led_enabled fehlt",
              "Alte mupi_start_led.sh: der Schalter in der Verwaltung wirkt nicht. "
              "Skripte neu ausliefern.")
    else:
        ist_an = str(stand.get("led_enabled")).strip().lower() not in ("0", "false", "none")
        melde(bereich, "Stand und Konfiguration einig",
              OK if ist_an == soll_an else FEHLER,
              f"Datei: {'an' if ist_an else 'aus'}, Konfiguration: {'an' if soll_an else 'aus'}",
              "mupi_start_led.sh reicht Aenderungen im Sekundentakt weiter - "
              "stehen sie laenger auseinander, laeuft die Schleife nicht.")

    d_hell = ganz(stand.get("led_max_brightness"), -1)
    melde(bereich, "Helligkeit durchgereicht",
          OK if d_hell == hell else WARN, f"Datei: {d_hell}%, Konfiguration: {hell}%",
          "Bis 4.3.1 las die Schleife die Konfiguration und warf sie weg.")

    # led_dim_mode: 0 = hell, 1 = gedimmt. Beide Leser (Python und C) lesen es
    # als ZAHL - steht dort eine Zeichenkette, ist es die alte Fassung.
    dim = stand.get("led_dim_mode")
    melde(bereich, "led_dim_mode als Zahl",
          OK if isinstance(dim, (int, float)) and not isinstance(dim, bool) else FEHLER,
          repr(dim),
          "Als Zeichenkette geschrieben greift der Vergleich in led_control.py nicht.")


BEREICHE = {
    "knopflicht": pruefeKnopflicht,
    "dienste": pruefeDienste,
    "akku": pruefeAkku,
    "standpasst": pruefeStandPasst,
    "anmeldung": pruefeAnmeldung,
    "musikdienste": pruefeMusikdienste,
    "spotifykette": pruefeSpotifyTief,
    "auslieferpfade": pruefeAuslieferungPfade,
    "kinderzeit": pruefeKinderzeit,
    "umschalten": pruefeUmschalten,
    "umschaltfolge": pruefeUmschaltFolge,
    "umschaltstress": pruefeUmschaltStress,
    "quellenmix": pruefeQuellenmix,
    "tonverzug": pruefeTonverzug,
    "fortschritt": pruefeFortschritt,
    "titelangaben": pruefeTitelangaben,
    "kioskkonsole": pruefeKioskKonsole,
    "browserton": pruefeBrowserTon,
    "tonweg": pruefeTonweg,
    "kioskaktuell": pruefeKioskAktuell,
    "spotifyrechte": pruefeSpotifyRechte,
    "netz": pruefeNetz,
    "schnittstellen": pruefeSchnittstellen,
    "medien": pruefeMedien,
    "spotify": pruefeSpotify,
    "bluetooth": pruefeBluetooth,
    "kiosk": pruefeKiosk,
    "auslieferung": pruefeAuslieferung,
}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    alsJson = "--json" in sys.argv
    gewuenscht = args or list(BEREICHE)

    spielt = False
    for name in gewuenscht:
        if name == "ton":
            continue
        fn = BEREICHE.get(name)
        if not fn:
            print(f"Unbekannter Bereich: {name}. Bekannt: {', '.join(list(BEREICHE) + ['ton'])}", file=sys.stderr)
            return 2
        if name == "spotify":
            fn()
            spielt = pruefeSpieler()
        else:
            fn()
    if not args or "ton" in gewuenscht:
        # Der Spieler wird nur EINMAL gefragt: er gehoert zu Spotify UND zum
        # Ton, aber zweimal derselbe Befund liest sich wie zwei Probleme.
        if "spotify" not in gewuenscht:
            spielt = pruefeSpieler()
        pruefeTon(spielt)

    if alsJson:
        print(json.dumps(_ergebnisse, ensure_ascii=False, indent=2))
    else:
        breite = max((len(e["was"]) for e in _ergebnisse), default=10)
        letzter = None
        for e in _ergebnisse:
            if e["bereich"] != letzter:
                print(f"\n{e['bereich'].upper()}")
                letzter = e["bereich"]
            zeichen = {OK: "  ok  ", WARN: " warn ", FEHLER: " FEHL ", INFO: "  ..  "}[e["stand"]]
            print(f"[{zeichen}] {e['was']:<{breite}}  {e['wert']}")
            if e["bedeutung"]:
                for zeile in _umbruch(e["bedeutung"], 74):
                    print(f"           -> {zeile}")
        f = sum(1 for e in _ergebnisse if e["stand"] == FEHLER)
        w = sum(1 for e in _ergebnisse if e["stand"] == WARN)
        print(f"\n{len(_ergebnisse)} Pruefungen: {f} Fehler, {w} Warnungen")
    return sum(1 for e in _ergebnisse if e["stand"] == FEHLER)


def _umbruch(s, n):
    worte, zeile, raus = s.split(), "", []
    for w in worte:
        if len(zeile) + len(w) + 1 > n:
            raus.append(zeile)
            zeile = w
        else:
            zeile = f"{zeile} {w}".strip()
    if zeile:
        raus.append(zeile)
    return raus


if __name__ == "__main__":
    sys.exit(main())
