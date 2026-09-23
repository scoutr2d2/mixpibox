#!/usr/bin/env python3
"""Misst lokale Mitschnitte gegen die Solldauer der Quelle (BACKLOG E95).

══ WOZU ════════════════════════════════════════════════════════════════════
Ob eine lokale Spur abspielbereit ist, entscheidet `spurVollstaendig`
(titelkarte.ts) — und zwar am DATEINAMEN: die Aufnahme haengt unter 97 %
Vollstaendigkeit ein ` (unvollstaendig NN%)` an, und wer das traegt, verliert
gegen die Cloud.

DIE MARKE SCHREIBT ABER NUR DIE AUFNAHME, IM MOMENT DES AUFNEHMENS. Was
davor entstand, was bei unbekannter Solldauer durchlief oder was eine
abgebrochene Aufnahme hinterliess, gilt fuer immer als heil — nachgemessen
wird nie. Am Geraet gefunden (04.09.2026, „Nah" von Alin Coen):

    05 Leichtigkeit.flac    lokal 211 s   Spotify 230 s   = 91,7 %

Ohne Marke im Namen, also spielte die Box die um 19 Sekunden abgeschnittene
Fassung, obwohl dieselbe Spur bei Spotify heil vorliegt. Genau der Fall, mit
dem E95 aufgemacht wurde: „das backend muss halt von local auf spotify und
umgekehrt schalten koennen".

══ WAS ES TUT ══════════════════════════════════════════════════════════════
Es fragt die Box nach ihren verschmolzenen Werken, holt je Werk die
Titelliste (dort steht `dauerMs` der Quelle) und misst die lokal liegende
Spur mit `ffprobe`. Weicht sie ab, wird sie gemeldet — mit `--richten`
bekommt sie die Marke, die ihr fehlt.

DIE MARKE STATT EINER NEUEN WAHRHEIT, und das ist der ganze Trick: Der
Abspielweg muss nicht angefasst werden. `spurVollstaendig` liest den Namen
ohnehin schon; sobald er stimmt, faellt die Spur von selbst hinter die
Cloud zurueck, die Anzeige zieht mit, und sobald der Mitschnitt sie neu und
vollstaendig aufnimmt, gewinnt sie von selbst wieder. Eine zweite Liste
„kaputter Spuren" waere die Fehlerklasse aus E110/E111.

══ NUR ZU KURZ IST EIN BEFUND, NICHT JEDE ABWEICHUNG ═══════════════════════
Verglichen wird gegen dieselbe Schwelle wie in der Aufnahme (97 %). Eine
Spur, die LAENGER ist, wird GEMELDET, aber nicht markiert: Vorspann,
Stille am Ende oder ein grosszuegiger Schnitt sind kein Grund, eine sonst
heile Datei hinter die Cloud zu stellen — und `(unvollstaendig 104%)` waere
eine Luege im Dateinamen. Wer sie trotzdem ansehen will, findet sie im
Bericht.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-laengen-pruefen.py                # nur messen
    python3 tools/mitschnitt-laengen-pruefen.py --richten      # Marke setzen
    python3 tools/mitschnitt-laengen-pruefen.py --werk <schluessel>
    python3 tools/mitschnitt-laengen-pruefen.py --api http://192.168.178.62:8200

Laeuft AUF DER BOX (braucht die Mediendateien und `ffprobe`); von aussen mit
`--api` nur, wenn der Medienordner dort ebenfalls liegt.

Rueckgabe: 0 alles heil  1 Abweichungen gefunden  2 Umgebung
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# Dieselbe Schwelle wie in der Aufnahme (mixpi-mitschnitt, `vollstaendigkeit`)
# und damit dieselbe, die `spurVollstaendig` spaeter liest.
SCHWELLE = 0.97
# Unter dieser Dauer lohnt kein Urteil: Jingles und Ansagen schwanken relativ
# stark, ohne dass etwas kaputt waere.
MINDESTDAUER_S = 20.0
MARKE = re.compile(r"\s*\(unvollstaendig\s+\d+%\)", re.IGNORECASE)


def hole(api: str, pfad: str) -> object:
    with urllib.request.urlopen(f"{api}{pfad}", timeout=30) as a:
        return json.load(a)


def dauer_s(datei: Path) -> float | None:
    """Die echte Laenge — gemessen, nicht aus dem Namen geraten."""
    try:
        p = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(datei)],
            capture_output=True, text=True, timeout=30,
        )
        return float((p.stdout or "").strip()) if p.returncode == 0 and p.stdout.strip() else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def spur_zu_nr(ordner: Path) -> dict[int, Path]:
    """`NN <Titel>.<endung>` -> Nummer, wie `lokaleKarteAus` in titelkarte.ts."""
    raus: dict[int, Path] = {}
    if not ordner.is_dir():
        return raus
    for f in sorted(ordner.iterdir()):
        m = re.match(r"^(\d{2,3})\s+(.+)(\.[a-z0-9]+)$", f.name, re.IGNORECASE)
        if m and m.group(3).lower() in (".flac", ".mp3", ".m4a", ".wma", ".wav"):
            raus.setdefault(int(m.group(1)), f)
    return raus


def albumordner(medien: Path, eintrag: dict) -> Path | None:
    """Der Ordner einer lokalen Quelle — Kategorie/Interpret/Titel."""
    p = eintrag.get("lokalPfad") or {}
    kat, art, tit = p.get("kategorie"), p.get("interpret"), p.get("titel")
    if not (art and tit):
        return None
    return medien / str(kat or "music") / str(art) / str(tit)


def main() -> int:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--api", default="http://localhost:8200")
    a.add_argument("--medien", default="/home/dietpi/MuPiBox/media")
    a.add_argument("--werk", help="nur diesen Schluessel pruefen")
    a.add_argument("--richten", action="store_true", help="fehlende Marke setzen (benennt um)")
    a.add_argument("--json", action="store_true")
    args = a.parse_args()

    if subprocess.run(["which", "ffprobe"], capture_output=True).returncode != 0:
        print("ffprobe fehlt — ohne es laesst sich keine Dauer messen.", file=sys.stderr)
        return 2
    medien = Path(args.medien)
    if not medien.is_dir():
        print(f"Medienordner nicht da: {medien}", file=sys.stderr)
        return 2

    try:
        werke = hole(args.api, "/api/werke?verschmelzen=1")
    except Exception as f:  # noqa: BLE001
        print(f"Box nicht erreichbar ({args.api}): {f}", file=sys.stderr)
        return 2
    liste = (werke or {}).get("werke", []) if isinstance(werke, dict) else []

    befunde: list[dict] = []
    geprueft = 0
    for w in liste:
        schluessel = str(w.get("schluessel") or "")
        if args.werk and schluessel != args.werk:
            continue
        quellen = w.get("quellen") or []
        lokal = next((q for q in quellen if q and q.get("dienst") == "lokal"), None)
        if not lokal:
            continue
        ordner = albumordner(medien, lokal)
        if not ordner or not ordner.is_dir():
            continue
        try:
            inhalt = hole(args.api, f"/api/werke/{urllib.parse.quote(schluessel, safe='')}/inhalt?verschmelzen=1")
        except Exception:  # noqa: BLE001
            continue
        spuren = spur_zu_nr(ordner)
        for t in (inhalt or {}).get("titel", []):
            nr = t.get("nr")
            soll_ms = t.get("dauerMs")
            datei = spuren.get(int(nr)) if isinstance(nr, int) else None
            if not datei or not isinstance(soll_ms, int) or soll_ms <= 0:
                continue
            soll = soll_ms / 1000.0
            if soll < MINDESTDAUER_S:
                continue
            ist = dauer_s(datei)
            if ist is None:
                continue
            geprueft += 1
            anteil = ist / soll
            markiert = bool(MARKE.search(datei.name))
            if anteil >= SCHWELLE and not markiert:
                continue  # heil und ohne Marke — so soll es sein
            befunde.append({
                "werk": schluessel, "nr": nr, "titel": t.get("titel"),
                "datei": str(datei), "ist_s": round(ist), "soll_s": round(soll),
                "anteil": round(anteil * 100), "markiert": markiert,
                "zu_lang": anteil > 1.0,
            })

    if args.json:
        print(json.dumps({"geprueft": geprueft, "befunde": befunde}, ensure_ascii=False, indent=2))
        return 1 if befunde else 0

    print(f"{geprueft} lokale Spuren gegen die Solldauer der Quelle gemessen.")
    schlimm = [b for b in befunde if not b["markiert"] and not b["zu_lang"]]
    lang = [b for b in befunde if b["zu_lang"]]
    schon = [b for b in befunde if b["markiert"]]

    for b in schlimm:
        print(f"  ZU KURZ  {b['anteil']:>3}%  {b['ist_s']:>4}s statt {b['soll_s']:>4}s  {Path(b['datei']).name}")
    for b in lang:
        print(f"  laenger  {b['anteil']:>3}%  {b['ist_s']:>4}s statt {b['soll_s']:>4}s  {Path(b['datei']).name}"
              "   (nur gemeldet, nicht markiert)")
    for b in schon:
        print(f"  markiert {b['anteil']:>3}%  {Path(b['datei']).name}")

    if not befunde:
        print("  Keine Abweichung — jede lokale Spur hat die Laenge ihrer Quelle.")
        return 0

    if args.richten and schlimm:
        print("\n  Marke setzen:")
        for b in schlimm:
            alt = Path(b["datei"])
            neu = alt.with_name(f"{alt.stem} (unvollstaendig {b['anteil']}%){alt.suffix}")
            try:
                alt.rename(neu)
                print(f"    {alt.name}  ->  {neu.name}")
            except OSError as f:  # noqa: BLE001
                print(f"    FEHLER bei {alt.name}: {f}")
        print("\n  Der Abspielweg zieht von selbst nach: `spurVollstaendig` liest den")
        print("  Namen, die Spur faellt hinter die Cloud zurueck, und sobald der")
        print("  Mitschnitt sie vollstaendig neu aufnimmt, gewinnt sie wieder.")
    elif schlimm:
        print("\n  Mit --richten bekommen die zu kurzen Spuren ihre Marke.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
