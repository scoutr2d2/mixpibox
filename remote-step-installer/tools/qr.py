#!/usr/bin/env python3
"""QR-Code erzeugen — reine Standardbibliothek, ohne pip.

WOZU: Beim ersten Start soll die Box auf ihrem eigenen Schirm einen QR-Code
zeigen, den ein Handy abfotografiert — damit entfaellt der Laptop, der heute
noch die WLAN-Zugangsdaten per `sdprep` auf die SD-Karte schreibt.

WARUM SELBST GESCHRIEBEN und nicht `qrencode` oder `python-qrcode`: Der Code
entsteht auf einer FRISCHEN DietPi, auf der es weder pip-Pakete noch
nachinstallierte Programme gibt — und im Zweifel noch kein Netz, um welche zu
holen. Genau dieselbe Regel gilt schon fuer den Agenten und die Boot-Animation
(`mupibox-boot-splash.py`): was beim ersten Start gebraucht wird, darf an
keinem nachzuladenden Paket haengen.

WAS ES KANN
  * Byte-Modus (also beliebiger Text/UTF-8), Fassungen 1 bis 10,
    Fehlerkorrektur-Stufe M. Das reicht mit Abstand: eine Adresse wie
    `http://192.168.178.169:8098/einrichtung` braucht Fassung 3, ein
    WLAN-Code `WIFI:S:...;T:WPA;P:...;;` selten mehr als 4.
  * Ausgabe als Matrix aus 0/1, als ASCII-Bild oder als PBM.

WAS ES NICHT KANN (und nicht koennen soll)
  * Keine anderen Modi (Ziffern, alphanumerisch) — sie waeren kompakter, aber
    der Byte-Modus deckt jeden Fall ab, und jeder zusaetzliche Modus ist Code,
    der falsch sein kann.
  * Keine Stufen L/Q/H. Eine Stufe weniger heisst eine Tabelle weniger, die
    stillschweigend danebenliegen kann. M ist der uebliche Kompromiss.
  * Fassung > 10. Wer so viel Text in einen QR-Code steckt, hat ein anderes
    Problem.

GEGENGEPRUEFT: `tools/qr_test.py` kodiert Texte verschiedener Laenge, schreibt
sie als PBM und laesst sie von `zbarimg` ZURUECKLESEN. Ein QR-Code, der
plausibel aussieht, aber falsch ist, faellt sonst niemandem auf — er wird ja
erst am Handy des Nutzers benutzt.

AUFRUF
    python3 tools/qr.py "http://192.168.178.169:8098/einrichtung"
    python3 tools/qr.py --pbm "text" > code.pbm
"""

# ── Tabellen aus der Norm ────────────────────────────────────────────────────
# Je Fassung (1..10) fuer Stufe M:
#   (Fehlerkorrektur-Woerter je Block, [(Anzahl Bloecke, Datenwoerter je Block), …])
BLOECKE_M = {
    1: (10, [(1, 16)]),
    2: (16, [(1, 28)]),
    3: (26, [(1, 44)]),
    4: (18, [(2, 32)]),
    5: (24, [(2, 43)]),
    6: (16, [(4, 27)]),
    7: (18, [(4, 31)]),
    8: (22, [(2, 38), (2, 39)]),
    9: (22, [(3, 36), (2, 37)]),
    10: (26, [(4, 43), (1, 44)]),
}

# Mittelpunkte der Ausrichtungsmuster je Fassung.
AUSRICHTUNG = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
}

# ── Rechnen im Galoiskoerper GF(256) ─────────────────────────────────────────
_EXP = [0] * 512
_LOG = [0] * 256


def _tabellen_bauen() -> None:
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D  # das Erzeugerpolynom der Norm
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]


_tabellen_bauen()


def _mal(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _generator(grad: int) -> list[int]:
    """Das Generatorpolynom fuer `grad` Fehlerkorrekturwoerter."""
    g = [1]
    for i in range(grad):
        neu = [0] * (len(g) + 1)
        for j, koeff in enumerate(g):
            neu[j] ^= _mal(koeff, 1)
            neu[j + 1] ^= _mal(koeff, _EXP[i])
        g = neu
    return g


def _fehlerkorrektur(daten: list[int], anzahl: int) -> list[int]:
    """Reed-Solomon: die Restwoerter zu einem Datenblock."""
    g = _generator(anzahl)
    rest = list(daten) + [0] * anzahl
    for i in range(len(daten)):
        f = rest[i]
        if f:
            for j, koeff in enumerate(g):
                rest[i + j] ^= _mal(koeff, f)
    return rest[len(daten) :]


# ── Daten in Bits ────────────────────────────────────────────────────────────
def _fassung_waehlen(laenge: int) -> int:
    for v in range(1, 11):
        ec, gruppen = BLOECKE_M[v]
        datenwoerter = sum(n * k for n, k in gruppen)
        # Modusanzeige (4 Bit) + Laengenfeld + Nutzdaten
        laengenbits = 8 if v < 10 else 16
        noetig = 4 + laengenbits + laenge * 8
        if noetig <= datenwoerter * 8:
            return v
    raise ValueError(
        f"{laenge} Bytes passen nicht in Fassung 1-10 (Stufe M). "
        "Dieses Modul deckt bewusst nur den Bereich ab, der fuer Adressen und "
        "WLAN-Codes gebraucht wird."
    )


def _datenwoerter(text: bytes, fassung: int) -> list[int]:
    ec, gruppen = BLOECKE_M[fassung]
    gesamt = sum(n * k for n, k in gruppen)
    laengenbits = 8 if fassung < 10 else 16

    bits: list[int] = []

    def schieben(wert: int, breite: int) -> None:
        for i in range(breite - 1, -1, -1):
            bits.append((wert >> i) & 1)

    schieben(0b0100, 4)  # Byte-Modus
    schieben(len(text), laengenbits)
    for b in text:
        schieben(b, 8)

    # Abschluss: bis zu vier Nullbits, dann auf ganze Woerter auffuellen.
    for _ in range(min(4, gesamt * 8 - len(bits))):
        bits.append(0)
    while len(bits) % 8:
        bits.append(0)

    woerter = [int("".join(str(b) for b in bits[i : i + 8]), 2) for i in range(0, len(bits), 8)]
    # Die Norm schreibt genau diese beiden Fuellwoerter im Wechsel vor.
    fuell = [0xEC, 0x11]
    i = 0
    while len(woerter) < gesamt:
        woerter.append(fuell[i % 2])
        i += 1
    return woerter


def _verschraenken(woerter: list[int], fassung: int) -> list[int]:
    """Datenbloecke und Fehlerkorrekturbloecke ineinanderschieben."""
    ec, gruppen = BLOECKE_M[fassung]
    bloecke: list[list[int]] = []
    ec_bloecke: list[list[int]] = []
    pos = 0
    for anzahl, groesse in gruppen:
        for _ in range(anzahl):
            block = woerter[pos : pos + groesse]
            pos += groesse
            bloecke.append(block)
            ec_bloecke.append(_fehlerkorrektur(block, ec))

    aus: list[int] = []
    for i in range(max(len(b) for b in bloecke)):
        for b in bloecke:
            if i < len(b):
                aus.append(b[i])
    for i in range(ec):
        for b in ec_bloecke:
            aus.append(b[i])
    return aus


# ── Die Matrix ───────────────────────────────────────────────────────────────
def _leere_matrix(groesse: int) -> tuple[list[list[int]], list[list[bool]]]:
    return (
        [[0] * groesse for _ in range(groesse)],
        [[False] * groesse for _ in range(groesse)],  # belegt = Funktionsmuster
    )


def _sucher_setzen(m: list[list[int]], fest: list[list[bool]], zr: int, zs: int) -> None:
    for r in range(-1, 8):
        for s in range(-1, 8):
            rr, ss = zr + r, zs + s
            if not (0 <= rr < len(m) and 0 <= ss < len(m)):
                continue
            rand = r in (0, 6) and 0 <= s <= 6
            rand |= s in (0, 6) and 0 <= r <= 6
            kern = 2 <= r <= 4 and 2 <= s <= 4
            m[rr][ss] = 1 if (rand or kern) else 0
            fest[rr][ss] = True


def _funktionsmuster(fassung: int) -> tuple[list[list[int]], list[list[bool]]]:
    groesse = 17 + 4 * fassung
    m, fest = _leere_matrix(groesse)

    _sucher_setzen(m, fest, 0, 0)
    _sucher_setzen(m, fest, 0, groesse - 7)
    _sucher_setzen(m, fest, groesse - 7, 0)

    # Taktreihen
    for i in range(groesse):
        if not fest[6][i]:
            m[6][i] = 1 if i % 2 == 0 else 0
            fest[6][i] = True
        if not fest[i][6]:
            m[i][6] = 1 if i % 2 == 0 else 0
            fest[i][6] = True

    # Ausrichtungsmuster — nicht ueber die Sucher legen.
    mitten = AUSRICHTUNG[fassung]
    for a in mitten:
        for b in mitten:
            if (a, b) in ((6, 6), (6, groesse - 7), (groesse - 7, 6)):
                continue
            for r in range(-2, 3):
                for s in range(-2, 3):
                    m[a + r][b + s] = 1 if max(abs(r), abs(s)) != 1 else 0
                    fest[a + r][b + s] = True

    # Das immer dunkle Feld
    m[groesse - 8][8] = 1
    fest[groesse - 8][8] = True

    # Plaetze der Formatangabe freihalten
    for i in range(9):
        if not fest[8][i]:
            fest[8][i] = True
        if not fest[i][8]:
            fest[i][8] = True
    for i in range(8):
        fest[8][groesse - 1 - i] = True
        fest[groesse - 1 - i][8] = True

    # Fassungsangabe (ab Fassung 7)
    if fassung >= 7:
        for i in range(6):
            for j in range(3):
                fest[groesse - 11 + j][i] = True
                fest[i][groesse - 11 + j] = True
    return m, fest


def _daten_legen(m: list[list[int]], fest: list[list[bool]], woerter: list[int]) -> None:
    groesse = len(m)
    bits = [(w >> i) & 1 for w in woerter for i in range(7, -1, -1)]
    k = 0
    hoch = True
    s = groesse - 1
    while s > 0:
        if s == 6:  # die senkrechte Taktreihe wird uebersprungen
            s -= 1
        reihen = range(groesse - 1, -1, -1) if hoch else range(groesse)
        for r in reihen:
            for ss in (s, s - 1):
                if fest[r][ss]:
                    continue
                m[r][ss] = bits[k] if k < len(bits) else 0
                k += 1
        hoch = not hoch
        s -= 2


MASKEN = [
    lambda r, s: (r + s) % 2 == 0,
    lambda r, s: r % 2 == 0,
    lambda r, s: s % 3 == 0,
    lambda r, s: (r + s) % 3 == 0,
    lambda r, s: (r // 2 + s // 3) % 2 == 0,
    lambda r, s: (r * s) % 2 + (r * s) % 3 == 0,
    lambda r, s: ((r * s) % 2 + (r * s) % 3) % 2 == 0,
    lambda r, s: ((r + s) % 2 + (r * s) % 3) % 2 == 0,
]


def _strafe(m: list[list[int]]) -> int:
    """Die vier Strafregeln der Norm — je niedriger, desto besser lesbar."""
    n = len(m)
    strafe = 0

    # 1: fuenf oder mehr gleiche in Folge
    for linien in (m, [list(z) for z in zip(*m)]):
        for reihe in linien:
            lauf, vorher = 1, reihe[0]
            for wert in reihe[1:]:
                if wert == vorher:
                    lauf += 1
                else:
                    if lauf >= 5:
                        strafe += 3 + (lauf - 5)
                    lauf, vorher = 1, wert
            if lauf >= 5:
                strafe += 3 + (lauf - 5)

    # 2: gleichfarbige 2x2-Bloecke
    for r in range(n - 1):
        for s in range(n - 1):
            if m[r][s] == m[r][s + 1] == m[r + 1][s] == m[r + 1][s + 1]:
                strafe += 3

    # 3: das sucherAEHNLICHE Muster 1:1:3:1:1 mit vier hellen Feldern daneben
    muster1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    muster2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    for linien in (m, [list(z) for z in zip(*m)]):
        for reihe in linien:
            for i in range(n - 10):
                teil = reihe[i : i + 11]
                if teil == muster1 or teil == muster2:
                    strafe += 40

    # 4: Ungleichgewicht hell/dunkel.
    # Die Norm rechnet ueber die BEIDEN benachbarten Vielfachen von 5 um den
    # Dunkelanteil herum, nicht ueber den Anteil selbst. Hier stand zuerst eine
    # abgekuerzte Fassung; sie lieferte gelegentlich eine andere Strafe und
    # damit eine andere Maske als qrencode. Lesbar war das Ergebnis trotzdem —
    # aufgefallen ist es nur im Vergleich Feld fuer Feld.
    dunkel = sum(sum(z) for z in m)
    anteil = dunkel * 100 / (n * n)
    darunter = int(anteil // 5) * 5
    darueber = darunter + 5
    strafe += 10 * min(abs(darunter - 50) // 5, abs(darueber - 50) // 5)
    return strafe


def _format_bits(maske: int) -> list[int]:
    """Formatangabe fuer Stufe M (Bits 00) und die gewaehlte Maske, mit BCH."""
    wert = (0b00 << 3) | maske
    rest = wert << 10
    for i in range(4, -1, -1):
        if rest & (1 << (i + 10)):
            rest ^= 0b10100110111 << i
    voll = ((wert << 10) | rest) ^ 0b101010000010010
    return [(voll >> i) & 1 for i in range(14, -1, -1)]


def _version_bits(fassung: int) -> list[int]:
    rest = fassung << 12
    for i in range(5, -1, -1):
        if rest & (1 << (i + 12)):
            rest ^= 0b1111100100101 << i
    voll = (fassung << 12) | rest
    return [(voll >> i) & 1 for i in range(17, -1, -1)]


def _format_setzen(m: list[list[int]], maske: int) -> None:
    n = len(m)
    bits = _format_bits(maske)  # bits[0] ist das hoechstwertige
    # Erste Kopie: um den linken oberen Sucher.
    #
    # BEIDE KOPIEN LAUFEN VOM HOECHSTWERTIGEN BIT AN. Hier stand zuerst
    # `reversed(bits)`, also genau andersherum — und der Fehler blieb
    # unsichtbar: Leser kommen ueber die ZWEITE Kopie (und die BCH-Korrektur)
    # trotzdem an die Maske, `zbarimg` las alle Probecodes anstandslos zurueck.
    # Aufgefallen ist es erst im Feld-fuer-Feld-Vergleich mit qrencode
    # (tests/qr_test.py). Ein Rueckleseversuch allein haette diese Klasse
    # Fehler NIE gefunden.
    plaetze1 = [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
                (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
    for wert, (r, s) in zip(bits, plaetze1):
        m[r][s] = wert
    # Zweite Kopie: geteilt auf die beiden anderen Sucher
    for i in range(7):
        m[n - 1 - i][8] = bits[i]
    for i in range(8):
        m[8][n - 8 + i] = bits[7 + i]


def _version_setzen(m: list[list[int]], fassung: int) -> None:
    if fassung < 7:
        return
    n = len(m)
    bits = _version_bits(fassung)
    for i in range(18):
        wert = bits[17 - i]
        r, s = i // 3, i % 3
        m[n - 11 + s][r] = wert
        m[r][n - 11 + s] = wert


def mit_maske(text: str, maske: int) -> list[list[int]]:
    """Die Matrix mit einer VORGEGEBENEN Maske.

    Oeffentlich, weil der Test sie braucht: er liest die Maske aus qrencodes
    Ergebnis und baut dieselbe nach, um alles UEBRIGE (Datenwoerter,
    Fehlerkorrektur, Platzierung, Formatbits) Feld fuer Feld vergleichen zu
    koennen. Ohne diesen Griff bliebe nur ein Vergleich, der an der
    Maskenwahl scheitert, obwohl der Kodierer stimmt.
    """
    roh = text.encode("utf-8")
    fassung = _fassung_waehlen(len(roh))
    woerter = _verschraenken(_datenwoerter(roh, fassung), fassung)
    grund, fest = _funktionsmuster(fassung)
    _daten_legen(grund, fest, woerter)

    m = [zeile[:] for zeile in grund]
    for r in range(len(m)):
        for s in range(len(m)):
            if not fest[r][s] and MASKEN[maske](r, s):
                m[r][s] ^= 1
    _format_setzen(m, maske)
    _version_setzen(m, fassung)
    return m


def kodieren(text: str) -> list[list[int]]:
    """Text zu einer Matrix aus 0/1 (1 = dunkel), ohne Rand.

    Von den acht Masken gewinnt die mit der niedrigsten Strafe — so schreibt es
    die Norm vor. In Randfaellen der Strafregeln kommen andere Umsetzungen zu
    einer anderen Wahl; beide Ergebnisse sind gueltig und lesbar.
    """
    beste, bestwert = None, None
    for maske in range(8):
        m = mit_maske(text, maske)
        wert = _strafe(m)
        if bestwert is None or wert < bestwert:
            beste, bestwert = m, wert
    assert beste is not None
    return beste


def als_pbm(matrix: list[list[int]], rand: int = 4, skala: int = 1) -> bytes:
    """Als PBM (P1) — das einfachste Bildformat, das jeder Leser versteht."""
    n = len(matrix)
    breite = (n + 2 * rand) * skala
    zeilen = []
    for _ in range(rand * skala):
        zeilen.append("0 " * breite)
    for reihe in matrix:
        zeile = "0 " * (rand * skala)
        for wert in reihe:
            zeile += ("1 " if wert else "0 ") * skala
        zeile += "0 " * (rand * skala)
        for _ in range(skala):
            zeilen.append(zeile)
    for _ in range(rand * skala):
        zeilen.append("0 " * breite)
    kopf = f"P1\n{breite} {len(zeilen)}\n"
    return (kopf + "\n".join(z.strip() for z in zeilen) + "\n").encode("ascii")


def als_text(matrix: list[list[int]], rand: int = 2) -> str:
    """Fuer die Konsole: zwei Halbblöcke je Zeile, damit es quadratisch wirkt."""
    n = len(matrix)
    voll = [[0] * (n + 2 * rand) for _ in range(rand)]
    for reihe in matrix:
        voll.append([0] * rand + list(reihe) + [0] * rand)
    voll += [[0] * (n + 2 * rand) for _ in range(rand)]
    if len(voll) % 2:
        voll.append([0] * len(voll[0]))
    aus = []
    for i in range(0, len(voll), 2):
        zeile = ""
        for oben, unten in zip(voll[i], voll[i + 1]):
            # dunkel = Vordergrund; im Terminal ist der Hintergrund meist dunkel,
            # deshalb umgekehrt zeichnen, sonst liest kein Handy es ab.
            zeile += {(0, 0): "█", (1, 1): " ", (1, 0): "▄", (0, 1): "▀"}[
                (oben, unten)
            ]
        aus.append(zeile)
    return "\n".join(aus)


if __name__ == "__main__":
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__.split("AUFRUF")[1].strip(), file=sys.stderr)
        raise SystemExit(2)
    m = kodieren(args[0])
    if "--pbm" in sys.argv:
        sys.stdout.buffer.write(als_pbm(m))
    else:
        print(als_text(m))
        print(f"Fassung {(len(m) - 17) // 4}, {len(m)}x{len(m)} Felder")
