#!/usr/bin/env python3
"""SEKTIONEN-DECKUNG — das Vokabular gegen die Doku UND gegen die Wirklichkeit.

WARUM ES DAS GIBT (23.08.2026): `tools/doku-luecken-probe.sh` haelt seit Tagen
`RECHTE` und `EREIGNISSE` aus `plugin-vertrag.ts` gegen die Handbuecher und
meldet gruen. Dieselbe Datei fuehrt aber DREI weitere geschlossene Listen —
`SEKTIONEN`, `FELDARTEN`, `KONFIG_GRUPPEN` — und keine davon stand in einer
Wache. Gemessen war `streaming/jellyfin` in `plugins/README.md` mit NULL
Treffern; der Abschnitt daneben nennt `SEKTIONEN` „ein geschlossenes
Vokabular" und zaehlt es nicht auf. Wer ein Plugin baut, muss den TypeScript
aufmachen, um die erlaubten Werte zu erfahren.

DIE ZWEITE, GROESSERE FRAGE — und der eigentliche Grund fuer eine eigene
Datei: eine Namenspruefung haette „ton" und „medien" durchgewinkt, sobald
jemand sie in die README schreibt. Sie sind aber gar keine Orte. Die einzige
Stelle, die Plugins nach `sektion` einhaengt, ist `<mixpi-plugin-abschnitt>`
in `seiten/streaming.ts`; die Ton-Seite sucht ihre Klang-Plugins ueber das
RECHT `klang`, nicht ueber die Sektion. Ein Plugin mit `"sektion": "ton"`
besteht die Manifestpruefung und erscheint nirgends.

Diese Wache prueft darum BEIDE Richtungen:
  * jeder Wert aus SEKTIONEN wird in plugins/README.md in Backticks genannt,
  * jeder Wert aus SEKTIONEN hat eine Stelle, die ihn einhaengt,
  * jede Stelle, die etwas einhaengt, hat einen Wert in SEKTIONEN.

Die dritte Richtung fand `streaming/deezer`: `streaming.ts` baut den Anker aus
`'streaming/' + anbieter.id`, und `deezer` ist einer der vier Anbieter — in
SEKTIONEN steht er nicht. Ein Deezer-Plugin wird vom Wirt abgelehnt, obwohl
die Karte dafuer dasteht.

DIE VIERTE RICHTUNG, UND WARUM DIE WACHE HEUTE GRUEN MELDET (25.08.2026):
alle drei Befunde von damals wurden im SELBEN Commit in plugins/README.md
aufgeschrieben — samt Grund, warum sie so BLEIBEN sollen. Die Wache konnte
also nie gruen werden und meldete zwei Tage lang „1 LUECKE(N)", in der der
vierte, echte Befund untergegangen waere. Sie liest die Ausnahmen jetzt AUS
DER README (`**nirgends**` in der Tabelle, „Umgekehrt fehlt `…`" im Text) —
und prueft die Ausnahme in der Gegenrichtung mit: wer `ton` einhaengt oder
`deezer` ins Vokabular nimmt, ohne die README nachzuziehen, bekommt
`DOKU VERALTET`. Eine Ausnahmeliste, die nur entschaerft, verrottet.

GEGENGEPROBT am 25.08.2026 mit vier Sabotagen, jede einzeln rot:
README-Zeile weg, „Umgekehrt fehlt" weg, Anker fuer `ton` eingebaut,
`streaming/deezer` ins Vokabular aufgenommen.

WOHER DIE LISTE DER ORTE KOMMT, und warum das keine zweite Handpflege ist:
die Anker werden aus dem Angular-Vorlagentext gelesen. Ein fester Anker
(`[sektion]="'ton'"`) wird woertlich genommen; das eine dynamische Muster
(`'streaming/' + …anbieter.id`) wird ueber die `id:`-Zeilen aus
`backend-api/src/streaming.ts` aufgeloest. Findet die Wache GAR KEINEN Anker,
meldet sie eine Warnung statt gruen — eine Wache, die eine umbenannte Vorlage
ueberlebt, ist keine (llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/sektionen-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
VERTRAG = WURZEL / "src/backend-api/src/plugin-vertrag.ts"
README = WURZEL / "plugins/README.md"
STREAMING_SEITE = WURZEL / "src/frontend-admin/src/app/seiten/streaming.ts"
STREAMING_DIENST = WURZEL / "src/backend-api/src/streaming.ts"
ADMIN_SEITEN = WURZEL / "src/frontend-admin/src/app/seiten"

luecken: list[str] = []


def liste_lesen(name: str) -> list[str]:
    """Die Werte einer `export const NAME = [...] as const`-Zeile.

    UEBER MEHRERE ZEILEN, weil SEKTIONEN so dasteht und RECHTE nicht — die
    Schreibweise im Vertrag ist nicht einheitlich, und eine Wache, die nur die
    einzeilige Form kennt, meldet fuer die mehrzeilige stumm nichts.
    """
    text = VERTRAG.read_text(encoding="utf-8")
    treffer = re.search(rf"^export const {name} = \[(.*?)\] as const", text, re.S | re.M)
    if not treffer:
        return []
    return re.findall(r"'([^']+)'", treffer.group(1))


# ── Die drei ungewachten Listen gegen die README ────────────────────────────
# NUR gegen plugins/README.md, nicht gegen die anderen Handbuecher: das sind
# Namen fuer Plugin-Bauer. `dokumentation/benutzerhandbuch.html` dafuer zu
# ruegen ist dieselbe Falle wie `RECHTE` im Benutzerhandbuch — die Wache
# meldete ewig rot und wuerde zu Recht ignoriert.
#
# IN BACKTICKS gesucht, aus demselben Grund wie bei den Rechten: `ton` und
# `medien` sind deutsche Alltagswoerter und stehen in jeder Doku zufaellig da.
print("── Vokabular aus plugin-vertrag.ts, das plugins/README.md nicht nennt ──")
readme_text = README.read_text(encoding="utf-8") if README.exists() else ""
if not readme_text:
    print(f"  WARNUNG: {README} nicht gefunden oder leer.")
    luecken.append("readme")

sektionen = liste_lesen("SEKTIONEN")
for name in ("SEKTIONEN", "FELDARTEN", "KONFIG_GRUPPEN"):
    werte = liste_lesen(name)
    if not werte:
        print(f"  WARNUNG: {name} nicht gefunden — hat sich die Zeile geaendert?")
        luecken.append(name)
        continue
    for w in werte:
        if f"`{w}`" not in readme_text:
            print(f"  FEHLT in plugins/README.md: {w} (aus {name})")
            luecken.append(f"{name}/{w}")

# ── WAS DIE README ALS ABSICHT AUSWEIST ─────────────────────────────────────
# WARUM DAS DAZUKAM (25.08.2026, Doku-Lauf): diese Wache war seit ihrem ersten
# Tag rot. Die drei Befunde von damals — `ton`, `medien`, `streaming/deezer` —
# wurden im SELBEN Commit (76ac10e8) in plugins/README.md aufgeschrieben, samt
# dem Grund, warum sie so bleiben: `deezer` aufzunehmen naehme
# `plugin-vertrag.spec.ts` sein Gegenbeispiel weg, und fuer Klang-Plugins ist
# `rechte: ["klang"]` der richtige Weg. Die Wache konnte also nie gruen werden.
#
# EINE DAUERROTE WACHE IST KEINE. `doku-luecken-probe.sh` meldete seither in
# jedem Lauf „1 LUECKE(N)" und ging mit 1 heraus; ein VIERTER, echter Befund
# haette in derselben Zeile gestanden und waere nicht aufgefallen.
#
# DIE AUSNAHMEN STEHEN DARUM NICHT HIER, sondern in der README — dieselbe
# Regel wie bei der Ausnahmeliste von `box-adresse-deckung.py`: die Doku ist
# die Quelle, die Wache liest sie. Wer eine Abweichung hinnehmen will, muss
# sie erklaeren, wo ein Plugin-Bauer sie findet; loescht jemand die Erklaerung,
# wird die Wache wieder rot. Beide Marken sind die, die schon dastanden:
#   * Tabellenzeile `| `ton` | **nirgends** …`
#   * Fliesstext    „Umgekehrt fehlt `streaming/deezer`"
tot_dokumentiert = set(re.findall(r"^\s*\|\s*`([^`]+)`\s*\|\s*\*\*nirgends\*\*", readme_text, re.M))
ort_dokumentiert = set(re.findall(r"Umgekehrt fehlt `([^`]+)`", readme_text))

# ── Welche Sektionen die Verwaltung wirklich einhaengt ──────────────────────
print("── Sektionen ohne Ort und Orte ohne Sektion ──")
orte: set[str] = set()
dynamisch = False
for datei in sorted(ADMIN_SEITEN.glob("*.ts")):
    text = datei.read_text(encoding="utf-8")
    for m in re.finditer(r"\[sektion\]=\"'([^']+)'\"", text):
        orte.add(m.group(1))
    # Das eine dynamische Muster: 'streaming/' + <irgendwas>.id
    if re.search(r"\[sektion\]=\"'streaming/' \+ [^\"]*\.id\"", text):
        dynamisch = True

if dynamisch:
    dienst = STREAMING_DIENST.read_text(encoding="utf-8")
    anbieter = sorted(set(re.findall(r"^\s+id: '([^']+)'", dienst, re.M)))
    if not anbieter:
        print(f"  WARNUNG: keine Anbieter-Id in {STREAMING_DIENST} gefunden.")
        luecken.append("anbieter")
    for a in anbieter:
        orte.add(f"streaming/{a}")

if not orte:
    # DIE WICHTIGSTE ZEILE DER DATEI. Ohne sie meldet die Wache gruen, sobald
    # jemand die Komponente umbenennt — beide Richtungen waeren dann leer.
    print(f"  WARNUNG: kein einziger [sektion]-Anker in {ADMIN_SEITEN} — umbenannt?")
    luecken.append("anker")
else:
    for s in sektionen:
        if s not in orte:
            if s in tot_dokumentiert:
                print(f"  bekannt: `{s}` haengt ins Leere — die README weist es als Absicht aus (**nirgends**)")
                continue
            print(f"  TOTES VOKABULAR: `{s}` steht in SEKTIONEN, aber keine Seite hängt dort ein")
            luecken.append(f"tot/{s}")
    for o in sorted(orte):
        if o not in sektionen:
            if o in ort_dokumentiert:
                print(f"  bekannt: `{o}` hat keinen Wert — die README weist es als Absicht aus (Umgekehrt fehlt)")
                continue
            print(f"  ORT OHNE VOKABULAR: eine Seite hängt `{o}` ein, SEKTIONEN kennt es nicht")
            luecken.append(f"ort/{o}")

    # ── DIE GEGENRICHTUNG DER AUSNAHME ──────────────────────────────────────
    # Eine Ausnahmeliste, die nur entschaerft, verrottet: sie steht noch da,
    # wenn der Grund weg ist. Wer `ton` einhaengt, ohne die Tabelle
    # nachzuziehen, laesst die README „**nirgends**" behaupten, waehrend die
    # Steckleiste dasteht — dieselbe Bauart wie das datierte Nachgesehen des
    # Herkunftsriegels (llmwiki: `wiki-zustand-hat-haltbarkeit`).
    for s in sorted(tot_dokumentiert):
        if s in orte:
            print(f"  DOKU VERALTET: die README nennt `{s}` noch **nirgends** — es haengt inzwischen ein")
            luecken.append(f"doku-tot/{s}")
    for o in sorted(ort_dokumentiert):
        if o in sektionen:
            print(f"  DOKU VERALTET: die README sagt `{o}` fehle im Vokabular — es steht inzwischen drin")
            luecken.append(f"doku-ort/{o}")

print()
if not luecken:
    print("KEINE LUECKE.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
