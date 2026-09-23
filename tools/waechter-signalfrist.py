#!/usr/bin/env python3
"""GEHT DER WAECHTER AUF SIGTERM? — und zwar nachmessbar, nicht behauptet.

    python3 tools/waechter-signalfrist.py                  # hier
    python3 tools/waechter-signalfrist.py --box 192.168.178.169

WARUM ES DIESES WERKZEUG GIBT
─────────────────────────────
In `scripts/OnOffShim/taster_wache.py` und in `config/services/mupi_offtrigger.service`
stand als AM GERAET GEMESSEN, ein `threading.Event.wait()` OHNE Frist ueberlebe
SIGTERM und SIGINT, erst `kill -9` beende den Helfer. Daraus wurde die
Warteschleife `while not ende.wait(1.0)` begruendet.

DIE BEHAUPTUNG LAESST SICH NICHT NACHSTELLEN. Am 08.08.2026 in vier Fassungen
versucht — auf dem Arbeitsrechner und auf der Box .169, jeweils direkt und
unter `sudo`, und das Signal einmal an den Python-Prozess und einmal an den
`sudo`-Wrapper —, endete der Prozess JEDES MAL sauber nach rund 100 ms.
`/proc/<pid>/wchan` stand dabei tatsaechlich auf `futex_do_wait`, genau wie
dort notiert; das ist aber kein Beleg fuer Unterbrechbarkeit, sondern nur die
normale Wartestelle.

WARUM ES AUCH THEORETISCH GEHT: Python fuehrt Signalhandler wirklich nur im
Hauptfaden und nur zwischen zwei Bytekode-Schritten aus — das steht dort
richtig. Aber CPython nimmt auf POSIX fuer `lock.acquire()` im HAUPTFADEN den
unterbrechbaren Weg (`PyThread_acquire_lock_timed` mit `intr_flag`): das
Signal bricht das Warten ab, der Handler laeuft, und `Event.wait()` geht danach
in den Futex zurueck oder kehrt zurueck. In einem NEBENFADEN waere die
Behauptung richtig — dort wartet er wirklich unterbrechbar-frei. `main()` ruft
`warten_bis_ende` aber aus dem Hauptfaden.

WAS DAS FUER DEN CODE HEISST: die Frist von 1 s ist NICHT falsch und darf
bleiben — sie kostet nichts und macht die Wartestelle unabhaengig davon, in
welchem Faden sie einmal landet. Falsch war die BEGRUENDUNG, und eine falsche
Begruendung ist teurer als keine: wer sie glaubt, sucht den naechsten
Haenger an der falschen Stelle.

DIESES WERKZEUG ist die Gegenprobe dazu. Es faehrt beide Warteformen und
beide Signalwege und sagt, wie lange das Beenden gedauert hat. Wird die
Behauptung eines Tages doch wahr — anderer Python-Stand, anderer Kernel —,
faellt es hier auf, und zwar rot.
"""

from __future__ import annotations

import argparse
import shlex
import subprocess
import sys

# Das Probeprogramm laeuft DRUEBEN, also als Text. Es baut genau die Lage nach,
# die `taster_wache.main()` herstellt: Handler fuer SIGTERM und SIGINT, die ein
# Event setzen, und danach das Warten darauf.
PROBE = r'''
import sys, signal, threading
ende = threading.Event()
def abwinken(_s, _r): ende.set()
signal.signal(signal.SIGTERM, abwinken)
signal.signal(signal.SIGINT, abwinken)
print("BEREIT", flush=True)
if sys.argv[1] == "ohne":
    ende.wait()                      # die alte Form
else:
    while not ende.wait(1.0):        # die Form, die heute im Helfer steht
        pass
print("ENDE", flush=True)
'''

# Der Treiber startet die Probe, wartet auf „BEREIT", schiesst und misst.
# `$1` = Warteform (ohne|mit), `$2` = wohin das Signal geht (kind|wrapper).
TREIBER = r'''
form="$1"; ziel="$2"; unter="$3"
# OHNE PASSWORTFREIES sudo IST DER FALL NICHT MESSBAR — und ein nicht messbarer
# Fall darf nicht als Fehlschlag durchgehen. Genau diese Sorte stiller Rotfaerbung
# waere derselbe Fehler wie der, den dieses Werkzeug aufklaert.
if [ "$unter" = sudo ] && ! sudo -n true 2>/dev/null; then
    echo "ERGEBNIS $form $ziel $unter uebersprungen -1 0 kein-passwortfreies-sudo"
    exit 0
fi
aus=$(mktemp); marke="signalfrist-$$-$form"
if [ "$unter" = sudo ]; then
    sudo -n python3 -c "$PROBE_TEXT" "$form" "$marke" > "$aus" 2>&1 &
else
    python3 -c "$PROBE_TEXT" "$form" "$marke" > "$aus" 2>&1 &
fi
wrapper=$!
for _ in $(seq 1 200); do grep -q BEREIT "$aus" 2>/dev/null && break; sleep 0.05; done
kind=$(pgrep -f "$marke" | tail -1)
[ -z "$kind" ] && { echo "ERGEBNIS $form $ziel $unter - kein-kind"; rm -f "$aus"; exit 0; }
wchan=$(cat /proc/$kind/wchan 2>/dev/null || echo "?")
if [ "$ziel" = wrapper ]; then schuss=$wrapper; else schuss=$kind; fi
start=${EPOCHREALTIME/,/.}
sudo -n kill -TERM "$schuss" 2>/dev/null || kill -TERM "$schuss" 2>/dev/null
weg=nein
for _ in $(seq 1 60); do
    kill -0 "$kind" 2>/dev/null || { weg=ja; break; }
    sudo -n kill -0 "$kind" 2>/dev/null || { weg=ja; break; }
    sleep 0.1
done
ende=${EPOCHREALTIME/,/.}
dauer=$(awk -v a="$start" -v b="$ende" 'BEGIN{printf "%.0f", (b-a)*1000}')
sauber=$(grep -c ENDE "$aus" 2>/dev/null || echo 0)
[ "$weg" = nein ] && { sudo -n kill -9 "$kind" 2>/dev/null; kill -9 "$kind" 2>/dev/null; }
echo "ERGEBNIS $form $ziel $unter $weg $dauer $sauber $wchan"
rm -f "$aus"
'''

FAELLE = [
    ("ohne", "kind", "direkt"),
    ("ohne", "kind", "sudo"),
    ("ohne", "wrapper", "sudo"),
    ("mit", "kind", "direkt"),
    ("mit", "kind", "sudo"),
]


def fahren(fall, box: str | None) -> dict:
    form, ziel, unter = fall
    skript = f"PROBE_TEXT={shlex.quote(PROBE)}\n{TREIBER}"
    befehl = ["bash", "-s", form, ziel, unter]
    if box:
        # Das Skript geht ueber die Standardeingabe, die Argumente hinterher.
        fern = f"bash -s {form} {ziel} {unter}"
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", f"dietpi@{box}", fern],
            input=skript, capture_output=True, text=True, timeout=180,
        )
    else:
        p = subprocess.run(befehl, input=skript, capture_output=True, text=True, timeout=180)

    for zeile in p.stdout.splitlines():
        if zeile.startswith("ERGEBNIS "):
            t = zeile.split()
            if len(t) >= 8:
                return {"form": t[1], "ziel": t[2], "unter": t[3], "weg": t[4],
                        "ms": int(t[5]), "sauber": int(t[6]), "wchan": t[7]}
            return {"form": form, "ziel": ziel, "unter": unter, "weg": "?",
                    "ms": -1, "sauber": 0, "wchan": "?"}
    return {"form": form, "ziel": ziel, "unter": unter, "weg": "?",
            "ms": -1, "sauber": 0, "wchan": p.stderr.strip()[:60] or "?"}


def main(argv=None) -> int:
    z = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    z.add_argument("--box", metavar="ADRESSE",
                   help="auf der Box messen statt hier (z. B. 192.168.178.169)")
    a = z.parse_args(argv)

    wo = f"auf der Box {a.box}" if a.box else "auf diesem Rechner"
    print(f"══ Warten auf SIGTERM — gemessen {wo} ══\n")
    print(f"  {'Warteform':<12}{'Signal an':<12}{'gestartet':<10}"
          f"{'beendet':<10}{'Dauer':>8}   wchan beim Schuss")
    print("  " + "─" * 74)

    schlecht = []
    uebersprungen = []
    for fall in FAELLE:
        e = fahren(fall, a.box)
        wf = "ende.wait()" if e["form"] == "ohne" else "wait(1.0)"
        dauer = f"{e['ms']} ms" if e["ms"] >= 0 else "—"
        if e["weg"] == "uebersprungen":
            endet = "übersprg."
        else:
            endet = "ja" if e["weg"] == "ja" else "NEIN"
        print(f"  {wf:<12}{e['ziel']:<12}{e['unter']:<10}{endet:<10}{dauer:>8}   {e['wchan']}")
        if e["weg"] == "uebersprungen":
            uebersprungen.append(f"{wf} unter {e['unter']} ({e['wchan']})")
            continue
        # Der Fall, der zaehlt: das Signal geht an den Python-Prozess selbst.
        if e["ziel"] == "kind" and (e["weg"] != "ja" or e["sauber"] < 1):
            schlecht.append(f"{wf} unter {e['unter']}: endet nicht sauber auf SIGTERM")

    print()
    if uebersprungen:
        print("Nicht gemessen (und darum auch nicht behauptet):")
        for u in uebersprungen:
            print(f"  * {u}")
        print()
    if schlecht:
        print("ROT — die alte Begruendung waere hier doch richtig:")
        for s in schlecht:
            print(f"  * {s}")
        return 1

    print("GRUEN — beide Warteformen gehen auf SIGTERM, und zwar sauber.")
    print("Die Frist in `warten_bis_ende` bleibt richtig; ihre urspruengliche")
    print("Begruendung (‚ueberlebt SIGTERM, erst kill -9 hilft') war es nicht.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
