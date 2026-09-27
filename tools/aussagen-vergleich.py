#!/usr/bin/env python3
"""
ZAEHLT DIE AUSSAGEN JE WERKZEUG — vorher gegen nachher.

══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════

Am 06.08.2026 ist das Zahnrad `#einst-knopf` ersatzlos entfallen und
vierunddreissig Werkzeuge sind auf den gemeinsamen Weg (tools/admin-weg.mjs)
gezogen worden. Die Gefahr dabei hat einen Namen:

    EIN WERKZEUG, DAS DEN BEREICH NICHT MEHR AUFBEKOMMT UND DARAUFHIN GAR
    NICHTS MISST, MELDET LEICHT „ALLES GRUEN".

Ein Lauf ohne eine einzige `ok`-Zeile endet mit 0 und sieht in jedem
Sammelbericht genauso aus wie einer mit vierzig gehaltenen Aussagen. Der
Endestand allein taugt nach so einem Umzug NICHT als Beleg.

Deshalb wird hier nicht der Endestand verglichen, sondern DIE ZAHL DER
AUSSAGEN: wie viele Zeilen hat das Werkzeug vor dem Umzug gedruckt, wie viele
danach. Faellt sie, hat das Werkzeug etwas verloren — auch wenn es gruen ist.

══ WIE DAS „VORHER" ENTSTEHT ══════════════════════════════════════════════

Aus `git archive <commit>` in einen WEGWERFBAUM, NICHT ueber `git stash` am
Hauptbaum: an dem arbeitet eine andere Sitzung, und ein Stash zoege ihr die
Dateien unter den Fuessen weg ([[vorschau-wird-geliehen]]).

Jeder Baum bekommt seine EIGENE Vorschau auf seinem EIGENEN Port. Ein
Werkzeug, das die Adresse nicht mitbekommt, misst sonst den falschen Baum.

══ WAS ES AENDERT ═════════════════════════════════════════════════════════
Nichts an einer Datei und NICHTS AN EINER BOX. Es liest und zaehlt.

══ AUFRUF ═════════════════════════════════════════════════════════════════
  python3 tools/aussagen-vergleich.py --vorher /pfad/zum/wegwerfbaum \\
      --vorher-ziel http://127.0.0.1:9112/neu/ \\
      --nachher-ziel http://127.0.0.1:9113/neu/
  python3 tools/aussagen-vergleich.py ... --nur eltern-tor-schau,kind-am-tor
ENDE 0, wenn kein Werkzeug Aussagen verloren hat.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# ── WELCHE WERKZEUGE ZUM UMZUG GEHOEREN ────────────────────────────────────
#
# Die Liste wird NICHT von Hand gepflegt. Sie ergibt sich aus dem, was den
# gemeinsamen Weg ruft — wer `admin-weg.mjs` importiert, ist umgezogen. Eine
# gepflegte Liste liefe genau so auseinander wie die vierunddreissig Kopien,
# die der Umzug beseitigt hat.
def umgezogene():
    treffer = []
    for p in sorted((WURZEL / "tools").glob("*.mjs")):
        t = p.read_text(encoding="utf-8", errors="replace")
        if "admin-weg.mjs" in t and p.name != "admin-weg.mjs":
            treffer.append(p.name[:-4])
    return treffer


# ── WAS ALS AUSSAGE ZAEHLT ─────────────────────────────────────────────────
#
# Die Werkzeuge an diesem Baum drucken ihre Aussagen als `ok    …` bzw.
# `NEIN  …`. Beides zaehlt: eine rote Aussage IST eine Aussage — sie ist
# gemessen worden. Was NICHT zaehlt, ist eine Zeile, die es gar nicht gibt.
OK = re.compile(r"^\s*ok\s", re.M)
NEIN = re.compile(r"^\s*(NEIN|FEHLT|ROT)\b", re.M)


def lauf(werkzeug, baum, ziel, zeit):
    """Ein Werkzeug in einem Baum laufen lassen und seine Aussagen zaehlen."""
    datei = Path(baum) / "tools" / f"{werkzeug}.mjs"
    if not datei.exists():
        return {"da": False, "ok": 0, "nein": 0, "ende": None, "text": ""}
    try:
        r = subprocess.run(
            ["node", f"tools/{werkzeug}.mjs", "--ziel", ziel],
            cwd=baum,
            capture_output=True,
            text=True,
            timeout=zeit,
        )
        aus = (r.stdout or "") + (r.stderr or "")
        ende = r.returncode
    except subprocess.TimeoutExpired as e:
        aus = (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        ende = "ZEIT"
    return {
        "da": True,
        "ok": len(OK.findall(aus)),
        "nein": len(NEIN.findall(aus)),
        "ende": ende,
        "text": aus,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vorher", required=True, help="Wegwerfbaum aus git archive")
    ap.add_argument("--vorher-ziel", required=True)
    ap.add_argument("--nachher-ziel", required=True)
    ap.add_argument("--nachher", default=str(WURZEL))
    ap.add_argument("--nur", default=None, help="Kommaliste statt aller umgezogenen")
    ap.add_argument("--zeit", type=int, default=180)
    a = ap.parse_args()

    liste = a.nur.split(",") if a.nur else umgezogene()
    print(f"WERKZEUGE: {len(liste)}")
    print(f"VORHER : {a.vorher}  -> {a.vorher_ziel}")
    print(f"NACHHER: {a.nachher}  -> {a.nachher_ziel}\n")
    print(f"{'Werkzeug':38} {'vorher':>14} {'nachher':>14}   Urteil")
    print("─" * 96)

    verloren, stumm = [], []
    for w in liste:
        v = lauf(w, a.vorher, a.vorher_ziel, a.zeit)
        n = lauf(w, a.nachher, a.nachher_ziel, a.zeit)
        vs = "—" if not v["da"] else f"{v['ok']}ok/{v['nein']}x e={v['ende']}"
        ns = "—" if not n["da"] else f"{n['ok']}ok/{n['nein']}x e={n['ende']}"

        urteil = ""
        # DIE EINE FRAGE: hat es nach dem Umzug WENIGER zu sagen als vorher?
        if n["da"] and n["ok"] + n["nein"] == 0 and v["ok"] + v["nein"] > 0:
            urteil = "STUMM GEWORDEN — misst nichts mehr"
            stumm.append(w)
        elif n["da"] and v["da"] and n["ok"] + n["nein"] < v["ok"] + v["nein"]:
            urteil = f"WENIGER ({v['ok'] + v['nein']} -> {n['ok'] + n['nein']})"
            verloren.append(w)
        elif n["da"] and n["ok"] + n["nein"] == 0:
            urteil = "druckt nur Messwerte (keine ok-Zeilen)"
        elif n["nein"] > v["nein"]:
            urteil = f"mehr ROT als vorher ({v['nein']} -> {n['nein']})"
        else:
            urteil = "haelt"
        print(f"{w:38} {vs:>14} {ns:>14}   {urteil}")

    print("\n══ Zusammen ══")
    print(f"    stumm geworden : {len(stumm)}  {', '.join(stumm) or '—'}")
    print(f"    weniger Aussagen: {len(verloren)}  {', '.join(verloren) or '—'}")
    return 1 if (stumm or verloren) else 0


if __name__ == "__main__":
    sys.exit(main())
