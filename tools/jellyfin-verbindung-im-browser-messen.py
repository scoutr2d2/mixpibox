#!/usr/bin/env python3
"""Misst, WORAUS die klassische Oberflaeche ihre Jellyfin-Verbindung gewinnt.

WOZU EIN WERKZEUG statt eines curl-Aufrufs: Die Frage „reicht das, was die Box
ohne Schluessel herausgibt, fuer die Oberflaeche?" ist die Kernfrage der
zweiten Haelfte von BACKLOG E15 — sie kommt vor JEDEM weiteren Schritt wieder
und danach als Rueckfallprobe. Sie einmal von Hand zu beantworten kostete am
04.08.2026 sechs Einzelabfragen und eine falsche Zwischenannahme (dass
`ohneGeheimnisse` den Schluessel LEERT — auf der Messbox steht er gar nicht
erst in der Datei, das Ergebnis ist dasselbe, der Grund ein anderer).

DER UNTERSCHIED ZU `zugangsschluessel-messen.py`: jenes fragt „was leckt?",
dieses fragt „was TRAEGT noch, wenn nichts mehr leckt?". Beide Antworten
zusammen entscheiden, ob ein Weg zugemacht werden darf. Deshalb prueft dieses
Werkzeug auch `/api/werke/<s>/inhalt` — den DRITTEN Browser->Jellyfin-Weg, den
E15 urspruenglich nicht nannte und den `zugangsschluessel-messen.py` bis heute
nicht ansieht.

    tools/jellyfin-verbindung-im-browser-messen.py
    tools/jellyfin-verbindung-im-browser-messen.py --host localhost --port 8200

WAS ES NICHT TUT: Es sagt NICHT, ob mpv auf der Box ueber den Weiterreicher
spielt — das ist ohne Ausrollen nicht zu hoeren (siehe E15/S2). Es sieht auch
NICHT in den localStorage eines Browsers; was dort noch liegt, steht in
`oberflaeche-speicherschluessel` und ist von aussen nicht messbar.

Veraendert NICHTS. Nur GET.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

FRIST_S = 20

# Die Stelle in der klassischen Oberflaeche, um die es geht.
QUELLE = "src/frontend-box/src/app/jellyfin.service.ts"


class Kopfzeilen(dict):
    """Antwortkopfzeilen, unabhaengig von der Gross-/Kleinschreibung.

    NICHT ZIERDE, SONDERN EINE GEMESSENE FALLE: Der Weiterreicher der Box gibt
    `content-range` KLEIN zurueck (antwortKopfzeilen in jellyfin-durchreiche.ts
    reicht die Namen durch, wie Jellyfin sie schickt). Ein `dict(...)` ueber
    urllibs Kopfzeilen verliert deren Unempfindlichkeit — die erste Fassung
    dieses Werkzeugs meldete daraufhin „TRAEGT NICHT / kein Sprung" bei einer
    Antwort, die in Wahrheit 206 mit `content-range: bytes 0-1023/5683931` war.
    Ein falsches Rot ist teurer als gar keine Messung.
    """

    def get(self, name: str, vorgabe: str = "") -> str:  # type: ignore[override]
        klein = name.lower()
        for k, v in self.items():
            if k.lower() == klein:
                return v
        return vorgabe


def holen(basis: str, pfad: str, kopf: dict[str, str] | None = None) -> tuple[int, str, Kopfzeilen]:
    """(Status, Rohtext, Antwortkopfzeilen). Wirft nie."""
    anfrage = urllib.request.Request(f"{basis}{pfad}", headers=kopf or {})
    try:
        with urllib.request.urlopen(anfrage, timeout=FRIST_S) as antwort:
            return antwort.status, antwort.read().decode("utf-8", "replace"), Kopfzeilen(antwort.headers)
    except urllib.error.HTTPError as fehler:
        return fehler.code, fehler.read().decode("utf-8", "replace"), Kopfzeilen(fehler.headers)
    except Exception as fehler:  # Netz weg, Name unbekannt, Dienst aus
        return 0, f"{type(fehler).__name__}: {fehler}", Kopfzeilen()


def als_json(roh: str) -> object | None:
    try:
        return json.loads(roh)
    except json.JSONDecodeError:
        return None


def gekuerzt(wert: object, zeichen: int = 6) -> str:
    """Ein Geheimnis nennen, ohne es abzudrucken — die Laenge sagt genug."""
    s = str(wert or "")
    return "(leer)" if not s else f"{s[:zeichen]}… ({len(s)} Zeichen)"


def traegt_schluessel(text: str) -> bool:
    """Dieselbe Frage wie `traegtSchluessel` in jellyfin-durchreiche.ts."""
    return bool(re.search(r"[?&]?(api_key|ApiKey|X-Emby-Token)[=%]", text))


def zeile(name: str, status: object, urteil: str, bemerkung: str) -> None:
    print(f"  {name:<34} {status or '---':>4}  {urteil:<9} {bemerkung}")


def erstes_jellyfin_werk(basis: str) -> dict | None:
    """Ein echtes Jellyfin-Album aus der Bibliothek — die Wege brauchen einen Griff."""
    status, roh, _ = holen(basis, "/api/werke")
    daten = als_json(roh)
    if status != 200 or not isinstance(daten, dict):
        return None
    for werk in daten.get("werke") or []:
        for quelle in werk.get("quellen") or []:
            if quelle.get("dienst") == "jellyfin" and quelle.get("kennung"):
                return {"schluessel": werk.get("schluessel"), "kennung": quelle["kennung"], "titel": werk.get("titel")}
    return None


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--host", default="192.168.178.169")
    zerleger.add_argument("--port", type=int, default=8200)
    args = zerleger.parse_args()
    basis = f"http://{args.host}:{args.port}"

    print(f"Jellyfin-Verbindung der Oberflaeche, gemessen gegen {basis} (nur lesend)\n")

    # ── 1. Was `ensureBoxConfig()` sieht ────────────────────────────────────
    # Die Funktion holt /api/config und nimmt den Zweig
    #   if (jf?.server && jf?.apiKey)  -> boxweite Verbindung in den localStorage
    #   else if (local)                -> die frueher so gesaete Kopie LOESCHEN
    # Beides haengt an EINEM Feld, also wird genau dieses Feld gemessen.
    print(f"1. Was {QUELLE}:ensureBoxConfig() von /api/config bekommt")
    status, roh, _ = holen(basis, "/api/config")
    konfig = als_json(roh)
    jf = konfig.get("jellyfin") if isinstance(konfig, dict) else None
    if status != 200 or not isinstance(konfig, dict):
        zeile("/api/config", status, "?", f"keine Auskunft: {roh[:70]}")
        server_da = schluessel_da = False
    elif not isinstance(jf, dict):
        zeile("/api/config .jellyfin", status, "FEHLT", "die Gruppe gibt es gar nicht")
        server_da = schluessel_da = False
    else:
        server_da = bool(str(jf.get("server") or ""))
        schluessel_da = bool(str(jf.get("apiKey") or ""))
        # „Feld fehlt" und „Feld ist leer" sind zwei verschiedene Ursachen mit
        # derselben Wirkung. Wer sie verwechselt, repariert die falsche Stelle:
        # fehlt es, ist die Konfiguration der Box aelter als das Feld; ist es
        # leer, hat `ohneGeheimnisse` es geleert.
        wie = "steht nicht in der Datei" if "apiKey" not in jf else "vorhanden, aber leer (ohneGeheimnisse)"
        zeile("/api/config .jellyfin.server", status, "da" if server_da else "leer", str(jf.get("server") or ""))
        zeile(
            "/api/config .jellyfin.apiKey",
            status,
            "DA" if schluessel_da else "leer",
            gekuerzt(jf.get("apiKey")) if schluessel_da else wie,
        )
        zweig = (
            "saet die boxweite Verbindung"
            if (server_da and schluessel_da)
            else "TOTER ZWEIG — else-Zweig loescht eine frueher gesaete Kopie"
        )
        zeile("=> ensureBoxConfig()", "", "Folge", zweig)

    # ── 2. Was die Verwaltung ueber Jellyfin BEHAUPTET ──────────────────────
    # Gemessen, weil der Stand aus demselben Feld gebildet wird — und damit
    # dieselbe Luecke erbt. Eine Seite, die „antwortet auf nichts" sagt,
    # waehrend die Box spielt, schickt den naechsten Leser in die Irre.
    print("\n2. Was die Verwaltung daraus macht (/api/streaming)")
    status, roh, _ = holen(basis, "/api/streaming")
    daten = als_json(roh)
    liste = daten if isinstance(daten, list) else (daten or {}).get("anbieter") if isinstance(daten, dict) else None
    eintrag = next((a for a in liste or [] if a.get("id") == "jellyfin"), None)
    if not eintrag:
        zeile("/api/streaming jellyfin", status, "?", roh[:70])
    else:
        zeile("/api/streaming jellyfin", status, eintrag.get("stand", "?"), eintrag.get("warum", ""))

    # ── 3. Tragen die schluessellosen Wege? ─────────────────────────────────
    print("\n3. Die drei Wege ohne Schluessel im Browser (an einem echten Werk)")
    werk = erstes_jellyfin_werk(basis)
    if not werk:
        zeile("Jellyfin-Werk", 0, "?", "keins in /api/werke — ohne Griff ist hier nichts messbar")
        print("\n  Ohne ein Jellyfin-Album in der Bibliothek sagt diese Messung nichts.")
        return 1
    print(f"  Werk: {werk['titel']} ({werk['schluessel']})")

    # 3a) Cover (E15/S1)
    status, roh, kopf = holen(basis, f"/api/bild/jellyfin/{werk['kennung']}")
    art = kopf.get("Content-Type", "")
    zeile(
        "/api/bild/jellyfin/:kennung",
        status,
        "traegt" if status == 200 and art.startswith("image/") else "TRAEGT NICHT",
        f"{art} {kopf.get('Content-Length', '?')} Byte",
    )

    # 3b) Titelliste — und zugleich der Griff fuer den Ton
    pfad = f"/api/werke/{urllib.parse.quote(str(werk['schluessel']), safe='')}/inhalt"
    status, roh, _ = holen(basis, pfad)
    inhalt = als_json(roh)
    titel = (inhalt or {}).get("titel") if isinstance(inhalt, dict) else None
    if status != 200 or not isinstance(titel, list):
        zeile("/api/werke/<s>/inhalt", status, "TRAEGT NICHT", roh[:70])
        ton_kennung = None
    else:
        # ACHTUNG, DAS IST DER PUNKT: die Liste TRAEGT (Nummer, Titel, Dauer),
        # aber `befehl`/`anhaengen` enthalten die Stromadresse SAMT api_key.
        # Ein „traegt" ohne diese zweite Auskunft waere die halbe Wahrheit.
        leck = traegt_schluessel(roh)
        zeile(
            "/api/werke/<s>/inhalt",
            status,
            "traegt" if not leck else "traegt+LECK",
            f"{len(titel)} Titel" + (", api_key steckt in befehl/anhaengen" if leck else ", ohne api_key"),
        )
        ton_kennung = next((str(t.get("id")) for t in titel if t.get("id")), None)

    # 3c) Ton (E15/S2) — mit Bereichsabruf, weil mpv springt und nicht liest
    if ton_kennung:
        status, roh, kopf = holen(basis, f"/api/jellyfin/strom/{ton_kennung}", {"Range": "bytes=0-1023"})
        springt = status == 206 and bool(kopf.get("Content-Range"))
        zeile(
            "/api/jellyfin/strom/:kennung",
            status,
            "traegt" if springt else "TRAEGT NICHT",
            f"{kopf.get('Content-Type', '?')} {kopf.get('Content-Range', 'kein Content-Range — kein Sprung')}",
        )
    else:
        zeile("/api/jellyfin/strom/:kennung", 0, "?", "keine Titelkennung aus der Liste")

    # ── 4. Woran die Oberflaeche heute wirklich haengt ──────────────────────
    print("\n4. Der Rueckfall, von dem die Oberflaeche heute lebt")
    status, roh, _ = holen(basis, "/api/data")
    schluessel = sorted(set(re.findall(r"[?&](?:api_key|ApiKey)=([^&\"'\s]+)", roh)))
    zeile(
        "/api/data (Coveradressen)",
        status,
        "LECK" if schluessel else "dicht",
        f"{len(schluessel)}x api_key, z.B. {gekuerzt(schluessel[0])}" if schluessel else "kein api_key",
    )
    print(
        "\n  Solange hier ein api_key steht, gewinnt die klassische Oberflaeche ihre\n"
        "  Verbindung aus der Coveradresse (`configForCover`) — nicht aus /api/config.\n"
        "  Die boxweite Einstellung der Verwaltung ist fuer sie wirkungslos."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
