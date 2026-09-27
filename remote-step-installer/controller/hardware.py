"""
Welche Schritte passen zu DIESER Box?

WOFUER: die Erkennung gab es laengst (`sysinfo.py` liest Modell, Codename,
Debian-Version und speist sie als $PI_MODEL/$CODENAME/... in jeden Schritt).
Was fehlte, war die andere Haelfte: dass ein Schritt darauf REAGIEREN kann.

Bisher gab es dafuer nur zwei schlechte Wege — im Schritt selbst per `case`
verzweigen (unsichtbar in der Uebersicht, der Schritt laeuft und tut nichts)
oder ein zweites Rezept je Hardware (zwei Wahrheiten, die auseinanderlaufen).
Jetzt traegt ein Schritt ein `when:`, und die Oberflaeche kann VOR dem Lauf
sagen, was sie ueberspringen wird und warum.

REIN: kein Netz, kein Agent, keine Dateien - herein kommt die erkannte
Umgebung, heraus kommt ein Ja/Nein. Damit pruefbar, ohne eine Box zu haben.

SCHREIBWEISE im Rezept (bewusst knapp, das Rezept wird von Menschen gelesen):

    when: pi5              nur auf dem Pi 5
    when: pi4 pi5          auf Pi 4 ODER Pi 5
    when: "!pi5"           ueberall AUSSER Pi 5
    when: trixie           nach Debian-Codename
    when: pi5 !trixie      Pi 5, aber nicht auf Trixie

Ohne `when:` laeuft ein Schritt ueberall — das ist der Normalfall und soll
kein Zutun kosten.
"""


def fakten(env):
    """Die erkannte Umgebung als Menge von Schlagworten.

    Aus `sysinfo.normalize()`. Bewusst FLACH: ein `when:` soll nach Modell,
    SoC, Codename oder Debian-Fassung fragen koennen, ohne dass das Rezept
    die Struktur dahinter kennen muss.
    """
    raus = set()
    if not env:
        return raus
    mid = (env.get("model_id") or "").strip().lower()
    if mid and mid != "unknown":
        raus.add(mid)
        # Der SoC ist oft die ehrlichere Frage: `bcm2711` trifft Pi 4 UND
        # CM4, und beide verhalten sich bei Grafik und Speicher gleich.
        soc = _SOC.get(mid)
        if soc:
            raus.add(soc)
    code = (env.get("codename") or "").strip().lower()
    if code:
        raus.add(code)
    major = env.get("debian_major")
    if major:
        raus.add(f"debian{major}")
    arch = (env.get("arch") or "").strip().lower()
    if arch:
        raus.add(arch)
    return raus


# Klein gehalten und NICHT aus model.py importiert: dieses Modul soll ohne
# Umgebung pruefbar bleiben. Wer ein Modell ergaenzt, ergaenzt es hier mit.
_SOC = {
    "pi5": "bcm2712",
    "cm4": "bcm2711",
    "pi4": "bcm2711",
    "pi3": "bcm2837",
    "pizero2": "bcm2837",
    "pi2": "bcm2836",
    "pizero": "bcm2835",
    "pi1": "bcm2835",
}


def passt(when, fakten_menge):
    """Trifft die Bedingung auf diese Umgebung zu?

    OHNE Bedingung: ja. Das ist der Normalfall, und er darf nichts kosten.

    UNBEKANNTE Umgebung (leere Faktenmenge): ebenfalls ja. Lieber einen
    Schritt zu viel anbieten als eine Installation stillschweigend halbieren,
    weil die Erkennung mal nicht durchkam - der Mensch sitzt davor und kann
    ueberspringen.
    """
    if not when:
        return True
    marken = [m for m in str(when).replace(",", " ").split() if m]
    if not marken:
        return True
    if not fakten_menge:
        return True

    verbote = [m[1:].lower() for m in marken if m.startswith("!") and len(m) > 1]
    gebote = [m.lower() for m in marken if not m.startswith("!")]

    # Ein Verbot schlaegt alles: "pi5 !trixie" heisst NICHT auf Trixie, auch
    # wenn es ein Pi 5 ist.
    for v in verbote:
        if v in fakten_menge:
            return False
    if not gebote:
        return True
    return any(g in fakten_menge for g in gebote)


def auswerten(steps, fakten_menge):
    """Welche Schritte fallen weg?

    Gibt `[(id, when)]` der Schritte zurueck, die auf dieser Box NICHT
    laufen. Die Oberflaeche kann das VOR dem Lauf anzeigen - „was passiert
    gleich" ist die Frage, die man vor einer Installation hat.
    """
    raus = []
    for st in steps or []:
        w = st.get("when")
        if w and not passt(w, fakten_menge):
            raus.append((st.get("id", "?"), str(w)))
    return raus
