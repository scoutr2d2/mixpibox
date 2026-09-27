#!/usr/bin/env python3
"""
Tests fuer das eigene WLAN der Box (tools/einrichtung-ap.py).

OHNE ROOT UND OHNE FUNK: geprueft werden die reinen Teile — was in die
Konfigurationen geschrieben wird, wie der WLAN-QR aussieht, und ob das
Werkzeug ehrlich sagt, welche Pakete fehlen. Ob hostapd damit wirklich
hochkommt, sagt nur eine Box.

WARUM DAS TROTZDEM LOHNT: Die Fehler, die hier drinstecken koennen, sind
still. Ein fehlendes `wpa=2` macht ein OFFENES Netz — im Kinderzimmer, vor der
Tuer eines Programms, das als root laeuft. Ein nicht maskiertes Semikolon im
Netznamen zerlegt den QR-Code, und das faellt erst am Handy auf.

  python3 tests/einrichtung_ap_test.py
"""
import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location(
    "ap", os.path.join(REPO, "tools", "einrichtung-ap.py")
)
ap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ap)

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


print("── 1. Das Passwort")
p1, p2 = ap.passwort_erzeugen(), ap.passwort_erzeugen()
pruefe(len(p1) == 10, f"zehn Zeichen ({len(p1)})")
pruefe(p1 != p2, "bei jedem Aufruf ein anderes — nie ein eingebautes")
pruefe(len(p1) >= 8, "mindestens acht Zeichen (WPA2-Untergrenze)")
verwechselbar = set("0O1lI")
pruefe(
    not (set(p1 + p2) & verwechselbar),
    "keine verwechselbaren Zeichen (0/O, 1/l/I)",
    "es steht auf einem 800x480-Schirm und wird notfalls abgetippt",
)

print("── 2. Der WLAN-QR")
pruefe(
    ap.wifi_qr("MixPiBox-Einrichtung", "geheim123")
    == "WIFI:S:MixPiBox-Einrichtung;T:WPA;P:geheim123;;",
    "gewoehnlicher Fall",
)
pruefe(
    ap.wifi_qr("Netz;mit;Semikolon", "pw") == "WIFI:S:Netz\\;mit\\;Semikolon;T:WPA;P:pw;;",
    "Semikolon im Namen wird maskiert",
    "sonst zerlegt es den Code, und das faellt erst am Handy auf",
)
pruefe(
    ap.wifi_qr("A:B", "C,D") == "WIFI:S:A\\:B;T:WPA;P:C\\,D;;",
    "Doppelpunkt und Komma werden maskiert",
)
pruefe(
    ap.wifi_qr("Rueck\\strich", "pw") == "WIFI:S:Rueck\\\\strich;T:WPA;P:pw;;",
    "Rueckstrich wird verdoppelt",
)
pruefe(ap.wifi_qr("Offen", "") == "WIFI:S:Offen;T:nopass;;", "ohne Passwort: nopass")

print("── 3. hostapd: WPA2 und nichts Schwaecheres")
conf = ap.hostapd_conf("wlan0", "MeinAP", "geheim123")
pruefe("interface=wlan0" in conf, "Schnittstelle steht drin")
pruefe("ssid=MeinAP" in conf, "Netzname steht drin")
pruefe("wpa=2" in conf, "WPA2")
pruefe("rsn_pairwise=CCMP" in conf, "CCMP")
pruefe("wpa_key_mgmt=WPA-PSK" in conf, "PSK")
pruefe("wpa_passphrase=geheim123" in conf, "Passwort steht drin")
# DIE STILLE GEFAHR: faellt eine dieser Zeilen weg, ist das Netz OFFEN — und
# davor steht ein Programm, das als root laeuft.
pruefe("wpa=1" not in conf, "kein WPA1")
pruefe("TKIP" not in conf, "kein TKIP")
pruefe("hw_mode=g" in conf and "channel=6" in conf, "2,4 GHz, Kanal 6")

print("── 4. dnsmasq: eigene Instanz, die sich nicht einmischt")
d = ap.dnsmasq_conf("wlan0")
pruefe("interface=wlan0" in d, "nur auf dieser Schnittstelle")
pruefe("bind-interfaces" in d, "bind-interfaces — sonst Streit mit einer laufenden dnsmasq")
pruefe("except-interface=lo" in d, "und lo bleibt aussen vor")
pruefe("dhcp-range=192.168.4.10,192.168.4.50" in d, "DHCP-Bereich")
pruefe("dhcp-option=3,192.168.4.1" in d, "Gateway: die Box selbst")
pruefe(
    "address=/#/192.168.4.1" in d,
    "jeder Name zeigt auf die Box",
    "damit das Handy von selbst 'Anmelden' anbietet statt eine Adresse zu verlangen",
)

print("── 5. Fehlende Pakete werden BENANNT, nicht verschwiegen")
pruefe(ap.fehlende_pakete(lambda p: True) == [], "alles da -> leere Liste")
pruefe(
    ap.fehlende_pakete(lambda p: False) == ["hostapd", "dnsmasq"],
    "nichts da -> beide genannt",
)
pruefe(
    ap.fehlende_pakete(lambda p: p != "dnsmasq") == ["dnsmasq"],
    "nur eines fehlt -> nur dieses genannt",
)

print("── 6. Der Schirm und der AP sprechen dieselbe Adresse")
_spec2 = importlib.util.spec_from_file_location(
    "es", os.path.join(REPO, "tools", "einrichtung-schirm.py")
)
es = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(es)
pruefe(
    es.ADRESSE_AP == ap.ADRESSE,
    f"beide sagen {ap.ADRESSE}",
    f"Schirm: {es.ADRESSE_AP}, AP: {ap.ADRESSE} — laufen die auseinander, "
    "steht auf dem Bildschirm eine Adresse, unter der nichts antwortet",
)
pruefe(
    es.AP_ARBEIT == ap.ARBEIT,
    "und denselben Arbeitsordner",
    f"Schirm: {es.AP_ARBEIT}, AP: {ap.ARBEIT}",
)

print("── 7. Das Captive Portal — die Seite oeffnet sich von selbst")
# WORAUF ES ANKOMMT: Handys erkennen ein Portal daran, dass die Antwort auf
# ihre Pruefadresse NICHT die erwartete ist. Android will 204 und leer, iOS
# will „Success". Wer hier brav 204 antwortet, hat kein Portal — die Seite
# oeffnet sich dann eben NICHT, und niemand sieht, woran es lag.
import socket as _s  # noqa: E402
import threading as _th  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

_sock = _s.socket()
_sock.bind(("127.0.0.1", 0))
_port = _sock.getsockname()[1]
_sock.close()

_t = _th.Thread(
    target=lambda: ap.portal_laufen(adresse="127.0.0.1", port=_port, ziel_port=8099),
    daemon=True,
)
_t.start()
import time as _time  # noqa: E402

_time.sleep(0.6)


class OhneUmleitung(urllib.request.HTTPRedirectHandler):
    """Die Umleitung NICHT selbst befolgen — genau sie ist der Prueffall."""

    def redirect_request(self, *a, **k):
        return None


_oeffner = urllib.request.build_opener(OhneUmleitung)


def probe(pfad):
    try:
        with _oeffner.open(f"http://127.0.0.1:{_port}{pfad}", timeout=5) as a:
            return a.status, a.headers.get("Location", ""), a.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Location", ""), e.read()


for name, pfad in [
    ("Android", "/generate_204"),
    ("iOS", "/hotspot-detect.html"),
    ("Windows", "/connecttest.txt"),
    ("irgendetwas", "/beliebig/tief/verschachtelt"),
]:
    status, ziel, leib = probe(pfad)
    pruefe(status == 302, f"{name}: Umleitung statt Erwartung (war {status})")
    pruefe(
        ziel == "http://127.0.0.1:8099/einrichtung",
        f"{name}: zeigt auf den Assistenten",
        f"Location: {ziel}",
    )

status, _, leib = probe("/generate_204")
pruefe(status != 204, "auf /generate_204 kommt KEINE 204 — sonst kein Portal")
pruefe(b"Success" not in leib, "und kein 'Success' — sonst denkt iOS, alles sei gut")
pruefe(b"einrichten" in leib.lower(), "im Rumpf steht ein Verweis, falls jemand nicht folgt")

pruefe(
    ap.portal_ziel("192.168.4.1", 8099) == "http://192.168.4.1:8099/einrichtung",
    "das Ziel ist der Assistent auf der Box",
)


# ── Das Freischalten der Funk-Module (der Fund, der drei Laeufe kostete) ────
# Das DietPi-Abbild blacklistet cfg80211, solange kein WLAN eingetragen ist.
# Ohne cfg80211 kein brcmfmac, ohne brcmfmac kein wlan0 — der AP scheiterte
# nicht an wpa_supplicant, sondern daran, dass es die Schnittstelle nie gab.
import tempfile as _tf
with _tf.TemporaryDirectory() as _d:
    _sperre = os.path.join(_d, "dietpi-disable_wifi.conf")
    _freigabe = os.path.join(_d, "dietpi-enable_wifi.conf")
    open(_sperre, "w").write("blacklist cfg80211\n")
    _befehle = []
    _sicht = {"n": 0}
    def _tu(argv, frist=20):
        _befehle.append(argv)
        class R: stdout = ""; stderr = ""; returncode = 0
        return R()
    def _da():
        _sicht["n"] += 1
        return "wlan0" if _sicht["n"] >= 2 else ""   # erst beim 2. Blick da
    ok_ = ap.funk_freischalten(sperre=_sperre, freigabe=_freigabe,
                               lauf=_tu, warte=5, schlafen=lambda s: None,
                               sichtbar=_da)
    pruefe(ok_ is True, "freischalten meldet Erfolg, sobald die Schnittstelle da ist")
    pruefe(not os.path.exists(_sperre), "die Sperrliste (blacklist cfg80211) ist weg")
    pruefe(os.path.isfile(_freigabe), "die Freigabeliste fuer kuenftige Starts steht")
    _mods = [a[1] for a in _befehle if a[0] == "modprobe"]
    pruefe(set(_mods) == {"cfg80211", "brcmfmac", "brcmutil"},
           "genau die drei Module werden geladen", str(_mods))
    pruefe(_sicht["n"] >= 2, "es wird GEWARTET, bis udev die Schnittstelle anlegt")


# ── Offen ist ABSICHT: die Tuer ist der Code, nicht das WLAN-Passwort ───────
# Am Geraet scheiterte der WPA2-Handschlag des wpa_supplicant-AP ("Passwort
# falsch" am Handy) — und das Passwort war ohnehin die zweite Tuer vor
# derselben ersten. Ein offenes Netz hat keinen Handschlag, an dem etwas
# scheitern kann; der Pair-Code (harter Fehlerdeckel) bleibt die Tuer.
offen = ap.wpa_ap_conf("MixPiBox-Einrichtung", None)
pruefe("key_mgmt=NONE" in offen, "ohne Passwort: offenes Netz (key_mgmt=NONE)")
pruefe("psk" not in offen, "  keine psk-Zeile")
pruefe("WPA-PSK" not in offen and "CCMP" not in offen,
       "  keine WPA-Reste, an denen ein Handy scheitern koennte")
h_offen = ap.hostapd_conf("wlan0", "MixPiBox-Einrichtung", None)
pruefe("wpa=" not in h_offen and "wpa_passphrase" not in h_offen,
       "hostapd-Weg genauso offen")
pruefe("WPA-PSK" in ap.wpa_ap_conf("X", "geheim123"),
       "MIT Passwort bleibt WPA2 moeglich (die Funktion kann beides)")
pruefe(ap.wifi_qr("MixPiBox-Einrichtung", "") == "WIFI:S:MixPiBox-Einrichtung;T:nopass;;",
       "der QR sagt nopass — das Handy verbindet ohne Rueckfrage")

# ── Die Netzliste: gescannt BEVOR der AP den Funk uebernimmt ────────────────
SCAN = """BSS 11:22:33:44:55:66(on wlan0)
	signal: -47.00 dBm
	SSID: Heimnetz
BSS aa:bb:cc:dd:ee:ff(on wlan0)
	signal: -80.00 dBm
	SSID: Heimnetz
BSS 22:33:44:55:66:77(on wlan0)
	signal: -62.00 dBm
	SSID: Nachbar 5G
BSS 33:44:55:66:77:88(on wlan0)
	signal: -55.00 dBm
	SSID: \\x00\\x00\\x00
BSS 44:55:66:77:88:99(on wlan0)
	signal: -90.00 dBm
	SSID:
"""
netze = ap.netzliste_lesen(SCAN)
namen = [n["ssid"] for n in netze]
pruefe(namen == ["Heimnetz", "Nachbar 5G"],
       "staerkste zuerst, Doppelte weg, Versteckte raus", str(namen))
pruefe(netze[0]["signal"] == -47.0,
       "vom doppelten Netz zaehlt das STAERKSTE Signal")
pruefe(ap.netzliste_lesen("") == [], "leerer Scan -> leere Liste, kein Fehler")


# ── stoppen nach der UEBERGABE: der wpa_supplicant traegt jetzt das Heimnetz ─
# Ihn zu killen hiesse, der Box im Moment des Erfolgs das Netz zu nehmen.
import inspect as _insp
_st = _insp.getsource(ap.stoppen)
pruefe('uebergeben' in _st, "stoppen kennt die Uebergabe-Marke")
_kill = _st.index('wpa_supplicant -B -i')
_frage = _st.index('if not uebergeben')
pruefe(_frage < _kill, "  und der wpa-Kill steht HINTER der Frage danach")
pruefe(_st.index('kleiner-dhcp.py') < _frage,
       "  DHCP/DNS raeumt es dagegen IMMER ab — die braucht niemand mehr")

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
