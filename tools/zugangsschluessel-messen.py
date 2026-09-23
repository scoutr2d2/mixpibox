#!/usr/bin/env python3
"""Misst, welche Zugangsschluessel die Box ohne Anmeldung herausgibt (BACKLOG E15).

WOZU EIN WERKZEUG statt eines curl-Aufrufs: Die Frage kommt vor JEDEM Schritt
von E15 wieder (S1..S5) und danach als Rueckfallprobe. Ein Werkzeug, das die
Antwort in einer Tabelle sagt, ist zweimal billiger als zweimal gemessen — und
es misst BEIDE Richtungen: was noch leckt UND ob die Wege ueberhaupt noch
antworten (ein dichter, aber kaputter Weg ist kein Fortschritt).

MISST VON AUSSEN, nicht am Quelltext. Genau darum geht es: was ein fremder
Rechner im Netz ohne Anmeldung sieht.

    tools/zugangsschluessel-messen.py                 # Voreinstellung: die Box
    tools/zugangsschluessel-messen.py --host localhost --port 8200

Verandert NICHTS. Nur GET.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

# Die Frist ist grosszuegig: die Box holt bei /api/data nichts aus dem Netz,
# aber eine schlafende SD-Karte braucht ihre Zeit.
FRIST_S = 15


def holen(basis: str, pfad: str) -> tuple[int, object | None, str]:
    """(Status, geparstes JSON oder None, Rohtext). Wirft nie."""
    try:
        with urllib.request.urlopen(f"{basis}{pfad}", timeout=FRIST_S) as antwort:
            roh = antwort.read().decode("utf-8", "replace")
            status = antwort.status
    except urllib.error.HTTPError as fehler:
        roh = fehler.read().decode("utf-8", "replace")
        status = fehler.code
    except Exception as fehler:  # Netz weg, Name unbekannt, Dienst aus
        return 0, None, f"{type(fehler).__name__}: {fehler}"
    try:
        return status, json.loads(roh), roh
    except json.JSONDecodeError:
        return status, None, roh


def gekuerzt(wert: str, zeichen: int = 6) -> str:
    """Ein Geheimnis nennen, ohne es abzudrucken — die Laenge sagt genug."""
    wert = str(wert)
    if not wert:
        return "(leer)"
    return f"{wert[:zeichen]}… ({len(wert)} Zeichen)"


def jellyfin_schluessel(daten: object) -> list[str]:
    """Alle api_key-Werte, die irgendwo in der Medienliste stecken.

    NICHT nur im Feld `cover` gesucht: bei Jellyfin traegt AUCH `id` die
    Stromadresse samt Schluessel (jellyfin.ts:jellyfinToMedia). Wer nur das
    Cover prueft, meldet Dichtigkeit, waehrend der Schluessel nebenan steht.
    """
    treffer: list[str] = []
    for gefunden in re.finditer(r"[?&](?:api_key|ApiKey|X-Emby-Token)=([^&\"'\s]+)", json.dumps(daten)):
        wert = gefunden.group(1)
        if wert not in treffer:
            treffer.append(wert)
    return treffer


def zeile(name: str, status: int, urteil: str, bemerkung: str) -> None:
    print(f"  {name:<28} {status or '---':>4}  {urteil:<10} {bemerkung}")


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--host", default="192.168.178.169")
    zerleger.add_argument("--port", type=int, default=8200)
    args = zerleger.parse_args()
    basis = f"http://{args.host}:{args.port}"

    print(f"Zugangsschluessel-Messung gegen {basis} (nur lesend)\n")
    offen = 0

    # ── /api/data: der Jellyfin-Schluessel ──────────────────────────────────
    status, daten, roh = holen(basis, "/api/data")
    if status != 200:
        zeile("/api/data", status, "?", f"keine Auskunft: {roh[:80]}")
    else:
        anzahl = len(daten) if isinstance(daten, list) else "?"
        schluessel = jellyfin_schluessel(daten)
        if schluessel:
            offen += 1
            zeile("/api/data", status, "LECK", f"{len(schluessel)}x api_key, z.B. {gekuerzt(schluessel[0])}")
        else:
            zeile("/api/data", status, "dicht", f"kein api_key in {anzahl} Eintraegen")

    # ── /api/spotify/config: clientId, Secret, Erneuerungsmerkmal ───────────
    status, cfg, roh = holen(basis, "/api/spotify/config")
    if status != 200 or not isinstance(cfg, dict):
        zeile("/api/spotify/config", status, "?", f"keine Auskunft: {roh[:80]}")
    else:
        heikel = [f for f in ("clientId", "clientSecret", "refreshToken", "accessToken") if str(cfg.get(f) or "")]
        if heikel:
            offen += 1
            beschreibung = ", ".join(f"{f}={gekuerzt(str(cfg[f]))}" for f in heikel)
            zeile("/api/spotify/config", status, "LECK", beschreibung)
        else:
            zeile("/api/spotify/config", status, "dicht", f"Felder: {sorted(cfg.keys())}")

    # ── /api/config: sollte seit `ohneGeheimnisse` dicht sein ───────────────
    status, cfg, roh = holen(basis, "/api/config")
    if status != 200 or not isinstance(cfg, dict):
        zeile("/api/config", status, "?", f"keine Auskunft: {roh[:80]}")
    else:
        gruppen = {"jellyfin": ["apiKey"], "spotify": ["clientSecret", "refreshToken", "accessToken"],
                   "interfacelogin": ["password"], "telegram": ["token"], "mqtt": ["password"]}
        heikel = []
        for gruppe, felder in gruppen.items():
            g = cfg.get(gruppe)
            if isinstance(g, dict):
                heikel += [f"{gruppe}.{f}" for f in felder if str(g.get(f) or "")]
        if heikel:
            offen += 1
            zeile("/api/config", status, "LECK", ", ".join(heikel))
        else:
            zeile("/api/config", status, "dicht", "alle bekannten Geheimnisse leer")

    # ── Gegenprobe: bleibt der Bildweg heil? ────────────────────────────────
    # Ein dichter, aber kaputter Weg ist kein Fortschritt. Deshalb wird der
    # erste Werkschluessel der Liste durch /api/bild geschickt.
    status, daten, _ = holen(basis, "/api/werke")
    erster = None
    if status == 200 and isinstance(daten, dict):
        werke = daten.get("werke") if isinstance(daten.get("werke"), list) else None
        if werke:
            erster = werke[0].get("schluessel")
    if erster:
        import urllib.parse

        status, _, roh = holen(basis, f"/api/bild/{urllib.parse.quote(erster, safe='')}")
        zeile("/api/bild/<erstes Werk>", status, "ok" if status in (200, 302, 404) else "KAPUTT", erster)
    else:
        zeile("/api/bild/<erstes Werk>", 0, "?", "kein Werk in /api/werke gefunden")

    print(f"\n  offene Lecks: {offen}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
