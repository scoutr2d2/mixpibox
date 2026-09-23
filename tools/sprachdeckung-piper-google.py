#!/usr/bin/env python3
"""WOZU: Google TTS wurde abgeloest (04.08.2026). Die ehrliche Frage dabei ist
nicht „geht Piper?", sondern „was KANN Piper nicht, was Google konnte?" — ein
zweiter Weg, von dem niemand weiss, warum es ihn gibt, ist schlimmer als zwei
Wege mit Begruendung.

Google bot in der Box 21 Sprachen an (`mupibox.googlettslanguages`, angelegt
von update/conf_update.sh). Piper hat einen eigenen Stimmenkatalog. Dieses
Werkzeug haelt beide nebeneinander und sagt, was fehlt.

GEMESSEN 04.08.2026 (Katalog: 171 Stimmen, 49 Sprachfamilien):
    Piper deckt 20 der 21 Google-Sprachen ab.
    Es fehlt genau eine: JAPANISCH (ja).

AUFRUF:
    tools/sprachdeckung-piper-google.py                 # Katalog aus dem Netz
    tools/sprachdeckung-piper-google.py --box 192.168.178.169
                                                        # zusaetzlich: welche
                                                        # Stimmen liegen wirklich
                                                        # auf DIESER Box?

FALLE: Der Katalog liegt NICHT im installierten Piper-Paket — `voices.json`
sucht man dort vergeblich (kostete hier zwei Anlaeufe). `piper.download_voices`
holt ihn zur Laufzeit von HuggingFace; genau diese Adresse steht unten.
"""

import argparse
import json
import subprocess
import sys
import urllib.request

KATALOG = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json?download=true"

# Die 21 Sprachen, die `mupibox.googlettslanguages` anbot (ISO 639-1), in der
# Reihenfolge, in der update/conf_update.sh sie schreibt.
GOOGLE_21 = {
    "ar": "Arabisch", "zh": "Chinesisch", "cs": "Tschechisch", "da": "Daenisch",
    "nl": "Niederlaendisch", "en": "Englisch", "fi": "Finnisch", "fr": "Franzoesisch",
    "de": "Deutsch", "el": "Griechisch", "hi": "Hindi", "it": "Italienisch",
    "ja": "Japanisch", "no": "Norwegisch", "pl": "Polnisch", "pt": "Portugiesisch",
    "ru": "Russisch", "es": "Spanisch", "sv": "Schwedisch", "tr": "Tuerkisch",
    "uk": "Ukrainisch",
}


def katalog_holen(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as a:
        return json.loads(a.read().decode("utf-8"))


def box_stimmen(box: str) -> list[str]:
    """Was liegt WIRKLICH auf der Box? Der Katalog sagt nur, was es gaebe."""
    try:
        roh = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", f"dietpi@{box}",
             "curl -s -m 5 http://127.0.0.1:8200/api/vorlesen"],
            capture_output=True, text=True, timeout=30,
        ).stdout
        return [s["id"] for s in json.loads(roh).get("stimmen", [])]
    except Exception as e:  # noqa: BLE001 — eine Messung darf nicht am Netz sterben
        print(f"  (Box nicht erreichbar: {e})", file=sys.stderr)
        return []


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--box", help="Adresse der Box, um die INSTALLIERTEN Stimmen mitzuzeigen")
    a = p.parse_args()

    d = katalog_holen(KATALOG)
    familien = sorted({v["language"]["code"].split("_")[0] for v in d.values()})
    print(f"Piper-Katalog: {len(d)} Stimmen, {len(familien)} Sprachfamilien")

    kann = [k for k in GOOGLE_21 if k in familien]
    fehlt = [k for k in GOOGLE_21 if k not in familien]

    print(f"\nVon Googles 21 Sprachen deckt Piper {len(kann)} ab.")
    if fehlt:
        print("ES FEHLT:")
        for k in fehlt:
            print(f"  {k}  {GOOGLE_21[k]}")
    else:
        print("Es fehlt keine.")

    if a.box:
        ids = box_stimmen(a.box)
        print(f"\nAuf {a.box} installiert: {len(ids)} Stimmen")
        for i in ids:
            print(f"  {i}")
        da = {i.split("_")[0] for i in ids}
        ohne = [k for k in kann if k not in da]
        print("\nIm Katalog vorhanden, auf DIESER Box aber nicht geladen:")
        print("  " + " ".join(ohne) if ohne else "  (keine)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
