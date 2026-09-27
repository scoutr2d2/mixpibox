#!/usr/bin/env python3
"""
HAELT DIE AUSSAGE, WAS SIE BEHAUPTET? — Mutationsprobe.

Ein gruener Test, der nichts haelt, ist schlimmer als kein Test: er behauptet
Schutz, den es nicht gibt. Dieses Werkzeug dreht die Zeile um, die eine
Aussage schuetzen SOLL, und sieht nach, ob die Aussage dann ROT wird.

  gruen nach der Mutation = die Aussage haelt NICHTS (Befund)
  rot   nach der Mutation = die Aussage haelt (gut)

NIE IM ARBEITSBAUM. Es wird ein eigener `git worktree` auf HEAD angelegt und
dort mutiert; der Arbeitsbaum des Betreibers (und jede Parallelsitzung darin)
bleibt unberuehrt. node_modules wird hineinverlinkt statt kopiert.

  python3 tools/aussagen-halten.py                # alle Mutationen
  python3 tools/aussagen-halten.py --nur sicherung
  python3 tools/aussagen-halten.py --behalten     # Baum stehen lassen
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@dataclass
class Mutation:
    """Eine Zeile umdrehen und nachsehen, welche Aussage das merkt."""

    gruppe: str
    name: str
    datei: str
    alt: str
    neu: str
    # Womit gemessen wird. {baum} wird durch den Wurzelpfad des Baums ersetzt.
    befehl: list[str]
    cwd: str = "."
    # Welche Aussage(n) rot werden MUESSEN. Leer = irgendeine.
    erwartet: list[str] = field(default_factory=list)


TS_TEST = ["npx", "tsx", "--test", "src/sicherung.spec.ts"]
BACKEND = "src/backend-api"
PROBE = ["python3", "{baum}/tools/medien-einlesen-probe.py"]

MUTATIONEN: list[Mutation] = [
    # ── sicherung.ts ────────────────────────────────────────────────────
    Mutation(
        "sicherung",
        "Passwort bleibt in der Umgebung des Kindes",
        f"{BACKEND}/src/sicherung.ts",
        "  const { MUPIBOX_SICHERUNG_PW: _weg, ...rest } = quelle\n  return rest",
        "  return quelle",
        TS_TEST,
        BACKEND,
        ["MUPIBOX_SICHERUNG_PW NICHT an das Kind"],
    ),
    Mutation(
        "sicherung",
        "Passwort geht als ARGUMENT statt ueber stdin",
        f"{BACKEND}/src/sicherung.ts",
        "  const befehl = [...(umg.vorspann ?? []), umg.python ?? 'python3', umg.skript, ...argumente]",
        "  const befehl = [...(umg.vorspann ?? []), umg.python ?? 'python3', umg.skript, ...argumente,"
        " ...(passwort ? ['--passwort', passwort] : [])]",
        TS_TEST,
        BACKEND,
        ["PASSWORT STEHT IN KEINEM ARGUMENT"],
    ),
    Mutation(
        "sicherung",
        "Zeilenumbruch im Passwort wird durchgelassen",
        f"{BACKEND}/src/sicherung.ts",
        "  if (roh.includes('\\n')) {",
        "  if (false) {",
        TS_TEST,
        BACKEND,
        ["kein Passwort mit Zeilenumbruch"],
    ),
    Mutation(
        "sicherung",
        "zu kurzes Passwort wird angenommen",
        f"{BACKEND}/src/sicherung.ts",
        "export const PASSWORT_MIN = 8",
        "export const PASSWORT_MIN = 0",
        TS_TEST,
        BACKEND,
        ["kurze Passwoerter nicht an"],
    ),
    Mutation(
        "sicherung",
        "Schritt 2 spielt ein, was gerade dort liegt (sha256 nicht geprueft)",
        f"{BACKEND}/src/sicherung.ts",
        "    if (sha256(bytes) !== kennung) {",
        "    if (false) {",
        TS_TEST,
        BACKEND,
        ["NUR DIE BYTES EIN"],
    ),
    Mutation(
        "sicherung",
        "--trotzdem wandert doch in die Argumente",
        f"{BACKEND}/src/sicherung.ts",
        "      const args = ['--wiederherstellen', name]\n      if (mitZugangsdaten) args.push('--mit-zugangsdaten')",
        "      const args = ['--wiederherstellen', name, '--trotzdem']\n"
        "      if (mitZugangsdaten) args.push('--mit-zugangsdaten')",
        TS_TEST,
        BACKEND,
        ["trotzdem"],
    ),
    Mutation(
        "sicherung",
        "Download auch ohne die versprochenen Zugangsdaten",
        f"{BACKEND}/src/sicherung.ts",
        "      if (mitZugangsdaten && kopf.zugangsdaten.length === 0) {",
        "      if (false) {",
        TS_TEST,
        BACKEND,
        ["laedt NICHTS herunter"],
    ),
    Mutation(
        "sicherung",
        "Eingang traegt keine 0 mehr — kann «neueste» werden",
        f"{BACKEND}/src/sicherung.ts",
        "export const EINGANG_VORSILBE = 'mupibox-sicherung-0eingang-'",
        "export const EINGANG_VORSILBE = 'mupibox-sicherung-9eingang-'",
        TS_TEST,
        BACKEND,
        ["NIE «neueste»"],
    ),
    Mutation(
        "sicherung",
        "hoehere Fassung wird eingespielt statt abgelehnt",
        f"{BACKEND}/src/sicherung.ts",
        "  if (kopf.format > FORMAT_BEKANNT) {",
        "  if (false) {",
        TS_TEST,
        BACKEND,
        ["hoehere Fassung"],
    ),
    # ── data_clean.sh ───────────────────────────────────────────────────
    # Der ganze Schutz haengt an basis_taugt. Faellt er, faellt alles.
    Mutation(
        "medien",
        "die Basis taugt IMMER — der ganze Kategorie-Riegel weg",
        "scripts/mupibox/data_clean.sh",
        "basis_taugt() {\n",
        "basis_taugt() {\n\treturn 0\n",
        PROBE,
        ".",
        [],
    ),
    # Die Gegenrichtung: ein Riegel, der IMMER zu ist, verliert nichts mehr —
    # und raeumt auch nichts mehr weg. Merkt das jemand?
    Mutation(
        "medien",
        "die Basis taugt NIE — es faellt ueberhaupt nichts mehr (Gegenprobe)",
        "scripts/mupibox/data_clean.sh",
        "basis_taugt() {\n",
        "basis_taugt() {\n\treturn 1\n",
        PROBE,
        ".",
        [],
    ),
    Mutation(
        "medien",
        "leerer Kategorieordner gilt wieder als «alles geloescht»",
        "scripts/mupibox/data_clean.sh",
        '\that_inhalt "${d}" || return 1',
        '\that_inhalt "${d}" || return 0',
        PROBE,
        ".",
        [],
    ),
    Mutation(
        "medien",
        "ein Zugriff in die Frist gilt wieder als «Ordner weg»",
        "scripts/mupibox/data_clean.sh",
        '\tordner_antwortet "${d}" || return 1',
        '\tordner_antwortet "${d}" || return 0',
        PROBE,
        ".",
        [],
    ),
    Mutation(
        "medien",
        "nicht eingehaengtes fstab-Ziel zaehlt wieder nicht",
        "scripts/mupibox/data_clean.sh",
        '\teinhaengeziel_ohne_einhaengung "${d}" && return 1',
        '\teinhaengeziel_ohne_einhaengung "${d}" && return 0',
        PROBE,
        ".",
        [],
    ),
    Mutation(
        "medien",
        "keine Sicherung mehr vor dem Loeschen",
        "scripts/mupibox/data_clean.sh",
        "\tif ! sicherung_anlegen; then",
        "\tif false; then",
        PROBE,
        ".",
        [],
    ),
    Mutation(
        "medien",
        "Eintraege werden wieder neu gebaut statt durchgereicht (Handfelder weg)",
        "scripts/mupibox/data_clean.sh",
        "'[ to_entries[] | select($behalten[.key]) | .value ]'",
        "'[ to_entries[] | select($behalten[.key]) | .value"
        " | {category,artist,title,type,id,category_index} ]'",
        PROBE,
        ".",
        [],
    ),
    # ── m3u_generator.sh ────────────────────────────────────────────────
    Mutation(
        "medien",
        "«gibt es schon» wieder an der Titelbild-Adresse erkannt",
        "scripts/mupibox/m3u_generator.sh",
        "\t\t'any(.[]; .type == \"library\" and .category == $c and .artist == $a and .title == $t)' \\",
        "\t\t'any(.[]; .cover != null and (.cover | contains($c + \"/\" + $a + \"/\" + $t)))' \\",
        PROBE,
        ".",
        [],
    ),
]


def lauf(befehl: list[str], cwd: str, baum: str) -> tuple[int, str]:
    b = [t.replace("{baum}", baum) for t in befehl]
    umg = dict(os.environ)
    umg["NODE_ENV"] = "test"
    try:
        p = subprocess.run(
            b, cwd=os.path.join(baum, cwd), capture_output=True, text=True, timeout=900, env=umg
        )
    except subprocess.TimeoutExpired:
        return 124, "<Frist>"
    return p.returncode, p.stdout + p.stderr


# Der Baum kommt aus HEAD. Wer eine Aussage GERADE erst geschrieben hat, misst
# sonst die Fassung von vorgestern und bekommt ein „haelt nichts", das nur
# heisst „war noch nicht festgeschrieben" — genau darauf bin ich beim Bauen
# hereingefallen. Diese Dateien werden deshalb aus dem ARBEITSBAUM
# uebernommen. Ausdruecklich einzeln aufgezaehlt und nicht pauschal: ein
# `cp -r tools/` zoege halbfertige Arbeit einer Parallelsitzung mit in die
# Messung.
MITNEHMEN = [
    "tools/medien-einlesen-probe.py",
    f"{BACKEND}/src/sicherung.spec.ts",
]


def baum_anlegen() -> str:
    ziel = tempfile.mkdtemp(prefix="aussagen-halten-")
    ziel = os.path.join(ziel, "baum")
    subprocess.run(
        ["git", "worktree", "add", ziel, "HEAD", "--detach"],
        cwd=REPO,
        capture_output=True,
        check=True,
    )
    # node_modules verlinken statt installieren
    for rel in ("node_modules", "src/backend-api/node_modules"):
        quelle = os.path.join(REPO, rel)
        if os.path.isdir(quelle):
            ziel_n = os.path.join(ziel, rel)
            if not os.path.exists(ziel_n):
                os.symlink(quelle, ziel_n)
    for rel in MITNEHMEN:
        quelle = os.path.join(REPO, rel)
        if os.path.isfile(quelle):
            shutil.copy2(quelle, os.path.join(ziel, rel))
            geaendert = subprocess.run(
                ["git", "diff", "--quiet", "HEAD", "--", rel], cwd=REPO
            ).returncode
            if geaendert:
                print(f"[arbeitsbaum] {rel} weicht von HEAD ab — gemessen wird die neue Fassung")
    return ziel


def baum_weg(baum: str) -> None:
    subprocess.run(
        ["git", "worktree", "remove", "--force", baum], cwd=REPO, capture_output=True
    )
    shutil.rmtree(os.path.dirname(baum), ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nur", default="")
    ap.add_argument("--behalten", action="store_true")
    a = ap.parse_args()

    mutationen = [m for m in MUTATIONEN if not a.nur or m.gruppe == a.nur]
    mutationen = [m for m in mutationen if m.alt != m.neu]

    baum = baum_anlegen()
    print(f"Baum: {baum}\n")

    # Grundlage: ohne Mutation muss alles gruen sein.
    grundlagen: dict[tuple[str, ...], bool] = {}
    for m in mutationen:
        schluessel = tuple(m.befehl) + (m.cwd,)
        if schluessel in grundlagen:
            continue
        code, _ = lauf(m.befehl, m.cwd, baum)
        grundlagen[schluessel] = code == 0
        print(f"[grundlage] {' '.join(m.befehl)} → {'gruen' if code == 0 else 'ROT'}")
    print()

    befunde: list[str] = []
    for m in mutationen:
        pfad = os.path.join(baum, m.datei)
        with open(pfad, encoding="utf-8") as f:
            urtext = f.read()
        if urtext.count(m.alt) != 1:
            print(f"[?!]  {m.gruppe}/{m.name}: Stelle {urtext.count(m.alt)}x gefunden — uebersprungen")
            befunde.append(f"MUTATION GING NICHT: {m.name} (Stelle nicht eindeutig)")
            continue
        with open(pfad, "w", encoding="utf-8") as f:
            f.write(urtext.replace(m.alt, m.neu))
        try:
            code, aus = lauf(m.befehl, m.cwd, baum)
        finally:
            with open(pfad, "w", encoding="utf-8") as f:
                f.write(urtext)

        if code == 0:
            print(f"[BEFUND] {m.gruppe}/{m.name}")
            print("         Mutation eingebaut — es wurde KEINE Aussage rot.")
            befunde.append(f"{m.gruppe}: {m.name} — keine Aussage merkt es")
            continue

        getroffen = [z for z in aus.splitlines() if z.strip().startswith(("not ok", "✖", "[rot]"))]
        fehlt = [e for e in m.erwartet if e not in aus]
        marke = "ok" if not fehlt else "TEILWEISE"
        print(f"[{marke}]     {m.gruppe}/{m.name} → rot ({len(getroffen)} Aussagen)")
        for z in getroffen[:4]:
            print(f"           {z.strip()[:110]}")
        if fehlt:
            befunde.append(
                f"{m.gruppe}: {m.name} — rot, aber NICHT bei der erwarteten Aussage: {fehlt}"
            )

    print()
    if befunde:
        print(f"{len(befunde)} BEFUND(E):")
        for b in befunde:
            print(f"  * {b}")
    else:
        print(f"{len(mutationen)} Mutationen, alle wurden bemerkt.")

    if a.behalten:
        print(f"\nBaum bleibt stehen: {baum}")
    else:
        baum_weg(baum)
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main())
