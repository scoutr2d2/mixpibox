#!/usr/bin/env python3
"""Das eigene WLAN der Box fuer die Einrichtung — der Rueckfall ohne Kabel.

WOZU: Steckt beim ersten Start kein Netzwerkkabel, hat die Box keine Adresse
und niemand kann sie erreichen. Dann macht sie ihr EIGENES WLAN auf, das Handy
verbindet sich damit (per QR-Code, ohne Tippen) und der Assistent laeuft wie
sonst auch.

DIE REIHENFOLGE IST KABEL ZUERST, und das aus einem Grund: solange die Box am
Kabel haengt, ist sie im richtigen Netz, und das Handy muss sein WLAN nicht
wechseln. Der AP ist der Rueckfall, nicht der Normalfall.

── DAS HUEHNEREI-PROBLEM, EHRLICH BENANNT ──────────────────────────────────
`hostapd` und `dnsmasq` sind WEDER auf dem DietPi-Image NOCH nachinstallierbar,
solange es kein Netz gibt. Ein AP „aus dem Nichts" ist damit unmoeglich. Die
Pakete muessen vorher da sein — entweder beim Vorbereiten der SD-Karte
mitgegeben oder beim ersten Start ueber Kabel geholt.
`bereit()` sagt deshalb klar, was fehlt, statt es zu versuchen und zu scheitern.

── EIN FUNKBAUSTEIN, EINE ROLLE ────────────────────────────────────────────
Der Pi hat EINEN Funkbaustein fuer WLAN (und Bluetooth, siehe llmwiki
bt-audio-stottert-koexistenz). Er kann nicht gleichzeitig verlaesslich ein
eigenes Netz aufspannen UND sich in ein fremdes einbuchen. Deshalb wird
wpa_supplicant fuer diese Schnittstelle angehalten, solange der AP laeuft —
und beim Beenden wieder losgelassen.

WAS ES NICHT TUT
  * Es richtet keinen dauerhaften Hotspot ein. Alles laeuft als eigene
    Prozesse mit eigener Konfiguration; nach `stoppen` ist nichts uebrig.
    Ein AP, der die Einrichtung ueberlebt, waere ein offenes Tor im
    Kinderzimmer.
  * Es reicht kein Internet weiter (kein NAT). Wer sich verbindet, erreicht
    die Box — sonst nichts. Fuer die Einrichtung genuegt das, und alles
    andere waere eine Schleuse, die niemand bestellt hat.

AUFRUF
    sudo python3 tools/einrichtung-ap.py starten
    sudo python3 tools/einrichtung-ap.py stoppen
    python3 tools/einrichtung-ap.py bereit      # was fehlt?
"""
import os
import re
import secrets
import shutil
import subprocess
import sys
import time

ADRESSE = "192.168.4.1"
NETZ = "192.168.4"
DHCP_VON = f"{NETZ}.10"
DHCP_BIS = f"{NETZ}.50"
KANAL = 6  # 2,4 GHz: von jedem Handy erreichbar, anders als 5 GHz
# NEUER NAME MIT ABSICHT (08.08.2026): Handys, die die fruehere WPA2-Fassung
# dieses Netzes gespeichert hatten, fragten beim nun OFFENEN Netz weiter nach
# einem Passwort — das gespeicherte Profil gewinnt gegen die Realitaet, und
# "Netz vergessen" muss man erst einmal finden. Ein neuer Name ist fuer jedes
# Handy ein frisches, offenes Netz. Der alte Name darf nie wiederkommen.
SSID_VORGABE = "MixPi Start"
ARBEIT = "/run/mixpibox-einrichtung"
PW_DATEI = os.path.join(ARBEIT, "wlan-passwort")

# Ohne die Zwillinge 0/O und 1/l/I: das Passwort steht auf einem 800x480-Schirm
# und wird notfalls abgetippt.
ALPHABET = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"


# ── Reine Funktionen (ohne root testbar) ────────────────────────────────────
def passwort_erzeugen(laenge=10):
    """Ein Passwort je Box und je Start — nie ein festes.

    Ein eingebautes Passwort waere auf JEDER Box dasselbe und stuende binnen
    einer Woche im Netz. Es lebt ohnehin nur, solange die Einrichtung laeuft.
    """
    return "".join(secrets.choice(ALPHABET) for _ in range(laenge))


def wifi_qr(ssid, psk):
    """Der Text hinter einem WLAN-QR-Code: `WIFI:S:…;T:WPA;P:…;;`

    ESCAPEN IST PFLICHT, auch wenn unsere eigenen Werte harmlos sind: `;` und
    `:` trennen die Felder, ein `\\` maskiert. Ein Name mit Semikolon wuerde
    den Code sonst still zerlegen, und der Fehler faellt erst am Handy auf.
    """
    def maskieren(s):
        return re.sub(r'([\\;,:"])', r"\\\1", s)

    if psk:
        return f"WIFI:S:{maskieren(ssid)};T:WPA;P:{maskieren(psk)};;"
    return f"WIFI:S:{maskieren(ssid)};T:nopass;;"


def hostapd_conf(iface, ssid, psk, kanal=KANAL):
    """Die Konfiguration fuer hostapd.

    WPA2 (wpa=2, CCMP) und sonst nichts: WPA1 und TKIP sind kaputt, und ein
    offenes Netz waere hier zwar bequem, aber jeder in Funkreichweite stuende
    dann vor der Tuer des Agenten — und der laeuft als root.
    """
    zeilen = [
        f"interface={iface}",
        "driver=nl80211",
        f"ssid={ssid}",
        "hw_mode=g",
        f"channel={kanal}",
        "ieee80211n=1",
        "wmm_enabled=1",
        "auth_algs=1",
        "ignore_broadcast_ssid=0",
    ]
    if psk:
        zeilen += ["wpa=2", f"wpa_passphrase={psk}",
                   "wpa_key_mgmt=WPA-PSK", "rsn_pairwise=CCMP"]
    zeilen += [""]
    return "\n".join(zeilen)


def wpa_ap_conf(ssid, psk, kanal=KANAL, land="DE"):
    """Dieselbe Rolle wie hostapd_conf — aber fuer wpa_supplicant.

    WARUM ES DIESEN ZWEITEN WEG GIBT: `hostapd` ist auf dem DietPi-Image nicht
    drauf, und ohne Netz auch nicht nachzuinstallieren. Genau dann soll der
    Rueckfall aber greifen. `wpa_supplicant` IST da, sobald die Box ueberhaupt
    WLAN kann — der Agent redet ohnehin ueber `wpa_cli` mit ihm — und es kann
    seit jeher selbst ein Netz aufspannen (`mode=2`). Damit faellt die
    Voraussetzung weg, an der der ganze Rueckfall haengengeblieben ist.

    DIESELBE HAERTE WIE OBEN: WPA2 mit CCMP, nichts sonst. `proto=RSN` und
    `pairwise=CCMP` schliessen WPA1 und TKIP aus. Ein offenes Netz waere
    bequem — und stellte jeden in Funkreichweite vor die Tuer eines Programms,
    das als root laeuft.

    `ap_scan=2` ist fuer den AP-Betrieb noetig: ohne das sucht wpa_supplicant
    erst nach fremden Netzen, statt selbst eines aufzumachen.

    OHNE PSK ENTSTEHT EIN OFFENES NETZ, und das ist seit dem 08.08.2026 der
    Normalfall — eine bewusste Entscheidung, keine Nachlaessigkeit:
      * Die Tuer ist der PAIR-CODE auf dem Schirm der Box (6 Ziffern, harter
        Fehlerdeckel im Agenten, Anwesenheit vor dem Geraet noetig). Das
        WLAN-Passwort davor war eine ZWEITE Tuer vor derselben ersten — und
        genau an ihr scheiterte die Einrichtung am Geraet: das Handy meldete
        "Passwort falsch" beim WPA2-Handschlag mit dem wpa_supplicant-AP.
        Ein offenes Netz hat keinen Handschlag, an dem etwas scheitern kann.
      * Das Netz lebt Minuten und nur bis zur Einrichtung; danach raeumt
        `stoppen` alles ab. Wer sich verbindet, erreicht die Box — sonst
        nichts (kein NAT, keine Weiterleitung).
    """
    zeilen = [
        "ctrl_interface=/var/run/wpa_supplicant",
        f"country={land}",
        "ap_scan=2",
        "network={",
        f'    ssid="{ssid}"',
        "    mode=2",
        f"    frequency={2407 + kanal * 5}",
    ]
    if psk:
        zeilen += ["    key_mgmt=WPA-PSK", "    proto=RSN",
                   "    pairwise=CCMP", "    group=CCMP", f'    psk="{psk}"']
    else:
        zeilen += ["    key_mgmt=NONE"]
    zeilen += ["}", ""]
    return "\n".join(zeilen)


def dnsmasq_conf(iface, adresse=ADRESSE, von=DHCP_VON, bis=DHCP_BIS):
    """Die Konfiguration fuer unsere EIGENE dnsmasq-Instanz.

    `bind-interfaces` und `except-interface=lo` sind wichtig: eine dnsmasq, die
    auf allem lauscht, streitet mit einer schon laufenden — und auf einer Box
    mit fertiger Installation laeuft womoeglich eine.

    `address=/#/<adresse>` beantwortet JEDEN Namen mit der Box. Das ist
    Absicht: das Handy prueft nach dem Verbinden, ob es ins Internet kommt,
    bekommt die Box zu sehen und bietet von selbst „Anmelden" an — man landet
    also ohne Adresseingabe beim Assistenten.
    """
    return "\n".join([
        f"interface={iface}",
        "bind-interfaces",
        "except-interface=lo",
        f"dhcp-range={von},{bis},255.255.255.0,12h",
        f"dhcp-option=3,{adresse}",   # Gateway: wir selbst
        f"dhcp-option=6,{adresse}",   # DNS: wir selbst
        f"address=/#/{adresse}",
        "no-resolv",
        "no-hosts",
        "log-facility=-",
        "",
    ])


def fehlende_pakete(vorhanden=None):
    """Welche Programme fehlen? Reine Auskunft, nichts wird versucht."""
    pruefen = vorhanden or (lambda p: shutil.which(p) is not None)
    return [p for p in ("hostapd", "dnsmasq") if not pruefen(p)]


def weg_waehlen(vorhanden=None):
    """Womit machen wir das Netz auf? -> "hostapd" | "wpa" | None

    ZWEI WEGE, EINE VORFAHRT. `hostapd` ist die ausgereiftere Wahl und wird
    genommen, wenn sie da ist — auf einer fertig installierten Box ist sie das
    (das Rezept bringt sie mit). Auf einer FRISCHEN Karte ist sie es nicht, und
    genau da traegt `wpa_supplicant`: es ist vorhanden, sobald die Box WLAN
    kann, und macht seit jeher auch Netze auf.

    DAS WAR DIE GANZE LUECKE. Der Rueckfall ohne Kabel lag ein halbes Jahr
    fertig herum und funktionierte auf einer frischen Karte trotzdem nie, weil
    er an einem Paket hing, das erst das Netz gebracht haette, das er ersetzen
    sollte.

    Fuer DHCP und DNS gibt es kein Wenn: `kleiner-dhcp.py` liegt daneben und
    braucht nichts ausser Python.
    """
    pruefen = vorhanden or (lambda p: shutil.which(p) is not None)
    if pruefen("hostapd") and pruefen("dnsmasq"):
        return "hostapd"
    if pruefen("wpa_supplicant"):
        return "wpa"
    return None


# ── Captive Portal: die Seite oeffnet sich von selbst ───────────────────────
# WIE HANDYS EIN PORTAL ERKENNEN: Nach dem Verbinden ruft jedes Betriebssystem
# eine FESTE Adresse ab und prueft die Antwort.
#
#   Android   http://connectivitycheck.gstatic.com/generate_204  erwartet: 204, leer
#   iOS/macOS http://captive.apple.com/hotspot-detect.html       erwartet: "Success"
#   Windows   http://www.msftconnecttest.com/connecttest.txt     erwartet: fester Text
#
# Kommt etwas ANDERES, schliesst das Geraet auf ein Anmeldeportal und oeffnet
# die Seite von selbst — genau das Verhalten, das man von Hotel-WLAN kennt.
#
# Deshalb genuegt hier EINE Antwort fuer alles: eine Umleitung. Der Trick ist
# nicht die Umleitung selbst, sondern dass die Erwartung NICHT erfuellt wird.
#
# Dass die Namen ueberhaupt bei uns landen, besorgt `address=/#/…` in der
# dnsmasq-Konfiguration weiter oben. Beides zusammen ergibt das Portal; eines
# allein tut nichts.
PORTAL_PORT = 80


def portal_ziel(adresse=ADRESSE, port=8099):
    return f"http://{adresse}:{port}/einrichtung"


def portal_laufen(adresse=ADRESSE, port=PORTAL_PORT, ziel_port=8099, dauer=None):
    """Ein winziger Umleitungsserver auf Port 80.

    Er beantwortet JEDE Anfrage mit 302 auf den Assistenten — auch die
    Pruefadressen der Betriebssysteme, und genau darum geht es.
    """
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    ziel = portal_ziel(adresse, ziel_port)

    class Umleiter(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            leib = (
                f'<!doctype html><meta charset=utf-8><title>MixPiBox</title>'
                f'<meta http-equiv="refresh" content="0;url={ziel}">'
                f'<p><a href="{ziel}">MixPiBox einrichten</a>'
            ).encode()
            self.send_response(302)
            self.send_header("Location", ziel)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(leib)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            # Der Rumpf ist fuer die Faelle, in denen ein Geraet der Umleitung
            # nicht folgt, die Seite aber anzeigt.
            self.wfile.write(leib)

        do_POST = do_GET

    srv = ThreadingHTTPServer(("0.0.0.0", port), Umleiter)
    if dauer:
        import threading as _t

        _t.Timer(dauer, srv.shutdown).start()
    srv.serve_forever()


# ── Tun (braucht root) ──────────────────────────────────────────────────────
NETZE_DATEI = os.path.join(ARBEIT, "netze.json")


def netzliste_lesen(scan_text):
    """`iw dev X scan` -> [{ssid, signal}], staerkste zuerst. Pure.

    WOZU: Im AP-Betrieb kann der Funkbaustein NICHT suchen (ein Baustein, eine
    Rolle). Wer auf der Einrichtungsseite eine Netzliste will, muss sie
    scannen, BEVOR der AP startet — und genau dafuer wird sie hier gelesen
    und zwischengespeichert. Handys machen es beim Einrichten genauso.
    """
    import json as _json                       # noqa: F401 — Symmetrie unten
    netze = {}
    ssid, signal = None, None
    for zeile in (scan_text or "").splitlines():
        z = zeile.strip()
        if z.startswith("BSS "):
            ssid, signal = None, None
        elif z.startswith("signal:"):
            try:
                signal = float(z.split()[1])
            except (IndexError, ValueError):
                signal = None
        elif z.startswith("SSID:"):
            ssid = z[5:].strip()
            # Versteckte Netze senden keinen oder einen Null-Namen — die kann
            # niemand antippen, also gehoeren sie nicht in die Liste.
            if not ssid or "\\x00" in ssid:
                ssid = None
            if ssid is not None:
                st = signal if signal is not None else -100.0
                if ssid not in netze or st > netze[ssid]:
                    netze[ssid] = st
    return [{"ssid": n, "signal": s}
            for n, s in sorted(netze.items(), key=lambda kv: -kv[1])][:30]


def vorab_scannen(iface, ziel=None):
    """Einmal suchen und die Liste ablegen — direkt vor dem AP-Start.

    Mehrere Anlaeufe, weil ein frisch hochgeholtes Interface die erste Suche
    gern mit "resource busy" abweist. Scheitert alles, entsteht eine LEERE
    Liste — die Seite zeigt dann das Formular zum Selbsttippen, wie bisher.
    """
    import json
    ziel = ziel or NETZE_DATEI
    netze = []
    for _ in range(3):
        r = _lauf(["iw", "dev", iface, "scan"], frist=25)
        if r.returncode == 0 and r.stdout:
            netze = netzliste_lesen(r.stdout)
            if netze:
                break
        time.sleep(2)
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    with open(ziel, "w", encoding="utf-8") as f:
        json.dump(netze, f, ensure_ascii=False)
    return netze


MODUL_SPERRE = "/etc/modprobe.d/dietpi-disable_wifi.conf"
MODUL_FREIGABE = "/etc/modules-load.d/dietpi-enable_wifi.conf"
FUNK_MODULE = ("cfg80211", "brcmfmac", "brcmutil")


def funk_freischalten(sperre=MODUL_SPERRE, freigabe=MODUL_FREIGABE,
                      lauf=None, warte=15, schlafen=None, sichtbar=None):
    """Die Funk-Module laden, die DietPi ohne WLAN-Konfiguration WEGSPERRT.

    DER FUND, der drei Laeufe gekostet hat: das DietPi-Abbild liefert
    /etc/modprobe.d/dietpi-disable_wifi.conf mit `blacklist cfg80211` aus.
    Freigeschaltet wird das nur, wenn dietpi.txt WIFI_ENABLED=1 traegt — also
    genau dann NICHT, wenn die Box ihr WLAN erst per Handy bekommen soll.
    Ohne cfg80211 kein brcmfmac, ohne brcmfmac kein wlan0: der Rueckfall
    scheiterte nicht an wpa_supplicant, sondern daran, dass es die
    Schnittstelle nie gab.

    Getan wird exakt, was `dietpi-set_hardware wifimodules enable` taete:
    Sperrliste weg, Module laden, Freigabeliste fuer kuenftige Starts
    schreiben. Danach WARTEN, bis udev die Schnittstelle angelegt hat —
    modprobe kehrt zurueck, bevor wlan0 existiert.

    Dazu rfkill: das PROGRAMM fehlt auf dem Abbild, der Kernel-Schalter
    existiert trotzdem. Entsperrt wird direkt ueber /sys.
    """
    tu = lauf or _lauf
    ruh = schlafen or time.sleep
    da = sichtbar or _funkschnittstelle
    try:
        if os.path.isfile(sperre):
            os.remove(sperre)
    except OSError:
        pass
    for m in FUNK_MODULE:
        tu(["modprobe", m])
    try:
        with open(freigabe, "w", encoding="ascii") as f:
            f.write("\n".join(FUNK_MODULE) + "\n")
    except OSError:
        pass
    # rfkill ohne rfkill: 0 nach soft = entsperrt.
    import glob
    for pfad in glob.glob("/sys/class/rfkill/*/soft"):
        try:
            with open(pfad, "w") as f:
                f.write("0")
        except OSError:
            pass
    for _ in range(warte):
        if da():
            return True
        ruh(1)
    return bool(da())


def _funkschnittstelle():
    try:
        for n in sorted(os.listdir("/sys/class/net")):
            if os.path.isdir(f"/sys/class/net/{n}/wireless"):
                return n
    except OSError:
        pass
    return None


def _lauf(argv, frist=20):
    return subprocess.run(argv, capture_output=True, text=True, timeout=frist)


def starten(ssid=SSID_VORGABE):
    weg = weg_waehlen()
    if weg is None:
        print("Weder hostapd noch wpa_supplicant vorhanden — kein eigenes WLAN moeglich.")
        print("Ohne wpa_supplicant kann die Box ueberhaupt kein WLAN; hier hilft nur Kabel.")
        return 2
    # ERST FREISCHALTEN, DANN SUCHEN: ohne das gibt es auf einer Karte ohne
    # WLAN-Eintrag gar keine Schnittstelle (blacklist cfg80211, s.o.).
    funk_freischalten()
    iface = _funkschnittstelle()
    if iface:
        # JETZT die Umgebung scannen — gleich kann es der Baustein nicht mehr
        # (ein Baustein, eine Rolle). Die Liste landet neben dem Passwort im
        # Arbeitsordner; die Einrichtungsseite zeigt sie zum Antippen.
        _lauf(["ip", "link", "set", iface, "up"])
        gefunden = vorab_scannen(iface)
        print(f"Umgebung gescannt: {len(gefunden)} Netze (fuer die Auswahl am Handy)")
    if not iface:
        print("Keine Funkschnittstelle gefunden — auch nach dem Freischalten der Module.")
        # DEN ZUSTAND MITGEBEN: welche Module sind wirklich geladen, welche
        # Schnittstellen gibt es? Ohne das raet man beim naechsten Protokoll.
        module = _lauf(["cat", "/proc/modules"]).stdout
        geladen = [m for m in FUNK_MODULE if m in module]
        print(f"  Module geladen: {', '.join(geladen) or 'KEINES'}")
        print("  /sys/class/net: " + _lauf(["ls", "/sys/class/net"]).stdout.replace("\n", " "))
        return 2

    os.makedirs(ARBEIT, exist_ok=True)
    os.chmod(ARBEIT, 0o700)
    # OFFENES NETZ — die Tuer ist der Code auf dem Schirm, nicht das
    # WLAN-Passwort (Begruendung: wpa_ap_conf). Die Passwortdatei bleibt als
    # LEERE Datei bestehen: der Schirm liest sie, und "leer" heisst dort
    # "ohne Passwort" statt "kein AP".
    psk = ""
    with open(PW_DATEI, "w", encoding="ascii") as f:
        f.write("\n")
    os.chmod(PW_DATEI, 0o600)
    with open(os.path.join(ARBEIT, "ssid"), "w", encoding="utf-8") as f:
        f.write(ssid + "\n")

    hpfad = os.path.join(ARBEIT, "hostapd.conf")
    dpfad = os.path.join(ARBEIT, "dnsmasq.conf")
    wpfad = os.path.join(ARBEIT, "wpa-ap.conf")
    if weg == "hostapd":
        with open(hpfad, "w", encoding="utf-8") as f:
            f.write(hostapd_conf(iface, ssid, psk))
        os.chmod(hpfad, 0o600)   # enthaelt das Passwort
        with open(dpfad, "w", encoding="utf-8") as f:
            f.write(dnsmasq_conf(iface))
    else:
        with open(wpfad, "w", encoding="utf-8") as f:
            f.write(wpa_ap_conf(ssid, psk))
        os.chmod(wpfad, 0o600)   # enthaelt das Passwort

    # DEN FUNK ENTSPERREN, BEVOR IRGENDETWAS ANDERES PASSIERT.
    # DietPi laesst `rfkill` gesetzt, solange kein WLAN eingetragen ist
    # (AUTO_SETUP_NET_WIFI_ENABLED=0) — und genau das ist unser Fall: die Box
    # soll ihr WLAN ja erst per Handy bekommen. Ein gesperrter Funkbaustein
    # nimmt jeden Startversuch stumm an und tut nichts; am Geraet stand nur
    # "Eigenes WLAN kam nicht hoch" ohne weiteren Hinweis.
    # `rfkill` fehlt auf manchen Abbildern — dann ist es kein Fehler, sondern
    # nur nichts zu entsperren.
    if shutil.which("rfkill"):
        _lauf(["rfkill", "unblock", "wifi"])
        _lauf(["rfkill", "unblock", "all"])

    # EIN FUNKBAUSTEIN, EINE ROLLE: der laufende wpa_supplicant muss die
    # Schnittstelle loslassen, sonst streiten zwei um dieselbe Karte. Das gilt
    # AUCH fuer den wpa-Weg: dort starten wir gleich einen EIGENEN mit eigener
    # Konfiguration, nicht den Systemdienst um.
    _lauf(["systemctl", "stop", "wpa_supplicant"])
    # Die Schnittstelle muss OBEN sein, sonst nimmt wpa_supplicant sie nicht.
    _lauf(["ip", "link", "set", iface, "up"])
    _lauf(["ip", "addr", "flush", "dev", iface])
    _lauf(["ip", "addr", "add", f"{ADRESSE}/24", "dev", iface])
    _lauf(["ip", "link", "set", iface, "up"])

    if weg == "hostapd":
        h = _lauf(["hostapd", "-B", hpfad], frist=30)
        if h.returncode != 0:
            print(f"hostapd startete nicht: {(h.stdout or h.stderr)[:300]}")
            return 1
        d = _lauf(["dnsmasq", "-C", dpfad], frist=20)
        if d.returncode != 0:
            print(f"dnsmasq startete nicht: {(d.stdout or d.stderr)[:300]}")
            _lauf(["pkill", "-f", f"hostapd -B {hpfad}"])
            return 1
    else:
        # -B geht in den Hintergrund, -i die Schnittstelle, -c unsere Datei.
        w = _lauf(["wpa_supplicant", "-B", "-i", iface, "-c", wpfad,
                   "-D", "nl80211"], frist=30)
        if w.returncode != 0:
            # DEN ZUSTAND MITGEBEN, nicht nur den Fehlschlag: ohne rfkill-Lage
            # und Schnittstellenliste raet man beim naechsten Mal wieder.
            rf = _lauf(["rfkill", "list"]).stdout if shutil.which("rfkill") else "(kein rfkill)"
            netze = _lauf(["ls", "/sys/class/net"]).stdout.replace("\n", " ")
            print(f"wpa_supplicant (AP) startete nicht: {(w.stdout or w.stderr)[:300]}")
            print(f"  Schnittstelle: {iface} · vorhanden: {netze.strip()}")
            print(f"  rfkill:\n{rf[:400]}")
            _lauf(["systemctl", "start", "wpa_supplicant"])
            return 1
        # Die Adresse ueberlebt den Start des Funks nicht immer — nochmal
        # setzen, statt zu hoffen. Kostet nichts und spart die Fehlersuche
        # "Netz da, Box nicht erreichbar".
        _lauf(["ip", "addr", "add", f"{ADRESSE}/24", "dev", iface])
        # DHCP und DNS: unsere eigenen, in reiner Standardbibliothek. Ohne sie
        # bekaeme das Handy keine Adresse — ein WLAN, in das man sich nicht
        # einbuchen kann, ist kein WLAN.
        dienst = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "kleiner-dhcp.py")
        try:
            subprocess.Popen(
                [sys.executable, dienst, "--schnittstelle", iface,
                 "--adresse", ADRESSE],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as e:
            print(f"DHCP/DNS startete nicht: {e}")
            _lauf(["pkill", "-f", f"wpa_supplicant -B -i {iface} -c {wpfad}"])
            _lauf(["systemctl", "start", "wpa_supplicant"])
            return 1

    # Das Portal als EIGENER Prozess: `starten` endet gleich, der Umleiter muss
    # aber bleiben. Scheitert er (Port 80 belegt — auf einer fertigen Box laeuft
    # dort womoeglich ein Webserver), ist das kein Grund, den AP hinzuwerfen:
    # die Adresse steht ja als QR-Code auf dem Schirm.
    try:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "portal"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        portal = "Portal laeuft"
    except OSError as e:
        portal = f"ohne Portal ({e})"

    print(f"WLAN '{ssid}' ist OFFEN (ohne Passwort) — Zugang nur mit dem Code auf dem Schirm")
    print(f"Die Box ist unter http://{ADRESSE}:8099 erreichbar. {portal}")
    print("Weg: " + ("hostapd + dnsmasq" if weg == "hostapd"
                     else "wpa_supplicant + eigenes DHCP/DNS (ohne Zusatzpakete)"))
    return 0


def hat_netz(pruefer=None):
    """Hat die Box eine brauchbare Adresse? (Loopback zaehlt nicht.)

    NUR DIE ADRESSE, NICHT DAS INTERNET: Wer im Heimnetz haengt, aber gerade
    keine Verbindung nach draussen hat, soll KEINEN Zugangspunkt aufmachen —
    dann waere die Box aus ihrem eigenen Netz plaetzlich verschwunden. Ob es
    ins Internet geht, klaert spaeter der Assistent (`netz-pruefen`).
    """
    hole = pruefer or (lambda: _lauf(["ip", "-o", "-4", "addr", "show",
                                      "scope", "global"], frist=10).stdout)
    return bool((hole() or "").strip())


def wenn_kein_netz(warten=45, takt=3, ssid=SSID_VORGABE, pruefer=None,
                   schlafen=None):
    """Warten, ob sich ein Netz einstellt — und sonst das eigene aufmachen.

    WARUM GEWARTET WIRD, statt sofort zu handeln: Beim Start dauert es, bis
    DHCP eine Adresse gebracht hat (auf dem Pi 4 bis 9 s, siehe llmwiki
    `kiosk-wartet-auf-dhcp`), und WLAN braucht laenger als Kabel. Wer sofort
    einen Zugangspunkt aufmacht, nimmt der Box genau die Verbindung weg, die
    zwei Sekunden spaeter da gewesen waere — der Funkbaustein kann nur eines
    von beidem.

    UND WARUM ES DEN SCHRITT UEBERHAUPT BRAUCHT: Ohne ihn liegt der ganze
    Rueckfall bereit und wird nie ausgeloest. Jemand muesste ihn von Hand
    starten — auf einer Box, die man gerade nicht erreicht. Das ist der Zirkel,
    den er aufloesen soll.
    """
    ruh = schlafen or time.sleep
    ende = time.time() + warten
    while time.time() < ende:
        if hat_netz(pruefer):
            return 0                       # alles gut, nichts zu tun
        ruh(takt)
    if hat_netz(pruefer):
        return 0
    print(f"Nach {warten} s keine Adresse — eigenes WLAN wird aufgemacht.")
    return starten(ssid)


def stoppen():
    iface = _funkschnittstelle()
    # NACH EINER UEBERGABE traegt der laufende wpa_supplicant die HEIMNETZ-
    # Verbindung — dieselbe Instanz, die vorher den AP machte, nur mit anderem
    # Netzblock. Sie zu killen oder die Adressen zu leeren hiesse, der Box im
    # Moment des Erfolgs das Netz zu nehmen. Die Marke setzt der Agent beim
    # gelungenen Wechsel; DHCP/DNS/Portal sind dann schon abgeraeumt.
    uebergeben = os.path.isfile(os.path.join(ARBEIT, "uebergeben"))
    _lauf(["pkill", "-f", f"hostapd -B {ARBEIT}"])
    _lauf(["pkill", "-f", f"dnsmasq -C {ARBEIT}"])
    _lauf(["pkill", "-f", "kleiner-dhcp.py"])
    _lauf(["pkill", "-f", f"{os.path.abspath(__file__)} portal"])
    if not uebergeben:
        # Der zweite Weg hinterlaesst zwei andere Prozesse. NUR DIE EIGENEN
        # treffen: `-f wpa_supplicant` allein erschluege den Systemdienst mit.
        _lauf(["pkill", "-f", f"wpa_supplicant -B -i .* -c {ARBEIT}"])
        if iface:
            _lauf(["ip", "addr", "flush", "dev", iface])
        _lauf(["systemctl", "start", "wpa_supplicant"])
    # Nichts soll die Einrichtung ueberleben — auch nicht das Passwort.
    for name in ("hostapd.conf", "dnsmasq.conf", "wpa-ap.conf",
                 "wlan-passwort", "ssid", "netze.json", "hinweis", "uebergeben"):
        try:
            os.remove(os.path.join(ARBEIT, name))
        except OSError:
            pass
    print("Eigenes WLAN beendet, Funk wieder frei.")
    return 0


def main():
    was = sys.argv[1] if len(sys.argv) > 1 else "bereit"
    if was == "bereit":
        weg = weg_waehlen()
        if weg == "hostapd":
            print("bereit (hostapd + dnsmasq)")
            return 0
        if weg == "wpa":
            # KEIN Mangel mehr, sondern der zweite Weg. Frueher stand hier
            # "es fehlt: hostapd, dnsmasq" — und wer das las, hielt den
            # Rueckfall fuer unmoeglich, obwohl alles Noetige da war.
            fehlt = fehlende_pakete()
            print("bereit (wpa_supplicant + eigenes DHCP/DNS)")
            if fehlt:
                print(f"  hostapd/dnsmasq fehlen ({', '.join(fehlt)}) — "
                      f"werden nicht gebraucht.")
            return 0
        print("NICHT bereit: weder hostapd noch wpa_supplicant vorhanden.")
        return 1
    if was == "starten":
        return starten()
    if was == "wenn-kein-netz":
        # Der einzige Aufruf, der von SELBST passiert (Unit beim Start). Alles
        # andere hier ist Handarbeit.
        w = 45
        if "--warten" in sys.argv:
            w = int(sys.argv[sys.argv.index("--warten") + 1])
        return wenn_kein_netz(warten=w)
    if was == "stoppen":
        return stoppen()
    if was == "portal":
        portal_laufen()
        return 0
    print(__doc__.split("AUFRUF")[1].strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
