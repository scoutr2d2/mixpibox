#!/usr/bin/env python3
"""Verliert eine laufende Box durch den Verwaltungsumbau eine Einstellung?

WOZU: Das ist der teuerste Fehler dieses Umbaus (d1d9c7f1, 03.08.2026) und der
einzige, der GAR NICHTS meldet. Der Umbau sortiert Felder auf andere SEITEN um
und legt vier Schluessel nach. Behauptet wird: kein Feld hat den SPEICHERORT
gewechselt, und die nachgelegten Werte sind die, die ohnehin schon galten.

Beides steht bisher nur in Kommentaren und in einer Commit-Nachricht. Ein
Kommentar haelt niemanden auf. Wer beim naechsten Aufraeumen `thema` nach
`darstellung.theme` legt — weil das Feld ja auf der Darstellungsseite steht —,
hat auf JEDER laufenden Box das Farbthema stillgelegt: die Box liest weiter
`mupibox.theme`, das Board schreibt woandershin, keine Meldung, kein Fehler,
nur eine Box, die ploetzlich wieder blau ist.

Dieses Werkzeug prueft das nicht am Quelltext, sondern indem es
update/conf_update.sh WIRKLICH LAUFEN LAESST — gegen eine nachgebaute alte Box,
auf der jede Einstellung von Hand verstellt wurde.

WAS ES PRUEFT
  1. Der Umzug fasst keinen bestehenden Wert an (jede Einstellung der alten
     Box steht danach unveraendert da, Zeichen fuer Zeichen).
  2. Die vier nachgelegten Schluessel sind danach da — und tragen den Wert,
     der vorher ohnehin galt.
  3. DIE VORGABE STEHT AN DREI STELLEN GLEICH: `standard` in FELDER,
     config/templates/mupiboxconfig.json (neue Installation) und
     conf_update.sh (laufende Box). Laufen sie auseinander, verhaelt sich eine
     frische Box anders als eine gewachsene — und niemand sieht das je
     nebeneinander.
  4. Der TYP stimmt. `jq --arg` schreibt IMMER eine Zeichenkette; ein
     Schalter braucht aber `true`/`false`. Genau so steht seit 1.0.8
     `maxVolume: "100"` als Text in jeder gewachsenen Konfiguration.
  5. Der Umzug ist wiederholbar (zweimal laufen lassen aendert nichts mehr) —
     conf_update.sh laeuft bei JEDEM Update.
  6. Eine Box, die schon gewaehlt hat, behaelt ihre Wahl (oberflaeche='neu'
     darf nicht auf 'klassisch' zurueckfallen).

WAS ES NICHT PRUEFT: ob die Verwaltung die Felder auch ANZEIGT. Dafuer gibt es
tools/verwaltung-suche-vollstaendig.test.mjs und die Tests in
src/backend-api/src/konfiguration.spec.ts.

AUFRUF
    tools/konfig-umzug-probe.py            # Bericht
    tools/konfig-umzug-probe.py --pruefen  # still, Exitcode 1 bei Befund
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
VORLAGE = os.path.join(WURZEL, "config/templates/mupiboxconfig.json")
UMZUG = os.path.join(WURZEL, "update/conf_update.sh")
BACKEND = os.path.join(WURZEL, "src/backend-api")

befunde = []
still = "--pruefen" in sys.argv


def sagen(text=""):
    if not still:
        print(text)


def befund(text):
    befunde.append(text)


def felder_lesen():
    """FELDER aus konfiguration.ts holen — nicht nachbauen, sondern ausfuehren.

    Ein nachgebauter Auszug per Regex laeuft auseinander, sobald jemand die
    Tabelle umformatiert. `tsx` liest dieselbe Datei, die der Server liest.
    """
    roh = subprocess.run(
        [
            "npx",
            "tsx",
            "-e",
            "import {FELDER} from './src/konfiguration.ts';"
            "console.log('---JSON---'+JSON.stringify(FELDER))",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )
    if roh.returncode != 0:
        print("konfiguration.ts liess sich nicht laden:", roh.stderr[-800:], file=sys.stderr)
        sys.exit(2)
    return json.loads(roh.stdout.split("---JSON---", 1)[1])


def wert_an(konfig, pfad):
    """Wert an einem Feldpfad — oder das Kennzeichen FEHLT."""
    stelle = konfig
    for teil in pfad:
        if not isinstance(stelle, dict) or teil not in stelle:
            return FEHLT
        stelle = stelle[teil]
    return stelle


class Fehlt:
    def __repr__(self):
        return "<fehlt>"


FEHLT = Fehlt()


def setze(konfig, pfad, wert):
    stelle = konfig
    for teil in pfad[:-1]:
        stelle = stelle.setdefault(teil, {})
    stelle[pfad[-1]] = wert


def loesche(konfig, pfad):
    stelle = konfig
    for teil in pfad[:-1]:
        if not isinstance(stelle, dict) or teil not in stelle:
            return
        stelle = stelle[teil]
    if isinstance(stelle, dict):
        stelle.pop(pfad[-1], None)


def umzug_laufen_lassen(konfig):
    """conf_update.sh WIRKLICH ausfuehren, auf einer Kopie.

    Die Datei verdrahtet CONFIG=/etc/mupibox/... in Zeile 6. Statt das Skript
    nachzuprogrammieren — womit man genau den Fehler nicht faende, den man
    sucht — wird die eine Zeile in einer Kopie umgebogen.
    """
    ordner = tempfile.mkdtemp(prefix="mupi-umzug-")
    try:
        ziel = os.path.join(ordner, "mupiboxconfig.json")
        with open(ziel, "w", encoding="utf-8") as f:
            json.dump(konfig, f, indent=4, ensure_ascii=False)
        quelle = open(UMZUG, encoding="utf-8").read()
        gebogen = re.sub(
            r'^CONFIG=.*$', 'CONFIG="%s"' % ziel, quelle, count=1, flags=re.MULTILINE
        )
        skript = os.path.join(ordner, "conf_update.sh")
        with open(skript, "w", encoding="utf-8") as f:
            f.write(gebogen)
        os.chmod(skript, 0o755)
        lauf = subprocess.run(
            ["bash", skript], capture_output=True, text=True, cwd=ordner
        )
        with open(ziel, encoding="utf-8") as f:
            roh = f.read()
        try:
            return json.loads(roh), lauf
        except json.JSONDecodeError as e:
            befund(
                "conf_update.sh hinterlaesst KEIN gueltiges JSON (%s). "
                "Die Box haette danach keine Konfiguration mehr." % e
            )
            return None, lauf
    finally:
        shutil.rmtree(ordner, ignore_errors=True)


def probewert(feld):
    """Ein AUFFAELLIGER Wert, den die alte Box schon gesetzt hat.

    Auffaellig heisst: er ist niemals der Vorgabewert. Ein Test, der den
    Vorgabewert einsetzt, kann „Wert erhalten" nicht von „Wert neu gesetzt"
    unterscheiden — genau die Verwechslung, um die es hier geht.
    """
    art = feld["art"]
    if art == "schalter":
        # Das Gegenteil der Vorgabe, damit ein Ueberschreiben auffaellt.
        return not bool(feld.get("standard", False))
    if art == "auswahl":
        werte = [a["wert"] for a in feld.get("festeAuswahl", [])]
        anders = [w for w in werte if w != feld.get("standard")]
        if anders:
            return anders[-1]
        return "probe-wert"
    if art == "zahl":
        return 42
    return "probe-%s" % feld["id"]


def main():
    # OHNE jq GEHT HIER GAR NICHTS — conf_update.sh besteht aus jq-Aufrufen.
    # Abmelden statt rot werden, wie die uebrigen Schritte in pruefen.sh: ein
    # Schritt, der aus Umgebungsgruenden immer rot ist, wird uebersehen an dem
    # Tag, an dem er zu Recht rot wird.
    if not os.path.exists("/usr/bin/jq"):
        sagen("/usr/bin/jq fehlt — conf_update.sh nicht ausfuehrbar, uebersprungen.")
        return 0

    felder = felder_lesen()
    vorlage = json.load(open(VORLAGE, encoding="utf-8"))
    umzug_text = open(UMZUG, encoding="utf-8").read()

    mit_standard = [f for f in felder if "standard" in f]

    # ── 1+6. Eine gewachsene Box, auf der ALLES von Hand verstellt wurde ──
    #
    # Ausgangspunkt ist die Vorlage (damit alles Uebrige der Datei stimmt),
    # aber jedes Feld bekommt einen auffaelligen eigenen Wert.
    alt = json.loads(json.dumps(vorlage))
    erwartet = {}
    for f in felder:
        w = probewert(f)
        setze(alt, f["pfad"], w)
        erwartet[f["id"]] = w

    nachher, lauf = umzug_laufen_lassen(alt)
    sagen("conf_update.sh gegen eine Box, auf der jede Einstellung verstellt ist")
    sagen("──────────────────────────────────────────────────────────────────")
    if nachher is None:
        pass
    else:
        verloren = []
        for f in felder:
            ist = wert_an(nachher, f["pfad"])
            soll = erwartet[f["id"]]
            if ist != soll:
                verloren.append((f["id"], ".".join(f["pfad"]), soll, ist))
        if verloren:
            for kennung, pfad, soll, ist in verloren:
                befund(
                    "conf_update.sh VERAENDERT eine gesetzte Einstellung: %s (%s) "
                    "war %r, ist danach %r" % (kennung, pfad, soll, ist)
                )
        sagen("  %d Felder gesetzt, %d veraendert" % (len(felder), len(verloren)))

        # 5. Wiederholbar? conf_update.sh laeuft bei JEDEM Update.
        nochmal, _ = umzug_laufen_lassen(nachher)
        if nochmal is not None and nochmal != nachher:
            befund(
                "conf_update.sh ist nicht wiederholbar: ein zweiter Lauf aendert "
                "die Datei erneut. Es laeuft bei jedem Update."
            )
        sagen("  zweiter Lauf: %s" % ("unveraendert" if nochmal == nachher else "AENDERT"))

    # ── 2. Die alte Box, der die vier Schluessel fehlen ───────────────────
    lueckig = json.loads(json.dumps(vorlage))
    for f in mit_standard:
        loesche(lueckig, f["pfad"])
    gefuellt, _ = umzug_laufen_lassen(lueckig)
    sagen()
    sagen("Eine Box, der jeder Schluessel mit Vorgabe fehlt")
    sagen("──────────────────────────────────────────────────────────────────")
    offen = []
    for f in mit_standard:
        ist = wert_an(gefuellt, f["pfad"]) if gefuellt else FEHLT
        pfad = ".".join(f["pfad"])
        if isinstance(ist, Fehlt):
            offen.append(f["id"])
            sagen("  %-24s %-42s bleibt leer (Vorgabe %r greift)"
                  % (f["id"], pfad, f["standard"]))
        else:
            sagen("  %-24s %-42s -> %r" % (f["id"], pfad, ist))
            # 4. Der TYP muss stimmen — jq --arg schreibt Zeichenketten.
            if type(ist) is not type(f["standard"]):
                befund(
                    "conf_update.sh legt %s (%s) als %s an, die Vorgabe in FELDER "
                    "ist aber %s (%r). jq --arg schreibt IMMER eine Zeichenkette — "
                    "so steht seit 1.0.8 maxVolume als Text in jeder Konfiguration."
                    % (f["id"], pfad, type(ist).__name__,
                       type(f["standard"]).__name__, f["standard"])
                )
            elif ist != f["standard"]:
                befund(
                    "conf_update.sh legt %s (%s) mit %r an, FELDER.standard sagt "
                    "aber %r. Eine gewachsene Box startet damit anders als der "
                    "Code annimmt." % (f["id"], pfad, ist, f["standard"])
                )
    if offen:
        sagen("  ohne Nachlegen (nur Vorgabe im Code): %s" % ", ".join(offen))

    # ── 3. Dieselbe Vorgabe in der Vorlage fuer NEUE Installationen ───────
    #
    # AUSNAHMEN MIT ABSICHT: Felder, bei denen Code-Vorgabe und Vorlage
    # AUSEINANDER SOLLEN. Jede Zeile braucht eine Begruendung — eine Ausnahme
    # ohne Grund ist nur ein zum Schweigen gebrachter Befund. (Dasselbe
    # Muster wie die ABSICHT-Paare des Zwillingsdatei-Abgleichs.)
    absicht = {
        # FELDER.standard beschreibt den RUECKFALL bei fehlendem Schluessel —
        # und der steht woertlich im Skript (chromium-autostart.sh:
        # jq '// "klassisch"'): eine GEWACHSENE Box ohne den Schluessel darf
        # nach einem Update nicht still die Oberflaeche wechseln. Die VORLAGE
        # gibt frischen Karten dagegen bewusst die neue Oberflaeche mit.
        # Beide Werte sind richtig, und sie sind verschieden (13.08.2026).
        "oberflaeche": "Rueckfall 'klassisch' schuetzt Bestandsboxen; frische Karten starten 'neu'",
    }
    sagen()
    sagen("Vorgabe im Code gegen die Vorlage fuer neue Installationen")
    sagen("──────────────────────────────────────────────────────────────────")
    for f in mit_standard:
        pfad = ".".join(f["pfad"])
        inVorlage = wert_an(vorlage, f["pfad"])
        if isinstance(inVorlage, Fehlt):
            befund(
                "%s (%s) hat eine Vorgabe im Code, steht aber NICHT in "
                "config/templates/mupiboxconfig.json. Eine frisch installierte "
                "Box haette den Schluessel dann nie." % (f["id"], pfad)
            )
        elif inVorlage != f["standard"]:
            if f["id"] in absicht:
                sagen(
                    "  %-24s %-42s Code %r, Vorlage %r — AUSEINANDER MIT ABSICHT: %s"
                    % (f["id"], pfad, f["standard"], inVorlage, absicht[f["id"]])
                )
            else:
                befund(
                    "%s (%s): FELDER.standard ist %r, die Vorlage sagt %r. Eine "
                    "neue Box verhaelt sich damit anders als eine gewachsene."
                    % (f["id"], pfad, f["standard"], inVorlage)
                )
        else:
            sagen("  %-24s %-42s %r (Code = Vorlage)" % (f["id"], pfad, inVorlage))

    # ── Und die Gegenrichtung: ein Feld OHNE Vorgabe, das fehlen kann ─────
    sagen()
    sagen("Felder ohne Vorgabe — stehen sie wenigstens in der Vorlage?")
    sagen("──────────────────────────────────────────────────────────────────")
    ohne = 0
    for f in felder:
        if "standard" in f:
            continue
        if isinstance(wert_an(vorlage, f["pfad"]), Fehlt):
            ohne += 1
            befund(
                "%s (%s) hat WEDER eine Vorgabe im Code NOCH einen Eintrag in "
                "der Vorlage. Fehlt der Schluessel auf einer Box, zeigt das "
                "Board dort etwas an, das nirgends gespeichert ist."
                % (f["id"], ".".join(f["pfad"]))
            )
    sagen("  %d von %d ohne Vorgabe fehlen auch in der Vorlage"
          % (ohne, len(felder) - len(mit_standard)))

    # ── 6. Eine Box, die schon gewaehlt hat, behaelt ihre Wahl ────────────
    gewaehlt = json.loads(json.dumps(vorlage))
    setze(gewaehlt, ["mupibox", "oberflaeche"], "neu")
    setze(gewaehlt, ["mupibox", "einstellungssperre"], "pin")
    setze(gewaehlt, ["spotify", "disableScraperForPlaylists"], True)
    setze(gewaehlt, ["jellyfin", "apiKey"], "ein-echter-schluessel")
    danach, _ = umzug_laufen_lassen(gewaehlt)
    sagen()
    sagen("Eine Box, die schon gewaehlt hat")
    sagen("──────────────────────────────────────────────────────────────────")
    for pfad, soll in [
        (["mupibox", "oberflaeche"], "neu"),
        (["mupibox", "einstellungssperre"], "pin"),
        (["spotify", "disableScraperForPlaylists"], True),
        (["jellyfin", "apiKey"], "ein-echter-schluessel"),
    ]:
        ist = wert_an(danach, pfad) if danach else FEHLT
        sagen("  %-46s %r" % (".".join(pfad), ist))
        if ist != soll:
            befund(
                "conf_update.sh setzt %s auf %r zurueck, obwohl die Box %r "
                "gewaehlt hatte." % (".".join(pfad), ist, soll)
            )

    # ── Und die Behauptung selbst: KEIN Feld hat den Ort gewechselt ───────
    #
    # Gegen den Stand VOR dem Umbau. Die Pfade sind das Dateiformat; wer einen
    # aendert, aendert es fuer jede laufende Box.
    sagen()
    sagen("Speicherorte gegen den Stand vor dem Umbau (d1d9c7f1^)")
    sagen("──────────────────────────────────────────────────────────────────")
    vorher = subprocess.run(
        ["git", "show", "d1d9c7f1^:src/backend-api/src/konfiguration.ts"],
        cwd=WURZEL, capture_output=True, text=True,
    )
    if vorher.returncode != 0:
        sagen("  (Vergleichsstand nicht abrufbar — uebersprungen)")
    else:
        # Die Tabelle des alten Standes liegt nur als Text vor. Gesucht wird
        # paarweise: id und der zugehoerige pfad, in der Reihenfolge der Datei.
        alte = dict(
            re.findall(
                r"id:\s*'([^']+)',[\s\S]{0,600}?pfad:\s*\[([^\]]*)\]", vorher.stdout
            )
        )
        umgezogen = 0
        for f in felder:
            if f["id"] not in alte:
                continue
            alt_pfad = [t.strip().strip("'\"") for t in alte[f["id"]].split(",") if t.strip()]
            if alt_pfad != f["pfad"]:
                umgezogen += 1
                befund(
                    "%s hat den SPEICHERORT gewechselt: %s -> %s. Jede Box, die "
                    "den Schalter schon gestellt hat, verliert ihre Einstellung "
                    "STILL." % (f["id"], ".".join(alt_pfad), ".".join(f["pfad"]))
                )
        sagen("  %d von %d Feldern verglichen, %d umgezogen"
              % (len(alte), len(felder), umgezogen))

    sagen()
    if befunde:
        print("BEFUNDE (%d):" % len(befunde))
        for b in befunde:
            print("  * %s" % b)
        return 1
    sagen("Kein Befund: keine Box verliert durch den Umzug eine Einstellung.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
