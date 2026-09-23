#!/usr/bin/env python3
"""
Gilt "Eigene Listen des Kindes" wirklich JE PROFIL?

NUR LESEND. Kein POST/PUT/DELETE, keine Datei auf der Box wird angefasst.

Die Behauptung lautet: `profile/<kennung>/listen.json`, sieben Wege unter
/api/listen, alle ueber `listenLesen(profilAktiv())` — also je Profil.

Diese Probe misst NICHT, ob das Feld existiert (das tut es), sondern die drei
Stellen, an denen so eine Zusage in der Praxis zerbricht:

  A  DER BESTAND      Welches Profil hat ueberhaupt eine listen.json?
  B  DER LESER        Wer ruft /api/listen — und liest jemand das mitgelieferte
                      Feld `profil`? Ein Wert, den niemand liest, traegt nichts.
  C  DIE OBERFLAECHE  Kann der, der Listen anlegt, das Profil ueberhaupt
                      waehlen oder auch nur SEHEN? Und kann das Kind, das das
                      Profil waehlen kann, seine Listen ueberhaupt erreichen?

Aufruf:
    python3 tools/eigene-listen-je-profil-pruefen.py
    python3 tools/eigene-listen-je-profil-pruefen.py --box 192.168.178.169
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.request

BOX = "192.168.178.169"
PORT = 8200
NUTZER = "dietpi"
FERN = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
BAUM = "/home/achim/Downloads/MuPiBox"


def ssh(box, befehl, sekunden=30):
    """Ein Lesebefehl auf der Box. Fehler geben leeren Text, nicht Absturz."""
    try:
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"{NUTZER}@{box}", befehl],
            capture_output=True, text=True, timeout=sekunden,
        )
        return p.stdout
    except Exception as e:  # Netz weg, Box aus — die Probe sagt es, statt zu sterben
        return f"__FEHLER__ {e}"


def erreichbar(box):
    """Steht die Box ueberhaupt? EINMAL, vor jeder Messung.

    WARUM (24.08.2026): `zaehl_fern` gibt bei totem ssh `-1` zurueck, und der
    Bestandsteil liest leeren Text als „kein Profil hat eine listen.json".
    An der abgeschalteten Box druckte die Probe darum
    „✗ KEIN Profil hat eine listen.json — die Funktion wurde nie benutzt"
    und ging mit 1 — ein Befund ueber eine Ablage, die sie nie gesehen hat.
    Nicht gemessen ist nicht dasselbe wie null gemessen.
    """
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"{NUTZER}@{box}", "echo da"],
        capture_output=True, text=True, timeout=20,
    )
    return p.stdout.strip() == "da"


def hole(box, weg, sekunden=12):
    try:
        with urllib.request.urlopen(f"http://{box}:{PORT}{weg}", timeout=sekunden) as a:
            return json.loads(a.read().decode())
    except Exception as e:
        return {"__fehler__": str(e)}


def zaehl_fern(box, muster, ordner):
    """Vorkommen (nicht Zeilen — die Buendel sind eine einzige Zeile)."""
    t = ssh(box, f"grep -ro {muster!r} {FERN}/{ordner} 2>/dev/null | wc -l")
    t = t.strip()
    return int(t) if t.isdigit() else -1


def hauptteil():
    ap = argparse.ArgumentParser()
    ap.add_argument("--box", default=BOX)
    a = ap.parse_args()
    box = a.box
    verdacht = []

    if not erreichbar(box):
        print(f"ABBRUCH: {box} antwortet nicht auf ssh — es wurde NICHTS gemessen.")
        print("Kein Befund. Box einschalten und erneut laufen lassen.")
        return 2

    print("── A  DER BESTAND ────────────────────────────────────────────────")
    stand = hole(box, "/api/profile")
    listen = hole(box, "/api/listen")
    print(f"  /api/profile : {json.dumps(stand, ensure_ascii=False)[:200]}")
    print(f"  /api/listen  : {json.dumps(listen, ensure_ascii=False)[:200]}")
    roh = ssh(box, f"for d in {FERN}/server/config/profile/*/; do "
                   f"k=$(basename $d); "
                   f"if [ -f $d/listen.json ]; then echo \"$k JA $(stat -c%s $d/listen.json) $(cat $d/listen.json | head -c 40)\"; "
                   f"else echo \"$k NEIN\"; fi; done")
    for z in roh.splitlines():
        print(f"  Bereich {z}")
    if roh.count(" JA ") == 0:
        verdacht.append("KEIN Profil hat eine listen.json — die Funktion wurde nie benutzt.")
    aktiv = (stand or {}).get("aktiv")
    kinder = [p.get("kennung") for p in (stand or {}).get("profile", []) if p.get("kennung") != "gast"]
    for k in kinder:
        if f"{k} NEIN" in roh:
            verdacht.append(f"Das Kind {k!r} hat KEINE eigene listen.json — nur der Gast hat eine.")

    print("\n── B  DER LESER ──────────────────────────────────────────────────")
    # Wer im Buendel auf der Box ruft /api/listen?
    for ordner, wer in (("www", "Kind-Oberflaeche"), ("www-admin", "Verwaltung")):
        n = zaehl_fern(box, "api/listen", ordner)
        print(f"  {ordner:10s} ({wer:16s}) nennt /api/listen  {n}x")
        if ordner == "www" and n == 0:
            verdacht.append("Die KIND-Oberflaeche nennt /api/listen kein einziges Mal — "
                            "das Kind kommt an seine Listen gar nicht heran.")
    # Liest der einzige Leser das Feld `profil` aus der Antwort?
    try:
        quelle = open(f"{BAUM}/src/frontend-admin/src/app/seiten/medien.ts", encoding="utf8").read()
    except OSError:
        quelle = ""
    ruft = len(re.findall(r"/api/listen", quelle))
    liest_profil = bool(re.search(r"\.profil\b|profil\s*[:?]", quelle, re.I))
    nennt_profil = len(re.findall(r"profil", quelle, re.I))
    print(f"  medien.ts (einziger Leser) ruft /api/listen {ruft}x, "
          f"nennt das Wort 'Profil' {nennt_profil}x, liest das Feld: {liest_profil}")
    if ruft and not liest_profil:
        verdacht.append("GET /api/listen liefert {listen, profil} — der einzige Leser "
                        "wirft `profil` weg. Niemand sieht, WESSEN Listen dastehen.")

    print("\n── C  DIE OBERFLAECHE ────────────────────────────────────────────")
    for ordner, wer in (("www", "Kind-Oberflaeche"), ("www-admin", "Verwaltung")):
        n = zaehl_fern(box, "profil/aktiv", ordner)
        print(f"  {ordner:10s} ({wer:16s}) kann das Profil wechseln: {n}x profil/aktiv")
        if ordner == "www-admin" and n == 0:
            verdacht.append("Die VERWALTUNG — die einzige Stelle, die Listen anlegt — "
                            "kann das Profil weder wechseln noch anzeigen. Sie schreibt "
                            f"blind in den Bereich des gerade aktiven Profils ({aktiv!r}).")
    hinweis = ssh(box, f"grep -ro 'Eigene Listen erscheinen noch NICHT auf der Box' {FERN}/www-admin/ | head -1")
    if hinweis.strip():
        verdacht.append("Die Verwaltung schreibt selbst: „Eigene Listen erscheinen noch "
                        "NICHT auf der Box\" — es gibt keine Listen DES KINDES, nur Listen "
                        "im Elternbereich, die nirgends spielen.")

    print("\n══ BEFUND ════════════════════════════════════════════════════════")
    if verdacht:
        for v in verdacht:
            print(f"  ✗ {v}")
        print("\n  → Die Zusage „je Profil\" haelt im BACKEND, ist aber nicht bedienbar.")
        return 1
    print("  ✓ nichts gefunden")
    return 0


if __name__ == "__main__":
    sys.exit(hauptteil())
