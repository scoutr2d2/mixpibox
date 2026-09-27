#!/usr/bin/env python3
"""Zeigt jedes Geraetebild dieselben Tasten wie sein Profil?

WARUM ES DIESES WERKZEUG GIBT (06.09.2026): Zu den Fernbedienungen gibt es ab
heute ZWEI Wahrheiten — das Profil (`config/fernbedienungen/<id>.json`, welche
Taste welchen Code sendet) und das Schema (`bilder/<id>.svg`, wo sie sitzt).
Zwei Wahrheiten ueber dieselbe Sache laufen auseinander, sobald jemand nur
eine anfasst. Genau das ist bei der ERSTEN Pruefung schon aufgefallen:

    googletv: Profil kennt Taste 164 (Wiedergabe/Pause) — im Bild gibt es sie
    nicht, und an der echten Fernbedienung auch nicht.

Ein Bild, das eine Taste vergisst, macht sie unbelegbar. Ein Profil, das eine
erfindet, bietet in der Verwaltung eine Taste an, die niemand druecken kann.
Beides faellt ohne diese Probe erst am Geraet auf.

WIE DAS BILD SEINE TASTEN NENNT: `data-taste` an der klickbaren Flaeche. Der
Wert ist der Kernelcode; `x-...` heisst „Taste existiert, sendet aber nichts"
(Mikrofon, Ein/Aus, Programmtasten).

SAMMELFLAECHEN: `ring` steht fuer das Steuerkreuz, `stick` fuer den linken
Daumenstick. Beide fassen MEHRERE Codes in einer Flaeche zusammen — die vier
Richtungen eines Kreuzes einzeln zu zeichnen hiesse, vier Trefferzonen in
einen Kreis zu legen, die niemand unterscheiden kann. Ihr Gegenstueck im
Profil ist kein `keys`-Eintrag, sondern der Abschnitt `achsen` (Kreuz als
EV_ABS, wie beim Xbox-Controller gemessen) bzw. `sticks` — ODER, bei den
Fernbedienungen, die vier Richtungs-TASTEN 103/108/105/106 in `keys`.
Eine Sammelflaeche ohne Gegenstueck ist ein Fund: das Bild verspricht dann
eine Flaeche, die die Belegung nicht kennt. Beim ersten Lauf nach dem
Xbox-Schema hat genau das gefehlt — `stick` wurde als unbekannte Taste
gemeldet, weil die Wache nur `ring` kannte.

Aufruf:
    python3 tools/fernbedienung-bild-deckung.py
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent / "config" / "fernbedienungen"
# Richtungstasten, die eine `ring`-Flaeche bei Fernbedienungen abdeckt.
RING = {"103", "108", "105", "106"}
# Sammelflaeche im Bild -> Profilabschnitt, der sie einloest.
SAMMEL = {"ring": "achsen", "stick": "sticks"}


def tasten_im_bild(pfad: Path) -> set[str]:
    """Alle `data-taste`-Werte — auch die toten, die mit `x-` beginnen."""
    wurzel = ET.parse(pfad).getroot()
    return {g.get("data-taste") for g in wurzel.iter() if g.get("data-taste")}


def main() -> int:
    profile = sorted(p for p in WURZEL.glob("*.json"))
    if not profile:
        print(f"Keine Profile unter {WURZEL}", file=sys.stderr)
        return 2

    funde = 0
    ohne_bild = []
    for pfad in profile:
        kennung = pfad.stem
        bild = WURZEL / "bilder" / f"{kennung}.svg"
        if not bild.exists():
            ohne_bild.append(kennung)
            continue
        profil = json.loads(pfad.read_text(encoding="utf-8"))
        # `ungemessen` NIMMT EINEN CODE AUS DER ERWARTUNG, LOESCHT IHN ABER
        # NICHT. Ein Code aus einer Vorlage, den nie jemand am Geraet
        # bestaetigt hat, darf kein Bild verlangen — aber er darf auch nicht
        # stillschweigend verschwinden. Ohne diese Zeile meldete die Wache
        # ihn bei JEDEM Lauf, und ein dauerroter Befund verdeckt den
        # naechsten echten (llmwiki `dauerrote-wache-ist-keine`).
        erwartet = set(profil.get("keys") or {}) - RING - set(profil.get("ungemessen") or {})
        imBild = tasten_im_bild(bild)
        # Drei Sorten Kennungen im Bild: numerische Codes (gegen `keys`
        # pruefbar), Sammelflaechen (gegen ihren Profilabschnitt) und tote
        # `x-...`-Tasten (nur zur Ansicht, nicht pruefbar).
        belegbar = {k for k in imBild if k.isdigit()}
        sammel = {k for k in imBild if not k.startswith("x-") and not k.isdigit()}

        meldungen = []
        for k in sorted(erwartet - belegbar, key=lambda x: (len(x), x)):
            meldungen.append(f"Profil kennt {k} ({profil['keys'][k]}) — im Bild nicht zu finden")
        for k in sorted(belegbar - erwartet, key=lambda x: (len(x), x)):
            meldungen.append(f"Bild zeigt {k} — im Profil nicht verzeichnet")
        for k in sorted(sammel):
            abschnitt = SAMMEL.get(k)
            if abschnitt is None:
                meldungen.append(f"Bild zeigt unbekannte Sammelflaeche '{k}' — die Wache kennt nur {sorted(SAMMEL)}")
            elif not profil.get(abschnitt) and not (k == "ring" and RING & set(profil.get("keys") or {})):
                meldungen.append(f"Sammelflaeche '{k}' im Bild, aber kein Abschnitt '{abschnitt}' im Profil — die Flaeche fuehrte ins Leere")
        # Und andersherum: was das Profil beschreibt, muss das Bild anbieten.
        for flaeche, abschnitt in SAMMEL.items():
            if profil.get(abschnitt) and flaeche not in sammel:
                meldungen.append(f"Profil hat Abschnitt '{abschnitt}', aber keine Flaeche '{flaeche}' im Bild")

        if meldungen:
            funde += 1
            print(f"FUND  {kennung}")
            for m in meldungen:
                print(f"        {m}")
        else:
            print(f"ok    {kennung}  ({len(belegbar)} belegbare Tasten, "
                  f"{len(sammel)} Sammelflaechen, "
                  f"{len([k for k in imBild if k.startswith('x-')])} tote)")

    if ohne_bild:
        print()
        print("Ohne Schema (noch kein SVG): " + ", ".join(ohne_bild))
        print("  Das ist kein Fehler — nur diese Geraete lassen sich spaeter")
        print("  nicht grafisch belegen.")

    if funde:
        print()
        print(f"{funde} Profil(e) decken sich nicht mit ihrem Bild.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
