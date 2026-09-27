#!/usr/bin/env python3
"""DEN ECHTEN SCHIRM DER BOX ABFOTOGRAFIEREN — ueber x11vnc, rein lesend.

WOZU: Jede Messung an dieser Oberflaeche lief bisher in einem Browser auf dem
ENTWICKLUNGSRECHNER. Das ist genau die Luecke, aus der der teuerste Fehler
dieses Projekts kam — der Betreiber am 07.08.2026: „kann es sein das auf der
box die icons im menü nicht dargestellt werden wie im browser hier ich sehe
nur rechtecke". 31 von 46 Zeichen waren auf dem Geraet leere Rechtecke, weil
dort KEINE Emoji-Schrift liegt; auf dem Arbeitsplatz war davon nichts zu
sehen. Kein Test war rot. 43 gruene Aussagen und ein zufriedener Bericht.

`/dev/fb0` HILFT NICHT: der Kiosk laeuft unter X (startx/xinit), und X auf dem
Pi 5 schreibt nicht in den alten Bildspeicher. Was dort steht, ist das letzte
Bild des Startbildschirms — nuetzlich, um den Splash zu pruefen, aber es ist
NICHT der laufende Schirm. Wer fb0 fuer den Schirm haelt, misst einen
Standbildschirm von vor Stunden und haelt ihn fuer die Gegenwart.

Auf der Box laeuft x11vnc (Port 5900). Dieses Werkzeug spricht so viel
RFB-Protokoll, wie noetig ist, um EIN Bild zu holen:

    python3 tools/box-schirm-foto.py --ziel bilder/jetzt.png

ES SENDET NIE EINE EINGABE. Kein Zeiger, keine Taste, kein Ausschnitt-Befehl.
Die Box gehoert einem Kind und wird benutzt, waehrend hier gemessen wird; ein
Werkzeug, das „nur mal eben" klickt, spielt ihm in die Hand. Der einzige
Schreibvorgang in Richtung Box sind die Protokollschritte, die der Server
verlangt, um ueberhaupt ein Bild zu liefern (Version, SetEncodings,
FramebufferUpdateRequest).

RAW UND SONST NICHTS: In `SetEncodings` steht ausschliesslich 0 (Raw). Ein
Server darf jede Kodierung waehlen, die der Client anbietet — bietet man
mehrere an, muss man auch mehrere entpacken koennen. 800x480 sind roh 1,5 MB
ueber ein Heimnetz, also unter einer Sekunde. Die Ersparnis waere den zweiten
Dekoder nicht wert.

DIE X-FLAECHE IST GROESSER ALS DER SCHIRM. Gemessen am 07.08.2026: x11vnc
meldet 800x5760 — zwoelfmal die Hoehe des Panels. Der Pi legt sich unter KMS
eine hohe virtuelle Flaeche an; sichtbar ist davon nur der Ausschnitt links
oben. Alles darunter ist gleichmaessig schwarz (nachgemessen: Mittelwert 0,0
in allen elf Baendern darunter).

Deshalb schneidet das Werkzeug auf `--ausschnitt` zu, Vorgabe 800x480+0+0 —
die Groesse des Waveshare-Panels. NICHT automatisch nach „wo hoert das
Schwarze auf" gesucht: ein Schirm, der wirklich schwarz ist (Bildschirm aus,
Helligkeit unten, abgestuerzter Kiosk), waere genau der Fall, den man
fotografieren will — und eine Automatik lieferte dann ein Bild von 0 Pixeln
Hoehe statt der Antwort „der Schirm ist schwarz". Mit `--ganz` bekommt man
die volle Flaeche, wenn man dem Ausschnitt nicht traut.
"""

from __future__ import annotations

import argparse
import socket
import struct
import sys

BOX_VORGABE = "192.168.178.169"
PORT_VORGABE = 5900


class RfbFehler(RuntimeError):
    pass


def _genau(sock: socket.socket, anzahl: int) -> bytes:
    """GENAU `anzahl` Bytes lesen — `recv` darf jederzeit weniger liefern.

    Ein `recv(n)`, dessen Rueckgabe man fuer vollstaendig haelt, ist der
    klassische stille Fehler bei Bildgroessen: bei 1,5 MB kommt die Antwort
    fast immer in Stuecken, und ein zu kurzer Puffer ergibt ein Bild, das
    nach unten hin in Muell ausfranst — es sieht aus wie ein Grafikfehler
    der Box.
    """
    teile = []
    offen = anzahl
    while offen > 0:
        stueck = sock.recv(min(offen, 1 << 16))
        if not stueck:
            raise RfbFehler(f"Verbindung endete nach {anzahl - offen} von {anzahl} Bytes")
        teile.append(stueck)
        offen -= len(stueck)
    return b"".join(teile)


def _handschlag(sock: socket.socket) -> tuple[int, int, dict]:
    kopf = _genau(sock, 12)
    if not kopf.startswith(b"RFB "):
        raise RfbFehler(f"Das ist kein VNC-Server (Gruss: {kopf!r})")
    # Wir antworten mit 3.8 und nicht mit dem, was der Server sagt: 3.8 ist
    # die einzige Fassung, in der der Server nach einem Fehlschlag einen
    # LESBAREN Grund mitschickt. Bei 3.3 kaeme nur eine Zahl.
    sock.sendall(b"RFB 003.008\n")

    anzahl = _genau(sock, 1)[0]
    if anzahl == 0:
        grund_laenge = struct.unpack(">I", _genau(sock, 4))[0]
        grund = _genau(sock, grund_laenge).decode("utf-8", "replace")
        raise RfbFehler(f"Server lehnt ab: {grund}")
    arten = set(_genau(sock, anzahl))
    if 1 not in arten:
        # 2 = VNC-Passwort. Absichtlich NICHT eingebaut: dann muesste hier ein
        # Passwort stehen oder aus einer Datei kommen, und ein Messwerkzeug
        # ist der falsche Ort, um Zugangsdaten zu verwahren.
        raise RfbFehler(
            f"Server verlangt Anmeldung (Arten: {sorted(arten)}). "
            "Dieses Werkzeug spricht nur den Fall ohne Passwort."
        )
    sock.sendall(bytes([1]))
    stand = struct.unpack(">I", _genau(sock, 4))[0]
    if stand != 0:
        grund_laenge = struct.unpack(">I", _genau(sock, 4))[0]
        grund = _genau(sock, grund_laenge).decode("utf-8", "replace")
        raise RfbFehler(f"Anmeldung abgelehnt: {grund}")

    # 1 = geteilt. Mit 0 wuerde der Server ALLE ANDEREN Sitzungen trennen —
    # auf einem Geraet, an dem gerade jemand sitzt, waere das ein Eingriff.
    sock.sendall(bytes([1]))

    breite, hoehe = struct.unpack(">HH", _genau(sock, 4))
    pf = _genau(sock, 16)
    namens_laenge = struct.unpack(">I", _genau(sock, 4))[0]
    _genau(sock, namens_laenge)

    bits, tiefe, gross_endig, echte_farbe = pf[0], pf[1], pf[2], pf[3]
    rot_max, gruen_max, blau_max = struct.unpack(">HHH", pf[4:10])
    rot_v, gruen_v, blau_v = pf[10], pf[11], pf[12]
    form = {
        "bits": bits,
        "tiefe": tiefe,
        "gross_endig": bool(gross_endig),
        "echte_farbe": bool(echte_farbe),
        "max": (rot_max, gruen_max, blau_max),
        "verschiebung": (rot_v, gruen_v, blau_v),
    }
    return breite, hoehe, form


def _bild_holen(sock: socket.socket, breite: int, hoehe: int, form: dict) -> bytes:
    sock.sendall(struct.pack(">BBHI", 2, 0, 1, 0))  # SetEncodings: nur Raw
    # incremental=0 heisst „das ganze Bild, nicht nur was sich geaendert hat".
    sock.sendall(struct.pack(">BBHHHH", 3, 0, 0, 0, breite, hoehe))

    while True:
        art = _genau(sock, 1)[0]
        if art != 0:
            # 1 SetColourMapEntries, 2 Bell, 3 ServerCutText — alle drei duerfen
            # jederzeit dazwischenkommen. Ueberspringen statt abbrechen.
            if art == 1:
                _genau(sock, 3)
                _, anzahl = struct.unpack(">HH", _genau(sock, 4))
                _genau(sock, anzahl * 6)
            elif art == 2:
                pass
            elif art == 3:
                _genau(sock, 3)
                laenge = struct.unpack(">I", _genau(sock, 4))[0]
                _genau(sock, laenge)
            else:
                raise RfbFehler(f"Unbekannte Nachricht vom Server: {art}")
            continue

        _genau(sock, 1)
        (anzahl,) = struct.unpack(">H", _genau(sock, 2))
        leinwand = bytearray(breite * hoehe * (form["bits"] // 8))
        pro_pixel = form["bits"] // 8
        for _ in range(anzahl):
            x, y, b, h, kodierung = struct.unpack(">HHHHi", _genau(sock, 12))
            if kodierung != 0:
                raise RfbFehler(f"Server schickte Kodierung {kodierung}, erwartet war Raw (0)")
            roh = _genau(sock, b * h * pro_pixel)
            for zeile in range(h):
                ziel = ((y + zeile) * breite + x) * pro_pixel
                quelle = zeile * b * pro_pixel
                leinwand[ziel : ziel + b * pro_pixel] = roh[quelle : quelle + b * pro_pixel]
        return bytes(leinwand)


def _ausschnitt_lesen(text: str) -> tuple[int, int, int, int]:
    """`800x480+0+0` zerlegen — dieselbe Schreibweise wie bei X-Werkzeugen."""
    try:
        masse, rest = text.split("+", 1)
        b, h = masse.split("x")
        x, y = rest.split("+")
        return int(b), int(h), int(x), int(y)
    except ValueError:
        raise RfbFehler(f"Ausschnitt nicht lesbar: {text!r} — erwartet wird BxH+X+Y")


def _als_bild(roh: bytes, breite: int, hoehe: int, form: dict):
    from PIL import Image

    pro_pixel = form["bits"] // 8
    if pro_pixel != 4 or not form["echte_farbe"]:
        raise RfbFehler(
            f"Diese Bildform kann das Werkzeug nicht: {form}. "
            "Erwartet werden 32 Bit mit echter Farbe (was x11vnc hier liefert)."
        )
    rv, gv, bv = form["verschiebung"]
    # Aus den Verschiebungen die Bytefolge ableiten, statt BGRA zu RATEN.
    # x11vnc liefert auf diesem Geraet BGRA; ein anderer Server oder eine
    # andere Farbtiefe kaeme mit vertauschten Kanaelen daher, und ein
    # blaustichiges Foto haelt man leicht fuer ein Thema-Problem.
    ordnung = {v // 8: n for v, n in ((rv, "R"), (gv, "G"), (bv, "B"))}
    kanaele = [ordnung.get(i, "X") for i in range(4)]
    if form["gross_endig"]:
        kanaele.reverse()
    im = Image.frombytes("RGBA", (breite, hoehe), roh)
    teile = dict(zip(kanaele, im.split()))
    return Image.merge("RGB", (teile["R"], teile["G"], teile["B"]))


def main() -> int:
    t = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    t.add_argument("--box", default=BOX_VORGABE)
    t.add_argument("--port", type=int, default=PORT_VORGABE)
    t.add_argument("--ziel", default="box-schirm.png")
    t.add_argument("--ausschnitt", default="800x480+0+0",
                   help="BxH+X+Y — Vorgabe ist das Waveshare-Panel dieser Box")
    t.add_argument("--ganz", action="store_true",
                   help="die volle X-Flaeche speichern, ohne Zuschnitt")
    t.add_argument("--zeitlimit", type=float, default=20.0, help="Sekunden je Lesevorgang")
    a = t.parse_args()

    try:
        with socket.create_connection((a.box, a.port), timeout=a.zeitlimit) as sock:
            sock.settimeout(a.zeitlimit)
            breite, hoehe, form = _handschlag(sock)
            roh = _bild_holen(sock, breite, hoehe, form)
    except (OSError, RfbFehler) as f:
        print(f"FEHLER: {f}", file=sys.stderr)
        return 1

    try:
        im = _als_bild(roh, breite, hoehe, form)
        if not a.ganz:
            b, h, x, y = _ausschnitt_lesen(a.ausschnitt)
            if x + b > breite or y + h > hoehe:
                # Lieber laut als ein stillschweigend kleineres Bild: wer den
                # Ausschnitt falsch angibt, soll es hier erfahren und nicht
                # spaeter beim Vergleich zweier Fotos verschiedener Groesse.
                raise RfbFehler(
                    f"Ausschnitt {a.ausschnitt} liegt nicht in der Flaeche {breite}x{hoehe}. "
                    "Mit --ganz gibt es das volle Bild."
                )
            im = im.crop((x, y, x + b, y + h))
        im.save(a.ziel)
    except RfbFehler as f:
        print(f"FEHLER: {f}", file=sys.stderr)
        return 1

    print(f"{a.ziel}  {im.size[0]}x{im.size[1]}  (X-Flaeche {breite}x{hoehe}, {form['bits']} Bit)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
