#!/usr/bin/env python3
"""SIMULATIONSREZEPT — legt jemand hin, was `harness/docker-compose.yml` einhaengt?

WARUM ES DAS GIBT (26.08.2026): die 33 Wachen in `tools/doku-luecken-probe.sh`
sind je DATEI-SORTE entstanden — Handbuch (Prosa), Testdatei, `package.json`,
systemd-Unit, Express-Route, Umgebungsvariable, seit dem 24.08. die Bauanleitung
(`Dockerfile`) und seit dem 26.08. die Momentaufnahme (Analyse-MDs). `harness/`
ist die SECHSTE Sorte und fiel durch jedes Raster: das **Simulationsrezept**,
also die Datei, die sagt, wie der ganze Stapel auf der Entwicklungsmaschine
faehrt. Sie ist der Tier-A-Weg aus `MODERNIZATION.md` §5 — der Weg, den ein
Neuzugang als ERSTES geht.

── DIE ZWEI FUNDE BEIM ERSTEN LAUF ────────────────────────────────────────
1. `../AdminInterface/www` (Dienst `admin`). Der Ordner ist mit E47 am
   19.08.2026 ausgebaut; im Baum liegen null versionierte Dateien darunter und
   null `.php` ueberhaupt. `--profile admin up` scheitert seither. Gemeldet hat
   es `AUDIT-2026-08-25.md` §10 — in der PRUEFENDEN Datei, nie in der
   gepruesten; `harness/README.md` behauptete daneben „no PHP admin".
2. **`./state/config-api.json` und `./state/mupiboxconfig.json` legt NIEMAND
   an.** `seed_state()` in `mupictl` schreibt `mupihat.json`, `resume.json`,
   `active_resume.json` und kopiert `data.json` — diese zwei nicht, obwohl es
   `harness/seed/config-api.json` und `harness/seed/mupiboxconfig.json` gibt.
   Docker legt fuer einen fehlenden Bind-Mount ein **Verzeichnis** an. Auf einem
   frischen Klon bekommt `backend-api` also einen ORDNER, wo seine `config.json`
   liegen soll. Auf dieser Maschine faellt es nicht auf: dort liegen die zwei
   Dateien seit dem 24.07. von Hand.

Das ist dieselbe Klasse wie der Dockerfile-Fund vom 24.08. — ein Rezept zeigt
auf etwas, das kein Weg hinlegt —, nur eine Datei-Sorte weiter.

── DIE REGEL, UND WARUM SIE NICHT „ALLES MUSS DA SEIN" HEISST ─────────────
Ein fehlender Bind-Mount ist nicht immer ein Fehler. `./state/tls` ist
ausdruecklich freiwillig („leer -> http"), und ein fehlendes VERZEICHNIS legt
Docker an, ohne dass etwas kaputtgeht. Ein fehlender DATEI-Mount dagegen wird
zum Verzeichnis am Ort einer Datei, und der Leser sieht einen Fehler, den er
nirgends erklaert findet.

  Quelle liegt im Baum                     -> gut
  Quelle wird von `seed_state()` angelegt  -> gut
  Quelle sieht nach Verzeichnis aus        -> gut (Docker legt es an)
  sonst (Datei mit Endung)                 -> FUND

Die Liste der angelegten Dateien wird aus `mupictl` GELESEN, nicht gepflegt —
nur aus dem Rumpf von `seed_state()`, nicht aus der ganzen Datei: der Unterbefehl
`state)` nennt `mupihat.json` ebenfalls, und wer die ganze Datei greppt, haelt
jede Erwaehnung fuer eine Anlage. llmwiki
`eine-wache-die-eine-ablage-nicht-kennt-meldet-dort-ewig-gruen` und
`ausnahmeliste-gilt-je-datei-nicht-je-name`.

── ZWEITE FRAGE: KENNT DAS README DIE DIENSTE? ────────────────────────────
Beide Richtungen, wie `tools/sektionen-deckung.py` es vormacht: ein Dienst ohne
Zeile im README ist unsichtbar (so ueberlebte `admin` vier Wochen), und eine
README-Zeile ohne Dienst schickt jemanden auf einen Weg, den es nicht gibt.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/simulationsrezept-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import os
import re
import subprocess
import sys

import yaml

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(WURZEL)

REZEPT = "harness/docker-compose.yml"
README = "harness/README.md"
STEUERUNG = "mupictl"

luecken = []

# ── WARUM `git ls-files` UND NICHT `os.path.exists` ───────────────────────
# Die erste Fassung fragte das DATEISYSTEM und meldete gruen — auf einer
# Maschine, auf der beide Funde offen dalagen: `AdminInterface/www` steht als
# leerer, root-eigener Ordner herum (E47 hat den INHALT entfernt, nicht die
# Huelle), und `harness/state/config-api.json` liegt hier seit dem 24.07. von
# Hand. Beides ist auf einem frischen Klon nicht da. Der BAUM ist, was git
# fuehrt; alles andere ist Ruecklass dieser einen Maschine.
# llmwiki `einmal-hinsehen-ist-keine-messung`.
_GEFUEHRT = set(
    subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
)
_GEFUEHRTE_ORDNER = {os.path.dirname(p) for p in _GEFUEHRT}
_GEFUEHRTE_ORDNER |= {d for p in _GEFUEHRT for d in [os.path.dirname(p)] if d}


def im_baum(pfad):
    """Fuehrt git diesen Pfad — als Datei oder als Ordner mit Inhalt?"""
    pfad = pfad.rstrip("/")
    if pfad in _GEFUEHRT:
        return True
    return any(p.startswith(pfad + "/") for p in _GEFUEHRT)


def fehler(text):
    print(f"  FEHLT: {text}")
    luecken.append(text)


def angelegte_pfade():
    """Was `seed_state()` in `mupictl` wirklich hinlegt — aus dem Rumpf gelesen.

    NICHT die ganze Datei greppen: `state)` zeigt `state/mupihat.json` nur an.
    Eine Wache, die Anzeigen fuer Anlagen haelt, deckt genau den Fall zu, den
    sie finden soll.
    """
    if not os.path.exists(STEUERUNG):
        fehler(f"`{STEUERUNG}` gibt es nicht — umbenannt? Die Wache kann nichts messen.")
        return set()
    zeilen = open(STEUERUNG, encoding="utf-8").read().splitlines()
    rumpf, drin = [], False
    for z in zeilen:
        if re.match(r"^\s*seed_state\s*\(\)\s*\{", z):
            drin = True
            continue
        if drin and re.match(r"^\}", z):
            break
        if drin:
            rumpf.append(z)
    if not rumpf:
        fehler(f"`seed_state()` steht nicht mehr in `{STEUERUNG}` — umbenannt? Muster kaputt?")
        return set()
    # `mkdir -p "$HARNESS/state" "$HARNESS/state/media"` und die `> "$HARNESS/…"`.
    return {m.group(1) for m in re.finditer(r'\$HARNESS/([A-Za-z0-9_./-]+)', "\n".join(rumpf))}


# ── DIE AUSNAHME STEHT IM REZEPT, NICHT IN DIESER DATEI ──────────────────
# Der Dienst `admin` ist mit E47 gestorben und laesst sich nicht reparieren —
# der Baum, den er einhaengt, ist weg. Eine Wache, die ihn ewig rot meldet,
# wird weggeschaut (llmwiki `dauerrote-wache-ist-keine`); eine Namensliste HIER
# waere eine Ausnahme, die niemand sieht, der das Rezept liest.
# Deshalb: wer einen Dienst fuer tot erklaert, schreibt es UEBER den Dienst.
# Die Wache meldet ihn dann als VERMERKT weiter — sichtbar, aber nicht rot.
TOD = re.compile(r"\b(tot|historisch|stillgelegt|ausgebaut|leiche)\b", re.I)


def vermerkte_tote(text):
    """Dienste, ueber denen im Rezept ein Todesvermerk steht."""
    tote, block = set(), []
    for z in text.splitlines():
        s = z.strip()
        if s.startswith("#"):
            block.append(s)
            continue
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", z)
        if m and any(TOD.search(k) for k in block):
            tote.add(m.group(1))
        if s:
            block = []
    return tote


def dienste_und_mounts():
    rezept = yaml.safe_load(open(REZEPT, encoding="utf-8"))
    if not isinstance(rezept, dict) or "services" not in rezept:
        fehler(f"`{REZEPT}` hat keinen `services:`-Block — Format geaendert?")
        return {}, []
    dienste = rezept["services"]
    mounts = []
    for name, d in dienste.items():
        for v in (d or {}).get("volumes", []) or []:
            if not isinstance(v, str):
                continue
            quelle = v.split(":")[0]
            # Nur Bind-Mounts. Ein benanntes Volume (`api_node_modules`) hat
            # keinen Ort im Baum und ist hier nicht gemeint.
            if quelle.startswith(("./", "../")):
                mounts.append((name, quelle))
    return dienste, mounts


print(f"── Quellen, die `{REZEPT}` einhaengt ──")

if not os.path.exists(REZEPT):
    fehler(f"`{REZEPT}` gibt es nicht — verschoben?")
else:
    angelegt = angelegte_pfade()
    dienste, mounts = dienste_und_mounts()
    tote = vermerkte_tote(open(REZEPT, encoding="utf-8").read())

    if not mounts:
        fehler(f"kein einziger Bind-Mount in `{REZEPT}` — Muster kaputt?")

    for dienst, quelle in mounts:
        # Die Quellen stehen relativ zu `harness/`.
        imbaum = os.path.normpath(os.path.join("harness", quelle))
        if imbaum in (".", ""):  # `../:/app` — die Wurzel selbst
            continue
        if im_baum(imbaum):
            continue
        # ── `../` IST EIN BAUMPFAD, `./` IST LAUFZEIT ─────────────────────
        # Der Unterschied traegt den ganzen Fund: was aus `harness/` heraus
        # zeigt, meint eine Stelle im Repo und muss dort liegen — egal ob
        # Datei oder Ordner. Genau so faellt `../AdminInterface/www` auf, das
        # ohne diese Zeile als „Verzeichnis, legt Docker an" durchginge; die
        # Huelle steht auf dieser Maschine sogar noch da, git fuehrt sie nicht.
        if quelle.startswith("../"):
            if dienst in tote:
                print(
                    f"  VERMERKT: Dienst `{dienst}` haengt `{quelle}` ein, das es "
                    f"nicht mehr gibt — im Rezept als tot gekennzeichnet."
                )
                continue
            fehler(
                f"Dienst `{dienst}` haengt `{quelle}` ein — git fuehrt darunter "
                f"nichts. Ein Mount aus `harness/` heraus zeigt in den Baum."
            )
            continue
        # `./state/x` -> `state/x`, so wie `mupictl` es schreibt.
        relativ = os.path.normpath(os.path.join(".", quelle))
        if relativ in angelegt or os.path.basename(quelle) in {os.path.basename(a) for a in angelegt}:
            continue
        if not os.path.splitext(quelle)[1]:
            # Ohne Endung: ein Verzeichnis. Docker legt es an, das kostet nichts.
            continue
        fehler(
            f"Dienst `{dienst}` haengt `{quelle}` ein — das liegt nicht im Baum "
            f"und `seed_state()` legt es nicht an. Docker macht daraus ein "
            f"VERZEICHNIS am Ort einer Datei."
        )

    # ── Gegenrichtung: kennt das README die Dienste, und umgekehrt? ────────
    print(f"── Dienste des Rezepts gegen `{README}` ──")
    if not os.path.exists(README):
        fehler(f"`{README}` gibt es nicht — verschoben?")
    else:
        text = open(README, encoding="utf-8").read()
        for name in dienste:
            # Auf den NAMEN greppen, nicht auf eine Tabellenzeile: das README
            # darf einen toten Dienst auch in Prosa fuehren (`admin`).
            if not re.search(rf"`{re.escape(name)}`|\b{re.escape(name)}\b", text):
                fehler(f"`{REZEPT}` fuehrt den Dienst `{name}` — `{README}` nennt ihn nicht")

if not luecken:
    print("\nKEINE LUECKE.")
sys.exit(1 if luecken else 0)
