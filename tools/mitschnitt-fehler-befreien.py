#!/usr/bin/env python3
"""Titel befreien, die an einem inzwischen behobenen Fehler haengen geblieben sind.

══ WOZU ══════════════════════════════════════════════════════════════════════
Die Mitschnitt-Liste gibt jedem Titel DREI Anlaeufe und laesst ihn danach
sichtbar liegen (`liste.mjs`, Regel 4). Das ist richtig, solange der Grund am
TITEL liegt. Steckt der Grund aber im PROGRAMM, verbrennen alle offenen Titel
ihre Anlaeufe an derselben Sache — und nach der Korrektur passiert von selbst
gar nichts mehr: `naechster()` nimmt nur `offen`.

Genau so war es am 20.09.2026: ein zweites `const args` im selben Block liess
jeden Aufnahmelauf sofort werfen (Wiki:
`zweiter-const-im-block-legt-den-ganzen-weg-stumm`). 77 Titel lagen danach mit

    Cannot access 'args' before initialization

auf `fehler`. Der Fix allein holt keinen einzigen zurueck.

══ WIE ═══════════════════════════════════════════════════════════════════════
Ueber die eigene Flaeche des Plugins, nicht an der Datei vorbei: `liste.json`
wird vom laufenden Dienst gelesen und geschrieben (`mitListe`), ein Schreiber
von aussen verlaest sich darauf, dass gerade niemand sonst schreibt.

    GET  /api/plugins/mixpi-mitschnitt/http/liste
    POST /api/plugins/mixpi-mitschnitt/http/neuladen  {"titel":[{"uri":…}, …]}

`neuladen` holt einen Eintrag aus `fehler` heraus UND merkt ihn mit Vorrang
vor. Die Marke „unvollstaendig" auf der Medienkachel setzt es nur fuer Titel
MIT `schluessel` — der wird hier bewusst nicht mitgeschickt: es gibt keine
halbe Aufnahme zu ersetzen, der Titel ist nie entstanden.

Gerufen wird auf der Box gegen 127.0.0.1, weil ein Teil der Flaeche von fern
mit 403 antwortet.

══ AUFRUF ════════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-fehler-befreien.py --box dietpi@192.168.178.62
    …                                           --grund 'Cannot access'
    …                                           --wirklich

OHNE `--wirklich` wird NUR GEZEIGT. Ein Werkzeug, das beim ersten Aufruf 77
Titel in die Warteschlange stellt, waere eins, das man nicht ausprobieren mag.
"""

import argparse
import json
import shlex
import subprocess
import sys

PLUGIN = "mixpi-mitschnitt"
BASIS = "http://127.0.0.1:8200/api/plugins/{}/http".format(PLUGIN)
# Der Grund des Fundes, der dieses Werkzeug gebaut hat — als Vorgabe, damit
# der haeufigste Fall keine Tipparbeit ist.
GRUND_VORGABE = "Cannot access 'args' before initialization"


def auf_der_box(box: str, befehl: str, zeitlimit: int = 60) -> str:
    """Einen Befehl auf der Box laufen lassen und seine Ausgabe zurueckgeben."""
    fertig = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", box, befehl],
        capture_output=True, text=True, timeout=zeitlimit,
    )
    if fertig.returncode != 0:
        raise SystemExit(f"ssh {box}: rc={fertig.returncode}\n{fertig.stderr.strip()}")
    return fertig.stdout


def liste_holen(box: str) -> dict:
    roh = auf_der_box(box, f"curl -s -m 20 {shlex.quote(BASIS + '/liste')}")
    try:
        return json.loads(roh)
    except json.JSONDecodeError as f:
        raise SystemExit(f"Die Liste kam nicht als JSON ({f}): {roh[:200]!r}")


def befreien(box: str, titel: list, stueck: int = 25) -> dict:
    """In Haeppchen schicken — eine Anfrage mit 77 Titeln waere eine Wette."""
    summe = {"vorgemerkt": 0, "befreit": 0, "markiert": 0}
    for i in range(0, len(titel), stueck):
        rumpf = json.dumps({"titel": titel[i:i + stueck]}, ensure_ascii=False)
        roh = auf_der_box(
            box,
            "curl -s -m 60 -X POST -H 'content-type: application/json' "
            f"-d {shlex.quote(rumpf)} {shlex.quote(BASIS + '/neuladen')}",
            zeitlimit=120,
        )
        try:
            antwort = json.loads(roh)
        except json.JSONDecodeError:
            raise SystemExit(f"Antwort war kein JSON: {roh[:200]!r}")
        if not antwort.get("ok"):
            raise SystemExit(f"Das Plugin hat abgelehnt: {antwort}")
        for s in summe:
            summe[s] += int(antwort.get(s) or 0)
    return summe


def main() -> int:
    t = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    t.add_argument("--box", required=True, help="dietpi@<adresse> — tools/box-finden.py nennt sie")
    t.add_argument("--grund", default=GRUND_VORGABE,
                   help="Teilzeichenkette im Grund; Vorgabe ist der TDZ-Fehler vom 20.09.2026")
    t.add_argument("--wirklich", action="store_true", help="tatsaechlich befreien statt nur zeigen")
    a = t.parse_args()

    daten = liste_holen(a.box)
    eintraege = daten.get("eintraege") or []
    # `stand`/`wort` heissen nach aussen so; drinnen sind es `zustand`/`grund`.
    betroffen = [e for e in eintraege
                 if e.get("stand") == "fehler" and a.grund in str(e.get("wort") or "")]

    print(f"Liste auf {a.box}: {len(eintraege)} Eintraege, "
          f"{daten.get('zusammenfassung', {}).get('fehler', '?')} auf fehler.")
    print(f"Mit dem Grund ‚{a.grund}‘: {len(betroffen)}")
    for e in betroffen[:10]:
        print(f"    {e.get('name') or e['uri']}")
    if len(betroffen) > 10:
        print(f"    … und {len(betroffen) - 10} weitere")

    if not betroffen:
        print("NICHTS ZU TUN.")
        return 0
    if not a.wirklich:
        print("\nNUR GEZEIGT. Mit --wirklich werden sie befreit und mit Vorrang vorgemerkt.")
        return 0

    # NUR DIE ADRESSE UND DIE NAMEN — kein `schluessel`, sonst markierte
    # `neuladen` eine Medienkachel als unvollstaendig, die gar keine Datei hat.
    titel = [{"uri": e["uri"], "name": e.get("name"), "interpret": e.get("interpret"),
              "album": e.get("album"), "albumKuenstler": e.get("albumInterpret")}
             for e in betroffen]
    summe = befreien(a.box, titel)
    print(f"\nBEFREIT: {summe['befreit']}, vorgemerkt: {summe['vorgemerkt']}, "
          f"als unvollstaendig markiert: {summe['markiert']} (soll 0 sein)")

    nach = liste_holen(a.box).get("zusammenfassung", {})
    print(f"Jetzt: offen {nach.get('offen')}, fertig {nach.get('fertig')}, fehler {nach.get('fehler')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
