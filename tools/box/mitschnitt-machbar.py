#!/usr/bin/env python3
"""Traegt die Box einen Mitschnitt? — die zwei Blocker aus E28, gemessen.

    python3 mitschnitt-machbar.py

Muss AUF DER BOX laufen, waehrend Musik spielt. Ohne laufende Wiedergabe
misst es nichts (und sagt das).

══ DIE ZWEI FRAGEN ════════════════════════════════════════════════════════

N1 — DER MONITOR HOERT ALLES.
Der naheliegende Weg, den auch das Schwesterprojekt SpotifyRecorder geht,
ist der Monitor der Standard-Senke. Auf einem Arbeitsrechner ist das
richtig. Auf DIESER Box waere es falsch: hier sprechen auch Piper-Ansagen
("Noch fuenf Minuten") ueber dieselbe Senke, und sie landeten mitten im
Lied. Ein Archiv, in dem eine Kinderstimme "noch fuenf Minuten" sagt, ist
kein Archiv.

Die Hoffnung: `alsa_playback.librespot` ist ein eigener Knoten der Klasse
Stream/Output/Audio. Wer DEN abgreift, hoert nur Spotify.

Die Hoffnung genuegt nicht — deshalb misst dieses Werkzeug es. Es nimmt
BEIDE Wege gleichzeitig auf und spielt mittendrin einen Fremdton ueber die
Standard-Senke, genau wie eine Ansage es taete. Danach steht die Frage
nicht mehr im Raum: der Ton ist in der einen Aufnahme und in der anderen
nicht, oder die Idee ist tot.

Gemessen wird der Fremdton per Goertzel — ein Filter auf genau eine
Frequenz. Der blosse Pegel taugte nicht, denn in beiden Aufnahmen laeuft
ja Musik; die Frage ist nicht "ist da Ton?", sondern "ist da DIESER Ton?".

N3 — SCHAFFT DER PI DAS UEBERHAUPT?
Zwei Gigabyte, vier Kerne, und die Box spielt bereits ab. Wenn das
Mitschreiben die Wiedergabe stottern laesst, ist die ganze Sache erledigt,
egal wie schoen der Rest waere. Gemessen wird die Last waehrend der
Aufnahme und die anfallende Datenrate.

══ ES AENDERT NICHTS ══════════════════════════════════════════════════════

Nur Mitlesen und ein kurzer Testton. Keine Senke wird umgehaengt, keine
Einstellung veraendert, nichts an der laufenden Wiedergabe angefasst. Die
Aufnahmen landen unter /tmp und werden am Ende geloescht.
"""
from __future__ import annotations

import array
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave

DAUER_S = 12
# Wann der Fremdton kommt und wie lange er dauert (Sekunden ab Aufnahmestart).
TON_AB_S = 4.0
TON_LANG_S = 2.0
# Hoch genug, dass Musik dort wenig Energie hat — aber nicht so hoch, dass
# Entzerrer oder Bluetooth-Codec ihn wegdaempfen. Der erste Lauf nahm
# 13 kHz und fand den Ton in KEINER der beiden Aufnahmen; die Probe trug
# nicht. 3 kHz liegt im Durchlassbereich und sticht als reiner Sinus
# trotzdem aus jeder Musik heraus.
TON_HZ = 3000
RATE = 48000


def knoten() -> list[dict]:
    """Alle PipeWire-Knoten mit Name, Klasse und ID."""
    try:
        roh = subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=15).stdout
        alles = json.loads(roh)
    except Exception as f:
        print(f"pw-dump nicht lesbar: {f}", file=sys.stderr)
        return []
    aus = []
    for e in alles:
        if e.get("type") != "PipeWire:Interface:Node":
            continue
        p = (e.get("info") or {}).get("props") or {}
        aus.append({
            "id": e.get("id"),
            "name": p.get("node.name", ""),
            "klasse": p.get("media.class", ""),
            "anwendung": p.get("application.name", ""),
        })
    return aus


def sinus_schreiben(pfad: str) -> None:
    """Der Fremdton. Selbst erzeugt, damit das Werkzeug nichts voraussetzt."""
    with wave.open(pfad, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        werte = array.array("h")
        for i in range(int(RATE * TON_LANG_S)):
            # Halbe Aussteuerung: laut genug zum Messen, nicht schmerzhaft
            # fuer den, der gerade danebensitzt.
            v = int(16000 * math.sin(2 * math.pi * TON_HZ * i / RATE))
            werte.append(v)
            werte.append(v)
        w.writeframes(werte.tobytes())


def goertzel(proben: array.array, kanaele: int, hz: float) -> float:
    """Energie bei genau einer Frequenz — ohne numpy, ohne FFT.

    Der ganze Test haengt daran: in beiden Aufnahmen laeuft Musik, der
    Gesamtpegel sagt also nichts. Gefragt ist, ob GENAU dieser Ton drin ist.
    """
    n = len(proben) // kanaele
    if n < 64:
        return 0.0
    # HIER STAND `range(0, n, 2)` MIT DEM k FUER DIE VOLLE RATE — jede zweite
    # Probe genommen, aber mit der ungeteilten Abtastrate gerechnet. Damit sass
    # der Filter auf der halben Frequenz und fand den Testton in KEINER
    # Aufnahme; zwei Laeufe lang sah es aus, als trage die Probe nicht. Wer
    # dezimiert, muss die Rate mitteilen. Also gar nicht mehr dezimieren.
    k = 2 * math.cos(2 * math.pi * hz / RATE)
    s1 = s2 = 0.0
    for i in range(0, n * kanaele, kanaele):
        s0 = proben[i] + k * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(abs(s1 * s1 + s2 * s2 - k * s1 * s2)) / n


def filter_pruefen(tonpfad: str) -> bool:
    """Misst das Messinstrument ueberhaupt richtig?

    Zwei Laeufe lang meldete dieses Werkzeug "der Fremdton ist nirgends" —
    und das stimmte auch, nur lag es nicht an der Box, sondern am Filter.
    Ein Instrument, das man nicht gegen ein BEKANNTES Signal haelt, misst
    unbemerkt Unsinn. Deshalb prueft es sich jetzt selbst: an der eigenen
    Sinusdatei muss der Filter anschlagen, an Stille nicht.
    """
    treffer, _, _ = fenster(tonpfad, 0.2, TON_LANG_S - 0.2)
    stille = array.array("h", [0] * (RATE // 2) * 2)
    ruhe = goertzel(stille, 2, TON_HZ)
    ok = treffer > 100 and treffer > ruhe * 50
    print(f"  Filter an bekanntem Sinus: {treffer:.0f}, an Stille: {ruhe:.0f} — "
          f"{'brauchbar' if ok else 'UNBRAUCHBAR'}")
    return ok


# Eine Frequenz DANEBEN, die der Testton nicht enthaelt. Sie beantwortet die
# Frage, die ein blosser Sprung offen laesst: wurde bei 3000 Hz mehr, weil der
# Testton kam — oder weil die MUSIK gerade lauter wurde? Steigt die Kontrolle
# mit, war es die Musik. Ohne sie hielt dieses Werkzeug einen Sprung von 14x
# fuer den Testton, der in Wahrheit ein Beckenschlag war.
KONTROLL_HZ = 3300


def fenster(pfad: str, ab_s: float, bis_s: float) -> tuple[float, float]:
    """(Energie bei TON_HZ, mittlerer Pegel) in einem Zeitausschnitt."""
    try:
        with wave.open(pfad, "rb") as w:
            kan, breite, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
            if breite != 2:
                return (0.0, 0.0)
            w.setpos(min(int(ab_s * rate), w.getnframes()))
            roh = w.readframes(max(0, int((bis_s - ab_s) * rate)))
    except Exception:
        return (0.0, 0.0)
    if not roh:
        return (0.0, 0.0, 0.0)
    proben = array.array("h")
    proben.frombytes(roh[: len(roh) - len(roh) % 2])
    if not proben:
        return (0.0, 0.0, 0.0)
    quadrat = sum(p * p for p in proben[::17])       # Stichprobe reicht fuer den Pegel
    return (goertzel(proben, kan, TON_HZ), math.sqrt(quadrat / max(1, len(proben[::17]))),
            goertzel(proben, kan, KONTROLL_HZ))


def aufnehmen(eigenname: str, pfad: str) -> subprocess.Popen:
    """Eine Aufnahme starten — unter eigenem Namen.

    ZWEI AUFNAHMEN GLEICHZEITIG HEISSEN SONST BEIDE `pw-record:input_FL`.
    Danach ist nicht mehr zu sagen, welcher Port zu welcher Datei gehoert,
    und `pw-link` haengt womoeglich beide an dieselbe Quelle — genau der
    Fehler, der den ersten Lauf zwei identische Ergebnisse liefern liess.
    """
    return subprocess.Popen(
        ["pw-record", "-P", f'{{ node.name = "{eigenname}" }}', "--rate", str(RATE), pfad],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def umhaengen(eigenname: str, quelle: str) -> bool:
    """Die Aufnahme von ihrer selbstgewaehlten Quelle loesen und an `quelle` haengen.

    WARUM NICHT `--target`: PipeWire 1.4 nimmt die Knoten-Nummer eines
    Stream/Output/Audio zwar entgegen, verlinkt aber trotzdem auf den
    Monitor der Standard-Senke — ohne Fehlermeldung. Dasselbe gilt fuer
    PIPEWIRE_NODE. Beides am Geraet gemessen (16.08.2026). Nur der
    ausdrueckliche `pw-link` trifft wirklich den gemeinten Knoten.
    """
    try:
        roh = subprocess.run(["pw-link", "-l"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return False

    # Was hat sich pw-record selbst ausgesucht? Das muss zuerst weg, sonst
    # laufen beide Quellen zusammen in eine Datei.
    ziel_port = None
    for zeile in roh.splitlines():
        if zeile.startswith(f"{eigenname}:input_"):
            ziel_port = zeile.strip()
        elif ziel_port and zeile.strip().startswith("|<-"):
            subprocess.run(["pw-link", "-d", zeile.strip()[3:].strip(), ziel_port],
                           capture_output=True, timeout=10)

    ok = True
    for kanal in ("FL", "FR"):
        e = subprocess.run(["pw-link", f"{quelle}:output_{kanal}", f"{eigenname}:input_{kanal}"],
                           capture_output=True, text=True, timeout=10)
        if e.returncode != 0:
            ok = False
    return ok


def haengt_an(eigenname: str) -> list[str]:
    """Woran die Aufnahme WIRKLICH haengt — nicht, woran sie haengen sollte."""
    try:
        roh = subprocess.run(["pw-link", "-l"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return []
    quellen, drin = [], False
    for zeile in roh.splitlines():
        if zeile.startswith(f"{eigenname}:input_"):
            drin = True
        elif drin and zeile.strip().startswith("|<-"):
            quellen.append(zeile.strip()[3:].strip().rsplit(":", 1)[0])
        elif drin and not zeile.startswith(" "):
            drin = False
    return sorted(set(quellen))


def last() -> float:
    """Systemlast (1-Minuten-Mittel) — grob, aber vergleichbar ueber die Zeit."""
    try:
        return os.getloadavg()[0]
    except Exception:
        return -1.0


def main() -> int:
    print("══ Traegt die Box einen Mitschnitt? ══\n")

    alle = knoten()
    if not alle:
        return 2

    stroeme = [k for k in alle if k["klasse"] == "Stream/Output/Audio"]
    senken = [k for k in alle if k["klasse"] == "Audio/Sink"]

    print("── Was gerade Ton macht ──")
    for k in stroeme:
        print(f"  Strom  id={k['id']:<5} {k['name']}")
    if not stroeme:
        print("  KEINER. Ohne laufende Wiedergabe misst dieses Werkzeug nichts.")
        print("  Erst etwas abspielen, dann noch einmal.")
        return 3
    for k in senken:
        print(f"  Senke  id={k['id']:<5} {k['name']}")

    # Die Quelle: bevorzugt librespot, sonst der erste Strom ueberhaupt.
    quelle = next((k for k in stroeme if "librespot" in k["name"].lower()), stroeme[0])
    # Der Vergleichsweg: der Monitor der Senke, an der wirklich alles ankommt.
    senke = next((k for k in senken if k["name"] == "ueberall"), senken[0] if senken else None)
    if not senke:
        print("Keine Senke gefunden.", file=sys.stderr)
        return 3

    print(f"\n  Abgriff je Quelle : id={quelle['id']} {quelle['name']}")
    print(f"  Abgriff am Monitor: id={senke['id']} {senke['name']}")

    ordner = tempfile.mkdtemp(prefix="mitschnitt-probe-")
    a_strom = os.path.join(ordner, "quelle.wav")
    a_monitor = os.path.join(ordner, "monitor.wav")
    ton = os.path.join(ordner, "fremdton.wav")
    sinus_schreiben(ton)

    print("\n── Zuerst das Messinstrument selbst ──")
    if not filter_pruefen(ton):
        print("  Der Filter findet den Ton nicht einmal in der Datei, die ihn ENTHAELT.")
        print("  Alles Weitere waere geraten. Abbruch.")
        return 4

    print(f"\n── Aufnahme, {DAUER_S} s, beide Wege gleichzeitig ──")
    last_vorher = last()
    laeufe = []
    try:
        laeufe.append(aufnehmen("probe-quelle", a_strom))
        laeufe.append(aufnehmen("probe-monitor", a_monitor))
        time.sleep(1.5)                      # bis die Ports in der Graphik stehen

        umhaengen("probe-quelle", quelle["name"])
        # Der Monitor-Weg bleibt, wo pw-record von selbst hinfindet: an der
        # Senke, ueber die alles laeuft. Genau das ist ja der Vergleichsfall.
        print(f"  Quelle  haengt an: {', '.join(haengt_an('probe-quelle')) or 'NICHTS'}")
        print(f"  Monitor haengt an: {', '.join(haengt_an('probe-monitor')) or 'NICHTS'}")

        time.sleep(max(0, TON_AB_S - 1.5))
        print(f"  {TON_AB_S:.0f} s: Fremdton ({TON_HZ} Hz) auf die Standard-Senke — "
              "wie eine Ansage")
        e = subprocess.run(["pw-play", ton], capture_output=True, text=True,
                           timeout=TON_LANG_S + 8)
        if e.returncode != 0:
            print(f"  pw-play scheiterte: {(e.stderr or '').strip()[:120]}")
        last_waehrend = last()
        time.sleep(max(0, DAUER_S - TON_AB_S - TON_LANG_S))
    finally:
        for p in laeufe:
            p.terminate()
        time.sleep(1)
        for p in laeufe:
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()

    for p, weg in zip(laeufe, ("Quelle", "Monitor")):
        if p.stderr:
            meldung = p.stderr.read().decode(errors="replace").strip()
            if meldung:
                print(f"  {weg}: {meldung.splitlines()[0]}")

    print("\n── N1: Steckt der Fremdton in der Aufnahme? ──")
    urteil_n1 = None
    zeilen = []
    for pfad, weg in ((a_strom, "Abgriff je Quelle "), (a_monitor, "Abgriff am Monitor")):
        gross = os.path.getsize(pfad) if os.path.exists(pfad) else 0
        if gross < 100_000:
            zeilen.append((weg, None, None, gross))
            continue
        # Vor dem Ton gegen waehrend des Tons — in DERSELBEN Aufnahme, damit
        # unterschiedliche Musiklautstaerke das Ergebnis nicht faelscht.
        ruhe, _, ruhe_k = fenster(pfad, 0.5, TON_AB_S - 0.5)
        mit, pegel, mit_k = fenster(pfad, TON_AB_S + 0.3, TON_AB_S + TON_LANG_S - 0.3)
        sprung = (mit / ruhe) if ruhe > 0.0001 else (999.0 if mit > 0.01 else 0.0)
        # Der Sprung ALLEIN beweist nichts: auch Musik wird lauter. Erst im
        # Verhaeltnis zur Nachbarfrequenz wird daraus eine Aussage.
        sprung_k = (mit_k / ruhe_k) if ruhe_k > 0.0001 else (999.0 if mit_k > 0.01 else 1.0)
        zeilen.append((weg, sprung / max(sprung_k, 0.001), pegel, gross, sprung, sprung_k))

    for weg, klar, pegel, gross, sprung, sprung_k in zeilen:
        if klar is None:
            print(f"  {weg}: NICHTS AUFGENOMMEN ({gross} Bytes)")
            continue
        drin = "JA — der Fremdton ist drin" if klar > 10 else "nein — nur die Musik"
        print(f"  {weg}: {drin}")
        print(f"      {TON_HZ} Hz stieg um {sprung:>9.1f}x, die Kontrolle bei "
              f"{KONTROLL_HZ} Hz um {sprung_k:>6.1f}x  → {klar:>8.1f}x deutlicher")

    q = next((z for z in zeilen if z[0].startswith("Abgriff je Quelle")), None)
    m = next((z for z in zeilen if z[0].startswith("Abgriff am Monitor")), None)
    if q and m and q[1] is not None and m[1] is not None:
        if m[1] > 10 and q[1] <= 10:
            urteil_n1 = ("GEHT", "Der Abgriff je Quelle hoert die Ansage NICHT — "
                                "genau das, was E28/N1 verlangt.")
        elif m[1] > 10 and q[1] > 10:
            urteil_n1 = ("GEHT NICHT", "Auch der Abgriff je Quelle hoert die Ansage. "
                                       "Der Strom-Knoten trennt nicht.")
        else:
            urteil_n1 = ("UNKLAR", "Der Fremdton war nicht einmal im Monitor zu finden — "
                                   "die Probe selbst hat nicht getragen.")

    print("\n── N3: Was kostet es? ──")
    print(f"  Last vorher   {last_vorher:.2f}")
    print(f"  Last waehrend {last_waehrend:.2f}   (zwei Aufnahmen gleichzeitig)")
    for pfad, weg in ((a_strom, "Quelle "), (a_monitor, "Monitor")):
        if os.path.exists(pfad) and os.path.getsize(pfad) > 1000:
            mb_h = os.path.getsize(pfad) / DAUER_S * 3600 / 1024 / 1024
            print(f"  {weg}: {os.path.getsize(pfad)/1024/1024:.1f} MB in {DAUER_S} s "
                  f"= {mb_h:.0f} MB/h roh (WAV, unkomprimiert)")

    print("\n── URTEIL ──")
    if urteil_n1:
        print(f"  N1  {urteil_n1[0]}: {urteil_n1[1]}")
    else:
        print("  N1  nicht zu beurteilen — siehe oben.")
    print("  N3  Rohdaten: eine Stunde Musik sind ~600 MB als WAV. Das ist der")
    print("      Grund fuer Kompression, nicht die Rechenlast.")

    for p in (a_strom, a_monitor, ton):
        try:
            os.remove(p)
        except Exception:
            pass
    try:
        os.rmdir(ordner)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
