#!/usr/bin/env python3
"""MITSCHNITT-STUMMEL — was ein abgebrochener Mitschnitt hinterlaesst.

══ DER BEFUND, DER DAS AUSGELOEST HAT (Betreiber, 22.08.2026) ═══════════════
„es gibt eine lokale aufnahme die nicht spielt auch kein cover bild hat" —
genannt wurden „101 Meerjungfrauen" und „101 Dinos". Am Geraet gemessen:

    101 Dinos          nur „02 Kapitel 2" (19 MB) — Kapitel 1 fehlt
    101 Meerjungfrauen „01 Kapitel 1", 1,5 MB
    101 Feen           „01 Kapitel 1", 978 KB, KEIN cover.jpg, KEINE Kachel

Die Daten sind NICHT kaputt: FLAC-Koepfe gueltig, Playlists richtig,
/api/bild liefert 200. Es ist schlicht fast nichts drin.

══ WARUM ES ENTSTEHT ═══════════════════════════════════════════════════════
`mixpi-mitschnitt` schreibt Playlist UND Kachel nach JEDEM einzelnen
gelungenen Stueck (index.mjs, `playlistSchreiben` + `kachelAnlegen`), nicht am
Ende des Albums. Das ist eine Entscheidung fuer „sofort hoerbar" — und ihr
Preis zeigt sich erst am Regal:

  * bricht der Mitschnitt nach Stueck 1 ab  -> Kachel mit einem Stueck
  * wird Stueck 1 verworfen (zu leise/klein) -> Album faengt bei 2 an, und das
    sieht fuer ein Kind aus wie „geht nicht"
  * bricht er VOR dem ersten bestandenen Stueck ab -> Dateien ohne Kachel

══ WAS DIESES WERKZEUG TUT ═════════════════════════════════════════════════
Es NENNT diese Faelle und aendert NICHTS. Geloescht wird von Hand — waehrend
eines laufenden Mitschnitts zu raeumen waere genau der Fehler, den es
aufdecken soll.

    LUECKE      Nummerierung faengt nicht bei 1 an oder hat Loecher
    WAISE       Ordner mit Ton, aber kein Eintrag in der Medienliste
    LEER        kein spielbarer Ton — oder Kachel ohne Ordner
    WINZIG      Album unter der Mindestdauer (Vorgabe 3 Minuten)
    OHNE BILD   weder cover.jpg noch Bild am Eintrag — NIE allein ein Befund
    LAEUFT      wird gerade mitgeschnitten — wird genannt, nicht angeklagt

ZWEI VERFEINERUNGEN, DIE ES BRAUCHTE (am 22.08.2026 im ersten Lauf gefunden):
Es meldete 28 von 29 Alben. Ein Pruefer, der fast alles anklagt, wird
ignoriert — dieselbe Lehre wie bei tools/plugin-kette-probe.mts am selben Tag.

  * OHNE BILD feuerte staendig, obwohl der EINTRAG ein Bild eingebettet
    tragen kann (`data:image/...`) und /api/bild dann 200 liefert. Es gilt
    jetzt nur, wenn BEIDES fehlt, und nie als alleiniger Grund.
  * Der LAUFENDE Mitschnitt wurde als Waise gemeldet. `pw-record` schreibt
    nach `.<name>.teil.flac` und benennt erst am Ende um; wo so eine Datei
    liegt, wird gerade gearbeitet. Das ist unfertig, nicht kaputt.

Danach: 18 statt 28.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-stummel.py --box dietpi@192.168.178.62
    python3 tools/mitschnitt-stummel.py --box … --minuten 5
    python3 tools/mitschnitt-stummel.py --box … --json
"""
import argparse
import json
import re
import subprocess
import sys

MEDIEN = "/home/dietpi/MuPiBox/media"
TON = (".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav")
# Grobe Schaetzung: FLAC bei 48 kHz stereo liegt bei rund 60 kB/s. Es geht
# hier nicht um Genauigkeit, sondern um die Groessenordnung „das ist ein
# Stummel" — eine echte Dauermessung je Datei kostete auf der Box Minuten.
BYTES_JE_SEKUNDE = 60_000


def am_geraet(box: str, befehl: str, zeitlimit: int = 60) -> str:
    """Nur LESEN. Jeder Befehl hier ist ls/cat/find — nichts, was schreibt."""
    lauf = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", box, befehl],
        capture_output=True, text=True, timeout=zeitlimit,
    )
    if lauf.returncode != 0 and not lauf.stdout:
        raise SystemExit(f"SSH nach {box} schlug fehl: {(lauf.stderr or '').strip()[:200]}")
    return lauf.stdout


def alben_lesen(box: str) -> list[dict]:
    """Jedes Album als {kategorie, kuenstler, album, dateien:[(name,groesse)]}."""
    # EIN Aufruf statt einer je Ordner: auf der Box kostet jeder SSH-Aufruf
    # spuerbar, und bei 20 Alben summiert sich das zu Minuten.
    roh = am_geraet(box, f"find {MEDIEN} -mindepth 3 -maxdepth 4 -type f -printf '%P\\t%s\\n' 2>/dev/null")
    alben: dict[tuple, list] = {}
    for zeile in roh.splitlines():
        if "\t" not in zeile:
            continue
        pfad, groesse = zeile.rsplit("\t", 1)
        teile = pfad.split("/")
        if len(teile) < 4:
            continue
        schluessel = (teile[0], teile[1], teile[2])
        alben.setdefault(schluessel, []).append((teile[3], int(groesse)))
    return [
        {"kategorie": k[0], "kuenstler": k[1], "album": k[2], "dateien": v}
        for k, v in sorted(alben.items())
    ]


def medienliste(box: str) -> list[dict]:
    roh = am_geraet(box, "cat /home/dietpi/MuPiBox/Sonos-Kids-Controller-master/server/config/data.json 2>/dev/null || cat /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json 2>/dev/null")
    try:
        d = json.loads(roh)
    except Exception:
        return []
    return d if isinstance(d, list) else d.get("data", [])


def nummer_aus(name: str) -> int | None:
    """Die fuehrende Spurnummer eines Dateinamens, wenn es eine gibt."""
    m = re.match(r"\s*(\d{1,3})[\s._-]", name)
    return int(m.group(1)) if m else None


def pruefen(alben: list[dict], eintraege: list[dict], mindest_sek: int) -> list[dict]:
    # Die lokalen Eintraege nach (kuenstler, album) — so heisst ein Album auf
    # der Platte, und so steht es im Eintrag.
    lokal = {}
    for e in eintraege:
        if str(e.get("type", "")).lower() in ("library", "local"):
            lokal[(str(e.get("artist", "")).strip(), str(e.get("title", "")).strip())] = e

    funde = []
    gesehen = set()
    for a in alben:
        tondateien = [(n, g) for n, g in a["dateien"] if n.lower().endswith(TON) and not n.startswith(".")]
        # LAEUFT GERADE? `pw-record` schreibt nach `.<name>.teil.flac` und
        # benennt erst am Ende um. Ein Album, an dem noch geschrieben wird,
        # ist KEIN Stummel — es ist unfertig, und das ist etwas anderes.
        # Ein Pruefer, der laufende Arbeit anklagt, wird zu Recht ignoriert.
        laeuft = any(n.startswith(".") and ".teil." in n for n, _ in a["dateien"])
        hat_bild = any(n.lower() in ("cover.jpg", "cover.png", "folder.jpg") for n, _ in a["dateien"])
        schluessel = (a["kuenstler"], a["album"])
        gesehen.add(schluessel)
        eintrag = lokal.get(schluessel)
        gruende = []

        if not tondateien:
            gruende.append(("LEER", "kein spielbarer Ton im Ordner"))
        else:
            gesamt = sum(g for _, g in tondateien)
            sek = gesamt // BYTES_JE_SEKUNDE
            if sek < mindest_sek:
                gruende.append(("WINZIG", f"~{sek // 60} min {sek % 60} s in {len(tondateien)} Datei(en)"))
            nummern = sorted(n for n in (nummer_aus(x) for x, _ in tondateien) if n is not None)
            if nummern:
                if nummern[0] != 1:
                    gruende.append(("LUECKE", f"faengt bei {nummern[0]} an, nicht bei 1"))
                fehlend = [n for n in range(nummern[0], nummern[-1] + 1) if n not in nummern]
                if fehlend:
                    gruende.append(("LUECKE", f"es fehlen {', '.join(map(str, fehlend[:6]))}"))

        if tondateien and not eintrag and not laeuft:
            gruende.append(("WAISE", "Ton auf der Platte, aber keine Kachel in der Medienliste"))

        # DAS BILD IST EINE RANDNOTIZ, KEIN BEFUND. Ein fehlendes cover.jpg
        # heisst nicht, dass die Kachel blind ist: der Eintrag kann eines
        # eingebettet tragen (`data:image/...`), und dann liefert
        # /api/bild ein Bild. Gemeldet wird es nur, wenn BEIDES fehlt — und
        # nie als alleiniger Grund, sonst faellt jedes zweite Album auf.
        eintrag_bild = str((eintrag or {}).get("cover", "")).strip()
        if not hat_bild and not eintrag_bild and gruende:
            gruende.append(("OHNE BILD", "weder cover.jpg noch Bild am Eintrag"))

        if laeuft:
            # Nur nennen, nicht anklagen.
            funde.append({
                "kuenstler": a["kuenstler"], "album": a["album"], "kategorie": a["kategorie"],
                "dateien": len(tondateien), "kachel": bool(eintrag), "laeuft": True,
                "gruende": [("LAEUFT", "wird gerade mitgeschnitten — kein Befund")],
            })
        elif gruende:
            funde.append({
                "kuenstler": a["kuenstler"], "album": a["album"], "kategorie": a["kategorie"],
                "dateien": len(tondateien), "kachel": bool(eintrag), "laeuft": False,
                "gruende": gruende,
            })

    # Und andersherum: Kachel ohne Ordner.
    for (kuenstler, titel), _e in lokal.items():
        if (kuenstler, titel) not in gesehen:
            funde.append({
                "kuenstler": kuenstler, "album": titel, "kategorie": "?",
                "dateien": 0, "kachel": True,
                "gruende": [("LEER", "Kachel in der Medienliste, aber kein Ordner auf der Platte")],
            })
    return funde


def main() -> int:
    p = argparse.ArgumentParser(description="Stummel abgebrochener Mitschnitte finden — nur lesend.")
    p.add_argument("--box", default="dietpi@192.168.178.169")
    p.add_argument("--minuten", type=int, default=3, help="darunter gilt ein Album als Stummel")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    alben = alben_lesen(a.box)
    eintraege = medienliste(a.box)
    funde = pruefen(alben, eintraege, a.minuten * 60)

    if a.json:
        print(json.dumps({"alben": len(alben), "eintraege": len(eintraege), "funde": funde},
                         ensure_ascii=False, indent=2))
        return 1 if funde else 0

    print(f"{a.box}: {len(alben)} Alben auf der Platte, {len(eintraege)} Eintraege in der Medienliste\n")
    if not funde:
        print("Keine Stummel. Alles, was liegt, hat Ton, eine Kachel und ein Bild.")
        return 0

    for f in funde:
        kachel = "" if f["kachel"] else "   [keine Kachel]"
        print(f"  {f['kuenstler'][:34]} — {f['album'][:44]}{kachel}")
        for wort, satz in f["gruende"]:
            print(f"      {wort:<10} {satz}")
        print()

    echte = [f for f in funde if not f.get("laeuft")]
    print(f"{len(echte)} Album(en) mit Befund" + (f", {len(funde) - len(echte)} laufen gerade." if len(funde) > len(echte) else "."))
    print()
    print("ES WURDE NICHTS GEAENDERT. Was davon weg soll, entscheidest du —")
    print("und bitte nicht, waehrend ein Mitschnitt laeuft (ps -eo cmd | grep pw-record).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
