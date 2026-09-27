#!/usr/bin/env python3
"""Den Eingang des MuPiHAT von Hand festlegen, statt ihn raten zu lassen.

WOFUER
------
Der Laderegler BQ25792 stuft sein Netzteil ueber die **D+/D--Erkennung**
(BC1.2) ein. Ein USB-C-Netzteil, das seine Leistung ueber die **CC-Leitungen**
anbietet - also jedes moderne Laptop-Netzteil - hat an D+/D- NICHTS zu bieten.
Der Regler findet nichts, stuft es als "nicht anerkannt" ein und faellt auf
**500 mA** zurueck. Das reicht dem Pi 5 nicht, der Eingang bricht zusammen,
der Regler erkennt neu, faellt wieder zurueck - und genau dieser Takt ist das
Blinken der Versorgungs-LED.

Am Geraet gemessen (2026-07-29): VBUS 5042 -> 1379 -> 5044 mV im
15-Sekunden-Takt, dabei durchgehend Akkubetrieb.

DER AUSWEG hat zwei Schalter, beide im Regler:

  1. AUTO_INDET_EN (REG 0x11, Bit 6) auf 0  -> die Erkennung hoert auf,
     staendig neu zu raten.
  2. IINDPM (REG 0x06/0x07, in 10-mA-Schritten) von Hand setzen -> der Regler
     darf so viel ziehen, wie das Netzteil wirklich kann.

WARUM DAS SICHER GENUG IST: **VINDPM** (REG 0x05) bleibt unangetastet. Diese
Schwelle - am Geraet 4,3 V - ist der eigentliche Schutz: sackt der Eingang
darunter, nimmt der Regler von selbst Strom zurueck, statt die Quelle
zusammenbrechen zu lassen. Ein zu hoch gesetztes Limit macht deshalb keinen
Schaden, es wird schlicht nicht erreicht.

GRENZEN, die dieses Werkzeug einhaelt
-------------------------------------
Das Datenblatt (Ver. 2.4, S. 15): "The Input Current is limited to **2.2A**.
This limit is defined by hardware configuration in order to operate the HAT
safely without additional heat sink." Deshalb ist hier bei **2000 mA**
Schluss - mit Abstand zur Hardwaregrenze. Und weiter: "It is possible to
overwrite the input current limit by SW (**use without guarantee**)."

WAS NICHT BLEIBT: der Regler setzt IINDPM zurueck, sobald ein Netzteil neu
gesteckt wird (VINDPM faellt dabei laut Treiber auf 3600 mV). Wer es dauerhaft
will, muss es nach jedem Steckereignis neu setzen - dafuer gibt es
`--ueberwachen`.

AUFRUF
------
    mupihat-eingang.py                      # nur zeigen
    mupihat-eingang.py --setzen 1500        # 1500 mA erzwingen, Erkennung aus
    mupihat-eingang.py --zuruecksetzen      # Auslieferungsverhalten wieder her
    mupihat-eingang.py --ueberwachen 1500   # gesetzt halten, auch nach Umstecken

Lesen und Schreiben laufen ueber `i2cget`/`i2cset`; der aufrufende Benutzer
muss in der Gruppe `i2c` sein (oder das Ganze als root laufen).
"""

import argparse
import subprocess
import sys
import time

BUS = "1"
ADR = "0x6b"

REG_VINDPM = 0x05
REG_IINDPM_HI = 0x06
REG_IINDPM_LO = 0x07
REG_CTRL2 = 0x11  # FORCE_INDET (Bit 7), AUTO_INDET_EN (Bit 6)

# Die Hardware der Platine ist auf 2,2 A ausgelegt (Datenblatt S. 15, Betrieb
# OHNE Kuehlkoerper). Mit Abstand darunter bleiben.
MAX_MA = 2000
MIN_MA = 100


def _werkzeug(name):
    for pfad in (f"/usr/sbin/{name}", f"/usr/bin/{name}", name):
        try:
            subprocess.run([pfad, "-V"], capture_output=True, timeout=5)
            return pfad
        except FileNotFoundError:
            continue
    raise SystemExit(f"{name} nicht gefunden - Paket i2c-tools installieren")


I2CGET = None
I2CSET = None


def lies(reg):
    p = subprocess.run([I2CGET, "-y", BUS, ADR, hex(reg)], capture_output=True, text=True, timeout=5)
    if p.returncode != 0:
        raise SystemExit(f"Lesen von {hex(reg)} fehlgeschlagen: {p.stderr.strip()}")
    return int(p.stdout.strip(), 16)


def schreib(reg, wert):
    p = subprocess.run(
        [I2CSET, "-y", BUS, ADR, hex(reg), hex(wert)], capture_output=True, text=True, timeout=5
    )
    if p.returncode != 0:
        raise SystemExit(f"Schreiben von {hex(reg)} fehlgeschlagen: {p.stderr.strip()}")


def stand():
    hi, lo = lies(REG_IINDPM_HI), lies(REG_IINDPM_LO)
    c = lies(REG_CTRL2)
    return {
        "iindpm": ((hi << 8) | lo) * 10,
        "vindpm": lies(REG_VINDPM) * 100,
        "autoErkennung": bool((c >> 6) & 1),
        "ctrl2": c,
    }


def zeigen():
    s = stand()
    print(f"  Eingangsstrom-Grenze  {s['iindpm']} mA")
    print(f"  Eingangsspannungs-Grenze  {s['vindpm']} mV   (Schutz - bleibt unangetastet)")
    print(f"  Automatische Erkennung  {'an' if s['autoErkennung'] else 'AUS (von Hand gesetzt)'}")
    if s["iindpm"] <= 500 and s["autoErkennung"]:
        print()
        print("  Nur 500 mA bei laufender Erkennung: das ist der Rueckfallwert fuer einen")
        print("  einfachen USB-Anschluss. Ein USB-C-Netzteil, das seine Leistung ueber die")
        print("  CC-Leitungen anbietet, wird so NIE erkannt. Abhilfe: --setzen 1500")
    return s


def setzen(ma):
    if not MIN_MA <= ma <= MAX_MA:
        raise SystemExit(f"Nur {MIN_MA}..{MAX_MA} mA erlaubt (Hardwaregrenze der Platine: 2,2 A)")
    schritte = ma // 10
    # ERST die Erkennung abschalten, DANN das Limit setzen: andersherum kann
    # eine gerade laufende Erkennung den frisch gesetzten Wert sofort wieder
    # ueberschreiben.
    c = lies(REG_CTRL2)
    schreib(REG_CTRL2, c & ~(1 << 6))
    schreib(REG_IINDPM_HI, (schritte >> 8) & 0xFF)
    schreib(REG_IINDPM_LO, schritte & 0xFF)
    ist = stand()
    print(f"  gesetzt: {ist['iindpm']} mA, Erkennung {'an' if ist['autoErkennung'] else 'aus'}")
    if ist["iindpm"] != ma:
        print(f"  ACHTUNG: gelesen wurden {ist['iindpm']} mA statt {ma} - der Regler hat korrigiert.")
    return ist


def zuruecksetzen():
    # AUTO_INDET_EN wieder an; das Limit setzt der Regler bei der naechsten
    # Erkennung selbst. FORCE_INDET stoesst eine solche gleich an.
    c = lies(REG_CTRL2)
    schreib(REG_CTRL2, (c | (1 << 6) | (1 << 7)))
    time.sleep(1)
    print("  Auslieferungsverhalten wiederhergestellt, Erkennung neu angestossen")
    return zeigen()


def ueberwachen(ma, takt=20):
    """Gesetzt halten - der Regler vergisst es beim Umstecken.

    Bewusst genuegsam: alle `takt` Sekunden nachsehen und NUR bei Abweichung
    schreiben. Ein staendiges Schreiben belastet den I2C-Bus, den sich das
    Werkzeug mit dem HAT-Dienst teilt.
    """
    print(f"  halte {ma} mA (alle {takt} s pruefen, Abbruch mit Strg-C)")
    setzen(ma)
    try:
        while True:
            time.sleep(takt)
            s = stand()
            if s["iindpm"] != ma or s["autoErkennung"]:
                print(f"  {time.strftime('%H:%M:%S')} zurueckgefallen auf {s['iindpm']} mA - setze neu")
                setzen(ma)
    except KeyboardInterrupt:
        print("\n  beendet (der gesetzte Wert bleibt bis zum naechsten Umstecken)")


def pruefen(strom=1000, json_pfad="/tmp/mupihat.json"):
    """Netzteil und Kabel OBJEKTIV messen, statt zu raten.

    Der Trick: eine DEFINIERTE Last anfordern und sehen, wie weit die Spannung
    einbricht. Aus Einbruch durch Strom folgt der Innenwiderstand von Quelle
    UND Kabel zusammen - und der entscheidet, ob die Box laden kann.

    Am 2026-07-29 hat genau diese Messung den Streitfall entschieden: ein
    Netzteil, an dem ein Laptop "problemlos laedt", brach bei 1426 mA von
    5044 auf 3979 mV ein. Das sind 0,75 Ohm. Ein Laptop laedt naemlich ueber
    einen ausgehandelten PD-Vertrag bei 20 V - was nichts darueber sagt, ob
    dieselbe Quelle bei 5 V anderthalb Ampere liefern kann.

    RICHTWERTE (Quelle + Kabel zusammen):
        unter 0,15 Ohm   gut - traegt den vollen Ladestrom
        bis   0,35 Ohm   grenzwertig - laedt, aber langsam
        darueber          reicht nicht; die Box wird trotz Netzteil leer
    """
    import json as _json

    def vbus():
        try:
            with open(json_pfad, encoding="utf-8") as f:
                d = _json.load(f)
            return int(d.get("Vbus", 0)), int(d.get("IBus", 0))
        except Exception:
            return 0, 0

    vorher = stand()
    leer, _ = vbus()
    if leer < 4000:
        print(f"  Kein brauchbarer Eingang (VBUS {leer} mV) - Netzteil anstecken.")
        return None
    print(f"  Leerlaufspannung {leer} mV, fordere kurz {strom} mA an ...")
    try:
        setzen(strom)
        # Ein paar Sekunden, bis der Regler wirklich zieht und der Treiber
        # den neuen Wert in die Datei geschrieben hat.
        beste = (0, 0)
        for _ in range(8):
            time.sleep(1.5)
            v, i = vbus()
            if i > beste[1]:
                beste = (v, i)
        v, i = beste
    finally:
        # IMMER zurueckstellen, auch wenn zwischendrin etwas schiefgeht -
        # sonst bliebe die Box mit abgeschalteter Erkennung stehen.
        zuruecksetzen()

    if i < 100:
        print(f"  Es floss fast nichts ({i} mA) - die Quelle gibt bei 5 V nichts her.")
        print("  Typisch fuer ein reines PD-Netzteil: es liefert erst nach einem")
        print("  ausgehandelten Vertrag, und den handelt der Laderegler bei 5 V nicht aus.")
        return {"leerMv": leer, "lastMv": v, "stromMa": i, "ohm": None}

    ohm = (leer - v) / i
    print(f"  unter {i} mA Last: {v} mV  ->  Einbruch {leer - v} mV")
    print(f"  Innenwiderstand von Quelle + Kabel: {ohm:.2f} Ohm")
    if ohm < 0.15:
        print("  GUT - traegt den vollen Ladestrom.")
    elif ohm < 0.35:
        print("  GRENZWERTIG - laedt, aber langsam. Kuerzeres/dickeres Kabel hilft.")
    else:
        print("  REICHT NICHT - die Box wird trotz angestecktem Netzteil leer.")
        print("  Ein gutes USB-C-Kabel liegt unter 0,10 Ohm; der Rest ist die Quelle.")
    return {"leerMv": leer, "lastMv": v, "stromMa": i, "ohm": round(ohm, 3)}


def main():
    global I2CGET, I2CSET
    ap = argparse.ArgumentParser(description="Eingangsgrenze des MuPiHAT von Hand setzen")
    ap.add_argument("--setzen", type=int, metavar="mA", help=f"Eingangsstrom-Grenze ({MIN_MA}..{MAX_MA})")
    ap.add_argument("--zuruecksetzen", action="store_true", help="automatische Erkennung wieder an")
    ap.add_argument("--ueberwachen", type=int, metavar="mA", help="gesetzt halten, auch nach Umstecken")
    ap.add_argument("--pruefen", action="store_true", help="Netzteil + Kabel messen (Innenwiderstand)")
    a = ap.parse_args()

    I2CGET = _werkzeug("i2cget")
    I2CSET = _werkzeug("i2cset")

    if a.pruefen:
        pruefen()
    elif a.zuruecksetzen:
        zuruecksetzen()
    elif a.ueberwachen:
        ueberwachen(a.ueberwachen)
    elif a.setzen:
        setzen(a.setzen)
    else:
        zeigen()
    return 0


if __name__ == "__main__":
    sys.exit(main())
