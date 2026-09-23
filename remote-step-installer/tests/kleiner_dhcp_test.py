#!/usr/bin/env python3
"""
Tests fuer DHCP und DNS des Einrichtungs-WLANs (tools/kleiner-dhcp.py).

WAS HIER WIRKLICH AUF DEM SPIEL STEHT: Diese beiden Dienste sind der Grund,
warum der Rueckfall ohne Kabel ueberhaupt geht. `dnsmasq` ist auf dem
DietPi-Image nicht drauf und ohne Netz nicht nachzuinstallieren — also sprechen
wir die Protokolle selbst. Ein selbstgebautes Protokoll hat aber keine
Fremderfahrung hinter sich: was hier nicht geprueft ist, faellt erst am Geraet
auf, und zwar als "das Handy verbindet sich nicht" ohne jeden Hinweis.

Geprueft wird deshalb NICHT "es laeuft", sondern:
  * kommt aus einem echten DISCOVER ein brauchbares OFFER?
  * bleibt dieselbe MAC bei derselben Adresse (ein Handy fragt mehrfach)?
  * wird verworfen, was nicht passt — auf einem offenen Port, hinter dem ein
    Programm als root laeuft?
  * beantwortet der DNS JEDEN Namen mit der Box (der Kern des Portals) —
    und was macht er mit einer AAAA-Frage?

  python3 tests/kleiner_dhcp_test.py
"""
import importlib.util
import os
import socket
import struct
import sys
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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


spec = importlib.util.spec_from_file_location(
    "kdhcp", os.path.join(REPO, "tools", "kleiner-dhcp.py"))
kd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kd)


def dhcp_anfrage(art, mac=b"\x02\x11\x22\x33\x44\x55", xid=0xDEADBEEF):
    """Ein echtes Client-Paket bauen — so, wie ein Handy es schickt."""
    p = bytearray(240)
    p[0], p[1], p[2] = 1, 1, 6
    struct.pack_into("!I", p, 4, xid)
    struct.pack_into("!H", p, 10, 0x8000)      # Broadcast-Flag
    p[28:34] = mac
    struct.pack_into("!I", p, 236, kd.KEKS)
    p.extend([53, 1, art])
    p.append(255)
    return bytes(p)


print("── 1. DHCP: aus DISCOVER wird ein brauchbares OFFER")
a = kd.dhcp_lesen(dhcp_anfrage(kd.ENTDECKEN))
pruefe(a is not None and a["art"] == kd.ENTDECKEN, "DISCOVER wird gelesen")
pruefe(a and a["xid"] == 0xDEADBEEF, "die Kennung kommt durch (sonst wirft das Handy es weg)")

buch = kd.Adressbuch()
ihre = buch.hole(a["mac"])
antwort = kd.dhcp_antwort(a, ihre, kd.ANGEBOT)
pruefe(antwort[0] == 2, "die Antwort ist ein BOOTREPLY")
pruefe(struct.unpack("!I", antwort[4:8])[0] == 0xDEADBEEF,
       "dieselbe Kennung wie die Frage")
pruefe(kd.bytes_zu_ip(antwort[16:20]) == ihre, f"die angebotene Adresse steht drin ({ihre})")
pruefe(antwort[28:34] == a["mac"], "die MAC des Fragenden steht drin")

# Die Optionen zerlegen — genau das macht das Handy auch.
opts, i = {}, 240
while i < len(antwort) and antwort[i] != 255:
    c, ln = antwort[i], antwort[i + 1]
    opts[c] = antwort[i + 2:i + 2 + ln]
    i += 2 + ln
pruefe(opts.get(53) == bytes([kd.ANGEBOT]), "Art: OFFER")
pruefe(kd.bytes_zu_ip(opts.get(1, b"")) == kd.MASKE, "Netzmaske dabei")
pruefe(kd.bytes_zu_ip(opts.get(3, b"")) == kd.ADRESSE, "Router = die Box")
# DIE WICHTIGSTE OPTION FUERS PORTAL: zeigt der DNS nicht auf die Box, fragt
# das Handy irgendeinen anderen Server — und das Portal oeffnet sich nie.
pruefe(kd.bytes_zu_ip(opts.get(6, b"")) == kd.ADRESSE,
       "DNS = die Box — daran haengt das automatische Oeffnen der Seite")
pruefe(kd.bytes_zu_ip(opts.get(54, b"")) == kd.ADRESSE, "Server-Kennung dabei")
pruefe(struct.unpack("!I", opts[51])[0] == kd.MIETDAUER, "Mietdauer dabei")

print("\n── 2. Dieselbe MAC, dieselbe Adresse")
# Ein Handy schickt mehrere DISCOVER hintereinander. Bekaeme es jedes Mal eine
# neue Adresse, waere der kleine Bereich in Minuten leer.
b2 = kd.Adressbuch()
erste = b2.hole(b"\x02\x00\x00\x00\x00\x01")
pruefe(b2.hole(b"\x02\x00\x00\x00\x00\x01") == erste, "zweite Frage -> dieselbe Adresse")
zweite = b2.hole(b"\x02\x00\x00\x00\x00\x02")
pruefe(zweite != erste, "ein anderes Geraet -> eine andere Adresse")
pruefe(erste == kd.VON, f"die erste Adresse ist der Anfang des Bereichs ({kd.VON})")

# Bereich voll: nicht schweigen, sondern die aelteste Miete recyceln.
b3 = kd.Adressbuch(von="192.168.4.10", bis="192.168.4.11")
x1 = b3.hole(b"\x01" * 6, jetzt=100)
x2 = b3.hole(b"\x02" * 6, jetzt=200)
x3 = b3.hole(b"\x03" * 6, jetzt=300)
pruefe(x3 == x1, "ist der Bereich voll, verfaellt die AELTESTE Miete", f"{x1} {x2} {x3}")

print("\n── 3. Was nicht passt, wird verworfen (offener Port, root dahinter)")
for paket, was in [
    (b"", "leeres Paket"),
    (b"\x01" * 100, "zu kurz"),
    (dhcp_anfrage(kd.ENTDECKEN)[:-3] + b"\x35\x09\x01", "Option laenger als das Paket"),
    (b"\x02" + dhcp_anfrage(kd.ENTDECKEN)[1:], "Antwort statt Anfrage (op=2)"),
    (dhcp_anfrage(kd.ENTDECKEN)[:236] + b"\x00\x00\x00\x00" + b"\x35\x01\x01",
     "falscher magic cookie"),
]:
    pruefe(kd.dhcp_lesen(paket) is None, f"  verworfen: {was}")

ohne_art = bytearray(dhcp_anfrage(kd.ENTDECKEN))
ohne_art = bytes(ohne_art[:240]) + b"\xff"
pruefe(kd.dhcp_lesen(ohne_art) is None, "  verworfen: ohne Nachrichtenart (Option 53)")

print("\n── 4. DNS: jeder Name zeigt auf die Box")


def dns_frage(name, typ=1, kennung=b"\xab\xcd"):
    teile = b"".join(bytes([len(t)]) + t.encode() for t in name.split("."))
    return (kennung + struct.pack("!HHHHH", 0x0100, 1, 0, 0, 0)
            + teile + b"\x00" + struct.pack("!HH", typ, 1))


for name in ("connectivitycheck.gstatic.com", "captive.apple.com",
             "www.msftconnecttest.com", "irgendwas.example"):
    r = kd.dns_antwort(dns_frage(name))
    pruefe(r is not None and r[:2] == b"\xab\xcd", f"  {name}: beantwortet")
    if r:
        anzahl = struct.unpack("!H", r[6:8])[0]
        pruefe(anzahl == 1, f"  {name}: genau ein Datensatz")
        pruefe(r[-4:] == kd.ip_zu_bytes(kd.ADRESSE),
               f"  {name}: zeigt auf die Box ({kd.ADRESSE})")

# AAAA: LEER antworten, nicht falsch. Eine IPv4 als AAAA waere Unsinn, und wer
# gar nicht antwortet, laesst das Handy in einen Zeitablauf laufen.
r6 = kd.dns_antwort(dns_frage("captive.apple.com", typ=28))
pruefe(r6 is not None, "AAAA bekommt eine Antwort (kein Schweigen -> kein Warten)")
pruefe(r6 is not None and struct.unpack("!H", r6[6:8])[0] == 0,
       "  ... aber eine LEERE — eine IPv4 als AAAA waere Unsinn")

for paket, was in [
    (b"", "leer"),
    (b"\x00" * 8, "zu kurz"),
    (b"\xab\xcd" + struct.pack("!HHHHH", 0x8180, 1, 1, 0, 0), "ist schon eine Antwort"),
    (b"\xab\xcd" + struct.pack("!HHHHH", 0x0100, 2, 0, 0, 0) + b"\x00", "zwei Fragen"),
    (b"\xab\xcd" + struct.pack("!HHHHH", 0x0100, 1, 0, 0, 0) + b"\xc0\x0c",
     "Zeiger in der Frage"),
]:
    pruefe(kd.dns_antwort(paket) is None, f"  verworfen: {was}")

print("\n── 5. Der DNS-Dienst an einem echten Socket")
# Die reinen Teile koennen stimmen und der Dienst trotzdem nie antworten.
bereit = threading.Event()
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("127.0.0.1", 0))
port = s.getsockname()[1]
s.close()
threading.Thread(target=kd.dns_dienst,
                 kwargs={"adresse": kd.ADRESSE, "laufzeit": 3, "port": port,
                         "binden": "127.0.0.1", "bereit": bereit},
                 daemon=True).start()
pruefe(bereit.wait(3), "der Dienst kommt hoch")
k = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
k.settimeout(2.0)
try:
    k.sendto(dns_frage("connectivitycheck.gstatic.com"), ("127.0.0.1", port))
    antw, _ = k.recvfrom(512)
    pruefe(antw[-4:] == kd.ip_zu_bytes(kd.ADRESSE),
           "eine echte Frage ueber den Socket wird mit der Box beantwortet")
except socket.timeout:
    pruefe(False, "eine echte Frage ueber den Socket wird beantwortet", "Zeitablauf")
finally:
    k.close()

print("\n── 6. Der AP ohne hostapd (wpa_supplicant mode=2)")
spec2 = importlib.util.spec_from_file_location(
    "eap", os.path.join(REPO, "tools", "einrichtung-ap.py"))
ap = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(ap)

conf = ap.wpa_ap_conf("MixPiBox-Einrichtung", "quax7fam")
pruefe("mode=2" in conf, "mode=2 — wpa_supplicant macht selbst ein Netz auf")
pruefe("ap_scan=2" in conf, "ap_scan=2 — sonst sucht es erst nach fremden Netzen")
# DIESELBE HAERTE WIE BEI HOSTAPD. Fehlt proto=RSN, ist WPA1 erlaubt; fehlt
# pairwise=CCMP, auch TKIP. Beides ist gebrochen — vor der Tuer eines Programms,
# das als root laeuft.
pruefe("proto=RSN" in conf, "WPA2 erzwungen (proto=RSN)")
pruefe("pairwise=CCMP" in conf and "group=CCMP" in conf, "CCMP erzwungen")
pruefe("TKIP" not in conf and "WPA-EAP" not in conf, "kein TKIP, kein WPA1")
pruefe('psk="quax7fam"' in conf, "das Passwort steht drin")
# Kanal 6 -> 2437 MHz. Eine falsche Frequenz heisst: das Netz erscheint nicht.
pruefe("frequency=2437" in conf, "Kanal 6 wird zur richtigen Frequenz (2437 MHz)")

pruefe(ap.weg_waehlen(lambda p: p in ("hostapd", "dnsmasq")) == "hostapd",
       "sind beide da, gewinnt hostapd")
pruefe(ap.weg_waehlen(lambda p: p == "wpa_supplicant") == "wpa",
       "fehlen sie, traegt wpa_supplicant — DAS war die ganze Luecke")
pruefe(ap.weg_waehlen(lambda p: p in ("hostapd", "wpa_supplicant")) == "wpa",
       "hostapd OHNE dnsmasq reicht nicht — dann lieber ganz den zweiten Weg")
pruefe(ap.weg_waehlen(lambda p: p == "hostapd") is None,
       "hostapd allein, ohne wpa_supplicant: gar kein Weg (dann kann die Box kein WLAN)")
pruefe(ap.weg_waehlen(lambda p: False) is None,
       "ohne alles: ehrlich nichts versprechen")

print("\n── 7. Wer den Rueckfall AUSLOEST (sonst liegt er nur bereit)")
# Der Wachposten ist das Glied, ohne das alles andere nutzlos ist: jemand
# muesste den AP sonst von Hand starten — auf einer Box, die man gerade nicht
# erreicht. Genau dieser Zirkel wird hier aufgeloest.
protokoll = []
pruefe(ap.wenn_kein_netz(warten=1, takt=0.1,
                         pruefer=lambda: "2: eth0 inet 192.168.1.5/24",
                         schlafen=protokoll.append) == 0,
       "ist ein Netz da, passiert GAR NICHTS")
pruefe(protokoll == [], "  und es wird nicht einmal gewartet")

# Ohne Netz muss er `starten()` rufen. Das echte `starten` fasst den Funk an —
# hier wird es ersetzt, denn ein Test darf nicht das WLAN dieses Rechners
# abschalten (dieselbe Regel wie beim WPS-Test).
gerufen = []
echtes = ap.starten
ap.starten = lambda ssid=ap.SSID_VORGABE: (gerufen.append(ssid), 0)[1]
try:
    r = ap.wenn_kein_netz(warten=0.3, takt=0.1, pruefer=lambda: "",
                          schlafen=lambda s: None)
    pruefe(r == 0 and len(gerufen) == 1,
           "ohne Netz wird das eigene WLAN aufgemacht", f"gerufen={gerufen}")
    pruefe(gerufen and gerufen[0] == ap.SSID_VORGABE,
           f"  mit dem erwarteten Namen ({ap.SSID_VORGABE})")
finally:
    ap.starten = echtes

pruefe(ap.hat_netz(lambda: "") is False, "leere Adressliste = kein Netz")
pruefe(ap.hat_netz(lambda: "   \n") is False, "  auch nur Leerzeichen")
pruefe(ap.hat_netz(lambda: "2: wlan0 inet 10.0.0.7/24") is True,
       "eine globale Adresse = Netz")

# Die Unit muss es auch wirklich aufrufen — sonst ist der Wachposten Code,
# den niemand startet.
unit = open(os.path.join(REPO, "tools", "mixpibox-einrichtung-ap.service"),
            encoding="utf-8").read()
pruefe("wenn-kein-netz" in unit, "die Unit ruft den Wachposten auf")
# NUR DIE DIREKTIVEN ansehen, nicht den Fliesstext: der Kommentar ERKLAERT ja
# gerade, warum nicht auf network-online gewartet wird. Die erste Fassung
# dieses Tests las die ganze Datei und schlug an der Begruendung an.
direktiven = [z.strip() for z in unit.splitlines()
              if z.strip() and not z.strip().startswith("#")]
wartet = [z for z in direktiven
          if z.startswith(("After=", "Wants=", "Requires=")) and "network-online" in z]
pruefe(not wartet,
       "sie wartet NICHT auf network-online — das ist ja gerade der Fall, der ausbleibt",
       str(wartet))

print()
print(f"{ok} in Ordnung, {bad} gebrochen")
sys.exit(1 if bad else 0)
