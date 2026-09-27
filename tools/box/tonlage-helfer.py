#!/usr/bin/env python3
"""Laeuft AUF DER BOX: die Tonlage-Zahlen einsammeln, klein zurueckgeben.

Warum nicht pw-dump uebers Netz: der volle Dump ist ~1 MB, und das WLAN der
Box schafft in schlechten Minuten 33 KB/s — der Abruf lief in den Timeout
(05.09.2026). Hier wird auf der Box gefiltert; zurueck gehen ein paar Zeilen.

Wird von tools/tonlage-schau.py per scp eingespielt und aufgerufen.
Ausgabe (eine Zeile JSON):
  {"node": {...}, "route": {...}, "senken": [...], "stroeme": [...]}
"""
import json
import subprocess


def pw_dump():
    return json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=20).stdout or "[]")


def pactl(*a):
    return json.loads(
        subprocess.run(["pactl", "-f", "json", "list", *a], capture_output=True, text=True, timeout=20).stdout or "[]"
    )


def haupt() -> None:
    node = {}
    route = {}
    for o in pw_dump():
        info = o.get("info") or {}
        props = info.get("props") or {}
        if not node and str(props.get("node.name", "")).startswith("alsa_output."):
            for pr in (info.get("params") or {}).get("Props", []) or []:
                if "channelVolumes" in pr:
                    node = {
                        "channel": pr.get("channelVolumes", [None])[0],
                        "soft": (pr.get("softVolumes") or [None])[0],
                    }
        if not route and str(props.get("device.name", "")).startswith("alsa_card."):
            for r in (info.get("params") or {}).get("Route", []) or []:
                pr = r.get("props") or {}
                if "channelVolumes" in pr:
                    route = {
                        "channel": pr.get("channelVolumes", [None])[0],
                        "soft": (pr.get("softVolumes") or [None])[0],
                    }

    senken = []
    for s in pactl("sinks"):
        v = list(s.get("volume", {}).values())
        senken.append({"index": s["index"], "name": s["name"], "prozent": (v[0].get("value_percent", "?") if v else "?")})
    stroeme = []
    for i in pactl("sink-inputs"):
        v = list(i.get("volume", {}).values())
        p = i.get("properties", {})
        stroeme.append({
            "index": i["index"], "senke": i["sink"],
            "prozent": (v[0].get("value_percent", "?") if v else "?"),
            "app": p.get("application.name", ""), "knoten": p.get("node.name", ""),
        })

    print(json.dumps({"node": node, "route": route, "senken": senken, "stroeme": stroeme}))


if __name__ == "__main__":
    haupt()
