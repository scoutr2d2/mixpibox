#!/usr/bin/env python3
"""DHCP und DNS fuer das Einrichtungs-WLAN — in reiner Standardbibliothek.

WOZU DAS UEBERHAUPT GEBAUT WIRD, statt `dnsmasq` zu nehmen:

Der Rueckfall ohne Kabel ist genau fuer die Lage gedacht, in der die Box NICHT
ins Netz kommt. `dnsmasq` ist auf dem DietPi-Image nicht drauf — und ohne Netz
auch nicht nachzuinstallieren. Ein Werkzeug, das man nur mit Internet
einrichten kann, hilft ausgerechnet dann nicht, wenn man es braucht. Dasselbe
Huehnerei-Problem wie bei `hostapd`, siehe llmwiki `einrichtung-ap-und-captive-portal`.

Also: kein Paket. DHCP und DNS sind fuer diesen einen Zweck klein genug, um
sie selbst zu sprechen — dieselbe Ueberlegung wie bei `qr.py`.

WAS ES KANN, UND NUR DAS:
  * DHCP: eine Adresse aus einem kleinen Bereich, Maske, Router, DNS. Kein
    Speicher ueber Neustarts, keine festen Zuordnungen, keine Optionen fuer
    Netzstart. Ein Handy, das sich fuer zehn Minuten verbindet, braucht nichts
    davon.
  * DNS: JEDER Name wird mit der Adresse der Box beantwortet. Das ist keine
    Nachlaessigkeit, sondern der Kern des Captive Portals — das Handy prueft
    nach dem Verbinden eine feste Adresse, bekommt die Box zu sehen und oeffnet
    von selbst die Einrichtungsseite.

WAS ES NICHT KANN, MIT ABSICHT:
  * Keine Weiterleitung ins Internet. Wer sich verbindet, erreicht die Box —
    sonst nichts.
  * Kein IPv6, kein DHCPv6. Das Einrichtungsnetz ist IPv4, und zwar allein.
  * Keine Wiederverwendung abgelaufener Adressen ueber einen Neustart hinweg.
    Der Dienst lebt so lange wie die Einrichtung.

AUFRUF
    sudo python3 tools/kleiner-dhcp.py --schnittstelle wlan0
    python3 tools/kleiner-dhcp.py --selbsttest      # ohne Netz, nur die Pakete
"""
import argparse
import os
import socket
import struct
import sys
import time

ADRESSE = "192.168.4.1"
MASKE = "255.255.255.0"
VON = "192.168.4.10"
BIS = "192.168.4.50"
MIETDAUER = 600            # Sekunden. Kurz: die Einrichtung dauert Minuten.

DHCP_SERVER_PORT = 67
DHCP_CLIENT_PORT = 68
DNS_PORT = 53

# DHCP-Nachrichtenarten (Option 53)
ENTDECKEN, ANGEBOT, ANFRAGE, ABLEHNUNG, BESTAETIGUNG, NEIN, FREIGABE = 1, 2, 3, 4, 5, 6, 7
KEKS = 0x63825363          # magic cookie, steht vor jeder Optionsliste


def ip_zu_bytes(s):
    return bytes(int(t) for t in s.split("."))


def bytes_zu_ip(b):
    return ".".join(str(x) for x in b)


# ── DHCP: lesen ─────────────────────────────────────────────────────────────
def dhcp_lesen(paket):
    """Ein DHCP-Paket zerlegen -> dict oder None.

    STRENG, WEIL ES AUF EINEM OFFENEN PORT LIEGT: Was nicht passt, wird
    verworfen statt zurechtgebogen. Der Dienst laeuft als root, und in
    Funkreichweite steht, wer will.
    """
    if len(paket) < 240:                       # 236 Kopf + 4 Keks
        return None
    op, htype, hlen = paket[0], paket[1], paket[2]
    if op != 1 or htype != 1 or hlen != 6:     # nur Anfragen, nur Ethernet
        return None
    xid = struct.unpack("!I", paket[4:8])[0]
    flags = struct.unpack("!H", paket[10:12])[0]
    chaddr = paket[28:34]
    if struct.unpack("!I", paket[236:240])[0] != KEKS:
        return None

    optionen, i = {}, 240
    while i < len(paket):
        code = paket[i]
        if code == 255:                        # Ende
            break
        if code == 0:                          # Fuellbyte
            i += 1
            continue
        if i + 1 >= len(paket):
            return None
        laenge = paket[i + 1]
        wert = paket[i + 2:i + 2 + laenge]
        if len(wert) != laenge:                # abgeschnitten -> nicht raten
            return None
        optionen[code] = wert
        i += 2 + laenge

    art = optionen.get(53)
    if not art or len(art) != 1:
        return None
    return {"xid": xid, "mac": chaddr, "art": art[0], "optionen": optionen,
            "broadcast": bool(flags & 0x8000)}


# ── DHCP: antworten ─────────────────────────────────────────────────────────
def dhcp_antwort(anfrage, ihre_ip, art, server=ADRESSE, maske=MASKE,
                 mietdauer=MIETDAUER):
    """Ein OFFER oder ACK bauen. Pure — deshalb ohne Netz pruefbar."""
    p = bytearray(240)
    p[0] = 2                                   # BOOTREPLY
    p[1] = 1                                   # Ethernet
    p[2] = 6                                   # MAC-Laenge
    struct.pack_into("!I", p, 4, anfrage["xid"])
    # yiaddr — die Adresse, die das Geraet bekommt
    p[16:20] = ip_zu_bytes(ihre_ip)
    p[20:24] = ip_zu_bytes(server)             # siaddr
    p[28:34] = anfrage["mac"]
    struct.pack_into("!I", p, 236, KEKS)

    def opt(code, wert):
        p.extend(bytes([code, len(wert)]))
        p.extend(wert)

    opt(53, bytes([art]))
    opt(54, ip_zu_bytes(server))               # wer antwortet
    opt(51, struct.pack("!I", mietdauer))
    opt(1, ip_zu_bytes(maske))
    opt(3, ip_zu_bytes(server))                # Router = die Box
    opt(6, ip_zu_bytes(server))               # DNS = die Box (das Portal!)
    p.append(255)
    return bytes(p)


class Adressbuch:
    """Wer hat welche Adresse? Nur im Arbeitsspeicher.

    DIESELBE MAC BEKOMMT DIESELBE ADRESSE, solange der Dienst laeuft. Ein Handy
    schickt oft mehrere DISCOVER hintereinander; bekaeme es jedes Mal eine neue,
    waere der kleine Bereich nach ein paar Minuten leer.
    """

    def __init__(self, von=VON, bis=BIS):
        self.von, self.bis = ip_zu_bytes(von)[3], ip_zu_bytes(bis)[3]
        self.netz = ".".join(von.split(".")[:3])
        self.vergeben = {}                     # mac -> (ip, zeit)

    def hole(self, mac, jetzt=None):
        jetzt = time.time() if jetzt is None else jetzt
        if mac in self.vergeben:
            ip, _ = self.vergeben[mac]
            self.vergeben[mac] = (ip, jetzt)
            return ip
        benutzt = {ip for ip, _ in self.vergeben.values()}
        for n in range(self.von, self.bis + 1):
            ip = f"{self.netz}.{n}"
            if ip not in benutzt:
                self.vergeben[mac] = (ip, jetzt)
                return ip
        # Voll: die aelteste Miete verfaellt. Bei 41 Adressen und einem Handy
        # ist das ein theoretischer Fall — aber "gar keine Antwort" waere der
        # schlechteste Ausgang.
        aeltester = min(self.vergeben.items(), key=lambda kv: kv[1][1])
        ip = aeltester[1][0]
        del self.vergeben[aeltester[0]]
        self.vergeben[mac] = (ip, jetzt)
        return ip


# ── DNS: jeder Name zeigt auf die Box ───────────────────────────────────────
def dns_antwort(anfrage, adresse=ADRESSE, ttl=60):
    """Auf JEDE A-Frage mit der Adresse der Box antworten -> bytes oder None.

    DER TRICK DES PORTALS steckt genau hier: Android fragt
    connectivitycheck.gstatic.com, iOS captive.apple.com. Beide bekommen die
    Box — und weil deren Antwort nicht die erwartete ist, oeffnen die Geraete
    von selbst die Seite.
    """
    if len(anfrage) < 12:
        return None
    kennung = anfrage[:2]
    flags = struct.unpack("!H", anfrage[2:4])[0]
    if flags & 0x8000:                         # schon eine Antwort
        return None
    fragen = struct.unpack("!H", anfrage[4:6])[0]
    if fragen != 1:                            # genau eine Frage, sonst nichts
        return None

    # Den Namen ueberspringen: Folge von Laengen-Bytes, mit 0 am Ende.
    i = 12
    while i < len(anfrage):
        laenge = anfrage[i]
        if laenge == 0:
            i += 1
            break
        if laenge >= 0xC0:                     # Zeiger gehoeren nicht in eine Frage
            return None
        i += laenge + 1
    else:
        return None
    if i + 4 > len(anfrage):
        return None
    typ, klasse = struct.unpack("!HH", anfrage[i:i + 4])
    i += 4
    # Nur A/IN beantworten. Ein AAAA bekommt eine LEERE Antwort statt einer
    # falschen — sonst versucht das Handy es ueber IPv6 und wartet ins Leere.
    leer = typ != 1 or klasse != 1

    kopf = kennung + struct.pack("!HHHHH", 0x8180, 1, 0 if leer else 1, 0, 0)
    frage = anfrage[12:i]
    if leer:
        return kopf + frage
    antwort = (b"\xc0\x0c"                     # Zeiger auf den Namen in der Frage
               + struct.pack("!HHIH", 1, 1, ttl, 4)
               + ip_zu_bytes(adresse))
    return kopf + frage + antwort


# ── Die Dienste ─────────────────────────────────────────────────────────────
def dhcp_dienst(schnittstelle, adresse=ADRESSE, laufzeit=None, buch=None):
    buch = buch or Adressbuch()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    # AN DIE SCHNITTSTELLE BINDEN, nicht an die Adresse: das erste DISCOVER
    # kommt als Broadcast an 255.255.255.255 — ein Socket auf 192.168.4.1
    # bekaeme es nie zu sehen.
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE,
                     schnittstelle.encode())
    except (OSError, AttributeError):
        pass                                   # nicht Linux/kein Recht: weiter
    s.bind(("", DHCP_SERVER_PORT))
    ende = None if laufzeit is None else time.time() + laufzeit
    while ende is None or time.time() < ende:
        s.settimeout(2.0)
        try:
            paket, _ = s.recvfrom(2048)
        except socket.timeout:
            continue
        except OSError:
            break
        a = dhcp_lesen(paket)
        if not a:
            continue
        if a["art"] == ENTDECKEN:
            art = ANGEBOT
        elif a["art"] == ANFRAGE:
            art = BESTAETIGUNG
        else:
            continue                           # RELEASE/DECLINE: nichts zu tun
        ihre = buch.hole(a["mac"])
        # Immer als Broadcast zurueck: das Geraet hat noch keine Adresse und
        # kann ein gerichtetes Paket nicht annehmen.
        s.sendto(dhcp_antwort(a, ihre, art, server=adresse),
                 ("255.255.255.255", DHCP_CLIENT_PORT))
    s.close()


def dns_dienst(adresse=ADRESSE, laufzeit=None, port=DNS_PORT, binden=None,
               bereit=None):
    """`binden` und `port` gibt es fuer die Tests: Port 53 braucht root, und
    ein Test, der root verlangt, wird nicht gelaufen. `bereit` ist ein Ereignis,
    das gesetzt wird, sobald der Socket steht — sonst schickt der Test seine
    Frage los, bevor jemand zuhoert, und das Ergebnis haengt am Zufall."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((binden if binden is not None else adresse, port))
    if bereit is not None:
        bereit.set()
    ende = None if laufzeit is None else time.time() + laufzeit
    while ende is None or time.time() < ende:
        s.settimeout(2.0)
        try:
            paket, woher = s.recvfrom(1024)
        except socket.timeout:
            continue
        except OSError:
            break
        antwort = dns_antwort(paket, adresse)
        if antwort:
            try:
                s.sendto(antwort, woher)
            except OSError:
                pass
    s.close()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--schnittstelle", default="wlan0")
    p.add_argument("--adresse", default=ADRESSE)
    p.add_argument("--nur", choices=("dhcp", "dns"), help="nur einen der beiden")
    p.add_argument("--laufzeit", type=float, help="Sekunden, dann Schluss")
    a = p.parse_args()

    if a.nur == "dhcp":
        return dhcp_dienst(a.schnittstelle, a.adresse, a.laufzeit) or 0
    if a.nur == "dns":
        return dns_dienst(a.adresse, a.laufzeit) or 0

    # Beide: DNS in einen Faden, DHCP in den Hauptfaden. Zwei Prozesse waeren
    # zwei Dinge zum Aufraeumen; hier reicht einer.
    import threading
    threading.Thread(target=dns_dienst, args=(a.adresse, a.laufzeit),
                     daemon=True).start()
    dhcp_dienst(a.schnittstelle, a.adresse, a.laufzeit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
