#!/usr/bin/env python3
"""
IST DIE BILDWAHL DES KINDES AUF EINER ECHTEN BOX ERREICHBAR? — nur lesend.

══ WOFUER ES DAS GIBT ═════════════════════════════════════════════════════

Die Frage „gilt das Bild je Profil?" wird regelmaessig mit dem FELD
beantwortet — `GET /api/profile` zeigt `"figur":""` je Kind, also scheint es
je Profil zu gelten. Das ist die Antwort auf eine andere Frage. Ein Feld, das
je Profil DASTEHT, ist nicht dasselbe wie eine Wahl, die ein Kind TREFFEN
kann. Zwischen beiden liegt der Ordner `bilder/figuren/`, und der ist auf der
Box .169 leer.

DIESES WERKZEUG PRUEFT DIE KETTE, NICHT DAS FELD:

  1. `GET /api/profile`      — gibt es das Feld je Eintrag, und was steht drin?
  2. `GET /api/figuren`      — WAS WIRD ANGEBOTEN? Das ist die eigentliche
                               Frage. Ist die Liste leer, gibt es nichts zu
                               waehlen, egal wie profilbewusst der Rest ist.
  3. `uebergangen`           — liegen Dateien im Ordner, die durch
                               `FIGUR_MUSTER` fallen (Grossbuchstaben, `.jpg`,
                               fehlende Endung)? Dann ist der Ordner NICHT
                               leer, sondern falsch befuellt — ein ganz
                               anderer Befund mit einer ganz anderen Abhilfe.

══ WARUM KEIN POST ════════════════════════════════════════════════════════

Nachweisen, dass das Setzen scheitert, waere ein `POST /api/profil/figur` —
und der ist auf einer Box im Gebrauch verboten. Er ist auch nicht noetig:
`server.ts` weist JEDEN Namen mit 400 `figurFehlt` ab, der nicht in
`figurenLesen().figuren` steht (server.ts, POST /api/profil/figur). Ist die
Liste aus Schritt 2 leer, ist damit bewiesen, dass ausser der leeren
Zeichenkette KEIN Wert ablegbar ist — ohne einen einzigen Schreibzugriff.

══ GEBRAUCH ══════════════════════════════════════════════════════════════

    python3 tools/figurwahl-erreichbar.py [--box 192.168.178.169] [--port 8200]

Rueckgabe: 0 = ein Kind kann sich wirklich ein Bild aussuchen,
           1 = es gibt nichts zu waehlen (oder der Ordner ist falsch befuellt).
"""

import argparse
import json
import sys
import urllib.error
import urllib.request


def hole(url: str, sekunden: float):
    """Einen JSON-Weg lesen. Gibt (daten, fehlertext) zurueck — nie beides."""
    try:
        with urllib.request.urlopen(url, timeout=sekunden) as a:
            return json.loads(a.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # Netz weg, Dienst aus, kaputtes JSON
        return None, str(e)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="192.168.178.169")
    # PORT 8200, NICHT 80: auf 80 sitzt die alte PHP-Verwaltung, die diese
    # Wege gar nicht kennt — ein Abruf dort antwortet nicht oder mit HTML.
    p.add_argument("--port", type=int, default=8200)
    p.add_argument("--zeit", type=float, default=10.0)
    a = p.parse_args()

    basis = f"http://{a.box}:{a.port}/api"
    print(f"── Box {a.box}:{a.port}\n")

    profile, fehler = hole(f"{basis}/profile", a.zeit)
    if fehler:
        print(f"FEHLER: /api/profile nicht lesbar — {fehler}")
        return 2

    liste = profile.get("profile") or []
    print(f"1. DAS FELD — {len(liste)} Profile, aktiv: {profile.get('aktiv')!r}")
    mit_bild = []
    for k in liste:
        f = k.get("figur", "<FELD FEHLT>")
        if f:
            mit_bild.append(k.get("kennung"))
        print(f"     {str(k.get('kennung')):12} figur={f!r}")
    print(f"   → Feld je Eintrag vorhanden. Mit gesetztem Bild: {len(mit_bild)} von {len(liste)}\n")

    figuren, fehler = hole(f"{basis}/figuren", a.zeit)
    if fehler:
        print(f"FEHLER: /api/figuren nicht lesbar — {fehler}")
        return 2

    waehlbar = figuren.get("figuren") or []
    uebergangen = figuren.get("uebergangen") or []
    print(f"2. DAS ANGEBOT — Ordner {figuren.get('ordner')!r}")
    print(f"     waehlbar:    {len(waehlbar)} {waehlbar}")
    print(f"     uebergangen: {len(uebergangen)} {uebergangen}\n")

    if uebergangen:
        # NICHT LEER, SONDERN FALSCH: hier liegen Dateien, die durch
        # FIGUR_MUSTER fallen. Das ist ein Tippfehler, kein fehlendes Bild.
        print("3. BEFUND: Der Ordner ist befuellt, aber die Namen fallen durch")
        print("   `FIGUR_MUSTER` (klein, nur a-z0-9._-, muss auf .png enden).")
        print("   Abhilfe ist ein Umbenennen, kein neues Bild.")

    if not waehlbar:
        print("3. BEFUND: DIE WAHL IST NICHT ERREICHBAR.")
        print("   Das Raster im Fenster „wer hoert\" zeigt genau EINE Kachel — das")
        print("   MixPi —, und die sendet die LEERE Zeichenkette. Das ist der")
        print("   Rueckweg, keine Auswahl.")
        print("   `POST /api/profil/figur` wiese jeden anderen Wert mit 400")
        print("   `figurFehlt` ab (server.ts). Der einzige ablegbare Wert ist \"\".")
        print("\n   → „das Bild, das sich das Kind aussucht\" gibt es hier NICHT.")
        print("     Die Maschinerie dahinter ist profilbewusst; das Angebot fehlt.")
        return 1

    print(f"3. BEFUND: Ein Kind kann aus {len(waehlbar)} Bildern waehlen —")
    print("   die Wahl ist erreichbar und wird je Profil abgelegt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
