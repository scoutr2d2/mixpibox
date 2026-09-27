#!/usr/bin/env python3
"""Kommt eine Nachricht bei der Box an? — die drei Wege am GERAET gemessen.

WARUM ES DAS GIBT
Die vier Nachrichten-Module sind gegen Attrappen geprueft (83 Zeugen,
29 Gegenproben) — und genau das ist die Grenze: eine Attrappe antwortet
immer. Am Geraet entscheidet sich etwas anderes: Steht der Matrix-Server?
Nimmt Telegram den Token? Horcht signal-cli ueberhaupt? Hat jemand geklopft,
der nicht auf der Liste steht? Diese Fragen beantwortet kein Unit-Test, und
sie einmal von Hand zu tippen heisst, sie beim naechsten Mal wieder zu
tippen ([[werkzeug-statt-wegwerfbefehl]]).

ES SCHREIBT NICHTS. Alle Aufrufe sind lesend; `--senden` gibt es mit Absicht
nicht — eine Sonde, die dem Kind eine Nachricht schickt, ist keine Sonde.

DIE ADRESSE WIRD NICHT GERATEN. Ohne --box fragt `tools/box-finden.py`
([[box-ip-wechselt]]: „Ein Portscan-Treffer auf 8200 beweist nichts").

ZWEIMAL MESSEN IST DER NORMALFALL, NICHT DIE AUSNAHME. `--zweimal` misst mit
Abstand und zeigt beide Staende: der Anlauf einer Long-Poll-Schleife sieht
aus wie ein Zustand ([[einmal-hinsehen-ist-keine-messung]]).

AUFRUF
    python3 tools/nachrichten-sonde.py                    # Stand der Box
    python3 tools/nachrichten-sonde.py --box 192.168.178.62
    python3 tools/nachrichten-sonde.py --zweimal --abstand 30
    python3 tools/nachrichten-sonde.py --signal-port 7583 # nur die Tuer

Ende 0 = gemessen, 1 = die Messung konnte nicht stattfinden (Box nicht
erreichbar). EIN SCHLECHTES ERGEBNIS IST KEIN ENDE 1 — es steht im Bericht.
Wer den Rueckgabewert als Urteil liest, liest falsch.
"""

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PORT = 8200
FRIST = 6


def sagen(text=""):
    print(text, flush=True)


def box_adresse(gewuenscht):
    """Die Adresse der Box — gefragt, nicht geraten."""
    if gewuenscht:
        return gewuenscht
    try:
        lauf = subprocess.run(
            [sys.executable, str(WURZEL / "tools/box-finden.py"), "--nur-adresse"],
            capture_output=True,
            text=True,
            timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        sagen(f"box-finden.py ging nicht: {e}")
        return None
    adresse = lauf.stdout.strip().splitlines()[-1] if lauf.stdout.strip() else ""
    return adresse or None


def holen(adresse, pfad):
    """Ein lesender Ruf. Gibt (daten, fehlertext) zurueck — wirft nie."""
    ziel = f"http://{adresse}:{PORT}{pfad}"
    try:
        with urllib.request.urlopen(ziel, timeout=FRIST) as a:
            return json.loads(a.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, OSError, ValueError) as e:
        return None, str(e)


def tuer_offen(host, port, frist=1.5):
    """Horcht dort jemand? Mehr behauptet diese Frage nicht."""
    try:
        with socket.create_connection((host, port), timeout=frist):
            return True
    except OSError:
        return False


def wann(ms):
    if not ms:
        return "noch nie"
    verstrichen = int(time.time() * 1000) - int(ms)
    if verstrichen < 0:
        return "in der Zukunft (Uhr der Box?)"
    minuten = verstrichen // 60000
    if minuten < 1:
        return "gerade eben"
    if minuten < 120:
        return f"vor {minuten} min"
    return f"vor {minuten // 60} h"


def bericht(adresse):
    """Ein Durchgang. Gibt zurueck, ob die Box ueberhaupt geantwortet hat."""
    stand, fehler = holen(adresse, "/api/nachrichten/stand")
    if stand is None:
        sagen(f"  Box {adresse}:{PORT} antwortet nicht auf /api/nachrichten/stand — {fehler}")
        return False

    sagen(f"  Hauptschalter: {'AN' if stand.get('an') else 'AUS'}"
          f"   Erlaubte Absender: {stand.get('erlaubte', 0)}")
    if stand.get("erlaubte", 0) == 0 and stand.get("an"):
        sagen("  ACHTUNG: eingeschaltet, aber NIEMAND auf der Liste — es kommt nichts durch.")

    for weg, lage in sorted((stand.get("wege") or {}).items()):
        marke = "an " if lage.get("an") else "aus"
        laeuft = "laeuft" if lage.get("laeuft") else "steht"
        zeile = f"  {weg:9s} {marke}  {laeuft:6s}  zuletzt etwas: {wann(lage.get('zuletzt'))}"
        if lage.get("fehler"):
            zeile += f"\n              Fehler: {lage['fehler']}"
        sagen(zeile)

    if stand.get("signalDa") is False:
        sagen("  signal-cli antwortet nicht. " + str(stand.get("signalHinweis", "")))
    elif stand.get("signalDa") is True:
        sagen("  signal-cli: Tuer offen.")

    for weg, ab in sorted((stand.get("abgewiesen") or {}).items()):
        sagen(f"  ABGEWIESEN ueber {weg}: {ab.get('anzahl', 0)}x, zuletzt "
              f"{ab.get('zuletzt', '?')} ({wann(ab.get('wann'))})")
        sagen("              Wenn das jemand sein soll, den das Kind kennt: eintragen.")

    liste, fehler = holen(adresse, "/api/nachrichten")
    if liste is not None:
        sagen(f"  Auf der Box liegen {len(liste.get('nachrichten', []))} Nachrichten, "
              f"{liste.get('ungelesen', 0)} ungelesen. "
              f"Vorlesen fuer das aktive Profil: {'AN' if liste.get('vorlesen') else 'AUS'}")
    return True


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", help="Adresse der Box. Ohne diese Angabe fragt box-finden.py.")
    p.add_argument("--zweimal", action="store_true", help="Zwei Messungen mit Abstand — der Anlauf sieht aus wie ein Zustand.")
    p.add_argument("--abstand", type=int, default=30, help="Sekunden zwischen den beiden Messungen (Vorgabe 30).")
    p.add_argument("--signal-port", type=int, help="Nur nachsehen, ob signal-cli auf diesem Port horcht.")
    a = p.parse_args()

    adresse = box_adresse(a.box)
    if not adresse:
        sagen("Keine Box gefunden. Mit --box eine Adresse angeben.")
        return 1

    if a.signal_port:
        offen = tuer_offen(adresse, a.signal_port)
        sagen(f"signal-cli auf {adresse}:{a.signal_port}: {'Tuer offen' if offen else 'niemand da'}")
        sagen("Eine offene Tuer heisst NICHT, dass signal-cli angemeldet ist — "
              "das sagt erst eine Nachricht, die ankommt.")
        return 0

    sagen(f"── Nachrichten-Wege der Box {adresse} ──")
    if not bericht(adresse):
        return 1
    if a.zweimal:
        sagen(f"\n── zweite Messung, {a.abstand} s spaeter ──")
        time.sleep(a.abstand)
        bericht(adresse)
    return 0


if __name__ == "__main__":
    sys.exit(main())
