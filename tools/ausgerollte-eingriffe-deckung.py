#!/usr/bin/env python3
"""AUSGEROLLTE-EINGRIFFE-DECKUNG — jede FREMDE Datei, die ein Ausrollweg auf der
Box an Ort und Stelle veraendert, gegen die Prosa.

WARUM ES DAS GIBT (27.08.2026): `tools/ausgerollte-vorlagen-deckung.py` (eine
Stunde vorher gebaut) prueft, was ein Ausrollweg auf die Box **legt** — eine
Vorlage aus `config/templates/`. Ein Ausrollweg legt aber nicht nur ab, er
**greift ein**: `sed -i` in eine Datei, die dem Betriebssystem gehoert,
`tee -a` an die Firmware-Konfiguration, ein `>>` an eine Modulliste. Das ist
dieselbe Frage eine Datei-SORTE weiter — und die Sorte ist die unsichtbarere
von beiden:

**Eine Vorlage hat einen eigenen Namen, ein Eingriff hat nur ein Ziel.**
Wer die Vorlage dokumentieren will, hat einen Begriff zum Greppen
(`81-bluez-nur-a2dp.conf`) und eine Zeile fuer die Tabelle
(`Vorlage | Ziel | was sie festlegt`). Ein Eingriff bringt keinen Namen mit;
in einer Tabelle ueber Vorlagen kann er gar nicht vorkommen. Er faellt nicht
durch das Raster — er passt nicht hinein.

DER FUND, DER SIE AUSGELOEST HAT: `autosetup/autosetup.sh:700` haengt
`--noplugin=sap` an das `ExecStart=` in
`/lib/systemd/system/bluetooth.service`. Gemessen am 27.08.2026: null Treffer
fuer diesen Pfad in `dokumentation/`, `plugins/README.md`, `README.md`,
`BACKLOG.md` und `llmwiki/pack.yaml`. Direkt daneben, im selben
Bluetooth-Abschnitt von `mixpibox.md`, steht die Tabelle **"Was die
Ausrollwege in den Tonstapel legen"** mit drei Vorlagen — die vierte
Einstellung desselben Stapels steht dort nicht, weil sie keine Vorlage ist
(die elfte/vierzehnte/achtzehnte Frage: eine Aufzaehlung leiht dem fehlenden
Eintrag die Glaubwuerdigkeit seiner Nachbarn, hier auf einen Eintrag
angewandt, der in ihre Form nicht passt).

WER EINE WACHE VON IHRER SCHWESTER ABSCHREIBT, ERBT IHRE BLINDHEIT
(27.08.2026, spaeterer Lauf). Diese Wache hatte ihre Wegeliste aus der
Schwesterwache kopiert, als die noch ZWEI Wege kannte. Eine Stunde spaeter
lernte die Schwester, dass es VIER sind — der heutige Weg einer frisch
aufgesetzten Box ist das Installer-Rezept — und diese hier blieb bei zwei und
meldete weiter gruen. Sie war nicht gruen, weil nichts fehlte, sondern weil
sie die Haelfte nicht ansah. Deshalb steht die Liste jetzt **nicht mehr hier**,
sondern wird aus `ausgerollte-vorlagen-deckung.py` **importiert**: eine
Korrektur an ihr heilt beide Wachen, ein Kopieren heilt nur die, die man
gerade offen hat.

WAS ALS BELEG ZAEHLT: der **volle Zielpfad** in einer der Prosa-Ablagen.
Bewusst nicht der Dateiname allein — bei einer Vorlage ist der Name der
Handgriff, bei einem Eingriff ist es der Ort. Die Basisnamen dieser Sorte
sind ausserdem reihenweise generisch (`config.toml`, `daemon.conf`,
`client.conf`, `config.txt`, `login`); wer sie als Beleg zaehlt, meldet gruen
fuer jede Datei, die irgendwo im Baum zufaellig so heisst. Und ein Treffer im
AUSROLLSKRIPT selbst zaehlt nicht — sonst belegt die Wache ihren Gegenstand
mit sich selbst (dieselbe Falle wie bei `umgebungsvariablen-deckung.py`).

WAS KEIN EINGRIFF IN EINE FREMDE DATEI IST: eine Datei, die derselbe
Ausrollschritt kurz vorher SELBST angelegt hat. Die Rezepte schreiben ihre
systemd-Drop-ins per Heredoc und ziehen ihnen danach mit
`sed -i 's/^      //'` die YAML-Einrueckung ab. Das ist das Ablegen einer
eigenen Datei in zwei Schritten, kein Eingriff in fremdes Eigentum — und der
Unterschied laesst sich messen (steht ein `cat >`/`tee` auf dasselbe Ziel
weiter oben im selben Schritt?), statt ihn ueber den Pfad zu raten.

AUSNAHME IM REZEPT, NICHT IN DER WACHE: wer einen Eingriff bewusst
undokumentiert laesst, schreibt `# UNDOKUMENTIERT MIT GRUND: <grund>` in die
Zeile darueber. Die Wache liest das und meldet den Eingriff als VERMERKT
([[dauerrote-wache-ist-keine]]).
"""

import importlib.util
import re
import shlex
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent


def _schwester():
    """Die Wegeliste kommt aus der Schwesterwache, nicht aus einer Kopie.
    Der Dateiname hat Bindestriche, deshalb ueber den Lader."""
    quelle = Path(__file__).with_name("ausgerollte-vorlagen-deckung.py")
    spec = importlib.util.spec_from_file_location("ausgerollte_vorlagen", quelle)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


_SCHWESTER = _schwester()

# Alle Wege, die eine Box beschreiben — heute und historisch.
WEGE = list(_SCHWESTER.WEGE)
# Die Teilmenge, die eine HEUTE frisch aufgesetzte Box geht. Ein Eingriff, den
# nur die anderen tragen, ist auf ihr erst nach dem ersten Update da.
WEGE_HEUTE = list(_SCHWESTER.WEGE_HEUTE)

PROSA = list(_SCHWESTER.PROSA)

# Ein Eingriff schreibt in eine Datei, die schon da ist. Vier Schreibweisen
# kommen in den Wegen vor; jede nennt ihr Ziel an anderer Stelle.
EINGRIFFE = [
    # ... | tee -a <ziel>
    re.compile(r"\btee\s+-a\s+\"?(?P<ziel>(?:/|\$\{?[A-Za-z_]+)[^\"\s]*)"),
    # echo ... >> <ziel>
    re.compile(r">>\s*\"?(?P<ziel>(?:/|\$\{?[A-Za-z_]+)[^\"\s]*)"),
]

# Dasselbe Ziel, aber ANLEGEND statt eingreifend. Wer so schreibt, legt eine
# eigene Datei ab; ein `sed -i` darauf im selben Schritt ist Nacharbeit.
ANLEGEND = [
    re.compile(r"\b(?:cat|tee|printf|echo|install|cp|mv)\b[^>]*>\s*\"?"
               r"(?P<ziel>(?:/|\$\{?[A-Za-z_]+)[^\"\s]*)"),
    re.compile(r"\btee\s+(?!-a\b)(?:-\S+\s+)*\"?"
               r"(?P<ziel>(?:/|\$\{?[A-Za-z_]+)[^\"\s]*)"),
    # `: > datei` — die uebliche Schreibweise fuers Leeren/Anlegen. Sie hat
    # kein Befehlswort, das die Muster darueber fangen wuerden, und wer sie
    # nicht kennt, liest die folgenden `>>` als Eingriff in eine fremde Datei
    # (mupibox-app.yaml:1536 legt so die eigene Stueckliste an).
    re.compile(r"^\s*(?::|true)\s*>(?!>)\s*\"?"
               r"(?P<ziel>(?:/|\$\{?[A-Za-z_]+)[^\"\s]*)"),
]

VERMERK = re.compile(r"#\s*UNDOKUMENTIERT MIT GRUND:")

# Zuweisung einer Pfadvariablen: BOOT_CONFIG="/boot/config.txt". Es kann
# MEHRERE geben (autosetup.sh setzt BOOT_CONFIG je nach Betriebssystem-
# Generation zweimal) — dann sind alle Werte gueltige Ziele, und ein Beleg
# fuer EINEN reicht. Der Wert darf selbst wieder eine Variable enthalten
# (`CFG=$BOOT_DIR/config.txt` im Rezept), deshalb wird transitiv aufgeloest.
ZUWEISUNG = re.compile(
    r'^\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)="?'
    r'(?P<wert>(?:/|\$\{?[A-Za-z_])[^"\s]*)"?\s*$'
)

VARIABLE = re.compile(r"\$\{?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\}?")

# Was der Controller in JEDEN Rezeptschritt exportiert (controller/sysinfo.py,
# `env_exports`). Diese Namen stehen im Rezept nie auf der linken Seite eines
# `=`; wer nur nach Zuweisungen sucht, meldet sie als "Variable, die der Weg
# selbst nicht setzt". Die Werte kommen von der Box — `/boot` ist der
# Rueckfallwert in sysinfo.py:32, `/boot/firmware` der Ort auf allem, was
# nach Bookworm aufgesetzt wurde. Ein Beleg fuer EINEN der beiden reicht.
CONTROLLER = {
    "BOOT_DIR": ["/boot", "/boot/firmware"],
    "DIETPI_DIR": ["/boot/dietpi"],
}

# Ziele, die kein Eingriff in eine fremde Datei sind: der eigene Baum auf der
# Box, Wegwerfdateien, Protokolle.
EIGEN = ("/tmp/", "/dev/", "/proc/", "/sys/", "/var/log/", "/home/dietpi/MuPiBox")

# Ein Rezept ist YAML: die Shell steht in `run: |`-Bloecken je Schritt. Fuer
# die Frage "hat derselbe Schritt die Datei selbst angelegt?" braucht es die
# Schrittgrenze.
SCHRITT = re.compile(r"^\s*-\s+(?:id|name|title):\s")

# Wie nah ein "hier lege ich die Datei selbst an" an einem `sed -i` stehen
# muss, damit der Eingriff als Nacharbeit an eigenem Eigentum gilt. Im Rezept
# begrenzt die Schrittgrenze; im Monolithen gibt es keine, deshalb die Naehe.
# Gemessen: die Paare stehen dort ein bis drei Zeilen auseinander
# (autosetup.sh:485/486 — `curl -o`, dann `sed -i`).
FENSTER = 10

# `curl -o <ziel>` legt NICHT im Sinn dieser Wache an: der Inhalt kommt von
# fremder Seite (DietPi-Dashboard), das Skript patcht ihn nur. Wer das als
# "eigene Datei" zaehlt, macht aus einem dokumentierten Eingriff ein stilles
# Gruen — die Datei verschwindet dann ganz aus der Liste statt falsch dazu-
# stehen, und das ist der teurere Fehler.


def prosa_text():
    """Nur, was git kennt — nicht `os.path.exists`. Auf einer Arbeitsmaschine
    liegt Ruecklass herum, und eine Wache, die ihn mitliest, meldet gruen fuer
    Dateien, die kein anderer hat."""
    aus = subprocess.run(
        ["git", "ls-files", "-z", *PROSA],
        cwd=WURZEL, capture_output=True, text=True, check=True,
    ).stdout
    text = []
    for name in filter(None, aus.split("\0")):
        pfad = WURZEL / name
        try:
            text.append((name, pfad.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return text


def variablen(zeilen):
    tabelle = dict(CONTROLLER)
    for zeile in zeilen:
        treffer = ZUWEISUNG.match(zeile)
        if treffer:
            tabelle.setdefault(treffer["name"], []).append(treffer["wert"])
    return tabelle


def aufloesen(ziel, tabelle, tiefe=0):
    """Gibt alle moeglichen Pfade zurueck. Leere Liste = die Variable ist im
    Weg selbst nicht gesetzt; das ist selbst ein Befund und wird gemeldet.
    Ein Wert darf wieder eine Variable enthalten — daher rekursiv, mit
    Riegel gegen einen Ring (`F=$F/x`)."""
    treffer = VARIABLE.search(ziel)
    if not treffer:
        return [ziel]
    if tiefe > 4:
        return []
    werte = tabelle.get(treffer["name"])
    if not werte:
        return []
    aus = []
    for wert in werte:
        ersetzt = VARIABLE.sub(lambda _: wert, ziel, count=1)
        aus.extend(aufloesen(ersetzt, tabelle, tiefe + 1))
    return sorted(set(aus))


def _ziele(zeile, muster):
    """Alle Ziele einer Zeile. `sed -i … a b c` fasst mehrere Dateien an;
    nur das letzte zu nehmen liesse die davor unbemerkt."""
    gefunden = []
    for m in muster:
        treffer = m.search(zeile)
        if treffer:
            gefunden.append(treffer["ziel"].rstrip('"'))
    return gefunden


ENDE = {"|", "||", "&&", ";", "&", ")", "}"}


def _sed_ziele(zeile):
    """`sed -i 's/…/…/' /a/b /c/d` — ALLE Dateien hinter dem Ausdruck.
    `sed -i` fasst mehrere an; nur die letzte zu nehmen liesse die davor
    unbemerkt (`mupibox-app.yaml:657` aendert Dienst UND Timer).

    Positionell geparst, nicht per Muster ueber die Zeile: der Ausdruck sieht
    selbst wie ein Pfad aus (`sed -i -E '/vc4-fkms-v3d/d' "$CFG"` beginnt mit
    einem Schraegstrich). Ein Muster, das die Zeile absucht, holt Stuecke des
    AUSDRUCKS heraus — `/bluetoothd/ExecStart`, `/motd.dynamic/g`, `/ALGO` —
    und meldet sie als undokumentierte Ziele. Genau so ist diese Wache beim
    Bau einmal auf 18 Funde gesprungen, von denen zwei echt waren."""
    try:
        toks = shlex.split(zeile, posix=True)
    except ValueError:
        return []
    # Der Befehl steht auch mit vollem Pfad da (`/usr/bin/sed -i` in
    # start_mupibox_update.sh:625). Wer auf das Wort `sed` prueft, verliert
    # genau die Zeile, die einen Eingriff des Update-Wegs belegt — und meldet
    # dann "nur Monolith" fuer eine Datei, die beide Wege anfassen.
    stelle = next((n for n, t in enumerate(toks)
                   if t == "sed" or t.endswith("/sed")), None)
    if stelle is None:
        return []
    i = stelle + 1
    ausdruck_gesehen = False
    ziele = []
    while i < len(toks):
        t = toks[i]
        if t in ENDE:
            break
        if t.startswith("-") and len(t) > 1:
            # `-e`/`-f` ziehen den Ausdruck als eigenes Wort nach sich.
            if t in ("-e", "-f", "--expression", "--file"):
                ausdruck_gesehen = True
                i += 2
                continue
            i += 1
            continue
        if not ausdruck_gesehen:
            ausdruck_gesehen = True
            i += 1
            continue
        if t.startswith("/") or t.startswith("$"):
            ziele.append(t)
        i += 1
    return ziele


def eingriffe_sammeln():
    """(Eingriffe, Anlagen). Die zweite Liste ist fuer die Frage, was eine
    frisch aufgesetzte Box HAT: ein Weg, der die Datei ganz neu schreibt,
    liefert denselben Zustand wie einer, der sie aendert. Wer nur die
    Eingriffe zaehlt, meldet /etc/X11/Xwrapper.config als "nicht auf einer
    frischen Box" — dabei schreibt das Rezept sie in mupibox.yaml:780
    vollstaendig hin. Das ist dieselbe Mengenfrage wie bei der
    Schwesterwache, nur eine Ebene weiter innen."""
    gefunden = []
    anlagen = {}
    for weg in WEGE:
        pfad = WURZEL / weg
        if not pfad.exists():
            print(f"  ! Ausrollweg fehlt: {weg}", file=sys.stderr)
            continue
        zeilen = pfad.read_text(encoding="utf-8", errors="replace").splitlines()
        tabelle = variablen(zeilen)
        # Was ein Schritt selbst anlegt, gilt ab seiner Zeile bis zum
        # naechsten Schritt als eigene Datei. Ein Monolith HAT keine
        # Schrittgrenze — dort verfaellt der Vermerk nach NAEHE (siehe
        # FENSTER), sonst deckt ein `>` am Dateianfang jeden Eingriff bis zum
        # Dateiende zu. Genau so verlor diese Wache beim Bau den Eingriff in
        # /opt/dietpi-dashboard/config.toml.
        # Ein Rezept hat Schrittgrenzen, ein Monolith nicht.
        schrittweise = any(SCHRITT.match(z) for z in zeilen)
        selbst = {}
        for nr, roh in enumerate(zeilen, start=1):
            if SCHRITT.match(roh):
                selbst = {}
            if not schrittweise:
                selbst = {p: n for p, n in selbst.items() if nr - n <= FENSTER}
            zeile = roh.strip()
            if zeile.startswith("#"):
                continue
            # Das Protokoll-Umlenken haengt an fast jeder Zeile und wuerde als
            # Ziel gelesen.
            zeile = re.sub(r"\s*>&3\s*2>&3\s*$", "", zeile)

            for ziel in _ziele(zeile, ANLEGEND):
                for p in aufloesen(ziel, tabelle) or [ziel]:
                    selbst[p] = nr
                    if not p.startswith(EIGEN):
                        anlagen.setdefault(p, set()).add(weg)

            ziele = _ziele(zeile, EINGRIFFE) + _sed_ziele(zeile)
            gesehen = set()
            for ziel in ziele:
                if ziel in gesehen:
                    continue
                gesehen.add(ziel)
                if ziel.startswith(EIGEN) or "MUPI_SRC" in ziel:
                    continue
                pfade = aufloesen(ziel, tabelle)
                if pfade and all(p in selbst for p in pfade):
                    continue
                if any(p.startswith(EIGEN) for p in pfade):
                    continue
                vermerkt = nr > 1 and bool(VERMERK.search(zeilen[nr - 2]))
                gefunden.append({
                    "weg": weg, "nr": nr, "ziel": ziel,
                    "pfade": pfade, "vermerkt": vermerkt,
                })
    return gefunden, anlagen


def main():
    text = prosa_text()
    alle, anlagen = eingriffe_sammeln()
    if not alle:
        print("  ! Kein Eingriff gefunden — das Muster passt nicht mehr.",
              file=sys.stderr)
        return 1

    offen = []
    # Wege je Zielpfad: fuer die Frage, was eine frisch aufgesetzte Box hat.
    wege_je_ziel = {}
    for e in alle:
        for p in e["pfade"] or [e["ziel"]]:
            wege_je_ziel.setdefault(p, set()).add(e["weg"])
    # Anlegen zaehlt fuer den ZUSTAND mit, nicht fuer die Doku-Pflicht: die
    # Luecken-Liste unten bleibt bei den Eingriffen, nur die Frage "hat eine
    # frische Box das?" bezieht die Anlagen ein.
    beruehrt_je_ziel = {p: set(w) for p, w in wege_je_ziel.items()}
    for p, w in anlagen.items():
        if p in beruehrt_je_ziel:
            beruehrt_je_ziel[p] |= w

    # `--wege` beantwortet die Spalte *Weg* der Tabelle in mixpibox.md §5.3.
    # Die stand als handgeschriebene Prosa da ("nur Monolith", "alle") und war
    # aus einer Wache abgeschrieben, die zwei von vier Wegen las — wer sie
    # pflegt, misst sie hier nach, statt sie fortzuschreiben.
    if "--wege" in sys.argv:
        print("── Welcher Ausrollweg fasst welche fremde Datei an ──")
        for p in sorted(wege_je_ziel):
            kurz = sorted(w.split("/")[-1] for w in wege_je_ziel[p])
            print(f"  {p}")
            print(f"      {', '.join(kurz)}")
        return 0

    for e in alle:
        if e["vermerkt"]:
            continue
        if not e["pfade"]:
            offen.append((e, "Ziel ist eine Variable, die der Weg selbst nicht setzt"))
            continue
        belege = [name for name, inhalt in text
                  if any(pfad in inhalt for pfad in e["pfade"])]
        if not belege:
            offen.append((e, "in keiner Prosa-Ablage genannt"))

    # Vereinigung belegt Existenz, nicht Allgemeinheit
    # ([[vereinigung-der-wege-belegt-keine-allgemeinheit]]): ein Eingriff, den
    # nur der alte Monolith und der Update-Weg tragen, fehlt auf einer heute
    # frisch aufgesetzten Box bis zum ersten Update. Bewusst KEIN Fehler —
    # aber kein Satz "auf jeder Box" darf sich auf ihn stuetzen. Und anders als
    # eine Vorlage traegt ein Eingriff sich nicht selbst nach: ein Update
    # ueberschreibt eine Vorlage einfach neu, ein Eingriff muss eigens
    # wiederholt werden.
    nur_alt = sorted(p for p, w in beruehrt_je_ziel.items()
                     if not (w & set(WEGE_HEUTE)))
    if nur_alt:
        print("── Eingriffe, die eine heute frisch aufgesetzte Box NICHT bekommt "
              "(erst nach dem ersten Update) ──")
        for p in nur_alt:
            print(f"  {p}")
        print("      Ueber diese Eingriffe darf keine Prosa \"auf jeder Box\" "
              "schreiben.")
        print()

    if not offen:
        print(f"KEINE LUECKE: jeder ausgerollte Eingriff steht in der Prosa. "
              f"({len(alle)} Eingriffe aus {len(WEGE)} Wegen geprueft)")
        return 0

    print("Eingriffe der Ausrollwege in fremde Dateien ohne Prosa:")
    for e, grund in offen:
        ziele = " | ".join(e["pfade"]) or e["ziel"]
        print(f"  {ziele}")
        print(f"      {e['weg']}:{e['nr']} — {grund}")
    print()
    print(f"{len(offen)} Eingriff(e) ohne Prosa (von {len(alle)} aus "
          f"{len(WEGE)} Wegen).")
    print("Wer einen bewusst undokumentiert laesst, schreibt")
    print("`# UNDOKUMENTIERT MIT GRUND: <grund>` in die Zeile darueber.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
