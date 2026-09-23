#!/usr/bin/env python3
"""Zwei Repos, EIN Ziel auf der Box — und zwei verschiedene Inhalte.

WARUM ES DAS GIBT (27.08.2026)
`tools/zwillingsdateien-abgleich.py` gibt es seit dem 05.08.2026 fuer genau
diese Frage. Es findet Zwillinge ueber die AEHNLICHKEIT ihrer Zeilen und haelt
dafuer `SCHWELLE = 0.5` fest. Sein eigener Kommentar benennt die Richtung des
Fehlers schon:

    "0.5 ist bewusst niedrig: eine Datei, die in einem Repo doppelt so lang
     geworden ist, kommt sonst nicht mehr ueber die Schwelle — und wird
     ausgerechnet dann uebersehen, wenn sie am weitesten auseinander ist."

Gegen die Richtung hilft aber keine kleinere Zahl. AEHNLICHKEIT IST DAS
GEGENTEIL VON SCHWERE: je weiter zwei Fassungen auseinanderlaufen, desto
sicherer faellt das Paar unter jede Schwelle. Am 27.08.2026 nachgemessen:

    /etc/asound.conf              box  9 Zeilen   installer 23 Zeilen
    /opt/mupibox-tools/bootwache.py   box 808 Zeilen  installer 197 Zeilen

Beide Paare liegen unter 0.5 und stehen deshalb im Lauf der alten Wache unter
"nur namensgleich — Rauschen" bzw. tauchen gar nicht auf (`bootwache.py` heisst
im Installer `mupibox-bootwache.py`, der Namensdurchgang greift nicht, und fuer
den Inhaltsdurchgang sind 197 gegen 808 Zeilen kein Kandidat). Gemeldet wird
allein `mupibox-boot-splash.py` mit 90 % — das MILDESTE der drei.

`asound.conf` steht sogar woertlich im Kopf der alten Wache, als Beleg dafuer,
dass Namensgleichheit nichts heisst ("hat 6 % gemeinsame Zeilen"). Das ist die
Umkehrung: die 6 % sind nicht der Beweis, dass es kein Zwilling ist, sondern
das Mass, wie weit der Zwilling auseinandergelaufen ist.

DIE LEHRE, UM DIE ES GEHT — dieselbe Bauart wie "Wache auf Sorte, nicht auf
Pfad" (26./27.08.): Eine Wache darf ihren Gegenstand nicht an einem Merkmal
festmachen, das mit dem gesuchten Fehler VERSCHWINDET. Das Merkmal, das bleibt,
ist hier das ZIEL AUF DER BOX. Zwei Dateien sind Zwillinge, wenn beide Wege
sie an DIESELBE Stelle legen — egal, wie sie heissen und wie verschieden sie
inzwischen sind.

WAS ES LIEST (nichts wird geraten, alles steht in einer Datei)

  Installer-Seite   remote-step-installer/recipes/*.yaml, `put:` mit `src`/`dest`.
                    Landet ein `put:` in /tmp, gilt es nicht als Ziel: dann wird
                    im `run:` DESSELBEN Schritts gesucht, wohin die Datei von
                    dort kopiert wird (`install|cp|mv … /tmp/x ZIEL`). Genau so
                    laeuft asound.conf.
  Box-Seite         autosetup/autosetup.sh und update/start_mupibox_update.sh,
                    Zeilen der Form `mv|cp|install [-flags] ${MUPI_SRC}/QUELLE ZIEL`.
                    `QUELLE/*` wird am Baum aufgeloest, ein ZIEL mit Schrägstrich
                    am Ende bekommt den Basisnamen angehaengt. Genau so laeuft
                    scripts/box/* nach /opt/mupibox-tools/.

WAS ES NICHT KANN
Sagen, WELCHE Fassung die richtige ist — das ist eine Entscheidung, keine
Messung (siehe den Kopf der alten Wache). Und es sieht nur, was ueber diese
beiden Wege geht; ein Ziel, das nur ein `run:`-Block ohne `put:` schreibt, hat
keine Repo-Datei, die man vergleichen koennte.

VERHAELTNIS ZUR ALTEN WACHE
Sie bleibt. Sie findet Zwillinge, die ueber KEINEN der beiden Wege gehen, und
sie findet umbenannte Paare ueber den Inhalt. Diese hier findet die Paare, die
ihr durch die Schwelle fallen. Beide zusammen decken die Frage; keine allein.

AUFRUF
    python3 tools/zwillinge-nach-ziel.py
    python3 tools/zwillinge-nach-ziel.py --pruefen    # still, Ruecklauf 1 bei Befund
    python3 tools/zwillinge-nach-ziel.py --alle       # auch die Paare im Gleichstand
"""

import difflib
import glob as globmod
import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER = os.path.join(WURZEL, "remote-step-installer")

BOX_WEGE = [
    "autosetup/autosetup.sh",
    "update/start_mupibox_update.sh",
]

# Ziele, an denen zwei verschiedene Fassungen ABSICHT sind. Ohne diese Liste
# meldet jeder Lauf denselben begruendeten Fall, und der naechste echte Befund
# geht darin unter (Lehre "Dauerrote Wache ist keine", 26.08.2026).
# Jeder Eintrag braucht einen Grund, den ein Fremder nachlesen kann.
ABSICHT: dict[str, str] = {
    "/etc/systemd/system/mupibox-boot-splash.service": (
        "Die beiden ExecStart-Zeilen zeigen mit Absicht auf verschiedene Pfade: "
        "Installer /usr/local/bin/mupibox-boot-splash.py, box-Repo "
        "/usr/local/bin/mupibox/mupibox-boot-splash.py — jeder Weg legt das "
        "Skript an seine eigene Stelle, und ein woertlicher Nachzug liesse die "
        "jeweils andere Unit ins Leere zeigen. Der Rest des Unterschieds sind "
        "Kommentare. Gleiche Begruendung wie in ABSICHT von "
        "tools/zwillingsdateien-abgleich.py — beide Listen gehoeren zusammen "
        "gepflegt. Der INHALT von mupibox-boot-splash.py wird dagegen "
        "gleichgehalten und ist dort ein offener Befund."
    ),
}


def datei_lesen(pfad: str) -> str | None:
    try:
        with open(pfad, encoding="utf-8", errors="replace") as f:
            return f.read()
    except (OSError, UnicodeError):
        return None


def aehnlichkeit(a: str, b: str) -> float:
    az = [z for z in a.splitlines() if z.strip()]
    bz = [z for z in b.splitlines() if z.strip()]
    if not az or not bz:
        return 0.0
    return difflib.SequenceMatcher(None, az, bz).ratio()


# Schalter eines Kopierbefehls, die vor den beiden Pfaden stehen duerfen:
# `-f`, `--force` — und der Wert eines Schalters, der einen NACHGESTELLT traegt
# (`install -m 644 …`). Ohne den zweiten Fall bleibt das Muster an der `644`
# haengen; genau so fiel asound.conf im ersten Lauf durch. Ohne Fangklammer,
# damit die Gruppennummern der Pfade stabil bleiben.
SCHALTER = r"(?:\s+(?:-{1,2}[^\s]+|[0-7]{3,4}))*"


# ── Installer-Seite ────────────────────────────────────────────────────────

def _tmp_ziel_aus_run(run: str, tmp: str) -> str | None:
    """Wohin schiebt der `run:`-Block die Datei aus /tmp?"""
    # `install -m 644 /tmp/x /etc/x`: der Schalter `-m` traegt seinen Wert als
    # EIGENES Wort hinterher. Ein Muster, das nur `-…`-Woerter ueberspringt,
    # bleibt am `644` haengen und meldet den Schritt als unentscheidbar —
    # genau so fiel asound.conf im ersten Lauf durch.
    muster = re.compile(
        r"\b(?:install|cp|mv)\b" + SCHALTER + r"\s+" + re.escape(tmp) + r"\s+(\S+)"
    )
    m = muster.search(run)
    return m.group(1) if m else None


def installer_ziele() -> tuple[dict[str, str], list[str]]:
    """Ziel auf der Box -> Repo-Datei im Installer. Plus: was unentscheidbar blieb."""
    import yaml

    ziele: dict[str, str] = {}
    offen: list[str] = []
    for rez in sorted(globmod.glob(os.path.join(INSTALLER, "recipes", "*.yaml"))):
        with open(rez, encoding="utf-8") as f:
            d = yaml.safe_load(f) or {}
        for schritt in d.get("steps") or []:
            run = schritt.get("run") or ""
            for p in schritt.get("put") or []:
                src = p.get("src") or p.get("von")
                dest = p.get("dest") or p.get("nach")
                if not src or not dest:
                    continue
                if "$" in src:            # ${MUPI_REPO}/… -> das ist die box-Seite
                    continue
                quelle = os.path.join(INSTALLER, src)
                if not os.path.exists(quelle):
                    continue
                if dest.startswith("/tmp/"):
                    echtes = _tmp_ziel_aus_run(run, dest)
                    if not echtes:
                        offen.append(f"{os.path.basename(rez)}:{schritt.get('id')} {src} -> {dest}")
                        continue
                    dest = echtes
                if dest.endswith("/"):
                    dest += os.path.basename(src.rstrip("/"))
                ziele[os.path.normpath(dest)] = quelle
    return ziele, offen


# ── Box-Seite ──────────────────────────────────────────────────────────────

KOPIERZEILE = re.compile(
    r"\b(?:mv|cp|install)\b" + SCHALTER + r"\s+\$\{MUPI_SRC\}/(\S+)\s+(\S+)"
)


def box_ziele() -> dict[str, str]:
    """Ziel auf der Box -> Repo-Datei im box-Repo."""
    ziele: dict[str, str] = {}
    for weg in BOX_WEGE:
        text = datei_lesen(os.path.join(WURZEL, weg))
        if text is None:
            continue
        for zeile in text.splitlines():
            if zeile.lstrip().startswith("#"):
                continue
            m = KOPIERZEILE.search(zeile)
            if not m:
                continue
            quelle_roh, ziel_roh = m.group(1), m.group(2)
            if "$" in ziel_roh or "$" in quelle_roh.replace("*", ""):
                continue
            if "*" in quelle_roh:
                for treffer in sorted(globmod.glob(os.path.join(WURZEL, quelle_roh))):
                    if not os.path.isfile(treffer):
                        continue
                    ziel = ziel_roh.rstrip("/") + "/" + os.path.basename(treffer)
                    ziele[os.path.normpath(ziel)] = treffer
                continue
            quelle = os.path.join(WURZEL, quelle_roh)
            if not os.path.isfile(quelle):
                continue
            ziel = ziel_roh
            if ziel.endswith("/"):
                ziel += os.path.basename(quelle_roh)
            ziele[os.path.normpath(ziel)] = quelle
    return ziele


# ── Urteil ─────────────────────────────────────────────────────────────────

def kurz(pfad: str) -> str:
    return os.path.relpath(pfad, WURZEL)


def main() -> int:
    still = "--pruefen" in sys.argv
    alle = "--alle" in sys.argv

    ziel_inst, offen = installer_ziele()
    ziel_box = box_ziele()
    gemeinsam = sorted(set(ziel_inst) & set(ziel_box))

    befunde, gleich, absicht = [], [], []
    for ziel in gemeinsam:
        a, b = ziel_box[ziel], ziel_inst[ziel]
        ta, tb = datei_lesen(a), datei_lesen(b)
        if ta is None or tb is None:
            continue
        if ta == tb:
            gleich.append((ziel, a, b))
        elif ziel in ABSICHT:
            absicht.append((ziel, a, b))
        else:
            befunde.append((ziel, a, b, aehnlichkeit(ta, tb)))

    if still:
        return 1 if befunde else 0

    print(f"box-Repo:  {WURZEL}")
    print(f"Installer: {INSTALLER}")
    print()
    print(
        f"{len(gemeinsam)} Ziele bedienen beide Wege — "
        f"{len(gleich)} im Gleichstand, {len(befunde)} AUSEINANDER, "
        f"{len(absicht)} mit Absicht verschieden"
    )
    print()

    if befunde:
        print("AUSEINANDERGELAUFEN — beide Wege legen an DIESELBE Stelle,")
        print("und je nachdem, wie die Box aufgesetzt wurde, steht dort etwas anderes:")
        for ziel, a, b, ae in befunde:
            za, zb = len(datei_lesen(a).splitlines()), len(datei_lesen(b).splitlines())
            print(f"  * {ziel}")
            print(f"      box:       {kurz(a)}  ({za} Zeilen)")
            print(f"      installer: {kurz(b)}  ({zb} Zeilen)")
            print(f"      Aehnlichkeit {ae * 100:.0f} % — "
                  f"{'unter' if ae < 0.5 else 'ueber'} der Schwelle der alten Wache")
            print(f"      diff -u {b} \\\n              {a}")
        print()

    if absicht:
        print("MIT ABSICHT VERSCHIEDEN (kein Befund — Begruendung in ABSICHT):")
        for ziel, a, b in absicht:
            print(f"  * {ziel}\n      {ABSICHT[ziel]}")
        print()

    if alle and gleich:
        print("IM GLEICHSTAND (doppelt gelegt — jede Aenderung gehoert an BEIDE Stellen):")
        for ziel, a, b in gleich:
            print(f"  {ziel}\n      {kurz(a)}  <->  {kurz(b)}")
        print()
    elif gleich:
        print(f"({len(gleich)} Ziele im Gleichstand — mit --alle anzeigen)")

    if offen:
        print()
        print("NICHT ENTSCHEIDBAR — das put: landet in /tmp, und im run: desselben")
        print("Schritts steht nicht, wohin es von dort geht:")
        for o in offen:
            print(f"  {o}")

    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
