#!/usr/bin/env python3
"""
WER TON MACHT, BRAUCHT XDG_RUNTIME_DIR — sonst spielt er ins Leere.

══ DER FALL, DER DAS AUSGELOEST HAT (19.09.2026) ═══════════════════════════

Betreiber am Geraet: „wenn ich vorlesen aktiviert habe klappt das vorlesen
dennoch nicht beim klick auf das vorlese icon."

Gemessen war die Ansage KERNGESUND: `GET /api/vorlesen/sprich` lieferte 200
und 32 kB `audio/wav`. Erst das Abspielen scheiterte, und das Journal log
dabei in die falsche Richtung:

    Failed to create secure directory (/home/dietpi/.config/pulse): Permission denied
    pa_context_connect() failed: Connection refused

DIE RECHTE-ZEILE IST DIE FOLGE, NICHT DER GRUND. `ansageAbspielen` startet
`pw-play`, und PipeWire-Klienten finden ihren Socket ueber
`$XDG_RUNTIME_DIR/pipewire-0`. Die Unit `mupibox-server.service` setzte GAR
KEINE Umgebung — `systemctl show -p Environment` gab blank `Environment=`
zurueck. Also suchte pw-play den Server nicht dort, fiel auf Pulse zurueck,
wollte sich sein `~/.config/pulse` anlegen — und `/home/dietpi/.config`
gehoert root seit dem Einrichtungstag. Daher die irrefuehrende Meldung.

WARUM ES NIEMANDEM AUFFIEL: Musik spielte weiter. mpv haengt am
Abspieldienst, und DESSEN Unit traegt die Zeile seit je, ebenso
`librespot.service`. Von den drei Diensten mit Ton war genau EINER der
Ausreisser — und ausgerechnet der, dessen Tonweg am seltensten benutzt wird.

══ WAS DIESE WACHE PRUEFT — AUF DIE SORTE, NICHT AUF EINE NAMENSLISTE ══════

Fuer jede Unit, WO IMMER SIE ENTSTEHT (Herleitung weiter unten bei
„DER DRITTE AUSROLLWEG"):

  * Laeuft sie als ROOT? Dann geht sie diese Wache nichts an. Der
    Systemton-Server laeuft selbst als root (`pulseaudio --system`), und
    `/run/user/0` ist eine andere Frage. Ausdruecklich ausgenommen, damit
    hier keine Dauerbefunde entstehen (`dauerrote-wache-ist-keine`).
  * MACHT SIE TON? Zwei Wege, und beide zaehlen:
      1. Die Unit NENNT selbst ein Ton-Programm (librespot, mpv, pw-play …).
      2. Ihr ExecStart zeigt auf ein Programm, dessen QUELLE im Baum ein
         Ton-Programm startet. Genau das ist der Serverfall: in der Unit
         steht nur `node server.js`, der `pw-play`-Aufruf liegt drei
         Verzeichnisse weiter.
  * Wenn ja: sie MUSS `XDG_RUNTIME_DIR` setzen.

KEINE LISTE VON DIENSTNAMEN. Eine solche waere beim naechsten Dienst
veraltet und haette genau diesen Fehler nicht gefunden — er entstand ja
dadurch, dass einer von dreien vergessen wurde.

DIE ZUORDNUNG AUSGELIEFERTER PFADE ZU QUELLORDNERN ist die einzige
Handarbeit hier, und sie traegt einen ANKER: zeigt ein Eintrag ins Leere,
bricht die Wache ab, statt ihn stillschweigend zu ueberspringen. Eine
Zuordnung, die nicht mehr passt, macht die Wache sonst blind und gruen.

══ DER DRITTE AUSROLLWEG — EINE UNIT KANN AUCH IN EINEM REZEPT ENTSTEHEN ═══

Bis zum 29.09.2026 las diese Wache nur `config/services/*.service`. Am
Abend ihres Entstehens war sie richtig — und hatte trotzdem ein Loch, das
AUDIT-2026-09-20 Rang 1 fand: `remote-step-installer/recipes/mupibox-app.yaml`
schreibt DIESELBE Unit `mupibox-server.service` ein zweites Mal, als Heredoc
im Schritt `dienste-systemd`, und dieses Exemplar hatte die Zeile NICHT.
Jede per Rezept bespielte Box war beim Vorlesen stumm, waehrend die Wache
gruen meldete — ihr Sichtfeld war ein Ordner, und ein Heredoc liegt in
keinem Ordner (Wiki: unit-im-heredoc-entgeht-der-unit-wache).

Deshalb sucht die Wache seither nach der SORTE „hier entsteht eine Unit",
nicht nach einem Pfad:

  * jede Datei im Baum (verfolgt oder neu, nicht ignoriert), die auf
    `.service` endet — egal in welchem Ordner;
  * jeder Heredoc in einem Skript, Rezept oder Python-Modul, der nach
    /etc/systemd/system/<name>.service schreibt (`cat > ziel <<ENDE`,
    `cat <<ENDE > ziel`, `tee ziel <<ENDE`).

Ein UNGESCHUETZTER Heredoc (`<<EOF` statt `<<'EOF'`) setzt Variablen ein.
Die Wache tut dasselbe mit den `env:`-Werten des Rezepts — sonst stuende im
Serverfall nur `ExecStart=/usr/bin/node ${MUPI_APP}/server.js` da, der
Quellort waere unsichtbar, und die Wache wieder still gruen. Bleibt in einem
Dienst ohne root nach dem Einsetzen eine Variable im ExecStart stehen, bricht
sie ab statt zu raten. Ebenso, wenn eine Zeile nach Heredoc-Unit AUSSIEHT,
sich aber nicht lesen laesst (etwa ein Unit-Name aus einer Variablen): eine
Unit, die die Wache nicht lesen kann, darf sie nicht als gesund zaehlen.

    python3 tools/tonweg-umgebung-deckung.py            Bericht
    python3 tools/tonweg-umgebung-deckung.py --pruefen  still; Ende 1 bei Luecke
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Dateien, in denen ein Heredoc eine Unit schreiben kann. Ohne Endung zaehlt
# eine Datei mit, wenn ihre erste Zeile ein Shell-Shebang ist (die Starter
# des Installers heissen `connect`, `sdstart` …).
HEREDOC_ENDUNGEN = (".sh", ".yaml", ".yml", ".py")

# Was ueber Units SPRICHT statt sie zu schreiben: das Wissenspaket und die
# Handbuecher zitieren Heredocs; das Kompilat unter src/deploy/ ist eine
# Kopie, keine Quelle ([[kommentar-und-kompilat-sind-keine-gegenstelle]]).
NICHT_QUELLE = ("llmwiki/", "src/deploy/", "node_modules/")

# `cat > /etc/systemd/system/x.service <<ENDE` und die umgedrehte Form
# `cat <<ENDE > /etc/systemd/system/x.service`. Der Name endet vor einem
# Zeichen, das nicht mehr zum Namen gehoert — sonst hielte die Wache das
# Drop-In `x.service.d/y.conf` fuer die ganze Unit.
_ZIEL = r"/etc/systemd/system/([\w@-][\w@.-]*\.service)(?![\w./-])"
_MARKE = r"<<-?\s*(['\"]?)\\?(\w+)"
HEREDOC_VORN = re.compile(_ZIEL + r"[^\n]*?" + _MARKE + r"\2")
HEREDOC_HINTEN = re.compile(_MARKE + r"\1[^\n]*?" + _ZIEL)
# Was nach Heredoc-Unit AUSSIEHT — jede solche Zeile muss eine der beiden
# Formen oben treffen, sonst ist sie unlesbar (Selbstpruefung, siehe Kopf).
SIEHT_AUS_WIE = re.compile(r"<<.*/etc/systemd/system/\S*\.service(?![\w./-])"
                           r"|/etc/systemd/system/\S*\.service(?![\w./-]).*<<")

# Programme, die einen PipeWire- oder Pulse-Klienten aufmachen. Sorte, nicht
# Marke: wer einen davon startet, braucht den Socket-Pfad.
TON_PROGRAMME = ("pw-play", "pw-cat", "paplay", "aplay", "mpv", "librespot", "ffplay")

# Ausgelieferter Pfad -> Quellordner im Baum. JEDER Eintrag wird geprueft;
# ein toter Anker bricht ab.
QUELLORTE = {
    "Sonos-Kids-Controller-master": "src/backend-api/src",
    "spotifycontroller-main": "src/backend-player/src",
}


def quelle_nennt_ton(ordner: Path) -> str:
    """Nennt irgendeine Datei in diesem Ordner ein Ton-Programm? Gibt die
    Fundstelle zurueck, sonst leer."""
    for pfad in sorted(ordner.rglob("*")):
        if not pfad.is_file() or pfad.suffix not in (".ts", ".js", ".mjs", ".py", ".sh"):
            continue
        if pfad.name.endswith(".spec.ts") or pfad.name.endswith(".test.ts"):
            continue
        try:
            text = pfad.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for zeile_nr, zeile in enumerate(text.splitlines(), 1):
            # Kommentare zaehlen nicht — sonst genuegt ein Hinweis im Text.
            nackt = zeile.strip()
            if nackt.startswith(("//", "#", "*", "/*")):
                continue
            for prog in TON_PROGRAMME:
                # IN AUFRUFSTELLUNG, nicht irgendwo in Anfuehrungszeichen.
                #
                # GEFUNDEN BEIM GEGENPRUEFEN (19.09.2026): Die erste Fassung
                # suchte nur den Namen im Zitat und meldete deshalb
                # `src/backend-api/src/dienste.ts:68 startet librespot`. Die
                # Zeile lautet aber `wodurch: 'librespot'` — ein DATENFELD,
                # das nennt, welcher Dienst welchen abgeloest hat. Es startet
                # nichts. Das Urteil war zufaellig richtig, die Begruendung
                # falsch — und wer die zitierte Zeile nachschlaegt, hoert auf,
                # dieser Wache zu glauben.
                #
                # Verlangt wird jetzt die STELLUNG: dem Zitat geht eine
                # oeffnende Klammer, eine eckige Klammer oder ein Komma
                # voraus, also die Stelle, an der ein Argument steht. Damit
                # faellt `schluessel: 'mpv'` heraus und `spawn('pw-play', …)`
                # bleibt. Dieselbe Ueberlegung wie bei prosa-ist-kein-ruf.
                if re.search(rf"[(\[,]\s*['\"`]{re.escape(prog)}['\"`]", zeile):
                    return f"{pfad.relative_to(WURZEL)}:{zeile_nr} startet {prog}"
    return ""


def baum_dateien() -> list[str]:
    """Alle Dateien des Baums, verfolgt ODER neu — nur nicht ignoriert.

    NICHT nur `git ls-files`: eine Unit, die gerade erst entsteht, ist noch
    unversioniert, und genau dann soll die Wache sie sehen — gemessen am
    29.09.2026 mit einer unversionierten Probe-Unit, die sofort rot wurde."""
    aus = subprocess.run(
        ["git", "-C", str(WURZEL), "ls-files", "-co", "--exclude-standard", "-z"],
        capture_output=True, check=True,
    ).stdout.decode("utf-8", "replace")
    return sorted(n for n in aus.split("\0") if n and not n.startswith(NICHT_QUELLE))


def kann_heredoc_tragen(rel: str) -> bool:
    pfad = WURZEL / rel
    if pfad.suffix in HEREDOC_ENDUNGEN:
        return True
    if pfad.suffix:
        return False
    try:
        with open(pfad, "rb") as f:
            erste = f.readline(200)
    except OSError:
        return False
    return erste.startswith(b"#!") and b"sh" in erste


def rezept_umgebung(text: str) -> dict:
    """Die `env:`-Werte auf oberster Ebene eines Rezepts — ohne YAML-Parser,
    damit die Wache auf einem Rechner ohne PyYAML genauso sieht."""
    werte = {}
    block = re.search(r"^env:[ \t]*\n((?:[ \t]+.*\n|[ \t]*\n)+)", text, re.M)
    if not block:
        return werte
    for m in re.finditer(r"^[ \t]+([A-Z_][A-Z0-9_]*):[ \t]*(.*?)[ \t]*$", block.group(1), re.M):
        werte[m.group(1)] = m.group(2).strip("'\"")
    return werte


def einsetzen(text: str, umgebung: dict) -> str:
    """Was die Shell in einem UNGESCHUETZTEN Heredoc einsetzt. Unbekannte
    Variablen bleiben stehen — der Aufrufer erkennt daran, dass er rät."""
    def ersatz(m):
        name, vorgabe = m.group(1) or m.group(3), m.group(2)
        if name in umgebung:
            return umgebung[name]
        if vorgabe is not None:
            return vorgabe
        return m.group(0)
    return re.sub(r"\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}|\$([A-Za-z_]\w*)", ersatz, text)


def heredoc_units(rel: str, befunde_unlesbar: list) -> list:
    """Jede Unit, die diese Datei per Heredoc nach /etc/systemd/system schreibt
    -> [(Herkunft, Unit-Name, Text)]."""
    try:
        zeilen = (WURZEL / rel).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    umgebung = rezept_umgebung("\n".join(zeilen)) if rel.endswith((".yaml", ".yml")) else {}
    funde = []
    for nr, zeile in enumerate(zeilen):
        m = HEREDOC_VORN.search(zeile)
        if m:
            name, zitat, marke = m.group(1), m.group(2), m.group(3)
        else:
            m = HEREDOC_HINTEN.search(zeile)
            if m:
                zitat, marke, name = m.group(1), m.group(2), m.group(3)
        if not m:
            if SIEHT_AUS_WIE.search(zeile) and not zeile.lstrip().startswith("#"):
                befunde_unlesbar.append(f"{rel}:{nr + 1}: {zeile.strip()[:90]}")
            continue
        geschuetzt = bool(zitat) or ("<<\\" in zeile) or ("<<-\\" in zeile)
        rumpf = []
        for folge in zeilen[nr + 1:]:
            if folge.strip() == marke:
                break
            rumpf.append(folge.strip())
        else:
            befunde_unlesbar.append(f"{rel}:{nr + 1}: Heredoc {marke} endet nie")
            continue
        text = "\n".join(rumpf)
        if not geschuetzt:
            text = einsetzen(text, umgebung)
        funde.append((f"{rel}:{nr + 1} (Heredoc)", name, text))
    return funde


def main() -> int:
    still = "--pruefen" in sys.argv

    # Anker der Zuordnung zuerst: eine tote Zuordnung macht blind.
    for ausgeliefert, quelle in QUELLORTE.items():
        if not (WURZEL / quelle).is_dir():
            print(f"ABBRUCH: die Zuordnung '{ausgeliefert}' -> '{quelle}' zeigt ins Leere.")
            print("Was zu tun ist: QUELLORTE in dieser Datei nachziehen. Ohne gueltige")
            print("Zuordnung kann die Wache den Tonweg eines Dienstes nicht mehr sehen")
            print("und waere still gruen — das ist schlimmer als ein Befund.")
            return 2

    # ── WO UNITS ENTSTEHEN: zwei Sorten, beide aus dem ganzen Baum ──────────
    dateien = baum_dateien()
    units = []  # (Herkunft, Unit-Name, Text)
    for rel in dateien:
        if rel.endswith(".service"):
            text = (WURZEL / rel).read_text(encoding="utf-8", errors="replace")
            units.append((rel, Path(rel).name, text))
    n_dateien = len(units)
    unlesbar: list = []
    for rel in dateien:
        if rel == "tools/tonweg-umgebung-deckung.py":
            continue  # der eigene Kopf zitiert die Formen, die er sucht
        if kann_heredoc_tragen(rel):
            units.extend(heredoc_units(rel, unlesbar))
    n_heredoc = len(units) - n_dateien

    if n_dateien == 0:
        print("ABBRUCH: im ganzen Baum liegt keine einzige *.service-Datei — die")
        print("Dateiliste ist kaputt (git?), nicht der Baum. Ohne Gegenstand prueft")
        print("diese Wache nichts.")
        return 2
    if unlesbar:
        print("ABBRUCH: diese Zeilen sehen nach einer Unit im Heredoc aus, lassen")
        print("sich aber nicht lesen (Unit-Name aus einer Variablen? Heredoc ohne")
        print("Ende?). Eine Unit, die die Wache nicht lesen kann, zaehlt sie nicht")
        print("als gesund:")
        for u in unlesbar:
            print(f"  UNLESBAR {u}")
        return 2

    luecken = []
    geraten = []
    geprueft = 0
    for herkunft, name, text in units:
        wirksam = "\n".join(z for z in text.splitlines() if not z.lstrip().startswith("#"))

        nutzer = re.search(r"^User=(.+)$", wirksam, re.M)
        if not nutzer or nutzer.group(1).strip() == "root":
            continue  # root: andere Frage, siehe Kopf
        geprueft += 1

        start = re.search(r"^ExecStart=(.*)$", wirksam, re.M)
        if start and "$" in start.group(1) and herkunft.endswith("(Heredoc)"):
            geraten.append(f"{herkunft} {name}: ExecStart={start.group(1)}")
            continue

        grund = ""
        for prog in TON_PROGRAMME:
            if re.search(rf"\b{re.escape(prog)}\b", wirksam):
                grund = f"die Unit nennt {prog} selbst"
                break
        if not grund:
            for ausgeliefert, quelle in QUELLORTE.items():
                if ausgeliefert in wirksam:
                    fund = quelle_nennt_ton(WURZEL / quelle)
                    if fund:
                        grund = fund
                    break
        if not grund:
            continue

        if not re.search(r"^Environment=.*XDG_RUNTIME_DIR=", wirksam, re.M):
            luecken.append((herkunft, name, grund))
            print(f"  FEHLT in {herkunft} -> {name}: Environment=XDG_RUNTIME_DIR — {grund}")

    if geraten:
        print("ABBRUCH: im ExecStart dieser Heredoc-Units bleibt nach dem Einsetzen")
        print("der Rezept-Umgebung eine Variable stehen — welches Programm dort")
        print("startet, laesst sich nicht sehen, also auch nicht, ob es Ton macht:")
        for g in geraten:
            print(f"  GERATEN {g}")
        return 2

    if luecken:
        print()
        print("  Ohne XDG_RUNTIME_DIR findet ein PipeWire-Klient seinen Socket nicht,")
        print("  faellt auf Pulse zurueck und scheitert dort mit einer Meldung ueber")
        print("  RECHTE — die den wahren Grund verdeckt. Vorbild: die Zeile in")
        print("  config/services/mupibox-player.service. Eine Unit, die an ZWEI Orten")
        print("  entsteht (Datei UND Rezept-Heredoc), braucht die Zeile an beiden.")
        print(f"\n{len(luecken)} LUECKE(N).")
        return 1

    if not still:
        print(f"  KEINE LUECKE ({geprueft} Dienste ohne root geprueft; gelesen: "
              f"{n_dateien} Unit-Dateien, {n_heredoc} Units aus Heredocs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
