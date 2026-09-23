#!/usr/bin/env python3
# ── WOHIN DIE SPRUNGMARKE EINES MARKDOWN-VERWEISES ZEIGT ──────────────────
# `md-verweise-pruefen.py` prueft das ZIEL eines Verweises `[text](ziel)` —
# aber nur die Datei davor. Seine Zeile
#
#     ziel = m.group(1).split("#")[0].strip()
#
# wirft die Sprungmarke weg, und sein `FREMD`-Muster (`^#`) verwirft einen
# rein seitenintern springenden Verweis `[x](#abschnitt)` ganz. Das ist fuer
# eine PFAD-Wache richtig — eine Sprungmarke ist kein Pfad. Der PREIS stand
# nirgends: **ein Verweis, dessen Datei stimmt und dessen Marke ins Leere
# zeigt, wird von keiner Wache bemerkt.**
#
# GEMESSEN 03.09.2026 im HEAD-Baum: 54 Prosadateien, 16 Verweise mit
# Sprungmarke — alle 16 seitenintern, alle 16 von der Nachbarwache
# uebersprungen. Die Richtung war zu 100 % ungedeckt.
#
# Das ist dieselbe Sorte Blindstelle wie die drei im Kopf der Nachbarwache:
# die Wache misst, was sie messen soll, und der ungemessene Rest sieht von
# aussen aus wie Deckung. llmwiki: `wache-auf-sorte-nicht-auf-pfad`.
#
# ── DIE SORTE HIER IST DIE UEBERSCHRIFT, NICHT DIE DATEI ──────────────────
# Geprueft wird gegen die Ueberschriften der ZIELdatei, nach der Slug-Regel,
# die GitHub und die uebliche Markdown-Werkzeugkette anwenden:
# kleinschreiben, Auszeichnung und Satzzeichen raus, Leerzeichen zu
# Bindestrich, Dubletten mit `-1`, `-2`. Zusaetzlich gelten ausdrueckliche
# HTML-Anker (`<a name="x">`, `id="x"`), denn die Doku setzt sie stellenweise
# von Hand.
#
# ── ZWEI URTEILE, WEIL EIN FEHLENDES ZIEL NICHT DASSELBE IST ──────────────
#   TOTE MARKE   — Zieldatei da, Sprungmarke gibt es dort nicht
#   UNPRUEFBAR   — Zieldatei ist keine verfolgte `.md` (dann urteilt die
#                  Nachbarwache ueber den Pfad, nicht diese hier)
# Die zweite Zahl wird GEMELDET statt still verworfen; ein stiller Ausschluss
# liest sich wie Deckung. llmwiki: `dauerrote-wache-ist-keine`.
#
# ── AUDIT-*.md BLEIBEN DRAUSSEN ───────────────────────────────────────────
# Momentaufnahmen nennen vergangene Staende, deren Abwesenheit ihr Befund
# IST — dieselbe Begruendung und dieselbe Regel wie in den beiden
# Nachbarwachen. Die Zahl wird gemeldet.
#
# Gegenprobe: `--selbsttest` baut die vier Faelle (gute Marke, tote Marke,
# Dublette, HTML-Anker) im Speicher nach und prueft das Urteil.
import os
import re
import subprocess
import sys

MOMENTAUFNAHME = re.compile(r"(^|/)AUDIT-\d{4}-\d{2}-\d{2}\.md$")

# `[text](ziel)` — ohne verschachtelte Klammern im Ziel.
VERWEIS = re.compile(r"\[[^\]]*\]\(([^()\s]+)(?:\s+\"[^\"]*\")?\)")

# Kein Baumziel: Netzadressen und Mail. `#` fehlt hier ABSICHTLICH — der
# seitalinterne Sprung ist genau der Fall, den diese Wache pruefen soll.
FREMD = re.compile(r"^(https?:|mailto:|ftp:|//)")

UNSCHARF = ("*", "<", "{", "...", "$")

ZAUN = re.compile(r"^\s{0,3}(```|~~~)")
UEBERSCHRIFT = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
HTML_ANKER = re.compile(r"<a[^>]+(?:name|id)\s*=\s*[\"']([^\"']+)[\"']", re.I)


def marke(text):
    """Ueberschrift -> Sprungmarke, nach der ueblichen Markdown-Slug-Regel."""
    s = text.strip().lower()
    s = re.sub(r"<[^>]+>", "", s)          # HTML raus
    s = re.sub(r"!?\[([^\]]*)\]\([^()]*\)", r"\1", s)  # Verweis -> sein Text
    s = re.sub(r"[`*_~]", "", s)           # Auszeichnung raus
    s = re.sub(r"[^\w\- ]", "", s, flags=re.UNICODE)   # Satzzeichen raus
    return s.replace(" ", "-")


def marken_der_datei(text):
    """Alle Sprungmarken, die diese Datei anbietet — Zaeune uebersprungen."""
    raus = set()
    gesehen = {}
    im_zaun = False
    for zeile in text.splitlines():
        if ZAUN.match(zeile):
            im_zaun = not im_zaun
            continue
        if im_zaun:
            continue
        for anker in HTML_ANKER.findall(zeile):
            raus.add(anker)
        m = UEBERSCHRIFT.match(zeile)
        if not m:
            continue
        s = marke(m.group(2))
        if not s:
            continue
        n = gesehen.get(s, 0)
        gesehen[s] = n + 1
        raus.add(s if n == 0 else f"{s}-{n}")
    return raus


def verweise_der_datei(text):
    """(Ziel, Zeile) je Verweis — Zaeune uebersprungen."""
    raus = []
    im_zaun = False
    nr = 0
    for zeile in text.splitlines():
        nr += 1
        if ZAUN.match(zeile):
            im_zaun = not im_zaun
            continue
        if im_zaun:
            continue
        for m in VERWEIS.finditer(zeile):
            raus.append((m.group(1), nr))
    return raus


def _git(*mehr):
    aus = subprocess.run(
        ["git", "ls-files", "-z", *mehr], capture_output=True, text=True, check=True
    ).stdout.split("\0")
    return {p for p in aus if p}


def selbsttest():
    """Gegenprobe: das Urteil an gebauten Faellen, nicht am Baum."""
    quelle = "\n".join(
        [
            "# Erster Teil",
            "## Zweiter Teil",
            "## Zweiter Teil",
            '<a name="handgesetzt"></a>',
            "```",
            "# Im Zaun",
            "```",
        ]
    )
    hat = marken_der_datei(quelle)
    erwartet = {"erster-teil", "zweiter-teil", "zweiter-teil-1", "handgesetzt"}
    fehler = []
    if hat != erwartet:
        fehler.append(f"Marken falsch: {sorted(hat)} statt {sorted(erwartet)}")
    if "im-zaun" in hat:
        fehler.append("Ueberschrift im Zaun wurde gezaehlt")
    if marke("Die Wache, die `nichts` sieht!") != "die-wache-die-nichts-sieht":
        fehler.append(f"Slug falsch: {marke('Die Wache, die `nichts` sieht!')}")
    if marke("Grosse Zaehler fuer Muell") != "grosse-zaehler-fuer-muell":
        fehler.append("Umlautfreier Slug falsch")
    ziele = verweise_der_datei("[a](#erster-teil)\n```\n[b](#tot)\n```\n[c](x.md#y)")
    if [z for z, _ in ziele] != ["#erster-teil", "x.md#y"]:
        fehler.append(f"Verweise falsch: {ziele}")
    for f in fehler:
        print(f"  SELBSTTEST FEHLER: {f}")
    if fehler:
        return 1
    print("Selbsttest gruen: Slug, Dublette, HTML-Anker, Zaun.")
    return 0


def main():
    if "--selbsttest" in sys.argv:
        return selbsttest()

    verfolgt = _git("--cached")
    gelesen = _git("--cached", "--others", "--exclude-standard")
    alle_md = sorted(p for p in gelesen if p.endswith(".md"))
    momentaufnahmen = [p for p in alle_md if MOMENTAUFNAHME.search(p)]
    dateien = [p for p in alle_md if p not in momentaufnahmen]

    # Riegel wie bei den Nachbarwachen: eine ABGELEITETE Liste kann man
    # versehentlich leeren. Absichtlich keine Mindestzahl
    # (llmwiki: `tests-duerfen-keine-zahlen-festnageln`), sondern die
    # Ablagen, die es seit Jahren gibt.
    for k in ("README.md", "BACKLOG.md", "plugins/README.md", "dokumentation/mixpibox.md"):
        if k not in dateien:
            print(f"  WARNUNG: {k} kam in der Ableitung nicht an — git ls-files geaendert?")

    text_von = {}

    def lies(p):
        if p not in text_von:
            try:
                text_von[p] = open(p, encoding="utf-8").read()
            except OSError:
                text_von[p] = None
        return text_von[p]

    marken_von = {}

    def marken(p):
        if p not in marken_von:
            t = lies(p)
            marken_von[p] = marken_der_datei(t) if t is not None else set()
        return marken_von[p]

    tot = {}
    geprueft = 0
    unpruefbar = 0

    for datei in dateien:
        text = lies(datei)
        if text is None:
            print(f"  WARNUNG: {datei} nicht lesbar")
            continue
        for ziel, zeile in verweise_der_datei(text):
            if "#" not in ziel or FREMD.match(ziel):
                continue
            pfad, _, sprung = ziel.partition("#")
            sprung = sprung.strip()
            if not sprung or any(u in ziel for u in UNSCHARF):
                continue
            if pfad.startswith("/") or pfad.startswith("~"):
                unpruefbar += 1
                continue
            if not pfad:
                zielDatei = datei
            else:
                # Das Ziel gilt ab der nennenden Datei.
                zielDatei = os.path.normpath(os.path.join(os.path.dirname(datei), pfad))
            if not zielDatei.endswith(".md") or (
                zielDatei not in verfolgt and zielDatei != datei
            ):
                # Ueber den PFAD urteilt `md-verweise-pruefen.py`.
                unpruefbar += 1
                continue
            if lies(zielDatei) is None:
                unpruefbar += 1
                continue
            geprueft += 1
            if sprung not in marken(zielDatei):
                tot.setdefault(f"{zielDatei}#{sprung}", []).append(f"{datei}:{zeile}")

    print(
        f"── {len(dateien)} Prosadateien gelesen, {len(momentaufnahmen)} Momentaufnahmen "
        f"(AUDIT-*.md) uebersprungen, {geprueft} Sprungmarken geprueft, "
        f"{unpruefbar} unpruefbar (Ziel keine verfolgte .md) ──"
    )

    if geprueft == 0 and unpruefbar == 0:
        print("  WARNUNG: keine einzige Sprungmarke gesehen — Muster oder Ableitung kaputt?")
        return 1

    for ziel, orte in sorted(tot.items()):
        print(f"  TOTE MARKE: {ziel}   (genannt in {', '.join(sorted(orte))})")

    if tot:
        print(f"{len(tot)} LUECKE(N) von {geprueft} geprueften Sprungmarken.")
        return 1
    print(f"Keine tote Sprungmarke. {geprueft} geprueft.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
