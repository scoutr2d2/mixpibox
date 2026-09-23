#!/usr/bin/env python3
"""Die ganze Tonlage der Box auf einen Blick — Senken, Stroeme, und was die Karte WIRKLICH anwendet.

WOZU (05.09.2026)
Der Betreiber: "angeblich ist es 7% aber es ist 100 laut". Die Antwort stand
in zwei Zahlen, die sonst niemand nebeneinander legt:

    channelVolumes = was der Regler gestellt hat
    softVolumes    = was die Karte WIRKLICH in Software anwendet

Klaffen sie auseinander, glaubt PipeWire an einen Hardware-Regler, den die
Karte gar nicht hat (MAX98357A: keiner) — die Anzeige stimmt, der Ton nicht.

MIT api.alsa.soft-mixer (config/templates/82-karte-software-regler.conf)
wohnt das Volumen an der ROUTE des Devices; die Node-Props stehen dann stur
auf 1.0. Wer nur den Node liest, haelt einen funktionierenden Regler fuer
verpufft — deshalb liest dieses Werkzeug BEIDE Stellen und nennt die
wirksame.

Die Erhebung laeuft AUF DER BOX (tools/box/tonlage-helfer.py, per scp
eingespielt): der volle pw-dump ist ~1 MB, und das WLAN schafft in
schlechten Minuten 33 KB/s — der Abruf uebers Netz lief in den Timeout.

Aufruf:  tools/tonlage-schau.py dietpi@192.168.178.62 [--nur-karte]
  --nur-karte: eine maschinenlesbare Zeile fuer Proben:
               KARTE channel=<bruch> soft=<bruch> ort=<Node|Route|keine>
"""
import json
import pathlib
import subprocess
import sys


def haupt() -> int:
    if len(sys.argv) < 2:
        print("Aufruf: tonlage-schau.py <benutzer@box> [--nur-karte]", file=sys.stderr)
        return 2
    box = sys.argv[1]
    nur_karte = "--nur-karte" in sys.argv[2:]

    helfer = pathlib.Path(__file__).parent / "box" / "tonlage-helfer.py"
    ssh = ["-o", "ConnectTimeout=8", "-o", "BatchMode=yes"]
    try:
        subprocess.run(["scp", "-q", *ssh, str(helfer), f"{box}:/tmp/tonlage-helfer.py"], check=True, timeout=30)
        roh = subprocess.run(
            ["ssh", *ssh, box, "python3 /tmp/tonlage-helfer.py"],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout
        d = json.loads(roh)
    except Exception as e:  # noqa: BLE001 - jede Netz-/Parse-Panne heisst: nicht messbar
        print(f"X  nicht messbar: {e}", file=sys.stderr)
        if nur_karte:
            print("KARTE channel= soft= ort=keine")
        return 2

    node, route = d.get("node") or {}, d.get("route") or {}
    # Die WIRKSAME Stelle ist die, die sich vom Vorgabewert 1.0 wegbewegt:
    # steht der Node auf 1.0 und die Route traegt einen Wert, regelt die Route.
    ort, wirk = "keine", {}
    if node.get("channel") is not None and abs(node["channel"] - 1.0) > 1e-9:
        ort, wirk = "Node", node
    elif route.get("channel") is not None:
        ort, wirk = "Route", route
    elif node.get("channel") is not None:
        ort, wirk = "Node", node

    if nur_karte:
        print(f"KARTE channel={wirk.get('channel', '')} soft={wirk.get('soft', '')} ort={ort}")
        return 0

    print("== Senken ==")
    for s in d.get("senken", []):
        print("  %6s  %-54s %s" % (s["index"], s["name"][:54], s["prozent"]))
    print("== Stroeme (wer -> wohin, wie laut) ==")
    for i in d.get("stroeme", []):
        print("  #%6s -> Senke %6s  %5s  %s  %s" % (
            i["index"], i["senke"], i["prozent"], i["app"] or "(kein Name)", i["knoten"]))
    print(f"== Karte: gestellt vs. angewandt (wirksame Stelle: {ort}) ==")
    print(f"   channelVolumes = {wirk.get('channel')}   (Node: {node.get('channel')}, Route: {route.get('channel')})")
    print(f"   softVolumes    = {wirk.get('soft')}")
    ch, so = wirk.get("channel"), wirk.get("soft")
    if ch is not None and so is not None:
        # Fuenf Prozent Kulanz auf der kubischen Skala.
        if abs(ch - so) <= max(ch, so, 1e-9) * 0.05 + 1e-9:
            print("   OK: die Karte wendet den Reglerwert in Software an.")
        else:
            print("   X : SCHERE — der Regler stellt, die Karte wendet etwas ANDERES an")
            print("       (Hardware-Mixer-Attrappe; siehe config/templates/82-karte-software-regler.conf).")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(haupt())
