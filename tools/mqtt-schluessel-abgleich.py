#!/usr/bin/env python3
"""
Was `mqtt.py` LIEST gegen das, was dieses Repo ANLEGT.

WOZU: Am 03.08.2026 kam die Frage auf, warum `mupi_mqtt` auf der Box zwar
`enabled` ist, aber nicht laeuft. Der naheliegende Verdacht — „der Schalter
`mqtt.active` steht auf false" — ist NACHWEISLICH falsch: das Skript liest
diesen Schalter zwar in eine Variable, wertet ihn aber nirgends aus. Wenn also
etwas den Start verhindert, ist es nicht der Schalter.

Dieses Werkzeug beantwortet die Frage, die dann uebrig bleibt: liest `mqtt.py`
einen Schluessel, den in diesem Repo niemand anlegt? Ein solcher Zugriff ist
ein `KeyError` in der ERSTEN Sekunde nach dem Start — und die Unit hat
`Restart=on-abort`, greift bei einem gewoehnlichen Fehlerausstieg (Code 1) also
nicht. Ergebnis: eingeschaltet, tot, kein Neuversuch.

WAS ES AENDERT: NICHTS. Es liest drei Dateien und rechnet.

WAS ES NICHT KANN: sagen, was auf DER Box steht. Deren Konfiguration ist
gewachsen und kann Schluessel enthalten, die dieses Repo nie angelegt hat.
Die Gegenprobe am Geraet lautet:

    ssh pi@<box> "sudo systemctl status mupi_mqtt --no-pager -l"
    ssh pi@<box> "jq '.mqtt | keys' /etc/mupibox/mupiboxconfig.json"

LIES DAS, BEVOR DU DIESES WERKZEUG FUER EINE ENTDECKUNG HAELTST
(nachgetragen am 03.08.2026 abends): Das Wissenspaket kannte den Fall
BEREITS — [[mupi-mqtt-reparatur]], gemessen am 30.07.2026, mit genau diesen
drei Befunden (zwei fehlende Python-Module, fehlendes `mqtt.name`,
wirkungsloser `active`-Schalter) und einer Reparatur auf BEIDEN Boxen. Dieses
Werkzeug entstand, ohne vorher nachzusehen, und hat einen bekannten Befund
nachgebaut.

WOFUER ES TROTZDEM TAUGT — und nur dafuer: Repariert wurde im
remote-step-installer und auf den Geraeten, NICHT hier. Dieses Werkzeug misst
die Luecke DIESES REPOS, und eine frische SD bringt den Fehler zurueck,
solange sie besteht (Zwei-Repos-Delta, BACKLOG E12). Es ist also ein
Pruefschritt fuer den Ausrollweg, keine Diagnose.

UND EINE WARNUNG AN DEN, DER ES REPARIERT: `mqtt.name` allein nachzulegen ist
schlimmer als nichts. Der Dienst wird dadurch startfaehig, und weil `active`
nichts schaltet, laeuft er dann auf JEDER frischen Box gegen den
Beispiel-Broker. Der Schluessel und die ExecCondition-Ergaenzung aus
[[mupi-mqtt-reparatur]] gehoeren zusammen.

AUFRUF
    python3 tools/mqtt-schluessel-abgleich.py
    python3 tools/mqtt-schluessel-abgleich.py --json
"""

import json
import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKRIPT = os.path.join(WURZEL, "scripts/mqtt/mqtt.py")
VORLAGE = os.path.join(WURZEL, "config/templates/mupiboxconfig.json")
UPDATE = os.path.join(WURZEL, "update/conf_update.sh")
UNIT = os.path.join(WURZEL, "config/services/mupi_mqtt.service")


def gelesene_schluessel() -> list:
    """
    Welche `jsonconfig['mqtt'][...]` greift das Skript ab?

    Gesucht wird die AUSGESCHRIEBENE Form. Ein Zugriff ueber eine Variable
    (`jsonconfig['mqtt'][name]`) faende dieses Muster nicht — bislang kommt so
    einer im Skript nicht vor, und wenn doch, faellt es hier auf, weil die
    Zahlen dann nicht mehr zusammenpassen.
    """
    text = open(SKRIPT, encoding="utf-8").read()
    muster = re.compile(r"jsonconfig\['mqtt'\]\['([^']+)'\]")
    raus = []
    for t in muster.finditer(text):
        if t.group(1) not in raus:
            raus.append(t.group(1))
    return raus


def wird_ausgewertet(name: str) -> bool:
    """
    Steht die Variable `mqtt_<name>` irgendwo in einer Bedingung?

    Grob, aber ausreichend fuer die eine Frage, um die es geht: wirkt der
    Schalter `active` ueberhaupt? Gesucht wird das Vorkommen ausserhalb der
    Zuweisung und ausserhalb der `global`-Zeile.
    """
    text = open(SKRIPT, encoding="utf-8").read()
    var = f"mqtt_{name}"
    treffer = 0
    for zeile in text.splitlines():
        blank = zeile.strip()
        if blank.startswith("global "):
            continue
        if re.match(rf"\s*{re.escape(var)}\s*=", zeile):
            continue
        if re.search(rf"\b{re.escape(var)}\b", zeile):
            treffer += 1
    return treffer > 0


def angelegte_schluessel() -> set:
    """Was Vorlage UND Update-Skript zusammen anlegen."""
    raus = set()
    vorlage = json.load(open(VORLAGE, encoding="utf-8"))
    raus |= set(vorlage.get("mqtt", {}).keys())
    text = open(UPDATE, encoding="utf-8").read()
    for t in re.finditer(r"\.mqtt\.([A-Za-z_]+)\s*=", text):
        raus.add(t.group(1))
    return raus


def neustartregel() -> str:
    if not os.path.exists(UNIT):
        return "(Unit-Datei nicht gefunden)"
    for zeile in open(UNIT, encoding="utf-8"):
        if zeile.startswith("Restart="):
            return zeile.strip()
    return "Restart= (nicht gesetzt)"


def hat_execcondition() -> bool:
    """
    Prueft die ZWEITE HAELFTE der Reparatur — und deshalb steht sie hier.

    `mqtt.name` allein nachzulegen ist schlimmer als nichts: der Dienst wird
    dadurch startfaehig, und weil `mqtt.active` nichts schaltet (siehe
    `wird_ausgewertet`), laeuft er dann auf JEDER frischen Box gegen den
    Beispiel-Broker. Wer nur den Schluessel nachtraegt, tauscht einen toten
    Dienst gegen einen sinnlos laufenden. Genau diesen Halbfertigstand soll das
    Werkzeug melden koennen, statt ihn gruen aussehen zu lassen.
    """
    if not os.path.exists(UNIT):
        return False
    text = open(UNIT, encoding="utf-8").read()
    for zeile in text.splitlines():
        if zeile.startswith("ExecCondition=") and "mqtt" in zeile and "active" in zeile:
            return True
    return False


def main() -> int:
    gelesen = gelesene_schluessel()
    angelegt = angelegte_schluessel()
    fehlt = [k for k in gelesen if k not in angelegt]
    tot = [k for k in gelesen if not wird_ausgewertet(k)]

    bedingung = hat_execcondition()
    # Halbfertig ist auch ein Befund: der Schluessel da, die Bedingung nicht.
    halb = not fehlt and not bedingung

    if "--json" in sys.argv:
        print(json.dumps(
            {"gelesen": gelesen, "angelegt": sorted(angelegt),
             "fehlt": fehlt, "ohne_wirkung": tot,
             "restart": neustartregel(), "execcondition": bedingung},
            indent=2, ensure_ascii=False))
        return 1 if (fehlt or halb) else 0

    print(f"mqtt.py liest {len(gelesen)} Schluessel: {', '.join(gelesen)}")
    print(f"Das Repo legt {len(angelegt)} an (Vorlage + conf_update.sh).")
    print()
    if fehlt:
        print("GELESEN, ABER NIRGENDS ANGELEGT — das ist ein KeyError beim Start:")
        for k in fehlt:
            print(f"    mqtt.{k}")
        print()
        print(f"  Die Unit sagt: {neustartregel()}")
        print("  Ein KeyError endet mit Code 1 ('exited'), nicht mit 'abort'.")
        print("  Restart=on-abort greift dabei NICHT: der Dienst bleibt tot,")
        print("  waehrend `systemctl is-enabled` weiter 'enabled' sagt.")
    else:
        print("Jeder gelesene Schluessel wird auch angelegt.")
        print(f"  Die Unit sagt: {neustartregel()}")
    print()
    if tot:
        print("GELESEN, ABER NIE AUSGEWERTET — ein Schalter, der nichts schaltet:")
        for k in tot:
            print(f"    mqtt.{k}")
        print()
    if bedingung:
        print("Die Unit faengt das ab: ExecCondition prueft mqtt.active vor dem")
        print("Start. Steht der Schalter aus, gilt der Dienst als UEBERSPRUNGEN")
        print("(Result=exec-condition) — nicht als fehlgeschlagen.")
    else:
        print("DIE UNIT HAT KEINE ExecCondition auf mqtt.active.")
        if halb:
            print("  Und das ist hier der EIGENTLICHE Befund: der Schluessel ist da,")
            print("  der Dienst also startfaehig — und weil `active` nichts schaltet,")
            print("  laeuft er auf JEDER frischen Box gegen den Beispiel-Broker.")
            print("  Ein toter Dienst wurde gegen einen sinnlos laufenden getauscht.")
        else:
            print("  Beide Haelften fehlen. Sie gehoeren zusammen — siehe Kopf.")
    return 1 if (fehlt or halb) else 0


if __name__ == "__main__":
    sys.exit(main())
