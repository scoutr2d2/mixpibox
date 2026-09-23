#!/usr/bin/env python3
"""
WIE LAUT IST WELCHE QUELLE? — gemessen in LUFS, und dabei STUMM.

══ DER FALL, WEGEN DEM ES DAS GIBT ═══════════════════════════════════════════
Betreiber, 22.08.2026: „und von spotify zu mpv?" — der Lautstaerkesprung beim
Wechsel der Quelle. Er ist real und nicht ausgeglichen:

    lokale Dateien   mpv       ReplayGain track (seit 21.08.)
    Spotify          soloist   GAR NICHTS — soloist kennt nur --initial-volume

Dazu kommt, dass ReplayGain auf etwa -18 LUFS zielt und Spotify typisch lauter
liefert. Selbst wenn soloist normalisieren koennte, waeren es zwei Ziele.

DIE BOX HAT DEN REGLER SCHON: „Wie laut — je Quelle" auf der Ton-Seite, und
WirePlumber merkt sich den Wert je Anwendung. Was fehlte, war die ZAHL: um
wieviel dB muss man schieben? Nach Gehoer zu raten trifft es nicht, und ein
geratener Wert im Quelltext waere Pfusch.

══ WARUM ES STUMM MISST ══════════════════════════════════════════════════════
Betreiber: „geht die messung stumm es ist schon spaet".

Ja. Der Strom wird fuer die Dauer der Messung auf eine NULL-SENKE umgeleitet
(`module-null-sink`) und dort am Monitor abgegriffen. Nichts erreicht die
Lautsprecher — man kann also nachts messen, waehrend nebenan jemand schlaeft.

DER PREIS IST EHRLICH ZU NENNEN: waehrend gemessen wird, HOERT MAN NICHTS.
Wer danebensteht und Musik erwartet, denkt, die Box sei abgestuerzt. Deshalb
sagt das Werkzeug vorher, wie lange es still sein wird.

══ UND WARUM ES ZURUECKRAEUMT, KOMME WAS WOLLE ═══════════════════════════════
EIN MESSWERKZEUG, DAS DIE BOX STUMM ZURUECKLAESST, IST EIN FEHLER — schlimmer
als gar keine Messung, denn niemand sucht die Ursache in einem Werkzeug, das
„nur gemessen" hat. Der Rueckweg steht deshalb in einem `finally`, laeuft auch
bei Strg-C, und die Null-Senke wird in jedem Fall wieder entladen.

══ AUFRUF ════════════════════════════════════════════════════════════════════
    tools/box/pegelvergleich.py                    # alles, was gerade laeuft
    tools/box/pegelvergleich.py --sekunden 30
    tools/box/pegelvergleich.py --quelle Spotify
    tools/box/pegelvergleich.py --datei /home/dietpi/MuPiBox/media/…/01.mp3

WAS LAUFEN MUSS: Fuer Spotify muss die Wiedergabe LAUFEN — das Werkzeug
startet sie nicht (das waere eine Fernbedienung, und die Kinderzeit hat dazu
etwas zu sagen). Fuer eine lokale Datei genuegt `--datei`; die spielt es
selbst ab, direkt in die Null-Senke, ohne die Box anzufassen.

FUER NEUE DIENSTE GEBAUT (Betreiber: „das werkzeug brauchen wir auch fuer neue
dienste vielleicht"): es kennt keine Dienstnamen. Es misst, was der Tonserver
als Strom fuehrt — heisst der morgen „Jellyfin" oder „Radio", steht er ohne
Aenderung in der Liste.
"""

import argparse
import json
import re
import shlex
import subprocess
import sys

NULL_SENKE = "mixpi-messsenke"


def ssh(box: str, befehl: str, frist: int = 60, versuche: int = 3) -> subprocess.CompletedProcess:
    """
    Ein Befehl auf der Box, mit Wiederholung.

    Drei Anlaeufe aus demselben Grund wie in kanaltest.py: von zwei Laeufen
    gegen dieselbe erreichbare Box scheitert jeder zweite am Netz (laufende
    Netzabriss-Spur). Ein Werkzeug, das daran scheitert, misst die Netzlage.
    """
    letzte = None
    for _ in range(versuche):
        try:
            letzte = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"dietpi@{box}", befehl],
                capture_output=True,
                text=True,
                timeout=frist,
            )
            if letzte.returncode == 0:
                return letzte
        except subprocess.TimeoutExpired:
            letzte = subprocess.CompletedProcess([], 124, "", "Frist gerissen")
    return letzte


def stroeme_lesen(box: str) -> list[dict]:
    """Die laufenden Sink-Inputs mit Name und Ziel-Senke."""
    r = ssh(box, "export XDG_RUNTIME_DIR=/run/user/1000; pactl -f json list sink-inputs")
    if r.returncode != 0:
        return []
    try:
        roh = json.loads(r.stdout)
    except json.JSONDecodeError:
        return []
    raus = []
    for e in roh:
        p = e.get("properties", {}) or {}
        name = p.get("application.name") or p.get("media.name") or p.get("node.name") or "?"
        # DURCHGANGSSTATIONEN SIND KEINE QUELLEN. `entzerrer.ausgang` und
        # `klangwerk.ausgang` tauchen als Sink-Input auf, sind aber der
        # Signalweg selbst — sie zu messen ergaebe den Mix, nicht die Quelle.
        if "ausgang" in str(p.get("node.name", "")):
            continue
        raus.append({"kennung": e.get("index"), "name": name, "sink": e.get("sink")})
    return raus


def lufs_aus(text: str) -> float | None:
    """
    Den integrierten Wert aus der ffmpeg-Zusammenfassung holen.

    ffmpeg schreibt die Zusammenfassung nach stderr, und die interessante
    Zeile steht unter „Integrated loudness". NICHT die letzte „I:"-Zeile des
    laufenden Bandes nehmen — die ist ein Momentanwert und schwankt mit der
    Musik; der integrierte Wert ist der ueber die ganze Messung.
    """
    m = re.search(r"Integrated loudness:.*?I:\s*(-?\d+\.?\d*)\s*LUFS", text, re.S)
    return float(m.group(1)) if m else None


def messen(box: str, kennung: int | None, sekunden: float, datei: str | None) -> float | None:
    """
    Einen Strom stumm messen. Gibt LUFS zurueck oder None.

    DER RUECKWEG STEHT IN `finally`. Bricht irgendetwas ab — Netz, Strg-C,
    ein Fehler in ffmpeg — wird der Strom zurueckgeschoben und die Null-Senke
    entladen. Sonst bliebe die Box stumm, und niemand suchte die Ursache hier.
    """
    vorher = None
    if kennung is not None:
        for s in stroeme_lesen(box):
            if s["kennung"] == kennung:
                vorher = s["sink"]
                break
        if vorher is None:
            print(f"    Strom {kennung} ist verschwunden — spielt er noch?", file=sys.stderr)
            return None

    lade = (
        "export XDG_RUNTIME_DIR=/run/user/1000; "
        f"pactl load-module module-null-sink sink_name={NULL_SENKE} "
        f"sink_properties=device.description={NULL_SENKE}"
    )
    r = ssh(box, lade)
    if r.returncode != 0:
        print(f"    Null-Senke liess sich nicht anlegen: {r.stderr.strip()[:120]}", file=sys.stderr)
        return None
    modul = r.stdout.strip().splitlines()[-1].strip() if r.stdout.strip() else ""

    try:
        if kennung is not None:
            ssh(box, f"export XDG_RUNTIME_DIR=/run/user/1000; pactl move-sink-input {kennung} {NULL_SENKE}")
            quelle = f"{NULL_SENKE}.monitor"
            aufnahme = f"timeout {int(sekunden) + 5} pw-record --target={quelle} -"
        else:
            # `--datei`: mpv spielt selbst in die Null-Senke. Die Box wird
            # dabei nicht angefasst — kein Strom wird verschoben.
            aufnahme = (
                f"timeout {int(sekunden) + 5} mpv --no-video --no-terminal --really-quiet "
                f"--audio-device=pulse/{NULL_SENKE} --replaygain=track {shlex.quote(datei or '')} "
                f"& sleep 1; timeout {int(sekunden)} pw-record --target={NULL_SENKE}.monitor -"
            )
        befehl = (
            "export XDG_RUNTIME_DIR=/run/user/1000; "
            f"{aufnahme} 2>/dev/null | "
            f"timeout {int(sekunden) + 20} ffmpeg -hide_banner -f wav -i - -af ebur128 -f null - 2>&1 | tail -30"
        )
        r = ssh(box, befehl, frist=int(sekunden) + 60)
        return lufs_aus(r.stdout + r.stderr)
    finally:
        if kennung is not None and vorher is not None:
            # ZURUECK, KOMME WAS WOLLE. Der Zielname statt der Nummer: Senken
            # koennen zwischendurch neu nummeriert werden.
            ssh(box, f"export XDG_RUNTIME_DIR=/run/user/1000; pactl move-sink-input {kennung} {vorher}")
        if modul.isdigit():
            ssh(box, f"export XDG_RUNTIME_DIR=/run/user/1000; pactl unload-module {modul}")
        else:
            ssh(box, f"export XDG_RUNTIME_DIR=/run/user/1000; pactl unload-module module-null-sink 2>/dev/null || true")


def main() -> int:
    p = argparse.ArgumentParser(description="Pegel der Tonquellen vergleichen — stumm, in LUFS")
    p.add_argument("box", nargs="?", default="mixpibox.local")
    p.add_argument("--sekunden", type=float, default=20.0, help="Messdauer je Quelle (Vorgabe 20)")
    p.add_argument("--quelle", help="nur diese messen (Teil des Namens genuegt)")
    p.add_argument("--datei", help="statt eines laufenden Stroms diese Datei messen (spielt selbst, stumm)")
    a = p.parse_args()

    print(f"== Box {a.box} ==")
    if ssh(a.box, "echo da").returncode != 0:
        print("Die Box war in drei Anlaeufen nicht erreichbar.", file=sys.stderr)
        return 1

    if a.datei:
        print(f"Messe DATEI {a.datei} — {a.sekunden:.0f} s, stumm.\n")
        w = messen(a.box, None, a.sekunden, a.datei)
        print(f"  {a.datei}: {w:+.1f} LUFS" if w is not None else "  nicht messbar")
        return 0 if w is not None else 1

    stroeme = stroeme_lesen(a.box)
    if a.quelle:
        stroeme = [s for s in stroeme if a.quelle.lower() in s["name"].lower()]
    if not stroeme:
        print(
            "Es laeuft gerade keine Quelle (oder keine passt zu --quelle).\n"
            "Fuer Spotify muss die Wiedergabe LAUFEN — dieses Werkzeug startet sie nicht.\n"
            "Eine lokale Datei geht ohne alles: --datei <pfad>",
            file=sys.stderr,
        )
        return 1

    print(f"Gefunden: {', '.join(s['name'] for s in stroeme)}")
    print(f"Je Quelle {a.sekunden:.0f} s STILLE — der Ton geht solange in eine Null-Senke.\n")

    werte: dict[str, float] = {}
    for s in stroeme:
        print(f"  messe {s['name']} …", flush=True)
        w = messen(a.box, s["kennung"], a.sekunden, None)
        if w is None:
            print("    nicht messbar")
            continue
        werte[s["name"]] = w
        print(f"    {w:+.1f} LUFS")

    print()
    if len(werte) < 2:
        print(
            "Fuer einen VERGLEICH braucht es zwei Quellen. Lass beide gleichzeitig laufen\n"
            "(Spotify spielen und daneben eine lokale Datei) — oder miss die zweite mit --datei.",
        )
        return 0

    print("== Unterschied ==")
    namen = list(werte)
    for i, links in enumerate(namen):
        for rechts in namen[i + 1 :]:
            d = werte[links] - werte[rechts]
            lauter, leiser = (links, rechts) if d > 0 else (rechts, links)
            print(f"  {lauter} ist {abs(d):.1f} dB lauter als {leiser}")
            # PROZENT STATT dB, weil der Regler der Ton-Seite in Prozent
            # steht. PulseAudio/PipeWire rechnen dort kubisch: 100 % ist
            # voll, und -6 dB liegen bei etwa 79 %.
            faktor = 10 ** (-abs(d) / 20)
            prozent = round(100 * faktor ** (1 / 3))
            # Typografisch schliessen: ein gerades " beendet hier den f-String
            # ([[backticks-beenden-jede-vorlage]] in seiner Python-Fassung).
            print(f"    -> {lauter} auf etwa {prozent} % stellen (Ton-Seite, „Wie laut — je Quelle“)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nAbgebrochen — der Rueckweg lief trotzdem (finally).", file=sys.stderr)
        sys.exit(130)
